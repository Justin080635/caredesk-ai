import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Pencil, Plus, X } from 'lucide-react';
import {
  createFollowupRecord,
  fetchFollowups,
  fetchPatients,
  fetchStaff,
  updateFollowupRecord,
} from '../client/api';
import { FOLLOWUP_STATUSES, FOLLOWUP_TYPES } from '../shared/constants';
import type {
  FollowUpPriority,
  FollowUpStatus,
  FollowUpTask,
  FollowUpType,
  Patient,
  StaffMember,
} from '../shared/types';
import { ClinicEmptyIllustration, EditorialAvatar } from './ClinicIllustrations';
import { ModalShell } from './ModalShell';
import { FollowUpStatusText, PriorityText } from './StatusText';

interface FollowUpsViewProps {
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  openCreateSignal: number;
  initialViewMode?: 'pending' | 'overdue' | 'Completed' | 'all';
  onOpenPatient?: (patientId: string) => void;
  canManageFollowups?: boolean;
  compactDensity?: boolean;
}

const OPEN_FOLLOWUP_STATUSES = new Set<FollowUpStatus>([
  'Pending',
  'Scheduled',
  'Due',
  'Overdue',
]);

function isTaskOpen(task: FollowUpTask): boolean {
  return OPEN_FOLLOWUP_STATUSES.has(task.status);
}

function isTaskOverdue(task: FollowUpTask, todayKey: string): boolean {
  return task.status === 'Overdue' || (isTaskOpen(task) && task.dueDate < todayKey);
}

