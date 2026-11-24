import type { DatabaseSync } from 'node:sqlite';
import { addDaysToDateString, getClinicTodayDate } from '../domain/rules';

interface SeedPatient {
  id: string;
  fullName: string;
  dateOfBirth: string;
  contactNumber: string;
  email: string;
  registrationDate: string;
  administrativeStatus: 'Active' | 'Pending Verification' | 'Inactive';
}

interface SeedAppointment {
  id: string;
  patientId: string;
  dayOffset: number;
  appointmentTime: string;
  durationMinutes: number;
  department: string;
  clinician: string;
  status: 'Scheduled' | 'Confirmed' | 'Completed' | 'Cancelled' | 'Missed';
  notes: string;
}

interface SeedFollowUp {
  id: string;
  patientId: string;
  appointmentId: string | null;
  description: string;
  priority: 'High' | 'Medium' | 'Low';
  createdOffset: number;
  dueOffset: number;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Dismissed';
}

const SEED_PATIENTS: SeedPatient[] = [
  { id: 'P-1025', fullName: 'Eleanor Vance', dateOfBirth: '1978-04-12', contactNumber: '+1-555-0142', email: 'eleanor.vance@example.org', registrationDate: '2024-02-10', administrativeStatus: 'Active' },
  { id: 'P-1026', fullName: 'Marcus Holloway', dateOfBirth: '1985-09-23', contactNumber: '+1-555-0143', email: 'marcus.holloway@example.org', registrationDate: '2024-03-14', administrativeStatus: 'Active' },
  { id: 'P-1027', fullName: 'Nadia Al-Mansoor', dateOfBirth: '1991-01-19', contactNumber: '+1-555-0144', email: 'nadia.mansoor@example.org', registrationDate: '2024-04-02', administrativeStatus: 'Active' },
  { id: 'P-1028', fullName: 'Arthur Pendelton', dateOfBirth: '1964-11-05', contactNumber: '+1-555-0145', email: 'arthur.pendelton@example.org', registrationDate: '2024-05-19', administrativeStatus: 'Active' },
  { id: 'P-1029', fullName: 'Claire Beaumont', dateOfBirth: '1989-07-30', contactNumber: '+1-555-0146', email: 'claire.beaumont@example.org', registrationDate: '2024-06-08', administrativeStatus: 'Active' },
  { id: 'P-1030', fullName: 'Tomasz Zielinski', dateOfBirth: '1973-03-17', contactNumber: '+1-555-0147', email: 'tomasz.zielinski@example.org', registrationDate: '2024-07-21', administrativeStatus: 'Pending Verification' },
  { id: 'P-1031', fullName: 'Mei-Ling Zhou', dateOfBirth: '1996-12-03', contactNumber: '+1-555-0148', email: 'meiling.zhou@example.org', registrationDate: '2024-08-11', administrativeStatus: 'Active' },
  { id: 'P-1032', fullName: 'Derrick Thorne', dateOfBirth: '1959-08-28', contactNumber: '+1-555-0149', email: 'derrick.thorne@example.org', registrationDate: '2024-09-05', administrativeStatus: 'Active' },
  { id: 'P-1033', fullName: 'Sofia Castellanos', dateOfBirth: '1982-06-14', contactNumber: '+1-555-0150', email: 'sofia.castellanos@example.org', registrationDate: '2024-10-16', administrativeStatus: 'Active' },
  { id: 'P-1034', fullName: 'Kenneth Osei', dateOfBirth: '1976-02-25', contactNumber: '+1-555-0151', email: 'kenneth.osei@example.org', registrationDate: '2024-11-01', administrativeStatus: 'Active' },
  { id: 'P-1035', fullName: 'Hannah Gallagher', dateOfBirth: '1993-10-09', contactNumber: '+1-555-0152', email: 'hannah.gallagher@example.org', registrationDate: '2025-01-12', administrativeStatus: 'Pending Verification' },
  { id: 'P-1036', fullName: 'Ravi Deshmukh', dateOfBirth: '1969-05-22', contactNumber: '+1-555-0153', email: 'ravi.deshmukh@example.org', registrationDate: '2025-02-07', administrativeStatus: 'Active' },
  { id: 'P-1037', fullName: 'Beatrice Solis', dateOfBirth: '1987-09-11', contactNumber: '+1-555-0154', email: 'beatrice.solis@example.org', registrationDate: '2025-03-19', administrativeStatus: 'Active' },
  { id: 'P-1038', fullName: 'Gabriel Novak', dateOfBirth: '1999-03-04', contactNumber: '+1-555-0155', email: 'gabriel.novak@example.org', registrationDate: '2025-04-28', administrativeStatus: 'Active' },
  { id: 'P-1039', fullName: 'Miriam Goldstein', dateOfBirth: '1955-12-18', contactNumber: '+1-555-0156', email: 'miriam.goldstein@example.org', registrationDate: '2025-05-15', administrativeStatus: 'Active' },
  { id: 'P-1040', fullName: 'Lucas Lindholm', dateOfBirth: '1981-07-02', contactNumber: '+1-555-0157', email: 'lucas.lindholm@example.org', registrationDate: '2025-06-22', administrativeStatus: 'Inactive' },
  { id: 'P-1041', fullName: 'Amara Nwosu', dateOfBirth: '1990-11-27', contactNumber: '+1-555-0158', email: 'amara.nwosu@example.org', registrationDate: '2025-07-10', administrativeStatus: 'Active' },
  { id: 'P-1042', fullName: 'Julian Mercer', dateOfBirth: '1984-04-06', contactNumber: '+1-555-0159', email: 'julian.mercer@example.org', registrationDate: '2025-08-18', administrativeStatus: 'Active' },
  { id: 'P-1043', fullName: 'Yuki Takahashi', dateOfBirth: '1971-08-15', contactNumber: '+1-555-0160', email: 'yuki.takahashi@example.org', registrationDate: '2025-09-29', administrativeStatus: 'Active' },
  { id: 'P-1044', fullName: 'Oliver Prescott', dateOfBirth: '2016-05-03', contactNumber: '+1-555-0161', email: 'prescott.family@example.org', registrationDate: '2025-10-14', administrativeStatus: 'Active' },
  { id: 'P-1045', fullName: 'Fatima Zahra', dateOfBirth: '1994-01-24', contactNumber: '+1-555-0162', email: 'fatima.zahra@example.org', registrationDate: '2025-11-08', administrativeStatus: 'Pending Verification' },
  { id: 'P-1046', fullName: 'Victor Kowalski', dateOfBirth: '1967-06-30', contactNumber: '+1-555-0163', email: 'victor.kowalski@example.org', registrationDate: '2026-01-19', administrativeStatus: 'Active' },
  { id: 'P-1047', fullName: 'Camila Rojas', dateOfBirth: '1988-10-12', contactNumber: '+1-555-0164', email: 'camila.rojas@example.org', registrationDate: '2026-02-26', administrativeStatus: 'Active' },
  { id: 'P-1048', fullName: 'Henrik Sorensen', dateOfBirth: '1975-03-08', contactNumber: '+1-555-0165', email: 'henrik.sorensen@example.org', registrationDate: '2026-04-04', administrativeStatus: 'Active' },
];

