import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  Appointment,
  AssistantPlannedTool,
  AssistantResponse,
  AssistantResponseSection,
  AssistantStreamEvent,
  AvailableSlot,
  DailyReport,
  FollowUpTask,
  OverviewReport,
  Patient,
} from '../shared/types';
import {
  CLINIC_DEPARTMENTS,
  addDaysToDateString,
  containsClinicalDiagnosisRequest,
  getClinicTodayDate,
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

export interface HandlePromptOptions {
  signal?: AbortSignal;
  onEvent?: (event: AssistantStreamEvent) => void;
}

const DEVELOPMENT_NOTICE =
  'Development Preview: Operating via Direct Local REST Adapter. Synapse CLI MCP tools are not yet connected.';

export type AgentIntent =
  | 'daily_briefing'
  | 'unconfirmed_appointments'
  | 'missed_appointments'
  | 'prepare_followup_list'
  | 'followup_queue'
  | 'find_available_slot'
  | 'reschedule_patient'
  | 'patient_summary'
  | 'non_clinical_refusal'
  | 'general_help';

function hasConfiguredGeminiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return apiKey;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Assistant generation cancelled by user.');
    err.name = 'AbortError';
    throw err;
  }
}

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
    lower.includes('overdue follow') ||
    lower.includes('pending follow') ||
    lower.includes('follow-up queue') ||
    lower.includes('followup queue') ||
    lower.includes('follow-ups') ||
    lower.includes('followups')
  ) {
    return { intent: 'followup_queue', patientId, department: matchedDepartment, days };
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
    lower.includes('awaiting confirmation') ||
    lower.includes('pending appointment')
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
    if (patientId && !lower.includes('briefing') && !lower.includes('operations')) {
      return { intent: 'patient_summary', patientId, department: matchedDepartment, days };
    }
    return { intent: 'daily_briefing', patientId, department: matchedDepartment, days };
  }

  if (patientId) {
    return { intent: 'patient_summary', patientId, department: matchedDepartment, days };
  }

  return { intent: 'general_help', patientId, department: matchedDepartment, days };
}

