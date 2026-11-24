import type { DatabaseSync } from 'node:sqlite';
import type { AuditLogEntry } from '../../shared/types';
import { DEFAULT_DEMO_CLINIC_ID } from '../db/database';

interface AuditLogRow {
  id: number;
  clinic_id: string;
  actor: string;
  action: string;
  resource_type: AuditLogEntry['resourceType'];
  resource_id: string;
  summary: string;
  created_at: string;
}

function mapAuditRow(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

export function recordAuditEvent(
  db: DatabaseSync,
  entry: {
    clinicId?: string;
    actor: string;
    action: string;
    resourceType: AuditLogEntry['resourceType'];
    resourceId: string;
    summary: string;
  }
): AuditLogEntry {
  const clinicId = entry.clinicId ?? DEFAULT_DEMO_CLINIC_ID;
  const createdAt = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO audit_logs (clinic_id, actor, action, resource_type, resource_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    clinicId,
    entry.actor,
    entry.action,
    entry.resourceType,
    entry.resourceId,
    entry.summary,
    createdAt
  );
  const insertedId = Number(result.lastInsertRowid);
  const row = db
    .prepare(
      'SELECT id, clinic_id, actor, action, resource_type, resource_id, summary, created_at FROM audit_logs WHERE id = ?'
    )
    .get(insertedId) as unknown as AuditLogRow;
  return mapAuditRow(row);
}

export function listAuditLogs(
  db: DatabaseSync,
  clinicId = DEFAULT_DEMO_CLINIC_ID,
  limit = 25
): AuditLogEntry[] {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 25), 100);
  const rows = db
    .prepare(
      `SELECT id, clinic_id, actor, action, resource_type, resource_id, summary, created_at
       FROM audit_logs
       WHERE clinic_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(clinicId, safeLimit) as unknown as AuditLogRow[];
  return rows.map(mapAuditRow);
}

export function listAuditLogsForPatient(
  db: DatabaseSync,
  clinicId: string,
  patientId: string,
  appointmentIds: string[],
  followupIds: string[],
  limit = 50
): AuditLogEntry[] {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
  const clauses: string[] = ["(resource_type = 'patient' AND resource_id = ?)"];
  const params: Array<string | number> = [clinicId, patientId];

  if (appointmentIds.length > 0) {
    const placeholders = appointmentIds.map(() => '?').join(', ');
    clauses.push(`(resource_type = 'appointment' AND resource_id IN (${placeholders}))`);
    params.push(...appointmentIds);
  }
  if (followupIds.length > 0) {
    const placeholders = followupIds.map(() => '?').join(', ');
    clauses.push(`(resource_type = 'followup' AND resource_id IN (${placeholders}))`);
    params.push(...followupIds);
  }

  params.push(safeLimit);

  const rows = db
    .prepare(
      `SELECT id, clinic_id, actor, action, resource_type, resource_id, summary, created_at
       FROM audit_logs
       WHERE clinic_id = ?
         AND (${clauses.join(' OR ')})
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(...params) as unknown as AuditLogRow[];

  return rows.map(mapAuditRow);
}

export function listAuditLogsForStaff(
  db: DatabaseSync,
  clinicId: string,
  staffId: string,
  staffName: string,
  appointmentIds: string[],
  limit = 50
): AuditLogEntry[] {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
  const clauses: string[] = [
    "(resource_type = 'staff' AND resource_id = ?)",
    'actor = ?',
    'actor LIKE ?',
  ];
  const params: Array<string | number> = [clinicId, staffId, staffName, `${staffName}%`];

  if (appointmentIds.length > 0) {
    const placeholders = appointmentIds.map(() => '?').join(', ');
    clauses.push(`(resource_type = 'appointment' AND resource_id IN (${placeholders}))`);
    params.push(...appointmentIds);
  }

  params.push(safeLimit);

  const rows = db
    .prepare(
      `SELECT id, clinic_id, actor, action, resource_type, resource_id, summary, created_at
       FROM audit_logs
       WHERE clinic_id = ?
         AND (${clauses.join(' OR ')})
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(...params) as unknown as AuditLogRow[];

  return rows.map(mapAuditRow);
}
