import type { DatabaseSync } from 'node:sqlite';
import type { NotificationItem } from '../../shared/types';
import { DEFAULT_DEMO_CLINIC_ID } from '../db/database';

interface NotificationRow {
  id: string;
  clinic_id: string;
  user_id: string | null;
  patient_id: string | null;
  staff_id: string | null;
  title: string;
  message: string;
  kind: NotificationItem['kind'];
  related_type: string;
  related_id: string;
  is_read: number;
  created_at: string;
}

function mapNotificationRow(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    userId: row.user_id,
    patientId: row.patient_id,
    staffId: row.staff_id,
    title: row.title,
    message: row.message,
    kind: row.kind,
    relatedType: row.related_type,
    relatedId: row.related_id,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
  };
}

function generateNextNotificationId(db: DatabaseSync): string {
  const rows = db.prepare('SELECT id FROM notifications').all() as Array<{ id: string }>;
  let maxNum = 5000;
  for (const r of rows) {
    const m = /^NTF-(\d+)$/.exec(r.id);
    if (m) {
      const n = Number(m[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `NTF-${maxNum + 1}`;
}

export function createNotification(
  db: DatabaseSync,
  input: {
    clinicId?: string;
    userId?: string | null;
    patientId?: string | null;
    staffId?: string | null;
    title: string;
    message: string;
    kind?: NotificationItem['kind'];
    relatedType?: string;
    relatedId?: string;
  }
): NotificationItem {
  const clinicId = input.clinicId ?? DEFAULT_DEMO_CLINIC_ID;
  const id = generateNextNotificationId(db);
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO notifications (
      id, clinic_id, user_id, patient_id, staff_id, title, message, kind, related_type, related_id, is_read, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    clinicId,
    input.userId ?? null,
    input.patientId ?? null,
    input.staffId ?? null,
    input.title,
    input.message,
    input.kind ?? 'system',
    input.relatedType ?? '',
    input.relatedId ?? '',
    createdAt
  );

  const row = db
    .prepare(
      `SELECT id, clinic_id, user_id, patient_id, staff_id, title, message, kind, related_type, related_id, is_read, created_at
       FROM notifications WHERE id = ?`
    )
    .get(id) as unknown as NotificationRow;
  return mapNotificationRow(row);
}

export function notifyClinicAdmins(
  db: DatabaseSync,
  input: {
    clinicId: string;
    title: string;
    message: string;
    kind?: NotificationItem['kind'];
    relatedType?: string;
    relatedId?: string;
  }
): NotificationItem[] {
  const adminRows = db
    .prepare(
      `SELECT user_id FROM clinic_memberships
       WHERE clinic_id = ? AND role = 'Clinic Administrator' AND status = 'Active'`
    )
    .all(input.clinicId) as Array<{ user_id: string }>;

  const created: NotificationItem[] = [];
  for (const row of adminRows) {
    created.push(
      createNotification(db, {
        clinicId: input.clinicId,
        userId: row.user_id,
        title: input.title,
        message: input.message,
        kind: input.kind ?? 'system',
        relatedType: input.relatedType ?? '',
        relatedId: input.relatedId ?? '',
      })
    );
  }
  return created;
}

function resolveUserClinicLinks(
  db: DatabaseSync,
  clinicId: string,
  userId: string
): { patientId: string | null; staffId: string | null } {
  const pt = db
    .prepare('SELECT id FROM patients WHERE clinic_id = ? AND linked_user_id = ? LIMIT 1')
    .get(clinicId, userId) as { id: string } | undefined;
  const stf = db
    .prepare('SELECT id FROM staff WHERE clinic_id = ? AND user_id = ? LIMIT 1')
    .get(clinicId, userId) as { id: string } | undefined;
  return {
    patientId: pt?.id ?? null,
    staffId: stf?.id ?? null,
  };
}

export function listNotificationsForUser(
  db: DatabaseSync,
  clinicId: string,
  userId: string,
  limit = 40
): NotificationItem[] {
  const safeLimit = Math.min(Math.max(1, Number.isFinite(limit) ? limit : 40), 100);
  const { patientId, staffId } = resolveUserClinicLinks(db, clinicId, userId);

  const clauses: string[] = ['user_id = ?'];
  const params: Array<string | number> = [clinicId, userId];

  if (patientId) {
    clauses.push('(user_id IS NULL AND patient_id = ?)');
    params.push(patientId);
  }
  if (staffId) {
    clauses.push('(user_id IS NULL AND staff_id = ?)');
    params.push(staffId);
  }
  params.push(safeLimit);

  const rows = db
    .prepare(
      `SELECT id, clinic_id, user_id, patient_id, staff_id, title, message, kind, related_type, related_id, is_read, created_at
       FROM notifications
       WHERE clinic_id = ? AND (${clauses.join(' OR ')})
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(...params) as unknown as NotificationRow[];

  return rows.map(mapNotificationRow);
}

export function markNotificationRead(
  db: DatabaseSync,
  clinicId: string,
  userId: string,
  notificationId: string
): boolean {
  const { patientId, staffId } = resolveUserClinicLinks(db, clinicId, userId);
  const clauses: string[] = ['user_id = ?'];
  const params: Array<string> = [notificationId, clinicId, userId];

  if (patientId) {
    clauses.push('(user_id IS NULL AND patient_id = ?)');
    params.push(patientId);
  }
  if (staffId) {
    clauses.push('(user_id IS NULL AND staff_id = ?)');
    params.push(staffId);
  }

  const res = db
    .prepare(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND clinic_id = ? AND (${clauses.join(' OR ')})`
    )
    .run(...params);

  return Number(res.changes ?? 0) > 0;
}

export function markAllNotificationsRead(
  db: DatabaseSync,
  clinicId: string,
  userId: string
): number {
  const { patientId, staffId } = resolveUserClinicLinks(db, clinicId, userId);
  const clauses: string[] = ['user_id = ?'];
  const params: Array<string> = [clinicId, userId];

  if (patientId) {
    clauses.push('(user_id IS NULL AND patient_id = ?)');
    params.push(patientId);
  }
  if (staffId) {
    clauses.push('(user_id IS NULL AND staff_id = ?)');
    params.push(staffId);
  }

  const res = db
    .prepare(
      `UPDATE notifications SET is_read = 1 WHERE clinic_id = ? AND is_read = 0 AND (${clauses.join(' OR ')})`
    )
    .run(...params);

  return Number(res.changes ?? 0);
}
