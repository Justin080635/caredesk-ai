import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ClipboardList, Pencil, Plus, X } from 'lucide-react';
import {
  createFollowupRecord,
  fetchFollowups,
  fetchPatients,
  updateFollowupRecord,
} from '../client/api';
import type {
  FollowUpPriority,
  FollowUpStatus,
  FollowUpTask,
  Patient,
} from '../shared/types';
import { FollowUpStatusText, PriorityText } from './StatusText';

interface FollowUpsViewProps {
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  openCreateSignal: number;
  initialViewMode?: 'pending' | 'overdue' | 'Completed' | 'all';
  onOpenPatient?: (patientId: string) => void;
  compactDensity?: boolean;
}

export function FollowUpsView({
  onDataMutated,
  onErrorNotice,
  onSuccessNotice,
  openCreateSignal,
  initialViewMode,
  onOpenPatient,
  compactDensity = false,
}: FollowUpsViewProps) {
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'pending' | 'overdue' | 'Completed' | 'all'>(
    initialViewMode ?? 'pending'
  );
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [patientId, setPatientId] = useState('P-1042');
  const [appointmentId, setAppointmentId] = useState('');
  const [description, setDescription] = useState('');
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
  const [editDescription, setEditDescription] = useState('');
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
      const [taskList, patientList] = await Promise.all([
        viewMode === 'pending' || viewMode === 'overdue'
          ? fetchFollowups({ pendingOnly: true })
          : fetchFollowups({
              status: viewMode === 'all' ? undefined : viewMode,
              priority: priorityFilter,
            }),
        fetchPatients(),
      ]);

      let filtered = taskList;
      if (viewMode === 'overdue') {
        filtered = filtered.filter((t) => t.dueDate < todayKey);
      }
      if ((viewMode === 'pending' || viewMode === 'overdue') && priorityFilter !== 'All') {
        filtered = filtered.filter((t) => t.priority === priorityFilter);
      }
      setTasks(filtered);
      setPatients(patientList);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load follow-up tasks.');
    } finally {
      setLoading(false);
    }
  }, [viewMode, priorityFilter, todayKey, onErrorNotice]);

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
    setEditDescription(task.description);
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
      const updated = await updateFollowupRecord(editingTask.id, {
        description: editDescription.trim(),
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
      const created = await createFollowupRecord({
        patientId,
        appointmentId: appointmentId.trim() || null,
        description: description.trim(),
        priority,
        dueDate,
      });
      setShowCreateModal(false);
      setDescription('');
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

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="bg-white border border-[#E4E7E2] rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-1 p-1 bg-[#F1F4F1] rounded-lg overflow-x-auto"
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
                    ? 'bg-white text-[#0C291E] shadow-sm'
                    : 'text-[#526058] hover:text-[#16211C]'
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
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setShowCreateModal(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          New Follow-up
        </button>
      </div>

      {/* Follow-up Table */}
      <div className="bg-white border border-[#E4E7E2] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E4E7E2] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#16211C]">Administrative Follow-up Tasks</h2>
          <span className="text-xs font-mono tabular-nums text-[#526058]">
            {tasks.length} task{tasks.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-10 text-center">
            <ClipboardList className="w-8 h-8 text-slate-300 mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm text-[#526058]">No follow-up tasks in this view.</p>
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
                  const isOverdue =
                    (task.status === 'Pending' || task.status === 'In Progress') &&
                    task.dueDate < todayKey;
                  const isRowBusy = updatingTaskId === task.id;
                  return (
                    <tr key={task.id} className="hover:bg-[#F7F8F6] transition-colors">
                      <td className={`${cellPad} font-mono tabular-nums text-xs`}>
                        <div className="font-semibold text-[#0C291E]">{task.id}</div>
                        {task.appointmentId && (
                          <div className="text-[#526058]">{task.appointmentId}</div>
                        )}
                      </td>
                      <td className={cellPad}>
                        {onOpenPatient ? (
                          <button
                            type="button"
                            onClick={() => onOpenPatient(task.patientId)}
                            className="text-left group"
                            aria-label={`Open patient record for ${task.patientName} (${task.patientId})`}
                          >
                            <div className="font-medium text-[#047857] group-hover:underline">
                              {task.patientName}
                            </div>
                            <div className="text-xs font-mono text-[#526058]">{task.patientId}</div>
                          </button>
                        ) : (
                          <>
                            <div className="font-medium text-[#16211C]">{task.patientName}</div>
                            <div className="text-xs font-mono text-[#526058]">{task.patientId}</div>
                          </>
                        )}
                      </td>
                      <td className={`${cellPad} text-xs text-[#16211C] max-w-md`}>
                        {task.description}
                      </td>
                      <td className={`${cellPad} text-xs whitespace-nowrap`}>
                        <div className="flex items-center gap-2">
                          <PriorityText priority={task.priority} />
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
                              onClick={() => handleStatusChange(task.id, 'In Progress')}
                              className="text-xs font-medium text-[#047857] hover:text-[#0C291E] disabled:opacity-50"
                            >
                              Start
                            </button>
                          )}
                          {(task.status === 'Pending' || task.status === 'In Progress') && (
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
                                onClick={() => handleStatusChange(task.id, 'Dismissed')}
                                className="text-xs font-medium text-[#526058] hover:text-[#16211C] disabled:opacity-50"
                              >
                                Dismiss
                              </button>
                            </>
                          )}
                          {(task.status === 'Completed' || task.status === 'Dismissed') && (
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
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-fu-title"
        >
          <div className="bg-white border border-[#E4E7E2] rounded-xl w-full max-w-lg p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
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

              <div>
                <label htmlFor="fu-description" className="block text-xs font-medium text-[#16211C] mb-1">
                  Task Description
                </label>
                <textarea
                  id="fu-description"
                  required
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe administrative outreach or verification action..."
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
                  className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Follow-up Modal */}
      {editingTask && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-fu-title"
        >
          <div className="bg-white border border-[#E4E7E2] rounded-xl w-full max-w-lg p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
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
              <div>
                <label htmlFor="edit-fu-description" className="block text-xs font-medium text-[#16211C] mb-1">
                  Task Description
                </label>
                <textarea
                  id="edit-fu-description"
                  required
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
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
                    <option value="Pending">Pending</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Completed">Completed</option>
                    <option value="Dismissed">Dismissed</option>
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
                  className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50"
                >
                  {editSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