export function FollowUpsView({
  onDataMutated,
  onErrorNotice,
  onSuccessNotice,
  openCreateSignal,
  initialViewMode,
  onOpenPatient,
  canManageFollowups = true,
  compactDensity = false,
}: FollowUpsViewProps) {
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [allTasksSnapshot, setAllTasksSnapshot] = useState<FollowUpTask[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'pending' | 'overdue' | 'Completed' | 'all'>(
    initialViewMode ?? 'pending'
  );
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [patientId, setPatientId] = useState('P-1042');
  const [appointmentId, setAppointmentId] = useState('');
  const [followupType, setFollowupType] = useState<FollowUpType>('Administrative Contact');
  const [assignedStaffId, setAssignedStaffId] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState<FollowUpPriority>('High');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Edit Follow-up Modal State
  const [editingTask, setEditingTask] = useState<FollowUpTask | null>(null);
  const [editFollowupType, setEditFollowupType] = useState<FollowUpType>('Administrative Contact');
  const [editAssignedStaffId, setEditAssignedStaffId] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editCompletionNotes, setEditCompletionNotes] = useState('');
  const [editPriority, setEditPriority] = useState<FollowUpPriority>('Medium');
  const [editDueDate, setEditDueDate] = useState('');
  const [editStatus, setEditStatus] = useState<FollowUpStatus>('Pending');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  useEffect(() => {
    if (initialViewMode) {
      setViewMode(initialViewMode);
    }
  }, [initialViewMode]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const [taskList, allSnapshot, patientList, staffMembers] = await Promise.all([
        viewMode === 'pending' || viewMode === 'overdue'
          ? fetchFollowups({
              pendingOnly: true,
              followupType: typeFilter,
            })
          : fetchFollowups({
              status: viewMode === 'all' ? undefined : viewMode,
              priority: priorityFilter,
              followupType: typeFilter,
            }),
        fetchFollowups(),
        fetchPatients(),
        fetchStaff(),
      ]);

      let filtered = taskList;
      if (viewMode === 'overdue') {
        filtered = filtered.filter((t) => isTaskOverdue(t, todayKey));
      }
      if ((viewMode === 'pending' || viewMode === 'overdue') && priorityFilter !== 'All') {
        filtered = filtered.filter((t) => t.priority === priorityFilter);
      }
      if ((viewMode === 'pending' || viewMode === 'overdue') && typeFilter !== 'All') {
        filtered = filtered.filter((t) => (t.followupType ?? 'Administrative Contact') === typeFilter);
      }
      setTasks(filtered);
      setAllTasksSnapshot(allSnapshot);
      setPatients(patientList);
      setStaffList(staffMembers);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load follow-up tasks.');
    } finally {
      setLoading(false);
    }
  }, [viewMode, priorityFilter, typeFilter, todayKey, onErrorNotice]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (openCreateSignal > 0) {
      setFormError(null);
      setShowCreateModal(true);
    }
  }, [openCreateSignal]);

  const handleStatusChange = async (taskId: string, nextStatus: FollowUpStatus) => {
    setUpdatingTaskId(taskId);
    try {
      await updateFollowupRecord(taskId, { status: nextStatus });
      onSuccessNotice(`Updated follow-up ${taskId} to ${nextStatus}.`);
      await loadTasks();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to update follow-up task.');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const handleQuickPriorityChange = async (taskId: string, nextPriority: FollowUpPriority) => {
    setUpdatingTaskId(taskId);
    try {
      await updateFollowupRecord(taskId, { priority: nextPriority });
      onSuccessNotice(`Changed priority of ${taskId} to ${nextPriority}.`);
      await loadTasks();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to update follow-up priority.');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const openEditModal = (task: FollowUpTask) => {
    setEditingTask(task);
    setEditFollowupType(task.followupType ?? 'Administrative Contact');
    setEditAssignedStaffId(task.assignedStaffId ?? '');
    setEditDescription(task.description);
    setEditReason(task.reason ?? '');
    setEditCompletionNotes(task.completionNotes ?? '');
    setEditPriority(task.priority);
    setEditDueDate(task.dueDate);
    setEditStatus(task.status);
    setEditError(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask) return;
    if (editDescription.trim().length < 4) {
      setEditError('Follow-up description must be at least 4 characters.');
      return;
    }
    setEditError(null);
    setEditSubmitting(true);
    try {
      const assignedStaff = staffList.find((s) => s.id === editAssignedStaffId);
      const updated = await updateFollowupRecord(editingTask.id, {
        followupType: editFollowupType,
        assignedStaffId: editAssignedStaffId || null,
        assignedToName: assignedStaff?.fullName ?? undefined,
        description: editDescription.trim(),
        reason: editReason.trim(),
        completionNotes: editCompletionNotes.trim(),
        priority: editPriority,
        dueDate: editDueDate,
        status: editStatus,
      });
      setEditingTask(null);
      onSuccessNotice(
        `Saved follow-up ${updated.id} (${updated.priority} priority · ${updated.status} · due ${updated.dueDate}).`
      );
      await loadTasks();
      onDataMutated();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unable to save follow-up changes.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (description.trim().length < 4) {
      setFormError('Follow-up description must be at least 4 characters.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const assignedStaff = staffList.find((s) => s.id === assignedStaffId);
      const created = await createFollowupRecord({
        patientId,
        appointmentId: appointmentId.trim() || null,
        followupType,
        assignedStaffId: assignedStaffId || null,
        assignedToName: assignedStaff?.fullName ?? undefined,
        description: description.trim(),
        reason: reason.trim() || undefined,
        priority,
        dueDate,
      });
      setShowCreateModal(false);
      setDescription('');
      setReason('');
      setAppointmentId('');
      onSuccessNotice(`Created follow-up task ${created.id} for ${created.patientId}.`);
      await loadTasks();
      onDataMutated();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create follow-up task.');
    } finally {
      setSubmitting(false);
    }
  };

  const cellPad = compactDensity ? 'py-2 px-4' : 'py-3 px-4';

  const openQueueCount = allTasksSnapshot.filter((t) => isTaskOpen(t)).length;
  const overdueQueueCount = allTasksSnapshot.filter((t) => isTaskOverdue(t, todayKey)).length;
  const highPriorityOpenCount = allTasksSnapshot.filter(
    (t) => isTaskOpen(t) && t.priority === 'High'
  ).length;
  const completedCount = allTasksSnapshot.filter((t) => t.status === 'Completed').length;

  return (
    <div className="space-y-5">
      {/* Follow-up Queue Summary Bar */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => setViewMode('pending')}
          className="text-left bg-[#0B261C] hover:bg-[#12382A] text-white rounded-xl p-4 transition-colors btn-press"
        >
          <div className="text-xs font-medium text-emerald-200/85">Open Queue</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1.5">
            {openQueueCount}
          </div>
          <div className="text-[11px] text-emerald-100/75 mt-0.5">
            Pending, scheduled, due &amp; overdue
          </div>
        </button>

        <button
          type="button"
          onClick={() => setViewMode('overdue')}
          className="text-left card-surface card-interactive hover:border-[#059669] rounded-xl p-4 transition-colors btn-press"
        >
          <div className="text-xs font-medium text-[#526259]">Overdue Tasks</div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-1.5 ${
              overdueQueueCount > 0 ? 'text-[#DC2626]' : 'text-[#047857]'
            }`}
          >
            {overdueQueueCount}
          </div>
          <div className="text-[11px] text-[#526259] mt-0.5">Past target due date</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode('pending');
            setPriorityFilter('High');
          }}
          className="text-left card-surface card-interactive hover:border-[#059669] rounded-xl p-4 transition-colors btn-press"
        >
          <div className="text-xs font-medium text-[#526259]">High Priority Open</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1.5">
            {highPriorityOpenCount}
          </div>
          <div className="text-[11px] text-[#526259] mt-0.5">Urgent administrative outreach</div>
        </button>

        <button
          type="button"
          onClick={() => setViewMode('Completed')}
          className="text-left card-surface card-interactive hover:border-[#059669] rounded-xl p-4 transition-colors btn-press"
        >
          <div className="text-xs font-medium text-[#526259]">Completed</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#047857] mt-1.5">
            {completedCount}
          </div>
          <div className="text-[11px] text-[#526259] mt-0.5">Resolved follow-up items</div>
        </button>
      </section>

      {/* Toolbar */}
      <div className="card-surface rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-1 p-1 bg-[#F1F5F2] rounded-lg overflow-x-auto"
            role="group"
            aria-label="Filter follow-ups by queue view"
          >
            {[
              { id: 'pending', label: 'Pending Queue' },
              { id: 'overdue', label: 'Overdue' },
              { id: 'Completed', label: 'Completed' },
              { id: 'all', label: 'All Tasks' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewMode(tab.id as typeof viewMode)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === tab.id
                    ? 'bg-white text-[#0B261C] shadow-xs'
                    : 'text-[#526259] hover:text-[#111C17]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="fu-priority-filter" className="sr-only">
              Filter by priority
            </label>
            <select
              id="fu-priority-filter"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="px-3 py-2 text-xs font-medium border border-[#D4DAD4] rounded-lg bg-white"
            >
              <option value="All">All Priorities</option>
              <option value="High">High Priority</option>
              <option value="Medium">Medium Priority</option>
              <option value="Low">Low Priority</option>
            </select>
          </div>

          <div>
            <label htmlFor="fu-type-filter" className="sr-only">
              Filter by type
            </label>
            <select
              id="fu-type-filter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 text-xs font-medium border border-[#D4DAD4] rounded-lg bg-white"
            >
              <option value="All">All Types</option>
              {FOLLOWUP_TYPES.map((ft) => (
                <option key={ft} value={ft}>
                  {ft}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canManageFollowups && (
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors whitespace-nowrap shrink-0 btn-press"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            New Follow-up
          </button>
        )}
      </div>

      {/* Follow-up Table */}
      <div className="card-surface rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E3E8E4] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#111C17]">Administrative Follow-up Tasks</h2>
          <span className="text-xs font-mono tabular-nums text-[#526259]">
            {tasks.length} task{tasks.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className="p-5 space-y-3" aria-label="Loading follow-up tasks">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-[#F6F8F6]">
                <div className="w-8 h-8 rounded-full bg-[#E3E8E4] shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-48 bg-[#E3E8E4] rounded" />
                  <div className="h-2.5 w-32 bg-[#EEF2EF] rounded" />
                </div>
                <div className="h-3.5 w-20 bg-[#E3E8E4] rounded" />
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <ClinicEmptyIllustration variant="followups" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-[#111C17]">No follow-up tasks in this view</p>
              <p className="text-xs text-[#526058]">
                Switch queue views, reset priority filters, or create a new outreach item.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-1">
              {(viewMode !== 'all' || priorityFilter !== 'All') && (
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('all');
                    setPriorityFilter('All');
                  }}
                  className="px-3.5 py-1.5 text-xs font-medium text-[#111C17] bg-white hover:bg-[#F6F8F6] border border-[#D4DAD4] rounded-lg transition-colors btn-press"
                >
                  View All Tasks
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setShowCreateModal(true);
                }}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors btn-press"
              >
                New Follow-up
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E4E7E2] bg-[#F7F8F6] text-xs font-medium text-[#526058]">
                  <th className="py-2.5 px-4">Task</th>
                  <th className="py-2.5 px-4">Patient</th>
                  <th className="py-2.5 px-4">Description</th>
                  <th className="py-2.5 px-4">Priority · Due</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E7E2] text-sm">
                {tasks.map((task) => {
                  const isOverdue = isTaskOverdue(task, todayKey);
                  const isRowBusy = updatingTaskId === task.id;
                  const displayPatient = task.patientName ?? task.patientId;
                  return (
                    <tr key={task.id} className="hover:bg-[#F7F8F6] transition-colors">
                      <td className={`${cellPad} font-mono tabular-nums text-xs`}>
                        <div className="font-semibold text-[#0C291E]">{task.id}</div>
                        {task.appointmentId && (
                          <div className="text-[#526058]">{task.appointmentId}</div>
                        )}
                        <div className="text-[10px] font-sans text-[#047857] mt-0.5">
                          {task.followupType ?? 'Administrative Contact'}
                        </div>
                      </td>
                      <td className={cellPad}>
                        <div className="flex items-center gap-2.5">
                          <EditorialAvatar name={displayPatient} role="patient" size="sm" />
                          {onOpenPatient ? (
                            <button
                              type="button"
                              onClick={() => onOpenPatient(task.patientId)}
                              className="text-left group"
                              aria-label={`Open patient record for ${displayPatient} (${task.patientId})`}
                            >
                              <div className="font-medium text-[#047857] group-hover:underline">
                                {displayPatient}
                              </div>
                              <div className="text-xs font-mono text-[#526058]">{task.patientId}</div>
                            </button>
                          ) : (
                            <div>
                              <div className="font-medium text-[#16211C]">{displayPatient}</div>
                              <div className="text-xs font-mono text-[#526058]">{task.patientId}</div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className={`${cellPad} text-xs text-[#16211C] max-w-md space-y-1`}>
                        <div>{task.description}</div>
                        {task.reason && (
                          <div className="text-[11px] text-[#526259]">Reason: {task.reason}</div>
                        )}
                        {task.assignedToName && (
                          <div className="text-[11px] text-[#047857]">
                            Owner: {task.assignedToName}
                          </div>
                        )}
                        {task.completionNotes && (
                          <div className="text-[11px] text-[#34433B] bg-[#F6F8F6] px-2 py-1 rounded border border-[#E3E8E4]">
                            Outcome: {task.completionNotes}
                          </div>
                        )}
                      </td>
                      <td className={`${cellPad} text-xs whitespace-nowrap`}>
                        <div className="flex items-center gap-2">
                          <PriorityText priority={task.priority} />
                          {canManageFollowups && (
                            <select
                              aria-label={`Change priority for ${task.id}`}
                              value={task.priority}
                              disabled={isRowBusy}
                              onChange={(e) =>
                                handleQuickPriorityChange(
                                  task.id,
                                  e.target.value as FollowUpPriority
                                )
                              }
                              className="px-1.5 py-0.5 text-[11px] border border-[#D4DAD4] rounded bg-white text-[#16211C] disabled:opacity-50"
                            >
                              <option value="High">High</option>
                              <option value="Medium">Medium</option>
                              <option value="Low">Low</option>
                            </select>
                          )}
                        </div>
                        <div
                          className={`font-mono tabular-nums mt-1 flex items-center gap-1 ${
                            isOverdue ? 'text-red-700 font-semibold' : 'text-[#526058]'
                          }`}
                        >
                          {isOverdue && <AlertTriangle className="w-3 h-3" aria-hidden="true" />}
                          <span>
                            {isOverdue ? `Overdue (${task.dueDate})` : `Due ${task.dueDate}`}
                          </span>
                        </div>
                      </td>
                      <td className={cellPad}>
                        <FollowUpStatusText status={task.status} />
                      </td>
                      <td className={`${cellPad} text-right whitespace-nowrap`}>
                        {canManageFollowups ? (
                          <div className="inline-flex items-center gap-2.5">
                            <button
                              type="button"
                              disabled={isRowBusy}
                              onClick={() => openEditModal(task)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#0C291E] hover:text-[#047857] disabled:opacity-50"
                              aria-label={`Edit follow-up ${task.id}`}
                            >
                              <Pencil className="w-3 h-3" aria-hidden="true" />
                              Edit
                            </button>
                            {task.status === 'Pending' && (
                              <button
                                type="button"
                                disabled={isRowBusy}
                                onClick={() => handleStatusChange(task.id, 'Scheduled')}
                                className="text-xs font-medium text-[#047857] hover:text-[#0C291E] disabled:opacity-50"
                              >
                                Schedule
                              </button>
                            )}
                            {isTaskOpen(task) && (
                              <>
                                <button
                                  type="button"
                                  disabled={isRowBusy}
                                  onClick={() => handleStatusChange(task.id, 'Completed')}
                                  className="text-xs font-medium text-emerald-700 hover:text-emerald-800 disabled:opacity-50"
                                >
                                  Complete
                                </button>
                                <button
                                  type="button"
                                  disabled={isRowBusy}
                                  onClick={() => handleStatusChange(task.id, 'Cancelled')}
                                  className="text-xs font-medium text-[#526058] hover:text-[#16211C] disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </>
                            )}
                            {(task.status === 'Completed' || task.status === 'Cancelled') && (
                              <button
                                type="button"
                                disabled={isRowBusy}
                                onClick={() => handleStatusChange(task.id, 'Pending')}
                                className="text-xs font-medium text-[#526058] hover:text-[#16211C] disabled:opacity-50"
                              >
                                Reopen
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[#6C7B73]">View only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Follow-up Modal */}
      <ModalShell
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        labelledBy="create-fu-title"
        maxWidthClass="max-w-lg"
      >
            <div className="flex items-center justify-between">
              <h3 id="create-fu-title" className="text-base font-semibold text-[#16211C]">
                Create Administrative Follow-up
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-[#526058] hover:text-[#16211C]"
                aria-label="Close create follow-up dialog"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {formError && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="fu-patient" className="block text-xs font-medium text-[#16211C] mb-1">
                    Patient
                  </label>
                  <select
                    id="fu-patient"
                    value={patientId}
                    onChange={(e) => setPatientId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id} — {p.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="fu-apt-id" className="block text-xs font-medium text-[#16211C] mb-1">
                    Appointment ID (Optional)
                  </label>
                  <input
                    id="fu-apt-id"
                    type="text"
                    value={appointmentId}
                    onChange={(e) => setAppointmentId(e.target.value)}
                    placeholder="e.g. APT-2019"
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="fu-type" className="block text-xs font-medium text-[#16211C] mb-1">
                    Follow-up Category
                  </label>
                  <select
                    id="fu-type"
                    value={followupType}
                    onChange={(e) => setFollowupType(e.target.value as FollowUpType)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    {FOLLOWUP_TYPES.map((ft) => (
                      <option key={ft} value={ft}>
                        {ft}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="fu-owner" className="block text-xs font-medium text-[#16211C] mb-1">
                    Assigned Staff Owner (Optional)
                  </label>
                  <select
                    id="fu-owner"
                    value={assignedStaffId}
                    onChange={(e) => setAssignedStaffId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    <option value="">Unassigned (Clinic Queue)</option>
                    {staffList.map((stf) => (
                      <option key={stf.id} value={stf.id}>
                        {stf.fullName} ({stf.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="fu-description" className="block text-xs font-medium text-[#16211C] mb-1">
                  Task Description
                </label>
                <textarea
                  id="fu-description"
                  required
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe administrative outreach or clinical follow-up action..."
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                />
              </div>

              <div>
                <label htmlFor="fu-reason" className="block text-xs font-medium text-[#16211C] mb-1">
                  Reason / Context (Optional)
                </label>
                <input
                  id="fu-reason"
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Missed Cardiology consultation or lab check"
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="fu-priority" className="block text-xs font-medium text-[#16211C] mb-1">
                    Priority
                  </label>
                  <select
                    id="fu-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as FollowUpPriority)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="fu-due" className="block text-xs font-medium text-[#16211C] mb-1">
                    Due Date
                  </label>
                  <input
                    id="fu-due"
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E4E7E2]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-[#526058] border border-[#E4E7E2] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 btn-press"
                >
                  {submitting ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
      </ModalShell>

      {/* Edit Follow-up Modal */}
      <ModalShell
        open={Boolean(editingTask)}
        onClose={() => setEditingTask(null)}
        labelledBy="edit-fu-title"
        maxWidthClass="max-w-lg"
      >
        {editingTask && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h3 id="edit-fu-title" className="text-base font-semibold text-[#16211C]">
                  Edit Follow-up {editingTask.id}
                </h3>
                <p className="text-xs text-[#526058] mt-0.5">
                  {editingTask.patientName} ({editingTask.patientId})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTask(null)}
                className="p-1 text-[#526058] hover:text-[#16211C]"
                aria-label="Close edit follow-up dialog"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {editError && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {editError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-fu-type" className="block text-xs font-medium text-[#16211C] mb-1">
                    Category
                  </label>
                  <select
                    id="edit-fu-type"
                    value={editFollowupType}
                    onChange={(e) => setEditFollowupType(e.target.value as FollowUpType)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    {FOLLOWUP_TYPES.map((ft) => (
                      <option key={ft} value={ft}>
                        {ft}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-fu-owner" className="block text-xs font-medium text-[#16211C] mb-1">
                    Assigned Staff Owner
                  </label>
                  <select
                    id="edit-fu-owner"
                    value={editAssignedStaffId}
                    onChange={(e) => setEditAssignedStaffId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    <option value="">Unassigned (Clinic Queue)</option>
                    {staffList.map((stf) => (
                      <option key={stf.id} value={stf.id}>
                        {stf.fullName} ({stf.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="edit-fu-description" className="block text-xs font-medium text-[#16211C] mb-1">
                  Task Description
                </label>
                <textarea
                  id="edit-fu-description"
                  required
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                />
              </div>

              <div>
                <label htmlFor="edit-fu-reason" className="block text-xs font-medium text-[#16211C] mb-1">
                  Reason / Context
                </label>
                <input
                  id="edit-fu-reason"
                  type="text"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="edit-fu-priority" className="block text-xs font-medium text-[#16211C] mb-1">
                    Priority
                  </label>
                  <select
                    id="edit-fu-priority"
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as FollowUpPriority)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="edit-fu-status" className="block text-xs font-medium text-[#16211C] mb-1">
                    Status
                  </label>
                  <select
                    id="edit-fu-status"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as FollowUpStatus)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    {FOLLOWUP_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="edit-fu-due" className="block text-xs font-medium text-[#16211C] mb-1">
                    Due Date
                  </label>
                  <input
                    id="edit-fu-due"
                    type="date"
                    required
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="edit-fu-completion" className="block text-xs font-medium text-[#16211C] mb-1">
                  Completion / Outcome Notes
                </label>
                <input
                  id="edit-fu-completion"
                  type="text"
                  value={editCompletionNotes}
                  onChange={(e) => setEditCompletionNotes(e.target.value)}
                  placeholder="Summary of outreach call or clinical completion..."
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E4E7E2]">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="px-4 py-2 text-sm font-medium text-[#526058] border border-[#E4E7E2] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 btn-press"
                >
                  {editSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </>
        )}
      </ModalShell>
    </div>
  );
}
