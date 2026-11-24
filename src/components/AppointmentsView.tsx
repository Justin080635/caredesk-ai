import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  List,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  createAppointmentRecord,
  deleteAppointmentRecord,
  fetchAppointmentById,
  fetchAppointments,
  fetchAppointmentsPaginated,
  fetchAvailableSlots,
  fetchDoctorAvailability,
  fetchOverviewReport,
  fetchPatients,
  fetchStaff,
  updateAppointmentRecord,
} from '../client/api';
import { APPOINTMENT_TYPES, CLINIC_CLINICIANS, CLINIC_DEPARTMENTS } from '../shared/constants';
import type {
  Appointment,
  AppointmentPaginationMeta,
  AppointmentSortField,
  AppointmentStatus,
  AppointmentType,
  AvailableSlot,
  CalendarDaySummary,
  DoctorAvailabilitySummary,
  Patient,
  SortDirection,
  StaffMember,
  UserRole,
} from '../shared/types';
import { ClinicCalendar } from './ClinicCalendar';
import { ClinicEmptyIllustration, EditorialAvatar } from './ClinicIllustrations';
import { ModalShell } from './ModalShell';
import { AppointmentStatusText, DoctorDutyStatusText, RequestStatusText } from './StatusText';

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
  onOpenStaffByName?: (clinicianName: string) => void;
  sessionRole?: UserRole;
  compactDensity?: boolean;
}

const APPOINTMENTS_PAGE_SIZE = 10;

