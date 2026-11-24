import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysToDateString,
  computeAvailableSlots,
  computeDoctorAvailability,
  containsClinicalDiagnosisRequest,
  deriveDoctorOperationalState,
  findAppointmentConflict,
  generateDaySlotTimes,
  isDoctorUnavailableAtSlot,
  isValidDateString,
  isValidTimeString,
  slotsOverlap,
} from './rules';
import type { Appointment, DoctorScheduleDay, DoctorUnavailability, StaffMember } from '../../shared/types';

test('slotsOverlap detects overlapping and adjacent 30-minute slots accurately', () => {
  assert.equal(slotsOverlap('09:00', 30, '09:15', 30), true);
  assert.equal(slotsOverlap('09:00', 30, '09:00', 30), true);
  assert.equal(slotsOverlap('09:00', 30, '09:30', 30), false);
  assert.equal(slotsOverlap('14:00', 30, '13:30', 30), false);
});

test('findAppointmentConflict flags same clinician or same patient active collisions', () => {
  const existing = [
    {
      id: 'APT-1',
      patientId: 'P-1001',
      appointmentDate: '2026-11-24',
      appointmentTime: '10:00',
      durationMinutes: 30,
      clinician: 'Dr. Priya Patel',
      status: 'Confirmed' as const,
    },
    {
      id: 'APT-2',
      patientId: 'P-1002',
      appointmentDate: '2026-11-24',
      appointmentTime: '11:00',
      durationMinutes: 30,
      clinician: 'Dr. Priya Patel',
      status: 'Cancelled' as const,
    },
  ];

  const clinicianCollision = findAppointmentConflict(existing, {
    patientId: 'P-1099',
    appointmentDate: '2026-11-24',
    appointmentTime: '10:00',
    durationMinutes: 30,
    clinician: 'Dr. Priya Patel',
  });
  assert.equal(clinicianCollision.hasConflict, true);
  assert.equal(clinicianCollision.conflictingAppointmentId, 'APT-1');

  const patientCollision = findAppointmentConflict(existing, {
    patientId: 'P-1001',
    appointmentDate: '2026-11-24',
    appointmentTime: '10:00',
    durationMinutes: 30,
    clinician: 'Dr. Samuel Okafor',
  });
  assert.equal(patientCollision.hasConflict, true);

  // Cancelled appointments should not block new bookings
  const cancelledSlot = findAppointmentConflict(existing, {
    patientId: 'P-1099',
    appointmentDate: '2026-11-24',
    appointmentTime: '11:00',
    durationMinutes: 30,
    clinician: 'Dr. Priya Patel',
  });
  assert.equal(cancelledSlot.hasConflict, false);
});

test('computeAvailableSlots skips occupied slots and filters by clinician', () => {
  const existing = [
    {
      id: 'APT-1',
      patientId: 'P-1001',
      appointmentDate: '2026-11-24',
      appointmentTime: '08:30',
      durationMinutes: 30,
      clinician: 'Dr. Priya Patel',
      department: 'General Medicine',
      status: 'Confirmed' as const,
    },
  ];

  const slots = computeAvailableSlots(existing, {
    startDate: '2026-11-24',
    daysCount: 1,
    clinician: 'Dr. Priya Patel',
    limit: 3,
  });

  assert.equal(slots.length, 3);
  assert.equal(slots[0].time, '09:00');
  assert.equal(slots[0].clinician, 'Dr. Priya Patel');
});

test('date, time, and clinical boundary validation helpers behave deterministically', () => {
  assert.equal(isValidDateString('2026-11-23'), true);
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidTimeString('09:30'), true);
  assert.equal(isValidTimeString('25:00'), false);
  assert.equal(addDaysToDateString('2026-11-23', 2), '2026-11-25');
  assert.equal(containsClinicalDiagnosisRequest('Diagnose this chest pain'), true);
  assert.equal(containsClinicalDiagnosisRequest('Give me a briefing of today operations'), false);
});

