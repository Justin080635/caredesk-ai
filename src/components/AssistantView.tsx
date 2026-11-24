import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  History,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  confirmAssistantAction,
  createAiConversation,
  deleteAiConversation,
  fetchAiConversationDetail,
  fetchAiConversations,
  fetchDailyReport,
  fetchDoctorDashboard,
  fetchOverviewReport,
  fetchPatientPortalHome,
  streamAssistantQuery,
} from '../client/api';
import type {
  AccountRole,
  AiConversationSummary,
  Appointment,
  AssistantResponse,
  AvailableSlot,
  ConsultationRecord,
  DailyReport,
  DoctorAvailabilitySummary,
  DoctorDashboardData,
  FollowUpTask,
  OverviewReport,
  PatientHomeData,
} from '../shared/types';
import type { DashboardFilteredTarget } from './DashboardView';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AppointmentStatusText, DoctorDutyStatusText, PriorityText } from './StatusText';

interface LiveToolStep {
  toolCallId: string;
  toolName: string;
  endpoint: string;
  description: string;
  status: 'running' | 'executed-via-local-rest' | 'awaiting-confirmation' | 'failed';
  durationMs?: number;
  resultSummary?: string;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  timestamp: string;
  response?: AssistantResponse;
  confirmedActionId?: string;
  failedPrompt?: string;
  cancelled?: boolean;
  selectedSlotOverride?: AvailableSlot;
}

const PROMPT_GROUPS_BY_ROLE: Record<
  'admin' | 'Doctor' | 'Patient',
  Array<{ label: string; prompts: string[] }>
> = {
  admin: [
    {
      label: 'Briefings & Queue Audits',
      prompts: [
        "Give me today's clinic briefing.",
        'Show pending appointments.',
        'Identify overdue follow-ups.',
        'Identify patients who missed appointments during the last seven days.',
      ],
    },
    {
      label: 'Doctors, Slots & Scheduling',
      prompts: [
        'Which doctors are available today?',
        'Prepare an administrative follow-up list.',
        'Find available appointment slots.',
        'Reschedule patient P-1042.',
      ],
    },
  ],
  Doctor: [
    {
      label: 'My Schedule & Visits',
      prompts: [
        'Show my appointments for today.',
        'What is my next appointment?',
        'Summarize my schedule and leave blocks.',
        'Which follow-ups require my attention?',
      ],
    },
    {
      label: 'Patient Lookup & Clinical Prep',
      prompts: [
        'Show patient P-1042.',
        'Summarize recent consultations I authored.',
        'Check open follow-ups assigned to me.',
      ],
    },
  ],
  Patient: [
    {
      label: 'My Appointments & Slots',
      prompts: [
        'When is my next appointment?',
        'Show all my upcoming appointments.',
        'Find open appointment slots in Cardiology.',
        'Find open appointment slots this week.',
      ],
    },
    {
      label: 'My Health & Follow-ups',
      prompts: [
        'Summarize my recent consultations and prescriptions.',
        'Show my lab and test results.',
        'What follow-up instructions do I have?',
      ],
    },
  ],
};

function getTimeGreeting(): string {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  return 'Good evening';
}

interface AssistantViewProps {
  role?: AccountRole;
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  onNavigateToFiltered?: (target: DashboardFilteredTarget) => void;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
}

