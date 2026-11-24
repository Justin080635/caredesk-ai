import { APPOINTMENT_TYPE_DURATIONS } from '../../shared/constants';
import type {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  AvailableSlot,
  DoctorDutyStatus,
  DoctorScheduleDay,
  DoctorUnavailability,
  StaffMember,
} from '../../shared/types';

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

export function getClinicCurrentTime(referenceDate = new Date()): string {
  const hours = String(referenceDate.getHours()).padStart(2, '0');
  const minutes = String(referenceDate.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function getDayOfWeekFromDateString(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
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

export function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.floor(totalMinutes)));
  const h = String(Math.floor(clamped / 60)).padStart(2, '0');
  const m = String(clamped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export function getDefaultDurationForType(appointmentType?: string): number {
  if (!appointmentType) return 30;
  return APPOINTMENT_TYPE_DURATIONS[appointmentType] ?? 30;
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
    'id' | 'patientId' | 'appointmentDate' | 'appointmentTime' | 'durationMinutes' | 'clinician' | 'staffId' | 'status'
  >[],
  candidate: {
    excludeAppointmentId?: string;
    patientId: string;
    appointmentDate: string;
    appointmentTime: string;
    durationMinutes: number;
    clinician: string;
    staffId?: string | null;
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
    const sameClinician =
      (candidate.staffId && existing.staffId && existing.staffId === candidate.staffId) ||
      existing.clinician.toLowerCase() === candidate.clinician.toLowerCase();

    if (sameClinician) {
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

export function isDoctorUnavailableAtSlot(
  unavailability: DoctorUnavailability[],
  date: string,
  time: string,
  durationMinutes: number
): DoctorUnavailability | null {
  const slotStart = timeToMinutes(time);
  const slotEnd = slotStart + durationMinutes;

  for (const item of unavailability) {
    if (date < item.startDate || date > item.endDate) continue;
    // All-day block when no specific time window is configured
    if (!item.startTime || !item.endTime) {
      return item;
    }
    const uStart = timeToMinutes(item.startTime);
    const uEnd = timeToMinutes(item.endTime);
    if (slotStart < uEnd && uStart < slotEnd) {
      return item;
    }
  }
  return null;
}

export function deriveDoctorOperationalState(params: {
  doctor: Pick<StaffMember, 'id' | 'fullName' | 'status' | 'attendanceStatus'>;
  todayDate: string;
  currentTime: string;
  todaySchedule: DoctorScheduleDay | null;
  todayAppointments: Appointment[];
  unavailability: DoctorUnavailability[];
}): DoctorDutyStatus {
  const { doctor, todayDate, currentTime, todaySchedule, todayAppointments, unavailability } = params;

  if (doctor.status === 'On Leave' || doctor.attendanceStatus === 'On Leave') {
    return 'On Leave';
  }
  if (doctor.status === 'Inactive' || doctor.attendanceStatus === 'Off Duty') {
    return 'Off Duty';
  }

  // Full-day leave entry today
  const activeUnavail = isDoctorUnavailableAtSlot(unavailability, todayDate, currentTime, 1);
  if (activeUnavail) {
    if (activeUnavail.kind === 'Leave') return 'On Leave';
    if (activeUnavail.kind === 'Break') return 'On Break';
    return 'Off Duty';
  }

  if (doctor.attendanceStatus === 'On Break') {
    return 'On Break';
  }

  const nowMin = timeToMinutes(currentTime);

  // Check if currently in a live appointment
  for (const apt of todayAppointments) {
    if (apt.appointmentDate !== todayDate) continue;
    if (apt.status !== 'Confirmed' && apt.status !== 'Scheduled') continue;
    const startMin = timeToMinutes(apt.appointmentTime);
    const endMin = startMin + (apt.durationMinutes || 30);
    if (nowMin >= startMin && nowMin < endMin) {
      return 'In Consultation';
    }
  }

  if (doctor.attendanceStatus === 'In Consultation') {
    return 'In Consultation';
  }

  if (todaySchedule) {
    if (!todaySchedule.isWorking) {
      return 'Off Duty';
    }
    if (
      todaySchedule.breakStart &&
      todaySchedule.breakEnd &&
      nowMin >= timeToMinutes(todaySchedule.breakStart) &&
      nowMin < timeToMinutes(todaySchedule.breakEnd)
    ) {
      return 'On Break';
    }
  }

  if (doctor.attendanceStatus === 'Checked In') return 'Checked In';
  if (doctor.attendanceStatus === 'Available') return 'Available';
  return 'On Duty';
}

export function generateDaySlotTimes(schedule: DoctorScheduleDay, slotDurationMinutes: number): string[] {
  if (!schedule.isWorking) return [];
  const startMin = timeToMinutes(schedule.startTime);
  const endMin = timeToMinutes(schedule.endTime);
  const breakStartMin = schedule.breakStart ? timeToMinutes(schedule.breakStart) : -1;
  const breakEndMin = schedule.breakEnd ? timeToMinutes(schedule.breakEnd) : -1;
  const step = Math.max(15, schedule.slotDurationMinutes || 30);
  const duration = Math.max(15, slotDurationMinutes);

  const times: string[] = [];
  for (let t = startMin; t + duration <= endMin; t += step) {
    const slotEnd = t + duration;
    if (breakStartMin >= 0 && breakEndMin > breakStartMin) {
      if (t < breakEndMin && breakStartMin < slotEnd) {
        continue;
      }
    }
    times.push(minutesToTime(t));
  }
  return times;
}

export function computeDoctorAvailability(params: {
  doctors: StaffMember[];
  schedulesByStaffId: Map<string, DoctorScheduleDay[]>;
  unavailabilityByStaffId: Map<string, DoctorUnavailability[]>;
  existingAppointments: Appointment[];
  options: {
    startDate: string;
    daysCount?: number;
    department?: string;
    specialty?: string;
    clinician?: string;
    staffId?: string;
    patientId?: string;
    appointmentType?: AppointmentType;
    durationMinutes?: number;
    timeOfDay?: 'morning' | 'afternoon' | 'any';
    minTimeOnStartDate?: string;
    limit?: number;
  };
}): AvailableSlot[] {
  const { doctors, schedulesByStaffId, unavailabilityByStaffId, existingAppointments, options } = params;
  const daysCount = Math.min(Math.max(1, options.daysCount ?? 7), 30);
  const limit = Math.min(Math.max(1, options.limit ?? 16), 60);
  const requestedDuration =
    options.durationMinutes ?? getDefaultDurationForType(options.appointmentType);

  const eligibleDoctors = doctors.filter((doc) => {
    if (doc.role !== 'Clinician') return false;
    if (doc.status !== 'Active') return false;
    if (doc.verificationStatus && doc.verificationStatus !== 'Approved') return false;
    if (doc.attendanceStatus === 'On Leave' || doc.attendanceStatus === 'Off Duty') return false;
    if (options.staffId && doc.id !== options.staffId) return false;
    if (options.clinician && doc.fullName.toLowerCase() !== options.clinician.toLowerCase()) return false;
    if (options.department && options.department !== 'All' && doc.department !== options.department) {
      return false;
    }
    if (
      options.specialty &&
      options.specialty !== 'All' &&
      doc.department.toLowerCase() !== options.specialty.toLowerCase() &&
      !doc.specialty.toLowerCase().includes(options.specialty.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const results: AvailableSlot[] = [];

  for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
    const date = addDaysToDateString(options.startDate, dayOffset);
    const dayOfWeek = getDayOfWeekFromDateString(date);

    for (const doctor of eligibleDoctors) {
      const schedules = schedulesByStaffId.get(doctor.id) ?? [];
      const daySchedule = schedules.find((s) => s.dayOfWeek === dayOfWeek) ?? null;
      const unavail = unavailabilityByStaffId.get(doctor.id) ?? [];

      // Check daily appointment capacity
      const bookedCount = existingAppointments.filter(
        (a) =>
          a.appointmentDate === date &&
          ACTIVE_OCCUPYING_STATUSES.has(a.status) &&
          (a.staffId === doctor.id || a.clinician.toLowerCase() === doctor.fullName.toLowerCase())
      ).length;
      const maxCap = doctor.maxDailyCapacity ?? 16;
      if (bookedCount >= maxCap) continue;

      const duration = requestedDuration || doctor.defaultAppointmentDuration || 30;
      const candidateTimes = daySchedule
        ? generateDaySlotTimes(daySchedule, duration)
        : dayOfWeek >= 1 && dayOfWeek <= 5
          ? [...CLINIC_TIME_SLOTS]
          : [];

      for (const time of candidateTimes) {
        if (dayOffset === 0 && options.minTimeOnStartDate && time <= options.minTimeOnStartDate) {
          continue;
        }
        if (options.timeOfDay === 'morning' && time >= '12:00') continue;
        if (options.timeOfDay === 'afternoon' && time < '12:00') continue;

        if (isDoctorUnavailableAtSlot(unavail, date, time, duration)) {
          continue;
        }

        const conflict = findAppointmentConflict(existingAppointments, {
          patientId: options.patientId ?? '__UNSPECIFIED__',
          appointmentDate: date,
          appointmentTime: time,
          durationMinutes: duration,
          clinician: doctor.fullName,
          staffId: doctor.id,
        });

        if (!conflict.hasConflict) {
          results.push({
            date,
            time,
            department: doctor.department,
            specialty: doctor.specialty || doctor.department,
            clinician: doctor.fullName,
            staffId: doctor.id,
            durationMinutes: duration,
            appointmentType: options.appointmentType ?? 'Consultation',
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
