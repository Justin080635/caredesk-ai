import type { DatabaseSync } from 'node:sqlite';
import type { AuditLogEntry } from '../../shared/types';

interface AuditLogRow {
  id: number;
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
    actor: string;
    action: string;
    resourceType: AuditLogEntry['resourceType'];
    resourceId: string;
    summary: string;
  }
): AuditLogEntry {
  const createdAt = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO audit_logs (actor, action, resource_type, resource_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    entry.actor,
    entry.action,
    entry.resourceType,
    entry.resourceId,
    entry.summary,
    createdAt
  );
  const insertedId = Number(result.lastInsertRowid);
  const row = db
    .prepare('SELECT id, actor, action, resource_type, resource_id, summary, created_at FROM audit_logs WHERE id = ?')
    .get(insertedId) as unknown as AuditLogRow;
  return mapAuditRow(row);
}

export function listAuditLogs(db: DatabaseSync, limit = 25): AuditLogEntry[] {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 25), 100);
  const rows = db
    .prepare(
      `SELECT id, actor, action, resource_type, resource_id, summary, created_at
       FROM audit_logs
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(safeLimit) as unknown as AuditLogRow[];
  return rows.map(mapAuditRow);
}
