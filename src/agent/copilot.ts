import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  Appointment,
  AssistantPlannedTool,
  AssistantResponse,
  AvailableSlot,
  DailyReport,
  FollowUpTask,
  OverviewReport,
  Patient,
} from '../shared/types';
import {
  CLINIC_DEPARTMENTS,
  containsClinicalDiagnosisRequest,
  getClinicTodayDate,
  addDaysToDateString,
} from '../server/domain/rules';

/**
 * Adapter boundary decoupling the AI agent from database internals.
 * Today this calls the local CareDesk REST service adapter in development preview.
 * Once Synapse CLI generates an MCP server from CareDesk's backend endpoints,
 * this adapter can be swapped for an MCP client transport without changing agent orchestration.
 */
export interface CareDeskToolAdapter {
  getDailyReport(date?: string): Promise<DailyReport>;
  getOverviewReport(): Promise<OverviewReport>;
  getUnconfirmedAppointments(): Promise<Appointment[]>;
  getMissedAppointments(days?: number): Promise<Appointment[]>;
  getPendingFollowups(): Promise<FollowUpTask[]>;
  checkAvailability(params: {
    startDate?: string;
    department?: string;
    clinician?: string;
    patientId?: string;
    limit?: number;
  }): Promise<AvailableSlot[]>;
  getPatientWithHistory(patientId: string): Promise<{
    patient: Patient;
    appointments: Appointment[];
    followups: FollowUpTask[];
  }>;
  getAppointmentById(appointmentId: string): Promise<Appointment>;
  rescheduleAppointment(
    appointmentId: string,
    patch: { appointmentDate: string; appointmentTime: string; notes?: string }
  ): Promise<Appointment>;
  createFollowup(input: {
    patientId: string;
    appointmentId?: string | null;
    description: string;
    priority: 'High' | 'Medium' | 'Low';
    dueDate: string;
  }): Promise<FollowUpTask>;
}

const DEVELOPMENT_NOTICE =
  'Development Preview: Operating via Direct Local REST Adapter. Synapse CLI MCP tools are not yet connected.';

export type AgentIntent =
  | 'daily_briefing'
  | 'unconfirmed_appointments'
  | 'missed_appointments'
  | 'prepare_followup_list'
  | 'find_available_slot'
  | 'reschedule_patient'
  | 'non_clinical_refusal'
  | 'general_help';

function extractLookbackDays(text: string): number | undefined {
  const lower = text.toLowerCase();
  const numMatch = /\b(?:last|past)\s+(\d{1,2})\s+days?\b/.exec(lower);
  if (numMatch) {
    return Math.min(Math.max(1, Number(numMatch[1])), 90);
  }
  const wordMap: Record<string, number> = {
    three: 3,
    five: 5,
    seven: 7,
    ten: 10,
    fourteen: 14,
    thirty: 30,
  };
  for (const [word, val] of Object.entries(wordMap)) {
    if (lower.includes(`${word} days`) || lower.includes(`${word} day`)) {
      return val;
    }
  }
  if (lower.includes('week') || lower.includes('7d')) return 7;
  if (lower.includes('month')) return 30;
  return undefined;
}

