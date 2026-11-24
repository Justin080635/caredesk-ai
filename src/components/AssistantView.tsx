import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  Info,
  Loader2,
  RotateCcw,
  Send,
  ShieldAlert,
  Square,
  Wrench,
} from 'lucide-react';
import {
  confirmAssistantAction,
  fetchDailyReport,
  fetchOverviewReport,
  streamAssistantQuery,
} from '../client/api';
import type {
  Appointment,
  AssistantResponse,
  AvailableSlot,
  DailyReport,
  FollowUpTask,
  OverviewReport,
} from '../shared/types';
import type { DashboardFilteredTarget } from './DashboardView';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AppointmentStatusText, PriorityText } from './StatusText';

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

const PROMPT_GROUPS = [
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
    label: 'Outreach & Scheduling Actions',
    prompts: [
      'Prepare an administrative follow-up list.',
      'Find available appointment slots.',
      'Show patient P-1042.',
      'Reschedule patient P-1042.',
    ],
  },
];

function getTimeGreeting(): string {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  return 'Good evening';
}

interface AssistantViewProps {
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  onNavigateToFiltered?: (target: DashboardFilteredTarget) => void;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
}

export function AssistantView({
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
  const [streamPhase, setStreamPhase] = useState<string>('Preparing administrative query...');
  const [liveTools, setLiveTools] = useState<LiveToolStep[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmErrorByTurn, setConfirmErrorByTurn] = useState<Record<string, string>>({});
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [expandedTraceIds, setExpandedTraceIds] = useState<Set<string>>(new Set());
  const [clinicBrief, setClinicBrief] = useState<{
    daily: DailyReport | null;
    overview: OverviewReport | null;
  }>({ daily: null, overview: null });

  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const turnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const consumedPromptRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchDailyReport(), fetchOverviewReport()])
      .then(([daily, overview]) => {
        if (active) setClinicBrief({ daily, overview });
      })
      .catch(() => {
        // Non-blocking context enrichment; welcome prompt actions still work directly.
      });
    return () => {
      active = false;
    };
  }, []);

  // Auto-size multiline composer cleanly between 42px and 140px
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, Math.max(42, el.scrollHeight))}px`;
  }, [input]);

  const prevTurnCountRef = useRef(0);

  // Smart scroll: reveal newly completed turns and keep active stream visible
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
      setStreamPhase('Interpreting administrative request...');
      setLiveTools([]);
      setStreamingText('');

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await streamAssistantQuery(trimmed, {
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
    [loading, onErrorNotice]
  );

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

  const toggleTrace = (turnId: string) => {
    setExpandedTraceIds((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  };

  const scrollToTurn = (turnId: string) => {
    turnRefs.current[turnId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const conversationHistory = turns.reduce<
    Array<{ id: string; prompt: string; timestamp: string; headline?: string }>
  >((acc, turn, index) => {
    if (turn.role === 'user') {
      const nextTurn = turns[index + 1];
      acc.push({
        id: turn.id,
        prompt: turn.text,
        timestamp: turn.timestamp,
        headline:
          nextTurn?.role === 'assistant'
            ? nextTurn.response?.headline
            : nextTurn?.role === 'error'
              ? nextTurn.cancelled
                ? 'Cancelled'
                : 'Request failed'
              : undefined,
      });
    }
    return acc;
  }, []);

  const welcomeCards = [
    {
      title: "Give me today's clinic briefing.",
      subtitle: clinicBrief.daily
        ? `${clinicBrief.daily.totalAppointments} scheduled visits on ${clinicBrief.daily.date}`
        : 'Structured 5-part overview & operational alerts',
    },
    {
      title: 'Show pending appointments.',
      subtitle: clinicBrief.daily
        ? `${clinicBrief.daily.unconfirmedAppointments} awaiting patient confirmation`
        : 'Inspect Scheduled visits needing outreach',
    },
    {
      title: 'Identify overdue follow-ups.',
      subtitle: clinicBrief.overview
        ? `${clinicBrief.overview.pendingFollowUpsCount} open · ${clinicBrief.overview.overdueFollowUpsCount} overdue`
        : 'Audit pending administrative follow-up queue',
    },
    {
      title: 'Find available appointment slots.',
      subtitle: 'Search conflict-free 30-minute clinician openings',
    },
  ];

  const lastTurnId = turns[turns.length - 1]?.id;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left Rail: Integration Status, Prompt Library, Session History & Guardrails */}
      <aside className="xl:col-span-4 space-y-5">
        <div className="bg-[#0B261C] text-white rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
            <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Local REST Adapter · Synapse MCP Ready</span>
          </div>
          <p className="text-xs text-emerald-100/80 leading-relaxed">
            Every query executes live SQLite queries through CareDesk&apos;s REST adapter. Synapse CLI MCP tools are <strong className="text-white">not yet connected</strong>; real tool calls and execution timings appear inline.
          </p>
        </div>

        <div className="card-surface rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-[#111C17]">
              Operational Prompt Library
            </h2>
            <p className="text-xs text-[#526259] mt-0.5">
              Run clinic briefings, queue audits, patient lookups, or confirmation-gated rescheduling.
            </p>
          </div>

          <div className="space-y-4">
            {PROMPT_GROUPS.map((group) => (
              <div key={group.label} className="space-y-2">
                <div className="text-[11px] font-semibold tracking-wide text-[#526259]">
                  {group.label}
                </div>
                <div className="space-y-1.5">
                  {group.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={loading}
                      onClick={() => submitPrompt(prompt)}
                      className="btn-press w-full text-left px-3.5 py-2 text-xs font-medium text-[#111C17] hover:text-[#0B261C] bg-[#F6F8F6] hover:bg-[#ECF4EF] rounded-lg transition-colors disabled:opacity-50 flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{prompt}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#526259] shrink-0" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {conversationHistory.length > 0 && (
          <div className="card-surface rounded-xl p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-[#111C17]">
                  Session History
                </h3>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-[#526259]">
                {conversationHistory.length} quer{conversationHistory.length === 1 ? 'y' : 'ies'}
              </span>
            </div>
            <div className="divide-y divide-[#EEF2EF] max-h-48 overflow-y-auto pr-1">
              {conversationHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToTurn(item.id)}
                  className="w-full text-left py-2 px-2 rounded-md hover:bg-[#F6F8F6] transition-colors"
                >
                  <div className="text-xs font-medium text-[#111C17] truncate">
                    {item.prompt}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[#526259] mt-0.5">
                    <span className="truncate">{item.headline ?? 'Running...'}</span>
                    <span className="font-mono tabular-nums shrink-0">{item.timestamp}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="card-surface rounded-xl p-5">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-[#526259] mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h3 className="text-xs font-semibold text-[#111C17]">
                Administrative Scope Guardrails
              </h3>
              <ul className="mt-2 space-y-1.5 text-xs text-[#526259]">
                <li>• Synthetic demonstration records only</li>
                <li>• Non-clinical operations only (no diagnosis or treatment guidance)</li>
                <li>• Explicit administrator approval required before modifying records</li>
              </ul>
            </div>
          </div>
        </div>
      </aside>

      {/* Right Workspace: Conversational Copilot */}
      <section
        aria-label="CareDesk AI Conversational Workspace"
        className="xl:col-span-8 card-surface rounded-xl flex flex-col min-h-[680px]"
      >
        <div className="px-6 py-4 border-b border-[#E3E8E4] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#0B261C] text-emerald-300 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#111C17] truncate">
                CareDesk Assistant
              </h2>
              <p className="text-xs text-[#526259] mt-0.5 truncate">
                Healthcare operations copilot · Live REST queries · Synapse MCP pending
              </p>
            </div>
          </div>
          {turns.length > 0 && (
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setTurns([]);
                setDismissedIds(new Set());
                setExpandedTraceIds(new Set());
                setConfirmErrorByTurn({});
              }}
              className="btn-press px-3 py-1.5 text-xs font-medium text-[#526259] hover:text-[#111C17] border border-[#E3E8E4] hover:bg-[#F6F8F6] rounded-lg whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              New Conversation
            </button>
          )}
        </div>

        {/* Conversation Feed */}
        <div
          ref={feedContainerRef}
          className="flex-1 px-5 sm:px-8 pt-6 pb-8 overflow-y-auto max-h-[650px]"
        >
          <div className="max-w-3xl mx-auto space-y-6">
            {turns.length === 0 ? (
              <div className="py-6 sm:py-10 space-y-6 animate-view-enter">
                <div className="space-y-2.5 max-w-xl">
                  <div className="text-xs font-medium text-[#047857]">
                    CareDesk Operations Copilot
                  </div>
                  <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-[#111C17] text-balance">
                    {getTimeGreeting()}. I&apos;m your CareDesk assistant.
                  </h3>
                  <p className="text-sm text-[#526259] leading-relaxed">
                    I can help you understand clinic operations, retrieve appointment information, organise follow-ups and complete approved administrative tasks.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {welcomeCards.map((card) => (
                    <button
                      key={card.title}
                      type="button"
                      disabled={loading}
                      onClick={() => submitPrompt(card.title)}
                      className="btn-press card-interactive text-left p-4 rounded-xl border border-[#E3E8E4] bg-[#F9FBFA] hover:bg-[#ECF4EF]/70 space-y-1.5 group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#111C17] group-hover:text-[#0B261C]">
                          {card.title}
                        </span>
                        <ArrowRight
                          className="w-3.5 h-3.5 text-[#047857] shrink-0 transition-transform group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </div>
                      <p className="text-xs text-[#526259]">{card.subtitle}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((turn) => {
                if (turn.role === 'user') {
                  return (
                    <div
                      key={turn.id}
                      ref={(el) => {
                        turnRefs.current[turn.id] = el;
                      }}
                      className="flex justify-end animate-view-enter"
                    >
                      <div className="max-w-xl bg-[#0B261C] text-white px-4 py-3 rounded-2xl rounded-br-sm text-sm space-y-1 shadow-xs">
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
                      ref={(el) => {
                        turnRefs.current[turn.id] = el;
                      }}
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-view-enter"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle
                          className="w-4 h-4 text-red-700 mt-0.5 shrink-0"
                          aria-hidden="true"
                        />
                        <div>
                          <div className="text-xs font-semibold text-red-950">
                            {turn.cancelled ? 'Request Stopped' : 'Assistant Request Failed'}
                          </div>
                          <p className="text-xs text-red-800 mt-0.5">{turn.text}</p>
                        </div>
                      </div>
                      {turn.failedPrompt && (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => submitPrompt(turn.failedPrompt!)}
                          className="btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-900 bg-white hover:bg-red-100 border border-red-200 rounded-lg shrink-0 self-start sm:self-auto"
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
                const isTraceOpen = expandedTraceIds.has(turn.id);
                const isLatestTurn = turn.id === lastTurnId;
                const activeSlotOverride = turn.selectedSlotOverride;
                const confirmErr = confirmErrorByTurn[turn.id];

                return (
                  <article
                    key={turn.id}
                    ref={(el) => {
                      turnRefs.current[turn.id] = el as HTMLDivElement | null;
                    }}
                    className="space-y-4 pb-6 border-b border-[#EEF2EF] last:border-b-0 animate-view-enter"
                  >
                    {/* Assistant Turn Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-6 h-6 rounded-md bg-[#ECF4EF] text-[#047857] flex items-center justify-center shrink-0">
                          <Bot className="w-3.5 h-3.5" aria-hidden="true" />
                        </span>
                        <h3 className="text-sm font-semibold text-[#111C17]">
                          {res?.headline ?? 'CareDesk Assistant'}
                        </h3>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#64746B]">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {turn.timestamp}
                        <span aria-hidden="true">·</span>
                        {res?.engine === 'gemini-streaming-rest'
                          ? 'Gemini Streaming · Local REST'
                          : 'Local REST Preview'}
                      </span>
                    </div>

                    {/* Primary Narrative (Markdown when provided, clean prose otherwise) */}
                    {res?.markdown ? (
                      <MarkdownRenderer content={res.markdown} />
                    ) : (
                      <p className="text-sm text-[#34433B] leading-relaxed">{turn.text}</p>
                    )}

                    {/* Structured Multi-Section Briefing (Overview, Summary, Tasks, Alerts, Next Actions) */}
                    {res?.sections && res.sections.length > 0 && (
                      <div className="space-y-3 pt-1">
                        {res.sections.map((sec) => (
                          <div key={sec.id} className="space-y-1">
                            <h4 className="text-xs font-semibold text-[#0B261C]">{sec.title}</h4>
                            {sec.body && (
                              <p className="text-sm text-[#34433B] leading-relaxed">{sec.body}</p>
                            )}
                            {sec.bullets && sec.bullets.length > 0 && (
                              <ul className="space-y-1 pl-4 list-disc text-xs sm:text-sm text-[#34433B]">
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

                    {/* Structured Data: Metrics Strip */}
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
                              className="bg-[#F6F8F6] border border-[#E3E8E4] rounded-lg px-3.5 py-2.5"
                            >
                              <div className="text-[11px] text-[#526259]">
                                {labelMap[key] ?? key.replace(/([A-Z])/g, ' $1').trim()}
                              </div>
                              <div className="text-base font-semibold font-mono tabular-nums text-[#0B261C] mt-0.5">
                                {val}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Structured Data: Patient Summary Card */}
                    {res?.structuredData?.type === 'patient_summary' &&
                      res.structuredData.patient && (
                        <div className="bg-[#F6F8F6] border border-[#E3E8E4] rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div>
                            <div className="text-[#526259]">Synthetic Patient</div>
                            <div className="font-semibold text-[#111C17] mt-0.5">
                              {res.structuredData.patient.fullName}
                            </div>
                            <div className="font-mono text-[#047857]">
                              {res.structuredData.patient.id}
                            </div>
                          </div>
                          <div>
                            <div className="text-[#526259]">DOB · Registered</div>
                            <div className="font-mono text-[#111C17] mt-0.5">
                              {res.structuredData.patient.dateOfBirth}
                            </div>
                            <div className="font-mono text-[#526259]">
                              Since {res.structuredData.patient.registrationDate}
                            </div>
                          </div>
                          <div>
                            <div className="text-[#526259]">Administrative Status</div>
                            <div className="font-medium text-[#111C17] mt-0.5">
                              {res.structuredData.patient.administrativeStatus}
                            </div>
                            <div className="text-[#526259] truncate">
                              {res.structuredData.patient.email}
                            </div>
                          </div>
                        </div>
                      )}

                    {/* Structured Data: Appointment Table */}
                    {res?.structuredData?.items &&
                      res.structuredData.items.length > 0 &&
                      (res.structuredData.type === 'daily_briefing' ||
                        res.structuredData.type === 'unconfirmed_appointments' ||
                        res.structuredData.type === 'missed_appointments' ||
                        res.structuredData.type === 'followup_plan' ||
                        res.structuredData.type === 'patient_summary') && (
                        <div className="overflow-x-auto bg-white border border-[#E3E8E4] rounded-lg">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-[#F6F8F6] border-b border-[#E3E8E4] text-[#526259]">
                                <th className="py-2 px-3">Appt ID</th>
                                <th className="py-2 px-3">Patient</th>
                                <th className="py-2 px-3">Date &amp; Time</th>
                                <th className="py-2 px-3">Department · Clinician</th>
                                <th className="py-2 px-3">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#EEF2EF]">
                              {(
                                res.structuredData.items as Array<
                                  Appointment & { hasOpenFollowUp?: boolean }
                                >
                              ).map((item) => (
                                <tr key={item.id} className="hover:bg-[#F9FBFA]">
                                  <td className="py-2 px-3 font-mono font-medium text-[#111C17] whitespace-nowrap">
                                    {item.id}
                                  </td>
                                  <td className="py-2 px-3">
                                    <span className="font-medium text-[#111C17]">
                                      {item.patientName ?? res.structuredData?.patient?.fullName}
                                    </span>
                                    <span className="text-[#526259] font-mono whitespace-nowrap">
                                      {' '}
                                      · {item.patientId}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 font-mono tabular-nums text-[#34433B] whitespace-nowrap">
                                    {item.appointmentDate} {item.appointmentTime}
                                  </td>
                                  <td className="py-2 px-3 text-[#526259]">
                                    {item.department} · {item.clinician}
                                  </td>
                                  <td className="py-2 px-3">
                                    <AppointmentStatusText status={item.status} />
                                    {typeof item.hasOpenFollowUp === 'boolean' && (
                                      <span className="block text-[11px] text-[#526259] mt-0.5">
                                        {item.hasOpenFollowUp
                                          ? 'Follow-up task active'
                                          : 'Needs follow-up task'}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                    {/* Structured Data: Follow-up Queue Table */}
                    {res?.structuredData?.items &&
                      res.structuredData.items.length > 0 &&
                      res.structuredData.type === 'followup_queue' && (
                        <div className="overflow-x-auto bg-white border border-[#E3E8E4] rounded-lg">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-[#F6F8F6] border-b border-[#E3E8E4] text-[#526259]">
                                <th className="py-2 px-3">Task</th>
                                <th className="py-2 px-3">Patient</th>
                                <th className="py-2 px-3">Outreach Description</th>
                                <th className="py-2 px-3">Due</th>
                                <th className="py-2 px-3">Priority</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#EEF2EF]">
                              {(res.structuredData.items as FollowUpTask[]).map((task) => (
                                <tr key={task.id} className="hover:bg-[#F9FBFA]">
                                  <td className="py-2 px-3 font-mono font-medium text-[#111C17] whitespace-nowrap">
                                    {task.id}
                                  </td>
                                  <td className="py-2 px-3 whitespace-nowrap">
                                    <span className="font-medium text-[#111C17]">
                                      {task.patientName ?? task.patientId}
                                    </span>
                                    <span className="text-[#526259] font-mono">
                                      {' '}
                                      · {task.patientId}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-[#34433B]">{task.description}</td>
                                  <td className="py-2 px-3 font-mono tabular-nums text-[#34433B] whitespace-nowrap">
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

                    {/* Structured Data: Available Slots */}
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
                                className={`btn-press text-left rounded-lg px-3.5 py-2.5 flex items-center justify-between text-xs border transition-colors ${
                                  isSelectedSlot
                                    ? 'bg-[#ECF4EF] border-[#059669]'
                                    : 'bg-white border-[#E3E8E4] hover:bg-[#F6F8F6]'
                                }`}
                              >
                                <div>
                                  <div className="font-mono tabular-nums font-semibold text-[#111C17]">
                                    {slot.date} · {slot.time}
                                  </div>
                                  <div className="text-[#526259] mt-0.5">
                                    {slot.department} · {slot.clinician}
                                  </div>
                                </div>
                                <span className="text-[11px] font-medium text-[#047857]">
                                  {isSelectedSlot ? 'Selected' : 'Select'}
                                </span>
                              </button>
                            ) : (
                              <div
                                key={`${slot.date}-${slot.time}-${slot.clinician}-${idx}`}
                                className="bg-[#F9FBFA] border border-[#E3E8E4] rounded-lg px-3.5 py-2.5 flex items-center justify-between text-xs"
                              >
                                <div>
                                  <div className="font-mono tabular-nums font-semibold text-[#111C17]">
                                    {slot.date} · {slot.time}
                                  </div>
                                  <div className="text-[#526259] mt-0.5">
                                    {slot.department} · {slot.clinician}
                                  </div>
                                </div>
                                <span className="text-[11px] font-medium text-[#047857]">
                                  Open
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                    {/* Integrated Human Approval Card for Mutations */}
                    {pending && !isConfirmed && !isDismissed && (
                      <div className="bg-[#F9FBFA] border border-amber-300 rounded-xl p-4 space-y-3">
                        <div className="flex items-start gap-2.5">
                          <AlertCircle
                            className="w-4 h-4 text-amber-700 mt-0.5 shrink-0"
                            aria-hidden="true"
                          />
                          <div>
                            <h4 className="text-sm font-semibold text-[#111C17]">
                              {pending.title}
                            </h4>
                            <p className="text-xs text-[#526259] mt-1">
                              {activeSlotOverride && pending.actionType === 'reschedule_appointment'
                                ? `Move appointment to ${activeSlotOverride.date} at ${activeSlotOverride.time} (${activeSlotOverride.clinician}) and set status to Scheduled.`
                                : pending.summary}
                            </p>
                          </div>
                        </div>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs bg-white border border-[#E3E8E4] rounded-lg p-3">
                          {Object.entries(pending.details).map(([k, v]) => {
                            const displayValue =
                              k === 'Proposed Slot' && activeSlotOverride
                                ? `${activeSlotOverride.date} ${activeSlotOverride.time}`
                                : k === 'Clinician' && activeSlotOverride
                                  ? activeSlotOverride.clinician
                                  : String(v ?? '—');
                            return (
                              <div key={k}>
                                <dt className="text-[#526259]">{k}</dt>
                                <dd className="font-medium font-mono text-[#111C17] mt-0.5">
                                  {displayValue}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>

                        {confirmErr && (
                          <div
                            role="alert"
                            className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                          >
                            {confirmErr}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2.5 pt-1">
                          <button
                            type="button"
                            disabled={confirmingId === pending.confirmationId}
                            onClick={() => handleConfirm(turn)}
                            className="btn-press px-4 py-2 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors disabled:opacity-50"
                          >
                            {confirmingId === pending.confirmationId
                              ? 'Applying & Verifying...'
                              : 'Confirm & Apply Change'}
                          </button>
                          <button
                            type="button"
                            disabled={confirmingId === pending.confirmationId}
                            onClick={() => handleDismiss(pending.confirmationId)}
                            className="btn-press px-4 py-2 text-xs font-medium text-[#526058] hover:text-[#16211C] bg-white border border-[#E4E7E2] rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {isConfirmed && (
                      <div className="flex items-center gap-2 text-xs font-medium text-[#047857]">
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        Administrator confirmed and verified record update.
                      </div>
                    )}

                    {isDismissed && (
                      <div className="text-xs text-[#526058]">
                        Action cancelled by administrator. No database records were changed.
                      </div>
                    )}

                    {/* Collapsible Synapse MCP / Tool Execution Trace */}
                    {res?.plannedTools && res.plannedTools.length > 0 && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => toggleTrace(turn.id)}
                          aria-expanded={isTraceOpen}
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#526259] hover:text-[#111C17] py-1 transition-colors"
                        >
                          {isTraceOpen ? (
                            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <Wrench className="w-3 h-3 text-[#047857]" aria-hidden="true" />
                          <span>
                            Tool Execution ({res.plannedTools.length} step
                            {res.plannedTools.length === 1 ? '' : 's'} via Local REST · Synapse MCP target)
                          </span>
                        </button>
                        {isTraceOpen && (
                          <div className="mt-2 bg-[#F6F8F6] border border-[#E3E8E4] rounded-lg p-3 space-y-2 animate-view-enter">
                            {res.plannedTools.map((tool, i) => (
                              <div
                                key={`${tool.toolName}-${i}`}
                                className="text-[11px] font-mono text-[#526259] flex flex-col gap-0.5 border-b border-[#E3E8E4] last:border-b-0 pb-1.5 last:pb-0"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[#111C17] font-semibold">
                                    {tool.toolName}{' '}
                                    <span className="font-normal text-[#526259]">
                                      ({tool.endpoint})
                                    </span>
                                  </span>
                                  <span
                                    className={
                                      tool.status === 'executed-via-local-rest'
                                        ? 'text-[#047857] font-medium'
                                        : tool.status === 'awaiting-confirmation'
                                          ? 'text-amber-700 font-medium'
                                          : 'text-[#DC2626] font-medium'
                                    }
                                  >
                                    {tool.status}
                                    {typeof tool.durationMs === 'number'
                                      ? ` · ${tool.durationMs}ms`
                                      : ''}
                                  </span>
                                </div>
                                {tool.resultSummary && (
                                  <div className="text-[#34433B] font-sans">
                                    {tool.resultSummary}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Contextual Follow-up Suggestions & Deep-Link Workspace Actions */}
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
                              className="btn-press px-3 py-1.5 text-xs font-medium text-[#0B261C] bg-[#ECF4EF] hover:bg-[#DCECE3] border border-[#C6DFD1] rounded-lg transition-colors"
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
                                className="btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#34433B] bg-white hover:bg-[#F6F8F6] border border-[#E3E8E4] rounded-lg transition-colors"
                              >
                                <Calendar className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
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
                                className="btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#34433B] bg-white hover:bg-[#F6F8F6] border border-[#E3E8E4] rounded-lg transition-colors"
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

            {/* Live Thinking & Real Tool Execution Progress */}
            {loading && (
              <div
                className="rounded-xl border border-[#D4E4DA] bg-[#F6F8F6] p-4 space-y-3 animate-view-enter"
                aria-live="polite"
                aria-label="Assistant live execution status"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-[#0B261C]">
                  <Loader2 className="w-4 h-4 text-[#059669] animate-spin shrink-0" aria-hidden="true" />
                  <span>{streamPhase}</span>
                </div>

                {liveTools.length > 0 && (
                  <div className="space-y-1.5 pl-6">
                    {liveTools.map((tool) => (
                      <div
                        key={tool.toolCallId}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 text-[#34433B] min-w-0">
                          {tool.status === 'running' ? (
                            <span
                              className="w-2 h-2 rounded-full bg-[#059669] animate-pulse shrink-0"
                              aria-hidden="true"
                            />
                          ) : tool.status === 'failed' ? (
                            <AlertCircle
                              className="w-3.5 h-3.5 text-red-600 shrink-0"
                              aria-hidden="true"
                            />
                          ) : (
                            <CheckCircle2
                              className="w-3.5 h-3.5 text-[#047857] shrink-0"
                              aria-hidden="true"
                            />
                          )}
                          <span className="truncate">{tool.description}</span>
                        </div>
                        <span className="font-mono text-[11px] text-[#64746B] shrink-0">
                          {tool.toolName}
                          {typeof tool.durationMs === 'number' ? ` · ${tool.durationMs}ms` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {streamingText && (
                  <div className="pt-2 border-t border-[#E3E8E4]">
                    <MarkdownRenderer content={streamingText} />
                  </div>
                )}
              </div>
            )}

            <div ref={feedEndRef} />
          </div>
        </div>

        {/* Multiline Expanding Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (loading) {
              handleStopGeneration();
            } else {
              submitPrompt(input);
            }
          }}
          className="p-4 border-t border-[#E3E8E4] bg-[#F7F8F6]/65 rounded-b-xl"
        >
          <div className="max-w-3xl mx-auto space-y-1.5">
            <div className="flex items-end gap-2.5 bg-white border border-[#D4DDD6] focus-within:border-[#059669] focus-within:ring-2 focus-within:ring-[#059669]/20 rounded-xl p-2 transition-all">
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
                placeholder="Ask for today's briefing, pending appointments, overdue follow-ups, or reschedule P-1042..."
                className="flex-1 resize-none px-2.5 py-2 text-sm bg-transparent border-0 focus:outline-none leading-relaxed max-h-[140px]"
              />
              {loading ? (
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  className="btn-press inline-flex items-center gap-1.5 px-3.5 py-2.5 min-h-[40px] text-xs sm:text-sm font-medium text-[#111C17] bg-[#F1F5F2] hover:bg-[#E3E8E4] rounded-lg transition-colors whitespace-nowrap shrink-0"
                  aria-label="Stop assistant response"
                >
                  <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="btn-press inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[40px] text-xs sm:text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors disabled:opacity-45 whitespace-nowrap shrink-0"
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                  Send
                </button>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#64746B] px-1">
              <span>Press Enter to send · Shift+Enter for new line</span>
              <span>Non-clinical administrative queries only</span>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
