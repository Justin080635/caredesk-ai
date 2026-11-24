import type { DatabaseSync } from 'node:sqlite';
import type { FollowUpPriority, FollowUpStatus, FollowUpTask } from '../../shared/types';
import { getClinicTodayDate, isValidDateString } from '../domain/rules';
import { recordAuditEvent } from './auditService';
import { ServiceError } from './patientService';

interface FollowUpRow {
  id: string;
  patient_id: string;
  patient_name: string;
  appointment_id: string | null;
  description: string;
  priority: FollowUpPriority;
  created_date: string;
  due_date: string;
  status: FollowUpStatus;
  created_at: string;
  updated_at: string;
}

const VALID_PRIORITIES: ReadonlySet<FollowUpPriority> = new Set(['High', 'Medium', 'Low']);
const VALID_FOLLOWUP_STATUSES: ReadonlySet<FollowUpStatus> = new Set([
  'Pending',
  'In Progress',
  'Completed',
  'Dismissed',
]);

function mapFollowUpRow(row: FollowUpRow): FollowUpTask {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    appointmentId: row.appointment_id,
    description: row.description,
    priority: row.priority,
    createdDate: row.created_date,
    dueDate: row.due_date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BASE_SELECT = `
  SELECT
    f.id,
    f.patient_id,
    p.full_name AS patient_name,
    f.appointment_id,
    f.description,
    f.priority,
    f.created_date,
    f.due_date,
    f.status,
    f.created_at,
    f.updated_at
  FROM followups f
  INNER JOIN patients p ON p.id = f.patient_id
`;

export function listFollowups(
  db: DatabaseSync,
  filters?: { status?: string; priority?: string; patientId?: string }
): FollowUpTask[] {
  const conditions: string[] = [];
  const params: Array<string> = [];

  if (filters?.status && filters.status !== 'All') {
    conditions.push('f.status = ?');
    params.push(filters.status);
  }
  if (filters?.priority && filters.priority !== 'All') {
    conditions.push('f.priority = ?');
    params.push(filters.priority);
  }
  if (filters?.patientId && filters.patientId.trim().length > 0) {
    conditions.push('f.patient_id = ?');
    params.push(filters.patientId.trim());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `${BASE_SELECT}
       ${whereClause}
       ORDER BY
         CASE f.status WHEN 'Pending' THEN 0 WHEN 'In Progress' THEN 1 WHEN 'Completed' THEN 2 ELSE 3 END,
         CASE f.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
         f.due_date ASC`
    )
    .all(...params) as unknown as FollowUpRow[];

  return rows.map(mapFollowUpRow);
}

export function getPendingFollowups(db: DatabaseSync): FollowUpTask[] {
  const rows = db
    .prepare(
      `${BASE_SELECT}
       WHERE f.status IN ('Pending', 'In Progress')
       ORDER BY
         CASE f.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
         f.due_date ASC`
    )
    .all() as unknown as FollowUpRow[];

  return rows.map(mapFollowUpRow);
}

export function getFollowupById(db: DatabaseSync, taskId: string): FollowUpTask {
  const row = db.prepare(`${BASE_SELECT} WHERE f.id = ?`).get(taskId) as FollowUpRow | undefined;
  if (!row) {
    throw new ServiceError(404, 'FOLLOWUP_NOT_FOUND', `Follow-up task ${taskId} was not found.`);
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
  description: string;
  priority?: FollowUpPriority;
  dueDate: string;
}

export function createFollowup(
  db: DatabaseSync,
  input: CreateFollowUpInput,
  actor = 'Clinic Administrator'
): FollowUpTask {
  const patientId = (input.patientId ?? '').trim();
  const appointmentId = input.appointmentId ? input.appointmentId.trim() : null;
  const description = (input.description ?? '').trim();
  const priority: FollowUpPriority = input.priority ?? 'Medium';
  const dueDate = (input.dueDate ?? '').trim();

  if (!patientId) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Associated patient ID is required.');
  }
  const patientExists = db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId);
  if (!patientExists) {
    throw new ServiceError(404, 'PATIENT_NOT_FOUND', `Patient ${patientId} does not exist.`);
  }
  if (appointmentId) {
    const aptExists = db.prepare('SELECT id FROM appointments WHERE id = ?').get(appointmentId);
    if (!aptExists) {
      throw new ServiceError(404, 'APPOINTMENT_NOT_FOUND', `Appointment ${appointmentId} does not exist.`);
    }
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

  const id = generateNextFollowupId(db);
  const createdDate = getClinicTodayDate();
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO followups (
      id, patient_id, appointment_id, description, priority,
      created_date, due_date, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)
  `).run(id, patientId, appointmentId, description, priority, createdDate, dueDate, nowIso, nowIso);

  recordAuditEvent(db, {
    actor,
    action: 'CREATE_FOLLOWUP',
    resourceType: 'followup',
    resourceId: id,
    summary: `Created ${priority} priority follow-up ${id} for ${patientId} (due ${dueDate}).`,
  });

  return getFollowupById(db, id);
}

export interface UpdateFollowUpInput {
  status?: FollowUpStatus;
  priority?: FollowUpPriority;
  dueDate?: string;
  description?: string;
}

export function updateFollowupStatus(
  db: DatabaseSync,
  taskId: string,
  patch: UpdateFollowUpInput,
  actor = 'Clinic Administrator'
): FollowUpTask {
  const existing = getFollowupById(db, taskId);
  const nextStatus = patch.status ?? existing.status;
  const nextPriority = patch.priority ?? existing.priority;
  const nextDueDate = patch.dueDate?.trim() ?? existing.dueDate;
  const nextDescription = patch.description?.trim() ?? existing.description;

  if (!VALID_FOLLOWUP_STATUSES.has(nextStatus)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid follow-up status.');
  }
  if (!VALID_PRIORITIES.has(nextPriority)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid follow-up priority.');
  }
  if (!isValidDateString(nextDueDate)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Due date must be a valid YYYY-MM-DD date.');
  }

  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE followups
    SET status = ?, priority = ?, due_date = ?, description = ?, updated_at = ?
    WHERE id = ?
  `).run(nextStatus, nextPriority, nextDueDate, nextDescription, updatedAt, taskId);

  recordAuditEvent(db, {
    actor,
    action: 'UPDATE_FOLLOWUP',
    resourceType: 'followup',
    resourceId: taskId,
    summary: `Updated follow-up ${taskId} (${existing.patientId}) to ${nextStatus} (${nextPriority} priority).`,
  });

  return getFollowupById(db, taskId);
}