export function classifyIntentDeterministically(prompt: string): {
  intent: AgentIntent;
  patientId?: string;
  department?: string;
  days?: number;
} {
  const trimmed = prompt.trim();
  if (containsClinicalDiagnosisRequest(trimmed)) {
    return { intent: 'non_clinical_refusal' };
  }

  const lower = trimmed.toLowerCase();
  const patientMatch = /\b(P-\d{3,6})\b/i.exec(trimmed);
  const patientId = patientMatch ? patientMatch[1].toUpperCase() : undefined;
  const days = extractLookbackDays(trimmed);

  const matchedDepartment = CLINIC_DEPARTMENTS.find((dept) =>
    lower.includes(dept.toLowerCase())
  );

  if (
    lower.includes('reschedule') ||
    lower.includes('move appointment') ||
    lower.includes('rebook')
  ) {
    return { intent: 'reschedule_patient', patientId, department: matchedDepartment, days };
  }

  if (
    lower.includes('follow-up list') ||
    lower.includes('followup list') ||
    lower.includes('administrative follow-up') ||
    lower.includes('prepare a follow-up') ||
    lower.includes('create follow-up')
  ) {
    return { intent: 'prepare_followup_list', patientId, department: matchedDepartment, days };
  }

  if (
    lower.includes('missed') ||
    lower.includes('no-show') ||
    lower.includes('no show')
  ) {
    return { intent: 'missed_appointments', patientId, department: matchedDepartment, days };
  }

  if (
    lower.includes('unconfirmed') ||
    lower.includes('not confirmed') ||
    lower.includes('awaiting confirmation')
  ) {
    return { intent: 'unconfirmed_appointments', patientId, department: matchedDepartment, days };
  }

  if (
    lower.includes('available') ||
    lower.includes('next slot') ||
    lower.includes('open slot') ||
    lower.includes('availability')
  ) {
    return { intent: 'find_available_slot', patientId, department: matchedDepartment, days };
  }

  if (
    lower.includes('briefing') ||
    lower.includes('today') ||
    lower.includes('summary') ||
    lower.includes('operations') ||
    lower.includes('overview')
  ) {
    return { intent: 'daily_briefing', patientId, department: matchedDepartment, days };
  }

  return { intent: 'general_help', patientId, department: matchedDepartment, days };
}

