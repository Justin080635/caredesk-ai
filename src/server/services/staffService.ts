import type { DatabaseSync } from 'node:sqlite';
import type {
  DoctorDutyStatus,
  DoctorScheduleDay,
  DoctorUnavailability,
  DoctorVerificationStatus,
  StaffDetail,
  StaffMember,
  StaffResponsibility,
  StaffRole,
  StaffStatus,
} from '../../shared/types';
import { DEFAULT_DEMO_CLINIC_ID } from '../db/database';
import {
  deriveDoctorOperationalState,
  getClinicCurrentTime,
  getClinicTodayDate,
  isValidEmail,
} from '../domain/rules';
import { listAppointments } from './appointmentService';
import { listAuditLogsForStaff, recordAuditEvent } from './auditService';
import { ServiceError } from './patientService';

interface StaffRow {
  id: string;
  clinic_id: string;
  user_id: string | null;
  full_name: string;
  role: StaffRole;
  department: string;
  specialty: string;
  qualifications: string;
  license_number: string;
  bio: string;
  avatar_url: string;
  email: string;
  contact_number: string;
  status: StaffStatus;
  attendance_status: DoctorDutyStatus;
  default_appointment_duration: number;
  max_daily_capacity: number;
  verification_status: DoctorVerificationStatus;
  created_at: string;
  updated_at: string;
}

interface ScheduleRow {
  id: string;
  clinic_id: string;
  staff_id: string;
  day_of_week: number;
  is_working: number;
  start_time: string;
  end_time: string;
  break_start: string;
  break_end: string;
  slot_duration_minutes: number;
  updated_at: string;
}

interface UnavailabilityRow {
  id: string;
  clinic_id: string;
  staff_id: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  kind: DoctorUnavailability['kind'];
  reason: string;
  created_at: string;
}

const VALID_STAFF_ROLES: ReadonlySet<StaffRole> = new Set([
  'Clinician',
  'Administrator',
  'Coordinator',
  'Viewer',
]);

const VALID_STAFF_STATUSES: ReadonlySet<StaffStatus> = new Set([
  'Active',
  'On Leave',
  'Inactive',
]);

const STAFF_SELECT_COLS = `
  id, clinic_id, user_id, full_name, role, department, specialty,
  qualifications, license_number, bio, avatar_url, email, contact_number,
  status, attendance_status, default_appointment_duration, max_daily_capacity,
  verification_status, created_at, updated_at
`;

