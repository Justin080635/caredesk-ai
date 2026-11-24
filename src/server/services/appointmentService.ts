import type { DatabaseSync } from 'node:sqlite';
import type { Appointment, AppointmentStatus, AvailableSlot } from '../../shared/types';
import {
  addDaysToDateString,
  computeAvailableSlots,
  findAppointmentConflict,
  getClinicTodayDate,
  isValidDateString,
  isValidTimeString,
} from '../domain/rules';
import { recordAuditEvent } from './auditService';
import { ServiceError } from './patientService';

interface AppointmentRow {
  id: string;
  patient_id: string;
  patient_name: string;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: number;
  department: string;
  clinician: string;
  status: AppointmentStatus;
  notes: string;
  created_at: string;
  updated_at: string;
}

const VALID_APPOINTMENT_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'Scheduled',
  'Confirmed',
  'Completed',
  'Cancelled',
  'Missed',
]);

function mapAppointmentRow(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    appointmentDate: row.appointment_date,
    appointmentTime: row.appointment_time,
    durationMinutes: row.duration_minutes,
    department: row.department,
    clinician: row.clinician,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BASE_SELECT = `
  SELECT
    a.id,
    a.patient_id,
    p.full_name AS patient_name,
    a.appointment_date,
    a.appointment_time,
    a.duration_minutes,
    a.department,
    a.clinician,
    a.status,
    a.notes,
    a.created_at,
    a.updated_at
  FROM appointments a
  INNER JOIN patients p ON p.id = a.patient_id
`;

export function listAppointments(
  db: DatabaseSync,
  filters?: {
    date?: string;
    status?: string;
    department?: string;
    patientId?: string;
    clinician?: string;
    search?: string;
  }
): Appointment[] {
  const conditions: string[] = [];
  const params: Array<string> = [];

  if (filters?.date && filters.date.trim().length > 0) {
    conditions.push('a.appointment_date = ?');
    params.push(filters.date.trim());
  }
  if (filters?.status && filters.status !== 'All') {
    conditions.push('a.status = ?');
    params.push(filters.status);
  }
  if (filters?.department && filters.department !== 'All') {
    conditions.push('a.department = ?');
    params.push(filters.department);
  }
  if (filters?.patientId && filters.patientId.trim().length > 0) {
    conditions.push('a.patient_id = ?');
    params.push(filters.patientId.trim());
  }
  if (filters?.clinician && filters.clinician !== 'All') {
    conditions.push('a.clinician = ?');
    params.push(filters.clinician);
  }
  if (filters?.search && filters.search.trim().length > 0) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      '(LOWER(a.id) LIKE ? OR LOWER(a.patient_id) LIKE ? OR LOWER(p.full_name) LIKE ? OR LOWER(a.clinician) LIKE ? OR LOWER(a.department) LIKE ?)'
    );
    params.push(q, q, q, q, q);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `${BASE_SELECT}
       ${whereClause}
       ORDER BY a.appointment_date ASC, a.appointment_time ASC`
    )
    .all(...params) as unknown as AppointmentRow[];

  return rows.map(mapAppointmentRow);
}

export function getAppointmentById(db: DatabaseSync, appointmentId: string): Appointment {
  const row = db
    .prepare(`${BASE_SELECT} WHERE a.id = ?`)
    .get(appointmentId) as AppointmentRow | undefined;

  if (!row) {
    throw new ServiceError(404, 'APPOINTMENT_NOT_FOUND', `Appointment ${appointmentId} was not found.`);
  }
  return mapAppointmentRow(row);
}

export function getTodaysAppointments(db: DatabaseSync, referenceToday?: string): Appointment[] {
  const today = referenceToday ?? getClinicTodayDate();
  return listAppointments(db, { date: today });
}

