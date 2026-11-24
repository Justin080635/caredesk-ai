import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let dbInstance: DatabaseSync | null = null;

export function createDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      contact_number TEXT NOT NULL,
      email TEXT NOT NULL,
      registration_date TEXT NOT NULL,
      administrative_status TEXT NOT NULL CHECK (
        administrative_status IN ('Active', 'Pending Verification', 'Inactive')
      ),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      department TEXT NOT NULL,
      clinician TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'Missed')
      ),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
    CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

    CREATE TABLE IF NOT EXISTS followups (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      appointment_id TEXT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('High', 'Medium', 'Low')),
      created_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('Pending', 'In Progress', 'Completed', 'Dismissed')
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status);
    CREATE INDEX IF NOT EXISTS idx_followups_patient ON followups(patient_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL CHECK (
        resource_type IN ('patient', 'appointment', 'followup', 'session')
      ),
      resource_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

export function getDatabase(customPath?: string): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }
  const targetPath =
    customPath ?? process.env.CAREDESK_DB_PATH ?? path.resolve(process.cwd(), 'data', 'caredesk.db');
  dbInstance = createDatabase(targetPath);
  return dbInstance;
}

export function resetDatabaseInstance(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