export function mapStaffRow(row: StaffRow): StaffMember {
  return {
    id: row.id,
    userId: row.user_id,
    fullName: row.full_name,
    role: row.role,
    department: row.department,
    specialty: row.specialty,
    qualifications: row.qualifications ?? '',
    licenseNumber: row.license_number ?? '',
    bio: row.bio ?? '',
    avatarUrl: row.avatar_url ?? '',
    email: row.email,
    contactNumber: row.contact_number,
    status: row.status,
    attendanceStatus: row.attendance_status ?? 'On Duty',
    defaultAppointmentDuration: row.default_appointment_duration ?? 30,
    maxDailyCapacity: row.max_daily_capacity ?? 16,
    verificationStatus: row.verification_status ?? 'Approved',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapScheduleRow(row: ScheduleRow): DoctorScheduleDay {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    staffId: row.staff_id,
    dayOfWeek: row.day_of_week,
    isWorking: Boolean(row.is_working),
    startTime: row.start_time,
    endTime: row.end_time,
    breakStart: row.break_start,
    breakEnd: row.break_end,
    slotDurationMinutes: row.slot_duration_minutes,
    updatedAt: row.updated_at,
  };
}

export function mapUnavailabilityRow(row: UnavailabilityRow): DoctorUnavailability {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    staffId: row.staff_id,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    kind: row.kind,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export function listStaff(
  db: DatabaseSync,
  filters?: { clinicId?: string; search?: string; role?: string; department?: string; status?: string }
): StaffMember[] {
  const clinicId = filters?.clinicId ?? DEFAULT_DEMO_CLINIC_ID;
  const conditions: string[] = ['clinic_id = ?'];
  const params: string[] = [clinicId];

  if (filters?.search && filters.search.trim().length > 0) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      '(LOWER(id) LIKE ? OR LOWER(full_name) LIKE ? OR LOWER(department) LIKE ? OR LOWER(specialty) LIKE ? OR LOWER(role) LIKE ?)'
    );
    params.push(q, q, q, q, q);
  }

  if (filters?.role && filters.role !== 'All') {
    conditions.push('role = ?');
    params.push(filters.role);
  }

  if (filters?.department && filters.department !== 'All') {
    conditions.push('department = ?');
    params.push(filters.department);
  }

  if (filters?.status && filters.status !== 'All') {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const rows = db
    .prepare(
      `SELECT ${STAFF_SELECT_COLS}
       FROM staff
       ${whereClause}
       ORDER BY
         CASE role WHEN 'Clinician' THEN 0 WHEN 'Administrator' THEN 1 WHEN 'Coordinator' THEN 2 ELSE 3 END,
         id ASC`
    )
    .all(...params) as unknown as StaffRow[];

  const today = getClinicTodayDate();
  const currentTime = getClinicCurrentTime();
  const todayDayOfWeek = new Date().getDay();

  const appointmentRows = db
    .prepare(
      `SELECT
         clinician,
         COUNT(*) AS total_count,
         SUM(CASE WHEN appointment_date >= ? AND status IN ('Scheduled', 'Confirmed') THEN 1 ELSE 0 END) AS upcoming_count,
         SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed_count
       FROM appointments
       WHERE clinic_id = ?
       GROUP BY clinician`
    )
    .all(today, clinicId) as Array<{
      clinician: string;
      total_count: number;
      upcoming_count: number;
      completed_count: number;
    }>;

  const countsByClinician = new Map(
    appointmentRows.map((r) => [
      r.clinician,
      {
        total: r.total_count,
        upcoming: r.upcoming_count,
        completed: r.completed_count,
      },
    ])
  );

  const todayAppointments = listAppointments(db, { clinicId, date: today });
  const scheduleRows = db
    .prepare(`SELECT * FROM doctor_schedules WHERE clinic_id = ? AND day_of_week = ?`)
    .all(clinicId, todayDayOfWeek) as unknown as ScheduleRow[];
  const schedByStaff = new Map(scheduleRows.map((s) => [s.staff_id, mapScheduleRow(s)]));

  const unavailRows = db
    .prepare(`SELECT * FROM doctor_unavailability WHERE clinic_id = ? AND start_date <= ? AND end_date >= ?`)
    .all(clinicId, today, today) as unknown as UnavailabilityRow[];
  const unavailByStaff = new Map<string, DoctorUnavailability[]>();
  for (const u of unavailRows) {
    const arr = unavailByStaff.get(u.staff_id) ?? [];
    arr.push(mapUnavailabilityRow(u));
    unavailByStaff.set(u.staff_id, arr);
  }

  return rows.map((row) => {
    const member = mapStaffRow(row);
    const counts = countsByClinician.get(member.fullName);
    const docApts = todayAppointments.filter(
      (a) => a.staffId === member.id || a.clinician.toLowerCase() === member.fullName.toLowerCase()
    );
    const effectiveState =
      member.role === 'Clinician'
        ? deriveDoctorOperationalState({
            doctor: member,
            todayDate: today,
            currentTime,
            todaySchedule: schedByStaff.get(member.id) ?? null,
            todayAppointments: docApts,
            unavailability: unavailByStaff.get(member.id) ?? [],
          })
        : member.attendanceStatus;

    return {
      ...member,
      effectiveOperationalState: effectiveState,
      assignedAppointmentsCount: counts?.total ?? 0,
      upcomingAppointmentsCount: counts?.upcoming ?? 0,
      completedAppointmentsCount: counts?.completed ?? 0,
    };
  });
}

export function getStaffById(
  db: DatabaseSync,
  staffId: string,
  clinicId = DEFAULT_DEMO_CLINIC_ID
): StaffMember {
  const row = db
    .prepare(
      `SELECT ${STAFF_SELECT_COLS}
       FROM staff
       WHERE id = ? AND clinic_id = ?`
    )
    .get(staffId, clinicId) as StaffRow | undefined;

  if (!row) {
    throw new ServiceError(404, 'STAFF_NOT_FOUND', `Staff member ${staffId} was not found in this clinic.`);
  }
  return mapStaffRow(row);
}

function buildResponsibilitiesForStaff(
  db: DatabaseSync,
  clinicId: string,
  staff: StaffMember,
  appointments: ReturnType<typeof listAppointments>
): StaffResponsibility[] {
  const today = getClinicTodayDate();
  const responsibilities: StaffResponsibility[] = [];

  if (staff.role === 'Clinician') {
    const upcomingCount = appointments.filter(
      (a) => a.appointmentDate >= today && (a.status === 'Scheduled' || a.status === 'Confirmed')
    ).length;
    const missedCount = appointments.filter((a) => a.status === 'Missed').length;
    const distinctPatients = new Set(appointments.map((a) => a.patientId)).size;

    responsibilities.push(
      {
        id: 'dept-coverage',
        title: `${staff.department} Clinical Scheduling Coverage`,
        scope: `Primary assigned clinician for ${staff.specialty || staff.department} outpatient clinic slots (${staff.defaultAppointmentDuration ?? 30}-minute default intervals, capacity ${staff.maxDailyCapacity ?? 16}/day).`,
        metricLabel: 'Active Caseload',
        metricValue: `${distinctPatients} patient${distinctPatients === 1 ? '' : 's'}`,
      },
      {
        id: 'upcoming-visits',
        title: 'Assigned Outpatient Appointments',
        scope: 'Confirmed and scheduled appointments verified against clinician conflict and break rules.',
        metricLabel: 'Upcoming Visits',
        metricValue: `${upcomingCount} visit${upcomingCount === 1 ? '' : 's'}`,
      },
      {
        id: 'missed-outreach',
        title: 'Missed Visit Review & Rebooking Coordination',
        scope: 'Coordinate with front-desk administrators when scheduled patients miss appointments.',
        metricLabel: 'Missed Visits',
        metricValue: `${missedCount} on file`,
      }
    );
  } else if (staff.role === 'Administrator') {
    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM patients WHERE clinic_id = ?) AS patient_count,
           (SELECT COUNT(*) FROM appointments WHERE clinic_id = ? AND status = 'Scheduled' AND appointment_date >= ?) AS unconfirmed_count,
           (SELECT COUNT(*) FROM followups WHERE clinic_id = ? AND status IN ('Pending', 'Scheduled', 'Due', 'Overdue')) AS open_followups`
      )
      .get(clinicId, clinicId, today, clinicId) as {
        patient_count: number;
        unconfirmed_count: number;
        open_followups: number;
      };

    responsibilities.push(
      {
        id: 'admin-write-access',
        title: 'Full Administrative Read & Write Authority',
        scope: 'Authorized to register/edit clinic patients, approve doctor credentials, allocate appointments, manage follow-up queues, and update staff profiles.',
        metricLabel: 'Access Tier',
        metricValue: 'Clinic Administrator',
      },
      {
        id: 'patient-oversight',
        title: 'Patient Directory & Verification Oversight',
        scope: 'Maintain accurate clinic patient demographics and portal verification statuses.',
        metricLabel: 'Directory Size',
        metricValue: `${counts.patient_count} records`,
      },
      {
        id: 'queue-management',
        title: 'Confirmation & Follow-up Queue Governance',
        scope: 'Approve assistant-proposed reschedules and outreach task batches.',
        metricLabel: 'Open Follow-ups',
        metricValue: `${counts.open_followups} open · ${counts.unconfirmed_count} unconfirmed`,
      }
    );
  } else if (staff.role === 'Coordinator') {
    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM appointments WHERE clinic_id = ? AND status = 'Scheduled' AND appointment_date >= ?) AS unconfirmed_count,
           (SELECT COUNT(*) FROM followups WHERE clinic_id = ? AND status IN ('Pending', 'Scheduled', 'Due', 'Overdue')) AS open_followups`
      )
      .get(clinicId, today, clinicId) as { unconfirmed_count: number; open_followups: number };

    responsibilities.push(
      {
        id: 'front-desk-intake',
        title: 'Front-Desk Intake & Appointment Confirmation',
        scope: 'Coordinate patient check-ins, confirmation reminders, and schedule slot readiness.',
        metricLabel: 'Unconfirmed Upcoming',
        metricValue: `${counts.unconfirmed_count} visits`,
      },
      {
        id: 'followup-outreach',
        title: 'Administrative Follow-up Outreach',
        scope: 'Track missed-visit rescheduling tasks and pre-visit administrative document checks.',
        metricLabel: 'Open Tasks',
        metricValue: `${counts.open_followups} tasks`,
      }
    );
  } else {
    responsibilities.push({
      id: 'readonly-oversight',
      title: 'Read-Only Operational Monitoring',
      scope: 'View live clinic dashboards, appointment schedules, patient directories, and operational reports without write permissions.',
      metricLabel: 'Access Tier',
      metricValue: 'Read-Only Staff',
    });
  }

  return responsibilities;
}

