export const CLINIC_DEPARTMENTS = [
  'General Medicine',
  'Cardiology',
  'Orthopedics',
  'Dermatology',
  'Pediatrics',
] as const;

export const CLINIC_CLINICIANS: Array<{ name: string; department: string }> = [
  { name: 'Dr. Priya Patel', department: 'General Medicine' },
  { name: 'Dr. Samuel Okafor', department: 'Cardiology' },
  { name: 'Dr. Clara Chen', department: 'Orthopedics' },
  { name: 'Dr. David Morales', department: 'Dermatology' },
  { name: 'Dr. Hannah Lindqvist', department: 'Pediatrics' },
  { name: 'Dr. Robert Kim', department: 'General Medicine' },
];