export function AssistantView({
  role = 'Clinic Administrator',
  onDataMutated,
  onErrorNotice,
  onSuccessNotice,
  onNavigateToFiltered,
  initialPrompt,
  onInitialPromptConsumed,
}: AssistantViewProps) {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamPhase, setStreamPhase] = useState<string>('Preparing workspace query...');
  const [liveTools, setLiveTools] = useState<LiveToolStep[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmErrorByTurn, setConfirmErrorByTurn] = useState<Record<string, string>>({});
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [showSavedDrawer, setShowSavedDrawer] = useState(false);
  const [clinicBrief, setClinicBrief] = useState<{
    daily: DailyReport | null;
    overview: OverviewReport | null;
    doctorDash: DoctorDashboardData | null;
    patientHome: PatientHomeData | null;
  }>({ daily: null, overview: null, doctorDash: null, patientHome: null });

  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const consumedPromptRef = useRef<string | null>(null);

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      const list = await fetchAiConversations();
      setConversations(list);
    } catch {
      // Non-blocking
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    let active = true;
    if (role === 'Patient') {
      fetchPatientPortalHome()
        .then((patientHome) => {
          if (active) setClinicBrief({ daily: null, overview: null, doctorDash: null, patientHome });
        })
        .catch(() => {});
    } else if (role === 'Doctor') {
      fetchDoctorDashboard()
        .then((doctorDash) => {
          if (active) setClinicBrief({ daily: null, overview: null, doctorDash, patientHome: null });
        })
        .catch(() => {});
    } else {
      Promise.all([fetchDailyReport(), fetchOverviewReport()])
        .then(([daily, overview]) => {
          if (active) setClinicBrief({ daily, overview, doctorDash: null, patientHome: null });
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [role]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, Math.max(42, el.scrollHeight))}px`;
  }, [input]);

  const prevTurnCountRef = useRef(0);

  const scrollToBottomIfNear = useCallback((force = false) => {
    const container = feedContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (force || distanceFromBottom < 220) {
      feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, []);

  useEffect(() => {
    const turnAdded = turns.length !== prevTurnCountRef.current;
    prevTurnCountRef.current = turns.length;
    scrollToBottomIfNear(loading || turnAdded);
  }, [turns.length, liveTools.length, streamingText, loading, scrollToBottomIfNear]);

  const formatTimeNow = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const submitPrompt = useCallback(
    async (promptText: string) => {
      const trimmed = promptText.trim();
      if (!trimmed || loading) return;

      const userTurn: ChatTurn = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed,
        timestamp: formatTimeNow(),
      };

      setTurns((prev) => [...prev, userTurn]);
      setInput('');
      setLoading(true);
      setStreamPhase(
        role === 'Patient'
          ? 'Checking your verified clinic records...'
          : role === 'Doctor'
            ? 'Checking your clinical schedule & caseload...'
            : 'Interpreting administrative request...'
      );
      setLiveTools([]);
      setStreamingText('');

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await streamAssistantQuery(trimmed, {
          conversationId: activeConversationId ?? undefined,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'status') {
              setStreamPhase(event.message);
            } else if (event.type === 'tool_start') {
              setLiveTools((prev) => [
                ...prev,
                {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  endpoint: event.endpoint,
                  description: event.description,
                  status: 'running',
                },
              ]);
            } else if (event.type === 'tool_done') {
              setLiveTools((prev) =>
                prev.map((step) =>
                  step.toolCallId === event.toolCallId
                    ? {
                        ...step,
                        status: event.status,
                        durationMs: event.durationMs,
                        resultSummary: event.resultSummary,
                      }
                    : step
                )
              );
            } else if (event.type === 'delta') {
              setStreamingText((prev) => prev + event.text);
            }
          },
        });

        if (response.conversationId) {
          setActiveConversationId(response.conversationId);
        }

        setTurns((prev) => [
          ...prev,
          {
            id: response.replyId,
            role: 'assistant',
            text: response.summary,
            timestamp: formatTimeNow(),
            response,
          },
        ]);
        loadConversations();
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (isAbort) {
          setTurns((prev) => [
            ...prev,
            {
              id: `cancelled-${Date.now()}`,
              role: 'error',
              text: 'Response generation was stopped before completion.',
              timestamp: formatTimeNow(),
              failedPrompt: trimmed,
              cancelled: true,
            },
          ]);
        } else {
          const message =
            err instanceof Error ? err.message : 'Unable to reach CareDesk Assistant.';
          setTurns((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: 'error',
              text: message,
              timestamp: formatTimeNow(),
              failedPrompt: trimmed,
            },
          ]);
          onErrorNotice(message);
        }
      } finally {
        abortControllerRef.current = null;
        setLoading(false);
        setLiveTools([]);
        setStreamingText('');
      }
    },
    [loading, onErrorNotice, role, activeConversationId, loadConversations]
  );

  const handleOpenSavedConversation = async (convId: string) => {
    if (loading) return;
    try {
      const detail = await fetchAiConversationDetail(convId);
      setActiveConversationId(detail.id);
      setDismissedIds(new Set());
      setConfirmErrorByTurn({});
      setShowSavedDrawer(false);
      setTurns(
        detail.messages.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.content,
          timestamp: m.createdAt.slice(11, 16),
          response: m.response ?? undefined,
        }))
      );
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load saved conversation.');
    }
  };

  const handleNewConversation = async () => {
    if (loading) return;
    setTurns([]);
    setDismissedIds(new Set());
    setConfirmErrorByTurn({});
    try {
      const created = await createAiConversation();
      setActiveConversationId(created.id);
      loadConversations();
    } catch {
      setActiveConversationId(null);
    }
  };

  const handleDeleteSavedConversation = async (convId: string) => {
    try {
      await deleteAiConversation(convId);
      if (activeConversationId === convId) {
        setActiveConversationId(null);
        setTurns([]);
      }
      loadConversations();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to delete conversation.');
    }
  };

  useEffect(() => {
    if (initialPrompt && initialPrompt !== consumedPromptRef.current) {
      consumedPromptRef.current = initialPrompt;
      onInitialPromptConsumed?.();
      submitPrompt(initialPrompt);
    }
  }, [initialPrompt, onInitialPromptConsumed, submitPrompt]);

  const handleConfirm = async (turn: ChatTurn) => {
    const pending = turn.response?.pendingConfirmation;
    if (!pending) return;

    setConfirmingId(pending.confirmationId);
    setConfirmErrorByTurn((prev) => {
      const next = { ...prev };
      delete next[turn.id];
      return next;
    });

    const payload =
      pending.actionType === 'reschedule_appointment' && turn.selectedSlotOverride
        ? {
            ...(pending.payload as Record<string, unknown>),
            appointmentDate: turn.selectedSlotOverride.date,
            appointmentTime: turn.selectedSlotOverride.time,
            clinician: turn.selectedSlotOverride.clinician,
            department: turn.selectedSlotOverride.department,
          }
        : pending.payload;

    try {
      const result = await confirmAssistantAction({
        actionType: pending.actionType,
        payload,
      });
      setTurns((prev) => [
        ...prev.map((t) =>
          t.id === turn.id ? { ...t, confirmedActionId: pending.confirmationId } : t
        ),
        {
          id: result.replyId,
          role: 'assistant',
          text: result.summary,
          timestamp: formatTimeNow(),
          response: result,
        },
      ]);
      onDataMutated();
      onSuccessNotice(result.headline || 'Assistant action applied to clinic records.');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to execute confirmed action.';
      setConfirmErrorByTurn((prev) => ({ ...prev, [turn.id]: msg }));
      onErrorNotice(msg);
    } finally {
      setConfirmingId(null);
    }
  };

  const handleDismiss = (confirmationId: string) => {
    setDismissedIds((prev) => new Set(prev).add(confirmationId));
  };

  const promptGroups =
    role === 'Doctor'
      ? PROMPT_GROUPS_BY_ROLE.Doctor
      : role === 'Patient'
        ? PROMPT_GROUPS_BY_ROLE.Patient
        : PROMPT_GROUPS_BY_ROLE.admin;

  const welcomeCards =
    role === 'Doctor'
      ? [
          {
            title: 'Show my appointments for today.',
            subtitle: clinicBrief.doctorDash
              ? `${clinicBrief.doctorDash.todayAppointments.length} assigned visits · ${clinicBrief.doctorDash.effectiveOperationalState}`
              : 'View your live patient queue and statuses',
          },
          {
            title: 'What is my next appointment?',
            subtitle: clinicBrief.doctorDash?.nextAppointment
              ? `${clinicBrief.doctorDash.nextAppointment.appointmentTime} · ${clinicBrief.doctorDash.nextAppointment.patientName}`
              : 'Inspect your next scheduled patient visit',
          },
          {
            title: 'Which follow-ups require my attention?',
            subtitle: clinicBrief.doctorDash
              ? `${clinicBrief.doctorDash.followupsRequiringAttention.length} open tasks assigned to you`
              : 'Audit clinical and administrative follow-ups',
          },
          {
            title: 'Summarize my schedule and leave blocks.',
            subtitle: 'Check weekly hours, break windows & unavailability',
          },
        ]
      : role === 'Patient'
        ? [
            {
              title: 'When is my next appointment?',
              subtitle: clinicBrief.patientHome?.nextAppointment
                ? `${clinicBrief.patientHome.nextAppointment.appointmentDate} · ${clinicBrief.patientHome.nextAppointment.clinician}`
                : 'Check your upcoming clinic visits',
            },
            {
              title: 'Find open appointment slots this week.',
              subtitle: 'Browse real-time available slots across doctors',
            },
            {
              title: 'Summarize my recent consultations and prescriptions.',
              subtitle: clinicBrief.patientHome
                ? `${clinicBrief.patientHome.recentConsultationsCount} published doctor record(s)`
                : 'View doctor-approved notes and prescriptions',
            },
            {
              title: 'What follow-up instructions do I have?',
              subtitle: clinicBrief.patientHome
                ? `${clinicBrief.patientHome.openFollowups.length} active follow-up item(s)`
                : 'Review care recommendations and next steps',
            },
          ]
        : [
            {
              title: "Give me today's clinic briefing.",
              subtitle: clinicBrief.daily
                ? `${clinicBrief.daily.totalAppointments} scheduled visits on ${clinicBrief.daily.date}`
                : 'Structured 5-part overview & operational alerts',
            },
            {
              title: 'Which doctors are available today?',
              subtitle: 'Check live duty states, capacity & open slots',
            },
            {
              title: 'Identify overdue follow-ups.',
              subtitle: clinicBrief.overview
                ? `${clinicBrief.overview.pendingFollowUpsCount} open · ${clinicBrief.overview.overdueFollowUpsCount} overdue`
                : 'Audit pending administrative follow-up queue',
            },
            {
              title: 'Reschedule patient P-1042.',
              subtitle: 'Propose conflict-free slot with human approval gate',
            },
          ];

  const lastTurnId = turns[turns.length - 1]?.id;

  // Derive the active pending approval turn (most recent assistant turn with unresolved confirmation)
  const pendingApprovalTurn = [...turns]
    .reverse()
    .find((t) => {
      const p = t.response?.pendingConfirmation;
      if (!p) return false;
      return (
        t.confirmedActionId !== p.confirmationId && !dismissedIds.has(p.confirmationId)
      );
    });

  // Derive latest assistant turn for the Right Rail Tool-Call Status panel
  const latestAssistantTurn = [...turns].reverse().find((t) => t.role === 'assistant');

  const renderApprovalCard = (turn: ChatTurn) => {
    const pending = turn.response?.pendingConfirmation;
    if (!pending || role === 'Patient') return null;
    const activeSlotOverride = turn.selectedSlotOverride;
    const confirmErr = confirmErrorByTurn[turn.id];
    const isWorking = confirmingId === pending.confirmationId;

    return (
      <div className="rounded-[24px] bg-white border-2 border-amber-300 shadow-sm p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
            <AlertCircle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="inline-flex px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] font-semibold uppercase tracking-wide">
              Human Approval Required
            </span>
            <h3 className="text-sm font-bold text-[#1C2B25] mt-1">{pending.title}</h3>
            <p className="text-xs text-[#6B7B73] mt-1 leading-relaxed">
              {activeSlotOverride && pending.actionType === 'reschedule_appointment'
                ? `Move appointment to ${activeSlotOverride.date} at ${activeSlotOverride.time} (${activeSlotOverride.clinician}) and set status to Scheduled.`
                : pending.summary}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs bg-[#FAFBF9] border border-[#DCE8E0] rounded-2xl p-3.5">
          {Object.entries(pending.details).map(([k, v]) => {
            const displayValue =
              k === 'Proposed Slot' && activeSlotOverride
                ? `${activeSlotOverride.date} ${activeSlotOverride.time}`
                : k === 'Clinician' && activeSlotOverride
                  ? activeSlotOverride.clinician
                  : String(v ?? '—');
            return (
              <div key={k} className="min-w-0">
                <dt className="text-[11px] text-[#6B7B73]">{k}</dt>
                <dd className="font-semibold font-mono text-[11.5px] text-[#1C2B25] mt-0.5 break-words">
                  {displayValue}
                </dd>
              </div>
            );
          })}
        </dl>

        {confirmErr && (
          <div
            role="alert"
            className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2"
          >
            {confirmErr}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={isWorking}
            onClick={() => handleConfirm(turn)}
            className="btn-press flex-1 px-4 py-2.5 text-xs font-semibold text-white bg-[#34C38F] hover:bg-[#24B07D] rounded-full transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {isWorking ? 'Applying...' : 'Approve'}
          </button>
          <button
            type="button"
            disabled={isWorking}
            onClick={() => handleDismiss(pending.confirmationId)}
            className="btn-press flex-1 px-4 py-2.5 text-xs font-semibold text-[#1C2B25] hover:bg-[#EEF3EF] bg-[#FAFBF9] border border-[#DCE8E0] rounded-full transition-colors whitespace-nowrap"
          >
            Reject
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
      {/* Center Workspace: Chat Workspace */}
      <section
        aria-label="CareDesk AI Conversational Workspace"
        className="xl:col-span-8 card-surface rounded-[24px] flex flex-col min-h-[680px]"
      >
        <div className="px-6 py-4 border-b border-[#EEF3EF] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#0F3D2E] text-[#34C38F] flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#1C2B25] truncate">
                {role === 'Patient'
                  ? 'CareDesk Patient Assistant'
                  : role === 'Doctor'
                    ? 'CareDesk Doctor Copilot'
                    : 'CareDesk Assistant'}
              </h2>
              <p className="text-xs text-[#6B7B73] truncate">
                {role} workspace · Live clinic SQLite queries
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSavedDrawer((v) => !v)}
              className="btn-press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#1C2B25] bg-[#FAFBF9] hover:bg-[#EEF3EF] border border-[#DCE8E0] rounded-full"
            >
              <History className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
              <span>History ({conversations.length})</span>
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleNewConversation}
              className="btn-press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#0F3D2E] bg-[#E3F7EF] hover:bg-[#D0EFE3] rounded-full disabled:opacity-50"
            >
              <MessageSquarePlus className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
              New Chat
            </button>
          </div>
        </div>

        {/* Collapsible Saved Conversations Bar */}
        {showSavedDrawer && (
          <div className="px-6 py-3.5 bg-[#FAFBF9] border-b border-[#EEF3EF] space-y-2 animate-view-enter">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7B73]">
              Saved Conversations
            </div>
            {loadingConversations ? (
              <p className="text-xs text-[#6B7B73]">Loading conversations...</p>
            ) : conversations.length === 0 ? (
              <p className="text-xs text-[#6B7B73]">
                Conversations are automatically saved to your workspace.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                {conversations.map((conv) => {
                  const isSelected = activeConversationId === conv.id;
                  return (
                    <div
                      key={conv.id}
                      className={`px-3 py-2 rounded-2xl border flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-[#E3F7EF]/60 border-[#34C38F]'
                          : 'bg-white border-[#DCE8E0] hover:bg-[#FAFBF9]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenSavedConversation(conv.id)}
                        className="text-left min-w-0 flex-1"
                      >
                        <div className="text-xs font-semibold text-[#1C2B25] truncate">
                          {conv.title}
                        </div>
                        <div className="text-[11px] font-mono text-[#6B7B73]">
                          {conv.messageCount} msg · {conv.updatedAt.slice(0, 10)}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedConversation(conv.id)}
                        aria-label={`Delete conversation ${conv.title}`}
                        className="p-1 text-[#6B7B73] hover:text-rose-600 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Chat Feed */}
        <div
          ref={feedContainerRef}
          className="flex-1 px-5 sm:px-7 pt-6 pb-6 overflow-y-auto max-h-[620px]"
        >
          <div className="max-w-3xl mx-auto space-y-6">
            {turns.length === 0 ? (
              <div className="py-4 sm:py-8 space-y-6 animate-view-enter">
                <div className="space-y-2 max-w-xl">
                  <div className="inline-flex px-3 py-1 rounded-full bg-[#E3F7EF] text-[#137A55] text-xs font-semibold">
                    CareDesk Operations Copilot
                  </div>
                  <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-[#1C2B25]">
                    {getTimeGreeting()}. How can I help manage clinic operations?
                  </h3>
                  <p className="text-sm text-[#6B7B73] leading-relaxed">
                    Query live patient rosters, doctor schedules, overdue follow-ups, or propose
                    conflict-free rescheduling with explicit approval.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {welcomeCards.map((card) => (
                    <button
                      key={card.title}
                      type="button"
                      disabled={loading}
                      onClick={() => submitPrompt(card.title)}
                      className="btn-press card-interactive text-left p-4 rounded-2xl border border-[#DCE8E0] bg-[#FAFBF9] hover:bg-[#E3F7EF]/50 space-y-1.5 group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[#1C2B25] group-hover:text-[#0F3D2E]">
                          {card.title}
                        </span>
                        <ArrowRight
                          className="w-3.5 h-3.5 text-[#137A55] shrink-0 transition-transform group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </div>
                      <p className="text-xs text-[#6B7B73]">{card.subtitle}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((turn) => {
                if (turn.role === 'user') {
                  return (
                    <div key={turn.id} className="flex justify-end animate-view-enter">
                      <div className="max-w-xl bg-[#0F3D2E] text-white px-4 py-3 rounded-[20px] rounded-br-sm text-sm space-y-1 shadow-xs">
                        <div className="whitespace-pre-wrap break-words leading-relaxed">
                          {turn.text}
                        </div>
                        <div className="text-[10px] font-mono text-emerald-200/75 text-right">
                          {turn.timestamp}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (turn.role === 'error') {
                  return (
                    <div
                      key={turn.id}
                      role="alert"
                      className="rounded-2xl border border-rose-200 bg-rose-50/75 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-view-enter"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle
                          className="w-4 h-4 text-rose-600 mt-0.5 shrink-0"
                          aria-hidden="true"
                        />
                        <div>
                          <div className="text-xs font-semibold text-rose-950">
                            {turn.cancelled ? 'Request Stopped' : 'Assistant Request Failed'}
                          </div>
                          <p className="text-xs text-rose-800 mt-0.5">{turn.text}</p>
                        </div>
                      </div>
                      {turn.failedPrompt && (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => submitPrompt(turn.failedPrompt!)}
                          className="btn-press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-rose-900 bg-white hover:bg-rose-100 border border-rose-200 rounded-full shrink-0"
                        >
                          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                          Retry
                        </button>
                      )}
                    </div>
                  );
                }

                const res = turn.response;
                const pending = res?.pendingConfirmation;
                const isConfirmed =
                  pending && turn.confirmedActionId === pending.confirmationId;
                const isDismissed =
                  pending && dismissedIds.has(pending.confirmationId);
                const isLatestTurn = turn.id === lastTurnId;
                const activeSlotOverride = turn.selectedSlotOverride;

                return (
                  <article
                    key={turn.id}
                    className="space-y-4 pb-6 border-b border-[#EEF3EF] last:border-b-0 animate-view-enter"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-7 h-7 rounded-xl bg-[#E3F7EF] text-[#137A55] flex items-center justify-center shrink-0">
                          <Bot className="w-3.5 h-3.5" aria-hidden="true" />
                        </span>
                        <h3 className="text-sm font-bold text-[#1C2B25]">
                          {res?.headline ?? 'CareDesk Assistant'}
                        </h3>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#6B7B73]">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {turn.timestamp}
                      </span>
                    </div>

                    {res?.markdown ? (
                      <MarkdownRenderer content={res.markdown} />
                    ) : (
                      <p className="text-sm text-[#43564D] leading-relaxed">{turn.text}</p>
                    )}

                    {res?.sections && res.sections.length > 0 && (
                      <div className="space-y-3 pt-1">
                        {res.sections.map((sec) => (
                          <div key={sec.id} className="space-y-1">
                            <h4 className="text-xs font-bold text-[#0F3D2E]">{sec.title}</h4>
                            {sec.body && (
                              <p className="text-sm text-[#43564D] leading-relaxed">{sec.body}</p>
                            )}
                            {sec.bullets && sec.bullets.length > 0 && (
                              <ul className="space-y-1 pl-4 list-disc text-xs sm:text-sm text-[#43564D]">
                                {sec.bullets.map((b, bi) => (
                                  <li key={bi} className="leading-relaxed">
                                    {b}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {res?.structuredData?.metrics && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
                        {Object.entries(res.structuredData.metrics).map(([key, val]) => {
                          const labelMap: Record<string, string> = {
                            totalToday: 'Total Today',
                            confirmed: 'Confirmed',
                            unconfirmed: 'Unconfirmed',
                            missedToday: 'Missed Today',
                            pendingFollowUps: 'Pending Follow-ups',
                            missedLast7Days: 'Missed (Last 7d)',
                            totalMissed: 'Total Missed (7d)',
                            alreadyTracked: 'Already Tracked',
                            needingTask: 'Needs Follow-up',
                            totalPending: 'Open Follow-ups',
                            overdue: 'Overdue Tasks',
                            highPriority: 'High Priority',
                            totalAppointments: 'Total Visits',
                            missedVisits: 'Missed Visits',
                            openFollowUps: 'Open Follow-ups',
                          };
                          return (
                            <div
                              key={key}
                              className="bg-[#FAFBF9] border border-[#DCE8E0] rounded-2xl px-3.5 py-2.5"
                            >
                              <div className="text-[11px] text-[#6B7B73]">
                                {labelMap[key] ?? key.replace(/([A-Z])/g, ' $1').trim()}
                              </div>
                              <div className="text-base font-bold font-mono tabular-nums text-[#0F3D2E] mt-0.5">
                                {val}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {res?.structuredData?.type === 'patient_summary' &&
                      res.structuredData.patient && (
                        <div className="bg-[#FAFBF9] border border-[#DCE8E0] rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div>
                            <div className="text-[#6B7B73]">Synthetic Patient</div>
                            <div className="font-semibold text-[#1C2B25] mt-0.5">
                              {res.structuredData.patient.fullName}
                            </div>
                            <div className="font-mono text-[#137A55]">
                              {res.structuredData.patient.id}
                            </div>
                          </div>
                          <div>
                            <div className="text-[#6B7B73]">DOB · Registered</div>
                            <div className="font-mono text-[#1C2B25] mt-0.5">
                              {res.structuredData.patient.dateOfBirth}
                            </div>
                            <div className="font-mono text-[#6B7B73]">
                              Since {res.structuredData.patient.registrationDate}
                            </div>
                          </div>
                          <div>
                            <div className="text-[#6B7B73]">Administrative Status</div>
                            <div className="font-medium text-[#1C2B25] mt-0.5">
                              {res.structuredData.patient.administrativeStatus}
                            </div>
                            <div className="text-[#6B7B73] truncate">
                              {res.structuredData.patient.email}
                            </div>
                          </div>
                        </div>
                      )}

                    {res?.structuredData?.items &&
                      res.structuredData.items.length > 0 &&
                      (res.structuredData.type === 'daily_briefing' ||
                        res.structuredData.type === 'unconfirmed_appointments' ||
                        res.structuredData.type === 'missed_appointments' ||
                        res.structuredData.type === 'followup_plan' ||
                        res.structuredData.type === 'patient_summary' ||
                        res.structuredData.type === 'doctor_schedule' ||
                        res.structuredData.type === 'patient_appointments') && (
                        <div className="overflow-x-auto bg-white border border-[#DCE8E0] rounded-2xl">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-[#FAFBF9] border-b border-[#DCE8E0] text-[#6B7B73]">
                                <th className="py-2 px-3">Appt ID</th>
                                <th className="py-2 px-3">Patient</th>
                                <th className="py-2 px-3">Date &amp; Time</th>
                                <th className="py-2 px-3">Department · Clinician</th>
                                <th className="py-2 px-3">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#EEF3EF]">
                              {(
                                res.structuredData.items as Array<
                                  Appointment & { hasOpenFollowUp?: boolean }
                                >
                              ).map((item) => (
                                <tr key={item.id} className="hover:bg-[#FAFBF9]">
                                  <td className="py-2 px-3 font-mono font-semibold text-[#0F3D2E] whitespace-nowrap">
                                    {item.id}
                                  </td>
                                  <td className="py-2 px-3">
                                    <span className="font-medium text-[#1C2B25]">
                                      {item.patientName ?? res.structuredData?.patient?.fullName}
                                    </span>
                                    <span className="text-[#6B7B73] font-mono whitespace-nowrap">
                                      {' '}
                                      · {item.patientId}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 font-mono tabular-nums text-[#43564D] whitespace-nowrap">
                                    {item.appointmentDate} {item.appointmentTime}
                                  </td>
                                  <td className="py-2 px-3 text-[#6B7B73]">
                                    {item.department} · {item.clinician}
                                  </td>
                                  <td className="py-2 px-3">
                                    <AppointmentStatusText status={item.status} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                    {res?.structuredData?.items &&
                      res.structuredData.items.length > 0 &&
                      res.structuredData.type === 'followup_queue' && (
                        <div className="overflow-x-auto bg-white border border-[#DCE8E0] rounded-2xl">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-[#FAFBF9] border-b border-[#DCE8E0] text-[#6B7B73]">
                                <th className="py-2 px-3">Task</th>
                                <th className="py-2 px-3">Patient</th>
                                <th className="py-2 px-3">Outreach Description</th>
                                <th className="py-2 px-3">Due</th>
                                <th className="py-2 px-3">Priority</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#EEF3EF]">
                              {(res.structuredData.items as FollowUpTask[]).map((task) => (
                                <tr key={task.id} className="hover:bg-[#FAFBF9]">
                                  <td className="py-2 px-3 font-mono font-semibold text-[#0F3D2E] whitespace-nowrap">
                                    {task.id}
                                  </td>
                                  <td className="py-2 px-3 whitespace-nowrap">
                                    <span className="font-medium text-[#1C2B25]">
                                      {task.patientName ?? task.patientId}
                                    </span>
                                    <span className="text-[#6B7B73] font-mono">
                                      {' '}
                                      · {task.patientId}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-[#43564D]">{task.description}</td>
                                  <td className="py-2 px-3 font-mono tabular-nums text-[#43564D] whitespace-nowrap">
                                    {task.dueDate}
                                  </td>
                                  <td className="py-2 px-3 whitespace-nowrap">
                                    <PriorityText priority={task.priority} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                    {res?.structuredData?.items &&
                      res.structuredData.items.length > 0 &&
                      (res.structuredData.type === 'available_slots' ||
                        res.structuredData.type === 'reschedule_proposal') && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {(res.structuredData.items as AvailableSlot[]).map((slot, idx) => {
                            const isRescheduleSelectable =
                              res.structuredData?.type === 'reschedule_proposal' &&
                              pending &&
                              !isConfirmed &&
                              !isDismissed;
                            const isSelectedSlot = activeSlotOverride
                              ? activeSlotOverride.date === slot.date &&
                                activeSlotOverride.time === slot.time &&
                                activeSlotOverride.clinician === slot.clinician
                              : idx === 0 && isRescheduleSelectable;

                            return isRescheduleSelectable ? (
                              <button
                                key={`${slot.date}-${slot.time}-${slot.clinician}-${idx}`}
                                type="button"
                                onClick={() =>
                                  setTurns((prev) =>
                                    prev.map((t) =>
                                      t.id === turn.id ? { ...t, selectedSlotOverride: slot } : t
                                    )
                                  )
                                }
                                className={`btn-press text-left rounded-2xl px-4 py-3 flex items-center justify-between text-xs border transition-colors ${
                                  isSelectedSlot
                                    ? 'bg-[#E3F7EF] border-[#34C38F]'
                                    : 'bg-white border-[#DCE8E0] hover:bg-[#FAFBF9]'
                                }`}
                              >
                                <div>
                                  <div className="font-mono tabular-nums font-bold text-[#1C2B25]">
                                    {slot.date} · {slot.time}
                                  </div>
                                  <div className="text-[#6B7B73] mt-0.5">
                                    {slot.department} · {slot.clinician}
                                  </div>
                                </div>
                                <span className="px-2.5 py-0.5 rounded-full bg-white text-[11px] font-semibold text-[#137A55]">
                                  {isSelectedSlot ? 'Selected' : 'Select'}
                                </span>
                              </button>
                            ) : (
                              <div
                                key={`${slot.date}-${slot.time}-${slot.clinician}-${idx}`}
                                className="bg-[#FAFBF9] border border-[#DCE8E0] rounded-2xl px-4 py-3 flex items-center justify-between text-xs"
                              >
                                <div>
                                  <div className="font-mono tabular-nums font-bold text-[#1C2B25]">
                                    {slot.date} · {slot.time}
                                  </div>
                                  <div className="text-[#6B7B73] mt-0.5">
                                    {slot.department} · {slot.clinician}
                                  </div>
                                </div>
                                <span className="text-[11px] font-semibold text-[#137A55]">
                                  Open
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                    {res?.structuredData?.items &&
                      res.structuredData.items.length > 0 &&
                      res.structuredData.type === 'doctor_availability' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {(res.structuredData.items as DoctorAvailabilitySummary[]).map((doc) => (
                            <div
                              key={doc.staffId}
                              className="bg-[#FAFBF9] border border-[#DCE8E0] rounded-2xl p-4 space-y-2 text-xs"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="font-bold text-[#1C2B25]">{doc.fullName}</div>
                                  <div className="text-[#6B7B73]">
                                    {doc.department} · {doc.specialty}
                                  </div>
                                </div>
                                <DoctorDutyStatusText status={doc.effectiveOperationalState} />
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#6B7B73]">
                                <span>{doc.workingHoursLabel}</span>
                                <span>
                                  Load {doc.bookedCount}/{doc.maxDailyCapacity}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                    {res?.structuredData?.items &&
                      res.structuredData.items.length > 0 &&
                      res.structuredData.type === 'consultation_summary' && (
                        <div className="space-y-2.5">
                          {(res.structuredData.items as ConsultationRecord[]).map((rec) => (
                            <div
                              key={rec.id}
                              className="bg-[#FAFBF9] border border-[#DCE8E0] rounded-2xl p-4 space-y-1.5 text-xs"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-mono font-semibold text-[#0F3D2E]">
                                  {rec.consultationDate} · {rec.doctorName}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#137A55]">
                                  <FileText className="w-3 h-3" aria-hidden="true" />
                                  {rec.id}
                                </span>
                              </div>
                              <p className="text-[#1C2B25] leading-relaxed">{rec.summary}</p>
                            </div>
                          ))}
                        </div>
                      )}

                    {/* Mobile/Tablet fallback approval card inside chat (on xl+ shown in right panel) */}
                    {pending && role !== 'Patient' && !isConfirmed && !isDismissed && (
                      <div className="xl:hidden">{renderApprovalCard(turn)}</div>
                    )}

                    {isConfirmed && (
                      <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#E3F7EF] text-xs font-semibold text-[#137A55]">
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        Approved and applied to clinic records.
                      </div>
                    )}

                    {isDismissed && (
                      <div className="text-xs text-[#6B7B73]">
                        Action rejected by administrator. No database records were altered.
                      </div>
                    )}

                    {isLatestTurn &&
                      !loading &&
                      ((res?.followUpSuggestions && res.followUpSuggestions.length > 0) ||
                        onNavigateToFiltered) && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {res?.followUpSuggestions?.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => submitPrompt(suggestion)}
                              className="btn-press px-3.5 py-1.5 text-xs font-semibold text-[#0F3D2E] bg-[#E3F7EF] hover:bg-[#D0EFE3] rounded-full transition-colors"
                            >
                              {suggestion}
                            </button>
                          ))}
                          {onNavigateToFiltered &&
                            (res?.intent === 'daily_briefing' ||
                              res?.intent === 'unconfirmed_appointments' ||
                              res?.intent === 'missed_appointments') && (
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigateToFiltered({
                                    tab: 'appointments',
                                    status:
                                      res.intent === 'unconfirmed_appointments'
                                        ? 'Scheduled'
                                        : res.intent === 'missed_appointments'
                                          ? 'Missed'
                                          : 'All',
                                  })
                                }
                                className="btn-press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#43564D] bg-white hover:bg-[#FAFBF9] border border-[#DCE8E0] rounded-full transition-colors"
                              >
                                <Calendar className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
                                View Appointments
                              </button>
                            )}
                          {onNavigateToFiltered &&
                            (res?.intent === 'followup_queue' ||
                              res?.intent === 'prepare_followup_list') && (
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigateToFiltered({
                                    tab: 'followups',
                                    followUpView: 'pending',
                                  })
                                }
                                className="btn-press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#43564D] bg-white hover:bg-[#FAFBF9] border border-[#DCE8E0] rounded-full transition-colors"
                              >
                                Open Follow-ups Queue
                              </button>
                            )}
                        </div>
                      )}
                  </article>
                );
              })
            )}

            {loading && (
              <div
                className="rounded-2xl border border-[#DCE8E0] bg-[#FAFBF9] p-4 space-y-2 animate-view-enter"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-[#0F3D2E]">
                  <Loader2 className="w-4 h-4 text-[#34C38F] animate-spin shrink-0" aria-hidden="true" />
                  <span>{streamPhase}</span>
                </div>
                {streamingText && (
                  <div className="pt-2 border-t border-[#EEF3EF]">
                    <MarkdownRenderer content={streamingText} />
                  </div>
                )}
              </div>
            )}

            <div ref={feedEndRef} />
          </div>
        </div>

        {/* Multiline Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (loading) {
              handleStopGeneration();
            } else {
              submitPrompt(input);
            }
          }}
          className="p-4 border-t border-[#EEF3EF] bg-[#FAFBF9] rounded-b-[24px]"
        >
          <div className="max-w-3xl mx-auto space-y-1.5">
            <div className="flex items-end gap-2.5 bg-white border border-[#DCE8E0] focus-within:border-[#34C38F] focus-within:ring-2 focus-within:ring-[#34C38F]/20 rounded-[22px] p-2 transition-all">
              <label htmlFor="assistant-prompt-input" className="sr-only">
                Ask CareDesk Assistant
              </label>
              <textarea
                ref={textareaRef}
                id="assistant-prompt-input"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!loading && input.trim()) {
                      submitPrompt(input);
                    }
                  }
                }}
                placeholder={
                  role === 'Patient'
                    ? 'Ask about your next appointment, open slots, or prescriptions...'
                    : role === 'Doctor'
                      ? 'Ask about today’s queue, your next patient, or schedule...'
                      : "Ask for today's briefing, doctor availability, or reschedule P-1042..."
                }
                className="flex-1 resize-none px-3 py-2 text-sm bg-transparent border-0 focus:outline-none leading-relaxed max-h-[140px]"
              />
              {loading ? (
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  className="btn-press inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[40px] text-xs font-semibold text-[#1C2B25] bg-[#EEF3EF] hover:bg-[#DCE8E0] rounded-full transition-colors whitespace-nowrap shrink-0"
                >
                  <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="btn-press inline-flex items-center gap-1.5 px-5 py-2.5 min-h-[40px] text-xs font-semibold text-white bg-[#34C38F] hover:bg-[#24B07D] rounded-full transition-colors disabled:opacity-45 whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  Send
                </button>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#6B7B73] px-2">
              <span>Press Enter to send · Shift+Enter for new line</span>
              <span>
                {role === 'Patient'
                  ? 'Verified personal records only'
                  : 'Confirmation required for schedule mutations'}
              </span>
            </div>
          </div>
        </form>
      </section>

      {/* Right Rail: Human Approval Card + Tool-Call Status Panel + Prompt Shortcuts */}
      <aside className="xl:col-span-4 space-y-5">
        {/* 1. Human Approval Card (Dedicated Right Panel Slot on Desktop) */}
        {pendingApprovalTurn && role !== 'Patient' ? (
          <div className="hidden xl:block animate-view-enter">
            {renderApprovalCard(pendingApprovalTurn)}
          </div>
        ) : (
          <div className="card-surface rounded-[24px] p-5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#137A55]" aria-hidden="true" />
                <h2 className="text-sm font-bold text-[#1C2B25]">Approval Gate</h2>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-[#E3F7EF] text-[#137A55] text-[10px] font-semibold">
                Idle
              </span>
            </div>
            <p className="text-xs text-[#6B7B73] leading-relaxed">
              {role === 'Patient'
                ? 'Read-only access scoped to your personal patient records and prescriptions.'
                : 'Schedule changes proposed by CareDesk Assistant appear here for Approve / Reject sign-off before altering database records.'}
            </p>
          </div>
        )}

        {/* 2. Tool-Call Status Panel */}
        <section className="card-surface rounded-[24px] p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-[#137A55]" aria-hidden="true" />
              <h2 className="text-sm font-bold text-[#1C2B25]">Tool-Call Status</h2>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-[#EEF3EF] text-[#0F3D2E] text-[10px] font-mono">
              Local REST · MCP
            </span>
          </div>

          {loading ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#0F3D2E]">
                <Loader2 className="w-3.5 h-3.5 text-[#34C38F] animate-spin" aria-hidden="true" />
                <span>{streamPhase}</span>
              </div>
              {liveTools.length > 0 ? (
                <div className="space-y-2">
                  {liveTools.map((tool) => (
                    <div
                      key={tool.toolCallId}
                      className="p-3 rounded-2xl bg-[#FAFBF9] border border-[#DCE8E0] text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-[#1C2B25] truncate">
                          {tool.toolName}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-semibold shrink-0 ${
                            tool.status === 'running'
                              ? 'text-[#137A55]'
                              : tool.status === 'failed'
                                ? 'text-rose-600'
                                : 'text-[#0F3D2E]'
                          }`}
                        >
                          {tool.status === 'running' ? 'Running...' : `${tool.durationMs ?? 0}ms`}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#6B7B73] truncate">{tool.description}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#6B7B73]">Planning clinic database queries...</p>
              )}
            </div>
          ) : latestAssistantTurn?.response?.plannedTools &&
            latestAssistantTurn.response.plannedTools.length > 0 ? (
            <div className="space-y-2">
              {latestAssistantTurn.response.plannedTools.map((tool, i) => (
                <div
                  key={`${tool.toolName}-${i}`}
                  className="p-3 rounded-2xl bg-[#FAFBF9] border border-[#DCE8E0] text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[#1C2B25] truncate">
                      {tool.toolName}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold shrink-0 ${
                        tool.status === 'executed-via-local-rest'
                          ? 'bg-[#E3F7EF] text-[#137A55]'
                          : tool.status === 'awaiting-confirmation'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {typeof tool.durationMs === 'number' ? `${tool.durationMs}ms` : tool.status}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-[#6B7B73] truncate">
                    {tool.endpoint}
                  </div>
                  {tool.resultSummary && (
                    <div className="text-[11px] text-[#43564D] leading-snug">
                      {tool.resultSummary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#6B7B73] leading-relaxed">
              Send a message to watch real-time REST &amp; MCP tool execution steps and timings.
            </p>
          )}
        </section>

        {/* 3. Prompt Library */}
        <section className="card-surface rounded-[24px] p-5 space-y-4">
          <h2 className="text-sm font-bold text-[#1C2B25]">Quick Prompts</h2>
          <div className="space-y-3.5">
            {promptGroups.map((group) => (
              <div key={group.label} className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7B73]">
                  {group.label}
                </div>
                <div className="space-y-1.5">
                  {group.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={loading}
                      onClick={() => submitPrompt(prompt)}
                      className="btn-press w-full text-left px-3.5 py-2 text-xs font-semibold text-[#1C2B25] hover:text-[#0F3D2E] bg-[#FAFBF9] hover:bg-[#E3F7EF]/60 border border-[#DCE8E0]/70 rounded-2xl transition-colors disabled:opacity-50 flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{prompt}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#137A55] shrink-0" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 4. Guardrails */}
        <section className="rounded-[22px] bg-[#0F3D2E] text-emerald-50 p-5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#34C38F]">
            <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Operational Guardrails</span>
          </div>
          <ul className="space-y-1 text-xs text-emerald-100/80">
            <li>• Clinic boundary &amp; role permissions enforced server-side</li>
            <li>• Grounded strictly in live SQLite clinic records</li>
            <li>• Confirmation required before modifying bookings</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
