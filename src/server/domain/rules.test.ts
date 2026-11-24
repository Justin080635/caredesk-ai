import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysToDateString,
  computeAvailableSlots,
  containsClinicalDiagnosisRequest,
  findAppointmentConflict,
  isValidDateString,
  isValidTimeString,
  slotsOverlap,
} from './rules';

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
