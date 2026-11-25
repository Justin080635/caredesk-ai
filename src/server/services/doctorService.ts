import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  CLINIC_DEPARTMENTS,
  DOCTOR_DUTY_STATUSES,
  WEEKDAY_NAMES,
} from '../../shared/constants';
import type {
  AppointmentType,
  AuthUserProfile,
  ConsultationRecord,
  DoctorApplication,
  DoctorAvailabilitySummary,
  DoctorDashboardData,
  DoctorDutyStatus,
  DoctorScheduleDay,
  DoctorScope,
  DoctorUnavailability,
  FollowUpPriority,
  Patient,
  PrescriptionItem,
  StaffMember,
  TestResultItem,
} from '../../shared/types';
import { DEFAULT_DEMO_CLINIC_ID } from '../db/database';
import { seedDefaultDoctorSchedule } from '../db/seed';
import {
  ACTIVE_OCCUPYING_STATUSES,
  computeDoctorAvailability,
  deriveDoctorOperationalState,
  getClinicCurrentTime,
  getClinicTodayDate,
  getDayOfWeekFromDateString,
  isValidDateString,
  isValidEmail,
  isValidTimeString,
} from '../domain/rules';
import { getAppointmentById, listAppointments } from './appointmentService';
import { listAuditLogsForStaff, recordAuditEvent } from './auditService';
import {
  assertDoctorOwnsAppointment,
  buildDoctorConsultationSql,
  hasAnyClinicianAssignmentForPatient,
  hasUniqueClinicianNameInClinic,
  isPatientAssignedToDoctor,
  resolveDoctorScopeForStaffId,
} from './doctorAccessService';
import { getPendingFollowups, listFollowups } from './followupService';
import { createNotification, notifyClinicAdmins } from './notificationService';
import { getPatientById, listPatients, ServiceError } from './patientService';
import {
  getStaffById,
  listStaff,
  mapScheduleRow,
  mapUnavailabilityRow,
} from './staffService';