async function classifyIntentWithOptionalGemini(prompt: string): Promise<{
  intent: AgentIntent;
  patientId?: string;
  department?: string;
  days?: number;
}> {
  const deterministic = classifyIntentDeterministically(prompt);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return deterministic;
  }

  // Use Gemini solely for natural-language intent & parameter extraction; never for data generation.
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Extract the clinic operations intent and optional parameters from this user request: "${prompt}"`,
      config: {
        systemInstruction:
          'You classify clinic administration prompts into one allowed intent without inventing any medical or patient data.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: {
              type: Type.STRING,
              description:
                'One of: daily_briefing, unconfirmed_appointments, missed_appointments, prepare_followup_list, find_available_slot, reschedule_patient, non_clinical_refusal, general_help',
            },
            patientId: { type: Type.STRING, nullable: true },
            department: { type: Type.STRING, nullable: true },
            days: { type: Type.INTEGER, nullable: true },
          },
          required: ['intent'],
        },
      },
    });
    const text = response.text;
    if (!text) return deterministic;
    const parsed = JSON.parse(text) as {
      intent?: AgentIntent;
      patientId?: string | null;
      department?: string | null;
      days?: number | null;
    };
    const validIntents: ReadonlySet<string> = new Set([
      'daily_briefing',
      'unconfirmed_appointments',
      'missed_appointments',
      'prepare_followup_list',
      'find_available_slot',
      'reschedule_patient',
      'non_clinical_refusal',
      'general_help',
    ]);
    if (parsed.intent && validIntents.has(parsed.intent)) {
      return {
        intent: parsed.intent,
        patientId: parsed.patientId ?? deterministic.patientId,
        department: parsed.department ?? deterministic.department,
        days:
          typeof parsed.days === 'number' && parsed.days >= 1 && parsed.days <= 90
            ? parsed.days
            : deterministic.days,
      };
    }
  } catch {
    // Gracefully fall back to deterministic NLU routing if Gemini is unavailable.
  }
  return deterministic;
}

export class CareDeskAgent {
  private adapter: CareDeskToolAdapter;

  constructor(adapter: CareDeskToolAdapter) {
    this.adapter = adapter;
  }

  async handlePrompt(prompt: string): Promise<AssistantResponse> {
    const replyId = crypto.randomUUID();
    const { intent, patientId, department, days } = await classifyIntentWithOptionalGemini(prompt);

    if (intent === 'non_clinical_refusal') {
      return {
        replyId,
        intent,
        headline: 'Administrative Scope Only',
        summary:
          'CareDesk Assistant is restricted to clinic administration, scheduling, follow-up coordination, and operational reporting. It cannot evaluate symptoms, recommend treatments, or provide medical diagnoses.',
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools: [],
        structuredData: { type: 'non_clinical_notice' },
      };
    }

    if (intent === 'daily_briefing') {
      const [daily, overview] = await Promise.all([
        this.adapter.getDailyReport(),
        this.adapter.getOverviewReport(),
      ]);

      const plannedTools: AssistantPlannedTool[] = [
        {
          toolName: 'get_daily_operational_report',
          endpoint: 'GET /api/reports/daily',
          status: 'local-rest-preview',
          description: 'Fetched live today appointment counts and status breakdown.',
        },
        {
          toolName: 'get_overview_report',
          endpoint: 'GET /api/reports/overview',
          status: 'local-rest-preview',
          description: 'Fetched 7-day missed appointment and pending follow-up metrics.',
        },
      ];

      return {
        replyId,
        intent,
        headline: `Clinic Operations Briefing for ${daily.date}`,
        summary: `Today has ${daily.totalAppointments} total appointments: ${daily.confirmedAppointments} confirmed, ${daily.unconfirmedAppointments} unconfirmed, ${daily.completedAppointments} completed, and ${daily.missedAppointments} missed. There are ${overview.pendingFollowUpsCount} open administrative follow-ups (${overview.highPriorityFollowUpsCount} high priority).`,
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools,
        structuredData: {
          type: 'daily_briefing',
          metrics: {
            totalToday: daily.totalAppointments,
            confirmed: daily.confirmedAppointments,
            unconfirmed: daily.unconfirmedAppointments,
            missedToday: daily.missedAppointments,
            pendingFollowUps: overview.pendingFollowUpsCount,
            missedLast7Days: overview.missedLastSevenDaysCount,
          },
          items: daily.upcomingAppointments,
        },
      };
    }

    if (intent === 'unconfirmed_appointments') {
      const unconfirmed = await this.adapter.getUnconfirmedAppointments();
      return {
        replyId,
        intent,
        headline: `${unconfirmed.length} Unconfirmed Upcoming Appointments`,
        summary:
          unconfirmed.length === 0
            ? 'All upcoming appointments are currently confirmed.'
            : `Found ${unconfirmed.length} appointments in Scheduled status awaiting patient confirmation.`,
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools: [
          {
            toolName: 'get_unconfirmed_appointments',
            endpoint: 'GET /api/appointments/unconfirmed',
            status: 'local-rest-preview',
            description: 'Queried upcoming appointments with Scheduled status.',
          },
        ],
        structuredData: {
          type: 'unconfirmed_appointments',
          items: unconfirmed,
        },
      };
    }

    if (intent === 'missed_appointments') {
      const lookbackDays = days ?? 7;
      const missed = await this.adapter.getMissedAppointments(lookbackDays);
      return {
        replyId,
        intent,
        headline: `${missed.length} Missed Appointments in the Last ${lookbackDays} Days`,
        summary:
          missed.length === 0
            ? `No missed appointments were recorded in the past ${lookbackDays} days.`
            : `Identified ${missed.length} missed appointments across ${new Set(missed.map((m) => m.patientId)).size} patients over the last ${lookbackDays} days.`,
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools: [
          {
            toolName: 'get_missed_appointments',
            endpoint: `GET /api/appointments/missed?days=${lookbackDays}`,
            status: 'local-rest-preview',
            description: `Retrieved missed appointments for the past ${lookbackDays}-day window.`,
          },
        ],
        structuredData: {
          type: 'missed_appointments',
          items: missed,
        },
      };
    }

    if (intent === 'prepare_followup_list') {
      const lookbackDays = days ?? 7;
      const [missed, pending] = await Promise.all([
        this.adapter.getMissedAppointments(lookbackDays),
        this.adapter.getPendingFollowups(),
      ]);

      const openAppointmentIds = new Set(
        pending.map((f) => f.appointmentId).filter((id): id is string => Boolean(id))
      );

      const needingTask = missed.filter((apt) => !openAppointmentIds.has(apt.id));
      const alreadyTracked = missed.filter((apt) => openAppointmentIds.has(apt.id));

      const plannedTools: AssistantPlannedTool[] = [
        {
          toolName: 'get_missed_appointments',
          endpoint: `GET /api/appointments/missed?days=${lookbackDays}`,
          status: 'local-rest-preview',
          description: `Loaded missed appointments from the last ${lookbackDays} days.`,
        },
        {
          toolName: 'get_pending_followups',
          endpoint: 'GET /api/followups/pending',
          status: 'local-rest-preview',
          description: 'Checked existing pending follow-up tasks to avoid duplicates.',
        },
      ];

      let pendingConfirmation: AssistantResponse['pendingConfirmation'];
      if (needingTask.length > 0) {
        plannedTools.push({
          toolName: 'create_followup_task',
          endpoint: 'POST /api/followups',
          status: 'awaiting-confirmation',
          description: `Prepared ${needingTask.length} new follow-up task(s) awaiting administrator confirmation.`,
        });
        const dueDate = addDaysToDateString(getClinicTodayDate(), 1);
        pendingConfirmation = {
          confirmationId: crypto.randomUUID(),
          actionType: 'create_missed_followups',
          title: `Create ${needingTask.length} Missing Follow-Up Task${needingTask.length > 1 ? 's' : ''}`,
          summary: `${alreadyTracked.length} missed appointment(s) already have open tasks. Confirm to create ${needingTask.length} new High-priority follow-up task(s) due ${dueDate}.`,
          details: {
            'Missed Appointments (7d)': missed.length,
            'Already Tracked': alreadyTracked.length,
            'New Tasks To Create': needingTask.length,
            'Target Due Date': dueDate,
          },
          payload: {
            tasks: needingTask.map((apt) => ({
              patientId: apt.patientId,
              patientName: apt.patientName ?? apt.patientId,
              appointmentId: apt.id,
              description: `Outreach & reschedule follow-up for missed ${apt.department} visit (${apt.id} on ${apt.appointmentDate}).`,
              priority: 'High' as const,
              dueDate,
            })),
          },
        };
      }

      return {
        replyId,
        intent,
        headline: 'Missed Appointment Follow-Up Outreach Plan',
        summary:
          needingTask.length > 0
            ? `Prepared follow-up coverage for ${missed.length} missed appointments: ${alreadyTracked.length} already have active tasks and ${needingTask.length} require new tasks.`
            : `All ${missed.length} missed appointments from the past 7 days already have active follow-up tasks on file.`,
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools,
        structuredData: {
          type: 'followup_plan',
          metrics: {
            totalMissed: missed.length,
            alreadyTracked: alreadyTracked.length,
            needingTask: needingTask.length,
          },
          items: missed.map((apt) => ({
            ...apt,
            hasOpenFollowUp: openAppointmentIds.has(apt.id),
          })),
        },
        pendingConfirmation,
      };
    }

    if (intent === 'find_available_slot') {
      const slots = await this.adapter.checkAvailability({
        startDate: getClinicTodayDate(),
        department,
        patientId,
        limit: 8,
      });

      return {
        replyId,
        intent,
        headline:
          slots.length > 0
            ? `Next Available Appointment Slot: ${slots[0].date} at ${slots[0].time}`
            : 'No Open Appointment Slots Found',
        summary:
          slots.length > 0
            ? `Found ${slots.length} conflict-free 30-minute slots starting ${slots[0].date} at ${slots[0].time} (${slots[0].department} · ${slots[0].clinician}).`
            : 'No open slots matched the requested department or date window.',
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools: [
          {
            toolName: 'check_appointment_availability',
            endpoint: 'GET /api/appointments/availability',
            status: 'local-rest-preview',
            description: 'Checked clinician schedules for conflict-free 30-minute slots.',
          },
        ],
        structuredData: {
          type: 'available_slots',
          items: slots,
        },
      };
    }

    if (intent === 'reschedule_patient') {
      const targetPatientId = patientId ?? 'P-1042';
      const history = await this.adapter.getPatientWithHistory(targetPatientId);

      // Prefer a Missed or Scheduled appointment for rescheduling
      const candidateAppointment =
        history.appointments.find((a) => a.status === 'Missed') ??
        history.appointments.find((a) => a.status === 'Scheduled') ??
        history.appointments[0];

      if (!candidateAppointment) {
        return {
          replyId,
          intent,
          headline: `No Appointments Found for ${history.patient.fullName} (${targetPatientId})`,
          summary: `${history.patient.fullName} does not have an existing appointment record to reschedule.`,
          integrationNotice: DEVELOPMENT_NOTICE,
          mode: 'development-local-rest-preview',
          plannedTools: [
            {
              toolName: 'get_patient_by_id',
              endpoint: `GET /api/patients/${targetPatientId}`,
              status: 'local-rest-preview',
              description: 'Loaded patient record and appointment history.',
            },
          ],
        };
      }

      const slots = await this.adapter.checkAvailability({
        startDate: addDaysToDateString(getClinicTodayDate(), 1),
        clinician: candidateAppointment.clinician,
        department: candidateAppointment.department,
        patientId: targetPatientId,
        limit: 4,
      });

      const fallbackSlots =
        slots.length > 0
          ? slots
          : await this.adapter.checkAvailability({
              startDate: addDaysToDateString(getClinicTodayDate(), 1),
              patientId: targetPatientId,
              limit: 4,
            });

      if (fallbackSlots.length === 0) {
        return {
          replyId,
          intent,
          headline: `No Open Slots Available for ${targetPatientId}`,
          summary: 'Could not find a conflict-free slot within the next 5 days.',
          integrationNotice: DEVELOPMENT_NOTICE,
          mode: 'development-local-rest-preview',
          plannedTools: [
            {
              toolName: 'check_appointment_availability',
              endpoint: 'GET /api/appointments/availability',
              status: 'local-rest-preview',
              description: 'Checked availability for rescheduling.',
            },
          ],
        };
      }

      const proposedSlot = fallbackSlots[0];
      return {
        replyId,
        intent,
        headline: `Reschedule Proposal for ${history.patient.fullName} (${targetPatientId})`,
        summary: `Prepared a conflict-free slot to move ${candidateAppointment.id} (previously ${candidateAppointment.status} on ${candidateAppointment.appointmentDate} at ${candidateAppointment.appointmentTime}) to ${proposedSlot.date} at ${proposedSlot.time} with ${proposedSlot.clinician}. Administrator confirmation is required before modifying the schedule.`,
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools: [
          {
            toolName: 'get_patient_by_id',
            endpoint: `GET /api/patients/${targetPatientId}`,
            status: 'local-rest-preview',
            description: `Identified ${candidateAppointment.id} (${candidateAppointment.status}).`,
          },
          {
            toolName: 'check_appointment_availability',
            endpoint: 'GET /api/appointments/availability',
            status: 'local-rest-preview',
            description: `Selected open slot ${proposedSlot.date} ${proposedSlot.time}.`,
          },
          {
            toolName: 'update_appointment',
            endpoint: `PATCH /api/appointments/${candidateAppointment.id}`,
            status: 'awaiting-confirmation',
            description: 'Waiting for administrator approval before writing update.',
          },
        ],
        structuredData: {
          type: 'reschedule_proposal',
          items: fallbackSlots,
        },
        pendingConfirmation: {
          confirmationId: crypto.randomUUID(),
          actionType: 'reschedule_appointment',
          title: `Confirm Reschedule for ${history.patient.fullName} (${targetPatientId})`,
          summary: `Move ${candidateAppointment.id} from ${candidateAppointment.appointmentDate} ${candidateAppointment.appointmentTime} (${candidateAppointment.status}) to ${proposedSlot.date} at ${proposedSlot.time} (${proposedSlot.clinician}) and set status to Scheduled.`,
          details: {
            Patient: `${history.patient.fullName} (${targetPatientId})`,
            Appointment: candidateAppointment.id,
            'Previous Slot': `${candidateAppointment.appointmentDate} ${candidateAppointment.appointmentTime} (${candidateAppointment.status})`,
            'Proposed Slot': `${proposedSlot.date} ${proposedSlot.time}`,
            Department: proposedSlot.department,
            Clinician: proposedSlot.clinician,
          },
          payload: {
            appointmentId: candidateAppointment.id,
            appointmentDate: proposedSlot.date,
            appointmentTime: proposedSlot.time,
            clinician: proposedSlot.clinician,
            department: proposedSlot.department,
          },
        },
      };
    }

    return {
      replyId,
      intent: 'general_help',
      headline: 'CareDesk Administrative Copilot',
      summary:
        'Ask about today’s operational briefing, unconfirmed appointments, missed visits over the last 7 days, missed-visit follow-up lists, next available slots, or rescheduling a specific patient (e.g. P-1042).',
      integrationNotice: DEVELOPMENT_NOTICE,
      mode: 'development-local-rest-preview',
      plannedTools: [],
    };
  }

  async confirmPendingAction(confirmation: {
    actionType: 'reschedule_appointment' | 'create_missed_followups';
    payload: Record<string, unknown>;
  }): Promise<AssistantResponse> {
    const replyId = crypto.randomUUID();

    if (confirmation.actionType === 'reschedule_appointment') {
      const payload = confirmation.payload as {
        appointmentId: string;
        appointmentDate: string;
        appointmentTime: string;
      };
      const updated = await this.adapter.rescheduleAppointment(payload.appointmentId, {
        appointmentDate: payload.appointmentDate,
        appointmentTime: payload.appointmentTime,
        notes: `Rescheduled via CareDesk Assistant (Local REST Preview) after administrator confirmation.`,
      });
      const verified = await this.adapter.getAppointmentById(updated.id);

      return {
        replyId,
        intent: 'reschedule_patient',
        headline: `Rescheduled ${verified.id} to ${verified.appointmentDate} at ${verified.appointmentTime}`,
        summary: `Administrator confirmed. Appointment ${verified.id} for ${verified.patientName ?? verified.patientId} is persisted and verified as Scheduled on ${verified.appointmentDate} at ${verified.appointmentTime} with ${verified.clinician}.`,
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools: [
          {
            toolName: 'update_appointment',
            endpoint: `PATCH /api/appointments/${verified.id}`,
            status: 'executed-via-local-rest',
            description: 'Updated appointment slot and recorded audit entry.',
          },
          {
            toolName: 'get_appointment_by_id',
            endpoint: `GET /api/appointments/${verified.id}`,
            status: 'executed-via-local-rest',
            description: 'Verified persisted appointment record in SQLite.',
          },
        ],
        structuredData: {
          type: 'action_completed',
          items: [verified],
        },
      };
    }

    if (confirmation.actionType === 'create_missed_followups') {
      const tasks = (confirmation.payload as {
        tasks: Array<{
          patientId: string;
          appointmentId: string;
          description: string;
          priority: 'High' | 'Medium' | 'Low';
          dueDate: string;
        }>;
      }).tasks;

      const created: FollowUpTask[] = [];
      for (const task of tasks) {
        const result = await this.adapter.createFollowup({
          patientId: task.patientId,
          appointmentId: task.appointmentId,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate,
        });
        created.push(result);
      }

      return {
        replyId,
        intent: 'prepare_followup_list',
        headline: `Created ${created.length} Administrative Follow-Up Task${created.length > 1 ? 's' : ''}`,
        summary: `Administrator confirmed. Added ${created.length} High-priority follow-up task(s) to the pending outreach queue.`,
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools: [
          {
            toolName: 'create_followup_task',
            endpoint: 'POST /api/followups',
            status: 'executed-via-local-rest',
            description: `Created ${created.length} follow-up record(s) in clinic database.`,
          },
        ],
        structuredData: {
          type: 'action_completed',
          items: created,
        },
      };
    }

    throw new Error('Unsupported confirmation action type.');
  }
}
