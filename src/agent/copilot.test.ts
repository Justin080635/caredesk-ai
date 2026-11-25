import test from 'node:test';
import assert from 'node:assert/strict';
import type { AssistantStreamEvent } from '../shared/types';
import {
  CareDeskAgent,
  classifyIntentDeterministically,
  type CareDeskToolAdapter,
} from './copilot';

function createBaseMockAdapter(overrides?: Partial<CareDeskToolAdapter>): CareDeskToolAdapter {
  return {
    async getDailyReport() {
      return {
        date: '2026-11-24',
        totalAppointments: 8,
        confirmedAppointments: 4,
        unconfirmedAppointments: 2,
        completedAppointments: 1,
        cancelledAppointments: 0,
        missedAppointments: 1,
        pendingFollowUps: 5,
        statusBreakdown: {
          Scheduled: 2,
          Confirmed: 4,
          Completed: 1,
          Cancelled: 0,
          Missed: 1,
        },
        departmentBreakdown: [{ department: 'General Medicine', count: 5 }],
        upcomingAppointments: [],
        unconfirmedList: [],
        missedTodayList: [],
      };
    },
    async getOverviewReport() {
      return {
        generatedAt: '2026-11-24T09:00:00Z',
        windowStart: '2026-11-18',
        windowEnd: '2026-11-27',
        todayDate: '2026-11-24',
        totalPatients: 24,
        activePatients: 20,
        totalAppointmentsInWindow: 38,
        todayTotalAppointments: 8,
        yesterdayTotalAppointments: 4,
        missedLastSevenDaysCount: 3,
        pendingFollowUpsCount: 5,
        overdueFollowUpsCount: 2,
        highPriorityFollowUpsCount: 2,
        statusBreakdown: {
          Scheduled: 5,
          Confirmed: 17,
          Completed: 7,
          Cancelled: 2,
          Missed: 7,
        },
        dailyTrend: [],
        patientRegistrationTrend: [],
        calendarSummary: [],
        missedLastSevenDays: [],
        overdueFollowUps: [],
        recentActivity: [],
      };
    },
    async getUnconfirmedAppointments() {
      return [];
    },
    async getMissedAppointments() {
      return [];
    },
    async getPendingFollowups() {
      return [
        {
          id: 'FU-3001',
          patientId: 'P-1042',
          patientName: 'Julian Mercer',
          appointmentId: 'APT-2019',
          description: 'Reschedule missed visit',
          priority: 'High',
          createdDate: '2026-11-21',
          dueDate: '2026-11-22',
          status: 'Pending',
          createdAt: '',
          updatedAt: '',
        },
      ];
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
      return {
        id: appointmentId,
        patientId: 'P-1042',
        appointmentDate: '2026-11-24',
        appointmentTime: '09:00',
        durationMinutes: 30,
        department: 'General Medicine',
        clinician: 'Dr. Priya Patel',
        status: 'Scheduled',
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
            appointmentDate: '2026-11-21',
            appointmentTime: '14:00',
            durationMinutes: 30,
            department: 'General Medicine',
            clinician: 'Dr. Priya Patel',
            status: 'Missed',
            notes: '',
            createdAt: '',
            updatedAt: '',
          },
        ],
        followups: [],
      };
    },
    async rescheduleAppointment() {
      throw new Error('not expected');
    },
    async createFollowup() {
      throw new Error('not expected');
    },
    ...overrides,
  };
}

test('classifyIntentDeterministically handles all operational prompts including follow-up queue, patient summary, and clinical boundaries', () => {
  assert.equal(classifyIntentDeterministically("Give me a briefing of today's clinic operations.").intent, 'daily_briefing');
  assert.equal(classifyIntentDeterministically("Give me today's clinic briefing.").intent, 'daily_briefing');
  assert.equal(classifyIntentDeterministically('Which appointments are still unconfirmed?').intent, 'unconfirmed_appointments');
  assert.equal(classifyIntentDeterministically('Show pending appointments.').intent, 'unconfirmed_appointments');
  assert.equal(classifyIntentDeterministically('Identify overdue follow-ups.').intent, 'followup_queue');
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

  const summary = classifyIntentDeterministically('Show patient P-1042');
  assert.equal(summary.intent, 'patient_summary');
  assert.equal(summary.patientId, 'P-1042');

  assert.equal(classifyIntentDeterministically('Should we diagnose this patient or prescribe antibiotics?').intent, 'non_clinical_refusal');
});