async function withTimeoutRace<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error('Assistant generation cancelled by user.');
      err.name = 'AbortError';
      reject(err);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    promise.then(
      (val) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

async function classifyIntentWithOptionalGemini(
  prompt: string,
  signal?: AbortSignal
): Promise<{
  intent: AgentIntent;
  patientId?: string;
  department?: string;
  days?: number;
}> {
  const deterministic = classifyIntentDeterministically(prompt);
  // Deterministic NLU already resolved a concrete operational intent in <1ms;
  // reserve Gemini intent parsing strictly for ambiguous free-form queries.
  if (deterministic.intent !== 'general_help') {
    return deterministic;
  }

  const apiKey = hasConfiguredGeminiKey();
  if (!apiKey) {
    return deterministic;
  }

  const timeoutController = new AbortController();
  const forwardAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  // Use Gemini solely for natural-language intent & parameter extraction; never for data generation.
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const response = await withTimeoutRace(
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Extract the clinic operations intent and optional parameters from this user request: "${prompt}"`,
        config: {
          abortSignal: timeoutController.signal,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You classify clinic administration prompts into one allowed intent without inventing any medical or patient data.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              intent: {
                type: Type.STRING,
                description:
                  'One of: daily_briefing, unconfirmed_appointments, missed_appointments, prepare_followup_list, followup_queue, find_available_slot, reschedule_patient, patient_summary, non_clinical_refusal, general_help',
              },
              patientId: { type: Type.STRING, nullable: true },
              department: { type: Type.STRING, nullable: true },
              days: { type: Type.INTEGER, nullable: true },
            },
            required: ['intent'],
          },
        },
      }),
      4500,
      signal
    );
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
      'followup_queue',
      'find_available_slot',
      'reschedule_patient',
      'patient_summary',
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
  } catch (err) {
    timeoutController.abort();
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    // Gracefully fall back to deterministic NLU routing if Gemini is unavailable or slow.
  } finally {
    signal?.removeEventListener('abort', forwardAbort);
  }
  return deterministic;
}

async function streamGroundedGeminiSummary(
  prompt: string,
  response: AssistantResponse,
  options?: HandlePromptOptions
): Promise<string | null> {
  const apiKey = hasConfiguredGeminiKey();
  if (!apiKey || !options?.onEvent) return null;

  const timeoutController = new AbortController();
  const forwardAbort = () => timeoutController.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timeoutTimer = setTimeout(() => timeoutController.abort(), 6000);

  try {
    throwIfAborted(options.signal);
    options.onEvent({
      type: 'status',
      phase: 'synthesizing',
      message: 'Composing administrative response from verified records...',
    });

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const groundedContext = JSON.stringify({
      headline: response.headline,
      summary: response.summary,
      sections: response.sections,
      metrics: response.structuredData?.metrics,
      itemCount: response.structuredData?.items?.length ?? 0,
      hasPendingConfirmation: Boolean(response.pendingConfirmation),
    });

    const stream = await withTimeoutRace(
      ai.models.generateContentStream({
        model: 'gemini-4-hydrogen',
        contents: `User question: "${prompt}"\nVerified CareDesk clinic data: ${groundedContext}\nWrite a crisp, concise 2-3 sentence operational summary in plain Markdown referencing ONLY facts from the verified clinic data above. Never invent IDs, names, or clinical advice.`,
        config: {
          abortSignal: timeoutController.signal,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
      4500,
      options.signal
    );

    let accumulated = '';
    for await (const chunk of stream) {
      throwIfAborted(options.signal);
      if (timeoutController.signal.aborted) break;
      const delta = chunk.text ?? '';
      if (delta) {
        accumulated += delta;
        options.onEvent({ type: 'delta', text: delta });
      }
    }
    return accumulated.trim() || null;
  } catch (err) {
    timeoutController.abort();
    if (err instanceof Error && err.name === 'AbortError' && options.signal?.aborted) {
      throw err;
    }
    return null;
  } finally {
    clearTimeout(timeoutTimer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

export class CareDeskAgent {
  private adapter: CareDeskToolAdapter;

  constructor(adapter: CareDeskToolAdapter) {
    this.adapter = adapter;
  }

  private async runTrackedTool<T>(
    toolName: string,
    endpoint: string,
    description: string,
    plannedTools: AssistantPlannedTool[],
    fn: () => Promise<T>,
    summarize: (result: T) => string,
    options?: HandlePromptOptions
  ): Promise<T> {
    throwIfAborted(options?.signal);
    const toolCallId = crypto.randomUUID();
    options?.onEvent?.({
      type: 'tool_start',
      toolCallId,
      toolName,
      endpoint,
      description,
    });

    const startedAt = performance.now();
    try {
      const result = await fn();
      throwIfAborted(options?.signal);
      const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
      const resultSummary = summarize(result);

      plannedTools.push({
        toolName,
        endpoint,
        status: 'executed-via-local-rest',
        description,
        durationMs,
        resultSummary,
      });

      options?.onEvent?.({
        type: 'tool_done',
        toolCallId,
        toolName,
        endpoint,
        status: 'executed-via-local-rest',
        durationMs,
        resultSummary,
      });

      return result;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
      const errorMessage = err instanceof Error ? err.message : 'Tool execution failed.';
      plannedTools.push({
        toolName,
        endpoint,
        status: 'failed',
        description,
        durationMs,
        errorMessage,
      });
      options?.onEvent?.({
        type: 'tool_done',
        toolCallId,
        toolName,
        endpoint,
        status: 'failed',
        durationMs,
        resultSummary: errorMessage,
        errorMessage,
      });
      throw err;
    }
  }

  async handlePrompt(
    prompt: string,
    options?: HandlePromptOptions
  ): Promise<AssistantResponse> {
    throwIfAborted(options?.signal);
    const replyId = crypto.randomUUID();

    options?.onEvent?.({
      type: 'status',
      phase: 'analyzing',
      message: 'Interpreting administrative request...',
    });

    const { intent, patientId, department, days } = await classifyIntentWithOptionalGemini(
      prompt,
      options?.signal
    );
    throwIfAborted(options?.signal);

    if (intent === 'non_clinical_refusal') {
      const refusal: AssistantResponse = {
        replyId,
        intent,
        headline: 'Administrative Scope Only',
        summary:
          'CareDesk Assistant is restricted to clinic administration, scheduling, follow-up coordination, and operational reporting. It cannot evaluate symptoms, recommend treatments, or provide medical diagnoses.',
        markdown:
          'CareDesk Assistant handles **clinic administration, appointment scheduling, follow-up outreach, and operational reporting**.\n\nFor clinical evaluation, symptom assessment, or treatment decisions, please consult an authorized clinician directly.',
        followUpSuggestions: [
          "Give me today's clinic briefing.",
          'Show pending appointments.',
          'Find the next available appointment slot.',
        ],
        engine: 'local-nlu-rest',
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools: [],
        structuredData: { type: 'non_clinical_notice' },
      };
      options?.onEvent?.({ type: 'complete', response: refusal });
      return refusal;
    }

    options?.onEvent?.({
      type: 'status',
      phase: 'querying',
      message: 'Querying live CareDesk clinic records...',
    });

    let response: AssistantResponse;

    if (intent === 'daily_briefing') {
      const plannedTools: AssistantPlannedTool[] = [];
      const [daily, overview] = await Promise.all([
        this.runTrackedTool(
          'get_daily_operational_report',
          'GET /api/reports/daily',
          'Retrieving today’s appointment counts and status breakdown',
          plannedTools,
          () => this.adapter.getDailyReport(),
          (r) => `${r.totalAppointments} visits (${r.confirmedAppointments} confirmed, ${r.unconfirmedAppointments} unconfirmed)`,
          options
        ),
        this.runTrackedTool(
          'get_overview_report',
          'GET /api/reports/overview',
          'Retrieving 7-day missed visits and follow-up queue counts',
          plannedTools,
          () => this.adapter.getOverviewReport(),
          (r) => `${r.pendingFollowUpsCount} open follow-ups, ${r.missedLastSevenDaysCount} missed (7d)`,
          options
        ),
      ]);

      const confirmationRate =
        daily.totalAppointments > 0
          ? Math.round(
              ((daily.confirmedAppointments + daily.completedAppointments) /
                daily.totalAppointments) *
                100
            )
          : 0;

      const sections: AssistantResponseSection[] = [
        {
          id: 'overview',
          title: '1. Overview',
          body: `Clinic operations for ${daily.date} currently track ${daily.totalAppointments} scheduled visit${daily.totalAppointments === 1 ? '' : 's'} with a ${confirmationRate}% confirmed/completed rate across ${overview.activePatients} active synthetic patient profiles.`,
        },
        {
          id: 'appointment-summary',
          title: '2. Appointment Summary',
          bullets: [
            `Confirmed: ${daily.confirmedAppointments} · Completed: ${daily.completedAppointments}`,
            `Awaiting confirmation (Scheduled): ${daily.unconfirmedAppointments}`,
            `Missed today: ${daily.missedAppointments} · Cancelled: ${daily.cancelledAppointments}`,
          ],
        },
        {
          id: 'outstanding-tasks',
          title: '3. Outstanding Tasks',
          bullets: [
            `${overview.pendingFollowUpsCount} pending administrative follow-up task${overview.pendingFollowUpsCount === 1 ? '' : 's'} (${overview.highPriorityFollowUpsCount} high priority).`,
            `${overview.overdueFollowUpsCount} overdue follow-up${overview.overdueFollowUpsCount === 1 ? '' : 's'} requiring outreach.`,
          ],
        },
        {
          id: 'alerts',
          title: '4. Important Operational Alerts',
          bullets: [
            daily.unconfirmedAppointments > 0
              ? `${daily.unconfirmedAppointments} upcoming appointment${daily.unconfirmedAppointments === 1 ? '' : 's'} remain unconfirmed for ${daily.date}.`
              : `No unconfirmed appointments remaining for ${daily.date}.`,
            overview.missedLastSevenDaysCount > 0
              ? `${overview.missedLastSevenDaysCount} missed visit${overview.missedLastSevenDaysCount === 1 ? '' : 's'} recorded in the last 7 days.`
              : 'Zero missed visits recorded in the last 7 days.',
          ],
        },
        {
          id: 'next-actions',
          title: '5. Recommended Administrative Next Actions',
          bullets: [
            daily.unconfirmedAppointments > 0
              ? 'Review and send confirmation reminders for today’s Scheduled visits.'
              : 'Monitor afternoon check-ins for scheduled slots.',
            overview.missedLastSevenDaysCount > 0
              ? 'Generate a follow-up outreach plan for recent missed visits and rebook priority patients.'
              : 'Keep pending outreach queue up to date.',
          ],
        },
      ];

      const followUpSuggestions: string[] = [];
      if (daily.unconfirmedAppointments > 0) {
        followUpSuggestions.push('Which appointments are still unconfirmed?');
      }
      if (overview.missedLastSevenDaysCount > 0) {
        followUpSuggestions.push('Prepare an administrative follow-up list.');
      }
      if (overview.pendingFollowUpsCount > 0) {
        followUpSuggestions.push('Identify overdue follow-ups.');
      }
      followUpSuggestions.push('Find the next available appointment slot.');

      response = {
        replyId,
        intent,
        headline: `Clinic Operations Briefing for ${daily.date}`,
        summary: `Today has ${daily.totalAppointments} total appointments: ${daily.confirmedAppointments} confirmed, ${daily.unconfirmedAppointments} unconfirmed, ${daily.completedAppointments} completed, and ${daily.missedAppointments} missed. There are ${overview.pendingFollowUpsCount} open administrative follow-ups (${overview.highPriorityFollowUpsCount} high priority).`,
        sections,
        followUpSuggestions: followUpSuggestions.slice(0, 3),
        engine: 'local-nlu-rest',
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
    } else if (intent === 'unconfirmed_appointments') {
      const plannedTools: AssistantPlannedTool[] = [];
      const unconfirmed = await this.runTrackedTool(
        'get_unconfirmed_appointments',
        'GET /api/appointments/unconfirmed',
        'Retrieving upcoming appointments awaiting patient confirmation',
        plannedTools,
        () => this.adapter.getUnconfirmedAppointments(),
        (list) => `${list.length} scheduled appointment(s) awaiting confirmation`,
        options
      );

      response = {
        replyId,
        intent,
        headline: `${unconfirmed.length} Unconfirmed Upcoming Appointment${unconfirmed.length === 1 ? '' : 's'}`,
        summary:
          unconfirmed.length === 0
            ? 'All upcoming appointments are currently confirmed.'
            : `Found ${unconfirmed.length} appointment${unconfirmed.length === 1 ? '' : 's'} in Scheduled status awaiting patient confirmation.`,
        followUpSuggestions:
          unconfirmed.length > 0
            ? [
                "Give me today's clinic briefing.",
                'Find the next available appointment slot.',
                `Reschedule patient ${unconfirmed[0].patientId}.`,
              ]
            : ["Give me today's clinic briefing.", 'Identify overdue follow-ups.'],
        engine: 'local-nlu-rest',
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools,
        structuredData: {
          type: 'unconfirmed_appointments',
          items: unconfirmed,
        },
      };
    } else if (intent === 'missed_appointments') {
      const lookbackDays = days ?? 7;
      const plannedTools: AssistantPlannedTool[] = [];
      const missed = await this.runTrackedTool(
        'get_missed_appointments',
        `GET /api/appointments/missed?days=${lookbackDays}`,
        `Retrieving missed appointments across the past ${lookbackDays} days`,
        plannedTools,
        () => this.adapter.getMissedAppointments(lookbackDays),
        (list) => `${list.length} missed visit(s) across ${new Set(list.map((m) => m.patientId)).size} patients`,
        options
      );

      const firstPatientId = missed[0]?.patientId ?? 'P-1042';
      response = {
        replyId,
        intent,
        headline: `${missed.length} Missed Appointment${missed.length === 1 ? '' : 's'} in the Last ${lookbackDays} Days`,
        summary:
          missed.length === 0
            ? `No missed appointments were recorded in the past ${lookbackDays} days.`
            : `Identified ${missed.length} missed appointment${missed.length === 1 ? '' : 's'} across ${new Set(missed.map((m) => m.patientId)).size} patients over the last ${lookbackDays} days.`,
        followUpSuggestions:
          missed.length > 0
            ? [
                'Prepare an administrative follow-up list.',
                `Reschedule patient ${firstPatientId}.`,
                'Identify overdue follow-ups.',
              ]
            : ["Give me today's clinic briefing.", 'Show pending appointments.'],
        engine: 'local-nlu-rest',
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools,
        structuredData: {
          type: 'missed_appointments',
          items: missed,
        },
      };
    } else if (intent === 'followup_queue') {
      const plannedTools: AssistantPlannedTool[] = [];
      const [pending, overview] = await Promise.all([
        this.runTrackedTool(
          'get_pending_followups',
          'GET /api/followups/pending',
          'Retrieving open administrative follow-up tasks',
          plannedTools,
          () => this.adapter.getPendingFollowups(),
          (list) => `${list.length} open task(s) in queue`,
          options
        ),
        this.runTrackedTool(
          'get_overview_report',
          'GET /api/reports/overview',
          'Checking clinic overdue follow-up thresholds',
          plannedTools,
          () => this.adapter.getOverviewReport(),
          (r) => `${r.overdueFollowUpsCount} overdue, ${r.highPriorityFollowUpsCount} high priority`,
          options
        ),
      ]);

      const today = getClinicTodayDate();
      const overdueCount = pending.filter((t) => t.dueDate < today).length;
      const highPriorityCount = pending.filter((t) => t.priority === 'High').length;

      response = {
        replyId,
        intent,
        headline:
          overdueCount > 0
            ? `${overdueCount} Overdue & ${pending.length} Open Follow-Up Tasks`
            : `${pending.length} Open Follow-Up Tasks (0 Overdue)`,
        summary:
          pending.length === 0
            ? 'There are currently no pending or in-progress administrative follow-up tasks.'
            : overdueCount > 0
              ? `Found ${overdueCount} overdue task${overdueCount === 1 ? '' : 's'} and ${highPriorityCount} high-priority item${highPriorityCount === 1 ? '' : 's'} across ${pending.length} open follow-ups.`
              : `All ${pending.length} open follow-up tasks are within their target due dates (${highPriorityCount} high priority).`,
        followUpSuggestions: [
          'Prepare an administrative follow-up list.',
          'Identify patients who missed appointments during the last seven days.',
          "Give me today's clinic briefing.",
        ],
        engine: 'local-nlu-rest',
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools,
        structuredData: {
          type: 'followup_queue',
          metrics: {
            totalPending: pending.length,
            overdue: overdueCount,
            highPriority: highPriorityCount,
            missedLast7Days: overview.missedLastSevenDaysCount,
          },
          items: pending,
        },
      };
    } else if (intent === 'prepare_followup_list') {
      const lookbackDays = days ?? 7;
      const plannedTools: AssistantPlannedTool[] = [];
      const [missed, pending] = await Promise.all([
        this.runTrackedTool(
          'get_missed_appointments',
          `GET /api/appointments/missed?days=${lookbackDays}`,
          `Loading missed appointments from the last ${lookbackDays} days`,
          plannedTools,
          () => this.adapter.getMissedAppointments(lookbackDays),
          (list) => `${list.length} missed visit(s) evaluated`,
          options
        ),
        this.runTrackedTool(
          'get_pending_followups',
          'GET /api/followups/pending',
          'Checking active follow-up queue to avoid duplicate outreach tasks',
          plannedTools,
          () => this.adapter.getPendingFollowups(),
          (list) => `${list.length} active follow-up task(s) checked`,
          options
        ),
      ]);

      const openAppointmentIds = new Set(
        pending.map((f) => f.appointmentId).filter((id): id is string => Boolean(id))
      );

      const needingTask = missed.filter((apt) => !openAppointmentIds.has(apt.id));
      const alreadyTracked = missed.filter((apt) => openAppointmentIds.has(apt.id));

      let pendingConfirmation: AssistantResponse['pendingConfirmation'];
      if (needingTask.length > 0) {
        plannedTools.push({
          toolName: 'create_followup_task',
          endpoint: 'POST /api/followups',
          status: 'awaiting-confirmation',
          description: `Prepared ${needingTask.length} new follow-up task(s) awaiting administrator confirmation.`,
          resultSummary: `${needingTask.length} proposed High-priority outreach task(s)`,
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

      response = {
        replyId,
        intent,
        headline: 'Missed Appointment Follow-Up Outreach Plan',
        summary:
          needingTask.length > 0
            ? `Prepared follow-up coverage for ${missed.length} missed appointments: ${alreadyTracked.length} already have active tasks and ${needingTask.length} require new tasks.`
            : `All ${missed.length} missed appointments from the past ${lookbackDays} days already have active follow-up tasks on file.`,
        followUpSuggestions: [
          'Identify overdue follow-ups.',
          `Reschedule patient ${missed[0]?.patientId ?? 'P-1042'}.`,
          "Give me today's clinic briefing.",
        ],
        engine: 'local-nlu-rest',
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
    } else if (intent === 'find_available_slot') {
      const plannedTools: AssistantPlannedTool[] = [];
      const slots = await this.runTrackedTool(
        'check_appointment_availability',
        'GET /api/appointments/availability',
        `Checking conflict-free 30-minute slots${department ? ` in ${department}` : ''}`,
        plannedTools,
        () =>
          this.adapter.checkAvailability({
            startDate: getClinicTodayDate(),
            department,
            patientId,
            limit: 8,
          }),
        (list) =>
          list.length > 0
            ? `${list.length} open slot(s); earliest ${list[0].date} ${list[0].time}`
            : '0 open slots found in current search window',
        options
      );

      response = {
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
        followUpSuggestions: [
          'Reschedule patient P-1042.',
          'Show pending appointments.',
          "Give me today's clinic briefing.",
        ],
        engine: 'local-nlu-rest',
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools,
        structuredData: {
          type: 'available_slots',
          items: slots,
        },
      };
    } else if (intent === 'patient_summary') {
      const targetPatientId = patientId ?? 'P-1042';
      const plannedTools: AssistantPlannedTool[] = [];
      const history = await this.runTrackedTool(
        'get_patient_by_id',
        `GET /api/patients/${targetPatientId}`,
        `Retrieving synthetic profile, visits, and follow-ups for ${targetPatientId}`,
        plannedTools,
        () => this.adapter.getPatientWithHistory(targetPatientId),
        (res) => `${res.patient.fullName} · ${res.appointments.length} visit(s), ${res.followups.length} follow-up(s)`,
        options
      );

      const missedCount = history.appointments.filter((a) => a.status === 'Missed').length;
      const openFollowUps = history.followups.filter(
        (f) => f.status === 'Pending' || f.status === 'In Progress'
      ).length;

      response = {
        replyId,
        intent,
        headline: `Patient Administrative Summary: ${history.patient.fullName} (${history.patient.id})`,
        summary: `${history.patient.fullName} is ${history.patient.administrativeStatus} (registered ${history.patient.registrationDate}) with ${history.appointments.length} recorded appointments (${missedCount} missed) and ${openFollowUps} open follow-up task${openFollowUps === 1 ? '' : 's'}.`,
        followUpSuggestions: [
          `Reschedule patient ${history.patient.id}.`,
          'Identify overdue follow-ups.',
          'Find the next available appointment slot.',
        ],
        engine: 'local-nlu-rest',
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools,
        structuredData: {
          type: 'patient_summary',
          patient: history.patient,
          metrics: {
            totalAppointments: history.appointments.length,
            missedVisits: missedCount,
            openFollowUps,
          },
          items: history.appointments,
        },
      };
    } else if (intent === 'reschedule_patient') {
      const targetPatientId = patientId ?? 'P-1042';
      const plannedTools: AssistantPlannedTool[] = [];
      const history = await this.runTrackedTool(
        'get_patient_by_id',
        `GET /api/patients/${targetPatientId}`,
        `Retrieving patient record and appointment history for ${targetPatientId}`,
        plannedTools,
        () => this.adapter.getPatientWithHistory(targetPatientId),
        (res) => `${res.patient.fullName} · ${res.appointments.length} appointment(s) loaded`,
        options
      );

      const candidateAppointment =
        history.appointments.find((a) => a.status === 'Missed') ??
        history.appointments.find((a) => a.status === 'Scheduled') ??
        history.appointments[0];

      if (!candidateAppointment) {
        response = {
          replyId,
          intent,
          headline: `No Appointments Found for ${history.patient.fullName} (${targetPatientId})`,
          summary: `${history.patient.fullName} does not have an existing appointment record to reschedule.`,
          followUpSuggestions: [
            'Find the next available appointment slot.',
            "Give me today's clinic briefing.",
          ],
          engine: 'local-nlu-rest',
          integrationNotice: DEVELOPMENT_NOTICE,
          mode: 'development-local-rest-preview',
          plannedTools,
        };
      } else {
        const slots = await this.runTrackedTool(
          'check_appointment_availability',
          'GET /api/appointments/availability',
          `Checking conflict-free slots for ${candidateAppointment.clinician}`,
          plannedTools,
          async () => {
            const primary = await this.adapter.checkAvailability({
              startDate: addDaysToDateString(getClinicTodayDate(), 1),
              clinician: candidateAppointment.clinician,
              department: candidateAppointment.department,
              patientId: targetPatientId,
              limit: 4,
            });
            if (primary.length > 0) return primary;
            return this.adapter.checkAvailability({
              startDate: addDaysToDateString(getClinicTodayDate(), 1),
              patientId: targetPatientId,
              limit: 4,
            });
          },
          (list) =>
            list.length > 0
              ? `${list.length} candidate slot(s) starting ${list[0].date} ${list[0].time}`
              : '0 slots available in next 5 days',
          options
        );

        if (slots.length === 0) {
          response = {
            replyId,
            intent,
            headline: `No Open Slots Available for ${targetPatientId}`,
            summary: 'Could not find a conflict-free slot within the next 5 days.',
            followUpSuggestions: [
              'Find the next available appointment slot.',
              'Identify overdue follow-ups.',
            ],
            engine: 'local-nlu-rest',
            integrationNotice: DEVELOPMENT_NOTICE,
            mode: 'development-local-rest-preview',
            plannedTools,
          };
        } else {
          const proposedSlot = slots[0];
          plannedTools.push({
            toolName: 'update_appointment',
            endpoint: `PATCH /api/appointments/${candidateAppointment.id}`,
            status: 'awaiting-confirmation',
            description: 'Waiting for administrator approval before modifying the schedule.',
            resultSummary: `Proposed ${proposedSlot.date} ${proposedSlot.time}`,
          });

          response = {
            replyId,
            intent,
            headline: `Reschedule Proposal for ${history.patient.fullName} (${targetPatientId})`,
            summary: `Prepared a conflict-free slot to move ${candidateAppointment.id} (previously ${candidateAppointment.status} on ${candidateAppointment.appointmentDate} at ${candidateAppointment.appointmentTime}) to ${proposedSlot.date} at ${proposedSlot.time} with ${proposedSlot.clinician}. Administrator confirmation is required before modifying the schedule.`,
            followUpSuggestions: [
              `Show patient ${targetPatientId}.`,
              'Show pending appointments.',
            ],
            engine: 'local-nlu-rest',
            integrationNotice: DEVELOPMENT_NOTICE,
            mode: 'development-local-rest-preview',
            plannedTools,
            structuredData: {
              type: 'reschedule_proposal',
              items: slots,
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
      }
    } else {
      response = {
        replyId,
        intent: 'general_help',
        headline: 'CareDesk Administrative Copilot',
        summary:
          'Ask about today’s operational briefing, pending/unconfirmed appointments, overdue follow-ups, missed visits over the last 7 days, next available slots, or looking up/rescheduling a synthetic patient (e.g. P-1042).',
        followUpSuggestions: [
          "Give me today's clinic briefing.",
          'Show pending appointments.',
          'Identify overdue follow-ups.',
        ],
        engine: 'local-nlu-rest',
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools: [],
      };
    }

    const geminiMarkdown = await streamGroundedGeminiSummary(prompt, response, options);
    if (geminiMarkdown) {
      response.markdown = geminiMarkdown;
      response.engine = 'gemini-streaming-rest';
    }

    options?.onEvent?.({ type: 'complete', response });
    return response;
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
      const t0 = performance.now();
      const updated = await this.adapter.rescheduleAppointment(payload.appointmentId, {
        appointmentDate: payload.appointmentDate,
        appointmentTime: payload.appointmentTime,
        notes: `Rescheduled via CareDesk Assistant (Local REST Preview) after administrator confirmation.`,
      });
      const updateDuration = Math.max(1, Math.round(performance.now() - t0));

      const t1 = performance.now();
      const verified = await this.adapter.getAppointmentById(updated.id);
      const verifyDuration = Math.max(1, Math.round(performance.now() - t1));

      return {
        replyId,
        intent: 'reschedule_patient',
        headline: `Rescheduled ${verified.id} to ${verified.appointmentDate} at ${verified.appointmentTime}`,
        summary: `Administrator confirmed. Appointment ${verified.id} for ${verified.patientName ?? verified.patientId} is persisted and verified as Scheduled on ${verified.appointmentDate} at ${verified.appointmentTime} with ${verified.clinician}.`,
        followUpSuggestions: [
          "Give me today's clinic briefing.",
          'Show pending appointments.',
          `Show patient ${verified.patientId}.`,
        ],
        engine: 'local-nlu-rest',
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools: [
          {
            toolName: 'update_appointment',
            endpoint: `PATCH /api/appointments/${verified.id}`,
            status: 'executed-via-local-rest',
            description: 'Updated appointment slot and recorded audit entry.',
            durationMs: updateDuration,
            resultSummary: `Persisted ${verified.appointmentDate} ${verified.appointmentTime}`,
          },
          {
            toolName: 'get_appointment_by_id',
            endpoint: `GET /api/appointments/${verified.id}`,
            status: 'executed-via-local-rest',
            description: 'Verified persisted appointment record in SQLite.',
            durationMs: verifyDuration,
            resultSummary: `Verified status=${verified.status}`,
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

      const t0 = performance.now();
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
      const durationMs = Math.max(1, Math.round(performance.now() - t0));

      return {
        replyId,
        intent: 'prepare_followup_list',
        headline: `Created ${created.length} Administrative Follow-Up Task${created.length > 1 ? 's' : ''}`,
        summary: `Administrator confirmed. Added ${created.length} High-priority follow-up task(s) to the pending outreach queue.`,
        followUpSuggestions: [
          'Identify overdue follow-ups.',
          "Give me today's clinic briefing.",
        ],
        engine: 'local-nlu-rest',
        integrationNotice: DEVELOPMENT_NOTICE,
        mode: 'development-local-rest-preview',
        plannedTools: [
          {
            toolName: 'create_followup_task',
            endpoint: 'POST /api/followups',
            status: 'executed-via-local-rest',
            description: `Created ${created.length} follow-up record(s) in clinic database.`,
            durationMs,
            resultSummary: `Created ${created.length} task(s)`,
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