export function getStaffDetail(
  db: DatabaseSync,
  staffId: string,
  options?: { clinicId?: string; isAdministrator?: boolean; canViewAuditHistory?: boolean }
): StaffDetail {
  const clinicId = options?.clinicId ?? DEFAULT_DEMO_CLINIC_ID;
  const staff = getStaffById(db, staffId, clinicId);
  const appointments =
    staff.role === 'Clinician'
      ? listAppointments(db, { clinicId, clinician: staff.fullName })
      : [];
  const today = getClinicTodayDate();
  const currentTime = getClinicCurrentTime();

  const schedules = (
    db
      .prepare(
        `SELECT * FROM doctor_schedules WHERE clinic_id = ? AND staff_id = ? ORDER BY day_of_week ASC`
      )
      .all(clinicId, staff.id) as unknown as ScheduleRow[]
  ).map(mapScheduleRow);

  const unavailability = (
    db
      .prepare(
        `SELECT * FROM doctor_unavailability WHERE clinic_id = ? AND staff_id = ? ORDER BY start_date DESC, created_at DESC`
      )
      .all(clinicId, staff.id) as unknown as UnavailabilityRow[]
  ).map(mapUnavailabilityRow);

  const todaySchedule = schedules.find((s) => s.dayOfWeek === new Date().getDay()) ?? null;
  const effectiveOperationalState =
    staff.role === 'Clinician'
      ? deriveDoctorOperationalState({
          doctor: staff,
          todayDate: today,
          currentTime,
          todaySchedule,
          todayAppointments: appointments.filter((a) => a.appointmentDate === today),
          unavailability,
        })
      : staff.attendanceStatus;

  const upcomingCount = appointments.filter(
    (a) => a.appointmentDate >= today && (a.status === 'Scheduled' || a.status === 'Confirmed')
  ).length;
  const completedCount = appointments.filter((a) => a.status === 'Completed').length;

  const isAdministrator = Boolean(options?.isAdministrator);
  const canViewAuditHistory = options?.canViewAuditHistory ?? isAdministrator;
  const activity = canViewAuditHistory
    ? listAuditLogsForStaff(
        db,
        clinicId,
        staff.id,
        staff.fullName,
        appointments.map((a) => a.id),
        50
      )
    : [];

  return {
    ...staff,
    effectiveOperationalState,
    assignedAppointmentsCount: appointments.length,
    upcomingAppointmentsCount: upcomingCount,
    completedAppointmentsCount: completedCount,
    appointments,
    schedules,
    unavailability,
    responsibilities: buildResponsibilitiesForStaff(db, clinicId, staff, appointments),
    activity,
    permissions: {
      canEditProfile: isAdministrator,
      canViewAuditHistory,
    },
  };
}

