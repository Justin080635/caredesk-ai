import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AccountSessionState,
  Appointment,
  AppointmentType,
  AuthUserProfile,
  ClinicWorkspace,
  Patient,
  PatientHomeData,
  PatientLinkRequest,
  PatientPortalHealthData,
  PrescriptionItem,
  TestResultItem,
} from '../../shared/types';
import {
  addDaysToDateString,
  getClinicTodayDate,
  isValidDateString,
  isValidEmail,
  isValidTimeString,
} from '../domain/rules';
import { syncAuthenticatedUser } from './accountService';
import {
  checkAppointmentAvailability,
  createAppointment,
  getAppointmentById,
  listAppointments,
} from './appointmentService';
import { recordAuditEvent } from './auditService';
import { listConsultationsForPatient } from './doctorService';
import { listFollowups } from './followupService';
import {
  createNotification,
  listNotificationsForUser,
  notifyClinicAdmins,
} from './notificationService';
import {
  generateNextPatientId,
  getPatientById,
  ServiceError,
} from './patientService';

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

function hashClaimCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

function generateReadableClaimCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `CD-${out}`;
}

function mapLinkRequestRow(row: Record<string, unknown>): PatientLinkRequest {
  return {
    id: String(row.id),
    clinicId: String(row.clinic_id),
    clinicName: row.clinic_name ? String(row.clinic_name) : undefined,
    userId: String(row.user_id),
    fullName: String(row.full_name),
    email: String(row.email),
    phoneNumber: String(row.phone_number ?? ''),
    dateOfBirth: String(row.date_of_birth),
    notes: String(row.notes ?? ''),
    status: row.status as PatientLinkRequest['status'],
    linkedPatientId: (row.linked_patient_id as string | null) ?? null,
    reviewedByUserId: (row.reviewed_by_user_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ============================================================================
// Secure Verified Patient Linking (Claim Code + DOB or Admin Approval)
// ============================================================================

export function generatePatientClaimCode(
  db: DatabaseSync,
  clinicId: string,
  patientId: string,
  actor: string
): { patientId: string; claimCode: string; expiresAt: string } {
  const patient = getPatientById(db, patientId, clinicId);
  const claimCode = generateReadableClaimCode();
  const hash = hashClaimCode(claimCode);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    UPDATE patients
    SET claim_code_hash = ?, claim_code_expires_at = ?
    WHERE id = ? AND clinic_id = ?
  `).run(hash, expiresAt, patient.id, clinicId);

  recordAuditEvent(db, {
    clinicId,
    actor,
    action: 'GENERATE_PATIENT_CLAIM_CODE',
    resourceType: 'patient_link',
    resourceId: patient.id,
    summary: `Generated a 7-day Patient Portal claim code for ${patient.fullName} (${patient.id}).`,
  });

  return { patientId: patient.id, claimCode, expiresAt };
}

export function claimPatientRecord(
  db: DatabaseSync,
  user: AuthUserProfile,
  input: {
    clinicId: string;
    claimCode: string;
    dateOfBirth: string;
  }
): AccountSessionState {
  const clinicId = (input.clinicId ?? '').trim();
  const claimCode = (input.claimCode ?? '').trim().toUpperCase();
  const dateOfBirth = (input.dateOfBirth ?? '').trim();

  if (!clinicId) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please select your clinic.');
  }
  if (!claimCode || claimCode.length < 6) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Enter the valid claim code provided by your clinic.');
  }
  if (!isValidDateString(dateOfBirth)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Enter your date of birth in YYYY-MM-DD format.');
  }

  const hash = hashClaimCode(claimCode);
  const row = db
    .prepare(
      `SELECT id, full_name, date_of_birth, linked_user_id, claim_code_expires_at
       FROM patients
       WHERE clinic_id = ? AND claim_code_hash = ? AND date_of_birth = ?
       LIMIT 1`
    )
    .get(clinicId, hash, dateOfBirth) as
    | {
        id: string;
        full_name: string;
        date_of_birth: string;
        linked_user_id: string | null;
        claim_code_expires_at: string;
      }
    | undefined;

  if (!row) {
    throw new ServiceError(
      403,
      'CLAIM_VERIFICATION_FAILED',
      'Invalid claim code or date of birth for the selected clinic.'
    );
  }
  if (!row.claim_code_expires_at || row.claim_code_expires_at < new Date().toISOString()) {
    throw new ServiceError(
      403,
      'CLAIM_CODE_EXPIRED',
      'This claim code has expired. Please request a fresh code from your clinic.'
    );
  }
  if (row.linked_user_id && row.linked_user_id !== user.id) {
    throw new ServiceError(
      409,
      'PATIENT_ALREADY_LINKED',
      'This patient record is already linked to another portal account.'
    );
  }

  const existingLinkedInClinic = db
    .prepare('SELECT id FROM patients WHERE clinic_id = ? AND linked_user_id = ? AND id != ?')
    .get(clinicId, user.id, row.id) as { id: string } | undefined;
  if (existingLinkedInClinic) {
    throw new ServiceError(
      409,
      'USER_ALREADY_LINKED',
      'Your account is already linked to a patient record in this clinic.'
    );
  }

  const nowIso = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`
      UPDATE patients
      SET linked_user_id = ?,
          portal_linked_at = ?,
          claim_code_hash = '',
          claim_code_expires_at = ''
      WHERE id = ? AND clinic_id = ?
    `).run(user.id, nowIso, row.id, clinicId);

    const existingMembership = db
      .prepare('SELECT id FROM clinic_memberships WHERE clinic_id = ? AND user_id = ?')
      .get(clinicId, user.id) as { id: string } | undefined;

    if (!existingMembership) {
      const mbrId = generatePrefixedId(db, 'clinic_memberships', 'MBR', 1000);
      db.prepare(`
        INSERT INTO clinic_memberships (id, clinic_id, user_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'Patient', 'Active', ?, ?)
      `).run(mbrId, clinicId, user.id, nowIso, nowIso);
    }

    createNotification(db, {
      clinicId,
      userId: user.id,
      patientId: row.id,
      title: 'Patient Portal Linked',
      message: `Your account is now verified and linked to patient record ${row.id}.`,
      kind: 'verification',
      relatedType: 'patient_link',
      relatedId: row.id,
    });

    recordAuditEvent(db, {
      clinicId,
      actor: `${user.fullName} (Patient)`,
      action: 'CLAIM_PATIENT_PORTAL_RECORD',
      resourceType: 'patient_link',
      resourceId: row.id,
      summary: `User ${user.email} redeemed a verified claim code + DOB to link patient record ${row.id}.`,
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return syncAuthenticatedUser(db, {
    firebaseUid: user.firebaseUid,
    email: user.email,
    requestedClinicId: clinicId,
  });
}

export function submitPatientLinkRequest(
  db: DatabaseSync,
  user: AuthUserProfile,
  input: {
    clinicId: string;
    fullName?: string;
    phoneNumber?: string;
    dateOfBirth: string;
    notes?: string;
  }
): PatientLinkRequest {
  const clinicId = (input.clinicId ?? '').trim();
  const fullName = (input.fullName ?? user.fullName).trim();
  const phoneNumber = (input.phoneNumber ?? user.phoneNumber).trim();
  const dateOfBirth = (input.dateOfBirth ?? '').trim();
  const notes = (input.notes ?? '').trim();

  if (!clinicId) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please select the clinic to request access from.');
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
  if (!isValidDateString(dateOfBirth)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Date of birth must use YYYY-MM-DD format.');
  }

  const alreadyPending = db
    .prepare(
      `SELECT id FROM patient_link_requests WHERE clinic_id = ? AND user_id = ? AND status = 'Pending'`
    )
    .get(clinicId, user.id) as { id: string } | undefined;
  if (alreadyPending) {
    throw new ServiceError(
      409,
      'LINK_REQUEST_PENDING',
      `You already have a pending verification request with ${clinic.name}.`
    );
  }

  const id = generatePrefixedId(db, 'patient_link_requests', 'PLR', 1000);
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO patient_link_requests (
      id, clinic_id, user_id, full_name, email, phone_number, date_of_birth,
      notes, status, linked_patient_id, reviewed_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', NULL, NULL, ?, ?)
  `).run(id, clinicId, user.id, fullName, user.email, phoneNumber, dateOfBirth, notes, nowIso, nowIso);

  notifyClinicAdmins(db, {
    clinicId,
    title: 'Patient Portal Link Request',
    message: `${fullName} (DOB ${dateOfBirth}) requested verified Patient Portal access.`,
    kind: 'verification',
    relatedType: 'patient_link',
    relatedId: id,
  });

  recordAuditEvent(db, {
    clinicId,
    actor: fullName,
    action: 'SUBMIT_PATIENT_LINK_REQUEST',
    resourceType: 'patient_link',
    resourceId: id,
    summary: `${fullName} (${user.email}) submitted a Patient Portal verification request awaiting clinic administrator approval.`,
  });

  const saved = db
    .prepare(
      `SELECT r.*, c.name AS clinic_name FROM patient_link_requests r LEFT JOIN clinics c ON c.id = r.clinic_id WHERE r.id = ?`
    )
    .get(id) as Record<string, unknown>;
  return mapLinkRequestRow(saved);
}

export function listPatientLinkRequests(
  db: DatabaseSync,
  clinicId: string,
  status?: string
): PatientLinkRequest[] {
  const clauses = ['r.clinic_id = ?'];
  const params: string[] = [clinicId];
  if (status && status !== 'All') {
    clauses.push('r.status = ?');
    params.push(status);
  }
  const rows = db
    .prepare(
      `SELECT r.*, c.name AS clinic_name
       FROM patient_link_requests r
       LEFT JOIN clinics c ON c.id = r.clinic_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY CASE r.status WHEN 'Pending' THEN 0 WHEN 'Approved' THEN 1 ELSE 2 END, r.created_at DESC`
    )
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapLinkRequestRow);
}

export function approvePatientLinkRequest(
  db: DatabaseSync,
  clinicId: string,
  requestId: string,
  adminUser: AuthUserProfile,
  options?: { existingPatientId?: string }
): { request: PatientLinkRequest; patient: Patient } {
  const row = db
    .prepare(`SELECT * FROM patient_link_requests WHERE id = ? AND clinic_id = ?`)
    .get(requestId, clinicId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ServiceError(404, 'LINK_REQUEST_NOT_FOUND', 'Patient link request not found.');
  }
  if (row.status !== 'Pending') {
    throw new ServiceError(409, 'LINK_REQUEST_ALREADY_REVIEWED', 'Link request has already been reviewed.');
  }

  const reqUserId = String(row.user_id);
  const fullName = String(row.full_name);
  const email = String(row.email);
  const phone = String(row.phone_number ?? '');
  const dob = String(row.date_of_birth);
  const nowIso = new Date().toISOString();
  const today = getClinicTodayDate();
  let linkedPatientId = '';

  db.exec('BEGIN IMMEDIATE;');
  try {
    if (options?.existingPatientId?.trim()) {
      const existing = db
        .prepare('SELECT id, linked_user_id FROM patients WHERE id = ? AND clinic_id = ?')
        .get(options.existingPatientId.trim(), clinicId) as
        | { id: string; linked_user_id: string | null }
        | undefined;
      if (!existing) {
        throw new ServiceError(
          404,
          'PATIENT_NOT_FOUND',
          `Patient ${options.existingPatientId} was not found in this clinic.`
        );
      }
      if (existing.linked_user_id && existing.linked_user_id !== reqUserId) {
        throw new ServiceError(
          409,
          'PATIENT_ALREADY_LINKED',
          `Patient ${existing.id} is already linked to another user account.`
        );
      }
      linkedPatientId = existing.id;
      db.prepare(`
        UPDATE patients
        SET linked_user_id = ?, portal_linked_at = ?, administrative_status = 'Active'
        WHERE id = ? AND clinic_id = ?
      `).run(reqUserId, nowIso, linkedPatientId, clinicId);
    } else {
      linkedPatientId = generateNextPatientId(db);
      db.prepare(`
        INSERT INTO patients (
          id, clinic_id, full_name, date_of_birth, contact_number, email,
          registration_date, administrative_status, linked_user_id, portal_linked_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)
      `).run(
        linkedPatientId,
        clinicId,
        fullName,
        dob,
        phone || '000-000-0000',
        email,
        today,
        reqUserId,
        nowIso,
        nowIso
      );
    }

    db.prepare(`
      UPDATE patient_link_requests
      SET status = 'Approved', linked_patient_id = ?, reviewed_by_user_id = ?, updated_at = ?
      WHERE id = ? AND clinic_id = ?
    `).run(linkedPatientId, adminUser.id, nowIso, requestId, clinicId);

    const existingMembership = db
      .prepare('SELECT id FROM clinic_memberships WHERE clinic_id = ? AND user_id = ?')
      .get(clinicId, reqUserId) as { id: string } | undefined;

    if (!existingMembership) {
      const mbrId = generatePrefixedId(db, 'clinic_memberships', 'MBR', 1000);
      db.prepare(`
        INSERT INTO clinic_memberships (id, clinic_id, user_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'Patient', 'Active', ?, ?)
      `).run(mbrId, clinicId, reqUserId, nowIso, nowIso);
    }

    createNotification(db, {
      clinicId,
      userId: reqUserId,
      patientId: linkedPatientId,
      title: 'Patient Portal Access Approved',
      message: `Your Patient Portal access request was approved and linked to patient ID ${linkedPatientId}.`,
      kind: 'verification',
      relatedType: 'patient_link',
      relatedId: linkedPatientId,
    });

    recordAuditEvent(db, {
      clinicId,
      actor: `${adminUser.fullName} (Clinic Administrator)`,
      action: 'APPROVE_PATIENT_LINK_REQUEST',
      resourceType: 'patient_link',
      resourceId: requestId,
      summary: `Approved patient link request ${requestId} for ${fullName} -> patient ${linkedPatientId}.`,
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  const updatedReq = db
    .prepare(
      `SELECT r.*, c.name AS clinic_name FROM patient_link_requests r LEFT JOIN clinics c ON c.id = r.clinic_id WHERE r.id = ?`
    )
    .get(requestId) as Record<string, unknown>;

  return {
    request: mapLinkRequestRow(updatedReq),
    patient: getPatientById(db, linkedPatientId, clinicId),
  };
}

export function rejectPatientLinkRequest(
  db: DatabaseSync,
  clinicId: string,
  requestId: string,
  adminUser: AuthUserProfile,
  reason = 'Identity verification details could not be matched.'
): PatientLinkRequest {
  const row = db
    .prepare(`SELECT * FROM patient_link_requests WHERE id = ? AND clinic_id = ?`)
    .get(requestId, clinicId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ServiceError(404, 'LINK_REQUEST_NOT_FOUND', 'Patient link request not found.');
  }
  if (row.status !== 'Pending') {
    throw new ServiceError(409, 'LINK_REQUEST_ALREADY_REVIEWED', 'Link request has already been reviewed.');
  }

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE patient_link_requests
    SET status = 'Rejected', reviewed_by_user_id = ?, notes = ?, updated_at = ?
    WHERE id = ? AND clinic_id = ?
  `).run(adminUser.id, reason, nowIso, requestId, clinicId);

  createNotification(db, {
    clinicId,
    userId: String(row.user_id),
    title: 'Patient Portal Verification Update',
    message: `Your Patient Portal verification request was declined: ${reason}`,
    kind: 'verification',
    relatedType: 'patient_link',
    relatedId: requestId,
  });

  recordAuditEvent(db, {
    clinicId,
    actor: `${adminUser.fullName} (Clinic Administrator)`,
    action: 'REJECT_PATIENT_LINK_REQUEST',
    resourceType: 'patient_link',
    resourceId: requestId,
    summary: `Rejected patient link request ${requestId} for ${String(row.full_name)}: ${reason}`,
  });

  const updated = db
    .prepare(
      `SELECT r.*, c.name AS clinic_name FROM patient_link_requests r LEFT JOIN clinics c ON c.id = r.clinic_id WHERE r.id = ?`
    )
    .get(requestId) as Record<string, unknown>;
  return mapLinkRequestRow(updated);
}

// ============================================================================
// Strictly Patient-Scoped Portal Operations
// ============================================================================

export function getPatientHomeData(
  db: DatabaseSync,
  clinicId: string,
  clinic: ClinicWorkspace,
  patientId: string,
  userId: string
): PatientHomeData {
  const patient = getPatientById(db, patientId, clinicId);
  const today = getClinicTodayDate();
  const appointments = listAppointments(db, { clinicId, patientId });
  const upcomingAppointments = appointments
    .filter(
      (a) =>
        a.appointmentDate >= today && (a.status === 'Scheduled' || a.status === 'Confirmed')
    )
    .sort((a, b) =>
      `${a.appointmentDate} ${a.appointmentTime}`.localeCompare(
        `${b.appointmentDate} ${b.appointmentTime}`
      )
    );

  const consultations = listConsultationsForPatient(db, clinicId, patientId, {
    patientVisibleOnly: true,
  });
  const followups = listFollowups(db, { clinicId, patientId }).filter(
    (f) => f.status !== 'Completed' && f.status !== 'Cancelled'
  );
  const notifications = listNotificationsForUser(db, clinicId, userId, 50);
  const unreadNotificationsCount = notifications.filter((n) => !n.isRead).length;

  const deptRows = db
    .prepare(
      `SELECT DISTINCT department FROM staff WHERE clinic_id = ? AND role = 'Clinician' AND status = 'Active' ORDER BY department ASC`
    )
    .all(clinicId) as Array<{ department: string }>;

  return {
    patient,
    clinic,
    upcomingAppointments,
    nextAppointment: upcomingAppointments[0] ?? null,
    recentConsultationsCount: consultations.length,
    openFollowups: followups,
    unreadNotificationsCount,
    availableSpecialties: deptRows.map((d) => d.department),
  };
}

export function listPatientOwnAppointments(
  db: DatabaseSync,
  clinicId: string,
  patientId: string
): Appointment[] {
  return listAppointments(db, { clinicId, patientId });
}

export function bookPatientAppointment(
  db: DatabaseSync,
  clinicId: string,
  patientId: string,
  input: {
    staffId?: string;
    clinician?: string;
    department?: string;
    specialty?: string;
    appointmentType?: AppointmentType;
    appointmentDate: string;
    appointmentTime: string;
    notes?: string;
  },
  actor: string
): Appointment {
  const appointmentDate = (input.appointmentDate ?? '').trim();
  const appointmentTime = (input.appointmentTime ?? '').trim();
  const appointmentType: AppointmentType = input.appointmentType ?? 'Consultation';

  if (!isValidDateString(appointmentDate)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Appointment date must be YYYY-MM-DD.');
  }
  if (!isValidTimeString(appointmentTime)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Appointment time must be HH:MM.');
  }

  // Strictly verify the chosen slot is genuinely open in the doctor availability engine
  const openSlots = checkAppointmentAvailability(db, {
    clinicId,
    startDate: appointmentDate,
    daysCount: 1,
    staffId: input.staffId,
    clinician: input.clinician,
    department: input.department,
    specialty: input.specialty,
    patientId,
    appointmentType,
    limit: 60,
  });

  const matchedSlot = openSlots.find(
    (s) =>
      s.date === appointmentDate &&
      s.time === appointmentTime &&
      (!input.staffId || s.staffId === input.staffId)
  );

  if (!matchedSlot) {
    throw new ServiceError(
      409,
      'SLOT_NOT_AVAILABLE',
      'The selected time slot is no longer available. Please choose another open slot.'
    );
  }

  return createAppointment(
    db,
    {
      patientId,
      staffId: matchedSlot.staffId ?? input.staffId,
      clinician: matchedSlot.clinician,
      department: matchedSlot.department,
      specialty: matchedSlot.specialty,
      appointmentType,
      appointmentDate: matchedSlot.date,
      appointmentTime: matchedSlot.time,
      durationMinutes: matchedSlot.durationMinutes,
      status: 'Scheduled',
      requestedBy: 'patient',
      requestStatus: 'None',
      notes: (input.notes ?? '').trim() || 'Booked via Patient Portal',
    },
    actor,
    clinicId
  );
}

export function requestPatientReschedule(
  db: DatabaseSync,
  clinicId: string,
  patientId: string,
  appointmentId: string,
  input: { requestedDate: string; requestedTime: string; notes?: string },
  actor: string
): Appointment {
  const apt = getAppointmentById(db, appointmentId, clinicId);
  if (apt.patientId !== patientId) {
    throw new ServiceError(403, 'FORBIDDEN', 'You can only request changes for your own appointments.');
  }
  if (apt.status === 'Completed' || apt.status === 'Cancelled') {
    throw new ServiceError(
      409,
      'INVALID_APPOINTMENT_STATE',
      `Cannot request reschedule for a ${apt.status.toLowerCase()} appointment.`
    );
  }

  const requestedDate = (input.requestedDate ?? '').trim();
  const requestedTime = (input.requestedTime ?? '').trim();
  if (!isValidDateString(requestedDate) || !isValidTimeString(requestedTime)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Provide a valid requested date and time.');
  }

  const openSlots = checkAppointmentAvailability(db, {
    clinicId,
    startDate: requestedDate,
    daysCount: 1,
    staffId: apt.staffId ?? undefined,
    clinician: apt.clinician,
    patientId,
    appointmentType: apt.appointmentType,
    limit: 60,
  });

  if (!openSlots.some((s) => s.date === requestedDate && s.time === requestedTime)) {
    throw new ServiceError(
      409,
      'SLOT_NOT_AVAILABLE',
      `Requested slot ${requestedDate} at ${requestedTime} is not open for ${apt.clinician}.`
    );
  }

  const nowIso = new Date().toISOString();
  const reason = (input.notes ?? '').trim();
  const requestNotes = `Requested ${requestedDate} ${requestedTime}${reason ? ` — ${reason}` : ''}`;

  db.prepare(`
    UPDATE appointments
    SET request_status = 'Reschedule Requested',
        request_notes = ?,
        updated_at = ?
    WHERE id = ? AND clinic_id = ?
  `).run(requestNotes, nowIso, apt.id, clinicId);

  notifyClinicAdmins(db, {
    clinicId,
    title: 'Patient Reschedule Request',
    message: `${apt.patientName ?? patientId} requested to reschedule ${apt.id} (${apt.clinician}) to ${requestedDate} ${requestedTime}.`,
    kind: 'appointment',
    relatedType: 'appointment',
    relatedId: apt.id,
  });

  recordAuditEvent(db, {
    clinicId,
    actor,
    action: 'REQUEST_APPOINTMENT_RESCHEDULE',
    resourceType: 'appointment',
    resourceId: apt.id,
    summary: `Patient requested reschedule for ${apt.id} -> ${requestedDate} ${requestedTime}.`,
  });

  return getAppointmentById(db, apt.id, clinicId);
}

export function requestPatientCancellation(
  db: DatabaseSync,
  clinicId: string,
  patientId: string,
  appointmentId: string,
  notes: string,
  actor: string
): Appointment {
  const apt = getAppointmentById(db, appointmentId, clinicId);
  if (apt.patientId !== patientId) {
    throw new ServiceError(403, 'FORBIDDEN', 'You can only manage your own appointments.');
  }
  if (apt.status === 'Completed' || apt.status === 'Cancelled') {
    throw new ServiceError(
      409,
      'INVALID_APPOINTMENT_STATE',
      `Appointment is already ${apt.status.toLowerCase()}.`
    );
  }

  const nowIso = new Date().toISOString();
  const reason = (notes ?? '').trim() || 'Cancelled upon patient request via portal';

  db.prepare(`
    UPDATE appointments
    SET request_status = 'Cancellation Requested',
        request_notes = ?,
        updated_at = ?
    WHERE id = ? AND clinic_id = ?
  `).run(reason, nowIso, apt.id, clinicId);

  notifyClinicAdmins(db, {
    clinicId,
    title: 'Patient Cancellation Request',
    message: `${apt.patientName ?? patientId} requested cancellation of ${apt.id} on ${apt.appointmentDate} at ${apt.appointmentTime}.`,
    kind: 'appointment',
    relatedType: 'appointment',
    relatedId: apt.id,
  });

  recordAuditEvent(db, {
    clinicId,
    actor,
    action: 'REQUEST_APPOINTMENT_CANCELLATION',
    resourceType: 'appointment',
    resourceId: apt.id,
    summary: `Patient requested cancellation of ${apt.id}: ${reason}`,
  });

  return getAppointmentById(db, apt.id, clinicId);
}

export function getPatientOwnHealthData(
  db: DatabaseSync,
  clinicId: string,
  patientId: string
): PatientPortalHealthData {
  const patient = getPatientById(db, patientId, clinicId);
  const consultations = listConsultationsForPatient(db, clinicId, patientId, {
    patientVisibleOnly: true,
  });

  const prescriptions: Array<
    PrescriptionItem & { consultationId: string; consultationDate: string; doctorName: string }
  > = [];
  const testResults: Array<TestResultItem & { consultationId: string; doctorName: string }> = [];

  for (const c of consultations) {
    for (const rx of c.prescriptions) {
      prescriptions.push({
        ...rx,
        consultationId: c.id,
        consultationDate: c.consultationDate,
        doctorName: c.doctorName,
      });
    }
    for (const tr of c.testResults) {
      testResults.push({
        ...tr,
        consultationId: c.id,
        doctorName: c.doctorName,
      });
    }
  }

  const followups = listFollowups(db, { clinicId, patientId });

  return {
    patient,
    consultations,
    prescriptions,
    testResults,
    followups,
  };
}

export function updatePatientOwnProfile(
  db: DatabaseSync,
  clinicId: string,
  patientId: string,
  user: AuthUserProfile,
  patch: {
    contactNumber?: string;
    email?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
  }
): Patient {
  const existing = getPatientById(db, patientId, clinicId);
  const contactNumber =
    patch.contactNumber !== undefined ? patch.contactNumber.trim() : existing.contactNumber;
  const email = patch.email !== undefined ? patch.email.trim() : existing.email;
  const emergencyContactName =
    patch.emergencyContactName !== undefined
      ? patch.emergencyContactName.trim()
      : (existing.emergencyContactName ?? '');
  const emergencyContactPhone =
    patch.emergencyContactPhone !== undefined
      ? patch.emergencyContactPhone.trim()
      : (existing.emergencyContactPhone ?? '');

  if (contactNumber.length < 7) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Phone number must be at least 7 characters.');
  }
  if (!isValidEmail(email)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please enter a valid email address.');
  }
  if (emergencyContactPhone && emergencyContactPhone.length < 7) {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      'Emergency contact phone must be at least 7 characters when provided.'
    );
  }

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE patients
    SET contact_number = ?, email = ?, emergency_contact_name = ?, emergency_contact_phone = ?
    WHERE id = ? AND clinic_id = ? AND linked_user_id = ?
  `).run(
    contactNumber,
    email,
    emergencyContactName,
    emergencyContactPhone,
    patientId,
    clinicId,
    user.id
  );

  db.prepare(`UPDATE users SET phone_number = ?, updated_at = ? WHERE id = ?`).run(
    contactNumber,
    nowIso,
    user.id
  );

  recordAuditEvent(db, {
    clinicId,
    actor: `${existing.fullName} (Patient)`,
    action: 'UPDATE_PATIENT_SELF_PROFILE',
    resourceType: 'patient',
    resourceId: patientId,
    summary: `Patient ${existing.fullName} (${patientId}) updated portal contact and emergency contact information.`,
  });

  return getPatientById(db, patientId, clinicId);
}

// Keep addDaysToDateString imported cleanly if needed by tests/helpers
export { addDaysToDateString };
