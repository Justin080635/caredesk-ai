export const CLINIC_DEPARTMENTS = [
  'General Medicine',
  'Cardiology',
  'Orthopedics',
  'Dermatology',
  'Pediatrics',
] as const;

export const CLINIC_CLINICIANS: Array<{
  name: string;
  department: string;
  specialty: string;
  qualifications: string;
  licenseNumber: string;
}> = [
  {
    name: 'Dr. Priya Patel',
    department: 'General Medicine',
    specialty: 'Primary Care & Preventive Medicine',
    qualifications: 'MD, Internal & Family Medicine (ABFM)',
    licenseNumber: 'MD-44821',
  },
  {
    name: 'Dr. Samuel Okafor',
    department: 'Cardiology',
    specialty: 'Clinical Cardiology & Preventive Vascular Care',
    qualifications: 'MD, FACC, Cardiovascular Disease',
    licenseNumber: 'MD-51904',
  },
  {
    name: 'Dr. Clara Chen',
    department: 'Orthopedics',
    specialty: 'Orthopedics & Musculoskeletal Medicine',
    qualifications: 'MD, FAAOS, Orthopedic Surgery',
    licenseNumber: 'MD-38712',
  },
  {
    name: 'Dr. David Morales',
    department: 'Dermatology',
    specialty: 'Medical & Clinical Dermatology',
    qualifications: 'MD, FAAD, Board-Certified Dermatologist',
    licenseNumber: 'MD-60219',
  },
  {
    name: 'Dr. Hannah Lindqvist',
    department: 'Pediatrics',
    specialty: 'Pediatrics & Adolescent Care',
    qualifications: 'MD, FAAP, Pediatric Medicine',
    licenseNumber: 'MD-47335',
  },
  {
    name: 'Dr. Robert Kim',
    department: 'General Medicine',
    specialty: 'Acute Outpatient & Chronic Care Coordination',
    qualifications: 'MD, MPH, General & Internal Medicine',
    licenseNumber: 'MD-55910',
  },
];

export const CLINIC_TYPES = [
  'Primary Care & Family Medicine',
  'Multi-Specialty Outpatient Clinic',
  'Cardiology & Vascular Practice',
  'Orthopedics & Sports Medicine',
  'Pediatrics & Adolescent Care',
  'Dermatology Practice',
  'Behavioral & Mental Health Center',
  'Dental & Oral Health Clinic',
  'Urgent Care Center',
] as const;

export const STAFF_ACCOUNT_ROLES = [
  'Clinic Administrator',
  'Doctor',
  'Receptionist',
  'Clinic Staff',
] as const;

export const ACCOUNT_ROLES = [
  'Clinic Administrator',
  'Doctor',
  'Receptionist',
  'Clinic Staff',
  'Patient',
] as const;

export const APPOINTMENT_TYPES = [
  'Consultation',
  'New Patient',
  'Follow-Up',
  'Procedure',
  'Urgent',
] as const;

export const APPOINTMENT_TYPE_DURATIONS: Record<string, number> = {
  Consultation: 30,
  'New Patient': 45,
  'Follow-Up': 20,
  Procedure: 45,
  Urgent: 30,
};

export const DOCTOR_DUTY_STATUSES = [
  'On Duty',
  'Checked In',
  'Available',
  'In Consultation',
  'On Break',
  'Off Duty',
  'On Leave',
] as const;

export const FOLLOWUP_STATUSES = [
  'Pending',
  'Scheduled',
  'Due',
  'Overdue',
  'Completed',
  'Cancelled',
] as const;

export const FOLLOWUP_TYPES = [
  'Administrative Contact',
  'Clinical Recommendation',
] as const;

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
