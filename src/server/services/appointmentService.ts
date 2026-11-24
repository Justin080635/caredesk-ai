import type { DatabaseSync } from 'node:sqlite';
import type {
  Appointment,
  AppointmentPaginationMeta,
  AppointmentRequestStatus,
  AppointmentSortField,
  AppointmentStatus,
  AppointmentType,
  AvailableSlot,
  DoctorScheduleDay,
  DoctorUnavailability,
  SortDirection,
  StaffMember,
} from '../../shared/types';
import { DEFAULT_DEMO_CLINIC_ID } from '../db/database';
import {
  ACTIVE_OCCUPYING_STATUSES,
  addDaysToDateString,
  computeAvailableSlots,
  computeDoctorAvailability,
  findAppointmentConflict,
  getClinicTodayDate,
  getDefaultDurationForType,
  isDoctorUnavailableAtSlot,
  isValidDateString,
  isValidTimeString,
} from '../domain/rules';
import { recordAuditEvent } from './auditService';
import { createNotification } from './notificationService';
import { ServiceError } from './patientService';

interface AppointmentRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  patient_name: string;
  staff_id: string | null;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: number;
  department: string;
  specialty: string;
  appointment_type: AppointmentType;
  clinician: string;
  status: AppointmentStatus;
  requested_by: 'staff' | 'patient';
  request_status: AppointmentRequestStatus;
  request_notes: string;
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
    staffId: row.staff_id,
    appointmentDate: row.appointment_date,
    appointmentTime: row.appointment_time,
    durationMinutes: row.duration_minutes,
    department: row.department,
    specialty: row.specialty || row.department,
    appointmentType: row.appointment_type || 'Consultation',
    clinician: row.clinician,
    status: row.status,
    requestedBy: row.requested_by || 'staff',
    requestStatus: row.request_status || 'None',
    requestNotes: row.request_notes || '',
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BASE_SELECT = `
  SELECT
    a.id,
    a.clinic_id,
    a.patient_id,
    p.full_name AS patient_name,
    a.staff_id,
    a.appointment_date,
    a.appointment_time,
    a.duration_minutes,
    a.department,
    a.specialty,
    a.appointment_type,
    a.clinician,
    a.status,
    a.requested_by,
    a.request_status,
    a.request_notes,
    a.notes,
    a.created_at,
    a.updated_at
  FROM appointments a
  INNER JOIN patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id
`;

export interface AppointmentFilterOptions {
  clinicId?: string;
  date?: string;
  status?: string;
  department?: string;
  patientId?: string;
  clinician?: string;
  staffId?: string;
  requestStatus?: string;
  search?: string;
}

