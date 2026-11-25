import type { DatabaseSync } from 'node:sqlite';
import type {
  DoctorScope,
  FollowUpPriority,
  FollowUpStatus,
  FollowUpTask,
  FollowUpType,
} from '../../shared/types';
import { DEFAULT_DEMO_CLINIC_ID } from '../db/database';
import { getClinicTodayDate, isValidDateString } from '../domain/rules';
import { recordAuditEvent } from './auditService';
import { buildDoctorFollowupSql } from './doctorAccessService';
import { createNotification } from './notificationService';
import { ServiceError } from './patientService';

interface FollowUpRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  patient_name: string;
  appointment_id: string | null;
  followup_type: FollowUpType;
  assigned_staff_id: string | null;
  assigned_to_name: string;
  description: string;
  reason: string;
  priority: FollowUpPriority;
  created_date: string;
  due_date: string;
  status: FollowUpStatus;
  completed_at: string | null;
  completed_by: string;
  completion_notes: string;
  created_at: string;
  updated_at: string;
}

const VALID_PRIORITIES: ReadonlySet<FollowUpPriority> = new Set(['High', 'Medium', 'Low']);
const VALID_FOLLOWUP_STATUSES: ReadonlySet<FollowUpStatus> = new Set([
  'Pending',
  'Scheduled',
  'Due',
  'Overdue',
  'Completed',
  'Cancelled',
]);
const VALID_FOLLOWUP_TYPES: ReadonlySet<FollowUpType> = new Set([
  'Administrative Contact',
  'Clinical Recommendation',
]);

export function normalizeFollowUpStatus(raw?: string): FollowUpStatus | undefined {
  if (!raw) return undefined;
  if (raw === 'In Progress') return 'Scheduled';
  if (raw === 'Dismissed') return 'Cancelled';
  if (VALID_FOLLOWUP_STATUSES.has(raw as FollowUpStatus)) {
    return raw as FollowUpStatus;
  }
  return undefined;
}

function computeEffectiveStatus(row: FollowUpRow, today: string): FollowUpStatus {
  if (row.status === 'Completed' || row.status === 'Cancelled') {
    return row.status;
  }
  if (row.due_date < today) return 'Overdue';
  if (row.due_date === today && row.status === 'Pending') return 'Due';
  return row.status;
}