export interface UpdateStaffInput {
  role?: StaffRole;
  department?: string;
  specialty?: string;
  qualifications?: string;
  licenseNumber?: string;
  bio?: string;
  email?: string;
  contactNumber?: string;
  status?: StaffStatus;
  attendanceStatus?: DoctorDutyStatus;
  defaultAppointmentDuration?: number;
  maxDailyCapacity?: number;
}

export function updateStaffMember(
  db: DatabaseSync,
  staffId: string,
  patch: UpdateStaffInput,
  actor = 'Clinic Administrator',
  clinicId = DEFAULT_DEMO_CLINIC_ID
): StaffMember {
  const existing = getStaffById(db, staffId, clinicId);

  const nextRole: StaffRole = patch.role ?? existing.role;
  const nextDepartment =
    patch.department !== undefined ? patch.department.trim() : existing.department;
  const nextSpecialty =
    patch.specialty !== undefined ? patch.specialty.trim() : existing.specialty;
  const nextQualifications =
    patch.qualifications !== undefined ? patch.qualifications.trim() : (existing.qualifications ?? '');
  const nextLicense =
    patch.licenseNumber !== undefined ? patch.licenseNumber.trim() : (existing.licenseNumber ?? '');
  const nextBio = patch.bio !== undefined ? patch.bio.trim() : (existing.bio ?? '');
  const nextEmail = patch.email !== undefined ? patch.email.trim() : existing.email;
  const nextContact =
    patch.contactNumber !== undefined ? patch.contactNumber.trim() : existing.contactNumber;
  const nextStatus: StaffStatus = patch.status ?? existing.status;
  const nextAttendance: DoctorDutyStatus =
    patch.attendanceStatus ?? existing.attendanceStatus ?? 'On Duty';
  const nextDuration =
    patch.defaultAppointmentDuration !== undefined
      ? Math.min(120, Math.max(15, Number(patch.defaultAppointmentDuration) || 30))
      : (existing.defaultAppointmentDuration ?? 30);
  const nextCapacity =
    patch.maxDailyCapacity !== undefined
      ? Math.min(48, Math.max(1, Number(patch.maxDailyCapacity) || 16))
      : (existing.maxDailyCapacity ?? 16);

  if (!VALID_STAFF_ROLES.has(nextRole)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid staff role.');
  }
  if (!nextDepartment) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Department is required.');
  }
  if (nextEmail && !isValidEmail(nextEmail)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please provide a valid email address.');
  }
  if (nextContact && nextContact.length < 7) {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      'Contact number must be at least 7 characters when provided.'
    );
  }
  if (!VALID_STAFF_STATUSES.has(nextStatus)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid staff employment status.');
  }

  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE staff
    SET role = ?,
        department = ?,
        specialty = ?,
        qualifications = ?,
        license_number = ?,
        bio = ?,
        email = ?,
        contact_number = ?,
        status = ?,
        attendance_status = ?,
        default_appointment_duration = ?,
        max_daily_capacity = ?,
        updated_at = ?
    WHERE id = ? AND clinic_id = ?
  `).run(
    nextRole,
    nextDepartment,
    nextSpecialty,
    nextQualifications,
    nextLicense,
    nextBio,
    nextEmail,
    nextContact,
    nextStatus,
    nextAttendance,
    nextDuration,
    nextCapacity,
    updatedAt,
    staffId,
    clinicId
  );

  recordAuditEvent(db, {
    clinicId,
    actor,
    action: 'UPDATE_STAFF',
    resourceType: 'staff',
    resourceId: staffId,
    summary: `Updated staff profile ${existing.fullName} (${staffId}) · ${nextRole} · ${nextDepartment} · Status: ${nextStatus}.`,
  });

  return getStaffById(db, staffId, clinicId);
}