function buildAppointmentWhereClause(filters?: AppointmentFilterOptions): {
  whereClause: string;
  params: string[];
} {
  const clinicId = filters?.clinicId ?? DEFAULT_DEMO_CLINIC_ID;
  const conditions: string[] = ['a.clinic_id = ?'];
  const params: string[] = [clinicId];

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
  if (filters?.staffId && filters.staffId.trim().length > 0) {
    conditions.push('a.staff_id = ?');
    params.push(filters.staffId.trim());
  }
  if (filters?.clinician && filters.clinician !== 'All') {
    conditions.push('a.clinician = ?');
    params.push(filters.clinician);
  }
  if (filters?.requestStatus && filters.requestStatus !== 'All') {
    conditions.push('a.request_status = ?');
    params.push(filters.requestStatus);
  }
  if (filters?.search && filters.search.trim().length > 0) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      '(LOWER(a.id) LIKE ? OR LOWER(a.patient_id) LIKE ? OR LOWER(p.full_name) LIKE ? OR LOWER(a.clinician) LIKE ? OR LOWER(a.department) LIKE ?)'
    );
    params.push(q, q, q, q, q);
  }

  return {
    whereClause: `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}

const VALID_SORT_FIELDS: ReadonlySet<AppointmentSortField> = new Set([
  'id',
  'appointmentDate',
  'patientName',
  'department',
  'clinician',
  'status',
]);

function getOrderByClause(sortBy: AppointmentSortField, sortDir: SortDirection): string {
  const dir = sortDir === 'desc' ? 'DESC' : 'ASC';
  switch (sortBy) {
    case 'id':
      return `ORDER BY a.id ${dir}`;
    case 'patientName':
      return `ORDER BY LOWER(p.full_name) ${dir}, a.appointment_date ASC, a.appointment_time ASC`;
    case 'department':
      return `ORDER BY a.department ${dir}, a.appointment_date ASC, a.appointment_time ASC`;
    case 'clinician':
      return `ORDER BY a.clinician ${dir}, a.appointment_date ASC, a.appointment_time ASC`;
    case 'status':
      return `ORDER BY a.status ${dir}, a.appointment_date ASC, a.appointment_time ASC`;
    case 'appointmentDate':
    default:
      return `ORDER BY a.appointment_date ${dir}, a.appointment_time ${dir}, a.id ${dir}`;
  }
}

export function listAppointments(
  db: DatabaseSync,
  filters?: AppointmentFilterOptions
): Appointment[] {
  const { whereClause, params } = buildAppointmentWhereClause(filters);
  const rows = db
    .prepare(
      `${BASE_SELECT}
       ${whereClause}
       ORDER BY a.appointment_date ASC, a.appointment_time ASC`
    )
    .all(...params) as unknown as AppointmentRow[];

  return rows.map(mapAppointmentRow);
}

export function listAppointmentsPaginated(
  db: DatabaseSync,
  options?: AppointmentFilterOptions & {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: string;
  }
): { data: Appointment[]; meta: AppointmentPaginationMeta } {
  const { whereClause, params } = buildAppointmentWhereClause(options);
  const requestedPage = Math.max(1, Math.floor(Number(options?.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(options?.pageSize) || 10)));
  const sortBy: AppointmentSortField =
    options?.sortBy && VALID_SORT_FIELDS.has(options.sortBy as AppointmentSortField)
      ? (options.sortBy as AppointmentSortField)
      : 'appointmentDate';
  const sortDir: SortDirection = options?.sortDir === 'desc' ? 'desc' : 'asc';

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM appointments a
       INNER JOIN patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id
       ${whereClause}`
    )
    .get(...params) as { total: number };

  const statusRows = db
    .prepare(
      `SELECT a.status AS status, COUNT(*) AS count
       FROM appointments a
       INNER JOIN patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id
       ${whereClause}
       GROUP BY a.status`
    )
    .all(...params) as Array<{ status: AppointmentStatus; count: number }>;

  const statusCounts: Record<AppointmentStatus, number> = {
    Scheduled: 0,
    Confirmed: 0,
    Completed: 0,
    Cancelled: 0,
    Missed: 0,
  };
  for (const row of statusRows) {
    if (row.status in statusCounts) {
      statusCounts[row.status] = row.count;
    }
  }

  const total = countRow.total;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(requestedPage, totalPages);
  const offset = (safePage - 1) * pageSize;

  const orderByClause = getOrderByClause(sortBy, sortDir);
  const rows = db
    .prepare(
      `${BASE_SELECT}
       ${whereClause}
       ${orderByClause}
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as unknown as AppointmentRow[];

  const data = rows.map(mapAppointmentRow);

  return {
    data,
    meta: {
      count: data.length,
      total,
      page: safePage,
      pageSize,
      totalPages,
      sortBy,
      sortDir,
      statusCounts,
    },
  };
}

export function getAppointmentById(
  db: DatabaseSync,
  appointmentId: string,
  clinicId = DEFAULT_DEMO_CLINIC_ID
): Appointment {
  const row = db
    .prepare(`${BASE_SELECT} WHERE a.id = ? AND a.clinic_id = ?`)
    .get(appointmentId, clinicId) as AppointmentRow | undefined;

  if (!row) {
    throw new ServiceError(
      404,
      'APPOINTMENT_NOT_FOUND',
      `Appointment ${appointmentId} was not found in this clinic.`
    );
  }
  return mapAppointmentRow(row);
}

export function getTodaysAppointments(
  db: DatabaseSync,
  referenceToday?: string,
  clinicId = DEFAULT_DEMO_CLINIC_ID
): Appointment[] {
  const today = referenceToday ?? getClinicTodayDate();
  return listAppointments(db, { clinicId, date: today });
}

export function getMissedAppointments(
  db: DatabaseSync,
  options?: { days?: number; referenceToday?: string; clinicId?: string }
): Appointment[] {
  const clinicId = options?.clinicId ?? DEFAULT_DEMO_CLINIC_ID;
  const today = options?.referenceToday ?? getClinicTodayDate();
  const days = Math.min(Math.max(1, Number(options?.days) || 7), 90);
  const startDate = addDaysToDateString(today, -(days - 1));

  const rows = db
    .prepare(
      `${BASE_SELECT}
       WHERE a.clinic_id = ?
         AND a.status = 'Missed'
         AND a.appointment_date >= ?
         AND a.appointment_date <= ?
       ORDER BY a.appointment_date DESC, a.appointment_time DESC`
    )
    .all(clinicId, startDate, today) as unknown as AppointmentRow[];

  return rows.map(mapAppointmentRow);
}

export function getUnconfirmedAppointments(
  db: DatabaseSync,
  referenceToday?: string,
  clinicId = DEFAULT_DEMO_CLINIC_ID
): Appointment[] {
  const today = referenceToday ?? getClinicTodayDate();
  const rows = db
    .prepare(
      `${BASE_SELECT}
       WHERE a.clinic_id = ?
         AND a.status = 'Scheduled'
         AND a.appointment_date >= ?
       ORDER BY a.appointment_date ASC, a.appointment_time ASC`
    )
    .all(clinicId, today) as unknown as AppointmentRow[];

  return rows.map(mapAppointmentRow);
}

function loadClinicianSchedulingContext(
  db: DatabaseSync,
  clinicId: string
): {
  doctors: StaffMember[];
  schedulesByStaffId: Map<string, DoctorScheduleDay[]>;
  unavailabilityByStaffId: Map<string, DoctorUnavailability[]>;
} {
  const doctorRows = db
    .prepare(
      `SELECT id, user_id, full_name, role, department, specialty, qualifications, license_number,
              bio, avatar_url, email, contact_number, status, attendance_status,
              default_appointment_duration, max_daily_capacity, verification_status, created_at, updated_at
       FROM staff
       WHERE clinic_id = ? AND role = 'Clinician'`
    )
    .all(clinicId) as Array<Record<string, unknown>>;

  const doctors: StaffMember[] = doctorRows.map((r) => ({
    id: String(r.id),
    userId: (r.user_id as string | null) ?? null,
    fullName: String(r.full_name),
    role: 'Clinician',
    department: String(r.department),
    specialty: String(r.specialty ?? ''),
    qualifications: String(r.qualifications ?? ''),
    licenseNumber: String(r.license_number ?? ''),
    bio: String(r.bio ?? ''),
    avatarUrl: String(r.avatar_url ?? ''),
    email: String(r.email ?? ''),
    contactNumber: String(r.contact_number ?? ''),
    status: r.status as StaffMember['status'],
    attendanceStatus: (r.attendance_status as StaffMember['attendanceStatus']) ?? 'On Duty',
    defaultAppointmentDuration: Number(r.default_appointment_duration ?? 30),
    maxDailyCapacity: Number(r.max_daily_capacity ?? 16),
    verificationStatus: (r.verification_status as StaffMember['verificationStatus']) ?? 'Approved',
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  const schedRows = db
    .prepare(`SELECT * FROM doctor_schedules WHERE clinic_id = ? ORDER BY day_of_week ASC`)
    .all(clinicId) as Array<Record<string, unknown>>;
  const schedulesByStaffId = new Map<string, DoctorScheduleDay[]>();
  for (const r of schedRows) {
    const sid = String(r.staff_id);
    const list = schedulesByStaffId.get(sid) ?? [];
    list.push({
      id: String(r.id),
      clinicId: String(r.clinic_id),
      staffId: sid,
      dayOfWeek: Number(r.day_of_week),
      isWorking: Boolean(r.is_working),
      startTime: String(r.start_time),
      endTime: String(r.end_time),
      breakStart: String(r.break_start ?? ''),
      breakEnd: String(r.break_end ?? ''),
      slotDurationMinutes: Number(r.slot_duration_minutes ?? 30),
      updatedAt: String(r.updated_at),
    });
    schedulesByStaffId.set(sid, list);
  }

  const unavailRows = db
    .prepare(`SELECT * FROM doctor_unavailability WHERE clinic_id = ?`)
    .all(clinicId) as Array<Record<string, unknown>>;
  const unavailabilityByStaffId = new Map<string, DoctorUnavailability[]>();
  for (const r of unavailRows) {
    const sid = String(r.staff_id);
    const list = unavailabilityByStaffId.get(sid) ?? [];
    list.push({
      id: String(r.id),
      clinicId: String(r.clinic_id),
      staffId: sid,
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      startTime: String(r.start_time ?? ''),
      endTime: String(r.end_time ?? ''),
      kind: r.kind as DoctorUnavailability['kind'],
      reason: String(r.reason ?? ''),
      createdAt: String(r.created_at),
    });
    unavailabilityByStaffId.set(sid, list);
  }

  return { doctors, schedulesByStaffId, unavailabilityByStaffId };
}

export function checkAppointmentAvailability(
  db: DatabaseSync,
  options?: {
    clinicId?: string;
    startDate?: string;
    daysCount?: number;
    department?: string;
    specialty?: string;
    clinician?: string;
    staffId?: string;
    patientId?: string;
    appointmentType?: AppointmentType;
    durationMinutes?: number;
    timeOfDay?: 'morning' | 'afternoon' | 'any';
    limit?: number;
  }
): AvailableSlot[] {
  const clinicId = options?.clinicId ?? DEFAULT_DEMO_CLINIC_ID;
  const startDate =
    options?.startDate && isValidDateString(options.startDate)
      ? options.startDate
      : getClinicTodayDate();

  const existing = listAppointments(db, { clinicId });
  const { doctors, schedulesByStaffId, unavailabilityByStaffId } = loadClinicianSchedulingContext(
    db,
    clinicId
  );

  if (doctors.length > 0) {
    return computeDoctorAvailability({
      doctors,
      schedulesByStaffId,
      unavailabilityByStaffId,
      existingAppointments: existing,
      options: {
        startDate,
        daysCount: options?.daysCount ?? 7,
        department: options?.department,
        specialty: options?.specialty,
        clinician: options?.clinician,
        staffId: options?.staffId,
        patientId: options?.patientId,
        appointmentType: options?.appointmentType,
        durationMinutes: options?.durationMinutes,
        timeOfDay: options?.timeOfDay,
        limit: options?.limit ?? 12,
      },
    });
  }

  return computeAvailableSlots(existing, {
    startDate,
    daysCount: options?.daysCount ?? 7,
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
  staffId?: string | null;
  appointmentDate: string;
  appointmentTime: string;
  durationMinutes?: number;
  department: string;
  specialty?: string;
  appointmentType?: AppointmentType;
  clinician: string;
  status?: AppointmentStatus;
  requestedBy?: 'staff' | 'patient';
  requestStatus?: AppointmentRequestStatus;
  requestNotes?: string;
  notes?: string;
}

export function createAppointment(
  db: DatabaseSync,
  input: CreateAppointmentInput,
  actor = 'Clinic Administrator',
  clinicId = DEFAULT_DEMO_CLINIC_ID
): Appointment {
  const patientId = (input.patientId ?? '').trim();
  const appointmentDate = (input.appointmentDate ?? '').trim();
  const appointmentTime = (input.appointmentTime ?? '').trim();
  const department = (input.department ?? '').trim();
  const specialty = (input.specialty ?? department).trim();
  const appointmentType: AppointmentType = input.appointmentType ?? 'Consultation';
  let clinician = (input.clinician ?? '').trim();
  let staffId = input.staffId ? input.staffId.trim() : null;
  const durationMinutes =
    Number(input.durationMinutes) || getDefaultDurationForType(appointmentType);
  const status: AppointmentStatus = input.status ?? 'Scheduled';
  const requestedBy = input.requestedBy ?? 'staff';
  const requestStatus: AppointmentRequestStatus = input.requestStatus ?? 'None';
  const requestNotes = (input.requestNotes ?? '').trim();
  const notes = (input.notes ?? '').trim();

  if (!patientId) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Patient ID is required.');
  }
  const patientRow = db
    .prepare('SELECT id, full_name, linked_user_id FROM patients WHERE id = ? AND clinic_id = ?')
    .get(patientId, clinicId) as { id: string; full_name: string; linked_user_id: string | null } | undefined;
  if (!patientRow) {
    throw new ServiceError(404, 'PATIENT_NOT_FOUND', `Patient ${patientId} does not exist in this clinic.`);
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
  if (!clinician && !staffId) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Assigned clinician is required.');
  }
  if (!VALID_APPOINTMENT_STATUSES.has(status)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid appointment status.');
  }

  // Resolve staff record if clinician matches
  const staffMatch = staffId
    ? (db
        .prepare(
          `SELECT id, full_name, user_id, status, attendance_status, max_daily_capacity
           FROM staff WHERE id = ? AND clinic_id = ?`
        )
        .get(staffId, clinicId) as
        | {
            id: string;
            full_name: string;
            user_id: string | null;
            status: string;
            attendance_status: string;
            max_daily_capacity: number;
          }
        | undefined)
    : (db
        .prepare(
          `SELECT id, full_name, user_id, status, attendance_status, max_daily_capacity
           FROM staff WHERE clinic_id = ? AND LOWER(full_name) = ? LIMIT 1`
        )
        .get(clinicId, clinician.toLowerCase()) as
        | {
            id: string;
            full_name: string;
            user_id: string | null;
            status: string;
            attendance_status: string;
            max_daily_capacity: number;
          }
        | undefined);

  if (staffMatch) {
    staffId = staffMatch.id;
    clinician = staffMatch.full_name;
    if (staffMatch.status === 'On Leave' || staffMatch.status === 'Inactive') {
      throw new ServiceError(
        409,
        'CLINICIAN_UNAVAILABLE',
        `${staffMatch.full_name} is currently marked ${staffMatch.status} and cannot accept new appointments.`
      );
    }

    const unavailRows = db
      .prepare(`SELECT * FROM doctor_unavailability WHERE clinic_id = ? AND staff_id = ?`)
      .all(clinicId, staffMatch.id) as Array<Record<string, unknown>>;
    const unavail: DoctorUnavailability[] = unavailRows.map((r) => ({
      id: String(r.id),
      clinicId: String(r.clinic_id),
      staffId: String(r.staff_id),
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      startTime: String(r.start_time ?? ''),
      endTime: String(r.end_time ?? ''),
      kind: r.kind as DoctorUnavailability['kind'],
      reason: String(r.reason ?? ''),
      createdAt: String(r.created_at),
    }));
    const blocked = isDoctorUnavailableAtSlot(unavail, appointmentDate, appointmentTime, durationMinutes);
    if (blocked) {
      throw new ServiceError(
        409,
        'CLINICIAN_UNAVAILABLE',
        `${staffMatch.full_name} has a ${blocked.kind.toLowerCase()} block (${blocked.reason || 'Unavailable'}) at ${appointmentTime} on ${appointmentDate}.`
      );
    }
  }

  let createdId = '';
  db.exec('BEGIN IMMEDIATE;');
  try {
    const allAppointments = listAppointments(db, { clinicId, date: appointmentDate });
    const conflict = findAppointmentConflict(allAppointments, {
      patientId,
      appointmentDate,
      appointmentTime,
      durationMinutes,
      clinician,
      staffId,
    });

    if (conflict.hasConflict) {
      throw new ServiceError(
        409,
        'SCHEDULING_CONFLICT',
        conflict.reason ?? 'Scheduling conflict detected.',
        { conflictingAppointmentId: conflict.conflictingAppointmentId }
      );
    }

    if (staffMatch) {
      const dayBooked = allAppointments.filter(
        (a) =>
          ACTIVE_OCCUPYING_STATUSES.has(a.status) &&
          (a.staffId === staffMatch.id || a.clinician.toLowerCase() === staffMatch.full_name.toLowerCase())
      ).length;
      if (dayBooked >= (staffMatch.max_daily_capacity || 16)) {
        throw new ServiceError(
          409,
          'CLINICIAN_CAPACITY_REACHED',
          `${staffMatch.full_name} has reached their maximum daily capacity (${staffMatch.max_daily_capacity}) on ${appointmentDate}.`
        );
      }
    }

    createdId = generateNextAppointmentId(db);
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO appointments (
        id, clinic_id, patient_id, staff_id, appointment_date, appointment_time, duration_minutes,
        department, specialty, appointment_type, clinician, status,
        requested_by, request_status, request_notes, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createdId,
      clinicId,
      patientId,
      staffId,
      appointmentDate,
      appointmentTime,
      durationMinutes,
      department,
      specialty,
      appointmentType,
      clinician,
      status,
      requestedBy,
      requestStatus,
      requestNotes,
      notes,
      nowIso,
      nowIso
    );

    recordAuditEvent(db, {
      clinicId,
      actor,
      action: 'CREATE_APPOINTMENT',
      resourceType: 'appointment',
      resourceId: createdId,
      summary: `Scheduled ${appointmentType} (${department}) appointment ${createdId} for ${patientId} with ${clinician} on ${appointmentDate} at ${appointmentTime}.`,
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  // Emit non-blocking notifications to linked patient & clinician
  if (patientRow.linked_user_id) {
    createNotification(db, {
      clinicId,
      userId: patientRow.linked_user_id,
      patientId,
      title: 'Appointment Scheduled',
      message: `${appointmentType} with ${clinician} (${department}) scheduled for ${appointmentDate} at ${appointmentTime}.`,
      kind: 'appointment',
      relatedType: 'appointment',
      relatedId: createdId,
    });
  }
  if (staffMatch?.user_id) {
    createNotification(db, {
      clinicId,
      userId: staffMatch.user_id,
      staffId: staffMatch.id,
      title: 'New Appointment Assigned',
      message: `${patientRow.full_name} booked ${appointmentType} on ${appointmentDate} at ${appointmentTime}.`,
      kind: 'appointment',
      relatedType: 'appointment',
      relatedId: createdId,
    });
  }

  return getAppointmentById(db, createdId, clinicId);
}

export interface UpdateAppointmentInput {
  appointmentDate?: string;
  appointmentTime?: string;
  durationMinutes?: number;
  department?: string;
  specialty?: string;
  appointmentType?: AppointmentType;
  clinician?: string;
  staffId?: string | null;
  status?: AppointmentStatus;
  requestStatus?: AppointmentRequestStatus;
  requestNotes?: string;
  notes?: string;
}

export function updateAppointment(
  db: DatabaseSync,
  appointmentId: string,
  patch: UpdateAppointmentInput,
  actor = 'Clinic Administrator',
  clinicId = DEFAULT_DEMO_CLINIC_ID
): Appointment {
  const existing = getAppointmentById(db, appointmentId, clinicId);

  const nextDate = patch.appointmentDate?.trim() ?? existing.appointmentDate;
  const nextTime = patch.appointmentTime?.trim() ?? existing.appointmentTime;
  const nextType: AppointmentType = patch.appointmentType ?? existing.appointmentType ?? 'Consultation';
  const nextDuration =
    patch.durationMinutes !== undefined ? Number(patch.durationMinutes) : existing.durationMinutes;
  const nextDepartment = patch.department?.trim() ?? existing.department;
  const nextSpecialty = patch.specialty?.trim() ?? existing.specialty ?? nextDepartment;
  let nextClinician = patch.clinician?.trim() ?? existing.clinician;
  let nextStaffId = patch.staffId !== undefined ? patch.staffId : (existing.staffId ?? null);
  const nextStatus = patch.status ?? existing.status;
  const nextRequestStatus: AppointmentRequestStatus =
    patch.requestStatus ?? existing.requestStatus ?? 'None';
  const nextRequestNotes =
    patch.requestNotes !== undefined ? patch.requestNotes.trim() : (existing.requestNotes ?? '');
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

  if (patch.clinician || patch.staffId) {
    const staffRow = nextStaffId
      ? (db
          .prepare(`SELECT id, full_name FROM staff WHERE id = ? AND clinic_id = ?`)
          .get(nextStaffId, clinicId) as { id: string; full_name: string } | undefined)
      : (db
          .prepare(`SELECT id, full_name FROM staff WHERE clinic_id = ? AND LOWER(full_name) = ? LIMIT 1`)
          .get(clinicId, nextClinician.toLowerCase()) as { id: string; full_name: string } | undefined);
    if (staffRow) {
      nextStaffId = staffRow.id;
      nextClinician = staffRow.full_name;
    }
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    if (nextStatus === 'Scheduled' || nextStatus === 'Confirmed' || nextStatus === 'Completed') {
      const sameDayAppointments = listAppointments(db, { clinicId, date: nextDate });
      const conflict = findAppointmentConflict(sameDayAppointments, {
        excludeAppointmentId: appointmentId,
        patientId: existing.patientId,
        appointmentDate: nextDate,
        appointmentTime: nextTime,
        durationMinutes: nextDuration,
        clinician: nextClinician,
        staffId: nextStaffId,
      });
      if (conflict.hasConflict) {
        throw new ServiceError(
          409,
          'SCHEDULING_CONFLICT',
          conflict.reason ?? 'Scheduling conflict detected.',
          { conflictingAppointmentId: conflict.conflictingAppointmentId }
        );
      }
    }

    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE appointments
      SET appointment_date = ?,
          appointment_time = ?,
          duration_minutes = ?,
          department = ?,
          specialty = ?,
          appointment_type = ?,
          clinician = ?,
          staff_id = ?,
          status = ?,
          request_status = ?,
          request_notes = ?,
          notes = ?,
          updated_at = ?
      WHERE id = ? AND clinic_id = ?
    `).run(
      nextDate,
      nextTime,
      nextDuration,
      nextDepartment,
      nextSpecialty,
      nextType,
      nextClinician,
      nextStaffId,
      nextStatus,
      nextRequestStatus,
      nextRequestNotes,
      nextNotes,
      updatedAt,
      appointmentId,
      clinicId
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
      clinicId,
      actor,
      action: actionLabel,
      resourceType: 'appointment',
      resourceId: appointmentId,
      summary: `Updated appointment ${appointmentId} (${existing.patientId}): ${nextDate} at ${nextTime} · ${nextClinician} · Status: ${nextStatus}.`,
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  // Notify linked patient on status or schedule updates
  const pt = db
    .prepare('SELECT linked_user_id FROM patients WHERE id = ? AND clinic_id = ?')
    .get(existing.patientId, clinicId) as { linked_user_id: string | null } | undefined;
  if (pt?.linked_user_id && (patch.status || patch.appointmentDate || patch.appointmentTime)) {
    createNotification(db, {
      clinicId,
      userId: pt.linked_user_id,
      patientId: existing.patientId,
      title: `Appointment ${nextStatus}`,
      message: `Your ${nextDepartment} visit (${appointmentId}) with ${nextClinician} is ${nextStatus.toLowerCase()} for ${nextDate} at ${nextTime}.`,
      kind: 'appointment',
      relatedType: 'appointment',
      relatedId: appointmentId,
    });
  }

  return getAppointmentById(db, appointmentId, clinicId);
}

export function deleteAppointment(
  db: DatabaseSync,
  appointmentId: string,
  actor = 'Clinic Administrator',
  clinicId = DEFAULT_DEMO_CLINIC_ID
): { deletedId: string } {
  const existing = getAppointmentById(db, appointmentId, clinicId);
  db.prepare('DELETE FROM appointments WHERE id = ? AND clinic_id = ?').run(appointmentId, clinicId);

  recordAuditEvent(db, {
    clinicId,
    actor,
    action: 'DELETE_APPOINTMENT',
    resourceType: 'appointment',
    resourceId: appointmentId,
    summary: `Deleted appointment ${appointmentId} (${existing.patientId} · ${existing.appointmentDate} ${existing.appointmentTime} · ${existing.clinician}).`,
  });

  return { deletedId: appointmentId };
}