test('generateDaySlotTimes excludes break intervals and respects custom consultation duration', () => {
  const schedule: DoctorScheduleDay = {
    id: 'SCH-1',
    clinicId: 'CLN-1001',
    staffId: 'STF-1001',
    dayOfWeek: 2, // Tuesday
    isWorking: true,
    startTime: '09:00',
    endTime: '14:00',
    breakStart: '12:00',
    breakEnd: '13:00',
    slotDurationMinutes: 30,
    updatedAt: '',
  };

  const standardSlots = generateDaySlotTimes(schedule, 30);
  assert.equal(standardSlots.includes('11:30'), true);
  assert.equal(standardSlots.includes('12:00'), false);
  assert.equal(standardSlots.includes('12:30'), false);
  assert.equal(standardSlots.includes('13:00'), true);
  assert.equal(standardSlots.includes('13:30'), true);

  // 45-minute Specialist Consult starting at 11:30 would bleed into 12:00 break, so it must be excluded
  const longConsultSlots = generateDaySlotTimes(schedule, 45);
  assert.equal(longConsultSlots.includes('11:30'), false);
  assert.equal(longConsultSlots.includes('11:00'), true);
  assert.equal(longConsultSlots.includes('13:00'), true);
  assert.equal(longConsultSlots.includes('13:30'), false);

  const nonWorking: DoctorScheduleDay = { ...schedule, isWorking: false };
  assert.deepEqual(generateDaySlotTimes(nonWorking, 30), []);
});