const SEED_APPOINTMENTS: SeedAppointment[] = [
  // Day -6
  { id: 'APT-2001', patientId: 'P-1025', dayOffset: -6, appointmentTime: '09:00', durationMinutes: 30, department: 'Cardiology', clinician: 'Dr. Samuel Okafor', status: 'Completed', notes: 'Annual administrative check-in completed.' },
  { id: 'APT-2002', patientId: 'P-1026', dayOffset: -6, appointmentTime: '10:30', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Priya Patel', status: 'Completed', notes: 'Standard intake and form renewal.' },
  { id: 'APT-2003', patientId: 'P-1030', dayOffset: -6, appointmentTime: '14:00', durationMinutes: 30, department: 'Orthopedics', clinician: 'Dr. Clara Chen', status: 'Missed', notes: 'Patient did not check in at reception.' },
  { id: 'APT-2004', patientId: 'P-1027', dayOffset: -6, appointmentTime: '15:30', durationMinutes: 30, department: 'Dermatology', clinician: 'Dr. David Morales', status: 'Cancelled', notes: 'Cancelled 24 hours in advance by patient.' },

  // Day -5
  { id: 'APT-2005', patientId: 'P-1028', dayOffset: -5, appointmentTime: '09:30', durationMinutes: 30, department: 'Cardiology', clinician: 'Dr. Samuel Okafor', status: 'Completed', notes: 'Routine administrative follow-through.' },
  { id: 'APT-2006', patientId: 'P-1029', dayOffset: -5, appointmentTime: '11:00', durationMinutes: 30, department: 'Pediatrics', clinician: 'Dr. Hannah Lindqvist', status: 'Completed', notes: 'Guardian paperwork verified.' },
  { id: 'APT-2007', patientId: 'P-1031', dayOffset: -5, appointmentTime: '13:30', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Robert Kim', status: 'Missed', notes: 'No-show; phone call unanswered at 13:45.' },
  { id: 'APT-2008', patientId: 'P-1032', dayOffset: -5, appointmentTime: '16:00', durationMinutes: 30, department: 'Orthopedics', clinician: 'Dr. Clara Chen', status: 'Completed', notes: 'Referral records attached.' },

  // Day -4
  { id: 'APT-2009', patientId: 'P-1033', dayOffset: -4, appointmentTime: '08:30', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Priya Patel', status: 'Completed', notes: 'Completed morning visit.' },
  { id: 'APT-2010', patientId: 'P-1034', dayOffset: -4, appointmentTime: '10:00', durationMinutes: 30, department: 'Dermatology', clinician: 'Dr. David Morales', status: 'Completed', notes: 'Intake verification signed.' },
  { id: 'APT-2011', patientId: 'P-1035', dayOffset: -4, appointmentTime: '11:30', durationMinutes: 30, department: 'Cardiology', clinician: 'Dr. Samuel Okafor', status: 'Missed', notes: 'Missed morning slot; insurance card verification still pending.' },
  { id: 'APT-2012', patientId: 'P-1036', dayOffset: -4, appointmentTime: '14:30', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Robert Kim', status: 'Completed', notes: 'Visit completed on schedule.' },

  // Day -3
  { id: 'APT-2013', patientId: 'P-1037', dayOffset: -3, appointmentTime: '09:00', durationMinutes: 30, department: 'Dermatology', clinician: 'Dr. David Morales', status: 'Completed', notes: 'Routine review completed.' },
  { id: 'APT-2014', patientId: 'P-1038', dayOffset: -3, appointmentTime: '10:30', durationMinutes: 30, department: 'Orthopedics', clinician: 'Dr. Clara Chen', status: 'Cancelled', notes: 'Reschedule requested due to transit delay.' },
  { id: 'APT-2015', patientId: 'P-1039', dayOffset: -3, appointmentTime: '13:00', durationMinutes: 30, department: 'Cardiology', clinician: 'Dr. Samuel Okafor', status: 'Completed', notes: 'Check-in completed.' },
  { id: 'APT-2016', patientId: 'P-1041', dayOffset: -3, appointmentTime: '15:00', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Priya Patel', status: 'Missed', notes: 'Patient missed afternoon check-in; voicemail left.' },

  // Day -2
  { id: 'APT-2017', patientId: 'P-1043', dayOffset: -2, appointmentTime: '09:30', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Robert Kim', status: 'Completed', notes: 'Completed administrative review.' },
  { id: 'APT-2018', patientId: 'P-1044', dayOffset: -2, appointmentTime: '11:00', durationMinutes: 30, department: 'Pediatrics', clinician: 'Dr. Hannah Lindqvist', status: 'Completed', notes: 'Immunization form archived.' },
  { id: 'APT-2019', patientId: 'P-1042', dayOffset: -2, appointmentTime: '14:00', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Priya Patel', status: 'Missed', notes: 'Patient P-1042 missed scheduled appointment; requires rescheduling.' },
  { id: 'APT-2020', patientId: 'P-1046', dayOffset: -2, appointmentTime: '16:00', durationMinutes: 30, department: 'Cardiology', clinician: 'Dr. Samuel Okafor', status: 'Completed', notes: 'Completed on time.' },

  // Day -1 (Yesterday)
  { id: 'APT-2021', patientId: 'P-1047', dayOffset: -1, appointmentTime: '08:30', durationMinutes: 30, department: 'Dermatology', clinician: 'Dr. David Morales', status: 'Completed', notes: 'Morning slot completed.' },
  { id: 'APT-2022', patientId: 'P-1048', dayOffset: -1, appointmentTime: '10:00', durationMinutes: 30, department: 'Orthopedics', clinician: 'Dr. Clara Chen', status: 'Completed', notes: 'Completed on schedule.' },
  { id: 'APT-2023', patientId: 'P-1025', dayOffset: -1, appointmentTime: '13:30', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Priya Patel', status: 'Completed', notes: 'Administrative records updated.' },
  { id: 'APT-2024', patientId: 'P-1045', dayOffset: -1, appointmentTime: '15:30', durationMinutes: 30, department: 'Cardiology', clinician: 'Dr. Samuel Okafor', status: 'Missed', notes: 'Missed check-in; patient asked for afternoon callback.' },

  // Day 0 (Today - Demo 1 Briefing + Unconfirmed + Upcoming)
  { id: 'APT-2025', patientId: 'P-1026', dayOffset: 0, appointmentTime: '08:30', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Priya Patel', status: 'Completed', notes: 'Morning intake completed.' },
  { id: 'APT-2026', patientId: 'P-1028', dayOffset: 0, appointmentTime: '09:30', durationMinutes: 30, department: 'Cardiology', clinician: 'Dr. Samuel Okafor', status: 'Confirmed', notes: 'SMS confirmation received.' },
  { id: 'APT-2027', patientId: 'P-1032', dayOffset: 0, appointmentTime: '10:30', durationMinutes: 30, department: 'Orthopedics', clinician: 'Dr. Clara Chen', status: 'Confirmed', notes: 'Checked in ahead of slot.' },
  { id: 'APT-2028', patientId: 'P-1033', dayOffset: 0, appointmentTime: '11:30', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Robert Kim', status: 'Missed', notes: 'Missed late-morning slot.' },
  { id: 'APT-2029', patientId: 'P-1037', dayOffset: 0, appointmentTime: '13:30', durationMinutes: 30, department: 'Dermatology', clinician: 'Dr. David Morales', status: 'Scheduled', notes: 'Awaiting patient SMS confirmation.' },
  { id: 'APT-2030', patientId: 'P-1044', dayOffset: 0, appointmentTime: '14:30', durationMinutes: 30, department: 'Pediatrics', clinician: 'Dr. Hannah Lindqvist', status: 'Confirmed', notes: 'Parent confirmed attendance.' },
  { id: 'APT-2031', patientId: 'P-1039', dayOffset: 0, appointmentTime: '15:30', durationMinutes: 30, department: 'Cardiology', clinician: 'Dr. Samuel Okafor', status: 'Scheduled', notes: 'Reminder pending confirmation.' },
  { id: 'APT-2032', patientId: 'P-1047', dayOffset: 0, appointmentTime: '16:30', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Priya Patel', status: 'Confirmed', notes: 'Pre-registration complete.' },

  // Day +1 (Tomorrow — deliberately leaves 09:00, 09:30, 10:00 open for Dr. Priya Patel for Demo 3 rescheduling!)
  { id: 'APT-2033', patientId: 'P-1027', dayOffset: 1, appointmentTime: '10:30', durationMinutes: 30, department: 'Dermatology', clinician: 'Dr. David Morales', status: 'Confirmed', notes: 'Confirmed by phone.' },
  { id: 'APT-2034', patientId: 'P-1034', dayOffset: 1, appointmentTime: '11:00', durationMinutes: 30, department: 'General Medicine', clinician: 'Dr. Priya Patel', status: 'Scheduled', notes: 'Unconfirmed afternoon-prep check.' },
  { id: 'APT-2035', patientId: 'P-1043', dayOffset: 1, appointmentTime: '14:00', durationMinutes: 30, department: 'Orthopedics', clinician: 'Dr. Clara Chen', status: 'Confirmed', notes: 'Confirmed.' },

  // Day +2 & +3
  { id: 'APT-2036', patientId: 'P-1029', dayOffset: 2, appointmentTime: '09:30', durationMinutes: 30, department: 'Pediatrics', clinician: 'Dr. Hannah Lindqvist', status: 'Scheduled', notes: 'Confirmation notice queued.' },
  { id: 'APT-2037', patientId: 'P-1046', dayOffset: 2, appointmentTime: '11:30', durationMinutes: 30, department: 'Cardiology', clinician: 'Dr. Samuel Okafor', status: 'Confirmed', notes: 'Confirmed.' },
  { id: 'APT-2038', patientId: 'P-1048', dayOffset: 3, appointmentTime: '10:00', durationMinutes: 30, department: 'Orthopedics', clinician: 'Dr. Clara Chen', status: 'Scheduled', notes: 'Initial intake scheduled.' },
];

const SEED_FOLLOWUPS: SeedFollowUp[] = [
  { id: 'FU-3001', patientId: 'P-1030', appointmentId: 'APT-2003', description: 'Confirm updated mailing address and rebook Orthopedics slot after no-show.', priority: 'High', createdOffset: -6, dueOffset: 0, status: 'Pending' },
  { id: 'FU-3002', patientId: 'P-1031', appointmentId: 'APT-2007', description: 'Attempt second outreach call for missed General Medicine check-in.', priority: 'Medium', createdOffset: -5, dueOffset: 1, status: 'In Progress' },
  { id: 'FU-3003', patientId: 'P-1035', appointmentId: 'APT-2011', description: 'Verify insurance coverage documents and reschedule Cardiology visit.', priority: 'High', createdOffset: -4, dueOffset: 0, status: 'Pending' },
  { id: 'FU-3004', patientId: 'P-1042', appointmentId: 'APT-2019', description: 'Reschedule Julian Mercer (P-1042) into next open General Medicine slot with Dr. Priya Patel.', priority: 'High', createdOffset: -2, dueOffset: 1, status: 'Pending' },
  { id: 'FU-3005', patientId: 'P-1037', appointmentId: 'APT-2029', description: 'Place confirmation reminder call for today 13:30 Dermatology appointment.', priority: 'High', createdOffset: 0, dueOffset: 0, status: 'Pending' },
  { id: 'FU-3006', patientId: 'P-1039', appointmentId: 'APT-2031', description: 'Confirm Cardiology attendance for 15:30 today with Dr. Okafor.', priority: 'Medium', createdOffset: 0, dueOffset: 0, status: 'Pending' },
  { id: 'FU-3007', patientId: 'P-1038', appointmentId: 'APT-2014', description: 'Offer alternative Orthopedics morning slots following transit cancellation.', priority: 'Low', createdOffset: -3, dueOffset: 2, status: 'Completed' },
  { id: 'FU-3008', patientId: 'P-1027', appointmentId: 'APT-2004', description: 'Archive cancellation notice and confirm next Dermatology booking.', priority: 'Low', createdOffset: -6, dueOffset: -1, status: 'Completed' },
  { id: 'FU-3009', patientId: 'P-1034', appointmentId: 'APT-2034', description: 'Send digital pre-check-in link for tomorrow General Medicine visit.', priority: 'Medium', createdOffset: -1, dueOffset: 1, status: 'Pending' },
  { id: 'FU-3010', patientId: 'P-1029', appointmentId: 'APT-2036', description: 'Verify guardian consent form on file prior to Pediatrics slot.', priority: 'Low', createdOffset: -1, dueOffset: 2, status: 'In Progress' },
  { id: 'FU-3011', patientId: 'P-1040', appointmentId: null, description: 'Annual administrative status review for inactive patient file.', priority: 'Low', createdOffset: -5, dueOffset: 4, status: 'Dismissed' },
  { id: 'FU-3012', patientId: 'P-1046', appointmentId: 'APT-2020', description: 'Send post-visit administrative satisfaction survey.', priority: 'Low', createdOffset: -2, dueOffset: 3, status: 'Completed' },
];

export function seedDatabaseIfEmpty(db: DatabaseSync, referenceToday?: string): void {
  const row = db.prepare('SELECT COUNT(*) AS count FROM patients').get() as { count: number };
  if (row.count > 0) {
    return;
  }

  const today = referenceToday ?? getClinicTodayDate();
  const nowIso = new Date().toISOString();

  const insertPatient = db.prepare(`
    INSERT INTO patients (
      id, full_name, date_of_birth, contact_number, email,
      registration_date, administrative_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAppointment = db.prepare(`
    INSERT INTO appointments (
      id, patient_id, appointment_date, appointment_time, duration_minutes,
      department, clinician, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertFollowUp = db.prepare(`
    INSERT INTO followups (
      id, patient_id, appointment_id, description, priority,
      created_date, due_date, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (actor, action, resource_type, resource_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN TRANSACTION;');
  try {
    for (const p of SEED_PATIENTS) {
      insertPatient.run(
        p.id,
        p.fullName,
        p.dateOfBirth,
        p.contactNumber,
        p.email,
        p.registrationDate,
        p.administrativeStatus,
        nowIso
      );
    }

    for (const a of SEED_APPOINTMENTS) {
      const date = addDaysToDateString(today, a.dayOffset);
      insertAppointment.run(
        a.id,
        a.patientId,
        date,
        a.appointmentTime,
        a.durationMinutes,
        a.department,
        a.clinician,
        a.status,
        a.notes,
        nowIso,
        nowIso
      );
    }

    for (const f of SEED_FOLLOWUPS) {
      const createdDate = addDaysToDateString(today, f.createdOffset);
      const dueDate = addDaysToDateString(today, f.dueOffset);
      insertFollowUp.run(
        f.id,
        f.patientId,
        f.appointmentId,
        f.description,
        f.priority,
        createdDate,
        dueDate,
        f.status,
        nowIso,
        nowIso
      );
    }

    insertAudit.run(
      'System Seed',
      'INITIALIZE_DEMO_DATA',
      'session',
      'CAREDESK-SEED',
      `Seeded ${SEED_PATIENTS.length} synthetic patients, ${SEED_APPOINTMENTS.length} appointments, and ${SEED_FOLLOWUPS.length} follow-up tasks.`,
      nowIso
    );
    insertAudit.run(
      'Intake Desk',
      'CREATE_FOLLOWUP',
      'followup',
      'FU-3004',
      'Flagged Julian Mercer (P-1042) missed appointment APT-2019 for rescheduling.',
      nowIso
    );
    insertAudit.run(
      'Front Desk Coordinator',
      'CONFIRM_APPOINTMENT',
      'appointment',
      'APT-2030',
      'Confirmed Pediatrics slot APT-2030 for Oliver Prescott (P-1044) today at 14:30.',
      nowIso
    );

    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}
