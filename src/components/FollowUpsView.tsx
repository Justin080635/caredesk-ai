import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, Check, Pencil, Plus, RotateCcw, X } from 'lucide-react';
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
import { formatIsoDate, groupFollowUpsByPriority } from '../utils/workspaceMath';
import { ClinicEmptyIllustration, EditorialAvatar } from './ClinicIllustrations';
import { ModalShell } from './ModalShell';
import { CardGridSkeleton } from './Skeletons';
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

const PRIORITY_LANES: Array<{
  priority: FollowUpPriority;
  label: string;
  subtitle: string;
  dotColor: string;
  surfaceTint: string;
}> = [
  {
    priority: 'High',
    label: 'High Priority',
    subtitle: 'Urgent outreach & missed visit recovery',
    dotColor: '#F43F5E',
    surfaceTint: 'bg-[#FFF5F7]',
  },
  {
    priority: 'Medium',
    label: 'Medium Priority',
    subtitle: 'Routine confirmation & check-ins',
    dotColor: '#F59E0B',
    surfaceTint: 'bg-[#FFF9EE]',
  },
  {
    priority: 'Low',
    label: 'Low Priority',
    subtitle: 'Standard administrative follow-ups',
    dotColor: '#34C38F',
    surfaceTint: 'bg-[#F3FAF6]',
  },
];

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
    return formatIsoDate(d);
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

  const todayKey = useMemo(() => formatIsoDate(new Date()), []);

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
          ? fetchFollowups({ pendingOnly: true, followupType: typeFilter })
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
        `Saved follow-up ${updated.id} (${updated.priority} · ${updated.status} · due ${updated.dueDate}).`
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

  const groupedByPriority = useMemo(
    () => groupFollowUpsByPriority(tasks, todayKey),
    [tasks, todayKey]
  );

  const openQueueCount = allTasksSnapshot.filter((t) => isTaskOpen(t)).length;
  const overdueQueueCount = allTasksSnapshot.filter((t) => isTaskOverdue(t, todayKey)).length;
  const highPriorityOpenCount = allTasksSnapshot.filter(
    (t) => isTaskOpen(t) && t.priority === 'High'
  ).length;
  const completedCount = allTasksSnapshot.filter((t) => t.status === 'Completed').length;

  const visibleLanes =
    priorityFilter === 'All'
      ? PRIORITY_LANES
      : PRIORITY_LANES.filter((l) => l.priority === priorityFilter);

  const cardPad = compactDensity ? 'p-3.5' : 'p-4';

  return (
    <div className="space-y-5 animate-view-enter">
      {/* Queue Summary Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => {
            setViewMode('pending');
            setPriorityFilter('All');
          }}
          className="btn-press text-left rounded-[22px] bg-[#0F3D2E] hover:bg-[#144D3B] text-white p-5 transition-colors"
        >
          <div className="text-xs font-medium text-emerald-100/80">Open Queue</div>
          <div className="text-[28px] leading-none font-bold font-mono tabular-nums mt-2">
            {openQueueCount}
          </div>
          <div className="text-[11px] text-emerald-100/75 mt-1.5">
            Pending, scheduled &amp; overdue
          </div>
        </button>

        <button
          type="button"
          onClick={() => setViewMode('overdue')}
          className="btn-press text-left card-surface card-interactive rounded-[22px] p-5"
        >
          <div className="text-xs font-medium text-[#6B7B73]">Overdue Tasks</div>
          <div
            className={`text-[28px] leading-none font-bold font-mono tabular-nums mt-2 ${
              overdueQueueCount > 0 ? 'text-rose-700' : 'text-[#137A55]'
            }`}
          >
            {overdueQueueCount}
          </div>
          <div className="text-[11px] text-[#6B7B73] mt-1.5">Past target due date</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode('pending');
            setPriorityFilter('High');
          }}
          className="btn-press text-left card-surface card-interactive rounded-[22px] p-5"
        >
          <div className="text-xs font-medium text-[#6B7B73]">High Priority Open</div>
          <div className="text-[28px] leading-none font-bold font-mono tabular-nums text-amber-700 mt-2">
            {highPriorityOpenCount}
          </div>
          <div className="text-[11px] text-[#6B7B73] mt-1.5">Urgent administrative outreach</div>
        </button>

        <button
          type="button"
          onClick={() => setViewMode('Completed')}
          className="btn-press text-left card-surface card-interactive rounded-[22px] p-5"
        >
          <div className="text-xs font-medium text-[#6B7B73]">Completed</div>
          <div className="text-[28px] leading-none font-bold font-mono tabular-nums text-[#137A55] mt-2">
            {completedCount}
          </div>
          <div className="text-[11px] text-[#6B7B73] mt-1.5">Resolved follow-up items</div>
        </button>
      </section>

      {/* Toolbar */}
      <div className="card-surface rounded-[22px] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className="flex flex-wrap sm:flex-nowrap items-center gap-1 p-1 bg-[#EEF3EF] border border-[#DCE8E0] rounded-2xl sm:rounded-full max-w-full"
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
                className={`min-h-[38px] sm:min-h-0 px-3.5 py-1.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === tab.id
                    ? 'bg-[#0F3D2E] text-white shadow-xs'
                    : 'text-[#6B7B73] hover:text-[#1C2B25]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs font-medium border border-[#DCE8E0] rounded-full bg-[#FAFBF9]"
          >
            <option value="All">All Priorities</option>
            <option value="High">High Priority</option>
            <option value="Medium">Medium Priority</option>
            <option value="Low">Low Priority</option>
          </select>

          <select
            aria-label="Filter by category"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs font-medium border border-[#DCE8E0] rounded-full bg-[#FAFBF9]"
          >
            <option value="All">All Categories</option>
            {FOLLOWUP_TYPES.map((ft) => (
              <option key={ft} value={ft}>
                {ft}
              </option>
            ))}
          </select>
        </div>

        {canManageFollowups && (
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setShowCreateModal(true);
            }}
            className="btn-press inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-xs sm:text-sm font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            New Follow-up
          </button>
        )}
      </div>

      {/* Grouped Priority Task Cards */}
      {loading ? (
        <CardGridSkeleton
          cards={3}
          columnsClass="grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
          label="Loading follow-up tasks"
        />
      ) : tasks.length === 0 ? (
        <div className="card-surface rounded-[24px] p-10 text-center space-y-3">
          <ClinicEmptyIllustration variant="followups" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[#1C2B25]">No follow-up tasks in this view</p>
            <p className="text-xs text-[#6B7B73]">
              Switch queue views, reset priority filters, or create a new outreach item.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {(viewMode !== 'all' || priorityFilter !== 'All') && (
              <button
                type="button"
                onClick={() => {
                  setViewMode('all');
                  setPriorityFilter('All');
                }}
                className="btn-press min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-semibold text-[#1C2B25] bg-[#FAFBF9] border border-[#DCE8E0] rounded-full"
              >
                View All Tasks
              </button>
            )}
            {canManageFollowups && (
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setShowCreateModal(true);
                }}
                className="btn-press min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] rounded-full"
              >
                New Follow-up
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          className={`grid gap-5 items-start ${
            visibleLanes.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
          }`}
        >
          {visibleLanes.map((lane) => {
            const laneTasks = groupedByPriority[lane.priority];
            return (
              <section
                key={lane.priority}
                aria-label={`${lane.label} tasks`}
                className="card-surface rounded-[24px] p-4 sm:p-5 space-y-3.5"
              >
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#EEF3EF]">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: lane.dotColor }}
                      aria-hidden="true"
                    />
                    <div>
                      <h2 className="text-sm font-bold text-[#1C2B25]">{lane.label}</h2>
                      <p className="text-[11px] text-[#6B7B73]">{lane.subtitle}</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-[#EEF3EF] text-xs font-mono font-bold tabular-nums text-[#0F3D2E]">
                    {laneTasks.length}
                  </span>
                </div>

                {laneTasks.length === 0 ? (
                  <div className="rounded-2xl bg-[#FAFBF9] border border-dashed border-[#DCE8E0] p-6 text-center text-xs text-[#6B7B73]">
                    No {lane.priority.toLowerCase()}-priority tasks in current filter.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {laneTasks.map((task) => {
                      const isOverdue = isTaskOverdue(task, todayKey);
                      const isBusy = updatingTaskId === task.id;
                      const displayPatient = task.patientName ?? task.patientId;

                      return (
                        <article
                          key={task.id}
                          className={`rounded-[20px] border border-[#DCE8E0] ${lane.surfaceTint} ${cardPad} space-y-3 card-interactive`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <EditorialAvatar name={displayPatient} role="patient" size="sm" />
                              <div className="min-w-0">
                                {onOpenPatient ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpenPatient(task.patientId)}
                                    className="text-sm font-bold text-[#0F3D2E] hover:underline truncate block text-left"
                                  >
                                    {displayPatient}
                                  </button>
                                ) : (
                                  <div className="text-sm font-bold text-[#1C2B25] truncate">
                                    {displayPatient}
                                  </div>
                                )}
                                <div className="text-[11px] font-mono text-[#6B7B73]">
                                  {task.id} · {task.patientId}
                                </div>
                              </div>
                            </div>
                            <FollowUpStatusText status={task.status} />
                          </div>

                          <p className="text-xs text-[#1C2B25] leading-relaxed font-medium">
                            {task.description}
                          </p>

                          {(task.reason || task.assignedToName) && (
                            <div className="text-[11px] text-[#6B7B73] space-y-0.5">
                              {task.reason && <div>Reason: {task.reason}</div>}
                              {task.assignedToName && (
                                <div className="text-[#137A55] font-medium">
                                  Owner: {task.assignedToName}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Due-date & Overdue badges */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#DCE8E0]/80">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold tabular-nums ${
                                  isOverdue
                                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                    : 'bg-white text-[#1C2B25] border border-[#DCE8E0]'
                                }`}
                              >
                                {isOverdue ? (
                                  <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                                ) : (
                                  <Calendar className="w-3 h-3 text-[#6B7B73]" aria-hidden="true" />
                                )}
                                {isOverdue ? `Overdue · ${task.dueDate}` : `Due ${task.dueDate}`}
                              </span>
                              <PriorityText priority={task.priority} />
                            </div>

                            {canManageFollowups && (
                              <select
                                aria-label={`Change priority for ${task.id}`}
                                value={task.priority}
                                disabled={isBusy}
                                onChange={(e) =>
                                  handleQuickPriorityChange(
                                    task.id,
                                    e.target.value as FollowUpPriority
                                  )
                                }
                                className="px-2 py-0.5 text-[11px] border border-[#DCE8E0] rounded-full bg-white text-[#1C2B25] disabled:opacity-50"
                              >
                                <option value="High">High</option>
                                <option value="Medium">Medium</option>
                                <option value="Low">Low</option>
                              </select>
                            )}
                          </div>

                          {/* Card Actions */}
                          {canManageFollowups && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-1">
                              {isTaskOpen(task) && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleStatusChange(task.id, 'Completed')}
                                  className="btn-press inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 px-3.5 sm:px-3 py-1 rounded-full text-[11px] font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] disabled:opacity-50"
                                >
                                  <Check className="w-3 h-3" aria-hidden="true" />
                                  Complete
                                </button>
                              )}
                              {task.status === 'Pending' && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleStatusChange(task.id, 'Scheduled')}
                                  className="btn-press min-h-[44px] sm:min-h-0 px-3.5 sm:px-3 py-1 rounded-full text-[11px] font-semibold text-[#0F3D2E] bg-white border border-[#DCE8E0] hover:bg-[#EEF3EF] disabled:opacity-50"
                                >
                                  Schedule
                                </button>
                              )}
                              {(task.status === 'Completed' || task.status === 'Cancelled') && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleStatusChange(task.id, 'Pending')}
                                  className="btn-press inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 px-3.5 sm:px-3 py-1 rounded-full text-[11px] font-semibold text-[#0F3D2E] bg-white border border-[#DCE8E0] hover:bg-[#EEF3EF] disabled:opacity-50"
                                >
                                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                                  Reopen
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => openEditModal(task)}
                                aria-label={`Edit follow-up ${task.id}`}
                                className="btn-press inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 px-3.5 sm:px-3 py-1 rounded-full text-[11px] font-semibold text-[#6B7B73] hover:text-[#1C2B25] bg-white border border-[#DCE8E0] disabled:opacity-50"
                              >
                                <Pencil className="w-3 h-3" aria-hidden="true" />
                                Edit
                              </button>
                              {isTaskOpen(task) && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleStatusChange(task.id, 'Cancelled')}
                                  className="btn-press ml-auto min-h-[44px] sm:min-h-0 px-3 sm:px-2.5 py-1 rounded-full text-[11px] font-medium text-[#6B7B73] hover:text-rose-700 disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Create Follow-up Modal */}
      <ModalShell
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        labelledBy="create-fu-title"
        maxWidthClass="max-w-lg"
      >
        <div className="flex items-center justify-between">
          <h3 id="create-fu-title" className="text-base font-bold text-[#1C2B25]">
            Create Follow-up Task
          </h3>
          <button
            type="button"
            onClick={() => setShowCreateModal(false)}
            className="p-1.5 text-[#6B7B73] hover:text-[#1C2B25] rounded-full hover:bg-[#EEF3EF]"
            aria-label="Close create follow-up dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {formError && (
          <div className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-2xl">
            {formError}
          </div>
        )}

        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fu-patient" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Patient
              </label>
              <select
                id="fu-patient"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} — {p.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="fu-apt-id" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Appointment ID (Optional)
              </label>
              <input
                id="fu-apt-id"
                type="text"
                value={appointmentId}
                onChange={(e) => setAppointmentId(e.target.value)}
                placeholder="e.g. APT-2019"
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fu-type" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Category
              </label>
              <select
                id="fu-type"
                value={followupType}
                onChange={(e) => setFollowupType(e.target.value as FollowUpType)}
                className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
              >
                {FOLLOWUP_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {ft}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="fu-owner" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Assigned Staff Owner
              </label>
              <select
                id="fu-owner"
                value={assignedStaffId}
                onChange={(e) => setAssignedStaffId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
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
            <label htmlFor="fu-description" className="block text-xs font-semibold text-[#1C2B25] mb-1">
              Task Description
            </label>
            <textarea
              id="fu-description"
              required
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe administrative outreach or clinical follow-up action..."
              className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
            />
          </div>

          <div>
            <label htmlFor="fu-reason" className="block text-xs font-semibold text-[#1C2B25] mb-1">
              Reason / Context (Optional)
            </label>
            <input
              id="fu-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Missed Cardiology consultation or lab check"
              className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fu-priority" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Priority
              </label>
              <select
                id="fu-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as FollowUpPriority)}
                className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div>
              <label htmlFor="fu-due" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Due Date
              </label>
              <input
                id="fu-due"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#DCE8E0]">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="btn-press px-4 py-2 text-xs font-semibold text-[#6B7B73] border border-[#DCE8E0] rounded-full"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-press px-5 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full disabled:opacity-50"
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
                <h3 id="edit-fu-title" className="text-base font-bold text-[#1C2B25]">
                  Edit Follow-up {editingTask.id}
                </h3>
                <p className="text-xs text-[#6B7B73] mt-0.5">
                  {editingTask.patientName} ({editingTask.patientId})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTask(null)}
                className="p-1.5 text-[#6B7B73] hover:text-[#1C2B25] rounded-full hover:bg-[#EEF3EF]"
                aria-label="Close edit follow-up dialog"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {editError && (
              <div className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-2xl">
                {editError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-fu-type" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                    Category
                  </label>
                  <select
                    id="edit-fu-type"
                    value={editFollowupType}
                    onChange={(e) => setEditFollowupType(e.target.value as FollowUpType)}
                    className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
                  >
                    {FOLLOWUP_TYPES.map((ft) => (
                      <option key={ft} value={ft}>
                        {ft}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-fu-owner" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                    Assigned Staff Owner
                  </label>
                  <select
                    id="edit-fu-owner"
                    value={editAssignedStaffId}
                    onChange={(e) => setEditAssignedStaffId(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
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
                <label htmlFor="edit-fu-description" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                  Task Description
                </label>
                <textarea
                  id="edit-fu-description"
                  required
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
                />
              </div>

              <div>
                <label htmlFor="edit-fu-reason" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                  Reason / Context
                </label>
                <input
                  id="edit-fu-reason"
                  type="text"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="edit-fu-priority" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                    Priority
                  </label>
                  <select
                    id="edit-fu-priority"
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as FollowUpPriority)}
                    className="w-full px-3 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="edit-fu-status" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                    Status
                  </label>
                  <select
                    id="edit-fu-status"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as FollowUpStatus)}
                    className="w-full px-3 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
                  >
                    {FOLLOWUP_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="edit-fu-due" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                    Due Date
                  </label>
                  <input
                    id="edit-fu-due"
                    type="date"
                    required
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="edit-fu-completion" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                  Completion / Outcome Notes
                </label>
                <input
                  id="edit-fu-completion"
                  type="text"
                  value={editCompletionNotes}
                  onChange={(e) => setEditCompletionNotes(e.target.value)}
                  placeholder="Summary of outreach call or completion..."
                  className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#DCE8E0]">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="btn-press px-4 py-2 text-xs font-semibold text-[#6B7B73] border border-[#DCE8E0] rounded-full"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="btn-press px-5 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full disabled:opacity-50"
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
