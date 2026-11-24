import test from 'node:test';
import assert from 'node:assert/strict';
import { CareDeskAgent, classifyIntentDeterministically, type CareDeskToolAdapter } from './copilot';

test('classifyIntentDeterministically handles all 6 demo prompts and clinical boundaries', () => {
  assert.equal(classifyIntentDeterministically("Give me a briefing of today's clinic operations.").intent, 'daily_briefing');
  assert.equal(classifyIntentDeterministically("Give me today's clinic briefing.").intent, 'daily_briefing');
  assert.equal(classifyIntentDeterministically('Which appointments are still unconfirmed?').intent, 'unconfirmed_appointments');
  assert.equal(classifyIntentDeterministically('Identify patients who missed appointments in the last seven days.').intent, 'missed_appointments');
  assert.equal(classifyIntentDeterministically('Identify patients who missed appointments during the last seven days.').intent, 'missed_appointments');
  const missed14 = classifyIntentDeterministically('Identify patients who missed appointments over the last 14 days.');
  assert.equal(missed14.intent, 'missed_appointments');
  assert.equal(missed14.days, 14);
  assert.equal(classifyIntentDeterministically('Prepare a follow-up list for patients with missed appointments.').intent, 'prepare_followup_list');
  assert.equal(classifyIntentDeterministically('Prepare an administrative follow-up list.').intent, 'prepare_followup_list');
  assert.equal(classifyIntentDeterministically('Find the next available appointment slot.').intent, 'find_available_slot');

  const resched = classifyIntentDeterministically('Reschedule patient P-1042.');
  assert.equal(resched.intent, 'reschedule_patient');
  assert.equal(resched.patientId, 'P-1042');

  assert.equal(classifyIntentDeterministically('Should we diagnose this patient or prescribe antibiotics?').intent, 'non_clinical_refusal');
});

test('CareDeskAgent never mutates records on reschedule query without explicit confirmation, and verifies persistence on confirm', async () => {
  let rescheduledCalled = false;
  let verifiedById = false;
  let currentDate = '2026-11-21';
  let currentTime = '14:00';
  let currentStatus: 'Missed' | 'Scheduled' = 'Missed';

  const mockAdapter: CareDeskToolAdapter = {
    async getDailyReport() {
      throw new Error('not expected');
    },
    async getOverviewReport() {
      throw new Error('not expected');
    },
    async getUnconfirmedAppointments() {
      return [];
    },
    async getMissedAppointments() {
      return [];
    },
    async getPendingFollowups() {
      return [];
    },
    async checkAvailability() {
      return [
        {
          date: '2026-11-24',
          time: '09:00',
          department: 'General Medicine',
          clinician: 'Dr. Priya Patel',
          durationMinutes: 30,
        },
      ];
    },
    async getAppointmentById(appointmentId) {
      verifiedById = true;
      return {
        id: appointmentId,
        patientId: 'P-1042',
        appointmentDate: currentDate,
        appointmentTime: currentTime,
        durationMinutes: 30,
        department: 'General Medicine',
        clinician: 'Dr. Priya Patel',
        status: currentStatus,
        notes: '',
        createdAt: '',
        updatedAt: '',
      };
    },
    async getPatientWithHistory(patientId) {
      return {
        patient: {
          id: patientId,
          fullName: 'Julian Mercer',
          dateOfBirth: '1984-04-06',
          contactNumber: '+1-555-0159',
          email: 'julian.mercer@example.org',
          registrationDate: '2025-08-18',
          administrativeStatus: 'Active',
          createdAt: '2025-08-18T00:00:00Z',
        },
        appointments: [
          {
            id: 'APT-2019',
            patientId,
            appointmentDate: currentDate,
            appointmentTime: currentTime,
            durationMinutes: 30,
            department: 'General Medicine',
            clinician: 'Dr. Priya Patel',
            status: currentStatus,
            notes: '',
            createdAt: '',
            updatedAt: '',
          },
        ],
        followups: [],
      };
    },
    async rescheduleAppointment(id, patch) {
      rescheduledCalled = true;
      currentDate = patch.appointmentDate;
      currentTime = patch.appointmentTime;
      currentStatus = 'Scheduled';
      return {
        id,
        patientId: 'P-1042',
        appointmentDate: currentDate,
        appointmentTime: currentTime,
        durationMinutes: 30,
        department: 'General Medicine',
        clinician: 'Dr. Priya Patel',
        status: currentStatus,
        notes: patch.notes ?? '',
        createdAt: '',
        updatedAt: '',
      };
    },
    async createFollowup() {
      throw new Error('not expected');
    },
  };

  const agent = new CareDeskAgent(mockAdapter);
  const reply = await agent.handlePrompt('Reschedule patient P-1042 to an available appointment slot.');

  assert.equal(rescheduledCalled, false);
  assert.equal(reply.mode, 'development-local-rest-preview');
  assert.ok(reply.integrationNotice.includes('not yet connected'));
  assert.ok(reply.pendingConfirmation);
  assert.equal(reply.pendingConfirmation.actionType, 'reschedule_appointment');

  if (reply.pendingConfirmation.actionType !== 'reschedule_appointment') {
    throw new Error('Unexpected confirmation action');
  }
  const confirmed = await agent.confirmPendingAction({
    actionType: 'reschedule_appointment',
    payload: reply.pendingConfirmation.payload as Record<string, unknown>,
  });
  assert.equal(rescheduledCalled, true);
  assert.equal(verifiedById, true);
  assert.ok(confirmed.summary.includes('2026-11-24'));
});