export function getMissedAppointments(
  db: DatabaseSync,
  options?: { days?: number; referenceToday?: string }
): Appointment[] {
  const today = options?.referenceToday ?? getClinicTodayDate();
  const days = Math.min(Math.max(1, Number(options?.days) || 7), 90);
  const startDate = addDaysToDateString(today, -(days - 1));

  const rows = db
    .prepare(
      `${BASE_SELECT}
       WHERE a.status = 'Missed'
         AND a.appointment_date >= ?
         AND a.appointment_date <= ?
       ORDER BY a.appointment_date DESC, a.appointment_time DESC`
    )
    .all(startDate, today) as unknown as AppointmentRow[];

  return rows.map(mapAppointmentRow);
}

export function getUnconfirmedAppointments(db: DatabaseSync, referenceToday?: string): Appointment[] {
  const today = referenceToday ?? getClinicTodayDate();
  const rows = db
    .prepare(
      `${BASE_SELECT}
       WHERE a.status = 'Scheduled'
         AND a.appointment_date >= ?
       ORDER BY a.appointment_date ASC, a.appointment_time ASC`
    )
    .all(today) as unknown as AppointmentRow[];

  return rows.map(mapAppointmentRow);
}

export function checkAppointmentAvailability(
  db: DatabaseSync,
  options?: {
    startDate?: string;
    daysCount?: number;
    department?: string;
    clinician?: string;
    patientId?: string;
    limit?: number;
  }
): AvailableSlot[] {
  const startDate = options?.startDate && isValidDateString(options.startDate)
    ? options.startDate
    : getClinicTodayDate();

  const existing = listAppointments(db);
  return computeAvailableSlots(existing, {
    startDate,
    daysCount: options?.daysCount ?? 5,
    department: options?.department,
    clinician: options?.clinician,
    patientId: options?.patientId,
    limit: options?.limit ?? 12,
  });
}

function generateNextAppointmentId(db: DatabaseSync): string {
  const rows = db.prepare('SELECT id FROM appointments').all() as Array<{ id: string }>;
  let maxNum = 2000;
  for (const r of rows) {
    const match = /^APT-(\d+)$/.exec(r.id);
    if (match) {
      const n = Number(match[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `APT-${maxNum + 1}`;
}

export interface CreateAppointmentInput {
  patientId: string;
  appointmentDate: string;
  appointmentTime: string;
  durationMinutes?: number;
  department: string;
  clinician: string;
  status?: AppointmentStatus;
  notes?: string;
}

export function createAppointment(
  db: DatabaseSync,
  input: CreateAppointmentInput,
  actor = 'Clinic Administrator'
): Appointment {
  const patientId = (input.patientId ?? '').trim();
  const appointmentDate = (input.appointmentDate ?? '').trim();
  const appointmentTime = (input.appointmentTime ?? '').trim();
  const department = (input.department ?? '').trim();
  const clinician = (input.clinician ?? '').trim();
  const durationMinutes = Number(input.durationMinutes) || 30;
  const status: AppointmentStatus = input.status ?? 'Scheduled';
  const notes = (input.notes ?? '').trim();

  if (!patientId) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Patient ID is required.');
  }
  const patientExists = db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId);
  if (!patientExists) {
    throw new ServiceError(404, 'PATIENT_NOT_FOUND', `Patient ${patientId} does not exist.`);
  }
  if (!isValidDateString(appointmentDate)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Appointment date must be a valid YYYY-MM-DD date.');
  }
  if (!isValidTimeString(appointmentTime)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Appointment time must be in HH:MM (24-hour) format.');
  }
  if (!department) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Department is required.');
  }
  if (!clinician) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Assigned clinician is required.');
  }
  if (!VALID_APPOINTMENT_STATUSES.has(status)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid appointment status.');
  }

  const allAppointments = listAppointments(db, { date: appointmentDate });
  const conflict = findAppointmentConflict(allAppointments, {
    patientId,
    appointmentDate,
    appointmentTime,
    durationMinutes,
    clinician,
  });

  if (conflict.hasConflict) {
    throw new ServiceError(409, 'SCHEDULING_CONFLICT', conflict.reason ?? 'Scheduling conflict detected.', {
      conflictingAppointmentId: conflict.conflictingAppointmentId,
    });
  }

  const id = generateNextAppointmentId(db);
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO appointments (
      id, patient_id, appointment_date, appointment_time, duration_minutes,
      department, clinician, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    patientId,
    appointmentDate,
    appointmentTime,
    durationMinutes,
    department,
    clinician,
    status,
    notes,
    nowIso,
    nowIso
  );

  recordAuditEvent(db, {
    actor,
    action: 'CREATE_APPOINTMENT',
    resourceType: 'appointment',
    resourceId: id,
    summary: `Scheduled ${department} appointment ${id} for ${patientId} with ${clinician} on ${appointmentDate} at ${appointmentTime}.`,
  });

  return getAppointmentById(db, id);
}