function mapFollowUpRow(row: FollowUpRow, today = getClinicTodayDate()): FollowUpTask {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    appointmentId: row.appointment_id,
    followupType: row.followup_type || 'Administrative Contact',
    assignedStaffId: row.assigned_staff_id,
    assignedToName: row.assigned_to_name || '',
    description: row.description,
    reason: row.reason || '',
    priority: row.priority,
    createdDate: row.created_date,
    dueDate: row.due_date,
    status: computeEffectiveStatus(row, today),
    completedAt: row.completed_at,
    completedBy: row.completed_by || '',
    completionNotes: row.completion_notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BASE_SELECT = `
  SELECT
    f.id,
    f.clinic_id,
    f.patient_id,
    p.full_name AS patient_name,
    f.appointment_id,
    f.followup_type,
    f.assigned_staff_id,
    f.assigned_to_name,
    f.description,
    f.reason,
    f.priority,
    f.created_date,
    f.due_date,
    f.status,
    f.completed_at,
    f.completed_by,
    f.completion_notes,
    f.created_at,
    f.updated_at
  FROM followups f
  INNER JOIN patients p ON p.id = f.patient_id AND p.clinic_id = f.clinic_id
`;

export function listFollowups(
  db: DatabaseSync,
  filters?: {
    clinicId?: string;
    status?: string;
    priority?: string;
    patientId?: string;
    assignedStaffId?: string;
    followupType?: string;
    doctorScope?: DoctorScope;
  }
): FollowUpTask[] {
  const clinicId = filters?.clinicId ?? DEFAULT_DEMO_CLINIC_ID;
  const today = getClinicTodayDate();
  const conditions: string[] = ['f.clinic_id = ?'];
  const params: Array<string> = [clinicId];

  if (filters?.doctorScope) {
    const scopePred = buildDoctorFollowupSql(filters.doctorScope, 'f');
    conditions.push(scopePred.sql);
    params.push(...scopePred.params);
  }
  if (filters?.priority && filters.priority !== 'All') {
    conditions.push('f.priority = ?');
    params.push(filters.priority);
  }
  if (filters?.patientId && filters.patientId.trim().length > 0) {
    conditions.push('f.patient_id = ?');
    params.push(filters.patientId.trim());
  }
  if (filters?.assignedStaffId && filters.assignedStaffId.trim().length > 0 && !filters?.doctorScope) {
    conditions.push('f.assigned_staff_id = ?');
    params.push(filters.assignedStaffId.trim());
  }
  if (filters?.followupType && filters.followupType !== 'All') {
    conditions.push('f.followup_type = ?');
    params.push(filters.followupType);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const rows = db
    .prepare(
      `${BASE_SELECT}
       ${whereClause}
       ORDER BY
         CASE f.status WHEN 'Overdue' THEN 0 WHEN 'Due' THEN 1 WHEN 'Pending' THEN 2 WHEN 'Scheduled' THEN 3 WHEN 'Completed' THEN 4 ELSE 5 END,
         CASE f.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
         f.due_date ASC`
    )
    .all(...params) as unknown as FollowUpRow[];

  const mapped = rows.map((r) => mapFollowUpRow(r, today));
  if (filters?.status && filters.status !== 'All') {
    const normalizedFilter = normalizeFollowUpStatus(filters.status) ?? filters.status;
    return mapped.filter((f) => f.status === normalizedFilter);
  }
  return mapped;
}

export function getPendingFollowups(
  db: DatabaseSync,
  clinicId = DEFAULT_DEMO_CLINIC_ID,
  assignedStaffId?: string,
  doctorScope?: DoctorScope
): FollowUpTask[] {
  const today = getClinicTodayDate();
  const clauses = ["f.clinic_id = ?", "f.status IN ('Pending', 'Scheduled', 'Due', 'Overdue')"];
  const params: string[] = [clinicId];
  if (doctorScope) {
    const scopePred = buildDoctorFollowupSql(doctorScope, 'f');
    clauses.push(scopePred.sql);
    params.push(...scopePred.params);
  } else if (assignedStaffId) {
    clauses.push('f.assigned_staff_id = ?');
    params.push(assignedStaffId);
  }

  const rows = db
    .prepare(
      `${BASE_SELECT}
       WHERE ${clauses.join(' AND ')}
       ORDER BY
         CASE f.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
         f.due_date ASC`
    )
    .all(...params) as unknown as FollowUpRow[];

  return rows.map((r) => mapFollowUpRow(r, today));
}

export function getFollowupById(
  db: DatabaseSync,
  taskId: string,
  clinicId = DEFAULT_DEMO_CLINIC_ID
): FollowUpTask {
  const row = db
    .prepare(`${BASE_SELECT} WHERE f.id = ? AND f.clinic_id = ?`)
    .get(taskId, clinicId) as FollowUpRow | undefined;
  if (!row) {
    throw new ServiceError(404, 'FOLLOWUP_NOT_FOUND', `Follow-up task ${taskId} was not found in this clinic.`);
  }
  return mapFollowUpRow(row);
}

function generateNextFollowupId(db: DatabaseSync): string {
  const rows = db.prepare('SELECT id FROM followups').all() as Array<{ id: string }>;
  let maxNum = 3000;
  for (const r of rows) {
    const match = /^FU-(\d+)$/.exec(r.id);
    if (match) {
      const n = Number(match[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `FU-${maxNum + 1}`;
}

export interface CreateFollowUpInput {
  patientId: string;
  appointmentId?: string | null;
  followupType?: FollowUpType;
  assignedStaffId?: string | null;
  assignedToName?: string;
  description: string;
  reason?: string;
  priority?: FollowUpPriority;
  dueDate: string;
  status?: FollowUpStatus;
}

export function createFollowup(
  db: DatabaseSync,
  input: CreateFollowUpInput,
  actor = 'Clinic Administrator',
  clinicId = DEFAULT_DEMO_CLINIC_ID
): FollowUpTask {
  const patientId = (input.patientId ?? '').trim();
  const appointmentId = input.appointmentId ? input.appointmentId.trim() : null;
  const followupType: FollowUpType = input.followupType ?? 'Administrative Contact';
  let assignedStaffId = input.assignedStaffId ? input.assignedStaffId.trim() : null;
  let assignedToName = (input.assignedToName ?? '').trim();
  const description = (input.description ?? '').trim();
  const reason = (input.reason ?? '').trim();
  const priority: FollowUpPriority = input.priority ?? 'Medium';
  const dueDate = (input.dueDate ?? '').trim();
  const initialStatus = normalizeFollowUpStatus(input.status) ?? 'Pending';

  if (!patientId) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Associated patient ID is required.');
  }
  const patientExists = db
    .prepare('SELECT id, full_name FROM patients WHERE id = ? AND clinic_id = ?')
    .get(patientId, clinicId) as { id: string; full_name: string } | undefined;
  if (!patientExists) {
    throw new ServiceError(404, 'PATIENT_NOT_FOUND', `Patient ${patientId} does not exist in this clinic.`);
  }
  if (appointmentId) {
    const aptExists = db
      .prepare('SELECT id FROM appointments WHERE id = ? AND clinic_id = ?')
      .get(appointmentId, clinicId);
    if (!aptExists) {
      throw new ServiceError(
        404,
        'APPOINTMENT_NOT_FOUND',
        `Appointment ${appointmentId} does not exist in this clinic.`
      );
    }
  }
  if (!VALID_FOLLOWUP_TYPES.has(followupType)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid follow-up type.');
  }
  if (description.length < 4) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Follow-up description must be at least 4 characters.');
  }
  if (!VALID_PRIORITIES.has(priority)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid follow-up priority.');
  }
  if (!isValidDateString(dueDate)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Due date must be a valid YYYY-MM-DD date.');
  }

  let assignedUserId: string | null = null;
  if (assignedStaffId) {
    const staffRow = db
      .prepare('SELECT id, full_name, user_id FROM staff WHERE id = ? AND clinic_id = ?')
      .get(assignedStaffId, clinicId) as
      | { id: string; full_name: string; user_id: string | null }
      | undefined;
    if (staffRow) {
      assignedStaffId = staffRow.id;
      assignedToName = assignedToName || staffRow.full_name;
      assignedUserId = staffRow.user_id;
    }
  } else if (assignedToName) {
    const matches = db
      .prepare(
        'SELECT id, full_name, user_id FROM staff WHERE clinic_id = ? AND LOWER(TRIM(full_name)) = ?'
      )
      .all(clinicId, assignedToName.trim().toLowerCase()) as Array<{
      id: string;
      full_name: string;
      user_id: string | null;
    }>;
    if (matches.length === 1) {
      assignedStaffId = matches[0].id;
      assignedToName = matches[0].full_name;
      assignedUserId = matches[0].user_id;
    }
  }

  const id = generateNextFollowupId(db);
  const createdDate = getClinicTodayDate();
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO followups (
      id, clinic_id, patient_id, appointment_id, followup_type, assigned_staff_id, assigned_to_name,
      description, reason, priority, created_date, due_date, status,
      completed_at, completed_by, completion_notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', '', ?, ?)
  `).run(
    id,
    clinicId,
    patientId,
    appointmentId,
    followupType,
    assignedStaffId,
    assignedToName,
    description,
    reason,
    priority,
    createdDate,
    dueDate,
    initialStatus,
    nowIso,
    nowIso
  );

  recordAuditEvent(db, {
    clinicId,
    actor,
    action: 'CREATE_FOLLOWUP',
    resourceType: 'followup',
    resourceId: id,
    summary: `Created ${priority} priority ${followupType.toLowerCase()} follow-up ${id} for ${patientId} (due ${dueDate}${assignedToName ? `, owner: ${assignedToName}` : ''}).`,
  });

  if (assignedUserId) {
    createNotification(db, {
      clinicId,
      userId: assignedUserId,
      staffId: assignedStaffId,
      title: 'Follow-Up Assigned',
      message: `${priority} priority follow-up for ${patientExists.full_name} due ${dueDate}: ${description}`,
      kind: 'followup',
      relatedType: 'followup',
      relatedId: id,
    });
  }

  return getFollowupById(db, id, clinicId);
}

export interface UpdateFollowUpInput {
  status?: FollowUpStatus | string;
  priority?: FollowUpPriority;
  followupType?: FollowUpType;
  assignedStaffId?: string | null;
  assignedToName?: string;
  dueDate?: string;
  description?: string;
  reason?: string;
  completionNotes?: string;
}

export function updateFollowupStatus(
  db: DatabaseSync,
  taskId: string,
  patch: UpdateFollowUpInput,
  actor = 'Clinic Administrator',
  clinicId = DEFAULT_DEMO_CLINIC_ID
): FollowUpTask {
  const existing = getFollowupById(db, taskId, clinicId);
  const nextStatus =
    patch.status !== undefined ? normalizeFollowUpStatus(patch.status) : existing.status;
  const nextPriority = patch.priority ?? existing.priority;
  const nextType = patch.followupType ?? existing.followupType ?? 'Administrative Contact';
  const nextDueDate = patch.dueDate?.trim() ?? existing.dueDate;
  const nextDescription = patch.description?.trim() ?? existing.description;
  const nextReason = patch.reason !== undefined ? patch.reason.trim() : (existing.reason ?? '');
  const nextCompletionNotes =
    patch.completionNotes !== undefined
      ? patch.completionNotes.trim()
      : (existing.completionNotes ?? '');

  let nextAssignedStaffId =
    patch.assignedStaffId !== undefined ? patch.assignedStaffId : (existing.assignedStaffId ?? null);
  let nextAssignedToName =
    patch.assignedToName !== undefined ? patch.assignedToName.trim() : (existing.assignedToName ?? '');

  if (nextAssignedStaffId) {
    const sRow = db
      .prepare('SELECT full_name FROM staff WHERE id = ? AND clinic_id = ?')
      .get(nextAssignedStaffId, clinicId) as { full_name: string } | undefined;
    if (sRow && !patch.assignedToName) {
      nextAssignedToName = sRow.full_name;
    }
  } else if (patch.assignedStaffId === null) {
    nextAssignedToName = patch.assignedToName ?? '';
  }

  if (!nextStatus || !VALID_FOLLOWUP_STATUSES.has(nextStatus)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid follow-up status.');
  }
  if (!VALID_PRIORITIES.has(nextPriority)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid follow-up priority.');
  }
  if (!VALID_FOLLOWUP_TYPES.has(nextType)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid follow-up type.');
  }
  if (!isValidDateString(nextDueDate)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Due date must be a valid YYYY-MM-DD date.');
  }

  const updatedAt = new Date().toISOString();
  const completedAt =
    nextStatus === 'Completed' ? existing.completedAt ?? updatedAt : null;
  const completedBy =
    nextStatus === 'Completed' ? (existing.completedBy || actor) : '';

  db.prepare(`
    UPDATE followups
    SET status = ?,
        priority = ?,
        followup_type = ?,
        assigned_staff_id = ?,
        assigned_to_name = ?,
        due_date = ?,
        description = ?,
        reason = ?,
        completed_at = ?,
        completed_by = ?,
        completion_notes = ?,
        updated_at = ?
    WHERE id = ? AND clinic_id = ?
  `).run(
    nextStatus,
    nextPriority,
    nextType,
    nextAssignedStaffId,
    nextAssignedToName,
    nextDueDate,
    nextDescription,
    nextReason,
    completedAt,
    completedBy,
    nextCompletionNotes,
    updatedAt,
    taskId,
    clinicId
  );

  recordAuditEvent(db, {
    clinicId,
    actor,
    action: 'UPDATE_FOLLOWUP',
    resourceType: 'followup',
    resourceId: taskId,
    summary: `Updated follow-up ${taskId} (${existing.patientId}) to ${nextStatus} (${nextPriority} priority).`,
  });

  return getFollowupById(db, taskId, clinicId);
}
