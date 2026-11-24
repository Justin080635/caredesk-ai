import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  List,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  createAppointmentRecord,
  fetchAppointmentById,
  fetchAppointments,
  fetchAvailableSlots,
  fetchOverviewReport,
  fetchPatients,
  updateAppointmentRecord,
} from '../client/api';
import { CLINIC_CLINICIANS, CLINIC_DEPARTMENTS } from '../shared/constants';
import type {
  Appointment,
  AppointmentStatus,
  AvailableSlot,
  CalendarDaySummary,
  Patient,
} from '../shared/types';
import { ClinicCalendar } from './ClinicCalendar';
import { AppointmentStatusText } from './StatusText';

interface AppointmentsViewProps {
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  openCreateSignal: number;
  prefillPatientId?: string | null;
  initialStatusFilter?: string;
  initialDateFilter?: string;
  initialDetailAppointmentId?: string | null;
  onOpenPatient?: (patientId: string) => void;
  compactDensity?: boolean;
}

function toMinutes(timeStr: string): number {
  const [hh, mm] = timeStr.split(':').map(Number);
  return hh * 60 + mm;
}

function detectClientConflict(
  sameDayAppointments: Appointment[],
  candidate: {
    excludeId: string;
    patientId: string;
    date: string;
    time: string;
    durationMinutes: number;
    clinician: string;
  }
): string | null {
  const activeStatuses = new Set<AppointmentStatus>(['Scheduled', 'Confirmed', 'Completed']);
  const c0 = toMinutes(candidate.time);
  const c1 = c0 + (candidate.durationMinutes || 30);

  for (const existing of sameDayAppointments) {
    if (existing.id === candidate.excludeId) continue;
    if (!activeStatuses.has(existing.status)) continue;
    if (existing.appointmentDate !== candidate.date) continue;

    const e0 = toMinutes(existing.appointmentTime);
    const e1 = e0 + (existing.durationMinutes || 30);
    if (e0 < c1 && c0 < e1) {
      if (existing.clinician === candidate.clinician) {
        return `${candidate.clinician} already has appointment ${existing.id} at ${existing.appointmentTime} on ${existing.appointmentDate}.`;
      }
      if (existing.patientId === candidate.patientId) {
        return `Patient ${candidate.patientId} already has appointment ${existing.id} at ${existing.appointmentTime} on ${existing.appointmentDate}.`;
      }
    }
  }
  return null;
}