export interface UpdateAppointmentInput {
  appointmentDate?: string;
  appointmentTime?: string;
  durationMinutes?: number;
  department?: string;
  clinician?: string;
  status?: AppointmentStatus;
  notes?: string;
}

export function updateAppointment(
  db: DatabaseSync,
  appointmentId: string,
  patch: UpdateAppointmentInput,
  actor = 'Clinic Administrator'
): Appointment {
  const existing = getAppointmentById(db, appointmentId);

  const nextDate = patch.appointmentDate?.trim() ?? existing.appointmentDate;
  const nextTime = patch.appointmentTime?.trim() ?? existing.appointmentTime;
  const nextDuration = patch.durationMinutes !== undefined ? Number(patch.durationMinutes) : existing.durationMinutes;
  const nextDepartment = patch.department?.trim() ?? existing.department;
  const nextClinician = patch.clinician?.trim() ?? existing.clinician;
  const nextStatus = patch.status ?? existing.status;
  const nextNotes = patch.notes !== undefined ? patch.notes.trim() : existing.notes;

  if (!isValidDateString(nextDate)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Appointment date must be a valid YYYY-MM-DD date.');
  }
  if (!isValidTimeString(nextTime)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Appointment time must be in HH:MM (24-hour) format.');
  }
  if (!VALID_APPOINTMENT_STATUSES.has(nextStatus)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid appointment status.');
  }

  if (nextStatus === 'Scheduled' || nextStatus === 'Confirmed' || nextStatus === 'Completed') {
    const sameDayAppointments = listAppointments(db, { date: nextDate });
    const conflict = findAppointmentConflict(sameDayAppointments, {
      excludeAppointmentId: appointmentId,
      patientId: existing.patientId,
      appointmentDate: nextDate,
      appointmentTime: nextTime,
      durationMinutes: nextDuration,
      clinician: nextClinician,
    });
    if (conflict.hasConflict) {
      throw new ServiceError(409, 'SCHEDULING_CONFLICT', conflict.reason ?? 'Scheduling conflict detected.', {
        conflictingAppointmentId: conflict.conflictingAppointmentId,
      });
    }
  }

  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE appointments
    SET appointment_date = ?,
        appointment_time = ?,
        duration_minutes = ?,
        department = ?,
        clinician = ?,
        status = ?,
        notes = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    nextDate,
    nextTime,
    nextDuration,
    nextDepartment,
    nextClinician,
    nextStatus,
    nextNotes,
    updatedAt,
    appointmentId
  );

  const actionLabel =
    patch.status === 'Cancelled'
      ? 'CANCEL_APPOINTMENT'
      : patch.status === 'Confirmed'
        ? 'CONFIRM_APPOINTMENT'
        : patch.appointmentDate || patch.appointmentTime
          ? 'RESCHEDULE_APPOINTMENT'
          : 'UPDATE_APPOINTMENT';

  recordAuditEvent(db, {
    actor,
    action: actionLabel,
    resourceType: 'appointment',
    resourceId: appointmentId,
    summary: `Updated appointment ${appointmentId} (${existing.patientId}): ${nextDate} at ${nextTime} · ${nextClinician} · Status: ${nextStatus}.`,
  });

  return getAppointmentById(db, appointmentId);
}
