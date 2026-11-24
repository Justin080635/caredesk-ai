import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  History,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
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
  AssistantPlannedTool,
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
import {
  buildCopyableReplyText,
  formatApprovalPreviewText,
  formatAssistantGreeting,
  formatFriendlyToolDescription,
  formatFriendlyToolStatus,
  getFriendlyToolMeta,
  humanizeAssistantError,
  sanitizeTechnicalText,
} from '../utils/assistantUi';
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
  failedQueryText?: string;
  cancelled?: boolean;
  selectedSlotOverride?: AvailableSlot;
}

interface SuggestionChip {
  label: string;
  queryText: string;
  hint?: string;
}

interface AssistantViewProps {
  role?: AccountRole;
  userName?: string;
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  onNavigateToFiltered?: (target: DashboardFilteredTarget) => void;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
}

function getToolStatusPillClasses(
  status: AssistantPlannedTool['status'] | 'running'
): string {
  switch (status) {
    case 'running':
      return 'bg-[#E3F7EF] text-[#137A55] border-[#BBE9D5]';
    case 'executed-via-local-rest':
    case 'local-rest-preview':
      return 'bg-[#E3F7EF] text-[#0F3D2E] border-[#BBE9D5]';
    case 'awaiting-confirmation':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'failed':
    case 'mcp-not-connected':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-[#E3F7EF] text-[#0F3D2E] border-[#BBE9D5]';
  }
}

export function AssistantView({
  role = 'Clinic Administrator',
  userName,
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
  const [liveTools, setLiveTools] = useState<LiveToolStep[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmErrorByTurn, setConfirmErrorByTurn] = useState<Record<string, string>>({});
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
  const [whatIDidOpen, setWhatIDidOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
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
    el.style.height = `${Math.min(132, Math.max(44, el.scrollHeight))}px`;
  }, [input]);

  const prevTurnCountRef = useRef(0);

  const scrollToBottomIfNear = useCallback((force = false) => {
    const container = feedContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (force || distanceFromBottom < 240) {
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
    async (displayText: string, overrideQueryText?: string) => {
      const trimmedDisplay = displayText.trim();
      const trimmedQuery = (overrideQueryText ?? displayText).trim();
      if (!trimmedQuery || loading) return;

      const userTurn: ChatTurn = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmedDisplay,
        timestamp: formatTimeNow(),
      };

      setTurns((prev) => [...prev, userTurn]);
      setInput('');
      setLoading(true);
      setLiveTools([]);
      setStreamingText('');

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await streamAssistantQuery(trimmedQuery, {
          conversationId: activeConversationId ?? undefined,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'tool_start') {
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
              text: 'I stopped checking before finishing. Want me to run that again?',
              timestamp: formatTimeNow(),
              failedPrompt: trimmedDisplay,
              failedQueryText: trimmedQuery,
              cancelled: true,
            },
          ]);
        } else {
          const rawMessage = err instanceof Error ? err.message : '';
          const friendlyMessage = humanizeAssistantError(rawMessage);
          setTurns((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: 'error',
              text: friendlyMessage,
              timestamp: formatTimeNow(),
              failedPrompt: trimmedDisplay,
              failedQueryText: trimmedQuery,
            },
          ]);
          onErrorNotice(friendlyMessage);
        }
      } finally {
        abortControllerRef.current = null;
        setLoading(false);
        setLiveTools([]);
        setStreamingText('');
      }
    },
    [loading, onErrorNotice, activeConversationId, loadConversations]
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
      onErrorNotice(
        humanizeAssistantError(err instanceof Error ? err.message : 'Unable to load conversation.')
      );
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
      onErrorNotice(
        humanizeAssistantError(err instanceof Error ? err.message : 'Unable to delete conversation.')
      );
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
      onSuccessNotice(sanitizeTechnicalText(result.headline || 'Change saved to clinic records.'));
    } catch (err) {
      const msg = humanizeAssistantError(
        err instanceof Error ? err.message : 'Could not save that change.'
      );
      setConfirmErrorByTurn((prev) => ({ ...prev, [turn.id]: msg }));
      onErrorNotice(msg);
    } finally {
      setConfirmingId(null);
    }
  };

  const handleDismiss = (confirmationId: string) => {
    setDismissedIds((prev) => new Set(prev).add(confirmationId));
  };

  const copyTextWithFallback = async (text: string): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fallback below for restricted or headless browser contexts
      }
    }
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.className = 'fixed -top-[9999px] -left-[9999px] opacity-0 pointer-events-none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      document.body.removeChild(textarea);
    }
    return copied;
  };

  const handleCopyTurn = async (turn: ChatTurn) => {
    const text = buildCopyableReplyText(turn.text, turn.response);
    if (!text) return;
    const copied = await copyTextWithFallback(text);
    if (copied) {
      setCopiedTurnId(turn.id);
      window.setTimeout(() => {
        setCopiedTurnId((prev) => (prev === turn.id ? null : prev));
      }, 1800);
    } else {
      onErrorNotice('Unable to copy reply to clipboard.');
    }
  };

  const suggestionChips: SuggestionChip[] =
    role === 'Doctor'
      ? [
          {
            label: 'Show my appointments today',
            queryText: 'Show my appointments for today.',
            hint: clinicBrief.doctorDash
              ? `${clinicBrief.doctorDash.todayAppointments.length} visits today`
              : undefined,
          },
          {
            label: 'What is my next appointment?',
            queryText: 'What is my next appointment?',
            hint: clinicBrief.doctorDash?.nextAppointment
              ? clinicBrief.doctorDash.nextAppointment.appointmentTime
              : undefined,
          },
          {
            label: 'Which follow-ups need me?',
            queryText: 'Which follow-ups require my attention?',
            hint: clinicBrief.doctorDash
              ? `${clinicBrief.doctorDash.followupsRequiringAttention.length} open`
              : undefined,
          },
          {
            label: 'Summarize my schedule',
            queryText: 'Summarize my schedule and leave blocks.',
          },
        ]
      : role === 'Patient'
        ? [
            {
              label: 'When is my next appointment?',
              queryText: 'When is my next appointment?',
              hint: clinicBrief.patientHome?.nextAppointment?.appointmentDate,
            },
            {
              label: 'Find the next free slot',
              queryText: 'Find open appointment slots this week.',
            },
            {
              label: 'Recent visits & prescriptions',
              queryText: 'Summarize my recent consultations and prescriptions.',
            },
            {
              label: 'My follow-up instructions',
              queryText: 'What follow-up instructions do I have?',
            },
          ]
        : [
            {
              label: "Give me today's briefing",
              queryText: "Give me today's clinic briefing.",
              hint: clinicBrief.daily ? `${clinicBrief.daily.totalAppointments} visits today` : undefined,
            },
            {
              label: 'Who missed appointments this week?',
              queryText: 'Identify patients who missed appointments during the last seven days.',
              hint: clinicBrief.overview
                ? `${clinicBrief.overview.missedLastSevenDaysCount} missed`
                : undefined,
            },
            {
              label: 'Which follow-ups are overdue?',
              queryText: 'Identify overdue follow-ups.',
              hint: clinicBrief.overview
                ? `${clinicBrief.overview.overdueFollowUpsCount} overdue`
                : undefined,
            },
            {
              label: 'Find the next free slot',
              queryText: 'Find the next available appointment slot',
            },
          ];

  const greetingLine = formatAssistantGreeting(userName);
  const lastTurnId = turns[turns.length - 1]?.id;
  const latestAssistantTurn = [...turns].reverse().find((t) => t.role === 'assistant');

  const panelTools = loading
    ? liveTools.map((t) => ({
        id: t.toolCallId,
        toolName: t.toolName,
        description: formatFriendlyToolDescription(t),
        status: t.status,
      }))
    : (latestAssistantTurn?.response?.plannedTools ?? []).map((t, idx) => ({
        id: `${t.toolName}-${idx}`,
        toolName: t.toolName,
        description: formatFriendlyToolDescription(t),
        status: t.status,
      }));

  const renderApprovalCard = (turn: ChatTurn) => {
    const pending = turn.response?.pendingConfirmation;
    if (!pending || role === 'Patient') return null;
    const activeSlotOverride = turn.selectedSlotOverride;
    const confirmErr = confirmErrorByTurn[turn.id];
    const isWorking = confirmingId === pending.confirmationId;
    const previewSentence = formatApprovalPreviewText(pending, activeSlotOverride);

    return (
      <div className="rounded-[20px] bg-white border-2 border-amber-300 shadow-xs p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
            <AlertCircle className="w-4.5 h-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="inline-flex px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] font-semibold uppercase tracking-wide">
              Approval Needed
            </span>
            <p className="text-sm font-bold text-[#1C2B25] mt-1 leading-snug">{previewSentence}</p>
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-[#FAFBF9] border border-[#DCE8E0] rounded-2xl p-3">
          {Object.entries(pending.details).map(([k, v]) => {
            const displayValue =
              k === 'Proposed Slot' && activeSlotOverride
                ? `${activeSlotOverride.date} ${activeSlotOverride.time}`
                : k === 'Clinician' && activeSlotOverride
                  ? activeSlotOverride.clinician
                  : sanitizeTechnicalText(String(v ?? '—'));
            return (
              <div key={k} className="min-w-0">
                <dt className="text-[11px] text-[#6B7B73]">{k}</dt>
                <dd className="font-semibold text-xs text-[#1C2B25] mt-0.5 break-words">
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
            className="btn-press flex-1 min-h-[44px] px-4 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {isWorking ? 'Saving change…' : 'Approve'}
          </button>
          <button
            type="button"
            disabled={isWorking}
            onClick={() => handleDismiss(pending.confirmationId)}
            className="btn-press flex-1 min-h-[44px] px-4 py-2 text-xs font-semibold text-[#1C2B25] hover:bg-[#EEF3EF] bg-[#FAFBF9] border border-[#DCE8E0] rounded-full transition-colors whitespace-nowrap"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 lg:h-full">
      {/* Center Conversation Column */}
      <section
        aria-label="CareDesk Assistant conversation"
        className="flex-1 min-w-0 min-h-0 card-surface rounded-[24px] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <header className="px-4 sm:px-6 py-3.5 border-b border-[#EEF3EF] flex flex-wrap items-center justify-between gap-2.5 shrink-0 bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#0F3D2E] text-[#34C38F] flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-[#1C2B25] truncate">
                {role === 'Patient'
                  ? 'CareDesk Patient Assistant'
                  : role === 'Doctor'
                    ? 'CareDesk Doctor Assistant'
                    : 'CareDesk Assistant'}
              </h2>
              <p className="text-xs text-[#6B7B73] truncate">
                Calm clinic helper grounded in live records
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSavedDrawer((v) => !v)}
              className="btn-press inline-flex items-center gap-1.5 min-h-[40px] sm:min-h-[34px] px-3 py-1.5 text-xs font-semibold text-[#1C2B25] bg-[#FAFBF9] hover:bg-[#EEF3EF] border border-[#DCE8E0] rounded-full"
            >
              <History className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
              <span>Past Chats ({conversations.length})</span>
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleNewConversation}
              className="btn-press inline-flex items-center gap-1.5 min-h-[40px] sm:min-h-[34px] px-3 py-1.5 text-xs font-semibold text-[#0F3D2E] bg-[#E3F7EF] hover:bg-[#D0EFE3] rounded-full disabled:opacity-50"
            >
              <MessageSquarePlus className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
              New Chat
            </button>
            <button
              type="button"
              onClick={() => setWhatIDidOpen((v) => !v)}
              aria-expanded={whatIDidOpen}
              className="btn-press inline-flex items-center gap-1.5 min-h-[40px] sm:min-h-[34px] px-3 py-1.5 text-xs font-semibold text-[#0F3D2E] bg-[#EEF3EF] hover:bg-[#DCE8E0] rounded-full"
            >
              {whatIDidOpen ? (
                <PanelRightClose className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
              ) : (
                <PanelRightOpen className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
              )}
              <span>What I did</span>
              {panelTools.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-white text-[10px] font-mono font-bold text-[#137A55]">
                  {panelTools.length}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Collapsible Past Conversations Drawer */}
        {showSavedDrawer && (
          <div className="px-4 sm:px-6 py-3 bg-[#FAFBF9] border-b border-[#EEF3EF] space-y-2 shrink-0 animate-view-enter">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7B73]">
              Saved Conversations
            </div>
            {loadingConversations ? (
              <p className="text-xs text-[#6B7B73]">Loading past chats…</p>
            ) : conversations.length === 0 ? (
              <p className="text-xs text-[#6B7B73]">
                Your conversations are saved here automatically.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
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
                        className="p-2 text-[#6B7B73] hover:text-rose-600 shrink-0"
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

        {/* Scrollable Chat Feed */}
        <div
          ref={feedContainerRef}
          className="flex-1 min-h-0 px-4 sm:px-6 lg:px-8 py-5 overflow-y-auto"
        >
          <div className="max-w-3xl mx-auto space-y-5">
            {turns.length === 0 ? (
              <div className="py-4 sm:py-8 space-y-6 animate-view-enter">
                <div className="rounded-[24px] bg-[#F2F7F3] border border-[#DCE8E0] p-5 sm:p-6 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-2xl bg-[#0F3D2E] text-[#34C38F] flex items-center justify-center shrink-0">
                      <Bot className="w-5 h-5" aria-hidden="true" />
                    </span>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-[#DCE8E0] text-[#137A55] text-xs font-semibold">
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>CareDesk Assistant</span>
                    </div>
                  </div>
                  <h3 className="text-lg sm:text-2xl font-bold tracking-tight text-[#1C2B25] leading-snug">
                    {greetingLine}
                  </h3>
                  <p className="text-xs sm:text-sm text-[#43564D] leading-relaxed">
                    Ask in plain English about today&apos;s schedule, missed visits, overdue
                    follow-ups, open slots, or rescheduling an appointment.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {suggestionChips.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      disabled={loading}
                      onClick={() => submitPrompt(chip.label, chip.queryText)}
                      className="btn-press card-interactive text-left min-h-[56px] px-4 py-3.5 rounded-2xl border border-[#DCE8E0] bg-white hover:bg-[#E3F7EF]/45 flex items-center justify-between gap-3 group"
                    >
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-semibold text-[#1C2B25] group-hover:text-[#0F3D2E]">
                          {chip.label}
                        </div>
                        {chip.hint && (
                          <div className="text-[11px] text-[#6B7B73] mt-0.5">{chip.hint}</div>
                        )}
                      </div>
                      <ArrowRight
                        className="w-4 h-4 text-[#137A55] shrink-0 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((turn) => {
                if (turn.role === 'user') {
                  return (
                    <div key={turn.id} className="flex justify-end animate-view-enter">
                      <div className="max-w-[85%] sm:max-w-xl bg-[#137A55] text-white px-4 py-3 rounded-[20px] rounded-br-sm text-sm space-y-1 shadow-xs">
                        <div className="whitespace-pre-wrap break-words leading-relaxed">
                          {turn.text}
                        </div>
                        <div className="text-[10px] font-mono text-emerald-100/80 text-right">
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
                      className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-view-enter"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle
                          className="w-4 h-4 text-rose-600 mt-0.5 shrink-0"
                          aria-hidden="true"
                        />
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-rose-950">
                            {turn.cancelled ? 'Paused' : "Couldn't complete that check"}
                          </div>
                          <p className="text-xs sm:text-sm text-rose-900">{turn.text}</p>
                        </div>
                      </div>
                      {turn.failedPrompt && (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => submitPrompt(turn.failedPrompt!, turn.failedQueryText)}
                          className="btn-press inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-semibold text-rose-900 bg-white hover:bg-rose-100 border border-rose-200 rounded-full shrink-0"
                        >
                          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                          Try again
                        </button>
                      )}
                    </div>
                  );
                }

                const res = turn.response;
                const pending = res?.pendingConfirmation;
                const isConfirmed =
                  Boolean(pending) && turn.confirmedActionId === pending?.confirmationId;
                const isDismissed =
                  Boolean(pending) && dismissedIds.has(pending!.confirmationId);
                const isLatestTurn = turn.id === lastTurnId;
                const activeSlotOverride = turn.selectedSlotOverride;
                const isCopied = copiedTurnId === turn.id;
                const cleanHeadline = sanitizeTechnicalText(res?.headline ?? 'CareDesk Assistant');
                const cleanSummary = sanitizeTechnicalText(res?.summary || turn.text);

                return (
                  <article
                    key={turn.id}
                    className="flex items-start gap-3 animate-view-enter"
                  >
                    <div
                      aria-hidden="true"
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-[#0F3D2E] text-[#34C38F] flex items-center justify-center shrink-0 mt-0.5"
                    >
                      <Bot className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0 rounded-[22px] rounded-tl-sm bg-[#F2F7F3] border border-[#DCE8E0] p-4 sm:p-5 space-y-3.5">
                      {/* One-line answer / headline + copy & timestamp */}
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-bold text-[#0F3D2E] leading-snug">
                            {cleanHeadline}
                          </h3>
                          {cleanSummary && cleanSummary !== cleanHeadline && !res?.markdown && (
                            <p className="text-xs sm:text-sm text-[#1C2B25] leading-relaxed mt-1">
                              {cleanSummary}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopyTurn(turn)}
                            aria-label="Copy assistant reply"
                            className="inline-flex items-center gap-1 min-h-[32px] px-2.5 py-1 rounded-full bg-white border border-[#DCE8E0] hover:bg-[#E3F7EF] text-[11px] font-semibold text-[#43564D] transition-colors"
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-3 h-3 text-[#137A55]" aria-hidden="true" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" aria-hidden="true" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#6B7B73]">
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            {turn.timestamp}
                          </span>
                        </div>
                      </div>

                      {res?.markdown && (
                        <div className="text-[#1C2B25]">
                          <MarkdownRenderer content={sanitizeTechnicalText(res.markdown)} />
                        </div>
                      )}

                      {res?.sections && res.sections.length > 0 && (
                        <div className="space-y-2.5">
                          {res.sections.map((sec) => (
                            <div
                              key={sec.id}
                              className="bg-white/80 border border-[#DCE8E0]/80 rounded-2xl p-3 space-y-1"
                            >
                              <h4 className="text-xs font-bold text-[#0F3D2E]">
                                {sanitizeTechnicalText(sec.title)}
                              </h4>
                              {sec.body && (
                                <p className="text-xs sm:text-sm text-[#43564D] leading-relaxed">
                                  {sanitizeTechnicalText(sec.body)}
                                </p>
                              )}
                              {sec.bullets && sec.bullets.length > 0 && (
                                <ul className="space-y-1 pl-4 list-disc text-xs text-[#43564D]">
                                  {sec.bullets.map((b, bi) => (
                                    <li key={bi} className="leading-relaxed">
                                      {sanitizeTechnicalText(b)}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Mini counts */}
                      {res?.structuredData?.metrics && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {Object.entries(res.structuredData.metrics).map(([key, val]) => {
                            const labelMap: Record<string, string> = {
                              totalToday: 'Today',
                              confirmed: 'Confirmed',
                              unconfirmed: 'Waiting confirmation',
                              missedToday: 'Missed today',
                              pendingFollowUps: 'Open follow-ups',
                              missedLast7Days: 'Missed (7 days)',
                              totalMissed: 'Missed (7 days)',
                              alreadyTracked: 'Already tracked',
                              needingTask: 'Needs outreach',
                              totalPending: 'Open follow-ups',
                              overdue: 'Overdue',
                              highPriority: 'High priority',
                              totalAppointments: 'Total visits',
                              missedVisits: 'Missed visits',
                              openFollowUps: 'Open follow-ups',
                            };
                            return (
                              <div
                                key={key}
                                className="bg-white border border-[#DCE8E0] rounded-2xl px-3 py-2.5"
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

                      {/* Patient summary card */}
                      {res?.structuredData?.type === 'patient_summary' &&
                        res.structuredData.patient && (
                          <div className="bg-white border border-[#DCE8E0] rounded-2xl p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div>
                              <div className="text-[#6B7B73]">Patient</div>
                              <div className="font-semibold text-[#1C2B25] mt-0.5">
                                {res.structuredData.patient.fullName}
                              </div>
                              <div className="font-mono text-[#137A55]">
                                {res.structuredData.patient.id}
                              </div>
                            </div>
                            <div>
                              <div className="text-[#6B7B73]">Date of birth</div>
                              <div className="font-mono text-[#1C2B25] mt-0.5">
                                {res.structuredData.patient.dateOfBirth}
                              </div>
                              <div className="text-[#6B7B73]">
                                Registered {res.structuredData.patient.registrationDate}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div className="text-[#6B7B73]">Status &amp; Contact</div>
                              <div className="font-medium text-[#1C2B25] mt-0.5">
                                {res.structuredData.patient.administrativeStatus}
                              </div>
                              <div className="text-[#6B7B73] truncate">
                                {res.structuredData.patient.email}
                              </div>
                            </div>
                          </div>
                        )}

                      {/* Read-back confirmation of saved record after Approval */}
                      {res?.structuredData?.type === 'action_completed' &&
                        res.structuredData.items &&
                        res.structuredData.items.length > 0 && (
                          <div className="rounded-2xl bg-white border-2 border-[#34C38F] p-3.5 space-y-2.5">
                            <div className="flex items-center gap-2 text-xs font-bold text-[#0F3D2E]">
                              <CheckCircle2 className="w-4 h-4 text-[#137A55] shrink-0" aria-hidden="true" />
                              <span>Confirmed saved record</span>
                            </div>
                            {(res.structuredData.items as Array<Partial<Appointment & FollowUpTask>>).map(
                              (item, idx) =>
                                'appointmentDate' in item && item.appointmentDate ? (
                                  <div
                                    key={item.id ?? idx}
                                    className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-[#FAFBF9] border border-[#EEF3EF] rounded-xl p-2.5"
                                  >
                                    <div>
                                      <span className="text-[10px] text-[#6B7B73] block">Patient</span>
                                      <span className="font-semibold text-[#1C2B25]">
                                        {item.patientName ?? item.patientId}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-[#6B7B73] block">New Time</span>
                                      <span className="font-mono font-semibold text-[#0F3D2E]">
                                        {item.appointmentDate} · {item.appointmentTime}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-[#6B7B73] block">Department</span>
                                      <span className="text-[#1C2B25]">
                                        {item.department} · {item.clinician}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-[#6B7B73] block">Status</span>
                                      {item.status && <AppointmentStatusText status={item.status} />}
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    key={item.id ?? idx}
                                    className="text-xs bg-[#FAFBF9] border border-[#EEF3EF] rounded-xl p-2.5 flex items-center justify-between gap-2"
                                  >
                                    <span className="font-medium text-[#1C2B25]">
                                      {item.patientName ?? item.patientId}: {item.description}
                                    </span>
                                    {item.priority && <PriorityText priority={item.priority} />}
                                  </div>
                                )
                            )}
                          </div>
                        )}

                      {/* Appointment rows: mobile stacked cards + desktop table */}
                      {res?.structuredData?.items &&
                        res.structuredData.items.length > 0 &&
                        (res.structuredData.type === 'daily_briefing' ||
                          res.structuredData.type === 'unconfirmed_appointments' ||
                          res.structuredData.type === 'missed_appointments' ||
                          res.structuredData.type === 'followup_plan' ||
                          res.structuredData.type === 'patient_summary' ||
                          res.structuredData.type === 'doctor_schedule' ||
                          res.structuredData.type === 'patient_appointments') && (
                          <div className="bg-white border border-[#DCE8E0] rounded-2xl overflow-hidden">
                            <div className="md:hidden divide-y divide-[#EEF3EF]">
                              {(
                                res.structuredData.items as Array<
                                  Appointment & { hasOpenFollowUp?: boolean }
                                >
                              ).map((item) => (
                                <div key={item.id} className="p-3 space-y-1.5 text-xs">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-[#1C2B25]">
                                      {item.patientName ?? res.structuredData?.patient?.fullName ?? item.patientId}
                                    </span>
                                    <AppointmentStatusText status={item.status} />
                                  </div>
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6B7B73]">
                                    <span className="font-mono text-[#0F3D2E]">
                                      {item.appointmentDate} · {item.appointmentTime}
                                    </span>
                                    <span>
                                      {item.department} · {item.clinician}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="hidden md:block overflow-x-auto">
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className="bg-[#FAFBF9] border-b border-[#DCE8E0] text-[#6B7B73]">
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
                          </div>
                        )}

                      {/* Follow-up items: mobile stacked cards + desktop table */}
                      {res?.structuredData?.items &&
                        res.structuredData.items.length > 0 &&
                        res.structuredData.type === 'followup_queue' && (
                          <div className="bg-white border border-[#DCE8E0] rounded-2xl overflow-hidden">
                            <div className="md:hidden divide-y divide-[#EEF3EF]">
                              {(res.structuredData.items as FollowUpTask[]).map((task) => (
                                <div key={task.id} className="p-3 space-y-1.5 text-xs">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-[#1C2B25]">
                                      {task.patientName ?? task.patientId}
                                    </span>
                                    <PriorityText priority={task.priority} />
                                  </div>
                                  <p className="text-[#43564D]">{task.description}</p>
                                  <div className="text-[11px] font-mono text-[#6B7B73]">
                                    Due {task.dueDate}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="hidden md:block overflow-x-auto">
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className="bg-[#FAFBF9] border-b border-[#DCE8E0] text-[#6B7B73]">
                                    <th className="py-2 px-3">Patient</th>
                                    <th className="py-2 px-3">Task</th>
                                    <th className="py-2 px-3">Due</th>
                                    <th className="py-2 px-3">Priority</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#EEF3EF]">
                                  {(res.structuredData.items as FollowUpTask[]).map((task) => (
                                    <tr key={task.id} className="hover:bg-[#FAFBF9]">
                                      <td className="py-2 px-3 font-medium text-[#1C2B25] whitespace-nowrap">
                                        {task.patientName ?? task.patientId}
                                      </td>
                                      <td className="py-2 px-3 text-[#43564D]">{task.description}</td>
                                      <td className="py-2 px-3 font-mono tabular-nums text-[#43564D] whitespace-nowrap">
                                        {task.dueDate}
                                      </td>
                                      <td className="py-2 px-3">
                                        <PriorityText priority={task.priority} />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                      {/* Available slots */}
                      {res?.structuredData?.items &&
                        res.structuredData.items.length > 0 &&
                        res.structuredData.type === 'available_slots' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {(res.structuredData.items as AvailableSlot[]).map((slot, idx) => {
                              const canSelectForApproval =
                                pending?.actionType === 'reschedule_appointment' &&
                                !isConfirmed &&
                                !isDismissed;
                              const isSelectedSlot =
                                activeSlotOverride?.date === slot.date &&
                                activeSlotOverride?.time === slot.time &&
                                activeSlotOverride?.clinician === slot.clinician;

                              return canSelectForApproval ? (
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
                                  className={`btn-press text-left rounded-2xl px-3.5 py-3 flex items-center justify-between text-xs border transition-colors ${
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
                                  <span className="px-2.5 py-0.5 rounded-full bg-[#FAFBF9] border border-[#DCE8E0] text-[11px] font-semibold text-[#137A55]">
                                    {isSelectedSlot ? 'Selected' : 'Use slot'}
                                  </span>
                                </button>
                              ) : (
                                <div
                                  key={`${slot.date}-${slot.time}-${slot.clinician}-${idx}`}
                                  className="bg-white border border-[#DCE8E0] rounded-2xl px-3.5 py-3 flex items-center justify-between text-xs"
                                >
                                  <div>
                                    <div className="font-mono tabular-nums font-bold text-[#1C2B25]">
                                      {slot.date} · {slot.time}
                                    </div>
                                    <div className="text-[#6B7B73] mt-0.5">
                                      {slot.department} · {slot.clinician}
                                    </div>
                                  </div>
                                  <span className="px-2.5 py-0.5 rounded-full bg-[#E3F7EF] text-[11px] font-semibold text-[#137A55]">
                                    Open
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                      {/* Doctor availability cards */}
                      {res?.structuredData?.items &&
                        res.structuredData.items.length > 0 &&
                        res.structuredData.type === 'doctor_availability' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {(res.structuredData.items as DoctorAvailabilitySummary[]).map((doc) => (
                              <div
                                key={doc.staffId}
                                className="bg-white border border-[#DCE8E0] rounded-2xl p-3.5 space-y-1.5 text-xs"
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
                                    Booked {doc.bookedCount}/{doc.maxDailyCapacity}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                      {/* Consultation summaries */}
                      {res?.structuredData?.items &&
                        res.structuredData.items.length > 0 &&
                        res.structuredData.type === 'consultation_summary' && (
                          <div className="space-y-2">
                            {(res.structuredData.items as ConsultationRecord[]).map((rec) => (
                              <div
                                key={rec.id}
                                className="bg-white border border-[#DCE8E0] rounded-2xl p-3.5 space-y-1 text-xs"
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

                      {/* Inline Approval Gate Card */}
                      {pending && role !== 'Patient' && !isConfirmed && !isDismissed && (
                        <div>{renderApprovalCard(turn)}</div>
                      )}

                      {isConfirmed && (
                        <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#E3F7EF] text-xs font-semibold text-[#137A55]">
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          Approved and saved.
                        </div>
                      )}

                      {isDismissed && (
                        <div className="text-xs text-[#6B7B73]">
                          Cancelled. No clinic records were changed.
                        </div>
                      )}

                      {/* Suggested Next Action */}
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
                                className="btn-press min-h-[38px] sm:min-h-0 px-3.5 py-1.5 text-xs font-semibold text-[#0F3D2E] bg-white hover:bg-[#E3F7EF] border border-[#DCE8E0] rounded-full transition-colors"
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
                                  className="btn-press inline-flex items-center gap-1.5 min-h-[38px] sm:min-h-0 px-3.5 py-1.5 text-xs font-semibold text-[#43564D] bg-white hover:bg-[#FAFBF9] border border-[#DCE8E0] rounded-full transition-colors"
                                >
                                  <Calendar className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
                                  Open Appointments
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
                                  className="btn-press inline-flex items-center gap-1.5 min-h-[38px] sm:min-h-0 px-3.5 py-1.5 text-xs font-semibold text-[#43564D] bg-white hover:bg-[#FAFBF9] border border-[#DCE8E0] rounded-full transition-colors"
                                >
                                  Open Follow-ups
                                </button>
                              )}
                          </div>
                        )}
                    </div>
                  </article>
                );
              })
            )}

            {/* Live Friendly Steps + Typing Indicator */}
            {loading && (
              <div
                className="flex items-start gap-3 animate-view-enter"
                aria-live="polite"
              >
                <div
                  aria-hidden="true"
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-[#0F3D2E] text-[#34C38F] flex items-center justify-center shrink-0 mt-0.5"
                >
                  <Bot className="w-4 h-4" />
                </div>
                <div className="flex-1 rounded-[22px] rounded-tl-sm bg-[#F2F7F3] border border-[#DCE8E0] p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-[#0F3D2E]">
                    {liveTools.length > 0 ? (
                      liveTools.map((step, idx) => {
                        const meta = getFriendlyToolMeta(step.toolName);
                        const done = step.status === 'executed-via-local-rest';
                        return (
                          <span key={step.toolCallId} className="inline-flex items-center gap-1.5">
                            {idx > 0 && <span className="text-[#6B7B73]">→</span>}
                            <span className={done ? 'text-[#137A55]' : 'text-[#0F3D2E]'}>
                              {done ? `${meta.completedStep} ✓` : `${meta.activeStep}…`}
                            </span>
                          </span>
                        );
                      })
                    ) : (
                      <span>Checking clinic records…</span>
                    )}
                    <span className="inline-flex items-center gap-1 ml-1" aria-hidden="true">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </span>
                  </div>
                  {streamingText && (
                    <div className="pt-2 border-t border-[#DCE8E0]/80 text-xs sm:text-sm text-[#1C2B25]">
                      <MarkdownRenderer content={sanitizeTechnicalText(streamingText)} />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={feedEndRef} />
          </div>
        </div>

        {/* Persistent Input Bar + Medical Disclaimer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (loading) {
              handleStopGeneration();
            } else {
              submitPrompt(input);
            }
          }}
          className="px-4 sm:px-6 py-3.5 border-t border-[#EEF3EF] bg-[#FAFBF9] shrink-0"
        >
          <div className="max-w-3xl mx-auto space-y-1.5">
            <div className="flex items-end gap-2 bg-white border border-[#DCE8E0] focus-within:border-[#34C38F] focus-within:ring-2 focus-within:ring-[#34C38F]/20 rounded-[22px] p-1.5 sm:p-2 transition-all">
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
                    ? 'Ask about your next visit or open slots…'
                    : role === 'Doctor'
                      ? "Ask about today's appointments or follow-ups…"
                      : 'Ask for a briefing, missed visits, open slots, or rescheduling…'
                }
                className="flex-1 resize-none px-3 py-2 text-sm bg-transparent border-0 focus:outline-none leading-relaxed max-h-[132px]"
              />
              {loading ? (
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  className="btn-press inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-xs font-semibold text-[#1C2B25] bg-[#EEF3EF] hover:bg-[#DCE8E0] rounded-full transition-colors whitespace-nowrap shrink-0"
                >
                  <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="btn-press inline-flex items-center gap-1.5 min-h-[44px] px-5 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full transition-colors disabled:opacity-45 whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  Send
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6B7B73] px-2">
              <span className="font-medium text-[#43564D]">
                Administrative assistant only. No medical advice.
              </span>
              <span className="hidden sm:inline">Enter to send · Shift+Enter for new line</span>
            </div>
          </div>
        </form>
      </section>

      {/* Collapsible Right Panel: "What I did" */}
      {whatIDidOpen && (
        <aside
          aria-label="What I did panel"
          className="w-full lg:w-[310px] xl:w-[330px] shrink-0 lg:h-full card-surface rounded-[24px] p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto animate-view-enter"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[#EEF3EF] pb-3 shrink-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#137A55]" aria-hidden="true" />
              <h2 className="text-sm font-bold text-[#1C2B25]">What I did</h2>
            </div>
            <button
              type="button"
              onClick={() => setWhatIDidOpen(false)}
              aria-label="Collapse What I did panel"
              className="p-1.5 rounded-full text-[#6B7B73] hover:text-[#1C2B25] hover:bg-[#EEF3EF]"
            >
              <PanelRightClose className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {panelTools.length > 0 ? (
            <div className="space-y-2.5">
              {panelTools.map((tool) => {
                const meta = getFriendlyToolMeta(tool.toolName);
                const statusLabel = formatFriendlyToolStatus(tool.status);
                return (
                  <div
                    key={tool.id}
                    className="p-3.5 rounded-2xl bg-[#FAFBF9] border border-[#DCE8E0] space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#1C2B25] truncate">{meta.label}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold shrink-0 ${getToolStatusPillClasses(
                          tool.status
                        )}`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#43564D] leading-snug">{tool.description}</p>
                    <div className="text-[10px] font-mono text-[#6B7B73]">{tool.toolName}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl bg-[#FAFBF9] border border-dashed border-[#DCE8E0] p-4 space-y-1.5 text-xs">
              <div className="font-semibold text-[#1C2B25]">No checks run yet</div>
              <p className="text-[#6B7B73] leading-relaxed">
                Whenever you ask a question, each real lookup I run in your clinic records appears
                here in plain English.
              </p>
            </div>
          )}

          {turns.length > 0 && (
            <div className="pt-2 border-t border-[#EEF3EF] space-y-2 mt-auto">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7B73]">
                Try another question
              </div>
              <div className="space-y-1.5">
                {suggestionChips.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    disabled={loading}
                    onClick={() => submitPrompt(chip.label, chip.queryText)}
                    className="btn-press w-full text-left px-3 py-2 text-xs font-semibold text-[#1C2B25] hover:text-[#0F3D2E] bg-[#FAFBF9] hover:bg-[#E3F7EF]/60 border border-[#DCE8E0]/80 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{chip.label}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#137A55] shrink-0" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
