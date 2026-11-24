import type { Appointment, AppointmentStatus, AvailableSlot } from '../../shared/types';

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

export const CLINIC_TIME_SLOTS = [
  '08:30',
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
] as const;

export const ACTIVE_OCCUPYING_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'Scheduled',
  'Confirmed',
  'Completed',
]);

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getClinicTodayDate(referenceDate = new Date()): string {
  return formatLocalDate(referenceDate);
}

export function addDaysToDateString(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + offsetDays);
  return formatLocalDate(dt);
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function isValidTimeString(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

export function slotsOverlap(
  startA: string,
  durationA: number,
  startB: string,
  durationB: number
): boolean {
  const a0 = timeToMinutes(startA);
  const a1 = a0 + durationA;
  const b0 = timeToMinutes(startB);
  const b1 = b0 + durationB;
  return a0 < b1 && b0 < a1;
}

export function findAppointmentConflict(
  existingAppointments: Pick<
    Appointment,
    'id' | 'patientId' | 'appointmentDate' | 'appointmentTime' | 'durationMinutes' | 'clinician' | 'status'
  >[],
  candidate: {
    excludeAppointmentId?: string;
    patientId: string;
    appointmentDate: string;
    appointmentTime: string;
    durationMinutes: number;
    clinician: string;
  }
): { hasConflict: boolean; reason?: string; conflictingAppointmentId?: string } {
  for (const existing of existingAppointments) {
    if (candidate.excludeAppointmentId && existing.id === candidate.excludeAppointmentId) {
      continue;
    }
    if (!ACTIVE_OCCUPYING_STATUSES.has(existing.status)) {
      continue;
    }
    if (existing.appointmentDate !== candidate.appointmentDate) {
      continue;
    }
    const overlaps = slotsOverlap(
      existing.appointmentTime,
      existing.durationMinutes || 30,
      candidate.appointmentTime,
      candidate.durationMinutes || 30
    );
    if (!overlaps) {
      continue;
    }
    if (existing.clinician === candidate.clinician) {
      return {
        hasConflict: true,
        conflictingAppointmentId: existing.id,
        reason: `${candidate.clinician} already has an appointment (${existing.id}) at ${existing.appointmentTime} on ${existing.appointmentDate}.`,
      };
    }
    if (existing.patientId === candidate.patientId) {
      return {
        hasConflict: true,
        conflictingAppointmentId: existing.id,
        reason: `Patient ${candidate.patientId} already has an appointment (${existing.id}) at ${existing.appointmentTime} on ${existing.appointmentDate}.`,
      };
    }
  }
  return { hasConflict: false };
}

export function computeAvailableSlots(
  existingAppointments: Pick<
    Appointment,
    'id' | 'patientId' | 'appointmentDate' | 'appointmentTime' | 'durationMinutes' | 'clinician' | 'department' | 'status'
  >[],
  options: {
    startDate: string;
    daysCount?: number;
    department?: string;
    clinician?: string;
    patientId?: string;
    minTimeOnStartDate?: string;
    limit?: number;
  }
): AvailableSlot[] {
  const daysCount = options.daysCount ?? 5;
  const limit = options.limit ?? 12;
  const results: AvailableSlot[] = [];

  const targetClinicians = CLINIC_CLINICIANS.filter((c) => {
    if (options.clinician && c.name !== options.clinician) return false;
    if (options.department && c.department !== options.department) return false;
    return true;
  });

  for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
    const date = addDaysToDateString(options.startDate, dayOffset);
    for (const time of CLINIC_TIME_SLOTS) {
      if (dayOffset === 0 && options.minTimeOnStartDate && time <= options.minTimeOnStartDate) {
        continue;
      }
      for (const clinicianInfo of targetClinicians) {
        const conflict = findAppointmentConflict(existingAppointments, {
          patientId: options.patientId ?? '__UNSPECIFIED__',
          appointmentDate: date,
          appointmentTime: time,
          durationMinutes: 30,
          clinician: clinicianInfo.name,
        });
        if (!conflict.hasConflict) {
          results.push({
            date,
            time,
            department: clinicianInfo.department,
            clinician: clinicianInfo.name,
            durationMinutes: 30,
          });
          if (results.length >= limit) {
            return results;
          }
        }
      }
    }
  }
  return results;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function containsClinicalDiagnosisRequest(text: string): boolean {
  const lower = text.toLowerCase();
  const clinicalTerms = [
    'diagnose',
    'diagnosis',
    'prescribe',
    'prescription',
    'dosage',
    'medication dose',
    'what disease',
    'is this cancer',
    'treatment plan',
    'medical advice',
    'interpret lab',
    'x-ray result',
  ];
  return clinicalTerms.some((term) => lower.includes(term));
}
