import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  History,
  Info,
  Loader2,
  Send,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { confirmAssistantAction, sendAssistantQuery } from '../client/api';
import type {
  Appointment,
  AssistantResponse,
  AvailableSlot,
} from '../shared/types';
import { AppointmentStatusText } from './StatusText';

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  response?: AssistantResponse;
  confirmedActionId?: string;
}

const EXAMPLE_PROMPTS = [
  "Give me today's clinic briefing.",
  'Which appointments are still unconfirmed?',
  'Identify patients who missed appointments during the last seven days.',
  'Prepare an administrative follow-up list.',
  'Find the next available appointment slot.',
  'Reschedule patient P-1042.',
];

interface AssistantViewProps {
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
}

export function AssistantView({
  onDataMutated,
  onErrorNotice,
  onSuccessNotice,
}: AssistantViewProps) {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const turnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [turns, loading]);

  const formatTimeNow = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const submitPrompt = async (promptText: string) => {
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

    try {
      const response = await sendAssistantQuery(trimmed);
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
      onErrorNotice(
        err instanceof Error ? err.message : 'Unable to reach CareDesk Assistant.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (turn: ChatTurn) => {
    const pending = turn.response?.pendingConfirmation;
    if (!pending) return;

    setConfirmingId(pending.confirmationId);
    try {
      const result = await confirmAssistantAction({
        actionType: pending.actionType,
        payload: pending.payload,
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
      onErrorNotice(
        err instanceof Error ? err.message : 'Unable to execute confirmed action.'
      );
    } finally {
      setConfirmingId(null);
    }
  };

  const handleDismiss = (confirmationId: string) => {
    setDismissedIds((prev) => new Set(prev).add(confirmationId));
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
        headline: nextTurn?.role === 'assistant' ? nextTurn.response?.headline : undefined,
      });
    }
    return acc;
  }, []);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left Pane: Suggested Prompts, Conversation History & Architecture Guardrails */}
      <aside className="xl:col-span-4 space-y-5">
        <div className="bg-white border border-[#E4E7E2] rounded-xl p-5">
          <div className="flex items-start gap-2.5">
            <Info className="w-4 h-4 text-[#047857] mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-[#16211C]">
                Local REST Preview · Synapse MCP Ready
              </h2>
              <p className="text-xs text-[#526058] mt-1.5 leading-relaxed">
                CareDesk Assistant runs isolated from the UI and queries CareDesk&apos;s SQLite REST backend. Synapse CLI MCP tools are <strong>not yet connected</strong>; planned MCP tool contracts appear on every response.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#E4E7E2] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#16211C] mb-1">
            Suggested Operational Queries
          </h3>
          <p className="text-xs text-[#526058] mb-3.5">
            Run live clinic briefings, queue audits, slot lookups, or confirmation-gated rescheduling.
          </p>
          <div className="space-y-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={loading}
                onClick={() => submitPrompt(prompt)}
                className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-[#16211C] hover:text-[#0C291E] bg-[#F7F8F6] hover:bg-[#EDF4F0] border border-[#E4E7E2] hover:border-[#A7F3D0] rounded-lg transition-colors disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {conversationHistory.length > 0 && (
          <div className="bg-white border border-[#E4E7E2] rounded-xl p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-[#16211C]">
                  Session History
                </h3>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-[#526058]">
                {conversationHistory.length} queries
              </span>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {conversationHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToTurn(item.id)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-[#E4E7E2] hover:bg-[#F7F8F6] transition-colors"
                >
                  <div className="text-xs font-medium text-[#16211C] truncate">
                    {item.prompt}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[#526058] mt-0.5">
                    <span className="truncate">{item.headline ?? 'Processing...'}</span>
                    <span className="font-mono tabular-nums shrink-0">{item.timestamp}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white border border-[#E4E7E2] rounded-xl p-5">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-[#526058] mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h3 className="text-xs font-semibold text-[#16211C]">
                Administrative Scope Guardrails
              </h3>
              <ul className="mt-2 space-y-1.5 text-xs text-[#526058]">
                <li>• Synthetic demonstration records only</li>
                <li>• Non-clinical operations only (no diagnosis or treatment guidance)</li>
                <li>• Explicit administrator confirmation required before record changes</li>
              </ul>
            </div>
          </div>
        </div>
      </aside>

      {/* Right Pane: Conversational Copilot Workspace */}
      <section className="xl:col-span-8 bg-white border border-[#E4E7E2] rounded-xl flex flex-col min-h-[640px]">
        <div className="px-6 py-4 border-b border-[#E4E7E2] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#0C291E] text-emerald-300 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#16211C]">CareDesk Assistant</h2>
              <p className="text-xs text-[#526058] mt-0.5">
                Conversational clinic operations copilot · Synapse MCP integration pending
              </p>
            </div>
          </div>
          {turns.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setTurns([]);
                setDismissedIds(new Set());
              }}
              className="px-3 py-1.5 text-xs font-medium text-[#526058] hover:text-[#16211C] border border-[#E4E7E2] hover:bg-[#F7F8F6] rounded-lg whitespace-nowrap shrink-0 transition-colors"
            >
              Clear Session
            </button>
          )}
        </div>

        {/* Message Feed */}
        <div className="flex-1 p-6 space-y-5 overflow-y-auto max-h-[650px]">
          {turns.length === 0 ? (
            <div className="py-14 text-center max-w-md mx-auto">
              <div className="w-11 h-11 rounded-xl bg-[#EDF4F0] text-[#047857] flex items-center justify-center mx-auto mb-3">
                <Bot className="w-5 h-5" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-[#16211C]">
                Ask about today&apos;s briefing, missed visits, or open slots
              </h3>
              <p className="text-sm text-[#526058] mt-2 leading-relaxed">
                Select one of the operational queries on the left or type a question below. Record mutations always pause for your explicit confirmation preview.
              </p>
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
                    className="flex justify-end"
                  >
                    <div className="max-w-xl bg-[#0C291E] text-white px-4 py-3 rounded-xl text-sm space-y-1">
                      <div>{turn.text}</div>
                      <div className="text-[10px] font-mono text-emerald-200/80 text-right">
                        {turn.timestamp}
                      </div>
                    </div>
                  </div>
                );
              }

              const res = turn.response;
              const pending = res?.pendingConfirmation;
              const isConfirmed =
                pending && turn.confirmedActionId === pending.confirmationId;
              const isDismissed =
                pending && dismissedIds.has(pending.confirmationId);

              return (
                <div
                  key={turn.id}
                  ref={(el) => {
                    turnRefs.current[turn.id] = el;
                  }}
                  className="space-y-3"
                >
                  <div className="bg-[#F7F8F6] border border-[#E4E7E2] rounded-xl p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[#16211C]">
                        {res?.headline ?? 'CareDesk Assistant'}
                      </h3>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#526058]">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {turn.timestamp} · Local REST Preview (MCP Not Connected)
                      </span>
                    </div>

                    <p className="text-sm text-[#2E3C34] leading-relaxed">{turn.text}</p>

                    {/* Structured Data: Metrics Grid */}
                    {res?.structuredData?.metrics && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                        {Object.entries(res.structuredData.metrics).map(([key, val]) => {
                          const labelMap: Record<string, string> = {
                            totalToday: 'Total Today',
                            confirmed: 'Confirmed',
                            unconfirmed: 'Unconfirmed',
                            missedToday: 'Missed Today',
                            pendingFollowUps: 'Pending Follow-ups',
                            missedLast7Days: 'Missed (Last 7 Days)',
                            totalMissed: 'Total Missed (7d)',
                            alreadyTracked: 'Already Tracked',
                            needingTask: 'Needs Follow-up',
                          };
                          return (
                            <div
                              key={key}
                              className="bg-white border border-[#E4E7E2] rounded-lg px-3.5 py-2.5"
                            >
                              <div className="text-[11px] text-[#526058]">
                                {labelMap[key] ?? key.replace(/([A-Z])/g, ' $1').trim()}
                              </div>
                              <div className="text-base font-semibold font-mono tabular-nums text-[#0C291E] mt-0.5">
                                {val}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Structured Data: Appointment Lists */}
                    {res?.structuredData?.items &&
                      res.structuredData.items.length > 0 &&
                      (res.structuredData.type === 'daily_briefing' ||
                        res.structuredData.type === 'unconfirmed_appointments' ||
                        res.structuredData.type === 'missed_appointments' ||
                        res.structuredData.type === 'followup_plan') && (
                        <div className="overflow-x-auto bg-white border border-[#E4E7E2] rounded-lg">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-[#E4E7E2] bg-[#F7F8F6] text-[#526058]">
                                <th className="py-2 px-3">Appt ID</th>
                                <th className="py-2 px-3">Patient</th>
                                <th className="py-2 px-3">Date &amp; Time</th>
                                <th className="py-2 px-3">Department · Clinician</th>
                                <th className="py-2 px-3">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E4E7E2]">
                              {(
                                res.structuredData.items as Array<
                                  Appointment & { hasOpenFollowUp?: boolean }
                                >
                              ).map((item) => (
                                <tr key={item.id}>
                                  <td className="py-2 px-3 font-mono font-medium text-[#16211C] whitespace-nowrap">
                                    {item.id}
                                  </td>
                                  <td className="py-2 px-3">
                                    <span className="font-medium text-[#16211C]">
                                      {item.patientName}
                                    </span>
                                    <span className="text-[#526058] font-mono">
                                      {' '}
                                      · {item.patientId}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 font-mono tabular-nums text-[#2E3C34] whitespace-nowrap">
                                    {item.appointmentDate} {item.appointmentTime}
                                  </td>
                                  <td className="py-2 px-3 text-[#526058]">
                                    {item.department} · {item.clinician}
                                  </td>
                                  <td className="py-2 px-3">
                                    <AppointmentStatusText status={item.status} />
                                    {typeof item.hasOpenFollowUp === 'boolean' && (
                                      <span className="block text-[11px] text-[#526058] mt-0.5">
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

                    {/* Structured Data: Available Slots */}
                    {res?.structuredData?.items &&
                      res.structuredData.items.length > 0 &&
                      (res.structuredData.type === 'available_slots' ||
                        res.structuredData.type === 'reschedule_proposal') && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {(res.structuredData.items as AvailableSlot[]).map((slot, idx) => (
                            <div
                              key={`${slot.date}-${slot.time}-${slot.clinician}-${idx}`}
                              className="bg-white border border-[#E4E7E2] rounded-lg px-3.5 py-2.5 flex items-center justify-between text-xs"
                            >
                              <div>
                                <div className="font-mono tabular-nums font-semibold text-[#16211C]">
                                  {slot.date} · {slot.time}
                                </div>
                                <div className="text-[#526058] mt-0.5">
                                  {slot.department} · {slot.clinician}
                                </div>
                              </div>
                              <span className="text-[11px] font-medium text-[#047857]">
                                Open
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                    {/* Confirmation Gate for Record Mutations */}
                    {pending && !isConfirmed && !isDismissed && (
                      <div className="bg-white border border-amber-300 rounded-xl p-4 space-y-3">
                        <div className="flex items-start gap-2.5">
                          <AlertCircle
                            className="w-4 h-4 text-amber-700 mt-0.5 shrink-0"
                            aria-hidden="true"
                          />
                          <div>
                            <h4 className="text-sm font-semibold text-[#16211C]">
                              {pending.title}
                            </h4>
                            <p className="text-xs text-[#526058] mt-1">{pending.summary}</p>
                          </div>
                        </div>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs bg-[#F7F8F6] rounded-lg p-3 border border-[#E4E7E2]">
                          {Object.entries(pending.details).map(([k, v]) => (
                            <div key={k}>
                              <dt className="text-[#526058]">{k}</dt>
                              <dd className="font-medium font-mono text-[#16211C] mt-0.5">
                                {String(v ?? '—')}
                              </dd>
                            </div>
                          ))}
                        </dl>
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <button
                            type="button"
                            disabled={confirmingId === pending.confirmationId}
                            onClick={() => handleConfirm(turn)}
                            className="px-4 py-2 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors disabled:opacity-50"
                          >
                            {confirmingId === pending.confirmationId
                              ? 'Applying Update...'
                              : 'Confirm & Apply Change'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDismiss(pending.confirmationId)}
                            className="px-4 py-2 text-xs font-medium text-[#526058] hover:text-[#16211C] border border-[#E4E7E2] rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {isConfirmed && (
                      <div className="flex items-center gap-2 text-xs font-medium text-[#047857]">
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        Administrator confirmed and applied this update.
                      </div>
                    )}

                    {isDismissed && (
                      <div className="text-xs text-[#526058]">
                        Action cancelled by administrator. No database records were changed.
                      </div>
                    )}

                    {/* Transparent Adapter / Planned Tool Trace */}
                    {res?.plannedTools && res.plannedTools.length > 0 && (
                      <div className="pt-2.5 border-t border-[#E4E7E2]">
                        <div className="text-[11px] font-medium text-[#526058] mb-1.5 flex items-center gap-1.5">
                          <Wrench className="w-3 h-3 text-[#047857]" aria-hidden="true" />
                          Tool Execution Trace (Planned Synapse MCP Target vs. Local REST)
                        </div>
                        <div className="space-y-1">
                          {res.plannedTools.map((tool, i) => (
                            <div
                              key={`${tool.toolName}-${i}`}
                              className="text-[11px] font-mono text-[#526058] flex flex-wrap items-center gap-2"
                            >
                              <span className="text-[#16211C] font-medium">{tool.endpoint}</span>
                              <span aria-hidden="true">·</span>
                              <span>Planned MCP: {tool.toolName}</span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  tool.status === 'executed-via-local-rest'
                                    ? 'text-[#047857] font-medium'
                                    : tool.status === 'awaiting-confirmation'
                                      ? 'text-amber-700 font-medium'
                                      : 'text-[#526058]'
                                }
                              >
                                [{tool.status}]
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {loading && (
            <div className="bg-[#EDF4F0] border border-[#C6E6D5] rounded-xl p-4 flex items-center gap-2.5 text-xs text-[#0C291E]">
              <Loader2 className="w-4 h-4 text-[#047857] animate-spin" aria-hidden="true" />
              <span>Querying CareDesk operational tools via Local REST Adapter...</span>
            </div>
          )}
          <div ref={feedEndRef} />
        </div>

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitPrompt(input);
          }}
          className="p-4 border-t border-[#E4E7E2] flex items-center gap-3 bg-[#F7F8F6]/50 rounded-b-xl"
        >
          <label htmlFor="assistant-prompt-input" className="sr-only">
            Ask CareDesk Assistant
          </label>
          <input
            id="assistant-prompt-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask for today's briefing, unconfirmed visits, follow-up list, or reschedule P-1042..."
            className="flex-1 px-3.5 py-2.5 text-sm bg-white border border-[#D4DDD6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            Send
          </button>
        </form>
      </section>
    </div>
  );
}