function generatePrefixedId(db: DatabaseSync, table: string, prefix: string, base: number): string {
  const rows = db.prepare(`SELECT id FROM ${table}`).all() as Array<{ id: string }>;
  let maxNum = base;
  const regex = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of rows) {
    const match = regex.exec(r.id);
    if (match) {
      const n = Number(match[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `${prefix}-${maxNum + 1}`;
}

function mapApplicationRow(row: Record<string, unknown>): DoctorApplication {
  return {
    id: String(row.id),
    clinicId: String(row.clinic_id),
    clinicName: row.clinic_name ? String(row.clinic_name) : undefined,
    userId: String(row.user_id),
    fullName: String(row.full_name),
    email: String(row.email),
    phoneNumber: String(row.phone_number ?? ''),
    specialty: String(row.specialty),
    department: String(row.department),
    qualifications: String(row.qualifications),
    licenseNumber: String(row.license_number),
    bio: String(row.bio ?? ''),
    status: row.status as DoctorApplication['status'],
    reviewNotes: String(row.review_notes ?? ''),
    reviewedByUserId: (row.reviewed_by_user_id as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function safeParseJsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function mapConsultationRow(row: Record<string, unknown>): ConsultationRecord {
  return {
    id: String(row.id),
    clinicId: String(row.clinic_id),
    appointmentId: (row.appointment_id as string | null) ?? null,
    patientId: String(row.patient_id),
    patientName: row.patient_name ? String(row.patient_name) : undefined,
    staffId: (row.staff_id as string | null) ?? null,
    doctorName: String(row.doctor_name),
    consultationDate: String(row.consultation_date),
    summary: String(row.summary),
    diagnosisNotes: String(row.diagnosis_notes ?? ''),
    recommendations: String(row.recommendations ?? ''),
    prescriptions: safeParseJsonArray<PrescriptionItem>(row.prescriptions_json),
    testResults: safeParseJsonArray<TestResultItem>(row.test_results_json),
    patientVisible: Boolean(row.patient_visible),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ============================================================================
// Doctor Verification Applications
// ============================================================================

export function submitDoctorApplication(
  db: DatabaseSync,
  user: AuthUserProfile,
  input: {
    clinicId: string;
    fullName?: string;
    phoneNumber?: string;
    specialty: string;
    department?: string;
    qualifications: string;
    licenseNumber: string;
    bio?: string;
  }
): DoctorApplication {
  const clinicId = (input.clinicId ?? '').trim();
  const fullName = (input.fullName ?? user.fullName).trim();
  const phoneNumber = (input.phoneNumber ?? user.phoneNumber).trim();
  const specialty = (input.specialty ?? '').trim();
  const department = (input.department ?? specialty).trim();
  const qualifications = (input.qualifications ?? '').trim();
  const licenseNumber = (input.licenseNumber ?? '').trim();
  const bio = (input.bio ?? '').trim();

  if (!clinicId) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please select the clinic you are applying to join.');
  }
  const clinic = db
    .prepare('SELECT id, name FROM clinics WHERE id = ?')
    .get(clinicId) as { id: string; name: string } | undefined;
  if (!clinic) {
    throw new ServiceError(404, 'CLINIC_NOT_FOUND', 'Selected clinic workspace was not found.');
  }

  if (fullName.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Full name must be at least 2 characters.');
  }
  if (specialty.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Medical specialty is required.');
  }
  if (qualifications.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Clinical qualifications / credentials are required.');
  }
  if (licenseNumber.length < 3) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Medical license or registration number is required.');
  }

  const existingMember = db
    .prepare(
      `SELECT id FROM clinic_memberships WHERE clinic_id = ? AND user_id = ? AND role = 'Doctor' AND status = 'Active'`
    )
    .get(clinicId, user.id) as { id: string } | undefined;
  if (existingMember) {
    throw new ServiceError(
      409,
      'ALREADY_VERIFIED_DOCTOR',
      `Your account is already an active verified Doctor in ${clinic.name}.`
    );
  }

  const pendingApp = db
    .prepare(
      `SELECT id FROM doctor_applications WHERE clinic_id = ? AND user_id = ? AND status = 'Pending Verification'`
    )
    .get(clinicId, user.id) as { id: string } | undefined;
  if (pendingApp) {
    throw new ServiceError(
      409,
      'APPLICATION_ALREADY_PENDING',
      `You already have a pending doctor verification application for ${clinic.name}.`
    );
  }

  const validDept =
    CLINIC_DEPARTMENTS.find((d) => d.toLowerCase() === department.toLowerCase()) ??
    (department || 'General Medicine');

  const id = generatePrefixedId(db, 'doctor_applications', 'DAPP', 1000);
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO doctor_applications (
      id, clinic_id, user_id, full_name, email, phone_number,
      specialty, department, qualifications, license_number, bio,
      status, review_notes, reviewed_by_user_id, reviewed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Verification', '', NULL, NULL, ?, ?)
  `).run(
    id,
    clinicId,
    user.id,
    fullName,
    user.email,
    phoneNumber,
    specialty,
    validDept,
    qualifications,
    licenseNumber,
    bio,
    nowIso,
    nowIso
  );

  recordAuditEvent(db, {
    clinicId,
    actor: fullName,
    action: 'SUBMIT_DOCTOR_APPLICATION',
    resourceType: 'doctor_application',
    resourceId: id,
    summary: `${fullName} (${user.email}) submitted a doctor registration application (${specialty}, License ${licenseNumber}) awaiting clinic administrator verification.`,
  });

  notifyClinicAdmins(db, {
    clinicId,
    title: 'Doctor Verification Request',
    message: `${fullName} (${specialty}, License ${licenseNumber}) requested Doctor verification.`,
    kind: 'verification',
    relatedType: 'doctor_application',
    relatedId: id,
  });

  const saved = db
    .prepare(
      `SELECT a.*, c.name AS clinic_name FROM doctor_applications a LEFT JOIN clinics c ON c.id = a.clinic_id WHERE a.id = ?`
    )
    .get(id) as Record<string, unknown>;
  return mapApplicationRow(saved);
}

export function listDoctorApplications(
  db: DatabaseSync,
  clinicId = DEFAULT_DEMO_CLINIC_ID,
  status?: string
): DoctorApplication[] {
  const conditions = ['a.clinic_id = ?'];
  const params: string[] = [clinicId];
  if (status && status !== 'All') {
    conditions.push('a.status = ?');
    params.push(status);
  }
  const rows = db
    .prepare(
      `SELECT a.*, c.name AS clinic_name
       FROM doctor_applications a
       LEFT JOIN clinics c ON c.id = a.clinic_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY CASE a.status WHEN 'Pending Verification' THEN 0 WHEN 'Approved' THEN 1 ELSE 2 END, a.created_at DESC`
    )
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapApplicationRow);
}

export function approveDoctorApplication(
  db: DatabaseSync,
  clinicId: string,
  applicationId: string,
  adminUser: AuthUserProfile,
  reviewNotes = ''
): { application: DoctorApplication; staff: StaffMember } {
  const row = db
    .prepare(`SELECT * FROM doctor_applications WHERE id = ? AND clinic_id = ?`)
    .get(applicationId, clinicId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ServiceError(404, 'APPLICATION_NOT_FOUND', `Doctor application ${applicationId} was not found.`);
  }
  if (row.status !== 'Pending Verification') {
    throw new ServiceError(
      409,
      'APPLICATION_ALREADY_REVIEWED',
      `Doctor application ${applicationId} has already been reviewed (${String(row.status)}).`
    );
  }

  const nowIso = new Date().toISOString();
  const userId = String(row.user_id);
  const fullName = String(row.full_name);
  const email = String(row.email);
  const phoneNumber = String(row.phone_number ?? '');
  const specialty = String(row.specialty);
  const department = String(row.department);
  const qualifications = String(row.qualifications);
  const licenseNumber = String(row.license_number);
  const bio = String(row.bio ?? '');

  let assignedStaffId = '';

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`
      UPDATE doctor_applications
      SET status = 'Approved',
          review_notes = ?,
          reviewed_by_user_id = ?,
          reviewed_at = ?,
          updated_at = ?
      WHERE id = ? AND clinic_id = ?
    `).run(reviewNotes.trim(), adminUser.id, nowIso, nowIso, applicationId, clinicId);

    const existingStaff = db
      .prepare(
        `SELECT id FROM staff WHERE clinic_id = ? AND (user_id = ? OR LOWER(email) = ?) LIMIT 1`
      )
      .get(clinicId, userId, email.toLowerCase()) as { id: string } | undefined;

    if (existingStaff) {
      assignedStaffId = existingStaff.id;
      db.prepare(`
        UPDATE staff
        SET user_id = ?, full_name = ?, role = 'Clinician', department = ?, specialty = ?,
            qualifications = ?, license_number = ?, bio = ?, contact_number = ?,
            status = 'Active', attendance_status = 'On Duty', verification_status = 'Approved',
            updated_at = ?
        WHERE id = ? AND clinic_id = ?
      `).run(
        userId,
        fullName,
        department,
        specialty,
        qualifications,
        licenseNumber,
        bio,
        phoneNumber,
        nowIso,
        assignedStaffId,
        clinicId
      );
    } else {
      assignedStaffId = generatePrefixedId(db, 'staff', 'STF', 1000);
      db.prepare(`
        INSERT INTO staff (
          id, clinic_id, user_id, full_name, role, department, specialty,
          qualifications, license_number, bio, email, contact_number,
          status, attendance_status, default_appointment_duration, max_daily_capacity,
          verification_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'Clinician', ?, ?, ?, ?, ?, ?, ?, 'Active', 'On Duty', 30, 16, 'Approved', ?, ?)
      `).run(
        assignedStaffId,
        clinicId,
        userId,
        fullName,
        department,
        specialty,
        qualifications,
        licenseNumber,
        bio,
        email,
        phoneNumber,
        nowIso,
        nowIso
      );
    }

    seedDefaultDoctorSchedule(db, clinicId, assignedStaffId);

    const existingMembership = db
      .prepare(`SELECT id FROM clinic_memberships WHERE clinic_id = ? AND user_id = ?`)
      .get(clinicId, userId) as { id: string } | undefined;

    if (existingMembership) {
      db.prepare(`
        UPDATE clinic_memberships SET role = 'Doctor', status = 'Active', updated_at = ? WHERE id = ?
      `).run(nowIso, existingMembership.id);
    } else {
      const membershipId = generatePrefixedId(db, 'clinic_memberships', 'MBR', 1000);
      db.prepare(`
        INSERT INTO clinic_memberships (id, clinic_id, user_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'Doctor', 'Active', ?, ?)
      `).run(membershipId, clinicId, userId, nowIso, nowIso);
    }

    createNotification(db, {
      clinicId,
      userId,
      staffId: assignedStaffId,
      title: 'Doctor Verification Approved',
      message: `Your clinician credentials (${specialty}) were approved. You now have access to the Doctor Portal.`,
      kind: 'verification',
      relatedType: 'doctor_application',
      relatedId: applicationId,
    });

    recordAuditEvent(db, {
      clinicId,
      actor: `${adminUser.fullName} (Clinic Administrator)`,
      action: 'APPROVE_DOCTOR_APPLICATION',
      resourceType: 'doctor_application',
      resourceId: applicationId,
      summary: `Approved doctor application ${applicationId} for ${fullName} (${specialty}, staff ${assignedStaffId}).`,
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  const updatedRow = db
    .prepare(
      `SELECT a.*, c.name AS clinic_name FROM doctor_applications a LEFT JOIN clinics c ON c.id = a.clinic_id WHERE a.id = ?`
    )
    .get(applicationId) as Record<string, unknown>;

  return {
    application: mapApplicationRow(updatedRow),
    staff: getStaffById(db, assignedStaffId, clinicId),
  };
}

export function rejectDoctorApplication(
  db: DatabaseSync,
  clinicId: string,
  applicationId: string,
  adminUser: AuthUserProfile,
  reviewNotes: string
): DoctorApplication {
  const row = db
    .prepare(`SELECT * FROM doctor_applications WHERE id = ? AND clinic_id = ?`)
    .get(applicationId, clinicId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ServiceError(404, 'APPLICATION_NOT_FOUND', `Doctor application ${applicationId} was not found.`);
  }
  if (row.status !== 'Pending Verification') {
    throw new ServiceError(409, 'APPLICATION_ALREADY_REVIEWED', 'Application has already been reviewed.');
  }

  const nowIso = new Date().toISOString();
  const reason = (reviewNotes ?? '').trim() || 'Credentials could not be verified by clinic administration.';

  db.prepare(`
    UPDATE doctor_applications
    SET status = 'Rejected',
        review_notes = ?,
        reviewed_by_user_id = ?,
        reviewed_at = ?,
        updated_at = ?
    WHERE id = ? AND clinic_id = ?
  `).run(reason, adminUser.id, nowIso, nowIso, applicationId, clinicId);

  createNotification(db, {
    clinicId,
    userId: String(row.user_id),
    title: 'Doctor Verification Update',
    message: `Your doctor verification request was not approved: ${reason}`,
    kind: 'verification',
    relatedType: 'doctor_application',
    relatedId: applicationId,
  });

  recordAuditEvent(db, {
    clinicId,
    actor: `${adminUser.fullName} (Clinic Administrator)`,
    action: 'REJECT_DOCTOR_APPLICATION',
    resourceType: 'doctor_application',
    resourceId: applicationId,
    summary: `Rejected doctor application ${applicationId} for ${String(row.full_name)}: ${reason}`,
  });

  const updated = db
    .prepare(
      `SELECT a.*, c.name AS clinic_name FROM doctor_applications a LEFT JOIN clinics c ON c.id = a.clinic_id WHERE a.id = ?`
    )
    .get(applicationId) as Record<string, unknown>;
  return mapApplicationRow(updated);
}

// ============================================================================
// Schedules, Unavailability, Duty Status & Clinic-Wide Availability
// ============================================================================

export function getDoctorSchedule(
  db: DatabaseSync,
  clinicId: string,
  staffId: string
): DoctorScheduleDay[] {
  const staff = getStaffById(db, staffId, clinicId);
  let rows = db
    .prepare(
      `SELECT * FROM doctor_schedules WHERE clinic_id = ? AND staff_id = ? ORDER BY day_of_week ASC`
    )
    .all(clinicId, staff.id) as unknown as Parameters<typeof mapScheduleRow>[0][];

  if (rows.length === 0) {
    seedDefaultDoctorSchedule(db, clinicId, staff.id);
    rows = db
      .prepare(
        `SELECT * FROM doctor_schedules WHERE clinic_id = ? AND staff_id = ? ORDER BY day_of_week ASC`
      )
      .all(clinicId, staff.id) as unknown as Parameters<typeof mapScheduleRow>[0][];
  }

  return rows.map(mapScheduleRow);
}

export function upsertDoctorSchedule(
  db: DatabaseSync,
  clinicId: string,
  staffId: string,
  days: Array<{
    dayOfWeek: number;
    isWorking: boolean;
    startTime: string;
    endTime: string;
    breakStart?: string;
    breakEnd?: string;
    slotDurationMinutes?: number;
  }>,
  actor: string
): DoctorScheduleDay[] {
  const staff = getStaffById(db, staffId, clinicId);
  if (!Array.isArray(days) || days.length === 0) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Schedule configuration days are required.');
  }

  const nowIso = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const day of days) {
      const dow = Number(day.dayOfWeek);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
        throw new ServiceError(400, 'VALIDATION_ERROR', 'dayOfWeek must be between 0 (Sunday) and 6 (Saturday).');
      }
      const isWorking = Boolean(day.isWorking);
      const startTime = (day.startTime || '08:30').trim();
      const endTime = (day.endTime || '17:00').trim();
      const breakStart = (day.breakStart ?? '').trim();
      const breakEnd = (day.breakEnd ?? '').trim();
      const slotDuration = Math.min(120, Math.max(15, Number(day.slotDurationMinutes) || 30));

      if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
        throw new ServiceError(400, 'VALIDATION_ERROR', `${WEEKDAY_NAMES[dow]} start and end times must use HH:MM format.`);
      }
      if (isWorking && startTime >= endTime) {
        throw new ServiceError(400, 'VALIDATION_ERROR', `${WEEKDAY_NAMES[dow]} start time must precede end time.`);
      }
      if ((breakStart && !breakEnd) || (!breakStart && breakEnd)) {
        throw new ServiceError(400, 'VALIDATION_ERROR', `${WEEKDAY_NAMES[dow]} break requires both start and end times.`);
      }
      if (breakStart && breakEnd) {
        if (!isValidTimeString(breakStart) || !isValidTimeString(breakEnd) || breakStart >= breakEnd) {
          throw new ServiceError(400, 'VALIDATION_ERROR', `${WEEKDAY_NAMES[dow]} break window is invalid.`);
        }
      }

      const id = `SCH-${staff.id}-${dow}`;
      db.prepare(`
        INSERT INTO doctor_schedules (
          id, clinic_id, staff_id, day_of_week, is_working,
          start_time, end_time, break_start, break_end, slot_duration_minutes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clinic_id, staff_id, day_of_week) DO UPDATE SET
          is_working = excluded.is_working,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          break_start = excluded.break_start,
          break_end = excluded.break_end,
          slot_duration_minutes = excluded.slot_duration_minutes,
          updated_at = excluded.updated_at
      `).run(
        id,
        clinicId,
        staff.id,
        dow,
        isWorking ? 1 : 0,
        startTime,
        endTime,
        breakStart,
        breakEnd,
        slotDuration,
        nowIso
      );
    }

    recordAuditEvent(db, {
      clinicId,
      actor,
      action: 'UPDATE_DOCTOR_SCHEDULE',
      resourceType: 'schedule',
      resourceId: staff.id,
      summary: `Updated weekly working hours & break schedule for ${staff.fullName} (${staff.id}).`,
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return getDoctorSchedule(db, clinicId, staff.id);
}

export function listDoctorUnavailability(
  db: DatabaseSync,
  clinicId: string,
  staffId: string
): DoctorUnavailability[] {
  const staff = getStaffById(db, staffId, clinicId);
  const rows = db
    .prepare(
      `SELECT * FROM doctor_unavailability
       WHERE clinic_id = ? AND staff_id = ?
       ORDER BY start_date DESC, created_at DESC`
    )
    .all(clinicId, staff.id) as unknown as Parameters<typeof mapUnavailabilityRow>[0][];
  return rows.map(mapUnavailabilityRow);
}

export function addDoctorUnavailability(
  db: DatabaseSync,
  clinicId: string,
  staffId: string,
  input: {
    startDate: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    kind: DoctorUnavailability['kind'];
    reason?: string;
  },
  actor: string
): DoctorUnavailability {
  const staff = getStaffById(db, staffId, clinicId);
  const startDate = (input.startDate ?? '').trim();
  const endDate = (input.endDate?.trim() || startDate);
  const startTime = (input.startTime ?? '').trim();
  const endTime = (input.endTime ?? '').trim();
  const kind = input.kind ?? 'Leave';
  const reason = (input.reason ?? '').trim();

  if (!isValidDateString(startDate) || !isValidDateString(endDate) || endDate < startDate) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Provide valid startDate and endDate (YYYY-MM-DD).');
  }
  if (!['Leave', 'Break', 'Unavailable'].includes(kind)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Unavailability kind must be Leave, Break, or Unavailable.');
  }
  if ((startTime && !endTime) || (!startTime && endTime)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Provide both startTime and endTime for partial-day blocks.');
  }
  if (startTime && endTime && (!isValidTimeString(startTime) || !isValidTimeString(endTime) || startTime >= endTime)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Time block window is invalid.');
  }

  const id = `UNAV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO doctor_unavailability (
      id, clinic_id, staff_id, start_date, end_date, start_time, end_time, kind, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, clinicId, staff.id, startDate, endDate, startTime, endTime, kind, reason, nowIso);

  recordAuditEvent(db, {
    clinicId,
    actor,
    action: 'ADD_DOCTOR_UNAVAILABILITY',
    resourceType: 'schedule',
    resourceId: staff.id,
    summary: `Added ${kind} block (${startDate}${endDate !== startDate ? ` to ${endDate}` : ''}${startTime ? ` ${startTime}-${endTime}` : ' all day'}) for ${staff.fullName}.`,
  });

  if (kind === 'Leave') {
    notifyClinicAdmins(db, {
      clinicId,
      title: `Clinician ${kind} Scheduled`,
      message: `${staff.fullName} scheduled ${kind.toLowerCase()} from ${startDate} to ${endDate}${reason ? ` (${reason})` : ''}.`,
      kind: 'system',
      relatedType: 'staff',
      relatedId: staff.id,
    });
  }

  const row = db
    .prepare('SELECT * FROM doctor_unavailability WHERE id = ?')
    .get(id) as unknown as Parameters<typeof mapUnavailabilityRow>[0];
  return mapUnavailabilityRow(row);
}

export function deleteDoctorUnavailability(
  db: DatabaseSync,
  clinicId: string,
  staffId: string,
  unavailId: string,
  actor: string
): { deleted: boolean; id: string } {
  const staff = getStaffById(db, staffId, clinicId);
  const existing = db
    .prepare('SELECT id FROM doctor_unavailability WHERE id = ? AND clinic_id = ? AND staff_id = ?')
    .get(unavailId, clinicId, staff.id);
  if (!existing) {
    throw new ServiceError(404, 'UNAVAILABILITY_NOT_FOUND', 'Schedule unavailability block not found.');
  }

  db.prepare('DELETE FROM doctor_unavailability WHERE id = ? AND clinic_id = ?').run(unavailId, clinicId);

  recordAuditEvent(db, {
    clinicId,
    actor,
    action: 'REMOVE_DOCTOR_UNAVAILABILITY',
    resourceType: 'schedule',
    resourceId: staff.id,
    summary: `Removed schedule unavailability block ${unavailId} for ${staff.fullName}.`,
  });

  return { deleted: true, id: unavailId };
}

export function updateDoctorDutyStatus(
  db: DatabaseSync,
  clinicId: string,
  staffId: string,
  attendanceStatus: DoctorDutyStatus,
  actor: string
): StaffMember {
  const staff = getStaffById(db, staffId, clinicId);
  if (!DOCTOR_DUTY_STATUSES.includes(attendanceStatus)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid doctor duty/operational status.');
  }

  const nextStatus =
    attendanceStatus === 'On Leave'
      ? 'On Leave'
      : staff.status === 'On Leave'
        ? 'Active'
        : staff.status;

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE staff
    SET attendance_status = ?, status = ?, updated_at = ?
    WHERE id = ? AND clinic_id = ?
  `).run(attendanceStatus, nextStatus, nowIso, staff.id, clinicId);

  recordAuditEvent(db, {
    clinicId,
    actor,
    action: 'UPDATE_DOCTOR_DUTY_STATUS',
    resourceType: 'staff',
    resourceId: staff.id,
    summary: `Updated ${staff.fullName} live operational duty status to "${attendanceStatus}".`,
  });

  return getStaffById(db, staff.id, clinicId);
}

export function getClinicDoctorAvailabilitySummary(
  db: DatabaseSync,
  clinicId = DEFAULT_DEMO_CLINIC_ID,
  filters?: {
    date?: string;
    department?: string;
    specialty?: string;
    appointmentType?: AppointmentType;
    timeOfDay?: 'morning' | 'afternoon' | 'any';
  }
): DoctorAvailabilitySummary[] {
  const targetDate =
    filters?.date && isValidDateString(filters.date) ? filters.date : getClinicTodayDate();
  const dayOfWeek = getDayOfWeekFromDateString(targetDate);
  const currentTime = getClinicCurrentTime();
  const today = getClinicTodayDate();

  const doctors = listStaff(db, { clinicId, role: 'Clinician' }).filter((doc) => {
    if (doc.verificationStatus && doc.verificationStatus !== 'Approved') return false;
    if (filters?.department && filters.department !== 'All' && doc.department !== filters.department) {
      return false;
    }
    if (
      filters?.specialty &&
      filters.specialty !== 'All' &&
      doc.department.toLowerCase() !== filters.specialty.toLowerCase() &&
      !doc.specialty.toLowerCase().includes(filters.specialty.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const existingAppointments = listAppointments(db, { clinicId });
  const schedRows = db
    .prepare('SELECT * FROM doctor_schedules WHERE clinic_id = ?')
    .all(clinicId) as unknown as Parameters<typeof mapScheduleRow>[0][];
  const schedulesByStaff = new Map<string, DoctorScheduleDay[]>();
  for (const r of schedRows) {
    const mapped = mapScheduleRow(r);
    const list = schedulesByStaff.get(mapped.staffId) ?? [];
    list.push(mapped);
    schedulesByStaff.set(mapped.staffId, list);
  }

  const unavailRows = db
    .prepare('SELECT * FROM doctor_unavailability WHERE clinic_id = ?')
    .all(clinicId) as unknown as Parameters<typeof mapUnavailabilityRow>[0][];
  const unavailByStaff = new Map<string, DoctorUnavailability[]>();
  for (const r of unavailRows) {
    const mapped = mapUnavailabilityRow(r);
    const list = unavailByStaff.get(mapped.staffId) ?? [];
    list.push(mapped);
    unavailByStaff.set(mapped.staffId, list);
  }

  return doctors.map((doc) => {
    const schedules = schedulesByStaff.get(doc.id) ?? [];
    const daySchedule = schedules.find((s) => s.dayOfWeek === dayOfWeek) ?? null;
    const todaySchedule = schedules.find((s) => s.dayOfWeek === new Date().getDay()) ?? null;
    const unavail = unavailByStaff.get(doc.id) ?? [];

    const docTodayApts = existingAppointments.filter(
      (a) =>
        a.appointmentDate === today &&
        (a.staffId === doc.id || a.clinician.toLowerCase() === doc.fullName.toLowerCase())
    );
    const effectiveOperationalState = deriveDoctorOperationalState({
      doctor: doc,
      todayDate: today,
      currentTime,
      todaySchedule,
      todayAppointments: docTodayApts,
      unavailability: unavail,
    });

    const bookedOnTargetDate = existingAppointments.filter(
      (a) =>
        a.appointmentDate === targetDate &&
        ACTIVE_OCCUPYING_STATUSES.has(a.status) &&
        (a.staffId === doc.id || a.clinician.toLowerCase() === doc.fullName.toLowerCase())
    ).length;

    const slotsOnDate = computeDoctorAvailability({
      doctors: [doc],
      schedulesByStaffId: schedulesByStaff,
      unavailabilityByStaffId: unavailByStaff,
      existingAppointments,
      options: {
        startDate: targetDate,
        daysCount: 1,
        staffId: doc.id,
        appointmentType: filters?.appointmentType,
        timeOfDay: filters?.timeOfDay,
        limit: 24,
      },
    });

    const nextWindowSlots =
      slotsOnDate.length > 0
        ? slotsOnDate
        : computeDoctorAvailability({
            doctors: [doc],
            schedulesByStaffId: schedulesByStaff,
            unavailabilityByStaffId: unavailByStaff,
            existingAppointments,
            options: {
              startDate: targetDate,
              daysCount: 7,
              staffId: doc.id,
              appointmentType: filters?.appointmentType,
              timeOfDay: filters?.timeOfDay,
              limit: 1,
            },
          });

    const workingHoursLabel = daySchedule
      ? daySchedule.isWorking
        ? `${daySchedule.startTime}–${daySchedule.endTime}`
        : 'Off Schedule'
      : dayOfWeek >= 1 && dayOfWeek <= 5
        ? '08:30–17:00'
        : 'Off Schedule';

    const breakWindowLabel =
      daySchedule?.isWorking && daySchedule.breakStart && daySchedule.breakEnd
        ? `${daySchedule.breakStart}–${daySchedule.breakEnd}`
        : 'None';

    return {
      staffId: doc.id,
      fullName: doc.fullName,
      department: doc.department,
      specialty: doc.specialty || doc.department,
      qualifications: doc.qualifications ?? '',
      attendanceStatus: doc.attendanceStatus ?? 'On Duty',
      effectiveOperationalState,
      isBookableOnDate: slotsOnDate.length > 0,
      workingHoursLabel,
      breakWindowLabel,
      bookedCount: bookedOnTargetDate,
      maxDailyCapacity: doc.maxDailyCapacity ?? 16,
      nextAvailableSlot: nextWindowSlots[0] ?? null,
      availableSlots: slotsOnDate,
    };
  });
}

// ============================================================================
// Doctor Workspace: Dashboard, Patients, Activity, Profile & Consultations
// ============================================================================

export function listConsultationsForPatient(
  db: DatabaseSync,
  clinicId: string,
  patientId: string,
  options?: { patientVisibleOnly?: boolean; doctorScope?: DoctorScope }
): ConsultationRecord[] {
  const clauses = ['c.clinic_id = ?', 'c.patient_id = ?'];
  const params: Array<string | number> = [clinicId, patientId];
  if (options?.patientVisibleOnly) {
    clauses.push('c.patient_visible = 1');
  }
  if (options?.doctorScope) {
    const scopePred = buildDoctorConsultationSql(options.doctorScope, 'c');
    clauses.push(scopePred.sql);
    params.push(...scopePred.params);
  }
  const rows = db
    .prepare(
      `SELECT c.*, p.full_name AS patient_name
       FROM consultations c
       LEFT JOIN patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY c.consultation_date DESC, c.created_at DESC`
    )
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapConsultationRow);
}

export function listConsultationsByDoctor(
  db: DatabaseSync,
  clinicId: string,
  staffId: string
): ConsultationRecord[] {
  const scope = resolveDoctorScopeForStaffId(db, clinicId, staffId);
  const scopePred = buildDoctorConsultationSql(scope, 'c');
  const rows = db
    .prepare(
      `SELECT c.*, p.full_name AS patient_name
       FROM consultations c
       LEFT JOIN patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
       WHERE c.clinic_id = ? AND ${scopePred.sql}
       ORDER BY c.consultation_date DESC, c.created_at DESC`
    )
    .all(clinicId, ...scopePred.params) as Array<Record<string, unknown>>;
  return rows.map(mapConsultationRow);
}

export function createConsultation(
  db: DatabaseSync,
  clinicId: string,
  staffId: string,
  input: {
    appointmentId?: string | null;
    patientId: string;
    consultationDate?: string;
    summary: string;
    diagnosisNotes?: string;
    recommendations?: string;
    prescriptions?: PrescriptionItem[];
    testResults?: TestResultItem[];
    patientVisible?: boolean;
    createFollowUp?: {
      description: string;
      reason?: string;
      dueDate: string;
      priority?: FollowUpPriority;
    } | null;
  },
  actor: string
): ConsultationRecord {
  const doctor = getStaffById(db, staffId, clinicId);
  const doctorScope: DoctorScope = { staffId: doctor.id, doctorName: doctor.fullName };
  const patient = getPatientById(db, (input.patientId ?? '').trim(), clinicId);
  const appointmentId = input.appointmentId ? input.appointmentId.trim() : null;
  const consultationDate =
    input.consultationDate && isValidDateString(input.consultationDate)
      ? input.consultationDate
      : getClinicTodayDate();
  const summary = (input.summary ?? '').trim();
  const diagnosisNotes = (input.diagnosisNotes ?? '').trim();
  const recommendations = (input.recommendations ?? '').trim();
  const prescriptions = Array.isArray(input.prescriptions) ? input.prescriptions : [];
  const testResults = Array.isArray(input.testResults) ? input.testResults : [];
  const patientVisible = input.patientVisible !== false;

  if (summary.length < 4) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Consultation summary must be at least 4 characters.');
  }
  if (appointmentId) {
    const apt = getAppointmentById(db, appointmentId, clinicId);
    if (apt.patientId !== patient.id) {
      throw new ServiceError(400, 'VALIDATION_ERROR', 'Appointment does not belong to the selected patient.');
    }
    assertDoctorOwnsAppointment(db, clinicId, apt, doctorScope);
  } else if (
    !isPatientAssignedToDoctor(db, clinicId, patient.id, doctorScope) &&
    hasAnyClinicianAssignmentForPatient(db, clinicId, patient.id)
  ) {
    throw new ServiceError(
      403,
      'FORBIDDEN',
      'You can only document consultations for patients assigned to your clinical caseload.'
    );
  }

  const id = generatePrefixedId(db, 'consultations', 'CON', 4000);
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`
      INSERT INTO consultations (
        id, clinic_id, appointment_id, patient_id, staff_id, doctor_name,
        consultation_date, summary, diagnosis_notes, recommendations,
        prescriptions_json, test_results_json, patient_visible, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      clinicId,
      appointmentId,
      patient.id,
      doctor.id,
      doctor.fullName,
      consultationDate,
      summary,
      diagnosisNotes,
      recommendations,
      JSON.stringify(prescriptions),
      JSON.stringify(testResults),
      patientVisible ? 1 : 0,
      nowIso,
      nowIso
    );

    if (appointmentId) {
      db.prepare(`
        UPDATE appointments
        SET status = CASE WHEN status IN ('Scheduled', 'Confirmed') THEN 'Completed' ELSE status END,
            updated_at = ?
        WHERE id = ? AND clinic_id = ?
      `).run(nowIso, appointmentId, clinicId);
    }

    if (input.createFollowUp && input.createFollowUp.description.trim().length >= 4) {
      const fuId = generatePrefixedId(db, 'followups', 'FU', 3000);
      const fuDue = isValidDateString(input.createFollowUp.dueDate)
        ? input.createFollowUp.dueDate
        : getClinicTodayDate();
      const fuPriority: FollowUpPriority = input.createFollowUp.priority ?? 'Medium';
      db.prepare(`
        INSERT INTO followups (
          id, clinic_id, patient_id, appointment_id, followup_type, assigned_staff_id, assigned_to_name,
          description, reason, priority, created_date, due_date, status,
          completed_at, completed_by, completion_notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'Clinical Recommendation', ?, ?, ?, ?, ?, ?, ?, 'Pending', NULL, '', '', ?, ?)
      `).run(
        fuId,
        clinicId,
        patient.id,
        appointmentId,
        doctor.id,
        doctor.fullName,
        input.createFollowUp.description.trim(),
        (input.createFollowUp.reason ?? `Ordered during consultation ${id}`).trim(),
        fuPriority,
        consultationDate,
        fuDue,
        nowIso,
        nowIso
      );
    }

    if (patientVisible) {
      const patientUser = db
        .prepare('SELECT linked_user_id FROM patients WHERE id = ? AND clinic_id = ?')
        .get(patient.id, clinicId) as { linked_user_id: string | null } | undefined;
      if (patientUser?.linked_user_id) {
        createNotification(db, {
          clinicId,
          userId: patientUser.linked_user_id,
          patientId: patient.id,
          staffId: doctor.id,
          title: 'New Consultation Summary Available',
          message: `${doctor.fullName} published your ${consultationDate} consultation summary and care plan.`,
          kind: 'consultation',
          relatedType: 'consultation',
          relatedId: id,
        });
      }
    }

    recordAuditEvent(db, {
      clinicId,
      actor,
      action: 'CREATE_CONSULTATION',
      resourceType: 'consultation',
      resourceId: id,
      summary: `${doctor.fullName} documented consultation ${id} for ${patient.fullName} (${patient.id})${patientVisible ? ' · shared with patient' : ''}.`,
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  const saved = db
    .prepare(
      `SELECT c.*, p.full_name AS patient_name
       FROM consultations c
       LEFT JOIN patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
       WHERE c.id = ?`
    )
    .get(id) as Record<string, unknown>;
  return mapConsultationRow(saved);
}

export function getDoctorDashboard(
  db: DatabaseSync,
  clinicId: string,
  staffId: string
): DoctorDashboardData {
  const doctor = getStaffById(db, staffId, clinicId);
  const doctorScope: DoctorScope = { staffId: doctor.id, doctorName: doctor.fullName };
  const todayDate = getClinicTodayDate();
  const currentTime = getClinicCurrentTime();

  const allDoctorAppointments = listAppointments(db, { clinicId, doctorScope });

  const todayAppointments = allDoctorAppointments
    .filter((a) => a.appointmentDate === todayDate)
    .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));

  const nextAppointment =
    allDoctorAppointments.find(
      (a) =>
        (a.appointmentDate > todayDate ||
          (a.appointmentDate === todayDate && a.appointmentTime >= currentTime)) &&
        (a.status === 'Scheduled' || a.status === 'Confirmed')
    ) ??
    todayAppointments.find((a) => a.status === 'Scheduled' || a.status === 'Confirmed') ??
    null;

  const followupsRequiringAttention = getPendingFollowups(db, clinicId, undefined, doctorScope);
  const consultations = listConsultationsByDoctor(db, clinicId, doctor.id);

  const assignedPatientIds = new Set<string>([
    ...allDoctorAppointments.map((a) => a.patientId),
    ...followupsRequiringAttention.map((f) => f.patientId),
    ...consultations.map((c) => c.patientId),
  ]);

  const documentedAppointmentIds = new Set(
    consultations.map((c) => c.appointmentId).filter((id): id is string => Boolean(id))
  );

  const pendingConsultationsCount = allDoctorAppointments.filter(
    (a) =>
      (a.status === 'Completed' || (a.appointmentDate === todayDate && a.status === 'Confirmed')) &&
      !documentedAppointmentIds.has(a.id)
  ).length;

  const schedules = getDoctorSchedule(db, clinicId, doctor.id);
  const todaySchedule = schedules.find((s) => s.dayOfWeek === new Date().getDay()) ?? null;
  const allUnavailability = listDoctorUnavailability(db, clinicId, doctor.id);
  const upcomingUnavailability = allUnavailability.filter((u) => u.endDate >= todayDate);

  const effectiveOperationalState = deriveDoctorOperationalState({
    doctor,
    todayDate,
    currentTime,
    todaySchedule,
    todayAppointments,
    unavailability: allUnavailability,
  });

  return {
    doctor: { ...doctor, effectiveOperationalState },
    todayDate,
    effectiveOperationalState,
    todayAppointments,
    nextAppointment,
    assignedPatientsCount: assignedPatientIds.size,
    pendingConsultationsCount,
    followupsRequiringAttention,
    upcomingUnavailability,
    todaySchedule,
  };
}

export function getDoctorPatients(
  db: DatabaseSync,
  clinicId: string,
  staffId: string,
  search?: string
): Array<
  Patient & {
    appointmentsCount: number;
    upcomingCount: number;
    lastAppointmentDate: string | null;
    consultationsCount: number;
  }
> {
  const doctor = getStaffById(db, staffId, clinicId);
  const doctorScope: DoctorScope = { staffId: doctor.id, doctorName: doctor.fullName };
  const today = getClinicTodayDate();
  const appointments = listAppointments(db, { clinicId, doctorScope });
  const consultations = listConsultationsByDoctor(db, clinicId, doctor.id);
  const assignedPatients = listPatients(db, {
    clinicId,
    search,
    assignedToDoctor: doctorScope,
  });

  return assignedPatients.map((p) => {
    const pApts = appointments.filter((a) => a.patientId === p.id);
    const pCons = consultations.filter((c) => c.patientId === p.id);
    const sortedDates = pApts.map((a) => a.appointmentDate).sort((a, b) => b.localeCompare(a));
    return {
      ...p,
      appointmentsCount: pApts.length,
      upcomingCount: pApts.filter(
        (a) => a.appointmentDate >= today && (a.status === 'Scheduled' || a.status === 'Confirmed')
      ).length,
      lastAppointmentDate: sortedDates[0] ?? null,
      consultationsCount: pCons.length,
    };
  });
}

export function getDoctorActivity(db: DatabaseSync, clinicId: string, staffId: string) {
  const doctor = getStaffById(db, staffId, clinicId);
  const doctorScope: DoctorScope = { staffId: doctor.id, doctorName: doctor.fullName };
  const appointments = listAppointments(db, { clinicId, doctorScope });
  const hasUniqueName = hasUniqueClinicianNameInClinic(db, clinicId, doctor.id, doctor.fullName);
  return listAuditLogsForStaff(
    db,
    clinicId,
    doctor.id,
    doctor.fullName,
    appointments.map((a) => a.id),
    60,
    { includeActorNameMatch: hasUniqueName }
  );
}

export function updateDoctorOwnProfile(
  db: DatabaseSync,
  clinicId: string,
  user: AuthUserProfile,
  staffId: string,
  patch: {
    specialty?: string;
    qualifications?: string;
    licenseNumber?: string;
    bio?: string;
    contactNumber?: string;
    email?: string;
    avatarUrl?: string;
    defaultAppointmentDuration?: number;
    maxDailyCapacity?: number;
  }
): StaffMember {
  const existing = getStaffById(db, staffId, clinicId);
  if (existing.userId && existing.userId !== user.id) {
    throw new ServiceError(403, 'FORBIDDEN', 'You can only update your own clinician profile.');
  }

  const specialty = patch.specialty !== undefined ? patch.specialty.trim() : existing.specialty;
  const qualifications =
    patch.qualifications !== undefined ? patch.qualifications.trim() : (existing.qualifications ?? '');
  const licenseNumber =
    patch.licenseNumber !== undefined ? patch.licenseNumber.trim() : (existing.licenseNumber ?? '');
  const bio = patch.bio !== undefined ? patch.bio.trim() : (existing.bio ?? '');
  const contactNumber =
    patch.contactNumber !== undefined ? patch.contactNumber.trim() : existing.contactNumber;
  const email = patch.email !== undefined ? patch.email.trim() : existing.email;
  const avatarUrl = patch.avatarUrl !== undefined ? patch.avatarUrl.trim() : (existing.avatarUrl ?? '');
  const defaultDuration =
    patch.defaultAppointmentDuration !== undefined
      ? Math.min(120, Math.max(15, Number(patch.defaultAppointmentDuration) || 30))
      : (existing.defaultAppointmentDuration ?? 30);
  const maxDailyCapacity =
    patch.maxDailyCapacity !== undefined
      ? Math.min(48, Math.max(1, Number(patch.maxDailyCapacity) || 16))
      : (existing.maxDailyCapacity ?? 16);

  if (email && !isValidEmail(email)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please provide a valid email address.');
  }
  if (contactNumber && contactNumber.length < 7) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Phone number must be at least 7 characters.');
  }

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE staff
    SET specialty = ?, qualifications = ?, license_number = ?, bio = ?,
        contact_number = ?, email = ?, avatar_url = ?,
        default_appointment_duration = ?, max_daily_capacity = ?, updated_at = ?
    WHERE id = ? AND clinic_id = ?
  `).run(
    specialty,
    qualifications,
    licenseNumber,
    bio,
    contactNumber,
    email,
    avatarUrl,
    defaultDuration,
    maxDailyCapacity,
    nowIso,
    staffId,
    clinicId
  );

  db.prepare(`UPDATE users SET phone_number = ?, avatar_url = ?, updated_at = ? WHERE id = ?`).run(
    contactNumber || user.phoneNumber,
    avatarUrl || user.avatarUrl,
    nowIso,
    user.id
  );

  recordAuditEvent(db, {
    clinicId,
    actor: `${user.fullName} (Doctor)`,
    action: 'UPDATE_DOCTOR_PROFILE',
    resourceType: 'staff',
    resourceId: staffId,
    summary: `Doctor ${existing.fullName} updated their clinician profile and scheduling preferences.`,
  });

  return getStaffById(db, staffId, clinicId);
}
