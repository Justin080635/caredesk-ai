import type { DatabaseSync } from 'node:sqlite';
import type { AdministrativeStatus, Patient } from '../../shared/types';
import { getClinicTodayDate, isValidDateString, isValidEmail } from '../domain/rules';
import { recordAuditEvent } from './auditService';

interface PatientRow {
  id: string;
  full_name: string;
  date_of_birth: string;
  contact_number: string;
  email: string;
  registration_date: string;
  administrative_status: AdministrativeStatus;
  created_at: string;
}

const VALID_ADMIN_STATUSES: ReadonlySet<AdministrativeStatus> = new Set([
  'Active',
  'Pending Verification',
  'Inactive',
]);

function mapPatientRow(row: PatientRow): Patient {
  return {
    id: row.id,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth,
    contactNumber: row.contact_number,
    email: row.email,
    registrationDate: row.registration_date,
    administrativeStatus: row.administrative_status,
    createdAt: row.created_at,
  };
}

export class ServiceError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function listPatients(
  db: DatabaseSync,
  filters?: { search?: string; status?: string }
): Patient[] {
  const conditions: string[] = [];
  const params: Array<string> = [];

  if (filters?.search && filters.search.trim().length > 0) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push('(LOWER(id) LIKE ? OR LOWER(full_name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(contact_number) LIKE ?)');
    params.push(q, q, q, q);
  }

  if (filters?.status && filters.status !== 'All') {
    conditions.push('administrative_status = ?');
    params.push(filters.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT id, full_name, date_of_birth, contact_number, email, registration_date, administrative_status, created_at
       FROM patients
       ${whereClause}
       ORDER BY id ASC`
    )
    .all(...params) as unknown as PatientRow[];

  return rows.map(mapPatientRow);
}

export function getPatientById(db: DatabaseSync, patientId: string): Patient {
  const row = db
    .prepare(
      `SELECT id, full_name, date_of_birth, contact_number, email, registration_date, administrative_status, created_at
       FROM patients
       WHERE id = ?`
    )
    .get(patientId) as PatientRow | undefined;

  if (!row) {
    throw new ServiceError(404, 'PATIENT_NOT_FOUND', `Patient ${patientId} was not found.`);
  }
  return mapPatientRow(row);
}

function generateNextPatientId(db: DatabaseSync): string {
  const rows = db.prepare('SELECT id FROM patients').all() as Array<{ id: string }>;
  let maxNum = 1000;
  for (const r of rows) {
    const match = /^P-(\d+)$/.exec(r.id);
    if (match) {
      const n = Number(match[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `P-${maxNum + 1}`;
}

export interface RegisterPatientInput {
  fullName: string;
  dateOfBirth: string;
  contactNumber: string;
  email: string;
  administrativeStatus?: AdministrativeStatus;
}

export function registerPatient(
  db: DatabaseSync,
  input: RegisterPatientInput,
  actor = 'Clinic Administrator'
): Patient {
  const fullName = (input.fullName ?? '').trim();
  const dateOfBirth = (input.dateOfBirth ?? '').trim();
  const contactNumber = (input.contactNumber ?? '').trim();
  const email = (input.email ?? '').trim();
  const administrativeStatus: AdministrativeStatus = input.administrativeStatus ?? 'Active';

  if (fullName.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Full name must be at least 2 characters.');
  }
  if (!isValidDateString(dateOfBirth)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Date of birth must be a valid YYYY-MM-DD date.');
  }
  if (contactNumber.length < 7) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Contact number must be at least 7 characters.');
  }
  if (!isValidEmail(email)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please provide a valid email address.');
  }
  if (!VALID_ADMIN_STATUSES.has(administrativeStatus)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid administrative status.');
  }

  const id = generateNextPatientId(db);
  const registrationDate = getClinicTodayDate();
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO patients (
      id, full_name, date_of_birth, contact_number, email,
      registration_date, administrative_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, fullName, dateOfBirth, contactNumber, email, registrationDate, administrativeStatus, createdAt);

  recordAuditEvent(db, {
    actor,
    action: 'REGISTER_PATIENT',
    resourceType: 'patient',
    resourceId: id,
    summary: `Registered synthetic patient ${fullName} (${id}) with status ${administrativeStatus}.`,
  });

  return getPatientById(db, id);
}

export interface UpdatePatientInput {
  fullName?: string;
  dateOfBirth?: string;
  contactNumber?: string;
  email?: string;
  administrativeStatus?: AdministrativeStatus;
}

export function updatePatient(
  db: DatabaseSync,
  patientId: string,
  patch: UpdatePatientInput,
  actor = 'Clinic Administrator'
): Patient {
  const existing = getPatientById(db, patientId);

  const nextName = patch.fullName !== undefined ? patch.fullName.trim() : existing.fullName;
  const nextDob = patch.dateOfBirth !== undefined ? patch.dateOfBirth.trim() : existing.dateOfBirth;
  const nextContact =
    patch.contactNumber !== undefined ? patch.contactNumber.trim() : existing.contactNumber;
  const nextEmail = patch.email !== undefined ? patch.email.trim() : existing.email;
  const nextStatus: AdministrativeStatus =
    patch.administrativeStatus ?? existing.administrativeStatus;

  if (nextName.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Full name must be at least 2 characters.');
  }
  if (!isValidDateString(nextDob)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Date of birth must be a valid YYYY-MM-DD date.');
  }
  if (nextContact.length < 7) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Contact number must be at least 7 characters.');
  }
  if (!isValidEmail(nextEmail)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please provide a valid email address.');
  }
  if (!VALID_ADMIN_STATUSES.has(nextStatus)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid administrative status.');
  }

  db.prepare(`
    UPDATE patients
    SET full_name = ?,
        date_of_birth = ?,
        contact_number = ?,
        email = ?,
        administrative_status = ?
    WHERE id = ?
  `).run(nextName, nextDob, nextContact, nextEmail, nextStatus, patientId);

  recordAuditEvent(db, {
    actor,
    action: 'UPDATE_PATIENT',
    resourceType: 'patient',
    resourceId: patientId,
    summary: `Updated patient ${nextName} (${patientId}) · Status: ${nextStatus}.`,
  });

  return getPatientById(db, patientId);
}
