import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let dbInstance: DatabaseSync | null = null;

export const DEFAULT_DEMO_CLINIC_ID = 'CLN-1001';

function hasColumn(db: DatabaseSync, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((c) => c.name === columnName);
}

function getTableCreateSql(db: DatabaseSync, tableName: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: string } | undefined;
  return row?.sql ?? '';
}

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
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      firebase_uid TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone_number TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      auth_provider TEXT NOT NULL DEFAULT 'password',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS clinics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      clinic_type TEXT NOT NULL,
      contact_phone TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      organization_notes TEXT NOT NULL DEFAULT '',
      owner_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clinic_memberships (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (
        role IN ('Clinic Administrator', 'Doctor', 'Receptionist', 'Clinic Staff', 'Patient')
      ),
      status TEXT NOT NULL CHECK (status IN ('Active', 'Invited', 'Suspended')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(clinic_id, user_id),
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_memberships_user ON clinic_memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_clinic ON clinic_memberships(clinic_id);

    CREATE TABLE IF NOT EXISTS clinic_invitations (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (
        role IN ('Clinic Administrator', 'Doctor', 'Receptionist', 'Clinic Staff', 'Patient')
      ),
      status TEXT NOT NULL CHECK (status IN ('Pending', 'Accepted', 'Revoked')),
      invited_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(clinic_id, email),
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL DEFAULT '${DEFAULT_DEMO_CLINIC_ID}',
      full_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      contact_number TEXT NOT NULL,
      email TEXT NOT NULL,
      registration_date TEXT NOT NULL,
      administrative_status TEXT NOT NULL CHECK (
        administrative_status IN ('Active', 'Pending Verification', 'Inactive')
      ),
      linked_user_id TEXT NULL,
      emergency_contact_name TEXT NOT NULL DEFAULT '',
      emergency_contact_phone TEXT NOT NULL DEFAULT '',
      claim_code_hash TEXT NOT NULL DEFAULT '',
      claim_code_expires_at TEXT NOT NULL DEFAULT '',
      portal_linked_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL DEFAULT '${DEFAULT_DEMO_CLINIC_ID}',
      patient_id TEXT NOT NULL,
      staff_id TEXT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      department TEXT NOT NULL,
      specialty TEXT NOT NULL DEFAULT '',
      appointment_type TEXT NOT NULL DEFAULT 'Consultation',
      clinician TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'Missed')
      ),
      requested_by TEXT NOT NULL DEFAULT 'staff',
      request_status TEXT NOT NULL DEFAULT 'None',
      request_notes TEXT NOT NULL DEFAULT '',
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
      clinic_id TEXT NOT NULL DEFAULT '${DEFAULT_DEMO_CLINIC_ID}',
      patient_id TEXT NOT NULL,
      appointment_id TEXT NULL,
      followup_type TEXT NOT NULL DEFAULT 'Administrative Contact',
      assigned_staff_id TEXT NULL,
      assigned_to_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL CHECK (priority IN ('High', 'Medium', 'Low')),
      created_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('Pending', 'Scheduled', 'Due', 'Overdue', 'Completed', 'Cancelled')
      ),
      completed_at TEXT NULL,
      completed_by TEXT NOT NULL DEFAULT '',
      completion_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status);
    CREATE INDEX IF NOT EXISTS idx_followups_patient ON followups(patient_id);

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL DEFAULT '${DEFAULT_DEMO_CLINIC_ID}',
      user_id TEXT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (
        role IN ('Clinician', 'Administrator', 'Coordinator', 'Viewer')
      ),
      department TEXT NOT NULL,
      specialty TEXT NOT NULL DEFAULT '',
      qualifications TEXT NOT NULL DEFAULT '',
      license_number TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      contact_number TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (
        status IN ('Active', 'On Leave', 'Inactive')
      ),
      attendance_status TEXT NOT NULL DEFAULT 'On Duty',
      default_appointment_duration INTEGER NOT NULL DEFAULT 30,
      max_daily_capacity INTEGER NOT NULL DEFAULT 16,
      verification_status TEXT NOT NULL DEFAULT 'Approved',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doctor_applications (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL,
      department TEXT NOT NULL,
      qualifications TEXT NOT NULL,
      license_number TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (
        status IN ('Pending Verification', 'Approved', 'Rejected')
      ),
      review_notes TEXT NOT NULL DEFAULT '',
      reviewed_by_user_id TEXT NULL,
      reviewed_at TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS doctor_schedules (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
      is_working INTEGER NOT NULL DEFAULT 1,
      start_time TEXT NOT NULL DEFAULT '08:30',
      end_time TEXT NOT NULL DEFAULT '17:00',
      break_start TEXT NOT NULL DEFAULT '12:00',
      break_end TEXT NOT NULL DEFAULT '13:00',
      slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
      updated_at TEXT NOT NULL,
      UNIQUE(clinic_id, staff_id, day_of_week),
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS doctor_unavailability (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      start_time TEXT NOT NULL DEFAULT '',
      end_time TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK (kind IN ('Leave', 'Break', 'Unavailable')),
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS patient_link_requests (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT NOT NULL DEFAULT '',
      date_of_birth TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
      linked_patient_id TEXT NULL,
      reviewed_by_user_id TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS consultations (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      appointment_id TEXT NULL,
      patient_id TEXT NOT NULL,
      staff_id TEXT NULL,
      doctor_name TEXT NOT NULL,
      consultation_date TEXT NOT NULL,
      summary TEXT NOT NULL,
      diagnosis_notes TEXT NOT NULL DEFAULT '',
      recommendations TEXT NOT NULL DEFAULT '',
      prescriptions_json TEXT NOT NULL DEFAULT '[]',
      test_results_json TEXT NOT NULL DEFAULT '[]',
      patient_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      user_id TEXT NULL,
      patient_id TEXT NULL,
      staff_id TEXT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'system',
      related_type TEXT NOT NULL DEFAULT '',
      related_id TEXT NOT NULL DEFAULT '',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      intent TEXT NOT NULL DEFAULT '',
      response_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clinic_id TEXT NOT NULL DEFAULT '${DEFAULT_DEMO_CLINIC_ID}',
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL CHECK (
        resource_type IN (
          'patient',
          'appointment',
          'followup',
          'session',
          'staff',
          'clinic',
          'account',
          'membership',
          'doctor_application',
          'consultation',
          'schedule',
          'notification',
          'patient_link'
        )
      ),
      resource_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Idempotent additive column migrations for existing SQLite files
  for (const table of ['patients', 'appointments', 'followups', 'staff']) {
    if (!hasColumn(db, table, 'clinic_id')) {
      db.exec(
        `ALTER TABLE ${table} ADD COLUMN clinic_id TEXT NOT NULL DEFAULT '${DEFAULT_DEMO_CLINIC_ID}';`
      );
    }
  }

  const patientCols: Array<[string, string]> = [
    ['linked_user_id', 'TEXT NULL'],
    ['emergency_contact_name', "TEXT NOT NULL DEFAULT ''"],
    ['emergency_contact_phone', "TEXT NOT NULL DEFAULT ''"],
    ['claim_code_hash', "TEXT NOT NULL DEFAULT ''"],
    ['claim_code_expires_at', "TEXT NOT NULL DEFAULT ''"],
    ['portal_linked_at', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, def] of patientCols) {
    if (!hasColumn(db, 'patients', col)) {
      db.exec(`ALTER TABLE patients ADD COLUMN ${col} ${def};`);
    }
  }

  const staffCols: Array<[string, string]> = [
    ['user_id', 'TEXT NULL'],
    ['qualifications', "TEXT NOT NULL DEFAULT ''"],
    ['license_number', "TEXT NOT NULL DEFAULT ''"],
    ['bio', "TEXT NOT NULL DEFAULT ''"],
    ['avatar_url', "TEXT NOT NULL DEFAULT ''"],
    ['attendance_status', "TEXT NOT NULL DEFAULT 'On Duty'"],
    ['default_appointment_duration', 'INTEGER NOT NULL DEFAULT 30'],
    ['max_daily_capacity', 'INTEGER NOT NULL DEFAULT 16'],
    ['verification_status', "TEXT NOT NULL DEFAULT 'Approved'"],
  ];
  for (const [col, def] of staffCols) {
    if (!hasColumn(db, 'staff', col)) {
      db.exec(`ALTER TABLE staff ADD COLUMN ${col} ${def};`);
    }
  }

  const aptCols: Array<[string, string]> = [
    ['staff_id', 'TEXT NULL'],
    ['specialty', "TEXT NOT NULL DEFAULT ''"],
    ['appointment_type', "TEXT NOT NULL DEFAULT 'Consultation'"],
    ['requested_by', "TEXT NOT NULL DEFAULT 'staff'"],
    ['request_status', "TEXT NOT NULL DEFAULT 'None'"],
    ['request_notes', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, def] of aptCols) {
    if (!hasColumn(db, 'appointments', col)) {
      db.exec(`ALTER TABLE appointments ADD COLUMN ${col} ${def};`);
    }
  }

  const fuCols: Array<[string, string]> = [
    ['followup_type', "TEXT NOT NULL DEFAULT 'Administrative Contact'"],
    ['assigned_staff_id', 'TEXT NULL'],
    ['assigned_to_name', "TEXT NOT NULL DEFAULT ''"],
    ['reason', "TEXT NOT NULL DEFAULT ''"],
    ['completed_at', 'TEXT NULL'],
    ['completed_by', "TEXT NOT NULL DEFAULT ''"],
    ['completion_notes', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, def] of fuCols) {
    if (!hasColumn(db, 'followups', col)) {
      db.exec(`ALTER TABLE followups ADD COLUMN ${col} ${def};`);
    }
  }

  // Upgrade clinic_memberships & clinic_invitations CHECK constraints for 'Patient' role
  const membershipsSql = getTableCreateSql(db, 'clinic_memberships');
  if (membershipsSql && !membershipsSql.includes("'Patient'")) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      BEGIN TRANSACTION;
      ALTER TABLE clinic_memberships RENAME TO clinic_memberships_legacy;
      CREATE TABLE clinic_memberships (
        id TEXT PRIMARY KEY,
        clinic_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (
          role IN ('Clinic Administrator', 'Doctor', 'Receptionist', 'Clinic Staff', 'Patient')
        ),
        status TEXT NOT NULL CHECK (status IN ('Active', 'Invited', 'Suspended')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(clinic_id, user_id),
        FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO clinic_memberships SELECT * FROM clinic_memberships_legacy;
      DROP TABLE clinic_memberships_legacy;
      COMMIT;
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  }

  const invitationsSql = getTableCreateSql(db, 'clinic_invitations');
  if (invitationsSql && !invitationsSql.includes("'Patient'")) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      BEGIN TRANSACTION;
      ALTER TABLE clinic_invitations RENAME TO clinic_invitations_legacy;
      CREATE TABLE clinic_invitations (
        id TEXT PRIMARY KEY,
        clinic_id TEXT NOT NULL,
        email TEXT NOT NULL,
        full_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL CHECK (
          role IN ('Clinic Administrator', 'Doctor', 'Receptionist', 'Clinic Staff', 'Patient')
        ),
        status TEXT NOT NULL CHECK (status IN ('Pending', 'Accepted', 'Revoked')),
        invited_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(clinic_id, email),
        FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
        FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO clinic_invitations SELECT * FROM clinic_invitations_legacy;
      DROP TABLE clinic_invitations_legacy;
      COMMIT;
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  }

  // Upgrade followups CHECK constraint for 6 lifecycle statuses & map legacy statuses
  const followupsSql = getTableCreateSql(db, 'followups');
  if (followupsSql && !followupsSql.includes("'Overdue'")) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      BEGIN TRANSACTION;
      ALTER TABLE followups RENAME TO followups_legacy;
      CREATE TABLE followups (
        id TEXT PRIMARY KEY,
        clinic_id TEXT NOT NULL DEFAULT '${DEFAULT_DEMO_CLINIC_ID}',
        patient_id TEXT NOT NULL,
        appointment_id TEXT NULL,
        followup_type TEXT NOT NULL DEFAULT 'Administrative Contact',
        assigned_staff_id TEXT NULL,
        assigned_to_name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL CHECK (priority IN ('High', 'Medium', 'Low')),
        created_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('Pending', 'Scheduled', 'Due', 'Overdue', 'Completed', 'Cancelled')
        ),
        completed_at TEXT NULL,
        completed_by TEXT NOT NULL DEFAULT '',
        completion_notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
        FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
      );
      INSERT INTO followups (
        id, clinic_id, patient_id, appointment_id, followup_type, assigned_staff_id, assigned_to_name,
        description, reason, priority, created_date, due_date, status,
        completed_at, completed_by, completion_notes, created_at, updated_at
      )
      SELECT
        id, clinic_id, patient_id, appointment_id, followup_type, assigned_staff_id, assigned_to_name,
        description, reason, priority, created_date, due_date,
        CASE status
          WHEN 'In Progress' THEN 'Scheduled'
          WHEN 'Dismissed' THEN 'Cancelled'
          ELSE status
        END,
        completed_at, completed_by, completion_notes, created_at, updated_at
      FROM followups_legacy;
      DROP TABLE followups_legacy;
      COMMIT;
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  }

  const auditSql = getTableCreateSql(db, 'audit_logs');
  if (
    auditSql &&
    (!auditSql.includes("'clinic'") ||
      !auditSql.includes("'doctor_application'") ||
      !hasColumn(db, 'audit_logs', 'clinic_id'))
  ) {
    const hasClinicCol = hasColumn(db, 'audit_logs', 'clinic_id');
    db.exec(`
      BEGIN TRANSACTION;
      ALTER TABLE audit_logs RENAME TO audit_logs_legacy;
      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clinic_id TEXT NOT NULL DEFAULT '${DEFAULT_DEMO_CLINIC_ID}',
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL CHECK (
          resource_type IN (
            'patient',
            'appointment',
            'followup',
            'session',
            'staff',
            'clinic',
            'account',
            'membership',
            'doctor_application',
            'consultation',
            'schedule',
            'notification',
            'patient_link'
          )
        ),
        resource_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO audit_logs (id, clinic_id, actor, action, resource_type, resource_id, summary, created_at)
      SELECT id, ${hasClinicCol ? 'clinic_id' : `'${DEFAULT_DEMO_CLINIC_ID}'`}, actor, action, resource_type, resource_id, summary, created_at
      FROM audit_logs_legacy;
      DROP TABLE audit_logs_legacy;
      COMMIT;
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON clinic_memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_clinic ON clinic_memberships(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_patients_linked_user ON patients(linked_user_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_clinic_date ON appointments(clinic_id, appointment_date);
    CREATE INDEX IF NOT EXISTS idx_appointments_staff ON appointments(staff_id);
    CREATE INDEX IF NOT EXISTS idx_followups_clinic_status ON followups(clinic_id, status);
    CREATE INDEX IF NOT EXISTS idx_followups_assigned_staff ON followups(assigned_staff_id);
    CREATE INDEX IF NOT EXISTS idx_staff_clinic ON staff(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_staff_user ON staff(user_id);
    CREATE INDEX IF NOT EXISTS idx_doctor_apps_clinic ON doctor_applications(clinic_id, status);
    CREATE INDEX IF NOT EXISTS idx_doctor_apps_user ON doctor_applications(user_id);
    CREATE INDEX IF NOT EXISTS idx_doctor_sched_staff ON doctor_schedules(clinic_id, staff_id);
    CREATE INDEX IF NOT EXISTS idx_doctor_unavail_staff ON doctor_unavailability(clinic_id, staff_id, start_date);
    CREATE INDEX IF NOT EXISTS idx_patient_links_clinic ON patient_link_requests(clinic_id, status);
    CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations(clinic_id, patient_id);
    CREATE INDEX IF NOT EXISTS idx_consultations_staff ON consultations(clinic_id, staff_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(clinic_id, user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_notifications_patient ON notifications(clinic_id, patient_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(clinic_id, user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_audit_clinic ON audit_logs(clinic_id, id DESC);
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