test('CareDeskAgent emits real tool telemetry events for daily briefing with 5 structured sections and supports AbortSignal', async () => {
  const events: AssistantStreamEvent[] = [];
  const agent = new CareDeskAgent(createBaseMockAdapter());

  const reply = await agent.handlePrompt("Give me today's clinic briefing.", {
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(reply.intent, 'daily_briefing');
  assert.equal(reply.sections?.length, 5);
  assert.ok(reply.sections?.some((s) => s.title.includes('Overview')));
  assert.ok(reply.sections?.some((s) => s.title.includes('Recommended Administrative Next Actions')));
  assert.ok((reply.followUpSuggestions?.length ?? 0) >= 2);
  assert.ok(reply.plannedTools.every((t) => typeof t.durationMs === 'number' && Boolean(t.resultSummary)));

  assert.ok(events.some((e) => e.type === 'tool_start' && e.toolName === 'get_daily_operational_report'));
  assert.ok(events.some((e) => e.type === 'tool_done' && e.toolName === 'get_overview_report'));
  assert.equal(events[events.length - 1]?.type, 'complete');

  const abortController = new AbortController();
  abortController.abort();
  await assert.rejects(
    () => agent.handlePrompt("Give me today's clinic briefing.", { signal: abortController.signal }),
    /cancelled/i
  );
});

test('CareDeskAgent never mutates records on reschedule query without explicit confirmation, and verifies persistence on confirm', async () => {
  let rescheduledCalled = false;
  let verifiedById = false;
  let currentDate = '2026-11-21';
  let currentTime = '14:00';
  let currentStatus: 'Missed' | 'Scheduled' = 'Missed';

  const mockAdapter = createBaseMockAdapter({
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
  });

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

test('CareDeskAgent answers doctor_availability queries using live clinician schedule summaries', async () => {
  const agent = new CareDeskAgent(
    createBaseMockAdapter({
      async getDoctorAvailabilitySummary() {
        return [
          {
            staffId: 'STF-1001',
            fullName: 'Dr. Priya Patel',
            department: 'General Medicine',
            specialty: 'Family Medicine',
            qualifications: 'MD, FAAFP',
            attendanceStatus: 'Available',
            effectiveOperationalState: 'Available',
            isBookableOnDate: true,
            workingHoursLabel: '08:30–17:00',
            breakWindowLabel: '12:00–13:00',
            bookedCount: 2,
            maxDailyCapacity: 12,
            nextAvailableSlot: {
              date: '2026-11-24',
              time: '14:00',
              department: 'General Medicine',
              clinician: 'Dr. Priya Patel',
              staffId: 'STF-1001',
              durationMinutes: 30,
            },
            availableSlots: [
              {
                date: '2026-11-24',
                time: '14:00',
                department: 'General Medicine',
                clinician: 'Dr. Priya Patel',
                staffId: 'STF-1001',
                durationMinutes: 30,
              },
            ],
          },
        ];
      },
    })
  );

  const reply = await agent.handlePrompt('Which doctors are available this afternoon?');
  assert.equal(reply.intent, 'doctor_availability');
  assert.ok(reply.headline.includes('1 Clinician Available'));
  assert.ok(reply.summary.includes('Dr. Priya Patel'));
  assert.ok(reply.plannedTools.some((t) => t.toolName === 'get_doctor_availability_summary'));
});

test('CareDeskAgent scopes Doctor role prompts to personal doctor dashboard and follow-ups', async () => {
  const doctorAgent = new CareDeskAgent(
    createBaseMockAdapter({
      role: 'Doctor',
      linkedStaffId: 'STF-1001',
      async getDoctorDashboard() {
        return {
          todayDate: '2026-11-24',
          doctor: {
            id: 'STF-1001',
            fullName: 'Dr. Priya Patel',
            role: 'Clinician',
            department: 'General Medicine',
            specialty: 'Family Medicine',
            email: 'priya@clinic.org',
            contactNumber: '+1-555-0100',
            status: 'Active',
            attendanceStatus: 'Available',
            createdAt: '',
            updatedAt: '',
          },
          effectiveOperationalState: 'Available',
          todayAppointments: [
            {
              id: 'APT-500',
              patientId: 'P-1042',
              patientName: 'Julian Mercer',
              appointmentDate: '2026-11-24',
              appointmentTime: '11:00',
              durationMinutes: 30,
              department: 'General Medicine',
              clinician: 'Dr. Priya Patel',
              staffId: 'STF-1001',
              status: 'Confirmed',
              notes: '',
              createdAt: '',
              updatedAt: '',
            },
          ],
          nextAppointment: {
            id: 'APT-500',
            patientId: 'P-1042',
            patientName: 'Julian Mercer',
            appointmentDate: '2026-11-24',
            appointmentTime: '11:00',
            durationMinutes: 30,
            department: 'General Medicine',
            clinician: 'Dr. Priya Patel',
            staffId: 'STF-1001',
            status: 'Confirmed',
            notes: '',
            createdAt: '',
            updatedAt: '',
          },
          assignedPatientsCount: 5,
          pendingConsultationsCount: 1,
          followupsRequiringAttention: [
            {
              id: 'FU-900',
              patientId: 'P-1042',
              patientName: 'Julian Mercer',
              appointmentId: null,
              description: 'Review CBC lab results',
              priority: 'High',
              createdDate: '2026-11-24',
              dueDate: '2026-11-25',
              status: 'Pending',
              createdAt: '',
              updatedAt: '',
            },
          ],
          upcomingUnavailability: [],
          todaySchedule: null,
        };
      },
    })
  );

  const scheduleReply = await doctorAgent.handlePrompt('What is my schedule today?');
  assert.equal(scheduleReply.intent, 'doctor_schedule');
  assert.ok(scheduleReply.headline.includes('Dr. Priya Patel'));
  assert.ok(scheduleReply.summary.includes('Julian Mercer'));

  const followupReply = await doctorAgent.handlePrompt('Show my follow-ups requiring attention.');
  assert.equal(followupReply.intent, 'followup_queue');
  assert.ok(followupReply.headline.includes('1 Follow-Up Task'));
});

test('CareDeskAgent strictly isolates Patient role from clinic-wide and other-patient queries', async () => {
  let clinicBriefingCalled = false;
  let otherPatientLookupCalled = false;

  const patientAgent = new CareDeskAgent(
    createBaseMockAdapter({
      role: 'Patient',
      linkedPatientId: 'P-1001',
      async getDailyReport() {
        clinicBriefingCalled = true;
        throw new Error('Should never invoke clinic-wide daily report for Patient role');
      },
      async getPatientWithHistory() {
        otherPatientLookupCalled = true;
        throw new Error('Should never invoke arbitrary patient lookup for Patient role');
      },
      async getPatientHealthData() {
        return {
          patient: {
            id: 'P-1001',
            fullName: 'Elena Vance',
            dateOfBirth: '1986-02-14',
            contactNumber: '+1-555-0102',
            email: 'elena@example.org',
            registrationDate: '2025-01-10',
            administrativeStatus: 'Active',
            createdAt: '',
          },
          consultations: [
            {
              id: 'CON-4001',
              clinicId: 'CLN-1001',
              appointmentId: 'APT-10',
              patientId: 'P-1001',
              staffId: 'STF-1001',
              doctorName: 'Dr. Priya Patel',
              consultationDate: '2026-11-20',
              summary: 'Routine blood pressure check within target range.',
              diagnosisNotes: 'Controlled hypertension',
              recommendations: 'Continue home BP log twice weekly.',
              prescriptions: [
                {
                  medication: 'Lisinopril',
                  dosage: '10 mg',
                  frequency: 'Once daily',
                  duration: '90 days',
                  instructions: 'Take each morning with water.',
                },
              ],
              testResults: [],
              patientVisible: true,
              createdAt: '',
              updatedAt: '',
            },
          ],
          prescriptions: [
            {
              medication: 'Lisinopril',
              dosage: '10 mg',
              frequency: 'Once daily',
              duration: '90 days',
              instructions: 'Take each morning with water.',
              consultationId: 'CON-4001',
              consultationDate: '2026-11-20',
              doctorName: 'Dr. Priya Patel',
            },
          ],
          testResults: [],
          followups: [],
        };
      },
      async getPatientNotifications() {
        return [
          {
            id: 'NTF-1',
            clinicId: 'CLN-1001',
            userId: 'USR-P1',
            patientId: 'P-1001',
            staffId: 'STF-1001',
            title: 'Consultation Published',
            message: 'Dr. Priya Patel published your 2026-11-20 consultation summary.',
            kind: 'consultation',
            relatedType: 'consultation',
            relatedId: 'CON-4001',
            isRead: false,
            createdAt: '2026-11-20T12:00:00Z',
          },
        ];
      },
    })
  );

  // 1. Blocked cross-patient lookup
  const crossPatient = await patientAgent.handlePrompt('Show patient P-1042');
  assert.equal(crossPatient.intent, 'non_clinical_refusal');
  assert.equal(crossPatient.headline, 'Patient Portal Scope Only');
  assert.equal(otherPatientLookupCalled, false);

  // 2. Blocked clinic-wide briefing
  const clinicWide = await patientAgent.handlePrompt("Give me today's clinic briefing.");
  assert.equal(clinicWide.intent, 'non_clinical_refusal');
  assert.equal(clinicWide.headline, 'Patient Portal Scope Only');
  assert.equal(clinicBriefingCalled, false);

  // 3. Allowed own published health summary & prescriptions
  const healthReply = await patientAgent.handlePrompt('Show my recent consultation summary and prescriptions.');
  assert.equal(healthReply.intent, 'patient_health_summary');
  assert.ok(healthReply.summary.includes('Dr. Priya Patel'));
  assert.ok(healthReply.summary.includes('1 prescription item'));

  // 4. Allowed own notifications
  const notifReply = await patientAgent.handlePrompt('Show my notifications.');
  assert.equal(notifReply.intent, 'patient_notifications');
  assert.ok(notifReply.headline.includes('1 Unread Notification'));
});

test('CareDeskAgent enforces strict Doctor scope across all phrasings without falling through to Admin logic', async () => {
  let dailyReportCalled = false;
  let overviewReportCalled = false;
  let availabilitySummaryCalled = false;
  let pendingFollowupsCalled = false;
  let unconfirmedCalled = false;
  let missedCalled = false;
  let availabilityCalled = false;

  const doctorAgent = new CareDeskAgent(
    createBaseMockAdapter({
      role: 'Doctor',
      linkedStaffId: 'STF-1001',
      async getDailyReport() {
        dailyReportCalled = true;
        throw new Error('Should never invoke clinic-wide daily report for Doctor role');
      },
      async getOverviewReport() {
        overviewReportCalled = true;
        throw new Error('Should never invoke clinic-wide overview report for Doctor role');
      },
      async getDoctorAvailabilitySummary() {
        availabilitySummaryCalled = true;
        throw new Error('Should never invoke clinic-wide doctor roster for Doctor role');
      },
      async getDoctorDashboard() {
        return {
          todayDate: '2026-11-24',
          doctor: {
            id: 'STF-1001',
            fullName: 'Dr. Priya Patel',
            role: 'Clinician',
            department: 'General Medicine',
            specialty: 'Family & Primary Care',
            qualifications: 'MD, MPH',
            licenseNumber: 'CA-98412',
            bio: '',
            email: 'priya@clinic.org',
            contactNumber: '+1-555-0100',
            status: 'Active',
            attendanceStatus: 'Available',
            defaultAppointmentDuration: 30,
            maxDailyCapacity: 16,
            verificationStatus: 'Approved',
            createdAt: '',
            updatedAt: '',
          },
          effectiveOperationalState: 'Available',
          todayAppointments: [
            {
              id: 'APT-2025',
              patientId: 'P-1026',
              patientName: 'Marcus Holloway',
              staffId: 'STF-1001',
              appointmentDate: '2026-11-24',
              appointmentTime: '08:30',
              durationMinutes: 30,
              department: 'General Medicine',
              clinician: 'Dr. Priya Patel',
              status: 'Confirmed',
              notes: '',
              createdAt: '',
              updatedAt: '',
            },
          ],
          nextAppointment: {
            id: 'APT-2025',
            patientId: 'P-1026',
            patientName: 'Marcus Holloway',
            staffId: 'STF-1001',
            appointmentDate: '2026-11-24',
            appointmentTime: '08:30',
            durationMinutes: 30,
            department: 'General Medicine',
            clinician: 'Dr. Priya Patel',
            status: 'Confirmed',
            notes: '',
            createdAt: '',
            updatedAt: '',
          },
          assignedPatientsCount: 4,
          pendingConsultationsCount: 1,
          followupsRequiringAttention: [
            {
              id: 'FU-3004',
              patientId: 'P-1042',
              patientName: 'Julian Mercer',
              appointmentId: 'APT-2019',
              assignedStaffId: 'STF-1001',
              assignedToName: 'Dr. Priya Patel',
              description: 'Follow up with Julian Mercer',
              priority: 'High',
              createdDate: '2026-11-22',
              dueDate: '2026-11-25',
              status: 'Pending',
              createdAt: '',
              updatedAt: '',
            },
          ],
          upcomingUnavailability: [],
          todaySchedule: null,
        };
      },
      async getPendingFollowups() {
        pendingFollowupsCalled = true;
        return [
          {
            id: 'FU-3004',
            patientId: 'P-1042',
            patientName: 'Julian Mercer',
            appointmentId: 'APT-2019',
            assignedStaffId: 'STF-1001',
            assignedToName: 'Dr. Priya Patel',
            description: 'Follow up with Julian Mercer',
            priority: 'High',
            createdDate: '2026-11-22',
            dueDate: '2026-11-25',
            status: 'Pending',
            createdAt: '',
            updatedAt: '',
          },
        ];
      },
      async getUnconfirmedAppointments() {
        unconfirmedCalled = true;
        return [
          {
            id: 'APT-2034',
            patientId: 'P-1034',
            patientName: 'Kenneth Osei',
            staffId: 'STF-1001',
            appointmentDate: '2026-11-25',
            appointmentTime: '11:00',
            durationMinutes: 30,
            department: 'General Medicine',
            clinician: 'Dr. Priya Patel',
            status: 'Scheduled',
            notes: '',
            createdAt: '',
            updatedAt: '',
          },
        ];
      },
      async getMissedAppointments() {
        missedCalled = true;
        return [
          {
            id: 'APT-2019',
            patientId: 'P-1042',
            patientName: 'Julian Mercer',
            staffId: 'STF-1001',
            appointmentDate: '2026-11-22',
            appointmentTime: '14:00',
            durationMinutes: 30,
            department: 'General Medicine',
            clinician: 'Dr. Priya Patel',
            status: 'Missed',
            notes: '',
            createdAt: '',
            updatedAt: '',
          },
        ];
      },
      async checkAvailability() {
        availabilityCalled = true;
        return [
          {
            date: '2026-11-24',
            time: '10:00',
            department: 'General Medicine',
            clinician: 'Dr. Priya Patel',
            durationMinutes: 30,
          },
        ];
      },
      async getPatientWithHistory(patientId) {
        if (patientId === 'P-1028') {
          throw new Error('Patients outside your assigned caseload cannot be accessed.');
        }
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
              staffId: 'STF-1001',
              appointmentDate: '2026-11-22',
              appointmentTime: '14:00',
              durationMinutes: 30,
              department: 'General Medicine',
              clinician: 'Dr. Priya Patel',
              status: 'Missed',
              notes: '',
              createdAt: '',
              updatedAt: '',
            },
          ],
          followups: [],
        };
      },
    })
  );

  // 1. Clinic-wide / cross-doctor prompts (without 'my') must be refused cleanly
  for (const blockedPrompt of [
    "Give me today's clinic briefing.",
    'Clinic overview',
    'Which doctors are available today?',
    'Show doctor availability across the clinic',
    'Show all patients',
    'Show staff roster',
  ]) {
    const reply = await doctorAgent.handlePrompt(blockedPrompt);
    assert.equal(reply.intent, 'non_clinical_refusal', `Expected refusal for "${blockedPrompt}"`);
    assert.equal(reply.headline, 'Doctor Scope Only');
  }
  assert.equal(dailyReportCalled, false);
  assert.equal(overviewReportCalled, false);
  assert.equal(availabilitySummaryCalled, false);

  // 2. Operational prompts phrased WITHOUT 'my' still stay in Doctor scope (never Admin daily report)
  const overdueReply = await doctorAgent.handlePrompt('Identify overdue follow-ups.');
  assert.equal(overdueReply.intent, 'followup_queue');
  assert.ok(overdueReply.headline.includes('Requiring Your Attention'));
  assert.equal(pendingFollowupsCalled, true);

  const unconfirmedReply = await doctorAgent.handlePrompt('Show pending appointments.');
  assert.equal(unconfirmedReply.intent, 'unconfirmed_appointments');
  assert.ok(unconfirmedReply.headline.includes('On Your Schedule') || unconfirmedReply.headline.includes('on Your Schedule'));
  assert.equal(unconfirmedCalled, true);

  const missedReply = await doctorAgent.handlePrompt('Identify patients who missed appointments in the last seven days.');
  assert.equal(missedReply.intent, 'missed_appointments');
  assert.ok(missedReply.headline.includes('In Your Caseload') || missedReply.headline.includes('in Your Caseload'));
  assert.equal(missedCalled, true);

  const prepFollowupReply = await doctorAgent.handlePrompt('Prepare an administrative follow-up list.');
  assert.equal(prepFollowupReply.intent, 'prepare_followup_list');
  assert.equal(prepFollowupReply.headline, 'Caseload Missed Appointment Follow-Up Plan');

  const slotReply = await doctorAgent.handlePrompt('Find the next available appointment slot.');
  assert.equal(slotReply.intent, 'find_available_slot');
  assert.ok(slotReply.headline.includes('Next Available Slot:'));
  assert.equal(availabilityCalled, true);

  // 3. Cross-caseload patient summary & reschedule fail closed cleanly
  const otherPatientReply = await doctorAgent.handlePrompt('Show patient P-1028');
  assert.equal(otherPatientReply.intent, 'non_clinical_refusal');
  assert.equal(otherPatientReply.headline, 'Doctor Scope Only');
  assert.equal(otherPatientReply.pendingConfirmation, undefined);

  const otherReschedReply = await doctorAgent.handlePrompt('Reschedule patient P-1028');
  assert.equal(otherReschedReply.intent, 'non_clinical_refusal');
  assert.equal(otherReschedReply.headline, 'Doctor Scope Only');
  assert.equal(otherReschedReply.pendingConfirmation, undefined);

  // Missing patient ID must fail closed or ask to specify an assigned patient rather than defaulting to P-1042
  const missingIdSummary = await doctorAgent.handlePrompt('Show patient chart summary');
  assert.equal(missingIdSummary.intent, 'non_clinical_refusal');
  assert.equal(missingIdSummary.headline, 'Doctor Scope Only');

  const missingIdResched = await doctorAgent.handlePrompt('Reschedule a patient');
  assert.equal(missingIdResched.intent, 'general_help');
  assert.equal(missingIdResched.headline, 'Specify an Assigned Patient ID to Reschedule');
  assert.equal(missingIdResched.pendingConfirmation, undefined);

  // 4. Unrecognized prompt stays in Clinician Copilot rather than Admin fallback
  const unknownReply = await doctorAgent.handlePrompt('Hello there');
  assert.equal(unknownReply.intent, 'general_help');
  assert.equal(unknownReply.headline, 'CareDesk Clinician Copilot');

  // 5. Never invokes clinic-wide reporting adapters
  assert.equal(dailyReportCalled, false);
  assert.equal(overviewReportCalled, false);
  assert.equal(availabilitySummaryCalled, false);

  // 6. Unlinked doctor adapter fails closed
  const unlinkedDoctorAgent = new CareDeskAgent(
    createBaseMockAdapter({
      role: 'Doctor',
      linkedStaffId: null,
    })
  );
  const unlinkedReply = await unlinkedDoctorAgent.handlePrompt('What is my schedule today?');
  assert.equal(unlinkedReply.intent, 'non_clinical_refusal');
  assert.equal(unlinkedReply.headline, 'Doctor Scope Only');
});

