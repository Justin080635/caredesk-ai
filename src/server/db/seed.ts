import type { DatabaseSync } from 'node:sqlite';
import { CLINIC_CLINICIANS } from '../../shared/constants';
import type {
  AppointmentType,
  FollowUpStatus,
  FollowUpType,
  PrescriptionItem,
  StaffRole,
  StaffStatus,
  TestResultItem,
} from '../../shared/types';
import { addDaysToDateString, getClinicTodayDate } from '../domain/rules';
import { DEFAULT_DEMO_CLINIC_ID } from './database';

interface SeedPatient {
  id: string;
  fullName: string;
  dateOfBirth: string;
  contactNumber: string;
  email: string;
  registrationDate: string;
  administrativeStatus: 'Active' | 'Pending Verification' | 'Inactive';
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

interface SeedAppointment {
  id: string;
  patientId: string;
  dayOffset: number;
  appointmentTime: string;
  durationMinutes: number;
  department: string;
  appointmentType: AppointmentType;
  clinician: string;
  status: 'Scheduled' | 'Confirmed' | 'Completed' | 'Cancelled' | 'Missed';
  notes: string;
}

interface SeedFollowUp {
  id: string;
  patientId: string;
  appointmentId: string | null;
  followupType: FollowUpType;
  assignedClinicianName?: string;
  description: string;
  reason: string;
  priority: 'High' | 'Medium' | 'Low';
  createdOffset: number;
  dueOffset: number;
  status: FollowUpStatus;
  completionNotes?: string;
}

const SEED_PATIENTS: SeedPatient[] = [
  { id: 'P-1025', fullName: 'Eleanor Vance', dateOfBirth: '1978-04-12', contactNumber: '+1-555-0142', email: 'eleanor.vance@example.org', registrationDate: '2024-02-10', administrativeStatus: 'Active', emergencyContactName: 'Arthur Vance', emergencyContactPhone: '+1-555-0942' },
  { id: 'P-1026', fullName: 'Marcus Holloway', dateOfBirth: '1985-09-23', contactNumber: '+1-555-0143', email: 'marcus.holloway@example.org', registrationDate: '2024-03-14', administrativeStatus: 'Active', emergencyContactName: 'Elena Holloway', emergencyContactPhone: '+1-555-0943' },
  { id: 'P-1027', fullName: 'Nadia Al-Mansoor', dateOfBirth: '1991-01-19', contactNumber: '+1-555-0144', email: 'nadia.mansoor@example.org', registrationDate: '2024-04-02', administrativeStatus: 'Active' },
  { id: 'P-1028', fullName: 'Arthur Pendelton', dateOfBirth: '1964-11-05', contactNumber: '+1-555-0145', email: 'arthur.pendelton@example.org', registrationDate: '2024-05-19', administrativeStatus: 'Active', emergencyContactName: 'Clara Pendelton', emergencyContactPhone: '+1-555-0945' },
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
  { id: 'APT-2001', patientId: 'P-1025', dayOffset: -6, appointmentTime: '09:00', durationMinutes: 30, department: 'Cardiology', appointmentType: 'Consultation', clinician: 'Dr. Samuel Okafor', status: 'Completed', notes: 'Annual cardiovascular check-in completed.' },
  { id: 'APT-2002', patientId: 'P-1026', dayOffset: -6, appointmentTime: '10:30', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Consultation', clinician: 'Dr. Priya Patel', status: 'Completed', notes: 'Standard intake and form renewal.' },
  { id: 'APT-2003', patientId: 'P-1030', dayOffset: -6, appointmentTime: '14:00', durationMinutes: 30, department: 'Orthopedics', appointmentType: 'New Patient', clinician: 'Dr. Clara Chen', status: 'Missed', notes: 'Patient did not check in at reception.' },
  { id: 'APT-2004', patientId: 'P-1027', dayOffset: -6, appointmentTime: '15:30', durationMinutes: 30, department: 'Dermatology', appointmentType: 'Consultation', clinician: 'Dr. David Morales', status: 'Cancelled', notes: 'Cancelled 24 hours in advance by patient.' },

  // Day -5
  { id: 'APT-2005', patientId: 'P-1028', dayOffset: -5, appointmentTime: '09:30', durationMinutes: 30, department: 'Cardiology', appointmentType: 'Follow-Up', clinician: 'Dr. Samuel Okafor', status: 'Completed', notes: 'Blood pressure & lipid review.' },
  { id: 'APT-2006', patientId: 'P-1029', dayOffset: -5, appointmentTime: '11:00', durationMinutes: 30, department: 'Pediatrics', appointmentType: 'Consultation', clinician: 'Dr. Hannah Lindqvist', status: 'Completed', notes: 'Guardian paperwork verified.' },
  { id: 'APT-2007', patientId: 'P-1031', dayOffset: -5, appointmentTime: '13:30', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Consultation', clinician: 'Dr. Robert Kim', status: 'Missed', notes: 'No-show; phone call unanswered at 13:45.' },
  { id: 'APT-2008', patientId: 'P-1032', dayOffset: -5, appointmentTime: '16:00', durationMinutes: 30, department: 'Orthopedics', appointmentType: 'Follow-Up', clinician: 'Dr. Clara Chen', status: 'Completed', notes: 'Referral records attached.' },

  // Day -4
  { id: 'APT-2009', patientId: 'P-1033', dayOffset: -4, appointmentTime: '08:30', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Consultation', clinician: 'Dr. Priya Patel', status: 'Completed', notes: 'Completed morning visit.' },
  { id: 'APT-2010', patientId: 'P-1034', dayOffset: -4, appointmentTime: '10:00', durationMinutes: 30, department: 'Dermatology', appointmentType: 'Consultation', clinician: 'Dr. David Morales', status: 'Completed', notes: 'Intake verification signed.' },
  { id: 'APT-2011', patientId: 'P-1035', dayOffset: -4, appointmentTime: '11:30', durationMinutes: 30, department: 'Cardiology', appointmentType: 'New Patient', clinician: 'Dr. Samuel Okafor', status: 'Missed', notes: 'Missed morning slot; insurance card verification still pending.' },
  { id: 'APT-2012', patientId: 'P-1036', dayOffset: -4, appointmentTime: '14:30', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Follow-Up', clinician: 'Dr. Robert Kim', status: 'Completed', notes: 'Visit completed on schedule.' },

  // Day -3
  { id: 'APT-2013', patientId: 'P-1037', dayOffset: -3, appointmentTime: '09:00', durationMinutes: 30, department: 'Dermatology', appointmentType: 'Follow-Up', clinician: 'Dr. David Morales', status: 'Completed', notes: 'Routine review completed.' },
  { id: 'APT-2014', patientId: 'P-1038', dayOffset: -3, appointmentTime: '10:30', durationMinutes: 30, department: 'Orthopedics', appointmentType: 'Consultation', clinician: 'Dr. Clara Chen', status: 'Cancelled', notes: 'Reschedule requested due to transit delay.' },
  { id: 'APT-2015', patientId: 'P-1039', dayOffset: -3, appointmentTime: '13:00', durationMinutes: 30, department: 'Cardiology', appointmentType: 'Follow-Up', clinician: 'Dr. Samuel Okafor', status: 'Completed', notes: 'Check-in completed.' },
  { id: 'APT-2016', patientId: 'P-1041', dayOffset: -3, appointmentTime: '15:00', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Consultation', clinician: 'Dr. Priya Patel', status: 'Missed', notes: 'Patient missed afternoon check-in; voicemail left.' },

  // Day -2
  { id: 'APT-2017', patientId: 'P-1043', dayOffset: -2, appointmentTime: '09:30', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Consultation', clinician: 'Dr. Robert Kim', status: 'Completed', notes: 'Completed administrative review.' },
  { id: 'APT-2018', patientId: 'P-1044', dayOffset: -2, appointmentTime: '11:00', durationMinutes: 30, department: 'Pediatrics', appointmentType: 'Consultation', clinician: 'Dr. Hannah Lindqvist', status: 'Completed', notes: 'Immunization form archived.' },
  { id: 'APT-2019', patientId: 'P-1042', dayOffset: -2, appointmentTime: '14:00', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Consultation', clinician: 'Dr. Priya Patel', status: 'Missed', notes: 'Patient P-1042 missed scheduled appointment; requires rescheduling.' },
  { id: 'APT-2020', patientId: 'P-1046', dayOffset: -2, appointmentTime: '16:00', durationMinutes: 30, department: 'Cardiology', appointmentType: 'Follow-Up', clinician: 'Dr. Samuel Okafor', status: 'Completed', notes: 'Completed on time.' },

  // Day -1 (Yesterday)
  { id: 'APT-2021', patientId: 'P-1047', dayOffset: -1, appointmentTime: '08:30', durationMinutes: 30, department: 'Dermatology', appointmentType: 'Consultation', clinician: 'Dr. David Morales', status: 'Completed', notes: 'Morning slot completed.' },
  { id: 'APT-2022', patientId: 'P-1048', dayOffset: -1, appointmentTime: '10:00', durationMinutes: 30, department: 'Orthopedics', appointmentType: 'Consultation', clinician: 'Dr. Clara Chen', status: 'Completed', notes: 'Completed on schedule.' },
  { id: 'APT-2023', patientId: 'P-1025', dayOffset: -1, appointmentTime: '13:30', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Follow-Up', clinician: 'Dr. Priya Patel', status: 'Completed', notes: 'Administrative records updated.' },
  { id: 'APT-2024', patientId: 'P-1045', dayOffset: -1, appointmentTime: '15:30', durationMinutes: 30, department: 'Cardiology', appointmentType: 'New Patient', clinician: 'Dr. Samuel Okafor', status: 'Missed', notes: 'Missed check-in; patient asked for afternoon callback.' },

  // Day 0 (Today)
  { id: 'APT-2025', patientId: 'P-1026', dayOffset: 0, appointmentTime: '08:30', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Consultation', clinician: 'Dr. Priya Patel', status: 'Completed', notes: 'Morning intake completed.' },
  { id: 'APT-2026', patientId: 'P-1028', dayOffset: 0, appointmentTime: '09:30', durationMinutes: 30, department: 'Cardiology', appointmentType: 'Follow-Up', clinician: 'Dr. Samuel Okafor', status: 'Confirmed', notes: 'SMS confirmation received.' },
  { id: 'APT-2027', patientId: 'P-1032', dayOffset: 0, appointmentTime: '10:30', durationMinutes: 30, department: 'Orthopedics', appointmentType: 'Follow-Up', clinician: 'Dr. Clara Chen', status: 'Confirmed', notes: 'Checked in ahead of slot.' },
  { id: 'APT-2028', patientId: 'P-1033', dayOffset: 0, appointmentTime: '11:30', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Consultation', clinician: 'Dr. Robert Kim', status: 'Missed', notes: 'Missed late-morning slot.' },
  { id: 'APT-2029', patientId: 'P-1037', dayOffset: 0, appointmentTime: '13:30', durationMinutes: 30, department: 'Dermatology', appointmentType: 'Consultation', clinician: 'Dr. David Morales', status: 'Scheduled', notes: 'Awaiting patient SMS confirmation.' },
  { id: 'APT-2030', patientId: 'P-1044', dayOffset: 0, appointmentTime: '14:30', durationMinutes: 30, department: 'Pediatrics', appointmentType: 'Consultation', clinician: 'Dr. Hannah Lindqvist', status: 'Confirmed', notes: 'Parent confirmed attendance.' },
  { id: 'APT-2031', patientId: 'P-1039', dayOffset: 0, appointmentTime: '15:30', durationMinutes: 30, department: 'Cardiology', appointmentType: 'Follow-Up', clinician: 'Dr. Samuel Okafor', status: 'Scheduled', notes: 'Reminder pending confirmation.' },
  { id: 'APT-2032', patientId: 'P-1047', dayOffset: 0, appointmentTime: '16:30', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Consultation', clinician: 'Dr. Priya Patel', status: 'Confirmed', notes: 'Pre-registration complete.' },

  // Day +1
  { id: 'APT-2033', patientId: 'P-1027', dayOffset: 1, appointmentTime: '10:30', durationMinutes: 30, department: 'Dermatology', appointmentType: 'Consultation', clinician: 'Dr. David Morales', status: 'Confirmed', notes: 'Confirmed by phone.' },
  { id: 'APT-2034', patientId: 'P-1034', dayOffset: 1, appointmentTime: '11:00', durationMinutes: 30, department: 'General Medicine', appointmentType: 'Consultation', clinician: 'Dr. Priya Patel', status: 'Scheduled', notes: 'Unconfirmed afternoon-prep check.' },
  { id: 'APT-2035', patientId: 'P-1043', dayOffset: 1, appointmentTime: '14:00', durationMinutes: 30, department: 'Orthopedics', appointmentType: 'Consultation', clinician: 'Dr. Clara Chen', status: 'Confirmed', notes: 'Confirmed.' },

  // Day +2 & +3
  { id: 'APT-2036', patientId: 'P-1029', dayOffset: 2, appointmentTime: '09:30', durationMinutes: 30, department: 'Pediatrics', appointmentType: 'Consultation', clinician: 'Dr. Hannah Lindqvist', status: 'Scheduled', notes: 'Confirmation notice queued.' },
  { id: 'APT-2037', patientId: 'P-1046', dayOffset: 2, appointmentTime: '11:30', durationMinutes: 30, department: 'Cardiology', appointmentType: 'Follow-Up', clinician: 'Dr. Samuel Okafor', status: 'Confirmed', notes: 'Confirmed.' },
  { id: 'APT-2038', patientId: 'P-1048', dayOffset: 3, appointmentTime: '10:00', durationMinutes: 30, department: 'Orthopedics', appointmentType: 'New Patient', clinician: 'Dr. Clara Chen', status: 'Scheduled', notes: 'Initial intake scheduled.' },
];

const SEED_FOLLOWUPS: SeedFollowUp[] = [
  { id: 'FU-3001', patientId: 'P-1030', appointmentId: 'APT-2003', followupType: 'Administrative Contact', assignedClinicianName: 'Front Desk Coordinator', description: 'Confirm updated mailing address and rebook Orthopedics slot after no-show.', reason: 'Missed initial Orthopedics consultation', priority: 'High', createdOffset: -6, dueOffset: 0, status: 'Pending' },
  { id: 'FU-3002', patientId: 'P-1031', appointmentId: 'APT-2007', followupType: 'Administrative Contact', assignedClinicianName: 'Front Desk Coordinator', description: 'Attempt second outreach call for missed General Medicine check-in.', reason: 'Unanswered no-show outreach', priority: 'Medium', createdOffset: -5, dueOffset: 1, status: 'Scheduled' },
  { id: 'FU-3003', patientId: 'P-1035', appointmentId: 'APT-2011', followupType: 'Administrative Contact', assignedClinicianName: 'Front Desk Coordinator', description: 'Verify insurance coverage documents and reschedule Cardiology visit.', reason: 'Missed Cardiology intake with pending verification', priority: 'High', createdOffset: -4, dueOffset: 0, status: 'Due' },
  { id: 'FU-3004', patientId: 'P-1042', appointmentId: 'APT-2019', followupType: 'Administrative Contact', assignedClinicianName: 'Dr. Priya Patel', description: 'Reschedule Julian Mercer into next open General Medicine slot with Dr. Priya Patel.', reason: 'Missed follow-up check-in', priority: 'High', createdOffset: -2, dueOffset: 1, status: 'Pending' },
  { id: 'FU-3005', patientId: 'P-1037', appointmentId: 'APT-2029', followupType: 'Administrative Contact', assignedClinicianName: 'Front Desk Coordinator', description: 'Place confirmation reminder call for today 13:30 Dermatology appointment.', reason: 'Unconfirmed same-day visit', priority: 'High', createdOffset: 0, dueOffset: 0, status: 'Due' },
  { id: 'FU-3006', patientId: 'P-1039', appointmentId: 'APT-2031', followupType: 'Clinical Recommendation', assignedClinicianName: 'Dr. Samuel Okafor', description: 'Confirm Cardiology attendance and review home blood pressure log for 15:30 today with Dr. Okafor.', reason: 'Hypertension monitoring review', priority: 'Medium', createdOffset: 0, dueOffset: 0, status: 'Pending' },
  { id: 'FU-3007', patientId: 'P-1038', appointmentId: 'APT-2014', followupType: 'Administrative Contact', assignedClinicianName: 'Front Desk Coordinator', description: 'Offer alternative Orthopedics morning slots following transit cancellation.', reason: 'Patient cancelled due to transit delay', priority: 'Low', createdOffset: -3, dueOffset: 2, status: 'Completed', completionNotes: 'Patient notified of next week morning availability.' },
  { id: 'FU-3008', patientId: 'P-1027', appointmentId: 'APT-2004', followupType: 'Administrative Contact', assignedClinicianName: 'Front Desk Coordinator', description: 'Archive cancellation notice and confirm next Dermatology booking.', reason: 'Advance cancellation processed', priority: 'Low', createdOffset: -6, dueOffset: -1, status: 'Completed', completionNotes: 'Rebooked into Day +1 Dermatology slot APT-2033.' },
  { id: 'FU-3009', patientId: 'P-1034', appointmentId: 'APT-2034', followupType: 'Administrative Contact', assignedClinicianName: 'Dr. Priya Patel', description: 'Send digital pre-check-in link for tomorrow General Medicine visit.', reason: 'Pre-visit intake preparation', priority: 'Medium', createdOffset: -1, dueOffset: 1, status: 'Pending' },
  { id: 'FU-3010', patientId: 'P-1029', appointmentId: 'APT-2036', followupType: 'Clinical Recommendation', assignedClinicianName: 'Dr. Hannah Lindqvist', description: 'Verify guardian consent form and pediatric immunization record prior to visit.', reason: 'Pre-visit clinical chart readiness', priority: 'Low', createdOffset: -1, dueOffset: 2, status: 'Scheduled' },
  { id: 'FU-3011', patientId: 'P-1040', appointmentId: null, followupType: 'Administrative Contact', assignedClinicianName: 'Front Desk Coordinator', description: 'Annual administrative status review for inactive patient file.', reason: 'Inactive record check', priority: 'Low', createdOffset: -5, dueOffset: 4, status: 'Cancelled' },
  { id: 'FU-3012', patientId: 'P-1046', appointmentId: 'APT-2020', followupType: 'Clinical Recommendation', assignedClinicianName: 'Dr. Samuel Okafor', description: 'Confirm lipid panel completion 14 days before next Cardiology review.', reason: 'Post-visit preventive screening check', priority: 'Low', createdOffset: -2, dueOffset: 3, status: 'Completed', completionNotes: 'Lab order acknowledged by patient.' },
];

interface SeedStaff {
  id: string;
  fullName: string;
  role: StaffRole;
  department: string;
  specialty: string;
  qualifications: string;
  licenseNumber: string;
  bio: string;
  status: StaffStatus;
}

const SEED_STAFF: SeedStaff[] = [
  ...CLINIC_CLINICIANS.map((c, index) => ({
    id: `STF-${1001 + index}`,
    fullName: c.name,
    role: 'Clinician' as const,
    department: c.department,
    specialty: c.specialty,
    qualifications: c.qualifications,
    licenseNumber: c.licenseNumber,
    bio: `Board-certified ${c.department.toLowerCase()} physician providing outpatient consultations and follow-up care coordination.`,
    status: 'Active' as const,
  })),
  {
    id: 'STF-1007',
    fullName: 'Clinic Administrator',
    role: 'Administrator',
    department: 'Clinic Operations',
    specialty: 'Operations & Access Control',
    qualifications: 'MHA, Healthcare Operations',
    licenseNumber: '',
    bio: 'Leads outpatient clinic scheduling governance, credential verification, and patient operations.',
    status: 'Active',
  },
  {
    id: 'STF-1008',
    fullName: 'Front Desk Coordinator',
    role: 'Coordinator',
    department: 'Reception & Scheduling',
    specialty: 'Intake & Appointment Coordination',
    qualifications: 'CHAA, Patient Access',
    licenseNumber: '',
    bio: 'Coordinates reception check-ins, confirmation outreach, and rebooking workflows.',
    status: 'Active',
  },
  {
    id: 'STF-1009',
    fullName: 'Operations Viewer',
    role: 'Viewer',
    department: 'Clinic Operations',
    specialty: 'Read-Only Operational Oversight',
    qualifications: 'Health Informatics Analyst',
    licenseNumber: '',
    bio: 'Monitors clinic utilization metrics and quality benchmarks.',
    status: 'Active',
  },
];

interface SeedConsultation {
  id: string;
  appointmentId: string;
  patientId: string;
  clinicianName: string;
  dayOffset: number;
  summary: string;
  diagnosisNotes: string;
  recommendations: string;
  prescriptions: PrescriptionItem[];
  testResults: TestResultItem[];
}

const SEED_CONSULTATIONS: SeedConsultation[] = [
  {
    id: 'CON-4001',
    appointmentId: 'APT-2001',
    patientId: 'P-1025',
    clinicianName: 'Dr. Samuel Okafor',
    dayOffset: -6,
    summary: 'Annual preventive cardiology assessment. Resting blood pressure 118/74 mmHg, regular heart rate 68 bpm.',
    diagnosisNotes: 'Stable cardiovascular baseline; no acute symptoms reported.',
    recommendations: 'Continue balanced Mediterranean diet, 150 min/week aerobic activity, and routine annual screening.',
    prescriptions: [
      {
        medication: 'Atorvastatin',
        dosage: '10 mg',
        frequency: 'Once daily (evening)',
        duration: '90 days',
        instructions: 'Take with or without food; schedule follow-up lipid panel in 3 months.',
      },
    ],
    testResults: [
      {
        testName: '12-Lead Resting ECG',
        observedDate: 'Annual Baseline',
        summary: 'Normal sinus rhythm, 68 bpm, no ST-T abnormalities.',
        statusLabel: 'Normal',
      },
    ],
  },
  {
    id: 'CON-4002',
    appointmentId: 'APT-2005',
    patientId: 'P-1028',
    clinicianName: 'Dr. Samuel Okafor',
    dayOffset: -5,
    summary: 'Hypertension follow-up review. Home blood pressure readings averaging 128/80 mmHg over the past 4 weeks.',
    diagnosisNotes: 'Well-controlled essential hypertension on current regimen.',
    recommendations: 'Maintain morning medication adherence and bring 2-week blood pressure log to next scheduled visit.',
    prescriptions: [
      {
        medication: 'Lisinopril',
        dosage: '10 mg',
        frequency: 'Once daily (morning)',
        duration: '90 days',
        instructions: 'Monitor blood pressure weekly and stay hydrated.',
      },
    ],
    testResults: [
      {
        testName: 'Basic Metabolic Panel (BMP)',
        observedDate: 'Recent Lab',
        summary: 'Potassium 4.2 mEq/L, Creatinine 0.9 mg/dL — within normal reference range.',
        statusLabel: 'Normal',
      },
    ],
  },
  {
    id: 'CON-4003',
    appointmentId: 'APT-2025',
    patientId: 'P-1026',
    clinicianName: 'Dr. Priya Patel',
    dayOffset: 0,
    summary: 'Morning primary care consultation for seasonal fatigue and preventive wellness intake.',
    diagnosisNotes: 'Mild seasonal allergy symptoms; vitals stable (temp 36.7 C, BP 116/72 mmHg).',
    recommendations: 'Hydration, sleep hygiene review, and repeat CBC check once lab results return.',
    prescriptions: [
      {
        medication: 'Cetirizine',
        dosage: '10 mg',
        frequency: 'Once daily as needed',
        duration: '30 days',
        instructions: 'Take in the evening if mild drowsiness occurs.',
      },
    ],
    testResults: [
      {
        testName: 'Complete Blood Count (CBC) & Vitamin D',
        observedDate: 'Ordered Today',
        summary: 'Sample collected during morning visit; awaiting laboratory validation.',
        statusLabel: 'Pending',
      },
    ],
  },
];

function getMaxNumericSuffix(db: DatabaseSync, table: string, prefix: string, base: number): number {
  const rows = db.prepare(`SELECT id FROM ${table}`).all() as Array<{ id: string }>;
  let maxNum = base;
  const regex = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of rows) {
    const m = regex.exec(r.id);
    if (m) {
      const n = Number(m[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return maxNum;
}

export function seedDefaultDoctorSchedule(
  db: DatabaseSync,
  clinicId: string,
  staffId: string,
  options?: { includeSaturday?: boolean }
): void {
  const nowIso = new Date().toISOString();
  const insertSched = db.prepare(`
    INSERT OR IGNORE INTO doctor_schedules (
      id, clinic_id, staff_id, day_of_week, is_working, start_time, end_time, break_start, break_end, slot_duration_minutes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let day = 0; day <= 6; day++) {
    const isWorking =
      day >= 1 && day <= 5
        ? 1
        : day === 6 && options?.includeSaturday
          ? 1
          : 0;
    const schedId = `SCH-${staffId}-${day}`;
    insertSched.run(
      schedId,
      clinicId,
      staffId,
      day,
      isWorking,
      '08:30',
      '17:00',
      '12:00',
      '13:00',
      30,
      nowIso
    );
  }
}

export function seedClinicStarterData(
  db: DatabaseSync,
  clinicId: string,
  options?: {
    referenceToday?: string;
    includePatientsAndAppointments?: boolean;
    useFixedDemoIds?: boolean;
  }
): void {
  const today = options?.referenceToday ?? getClinicTodayDate();
  const nowIso = new Date().toISOString();
  const useFixedIds = Boolean(options?.useFixedDemoIds);

  let nextStaffNum = useFixedIds ? 1000 : getMaxNumericSuffix(db, 'staff', 'STF', 1000);
  let nextPatientNum = useFixedIds ? 1024 : getMaxNumericSuffix(db, 'patients', 'P', 1048);
  let nextAptNum = useFixedIds ? 2000 : getMaxNumericSuffix(db, 'appointments', 'APT', 2038);
  let nextFuNum = useFixedIds ? 3000 : getMaxNumericSuffix(db, 'followups', 'FU', 3012);
  let nextConNum = useFixedIds ? 4000 : getMaxNumericSuffix(db, 'consultations', 'CON', 4003);

  const insertStaff = db.prepare(`
    INSERT INTO staff (
      id, clinic_id, full_name, role, department, specialty, qualifications, license_number, bio,
      email, contact_number, status, attendance_status, default_appointment_duration, max_daily_capacity, verification_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'On Duty', 30, 16, 'Approved', ?, ?)
  `);

  const insertPatient = db.prepare(`
    INSERT INTO patients (
      id, clinic_id, full_name, date_of_birth, contact_number, email,
      registration_date, administrative_status, emergency_contact_name, emergency_contact_phone, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAppointment = db.prepare(`
    INSERT INTO appointments (
      id, clinic_id, patient_id, staff_id, appointment_date, appointment_time, duration_minutes,
      department, specialty, appointment_type, clinician, status, requested_by, request_status, request_notes, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff', 'None', '', ?, ?, ?)
  `);

  const insertFollowUp = db.prepare(`
    INSERT INTO followups (
      id, clinic_id, patient_id, appointment_id, followup_type, assigned_staff_id, assigned_to_name,
      description, reason, priority, created_date, due_date, status,
      completed_at, completed_by, completion_notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertConsultation = db.prepare(`
    INSERT INTO consultations (
      id, clinic_id, appointment_id, patient_id, staff_id, doctor_name, consultation_date,
      summary, diagnosis_notes, recommendations, prescriptions_json, test_results_json, patient_visible, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (clinic_id, actor, action, resource_type, resource_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN TRANSACTION;');
  try {
    const existingStaffRows = db
      .prepare('SELECT id, full_name FROM staff WHERE clinic_id = ?')
      .all(clinicId) as Array<{ id: string; full_name: string }>;
    const existingStaffNames = new Set(existingStaffRows.map((r) => r.full_name.toLowerCase()));
    const staffIdByName = new Map<string, string>(
      existingStaffRows.map((r) => [r.full_name.toLowerCase(), r.id])
    );

    for (const member of SEED_STAFF) {
      if (existingStaffNames.has(member.fullName.toLowerCase())) continue;
      if (member.role === 'Administrator' && existingStaffNames.size > 0) continue;
      const staffId = useFixedIds ? member.id : `STF-${++nextStaffNum}`;
      const emailSlug = member.fullName
        .toLowerCase()
        .replace(/^dr\.\s*/i, '')
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '');
      insertStaff.run(
        staffId,
        clinicId,
        member.fullName,
        member.role,
        member.department,
        member.specialty,
        member.qualifications,
        member.licenseNumber,
        member.bio,
        `${emailSlug}@caredesk.example.org`,
        '+1-555-0190',
        member.status,
        nowIso,
        nowIso
      );
      staffIdByName.set(member.fullName.toLowerCase(), staffId);

      if (member.role === 'Clinician') {
        seedDefaultDoctorSchedule(db, clinicId, staffId, {
          includeSaturday: member.fullName === 'Dr. Robert Kim' || member.fullName === 'Dr. Priya Patel',
        });
      }
    }

    if (options?.includePatientsAndAppointments !== false) {
      const patientIdMap = new Map<string, string>();
      for (const p of SEED_PATIENTS) {
        const newPatientId = useFixedIds ? p.id : `P-${++nextPatientNum}`;
        patientIdMap.set(p.id, newPatientId);
        insertPatient.run(
          newPatientId,
          clinicId,
          p.fullName,
          p.dateOfBirth,
          p.contactNumber,
          p.email,
          p.registrationDate,
          p.administrativeStatus,
          p.emergencyContactName ?? '',
          p.emergencyContactPhone ?? '',
          nowIso
        );
      }

      const appointmentIdMap = new Map<string, string>();
      for (const a of SEED_APPOINTMENTS) {
        const newAptId = useFixedIds ? a.id : `APT-${++nextAptNum}`;
        appointmentIdMap.set(a.id, newAptId);
        const mappedPatientId = patientIdMap.get(a.patientId) ?? a.patientId;
        const staffId = staffIdByName.get(a.clinician.toLowerCase()) ?? null;
        const date = addDaysToDateString(today, a.dayOffset);
        insertAppointment.run(
          newAptId,
          clinicId,
          mappedPatientId,
          staffId,
          date,
          a.appointmentTime,
          a.durationMinutes,
          a.department,
          a.department,
          a.appointmentType,
          a.clinician,
          a.status,
          a.notes,
          nowIso,
          nowIso
        );
      }

      for (const f of SEED_FOLLOWUPS) {
        const newFuId = useFixedIds ? f.id : `FU-${++nextFuNum}`;
        const mappedPatientId = patientIdMap.get(f.patientId) ?? f.patientId;
        const mappedAptId = f.appointmentId ? appointmentIdMap.get(f.appointmentId) ?? null : null;
        const assignedName = f.assignedClinicianName ?? 'Front Desk Coordinator';
        const assignedStaffId = staffIdByName.get(assignedName.toLowerCase()) ?? null;
        const createdDate = addDaysToDateString(today, f.createdOffset);
        const dueDate = addDaysToDateString(today, f.dueOffset);
        const completedAt = f.status === 'Completed' ? nowIso : null;
        const completedBy = f.status === 'Completed' ? assignedName : '';

        insertFollowUp.run(
          newFuId,
          clinicId,
          mappedPatientId,
          mappedAptId,
          f.followupType,
          assignedStaffId,
          assignedName,
          f.description,
          f.reason,
          f.priority,
          createdDate,
          dueDate,
          f.status,
          completedAt,
          completedBy,
          f.completionNotes ?? '',
          nowIso,
          nowIso
        );
      }

      for (const c of SEED_CONSULTATIONS) {
        const newConId = useFixedIds ? c.id : `CON-${++nextConNum}`;
        const mappedPatientId = patientIdMap.get(c.patientId) ?? c.patientId;
        const mappedAptId = appointmentIdMap.get(c.appointmentId) ?? null;
        const staffId = staffIdByName.get(c.clinicianName.toLowerCase()) ?? null;
        const consultDate = addDaysToDateString(today, c.dayOffset);
        insertConsultation.run(
          newConId,
          clinicId,
          mappedAptId,
          mappedPatientId,
          staffId,
          c.clinicianName,
          consultDate,
          c.summary,
          c.diagnosisNotes,
          c.recommendations,
          JSON.stringify(c.prescriptions),
          JSON.stringify(c.testResults),
          nowIso,
          nowIso
        );
      }

      insertAudit.run(
        clinicId,
        'System Seed',
        'INITIALIZE_DEMO_DATA',
        'session',
        clinicId,
        `Seeded ${SEED_PATIENTS.length} synthetic patients, ${SEED_APPOINTMENTS.length} appointments, ${SEED_FOLLOWUPS.length} follow-up tasks, and ${SEED_CONSULTATIONS.length} consultation summaries for clinic ${clinicId}.`,
        nowIso
      );
    }

    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function seedDatabaseIfEmpty(db: DatabaseSync, referenceToday?: string): void {
  const nowIso = new Date().toISOString();

  const clinicExists = db
    .prepare('SELECT id FROM clinics WHERE id = ?')
    .get(DEFAULT_DEMO_CLINIC_ID) as { id: string } | undefined;

  if (!clinicExists) {
    db.prepare(`
      INSERT OR IGNORE INTO users (
        id, firebase_uid, email, full_name, phone_number, avatar_url, auth_provider, created_at, updated_at
      ) VALUES ('USR-SYSTEM', 'system-seed-uid', 'system@caredesk.local', 'System Seed Admin', '', '', 'system', ?, ?)
    `).run(nowIso, nowIso);

    db.prepare(`
      INSERT INTO clinics (
        id, name, clinic_type, contact_phone, contact_email, location, organization_notes, owner_user_id, created_at, updated_at
      ) VALUES (
        ?, 'CareDesk Demo Outpatient Center', 'Multi-Specialty Outpatient Clinic', '+1-555-0100', 'operations@caredesk.example.org', 'Boston, MA', 'Default synthetic demonstration workspace.', 'USR-SYSTEM', ?, ?
      )
    `).run(DEFAULT_DEMO_CLINIC_ID, nowIso, nowIso);
  }

  // Ensure existing demo clinicians always have default doctor_schedules if upgraded from earlier schema
  const existingClinicians = db
    .prepare("SELECT id, full_name FROM staff WHERE clinic_id = ? AND role = 'Clinician'")
    .all(DEFAULT_DEMO_CLINIC_ID) as Array<{ id: string; full_name: string }>;
  for (const doc of existingClinicians) {
    const hasSched = db
      .prepare('SELECT COUNT(*) AS count FROM doctor_schedules WHERE clinic_id = ? AND staff_id = ?')
      .get(DEFAULT_DEMO_CLINIC_ID, doc.id) as { count: number };
    if (hasSched.count === 0) {
      seedDefaultDoctorSchedule(db, DEFAULT_DEMO_CLINIC_ID, doc.id, {
        includeSaturday: doc.full_name === 'Dr. Robert Kim' || doc.full_name === 'Dr. Priya Patel',
      });
    }
  }

  const row = db.prepare('SELECT COUNT(*) AS count FROM patients').get() as { count: number };
  if (row.count > 0) {
    return;
  }

  seedClinicStarterData(db, DEFAULT_DEMO_CLINIC_ID, {
    referenceToday,
    includePatientsAndAppointments: true,
    useFixedDemoIds: true,
  });
}