function getVisiblePageNumbers(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, idx) => idx + 1);
  }
  const pages: Array<number | 'ellipsis'> = [1];
  const left = Math.max(2, currentPage - 1);
  const right = Math.min(totalPages - 1, currentPage + 1);
  if (left > 2) pages.push('ellipsis');
  for (let p = left; p <= right; p += 1) {
    pages.push(p);
  }
  if (right < totalPages - 1) pages.push('ellipsis');
  pages.push(totalPages);
  return pages;
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
  onOpenStaffByName,
  sessionRole = 'administrator',
  compactDensity = false,
}: AppointmentsViewProps) {
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [paginationMeta, setPaginationMeta] = useState<AppointmentPaginationMeta>({
    count: 0,
    total: 0,
    page: 1,
    pageSize: APPOINTMENTS_PAGE_SIZE,
    totalPages: 1,
    sortBy: 'appointmentDate',
    sortDir: 'asc',
    statusCounts: {
      Scheduled: 0,
      Confirmed: 0,
      Completed: 0,
      Cancelled: 0,
      Missed: 0,
    },
  });
  const [calendarSummaries, setCalendarSummaries] = useState<CalendarDaySummary[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [cliniciansList, setCliniciansList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState(initialStatusFilter ?? 'All');
  const [deptFilter, setDeptFilter] = useState('All');
  const [clinicianFilter, setClinicianFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState(initialDateFilter ?? '');
  const [calendarDate, setCalendarDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<AppointmentSortField>('appointmentDate');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Availability Drawer State
  const [showAvailability, setShowAvailability] = useState(false);
  const [availDept, setAvailDept] = useState('All');
  const [availSlots, setAvailSlots] = useState<AvailableSlot[]>([]);
  const [availDoctors, setAvailDoctors] = useState<DoctorAvailabilitySummary[]>([]);
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
  const [newType, setNewType] = useState<AppointmentType>('Consultation');
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
  const [editType, setEditType] = useState<AppointmentType>('Consultation');
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

  // Cancel & Delete Confirmation Modals
  const [cancellingApt, setCancellingApt] = useState<Appointment | null>(null);
  const [deletingApt, setDeletingApt] = useState<Appointment | null>(null);

  const canWrite = sessionRole === 'administrator';

  const clinicianOptions = useMemo(() => {
    const map = new Map<string, { name: string; department: string; staffId?: string }>();
    for (const st of cliniciansList) {
      map.set(st.fullName, { name: st.fullName, department: st.department, staffId: st.id });
    }
    if (map.size === 0) {
      for (const c of CLINIC_CLINICIANS) {
        map.set(c.name, { name: c.name, department: c.department });
      }
    }
    return Array.from(map.values());
  }, [cliniciansList]);

  useEffect(() => {
    if (initialStatusFilter !== undefined) {
      setStatusFilter(initialStatusFilter);
      setPage(1);
    }
  }, [initialStatusFilter]);

  useEffect(() => {
    if (initialDateFilter !== undefined) {
      setViewMode('list');
      setDateFilter(initialDateFilter);
      setPage(1);
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
    setLoadError(null);
    try {
      if (viewMode === 'calendar') {
        const [apts, pts, overview, staffClinicians] = await Promise.all([
          fetchAppointments({
            date: calendarDate,
            status: statusFilter,
            department: deptFilter,
            clinician: clinicianFilter,
            search,
          }),
          fetchPatients(),
          fetchOverviewReport(),
          fetchStaff({ role: 'Clinician' }).catch(() => []),
        ]);
        setAppointments(apts);
        setPatients(pts);
        setCalendarSummaries(overview.calendarSummary);
        setCliniciansList(staffClinicians);
      } else {
        const [paginated, pts, overview, staffClinicians] = await Promise.all([
          fetchAppointmentsPaginated({
            page,
            pageSize: APPOINTMENTS_PAGE_SIZE,
            date: dateFilter || undefined,
            status: statusFilter,
            department: deptFilter,
            clinician: clinicianFilter,
            search,
            sortBy,
            sortDir,
          }),
          fetchPatients(),
          fetchOverviewReport(),
          fetchStaff({ role: 'Clinician' }).catch(() => []),
        ]);
        setAppointments(paginated.data);
        setPaginationMeta(paginated.meta);
        if (paginated.meta.page !== page) {
          setPage(paginated.meta.page);
        }
        setPatients(pts);
        setCalendarSummaries(overview.calendarSummary);
        setCliniciansList(staffClinicians);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load appointments.';
      setLoadError(msg);
      onErrorNotice(msg);
    } finally {
      setLoading(false);
    }
  }, [
    viewMode,
    calendarDate,
    dateFilter,
    statusFilter,
    deptFilter,
    clinicianFilter,
    search,
    page,
    sortBy,
    sortDir,
    onErrorNotice,
  ]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  const toggleSort = (field: AppointmentSortField) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
    setPage(1);
  };

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
      const [slots, doctors] = await Promise.all([
        fetchAvailableSlots({
          department: dept === 'All' ? undefined : dept,
          limit: 12,
        }),
        fetchDoctorAvailability({
          department: dept === 'All' ? undefined : dept,
        }).catch(() => []),
      ]);
      setAvailSlots(slots);
      setAvailDoctors(doctors);
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
    const match = clinicianOptions.find((c) => c.department === dept);
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
      const matchedDoc = clinicianOptions.find((c) => c.name === newClinician);
      const created = await createAppointmentRecord({
        patientId: newPatientId,
        staffId: matchedDoc?.staffId,
        appointmentDate: newDate,
        appointmentTime: newTime,
        department: newDept,
        appointmentType: newType,
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
    setEditType(apt.appointmentType ?? 'Consultation');
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
      setEditType(fresh.appointmentType ?? 'Consultation');
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
        editDept !== editingApt.department ||
        editType !== (editingApt.appointmentType ?? 'Consultation'))
  );

  const persistAppointmentUpdate = async () => {
    if (!editingApt) return;
    setEditError(null);
    setSubmitting(true);
    try {
      const matchedDoc = clinicianOptions.find((c) => c.name === editClinician);
      const updated = await updateAppointmentRecord(editingApt.id, {
        staffId: matchedDoc?.staffId,
        appointmentDate: editDate,
        appointmentTime: editTime,
        department: editDept,
        appointmentType: editType,
        status: editStatus,
        clinician: editClinician,
        requestStatus: 'None',
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

  const handleTriageRequest = async (
    apt: Appointment,
    action: 'approve_cancel' | 'clear_request'
  ) => {
    setSubmitting(true);
    try {
      const patch =
        action === 'approve_cancel'
          ? { status: 'Cancelled' as AppointmentStatus, requestStatus: 'None' as const }
          : { requestStatus: 'None' as const };
      const updated = await updateAppointmentRecord(apt.id, patch);
      const verified = await fetchAppointmentById(updated.id);
      if (detailApt?.id === verified.id) setDetailApt(verified);
      onSuccessNotice(
        action === 'approve_cancel'
          ? `Approved patient cancellation request for ${verified.id}.`
          : `Cleared patient request flag on ${verified.id}.`
      );
      await loadAppointments();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to process patient request.');
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

  const handleConfirmDelete = async () => {
    if (!deletingApt) return;
    setSubmitting(true);
    try {
      await deleteAppointmentRecord(deletingApt.id);
      if (detailApt?.id === deletingApt.id) setDetailApt(null);
      onSuccessNotice(`Deleted appointment ${deletingApt.id}.`);
      setDeletingApt(null);
      await loadAppointments();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to delete appointment.');
    } finally {
      setSubmitting(false);
    }
  };

  const statuses = ['All', 'Scheduled', 'Confirmed', 'Completed', 'Missed', 'Cancelled'];
  const cellPad = compactDensity ? 'py-2 px-4' : 'py-3 px-4';

  const totalMatching =
    viewMode === 'calendar' ? appointments.length : paginationMeta.total;
  const confirmedCount =
    viewMode === 'calendar'
      ? appointments.filter((a) => a.status === 'Confirmed').length
      : paginationMeta.statusCounts.Confirmed;
  const unconfirmedCount =
    viewMode === 'calendar'
      ? appointments.filter((a) => a.status === 'Scheduled').length
      : paginationMeta.statusCounts.Scheduled;
  const missedCount =
    viewMode === 'calendar'
      ? appointments.filter((a) => a.status === 'Missed').length
      : paginationMeta.statusCounts.Missed;

  const visiblePages = useMemo(
    () => getVisiblePageNumbers(paginationMeta.page, paginationMeta.totalPages),
    [paginationMeta.page, paginationMeta.totalPages]
  );

  const pageRangeStart =
    paginationMeta.total === 0
      ? 0
      : (paginationMeta.page - 1) * paginationMeta.pageSize + 1;
  const pageRangeEnd =
    paginationMeta.total === 0
      ? 0
      : Math.min(paginationMeta.page * paginationMeta.pageSize, paginationMeta.total);

  const renderSortHeader = (label: string, field: AppointmentSortField) => (
    <button
      type="button"
      onClick={() => toggleSort(field)}
      className="inline-flex items-center gap-1 font-medium text-[#526259] hover:text-[#111C17] transition-colors whitespace-nowrap"
      aria-label={`Sort by ${label} (${sortBy === field ? sortDir : 'none'})`}
    >
      <span>{label}</span>
      <ArrowUpDown
        className={`w-3 h-3 ${sortBy === field ? 'text-[#059669]' : 'text-slate-400'}`}
        aria-hidden="true"
      />
    </button>
  );

  const renderPatientLink = (patientName: string | undefined, patientId: string) => {
    const displayName = patientName ?? patientId;
    if (!onOpenPatient) {
      return (
        <div className="flex items-center gap-2.5">
          <EditorialAvatar name={displayName} role="patient" size="sm" />
          <div>
            <div className="font-medium text-[#111C17]">{displayName}</div>
            <div className="text-xs font-mono text-[#526259]">{patientId}</div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2.5">
        <EditorialAvatar name={displayName} role="patient" size="sm" />
        <button
          type="button"
          onClick={() => onOpenPatient(patientId)}
          className="text-left group"
          aria-label={`Open patient record for ${displayName}`}
        >
          <div className="font-medium text-[#047857] group-hover:underline">{displayName}</div>
          <div className="text-xs font-mono text-[#526259]">{patientId}</div>
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Schedule Summary Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0B261C] text-white rounded-xl p-4">
          <div className="text-xs font-medium text-emerald-200/85">
            {viewMode === 'calendar' ? `Visits on ${calendarDate.slice(5)}` : 'Matching Visits'}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1.5">
            {totalMatching}
          </div>
          <div className="text-[11px] text-emerald-100/75 mt-0.5">
            {viewMode === 'list'
              ? `Showing ${APPOINTMENTS_PAGE_SIZE} per page`
              : 'Matching active clinic filters'}
          </div>
        </div>

        <div className="card-surface rounded-xl p-4">
          <div className="text-xs font-medium text-[#526259]">Confirmed</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#047857] mt-1.5">
            {confirmedCount}
          </div>
          <div className="text-[11px] text-[#526259] mt-0.5">Ready for clinician check-in</div>
        </div>

        <div className="card-surface rounded-xl p-4">
          <div className="text-xs font-medium text-[#526259]">Awaiting Confirmation</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1.5">
            {unconfirmedCount}
          </div>
          <div className="text-[11px] text-[#526259] mt-0.5">Scheduled visits pending outreach</div>
        </div>

        <div className="card-surface rounded-xl p-4">
          <div className="text-xs font-medium text-[#526259]">Missed in Result Set</div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-1.5 ${
              missedCount > 0 ? 'text-[#DC2626]' : 'text-[#047857]'
            }`}
          >
            {missedCount}
          </div>
          <div className="text-[11px] text-[#526259] mt-0.5">Eligible for rescheduling</div>
        </div>
      </section>

      {/* Toolbar */}
      <div className="card-surface rounded-xl p-4 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <div className="relative flex-1 min-w-[160px] max-w-[205px]">
              <Search
                className="w-4 h-4 text-[#526259] absolute left-2.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <label htmlFor="apt-search-input" className="sr-only">
                Search appointments
              </label>
              <input
                id="apt-search-input"
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search ID, patient, clinician..."
                className="w-full pl-8 pr-2.5 py-2 text-xs sm:text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>

            {viewMode === 'list' && (
              <>
                <div className="shrink-0">
                  <label htmlFor="apt-date-filter" className="sr-only">
                    Filter by date
                  </label>
                  <input
                    id="apt-date-filter"
                    type="date"
                    value={dateFilter}
                    onChange={(e) => {
                      setDateFilter(e.target.value);
                      setPage(1);
                    }}
                    className="px-2.5 py-2 text-xs sm:text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  />
                </div>
                {dateFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setDateFilter('');
                      setPage(1);
                    }}
                    className="text-xs font-medium text-[#526259] hover:text-[#111C17] whitespace-nowrap shrink-0"
                  >
                    All Dates
                  </button>
                )}
              </>
            )}

            <div className="shrink-0">
              <label htmlFor="apt-dept-filter" className="sr-only">
                Filter by department
              </label>
              <select
                id="apt-dept-filter"
                value={deptFilter}
                onChange={(e) => {
                  setDeptFilter(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-2 text-xs sm:text-sm border border-[#D4DAD4] rounded-lg bg-white"
              >
                <option value="All">All Departments</option>
                {CLINIC_DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            <div className="shrink-0">
              <label htmlFor="apt-clinician-filter" className="sr-only">
                Filter by clinician
              </label>
              <select
                id="apt-clinician-filter"
                value={clinicianFilter}
                onChange={(e) => {
                  setClinicianFilter(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-2 text-xs sm:text-sm border border-[#D4DAD4] rounded-lg bg-white"
              >
                <option value="All">All Clinicians</option>
                {clinicianOptions.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div
              className="flex items-center gap-1 p-1 bg-[#F1F5F2] rounded-lg"
              role="group"
              aria-label="Appointment display view"
            >
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  viewMode === 'list' ? 'bg-white text-[#0B261C] shadow-xs' : 'text-[#526259]'
                }`}
              >
                <List className="w-3.5 h-3.5" aria-hidden="true" />
                List View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  viewMode === 'calendar' ? 'bg-white text-[#0B261C] shadow-xs' : 'text-[#526259]'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                Calendar View
              </button>
            </div>

            <button
              type="button"
              onClick={handleOpenAvailability}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium text-[#0B261C] bg-[#ECF4EF] hover:bg-[#D7E6DD] rounded-lg transition-colors whitespace-nowrap shrink-0 btn-press"
            >
              <Clock className="w-4 h-4 text-[#047857]" aria-hidden="true" />
              {showAvailability ? 'Hide Availability' : 'Check Availability'}
            </button>

            <button
              type="button"
              disabled={!canWrite}
              title={!canWrite ? 'Administrator session required to schedule appointments' : undefined}
              onClick={() => {
                setCreateError(null);
                setShowCreateModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors whitespace-nowrap shrink-0 btn-press disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Schedule Appointment
            </button>
          </div>
        </div>

        {/* Status Segmented Control */}
        <div
          className="flex items-center gap-1 p-1 bg-[#F1F5F2] rounded-lg overflow-x-auto w-fit max-w-full"
          role="group"
          aria-label="Filter appointments by status"
        >
          {statuses.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => {
                setStatusFilter(st);
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === st
                  ? 'bg-white text-[#0B261C] shadow-xs'
                  : 'text-[#526259] hover:text-[#111C17]'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Slot Availability Finder */}
      {showAvailability && (
        <section className="card-surface rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#111C17]">
                Conflict-Free Slot Availability
              </h3>
              <p className="text-xs text-[#526259] mt-0.5">
                Next open 30-minute clinic slots computed from live clinician calendars.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="avail-dept-select" className="text-xs text-[#526259]">
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
          ) : (
            <div className="space-y-4">
              {availDoctors.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {availDoctors.map((doc) => (
                    <div
                      key={doc.staffId}
                      className="p-3 rounded-lg border border-[#E3E8E4] bg-white space-y-1.5 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-[#111C17]">{doc.fullName}</div>
                          <div className="text-[11px] text-[#526259]">
                            {doc.department} · {doc.workingHoursLabel}
                          </div>
                        </div>
                        <DoctorDutyStatusText status={doc.effectiveOperationalState} />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#526259]">
                        <span>
                          Load {doc.bookedCount}/{doc.maxDailyCapacity}
                        </span>
                        {doc.nextAvailableSlot && (
                          <button
                            type="button"
                            onClick={() => handleBookFromSlot(doc.nextAvailableSlot!)}
                            className="text-[#047857] hover:underline font-semibold"
                          >
                            Book {doc.nextAvailableSlot.date} {doc.nextAvailableSlot.time}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {availSlots.length === 0 ? (
                <p className="text-xs text-[#526259]">No open slots available in this range.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {availSlots.map((slot, idx) => (
                    <div
                      key={`${slot.date}-${slot.time}-${slot.clinician}-${idx}`}
                      className="p-3 bg-[#F6F8F6] rounded-lg flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="text-xs font-mono tabular-nums font-semibold text-[#0B261C]">
                          {slot.date} · {slot.time}
                        </div>
                        <div className="text-[11px] text-[#526259] mt-0.5">
                          {slot.department} · {slot.clinician}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleBookFromSlot(slot)}
                        className="px-2.5 py-1 text-xs font-medium text-[#047857] bg-white hover:bg-[#ECF4EF] border border-[#C6DFD1] rounded transition-colors whitespace-nowrap shrink-0"
                      >
                        Book
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Calendar View Split */}
      {viewMode === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5 card-surface rounded-xl p-5">
            <ClinicCalendar
              selectedDate={calendarDate}
              onSelectDate={(d) => setCalendarDate(d)}
              daySummaries={calendarSummaries}
            />
          </div>

          <div className="lg:col-span-7 card-surface rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E3E8E4] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#111C17]">
                  Schedule for <span className="font-mono">{calendarDate}</span>
                </h2>
                <p className="text-xs text-[#526259]">
                  {appointments.length} appointment{appointments.length === 1 ? '' : 's'} matching filters
                </p>
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    setNewDate(calendarDate);
                    setCreateError(null);
                    setShowCreateModal(true);
                  }}
                  className="text-xs font-medium text-[#047857] hover:text-[#0B261C]"
                >
                  + Book on {calendarDate}
                </button>
              )}
            </div>

            {appointments.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <ClinicEmptyIllustration variant="appointments" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-[#111C17]">
                    No appointments scheduled for this date
                  </p>
                  <p className="text-xs text-[#526259]">
                    Book a conflict-free slot on {calendarDate} or adjust status filters.
                  </p>
                </div>
                {canWrite && (
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setNewDate(calendarDate);
                        setCreateError(null);
                        setShowCreateModal(true);
                      }}
                      className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors btn-press"
                    >
                      Book on {calendarDate}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="divide-y divide-[#EEF2EF]">
                {appointments.map((apt) => (
                  <div
                    key={apt.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F6F8F6] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <EditorialAvatar
                        name={apt.patientName ?? apt.patientId}
                        role="patient"
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono tabular-nums font-semibold text-[#0B261C]">
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
                            <span className="font-semibold text-[#111C17]">{apt.patientName}</span>
                          )}
                          <span className="font-mono text-[#526259]">
                            · {apt.patientId} · {apt.id}
                          </span>
                        </div>
                        <div className="text-xs text-[#526259] mt-1">
                          {apt.department} ·{' '}
                          {onOpenStaffByName ? (
                            <button
                              type="button"
                              onClick={() => onOpenStaffByName(apt.clinician)}
                              className="text-[#047857] hover:underline font-medium"
                            >
                              {apt.clinician}
                            </button>
                          ) : (
                            apt.clinician
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <AppointmentStatusText status={apt.status} />
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditModal(apt)}
                          className="text-xs font-medium text-[#047857] hover:text-[#0B261C]"
                        >
                          Reschedule / Update
                        </button>
                      )}
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
            } card-surface rounded-xl overflow-hidden`}
          >
            <div className="px-5 py-3.5 border-b border-[#E3E8E4] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-[#111C17]">Appointment Schedule</h2>
                <span className="text-xs font-mono tabular-nums text-[#526259]">
                  · Page {paginationMeta.page} of {paginationMeta.totalPages}
                </span>
              </div>
              <span className="text-xs font-mono tabular-nums text-[#526259]">
                {paginationMeta.total} matching appointment{paginationMeta.total === 1 ? '' : 's'}
              </span>
            </div>

            {loading ? (
              <div className="p-5 space-y-3" aria-busy="true" aria-label="Loading appointments">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-[#F6F8F6] animate-pulse">
                    <div className="w-8 h-8 rounded-full bg-[#E3E8E4] shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 w-44 bg-[#E3E8E4] rounded" />
                      <div className="h-2.5 w-32 bg-[#EEF2EF] rounded" />
                    </div>
                    <div className="h-3.5 w-20 bg-[#E3E8E4] rounded" />
                  </div>
                ))}
              </div>
            ) : loadError ? (
              <div className="p-10 text-center space-y-3">
                <AlertTriangle className="w-8 h-8 text-red-700 mx-auto" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-[#111C17]">
                    Unable to load appointment schedule
                  </p>
                  <p className="text-xs text-[#526259] max-w-md mx-auto">{loadError}</p>
                </div>
                <button
                  type="button"
                  onClick={loadAppointments}
                  className="px-4 py-2 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg btn-press"
                >
                  Retry
                </button>
              </div>
            ) : appointments.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <ClinicEmptyIllustration variant="appointments" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-[#111C17]">
                    No appointments match the current filters
                  </p>
                  <p className="text-xs text-[#526259]">
                    Clear active filters or schedule a new clinic visit.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 pt-1">
                  {(search ||
                    dateFilter ||
                    statusFilter !== 'All' ||
                    deptFilter !== 'All' ||
                    clinicianFilter !== 'All') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setDateFilter('');
                        setStatusFilter('All');
                        setDeptFilter('All');
                        setClinicianFilter('All');
                        setPage(1);
                      }}
                      className="px-3.5 py-1.5 text-xs font-medium text-[#111C17] bg-white hover:bg-[#F6F8F6] border border-[#D4DAD4] rounded-lg transition-colors btn-press"
                    >
                      Clear Filters
                    </button>
                  )}
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => {
                        setCreateError(null);
                        setShowCreateModal(true);
                      }}
                      className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors btn-press"
                    >
                      Schedule Appointment
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#E3E8E4] bg-[#F6F8F6] text-xs font-medium text-[#526259]">
                        <th className="py-2.5 px-4">{renderSortHeader('ID', 'id')}</th>
                        <th className="py-2.5 px-4">
                          {renderSortHeader('Date & Time', 'appointmentDate')}
                        </th>
                        <th className="py-2.5 px-4">{renderSortHeader('Patient', 'patientName')}</th>
                        <th className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            {renderSortHeader('Department', 'department')}
                            <span aria-hidden="true">·</span>
                            {renderSortHeader('Clinician', 'clinician')}
                          </div>
                        </th>
                        <th className="py-2.5 px-4">{renderSortHeader('Status', 'status')}</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EEF2EF] text-sm animate-view-enter">
                      {appointments.map((apt) => (
                        <tr
                          key={apt.id}
                          className={`hover:bg-[#F6F8F6] transition-colors ${
                            detailApt?.id === apt.id ? 'bg-[#ECF4EF]/65' : ''
                          }`}
                        >
                          <td className={`${cellPad} font-mono tabular-nums text-xs font-semibold text-[#0B261C]`}>
                            <button
                              type="button"
                              onClick={() => setDetailApt(apt)}
                              className="hover:underline text-left"
                            >
                              {apt.id}
                            </button>
                          </td>
                          <td className={`${cellPad} font-mono tabular-nums text-xs text-[#111C17] whitespace-nowrap`}>
                            {apt.appointmentDate} · {apt.appointmentTime}
                          </td>
                          <td className={cellPad}>
                            {renderPatientLink(apt.patientName, apt.patientId)}
                          </td>
                          <td className={`${cellPad} text-xs text-[#526259]`}>
                            <span className="font-medium text-[#111C17]">{apt.department}</span>
                            <span aria-hidden="true"> · </span>
                            {onOpenStaffByName ? (
                              <button
                                type="button"
                                onClick={() => onOpenStaffByName(apt.clinician)}
                                className="text-[#047857] hover:underline font-medium"
                              >
                                {apt.clinician}
                              </button>
                            ) : (
                              <span>{apt.clinician}</span>
                            )}
                          </td>
                          <td className={cellPad}>
                            <div className="space-y-1">
                              <AppointmentStatusText status={apt.status} />
                              <RequestStatusText status={apt.requestStatus} />
                            </div>
                          </td>
                          <td className={`${cellPad} text-right whitespace-nowrap`}>
                            <div className="inline-flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => setDetailApt(apt)}
                                className="text-xs font-medium text-[#526259] hover:text-[#111C17]"
                              >
                                Details
                              </button>
                              {canWrite && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEditModal(apt)}
                                    className="text-xs font-medium text-[#047857] hover:text-[#0B261C]"
                                    aria-label={`Update or reschedule ${apt.id}`}
                                  >
                                    Reschedule
                                  </button>
                                  {apt.status !== 'Cancelled' && apt.status !== 'Completed' && (
                                    <button
                                      type="button"
                                      onClick={() => setCancellingApt(apt)}
                                      className="text-xs font-medium text-amber-700 hover:text-amber-800"
                                      aria-label={`Cancel appointment ${apt.id}`}
                                    >
                                      Cancel
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setDeletingApt(apt)}
                                    className="text-xs font-medium text-red-700 hover:text-red-800 inline-flex items-center gap-1"
                                    aria-label={`Delete appointment ${apt.id}`}
                                  >
                                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Bar */}
                <nav
                  aria-label="Appointment schedule pagination"
                  className="px-5 py-3.5 border-t border-[#E3E8E4] bg-[#F6F8F6]/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="text-xs text-[#526259] font-mono tabular-nums">
                    Showing <span className="font-semibold text-[#111C17]">{pageRangeStart}</span>–
                    <span className="font-semibold text-[#111C17]">{pageRangeEnd}</span> of{' '}
                    <span className="font-semibold text-[#111C17]">{paginationMeta.total}</span>{' '}
                    matching appointments · Page{' '}
                    <span className="font-semibold text-[#0B261C]">{paginationMeta.page}</span> of{' '}
                    <span className="font-semibold text-[#0B261C]">
                      {paginationMeta.totalPages}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={paginationMeta.page <= 1 || loading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#111C17] bg-white hover:bg-[#ECF4EF] border border-[#D4DAD4] rounded-lg disabled:opacity-45 disabled:pointer-events-none transition-colors"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                      Previous
                    </button>

                    <div className="flex items-center gap-1">
                      {visiblePages.map((item, idx) =>
                        item === 'ellipsis' ? (
                          <span
                            key={`ellipsis-${idx}`}
                            className="px-1.5 text-xs text-[#526259] select-none"
                          >
                            …
                          </span>
                        ) : (
                          <button
                            key={item}
                            type="button"
                            onClick={() => setPage(item)}
                            aria-label={`Page ${item}`}
                            aria-current={item === paginationMeta.page ? 'page' : undefined}
                            className={`min-w-[30px] h-[30px] px-2 text-xs font-mono font-medium rounded-lg border transition-colors ${
                              item === paginationMeta.page
                                ? 'bg-[#0B261C] text-white border-[#0B261C]'
                                : 'bg-white text-[#111C17] border-[#D4DAD4] hover:bg-[#ECF4EF]'
                            }`}
                          >
                            {item}
                          </button>
                        )
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={paginationMeta.page >= paginationMeta.totalPages || loading}
                      onClick={() =>
                        setPage((p) => Math.min(paginationMeta.totalPages, p + 1))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#111C17] bg-white hover:bg-[#ECF4EF] border border-[#D4DAD4] rounded-lg disabled:opacity-45 disabled:pointer-events-none transition-colors"
                      aria-label="Next page"
                    >
                      Next
                      <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </nav>
              </>
            )}
          </div>

          {detailApt && (
            <aside
              aria-label="Appointment detail panel"
              className="lg:col-span-4 lg:sticky lg:top-20 card-surface rounded-xl p-5 space-y-4 animate-view-enter"
            >
              <div className="flex items-start justify-between gap-2 border-b border-[#E3E8E4] pb-3">
                <div className="flex items-start gap-3">
                  <EditorialAvatar
                    name={detailApt.patientName ?? detailApt.patientId}
                    role="patient"
                    size="md"
                  />
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
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <AppointmentStatusText status={detailApt.status} />
                      <RequestStatusText status={detailApt.requestStatus} />
                    </div>
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
                  <dt className="text-[#526058]">Visit Type &amp; Duration</dt>
                  <dd className="font-mono font-medium text-[#16211C] mt-0.5">
                    {detailApt.appointmentType ?? 'Consultation'} · {detailApt.durationMinutes} min
                  </dd>
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
                    {detailApt.department} ·{' '}
                    {onOpenStaffByName ? (
                      <button
                        type="button"
                        onClick={() => onOpenStaffByName(detailApt.clinician)}
                        className="text-[#047857] hover:underline"
                      >
                        {detailApt.clinician}
                      </button>
                    ) : (
                      detailApt.clinician
                    )}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[#526058]">Administrative Notes</dt>
                  <dd className="text-[#16211C] mt-0.5">{detailApt.notes || 'None recorded.'}</dd>
                </div>
                {detailApt.requestStatus && detailApt.requestStatus !== 'None' && (
                  <div className="col-span-2 p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <RequestStatusText status={detailApt.requestStatus} />
                    </div>
                    {detailApt.requestNotes && (
                      <p className="text-xs text-amber-900">{detailApt.requestNotes}</p>
                    )}
                    {canWrite && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {detailApt.requestStatus === 'Reschedule Requested' && (
                          <button
                            type="button"
                            onClick={() => openEditModal(detailApt)}
                            className="px-2.5 py-1 text-[11px] font-medium text-white bg-[#059669] hover:bg-[#047857] rounded"
                          >
                            Approve Reschedule
                          </button>
                        )}
                        {detailApt.requestStatus === 'Cancellation Requested' && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleTriageRequest(detailApt, 'approve_cancel')}
                            className="px-2.5 py-1 text-[11px] font-medium text-white bg-red-700 hover:bg-red-800 rounded disabled:opacity-50"
                          >
                            Approve Cancellation
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleTriageRequest(detailApt, 'clear_request')}
                          className="px-2.5 py-1 text-[11px] font-medium text-[#111C17] bg-white border border-[#D4DAD4] rounded disabled:opacity-50"
                        >
                          Clear Request
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </dl>

              {canWrite && (
                <div className="pt-3 border-t border-[#E4E7E2] flex flex-wrap items-center gap-2">
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
                      className="px-3 py-2 text-xs font-medium text-amber-700 border border-amber-200 hover:bg-amber-50 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDeletingApt(detailApt)}
                    className="px-3 py-2 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                </div>
              )}
            </aside>
          )}
        </div>
      )}

      {/* Create Appointment Modal */}
      <ModalShell
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        labelledBy="create-apt-title"
        maxWidthClass="max-w-lg"
      >
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
                    {clinicianOptions.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({c.department})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="new-apt-type" className="block text-xs font-medium text-[#16211C] mb-1">
                  Appointment Type
                </label>
                <select
                  id="new-apt-type"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as AppointmentType)}
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                >
                  {APPOINTMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
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
                  className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 btn-press"
                >
                  {submitting ? 'Checking & Saving...' : 'Create Appointment'}
                </button>
              </div>
            </form>
      </ModalShell>

      {/* 2-Step Update / Reschedule Confirmation Modal */}
      <ModalShell
        open={Boolean(editingApt)}
        onClose={() => setEditingApt(null)}
        labelledBy="edit-apt-title"
        maxWidthClass="max-w-xl"
      >
        {editingApt && (
          <>
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

            <div className="flex items-center gap-2 text-[11px] font-medium text-[#526259] border-b border-[#EEF2EF] pb-3">
              <span
                className={
                  rescheduleStep === 'edit' ? 'text-[#047857] font-semibold' : 'text-[#526259]'
                }
              >
                1. Schedule &amp; Availability
              </span>
              <span aria-hidden="true">/</span>
              <span
                className={
                  rescheduleStep === 'confirm' ? 'text-[#047857] font-semibold' : 'text-[#526259]'
                }
              >
                2. Review &amp; Confirm
              </span>
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
                        const match = clinicianOptions.find((c) => c.department === dept);
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
                      {clinicianOptions.map((c) => (
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

                <div>
                  <label htmlFor="edit-apt-type" className="block text-xs font-medium text-[#16211C] mb-1">
                    Appointment Type
                  </label>
                  <select
                    id="edit-apt-type"
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as AppointmentType)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    {APPOINTMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
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
                    className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 btn-press"
                  >
                    {submitting ? 'Saving...' : 'Confirm & Save Reschedule'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </ModalShell>

      {/* Explicit Cancel Confirmation Modal */}
      <ModalShell
        open={Boolean(cancellingApt)}
        onClose={() => setCancellingApt(null)}
        labelledBy="cancel-apt-title"
        maxWidthClass="max-w-md"
      >
        {cancellingApt && (
          <>
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
                className="px-4 py-2 text-sm font-medium text-white bg-red-700 hover:bg-red-800 rounded-lg disabled:opacity-50 btn-press"
              >
                {submitting ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </>
        )}
      </ModalShell>

      {/* Explicit Delete Confirmation Modal */}
      <ModalShell
        open={Boolean(deletingApt)}
        onClose={() => setDeletingApt(null)}
        labelledBy="delete-apt-title"
        maxWidthClass="max-w-md"
      >
        {deletingApt && (
          <>
            <h3 id="delete-apt-title" className="text-base font-semibold text-[#16211C]">
              Delete Appointment Record
            </h3>
            <p className="text-sm text-[#526058]">
              Permanently remove appointment{' '}
              <span className="font-mono font-semibold text-[#16211C]">{deletingApt.id}</span> for{' '}
              <span className="font-medium text-[#16211C]">{deletingApt.patientName}</span> on{' '}
              <span className="font-mono">{deletingApt.appointmentDate} {deletingApt.appointmentTime}</span>? This cannot be undone and is recorded in the audit log.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingApt(null)}
                className="px-4 py-2 text-sm font-medium text-[#526058] border border-[#E4E7E2] rounded-lg"
              >
                Keep Record
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-700 hover:bg-red-800 rounded-lg disabled:opacity-50 btn-press"
              >
                {submitting ? 'Deleting...' : 'Delete Appointment'}
              </button>
            </div>
          </>
        )}
      </ModalShell>
    </div>
  );
}