test('isDoctorUnavailableAtSlot and deriveDoctorOperationalState reflect live appointments, breaks, and leave', () => {
  const doctor: Pick<StaffMember, 'id' | 'fullName' | 'status' | 'attendanceStatus'> = {
    id: 'STF-1001',
    fullName: 'Dr. Priya Patel',
    status: 'Active',
    attendanceStatus: 'Available',
  };
  const schedule: DoctorScheduleDay = {
    id: 'SCH-1',
    clinicId: 'CLN-1001',
    staffId: 'STF-1001',
    dayOfWeek: 2,
    isWorking: true,
    startTime: '09:00',
    endTime: '17:00',
    breakStart: '12:00',
    breakEnd: '13:00',
    slotDurationMinutes: 30,
    updatedAt: '',
  };
  const leaveBlock: DoctorUnavailability[] = [
    {
      id: 'UNA-1',
      clinicId: 'CLN-1001',
      staffId: 'STF-1001',
      startDate: '2026-11-25',
      endDate: '2026-11-26',
      startTime: '',
      endTime: '',
      kind: 'Leave',
      reason: 'Medical Conference',
      createdAt: '',
    },
    {
      id: 'UNA-2',
      clinicId: 'CLN-1001',
      staffId: 'STF-1001',
      startDate: '2026-11-24',
      endDate: '2026-11-24',
      startTime: '15:00',
      endTime: '16:00',
      kind: 'Unavailable',
      reason: 'Department Meeting',
      createdAt: '',
    },
  ];
  const appointments: Appointment[] = [
    {
      id: 'APT-10',
      patientId: 'P-1001',
      appointmentDate: '2026-11-24',
      appointmentTime: '10:00',
      durationMinutes: 30,
      department: 'General Medicine',
      clinician: 'Dr. Priya Patel',
      staffId: 'STF-1001',
      status: 'Confirmed',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  // Timed block check
  assert.ok(isDoctorUnavailableAtSlot(leaveBlock, '2026-11-24', '15:00', 30));
  assert.equal(isDoctorUnavailableAtSlot(leaveBlock, '2026-11-24', '16:00', 30), null);
  assert.ok(isDoctorUnavailableAtSlot(leaveBlock, '2026-11-25', '09:30', 30));

  // In live consultation at 10:15
  assert.equal(
    deriveDoctorOperationalState({
      doctor,
      todayDate: '2026-11-24',
      currentTime: '10:15',
      todaySchedule: schedule,
      todayAppointments: appointments,
      unavailability: leaveBlock,
    }),
    'In Consultation'
  );

  // On scheduled lunch break at 12:15
  assert.equal(
    deriveDoctorOperationalState({
      doctor,
      todayDate: '2026-11-24',
      currentTime: '12:15',
      todaySchedule: schedule,
      todayAppointments: appointments,
      unavailability: leaveBlock,
    }),
    'On Break'
  );

  // On Leave on 2026-11-25
  assert.equal(
    deriveDoctorOperationalState({
      doctor,
      todayDate: '2026-11-25',
      currentTime: '10:00',
      todaySchedule: schedule,
      todayAppointments: [],
      unavailability: leaveBlock,
    }),
    'On Leave'
  );

  // Available outside break/appointment/block
  assert.equal(
    deriveDoctorOperationalState({
      doctor,
      todayDate: '2026-11-24',
      currentTime: '11:00',
      todaySchedule: schedule,
      todayAppointments: appointments,
      unavailability: leaveBlock,
    }),
    'Available'
  );
});

test('computeDoctorAvailability enforces daily capacity, leave blocks, timeOfDay, and appointmentType durations', () => {
  const docA: StaffMember = {
    id: 'STF-1',
    fullName: 'Dr. Priya Patel',
    role: 'Clinician',
    department: 'General Medicine',
    specialty: 'Family Medicine',
    email: 'priya@clinic.org',
    contactNumber: '+1-555-0100',
    status: 'Active',
    attendanceStatus: 'Available',
    maxDailyCapacity: 1,
    defaultAppointmentDuration: 30,
    createdAt: '',
    updatedAt: '',
  };
  const docB: StaffMember = {
    id: 'STF-2',
    fullName: 'Dr. Samuel Okafor',
    role: 'Clinician',
    department: 'Cardiology',
    specialty: 'Preventive Cardiology',
    email: 'sam@clinic.org',
    contactNumber: '+1-555-0101',
    status: 'Active',
    attendanceStatus: 'Available',
    maxDailyCapacity: 8,
    defaultAppointmentDuration: 30,
    createdAt: '',
    updatedAt: '',
  };

  // 2026-11-24 is a Tuesday (dayOfWeek = 2)
  const schedulesByStaffId = new Map<string, DoctorScheduleDay[]>([
    [
      'STF-1',
      [
        {
          id: 'S-1',
          clinicId: 'C-1',
          staffId: 'STF-1',
          dayOfWeek: 2,
          isWorking: true,
          startTime: '09:00',
          endTime: '17:00',
          breakStart: '12:00',
          breakEnd: '13:00',
          slotDurationMinutes: 30,
          updatedAt: '',
        },
      ],
    ],
    [
      'STF-2',
      [
        {
          id: 'S-2',
          clinicId: 'C-1',
          staffId: 'STF-2',
          dayOfWeek: 2,
          isWorking: true,
          startTime: '09:00',
          endTime: '15:00',
          breakStart: '12:00',
          breakEnd: '13:00',
          slotDurationMinutes: 30,
          updatedAt: '',
        },
      ],
    ],
  ]);

  const unavailabilityByStaffId = new Map<string, DoctorUnavailability[]>([
    [
      'STF-2',
      [
        {
          id: 'U-1',
          clinicId: 'C-1',
          staffId: 'STF-2',
          startDate: '2026-11-24',
          endDate: '2026-11-24',
          startTime: '13:00',
          endTime: '14:00',
          kind: 'Unavailable',
          reason: 'Cath lab consult',
          createdAt: '',
        },
      ],
    ],
  ]);

  // Doc A already has 1 appointment on 2026-11-24, hitting maxDailyCapacity = 1
  const existingAppointments: Appointment[] = [
    {
      id: 'APT-CAP-1',
      patientId: 'P-1001',
      appointmentDate: '2026-11-24',
      appointmentTime: '09:00',
      durationMinutes: 30,
      department: 'General Medicine',
      clinician: 'Dr. Priya Patel',
      staffId: 'STF-1',
      status: 'Confirmed',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  // Afternoon Procedure (45m) should skip Doc A (at capacity) and skip 13:00-14:00 block on Doc B -> only 14:00 left
  const afternoonSlots = computeDoctorAvailability({
    doctors: [docA, docB],
    schedulesByStaffId,
    unavailabilityByStaffId,
    existingAppointments,
    options: {
      startDate: '2026-11-24',
      daysCount: 1,
      appointmentType: 'Procedure',
      timeOfDay: 'afternoon',
      limit: 10,
    },
  });

  assert.equal(afternoonSlots.length, 1);
  assert.equal(afternoonSlots[0].staffId, 'STF-2');
  assert.equal(afternoonSlots[0].time, '14:00');
  assert.equal(afternoonSlots[0].durationMinutes, 45);
});