export function AppointmentsView({
  onDataMutated,
  onErrorNotice,
  onSuccessNotice,
  openCreateSignal,
  prefillPatientId,
  initialStatusFilter,
  initialDateFilter,
  initialDetailAppointmentId,
  onOpenPatient,
  compactDensity = false,
}: AppointmentsViewProps) {
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [calendarSummaries, setCalendarSummaries] = useState<CalendarDaySummary[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState(initialStatusFilter ?? 'All');
  const [deptFilter, setDeptFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState(initialDateFilter ?? '');
  const [calendarDate, setCalendarDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [search, setSearch] = useState('');

  // Availability Drawer State
  const [showAvailability, setShowAvailability] = useState(false);
  const [availDept, setAvailDept] = useState('All');
  const [availSlots, setAvailSlots] = useState<AvailableSlot[]>([]);
  const [availLoading, setAvailLoading] = useState(false);

  // Selected detail panel
  const [detailApt, setDetailApt] = useState<Appointment | null>(null);

  // Create Appointment Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPatientId, setNewPatientId] = useState('P-1042');
  const [newDate, setNewDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [newTime, setNewTime] = useState('10:00');
  const [newDept, setNewDept] = useState<string>(CLINIC_DEPARTMENTS[0]);
  const [newClinician, setNewClinician] = useState<string>(CLINIC_CLINICIANS[0].name);
  const [newNotes, setNewNotes] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reschedule / Edit 2-Step Confirmation Modal State
  const [editingApt, setEditingApt] = useState<Appointment | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editDept, setEditDept] = useState<string>(CLINIC_DEPARTMENTS[0]);
  const [editStatus, setEditStatus] = useState<AppointmentStatus>('Scheduled');
  const [editClinician, setEditClinician] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [rescheduleStep, setRescheduleStep] = useState<'edit' | 'confirm'>('edit');
  const [editSlotChecking, setEditSlotChecking] = useState(false);
  const [editAvailabilityStatus, setEditAvailabilityStatus] = useState<{
    checked: boolean;
    available: boolean;
    message: string;
    suggestions: AvailableSlot[];
  } | null>(null);

  // Cancel Confirmation Modal
  const [cancellingApt, setCancellingApt] = useState<Appointment | null>(null);

  useEffect(() => {
    if (initialStatusFilter !== undefined) {
      setStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);

  useEffect(() => {
    if (initialDateFilter !== undefined) {
      setViewMode('list');
      setDateFilter(initialDateFilter);
    }
  }, [initialDateFilter]);

  useEffect(() => {
    if (!initialDetailAppointmentId) return;
    let cancelled = false;
    setViewMode('list');
    fetchAppointmentById(initialDetailAppointmentId)
      .then((apt) => {
        if (!cancelled) {
          setDetailApt(apt);
        }
      })
      .catch(() => {
        // Non-blocking if appointment no longer exists
      });
    return () => {
      cancelled = true;
    };
  }, [initialDetailAppointmentId]);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const effectiveDate = viewMode === 'calendar' ? calendarDate : dateFilter || undefined;
      const [apts, pts, overview] = await Promise.all([
        fetchAppointments({
          date: effectiveDate,
          status: statusFilter,
          department: deptFilter,
          search,
        }),
        fetchPatients(),
        fetchOverviewReport(),
      ]);
      setAppointments(apts);
      setPatients(pts);
      setCalendarSummaries(overview.calendarSummary);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load appointments.');
    } finally {
      setLoading(false);
    }
  }, [viewMode, calendarDate, dateFilter, statusFilter, deptFilter, search, onErrorNotice]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  useEffect(() => {
    if (openCreateSignal > 0) {
      if (prefillPatientId) {
        setNewPatientId(prefillPatientId);
      }
      setCreateError(null);
      setShowCreateModal(true);
    }
  }, [openCreateSignal, prefillPatientId]);

  const loadAvailability = async (dept = availDept) => {
    setAvailLoading(true);
    try {
      const slots = await fetchAvailableSlots({
        department: dept === 'All' ? undefined : dept,
        limit: 12,
      });
      setAvailSlots(slots);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Failed to check slot availability.');
    } finally {
      setAvailLoading(false);
    }
  };

  const handleOpenAvailability = () => {
    setShowAvailability((prev) => {
      const next = !prev;
      if (next) loadAvailability(availDept);
      return next;
    });
  };

  const handleDeptChangeInCreate = (dept: string) => {
    setNewDept(dept);
    const match = CLINIC_CLINICIANS.find((c) => c.department === dept);
    if (match) setNewClinician(match.name);
  };

  const handleBookFromSlot = (slot: AvailableSlot) => {
    setNewDate(slot.date);
    setNewTime(slot.time);
    setNewDept(slot.department);
    setNewClinician(slot.clinician);
    setCreateError(null);
    setShowCreateModal(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setSubmitting(true);
    try {
      const created = await createAppointmentRecord({
        patientId: newPatientId,
        appointmentDate: newDate,
        appointmentTime: newTime,
        department: newDept,
        clinician: newClinician,
        status: 'Scheduled',
        notes: newNotes,
      });
      setShowCreateModal(false);
      setNewNotes('');
      onSuccessNotice(
        `Scheduled ${created.id} for ${created.patientName ?? created.patientId} on ${created.appointmentDate} at ${created.appointmentTime}.`
      );
      await loadAppointments();
      if (showAvailability) await loadAvailability(availDept);
      onDataMutated();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create appointment.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = async (apt: Appointment) => {
    setEditingApt(apt);
    setEditDate(apt.appointmentDate);
    setEditTime(apt.appointmentTime);
    setEditDept(apt.department);
    setEditStatus(apt.status);
    setEditClinician(apt.clinician);
    setEditNotes(apt.notes);
    setEditError(null);
    setRescheduleStep('edit');
    setEditAvailabilityStatus(null);

    try {
      // Step 1 of reschedule workflow: retrieve latest persisted appointment from server
      const fresh = await fetchAppointmentById(apt.id);
      setEditingApt(fresh);
      setEditDate(fresh.appointmentDate);
      setEditTime(fresh.appointmentTime);
      setEditDept(fresh.department);
      setEditStatus(fresh.status);
      setEditClinician(fresh.clinician);
      setEditNotes(fresh.notes);
    } catch {
      // Fall back to row snapshot if refresh fails
    }
  };

  const runEditAvailabilityCheck = async (): Promise<boolean> => {
    if (!editingApt) return false;
    setEditSlotChecking(true);
    setEditError(null);
    try {
      const [sameDayApts, openSlots] = await Promise.all([
        fetchAppointments({ date: editDate }),
        fetchAvailableSlots({
          startDate: editDate,
          department: editDept,
          clinician: editClinician,
          patientId: editingApt.patientId,
          limit: 6,
        }),
      ]);

      const conflictMsg = detectClientConflict(sameDayApts, {
        excludeId: editingApt.id,
        patientId: editingApt.patientId,
        date: editDate,
        time: editTime,
        durationMinutes: editingApt.durationMinutes,
        clinician: editClinician,
      });

      if (conflictMsg) {
        setEditAvailabilityStatus({
          checked: true,
          available: false,
          message: conflictMsg,
          suggestions: openSlots,
        });
        return false;
      }

      setEditAvailabilityStatus({
        checked: true,
        available: true,
        message: `Slot ${editDate} at ${editTime} with ${editClinician} is available.`,
        suggestions: openSlots,
      });
      return true;
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to validate slot availability.');
      return false;
    } finally {
      setEditSlotChecking(false);
    }
  };

  const hasScheduleChanged = Boolean(
    editingApt &&
      (editDate !== editingApt.appointmentDate ||
        editTime !== editingApt.appointmentTime ||
        editClinician !== editingApt.clinician ||
        editDept !== editingApt.department)
  );

  const persistAppointmentUpdate = async () => {
    if (!editingApt) return;
    setEditError(null);
    setSubmitting(true);
    try {
      const updated = await updateAppointmentRecord(editingApt.id, {
        appointmentDate: editDate,
        appointmentTime: editTime,
        department: editDept,
        status: editStatus,
        clinician: editClinician,
        notes: editNotes,
      });
      // Step 7 of reschedule workflow: verify persisted record from database
      const verified = await fetchAppointmentById(updated.id);
      setEditingApt(null);
      setRescheduleStep('edit');
      if (detailApt?.id === verified.id) setDetailApt(verified);
      onSuccessNotice(
        `Saved appointment ${verified.id} (${verified.appointmentDate} ${verified.appointmentTime} · ${verified.status}).`
      );
      await loadAppointments();
      if (showAvailability) await loadAvailability(availDept);
      onDataMutated();
    } catch (err) {
      setRescheduleStep('edit');
      setEditError(err instanceof Error ? err.message : 'Unable to update appointment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingApt) return;

    if (hasScheduleChanged && rescheduleStep === 'edit') {
      const ok = await runEditAvailabilityCheck();
      if (!ok) return;
      setRescheduleStep('confirm');
      return;
    }

    await persistAppointmentUpdate();
  };

  const handleConfirmCancel = async () => {
    if (!cancellingApt) return;
    setSubmitting(true);
    try {
      const updated = await updateAppointmentRecord(cancellingApt.id, { status: 'Cancelled' });
      const verified = await fetchAppointmentById(updated.id);
      setCancellingApt(null);
      if (detailApt?.id === verified.id) setDetailApt(verified);
      onSuccessNotice(`Cancelled appointment ${verified.id}.`);
      await loadAppointments();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to cancel appointment.');
    } finally {
      setSubmitting(false);
    }
  };

  const statuses = ['All', 'Scheduled', 'Confirmed', 'Completed', 'Missed', 'Cancelled'];
  const cellPad = compactDensity ? 'py-2 px-4' : 'py-3 px-4';

  const renderPatientLink = (patientName: string | undefined, patientId: string) => {
    if (!onOpenPatient) {
      return (
        <>
          <div className="font-medium text-[#16211C]">{patientName}</div>
          <div className="text-xs font-mono text-[#526058]">{patientId}</div>
        </>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onOpenPatient(patientId)}
        className="text-left group"
        aria-label={`Open patient record for ${patientName ?? patientId}`}
      >
        <div className="font-medium text-[#047857] group-hover:underline">{patientName}</div>
        <div className="text-xs font-mono text-[#526058]">{patientId}</div>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="bg-white border border-[#E4E7E2] rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search
                className="w-4 h-4 text-[#526058] absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <label htmlFor="apt-search-input" className="sr-only">
                Search appointments
              </label>
              <input
                id="apt-search-input"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ID, patient, clinician..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>

            {viewMode === 'list' && (
              <>
                <div>
                  <label htmlFor="apt-date-filter" className="sr-only">
                    Filter by date
                  </label>
                  <input
                    id="apt-date-filter"
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  />
                </div>
                {dateFilter && (
                  <button
                    type="button"
                    onClick={() => setDateFilter('')}
                    className="text-xs font-medium text-[#526058] hover:text-[#16211C]"
                  >
                    All Dates
                  </button>
                )}
              </>
            )}

            <div>
              <label htmlFor="apt-dept-filter" className="sr-only">
                Filter by department
              </label>
              <select
                id="apt-dept-filter"
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
              >
                <option value="All">All Departments</option>
                {CLINIC_DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div
              className="flex items-center gap-1 p-1 bg-[#F1F4F1] rounded-lg"
              role="group"
              aria-label="Appointment display view"
            >
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'list' ? 'bg-white text-[#0C291E] shadow-sm' : 'text-[#526058]'
                }`}
              >
                <List className="w-3.5 h-3.5" aria-hidden="true" />
                List View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'calendar' ? 'bg-white text-[#0C291E] shadow-sm' : 'text-[#526058]'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                Calendar View
              </button>
            </div>

            <button
              type="button"
              onClick={handleOpenAvailability}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-[#0C291E] bg-[#EDF4F0] hover:bg-[#D7E6DD] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Clock className="w-4 h-4 text-[#047857]" aria-hidden="true" />
              {showAvailability ? 'Hide Availability' : 'Check Availability'}
            </button>

            <button
              type="button"
              onClick={() => {
                setCreateError(null);
                setShowCreateModal(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Schedule Appointment
            </button>
          </div>
        </div>

        {/* Status Segmented Control */}
        <div
          className="flex items-center gap-1 p-1 bg-[#F1F4F1] rounded-lg overflow-x-auto w-fit max-w-full"
          role="group"
          aria-label="Filter appointments by status"
        >
          {statuses.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === st
                  ? 'bg-white text-[#0C291E] shadow-sm'
                  : 'text-[#526058] hover:text-[#16211C]'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Slot Availability Finder */}
      {showAvailability && (
        <section className="bg-white border border-[#E4E7E2] rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#16211C]">
                Conflict-Free Slot Availability
              </h3>
              <p className="text-xs text-[#526058] mt-0.5">
                Next open 30-minute clinic slots computed from live clinician calendars.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="avail-dept-select" className="text-xs text-[#526058]">
                Department:
              </label>
              <select
                id="avail-dept-select"
                value={availDept}
                onChange={(e) => {
                  setAvailDept(e.target.value);
                  loadAvailability(e.target.value);
                }}
                className="px-2.5 py-1.5 text-xs border border-[#D4DAD4] rounded-md bg-white"
              >
                <option value="All">All Departments</option>
                {CLINIC_DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {availLoading ? (
            <div className="h-20 bg-slate-100 rounded animate-pulse" />
          ) : availSlots.length === 0 ? (
            <p className="text-xs text-[#526058]">No open slots available in this range.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {availSlots.map((slot, idx) => (
                <div
                  key={`${slot.date}-${slot.time}-${slot.clinician}-${idx}`}
                  className="p-3 bg-[#F7F8F6] border border-[#E4E7E2] rounded-lg flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="text-xs font-mono tabular-nums font-semibold text-[#0C291E]">
                      {slot.date} · {slot.time}
                    </div>
                    <div className="text-[11px] text-[#526058] mt-0.5">
                      {slot.department} · {slot.clinician}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleBookFromSlot(slot)}
                    className="px-2.5 py-1 text-xs font-medium text-[#047857] hover:bg-[#EDF4F0] border border-[#C6DFD1] rounded transition-colors whitespace-nowrap shrink-0"
                  >
                    Book
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Calendar View Split */}
      {viewMode === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5 bg-white border border-[#E4E7E2] rounded-xl p-5">
            <ClinicCalendar
              selectedDate={calendarDate}
              onSelectDate={(d) => setCalendarDate(d)}
              daySummaries={calendarSummaries}
            />
          </div>

          <div className="lg:col-span-7 bg-white border border-[#E4E7E2] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E4E7E2] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#16211C]">
                  Schedule for <span className="font-mono">{calendarDate}</span>
                </h2>
                <p className="text-xs text-[#526058]">
                  {appointments.length} appointment{appointments.length === 1 ? '' : 's'} matching filters
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setNewDate(calendarDate);
                  setCreateError(null);
                  setShowCreateModal(true);
                }}
                className="text-xs font-medium text-[#047857] hover:text-[#0C291E]"
              >
                + Book on {calendarDate}
              </button>
            </div>

            {appointments.length === 0 ? (
              <div className="p-10 text-center">
                <Calendar className="w-8 h-8 text-slate-300 mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm text-[#526058]">No appointments scheduled for this date.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#E4E7E2]">
                {appointments.map((apt) => (
                  <div
                    key={apt.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F7F8F6] transition-colors"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono tabular-nums font-semibold text-[#0C291E]">
                          {apt.appointmentTime}
                        </span>
                        {onOpenPatient ? (
                          <button
                            type="button"
                            onClick={() => onOpenPatient(apt.patientId)}
                            className="font-semibold text-[#047857] hover:underline"
                          >
                            {apt.patientName}
                          </button>
                        ) : (
                          <span className="font-semibold text-[#16211C]">{apt.patientName}</span>
                        )}
                        <span className="font-mono text-[#526058]">
                          · {apt.patientId} · {apt.id}
                        </span>
                      </div>
                      <div className="text-xs text-[#526058] mt-1">
                        {apt.department} · {apt.clinician}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <AppointmentStatusText status={apt.status} />
                      <button
                        type="button"
                        onClick={() => openEditModal(apt)}
                        className="text-xs font-medium text-[#047857] hover:text-[#0C291E]"
                      >
                        Reschedule / Update
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* List View Table + Optional Detail Drawer */}
      {viewMode === 'list' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div
            className={`${
              detailApt ? 'lg:col-span-8' : 'lg:col-span-12'
            } bg-white border border-[#E4E7E2] rounded-xl overflow-hidden`}
          >
            <div className="px-5 py-3.5 border-b border-[#E4E7E2] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#16211C]">Appointment Schedule</h2>
              <span className="text-xs font-mono tabular-nums text-[#526058]">
                {appointments.length} appointment{appointments.length === 1 ? '' : 's'}
              </span>
            </div>

            {loading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : appointments.length === 0 ? (
              <div className="p-10 text-center">
                <Calendar className="w-8 h-8 text-slate-300 mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm text-[#526058]">No appointments match the current filters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E4E7E2] bg-[#F7F8F6] text-xs font-medium text-[#526058]">
                      <th className="py-2.5 px-4">ID</th>
                      <th className="py-2.5 px-4">Date &amp; Time</th>
                      <th className="py-2.5 px-4">Patient</th>
                      <th className="py-2.5 px-4">Department · Clinician</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E7E2] text-sm">
                    {appointments.map((apt) => (
                      <tr
                        key={apt.id}
                        className={`hover:bg-[#F7F8F6] transition-colors ${
                          detailApt?.id === apt.id ? 'bg-[#EDF4F0]/60' : ''
                        }`}
                      >
                        <td className={`${cellPad} font-mono tabular-nums text-xs font-semibold text-[#0C291E]`}>
                          <button
                            type="button"
                            onClick={() => setDetailApt(apt)}
                            className="hover:underline text-left"
                          >
                            {apt.id}
                          </button>
                        </td>
                        <td className={`${cellPad} font-mono tabular-nums text-xs text-[#16211C] whitespace-nowrap`}>
                          {apt.appointmentDate} · {apt.appointmentTime}
                        </td>
                        <td className={cellPad}>
                          {renderPatientLink(apt.patientName, apt.patientId)}
                        </td>
                        <td className={`${cellPad} text-xs text-[#526058]`}>
                          <span className="font-medium text-[#16211C]">{apt.department}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{apt.clinician}</span>
                        </td>
                        <td className={cellPad}>
                          <AppointmentStatusText status={apt.status} />
                        </td>
                        <td className={`${cellPad} text-right whitespace-nowrap`}>
                          <div className="inline-flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => setDetailApt(apt)}
                              className="text-xs font-medium text-[#526058] hover:text-[#16211C]"
                            >
                              Details
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(apt)}
                              className="text-xs font-medium text-[#047857] hover:text-[#0C291E]"
                              aria-label={`Update or reschedule ${apt.id}`}
                            >
                              Reschedule
                            </button>
                            {apt.status !== 'Cancelled' && apt.status !== 'Completed' && (
                              <button
                                type="button"
                                onClick={() => setCancellingApt(apt)}
                                className="text-xs font-medium text-red-700 hover:text-red-800"
                                aria-label={`Cancel appointment ${apt.id}`}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {detailApt && (
            <aside
              aria-label="Appointment detail panel"
              className="lg:col-span-4 bg-white border border-[#E4E7E2] rounded-xl p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-2 border-b border-[#E4E7E2] pb-3">
                <div>
                  <span className="text-xs font-mono text-[#526058]">{detailApt.id}</span>
                  <h3 className="text-base font-semibold text-[#16211C]">
                    {onOpenPatient ? (
                      <button
                        type="button"
                        onClick={() => onOpenPatient(detailApt.patientId)}
                        className="text-left text-[#047857] hover:underline"
                      >
                        {detailApt.patientName}
                      </button>
                    ) : (
                      detailApt.patientName
                    )}
                  </h3>
                  <div className="mt-1">
                    <AppointmentStatusText status={detailApt.status} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailApt(null)}
                  className="p-1 text-[#526058] hover:text-[#16211C]"
                  aria-label="Close appointment details"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-[#526058]">Patient ID</dt>
                  <dd className="font-mono font-medium text-[#16211C] mt-0.5">{detailApt.patientId}</dd>
                </div>
                <div>
                  <dt className="text-[#526058]">Duration</dt>
                  <dd className="font-mono font-medium text-[#16211C] mt-0.5">{detailApt.durationMinutes} min</dd>
                </div>
                <div>
                  <dt className="text-[#526058]">Date</dt>
                  <dd className="font-mono font-medium text-[#16211C] mt-0.5">{detailApt.appointmentDate}</dd>
                </div>
                <div>
                  <dt className="text-[#526058]">Time</dt>
                  <dd className="font-mono font-medium text-[#16211C] mt-0.5">{detailApt.appointmentTime}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[#526058]">Department &amp; Clinician</dt>
                  <dd className="font-medium text-[#16211C] mt-0.5">
                    {detailApt.department} · {detailApt.clinician}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[#526058]">Administrative Notes</dt>
                  <dd className="text-[#16211C] mt-0.5">{detailApt.notes || 'None recorded.'}</dd>
                </div>
              </dl>

              <div className="pt-3 border-t border-[#E4E7E2] flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEditModal(detailApt)}
                  className="flex-1 px-3 py-2 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors"
                >
                  Update / Reschedule
                </button>
                {detailApt.status !== 'Cancelled' && detailApt.status !== 'Completed' && (
                  <button
                    type="button"
                    onClick={() => setCancellingApt(detailApt)}
                    className="px-3 py-2 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {/* Create Appointment Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-apt-title"
        >
          <div className="bg-white border border-[#E4E7E2] rounded-xl w-full max-w-lg p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 id="create-apt-title" className="text-base font-semibold text-[#16211C]">
                Schedule Appointment
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-[#526058] hover:text-[#16211C]"
                aria-label="Close schedule appointment dialog"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {createError && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label htmlFor="new-apt-patient" className="block text-xs font-medium text-[#16211C] mb-1">
                  Patient
                </label>
                <select
                  id="new-apt-patient"
                  value={newPatientId}
                  onChange={(e) => setNewPatientId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} — {p.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="new-apt-date" className="block text-xs font-medium text-[#16211C] mb-1">
                    Date
                  </label>
                  <input
                    id="new-apt-date"
                    type="date"
                    required
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="new-apt-time" className="block text-xs font-medium text-[#16211C] mb-1">
                    Time
                  </label>
                  <input
                    id="new-apt-time"
                    type="time"
                    required
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="new-apt-dept" className="block text-xs font-medium text-[#16211C] mb-1">
                    Department
                  </label>
                  <select
                    id="new-apt-dept"
                    value={newDept}
                    onChange={(e) => handleDeptChangeInCreate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    {CLINIC_DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="new-apt-clinician" className="block text-xs font-medium text-[#16211C] mb-1">
                    Clinician
                  </label>
                  <select
                    id="new-apt-clinician"
                    value={newClinician}
                    onChange={(e) => setNewClinician(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    {CLINIC_CLINICIANS.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({c.department})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="new-apt-notes" className="block text-xs font-medium text-[#16211C] mb-1">
                  Administrative Notes
                </label>
                <input
                  id="new-apt-notes"
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Optional check-in or intake note"
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                />
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
                  {submitting ? 'Checking & Saving...' : 'Create Appointment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2-Step Update / Reschedule Confirmation Modal */}
      {editingApt && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-apt-title"
        >
          <div className="bg-white border border-[#E4E7E2] rounded-xl w-full max-w-xl p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 id="edit-apt-title" className="text-base font-semibold text-[#16211C]">
                  {rescheduleStep === 'confirm'
                    ? `Confirm Reschedule for ${editingApt.id}`
                    : `Update / Reschedule ${editingApt.id}`}
                </h3>
                <p className="text-xs text-[#526058] mt-0.5">
                  {editingApt.patientName} ({editingApt.patientId})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingApt(null)}
                className="p-1 text-[#526058] hover:text-[#16211C]"
                aria-label="Close update appointment dialog"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {editError && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {editError}
              </div>
            )}

            {rescheduleStep === 'edit' ? (
              <form onSubmit={handleEditFormSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="edit-apt-date" className="block text-xs font-medium text-[#16211C] mb-1">
                      Appointment Date
                    </label>
                    <input
                      id="edit-apt-date"
                      type="date"
                      required
                      value={editDate}
                      onChange={(e) => {
                        setEditDate(e.target.value);
                        setEditAvailabilityStatus(null);
                        if (editingApt.status === 'Missed' && editStatus === 'Missed') {
                          setEditStatus('Scheduled');
                        }
                      }}
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-apt-time" className="block text-xs font-medium text-[#16211C] mb-1">
                      Appointment Time
                    </label>
                    <input
                      id="edit-apt-time"
                      type="time"
                      required
                      value={editTime}
                      onChange={(e) => {
                        setEditTime(e.target.value);
                        setEditAvailabilityStatus(null);
                        if (editingApt.status === 'Missed' && editStatus === 'Missed') {
                          setEditStatus('Scheduled');
                        }
                      }}
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="edit-apt-dept" className="block text-xs font-medium text-[#16211C] mb-1">
                      Department
                    </label>
                    <select
                      id="edit-apt-dept"
                      value={editDept}
                      onChange={(e) => {
                        const dept = e.target.value;
                        setEditDept(dept);
                        const match = CLINIC_CLINICIANS.find((c) => c.department === dept);
                        if (match) setEditClinician(match.name);
                        setEditAvailabilityStatus(null);
                      }}
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                    >
                      {CLINIC_DEPARTMENTS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="edit-apt-clinician" className="block text-xs font-medium text-[#16211C] mb-1">
                      Clinician
                    </label>
                    <select
                      id="edit-apt-clinician"
                      value={editClinician}
                      onChange={(e) => {
                        setEditClinician(e.target.value);
                        setEditAvailabilityStatus(null);
                      }}
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                    >
                      {CLINIC_CLINICIANS.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="edit-apt-status" className="block text-xs font-medium text-[#16211C] mb-1">
                      Status
                    </label>
                    <select
                      id="edit-apt-status"
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as AppointmentStatus)}
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                    >
                      <option value="Scheduled">Scheduled</option>
                      <option value="Confirmed">Confirmed</option>
                      <option value="Completed">Completed</option>
                      <option value="Missed">Missed</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>

                {/* Inline Slot Availability Check */}
                <div className="p-3.5 bg-[#F7F8F6] border border-[#E4E7E2] rounded-lg space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#16211C]">
                      Slot Availability Check
                    </span>
                    <button
                      type="button"
                      disabled={editSlotChecking}
                      onClick={runEditAvailabilityCheck}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#047857] bg-[#EDF4F0] hover:bg-[#D7E6DD] rounded-md transition-colors disabled:opacity-50"
                    >
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      {editSlotChecking ? 'Checking...' : 'Verify Slot Availability'}
                    </button>
                  </div>

                  {editAvailabilityStatus && (
                    <div className="space-y-2">
                      <div
                        className={`p-2.5 rounded-md border text-xs flex items-start gap-2 ${
                          editAvailabilityStatus.available
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : 'bg-red-50 border-red-200 text-red-800'
                        }`}
                      >
                        {editAvailabilityStatus.available ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" aria-hidden="true" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" aria-hidden="true" />
                        )}
                        <span>{editAvailabilityStatus.message}</span>
                      </div>

                      {editAvailabilityStatus.suggestions.length > 0 && (
                        <div>
                          <div className="text-[11px] font-medium text-[#526058] mb-1.5">
                            Available open slots for {editClinician}:
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {editAvailabilityStatus.suggestions.map((slot, idx) => (
                              <button
                                key={`${slot.date}-${slot.time}-${idx}`}
                                type="button"
                                onClick={() => {
                                  setEditDate(slot.date);
                                  setEditTime(slot.time);
                                  setEditDept(slot.department);
                                  setEditClinician(slot.clinician);
                                  if (editingApt.status === 'Missed' && editStatus === 'Missed') {
                                    setEditStatus('Scheduled');
                                  }
                                  setEditAvailabilityStatus({
                                    checked: true,
                                    available: true,
                                    message: `Selected open slot ${slot.date} at ${slot.time} with ${slot.clinician}.`,
                                    suggestions: editAvailabilityStatus.suggestions,
                                  });
                                }}
                                className="px-2 py-1 text-[11px] font-mono bg-white hover:bg-[#EDF4F0] text-[#0C291E] border border-[#D4DAD4] rounded transition-colors"
                              >
                                {slot.date} · {slot.time}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="edit-apt-notes" className="block text-xs font-medium text-[#16211C] mb-1">
                    Notes
                  </label>
                  <input
                    id="edit-apt-notes"
                    type="text"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E4E7E2]">
                  <button
                    type="button"
                    onClick={() => setEditingApt(null)}
                    className="px-4 py-2 text-sm font-medium text-[#526058] border border-[#E4E7E2] rounded-lg"
                  >
                    Discard
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || editSlotChecking}
                    className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50"
                  >
                    {editSlotChecking
                      ? 'Checking Slot...'
                      : hasScheduleChanged
                        ? 'Review Reschedule'
                        : submitting
                          ? 'Updating...'
                          : 'Confirm Update'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 rounded-lg bg-[#EDF4F0] border border-[#B7DFCA] text-xs text-[#0C291E] flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <div className="font-semibold">Availability Verified — Ready for Administrator Confirmation</div>
                    <p className="text-[#3A5247] mt-0.5">
                      Please review the schedule change below before saving to the clinic database.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-lg bg-[#F7F8F6] border border-[#E4E7E2] space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[#526058]">
                      Previous Schedule
                    </div>
                    <div className="font-mono font-semibold text-[#16211C]">
                      {editingApt.appointmentDate} · {editingApt.appointmentTime}
                    </div>
                    <div className="text-[#526058]">
                      {editingApt.department} · {editingApt.clinician}
                    </div>
                    <div className="text-[#526058]">Status: {editingApt.status}</div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[#047857]">
                      Proposed New Schedule
                    </div>
                    <div className="font-mono font-semibold text-[#0C291E]">
                      {editDate} · {editTime}
                    </div>
                    <div className="text-[#16211C]">
                      {editDept} · {editClinician}
                    </div>
                    <div className="text-[#047857] font-medium">Status: {editStatus}</div>
                  </div>
                </div>

                {editNotes && (
                  <div className="text-xs text-[#526058]">
                    <span className="font-medium text-[#16211C]">Notes:</span> {editNotes}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E4E7E2]">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setRescheduleStep('edit')}
                    className="px-4 py-2 text-sm font-medium text-[#526058] border border-[#E4E7E2] rounded-lg"
                  >
                    Back to Edit
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={persistAppointmentUpdate}
                    className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50"
                  >
                    {submitting ? 'Saving...' : 'Confirm & Save Reschedule'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Explicit Cancel Confirmation Modal */}
      {cancellingApt && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-apt-title"
        >
          <div className="bg-white border border-[#E4E7E2] rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 id="cancel-apt-title" className="text-base font-semibold text-[#16211C]">
              Confirm Appointment Cancellation
            </h3>
            <p className="text-sm text-[#526058]">
              Cancel appointment <span className="font-mono font-semibold text-[#16211C]">{cancellingApt.id}</span> for{' '}
              <span className="font-medium text-[#16211C]">{cancellingApt.patientName}</span> on{' '}
              <span className="font-mono">{cancellingApt.appointmentDate} {cancellingApt.appointmentTime}</span>?
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCancellingApt(null)}
                className="px-4 py-2 text-sm font-medium text-[#526058] border border-[#E4E7E2] rounded-lg"
              >
                Keep Appointment
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmCancel}
                className="px-4 py-2 text-sm font-medium text-white bg-red-700 hover:bg-red-800 rounded-lg disabled:opacity-50"
              >
                {submitting ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
