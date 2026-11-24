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
  DoctorAvailabilitySummary,
  Patient,
  SortDirection,
  StaffMember,
  UserRole,
} from '../shared/types';
import {
  addDaysIso,
  buildWeekCalendarColumns,
  formatIsoDate,
  getCalendarBlockLabel,
} from '../utils/workspaceMath';
import { ClinicEmptyIllustration, EditorialAvatar } from './ClinicIllustrations';
import { ModalShell } from './ModalShell';
import { AppointmentStatusText, DoctorDutyStatusText, RequestStatusText } from './StatusText';

export interface AppointmentsRailAction {
  type: 'edit' | 'cancel' | 'delete' | 'triage_cancel' | 'triage_clear';
  apt: Appointment;
  seq: number;
}

interface AppointmentsViewProps {
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  openCreateSignal: number;
  prefillPatientId?: string | null;
  initialStatusFilter?: string;
  initialDateFilter?: string;
  initialDetailAppointmentId?: string | null;
  activeDate?: string;
  onSelectDate?: (date: string) => void;
  selectedDetail?: Appointment | null;
  onSelectDetail?: (apt: Appointment | null) => void;
  onDayAppointmentsChange?: (appointments: Appointment[]) => void;
  railActionSignal?: AppointmentsRailAction | null;
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

function getEventBlockClasses(type?: AppointmentType, isSelected = false): string {
  const ring = isSelected ? 'ring-2 ring-[#0F3D2E] shadow-sm' : 'hover:shadow-xs';
  if (type === 'New Patient') {
    return `bg-[#E5F7EE] border-[#A7DFC4] text-[#0F3D2E] ${ring}`;
  }
  if (type === 'Follow-Up') {
    return `bg-[#FFF4E5] border-[#F6D39D] text-[#78350F] ${ring}`;
  }
  if (type === 'Urgent') {
    return `bg-[#FFEAF0] border-[#F8B4C6] text-[#881337] ${ring}`;
  }
  if (type === 'Procedure') {
    return `bg-[#F1EBFC] border-[#D7C6F4] text-[#4C1D95] ${ring}`;
  }
  return `bg-[#E9F3FC] border-[#BBD8F4] text-[#0C4A6E] ${ring}`;
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
  activeDate: controlledDate,
  onSelectDate,
  selectedDetail: controlledDetail,
  onSelectDetail,
  onDayAppointmentsChange,
  railActionSignal,
  onOpenPatient,
  onOpenStaffByName,
  sessionRole = 'administrator',
  compactDensity = false,
}: AppointmentsViewProps) {
  const todayDate = useMemo(() => formatIsoDate(new Date()), []);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [calendarScale, setCalendarScale] = useState<'week' | 'day'>('week');
  const [internalCalendarDate, setInternalCalendarDate] = useState(todayDate);
  const focusDate = controlledDate || internalCalendarDate;

  const [calendarAppointments, setCalendarAppointments] = useState<Appointment[]>([]);
  const [listAppointments, setListAppointments] = useState<Appointment[]>([]);
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
  const [patients, setPatients] = useState<Patient[]>([]);
  const [cliniciansList, setCliniciansList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState(initialStatusFilter ?? 'All');
  const [deptFilter, setDeptFilter] = useState('All');
  const [clinicianFilter, setClinicianFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState(initialDateFilter ?? '');
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

  // Selected detail appointment (synced with RightRail)
  const [internalDetailApt, setInternalDetailApt] = useState<Appointment | null>(null);
  const detailApt = controlledDetail !== undefined ? controlledDetail : internalDetailApt;
  const setDetailApt = useCallback(
    (apt: Appointment | null) => {
      setInternalDetailApt(apt);
      onSelectDetail?.(apt);
    },
    [onSelectDetail]
  );

  // Create Appointment Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPatientId, setNewPatientId] = useState('P-1042');
  const [newDate, setNewDate] = useState(todayDate);
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

  const setActiveFocusDate = useCallback(
    (d: string) => {
      setInternalCalendarDate(d);
      onSelectDate?.(d);
    },
    [onSelectDate]
  );

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
    if (initialDateFilter !== undefined && initialDateFilter !== '') {
      setActiveFocusDate(initialDateFilter);
      setDateFilter(initialDateFilter);
      setPage(1);
    }
  }, [initialDateFilter, setActiveFocusDate]);

  useEffect(() => {
    if (!initialDetailAppointmentId) return;
    let cancelled = false;
    fetchAppointmentById(initialDetailAppointmentId)
      .then((apt) => {
        if (!cancelled) {
          setDetailApt(apt);
          setActiveFocusDate(apt.appointmentDate);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialDetailAppointmentId, setDetailApt, setActiveFocusDate]);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (viewMode === 'calendar') {
        const [allMatching, pts, staffClinicians] = await Promise.all([
          fetchAppointments({
            status: statusFilter,
            department: deptFilter,
            clinician: clinicianFilter,
            search,
          }),
          fetchPatients(),
          fetchStaff({ role: 'Clinician' }).catch(() => []),
        ]);
        setCalendarAppointments(allMatching);
        setPatients(pts);
        setCliniciansList(staffClinicians);
        onDayAppointmentsChange?.(allMatching.filter((a) => a.appointmentDate === focusDate));
      } else {
        const [paginated, dayApts, pts, staffClinicians] = await Promise.all([
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
          fetchAppointments({ date: focusDate }).catch(() => []),
          fetchPatients(),
          fetchStaff({ role: 'Clinician' }).catch(() => []),
        ]);
        setListAppointments(paginated.data);
        setPaginationMeta(paginated.meta);
        if (paginated.meta.page !== page) {
          setPage(paginated.meta.page);
        }
        setPatients(pts);
        setCliniciansList(staffClinicians);
        onDayAppointmentsChange?.(dayApts);
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
    focusDate,
    dateFilter,
    statusFilter,
    deptFilter,
    clinicianFilter,
    search,
    page,
    sortBy,
    sortDir,
    onDayAppointmentsChange,
    onErrorNotice,
  ]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  // Keep Right Rail day appointments up to date whenever focusDate changes in calendar mode
  useEffect(() => {
    if (viewMode === 'calendar') {
      onDayAppointmentsChange?.(
        calendarAppointments.filter((a) => a.appointmentDate === focusDate)
      );
    }
  }, [viewMode, focusDate, calendarAppointments, onDayAppointmentsChange]);

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
      setNewDate(focusDate || todayDate);
      setCreateError(null);
      setShowCreateModal(true);
    }
  }, [openCreateSignal, prefillPatientId, focusDate, todayDate]);

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
      setActiveFocusDate(created.appointmentDate);
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

  const openEditModal = useCallback(async (apt: Appointment) => {
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
      // Fallback to snapshot
    }
  }, []);

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

  const handleTriageRequest = useCallback(
    async (apt: Appointment, action: 'approve_cancel' | 'clear_request') => {
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
    },
    [detailApt?.id, loadAppointments, onDataMutated, onErrorNotice, onSuccessNotice, setDetailApt]
  );

  // Handle actions triggered from RightRail inspector
  useEffect(() => {
    if (!railActionSignal) return;
    if (railActionSignal.type === 'edit') {
      openEditModal(railActionSignal.apt);
    } else if (railActionSignal.type === 'cancel') {
      setCancellingApt(railActionSignal.apt);
    } else if (railActionSignal.type === 'delete') {
      setDeletingApt(railActionSignal.apt);
    } else if (railActionSignal.type === 'triage_cancel') {
      handleTriageRequest(railActionSignal.apt, 'approve_cancel');
    } else if (railActionSignal.type === 'triage_clear') {
      handleTriageRequest(railActionSignal.apt, 'clear_request');
    }
  }, [railActionSignal, openEditModal, handleTriageRequest]);

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

  const weekColumns = useMemo(
    () => buildWeekCalendarColumns(calendarAppointments, focusDate, calendarScale, todayDate),
    [calendarAppointments, focusDate, calendarScale, todayDate]
  );

  const statuses = ['All', 'Scheduled', 'Confirmed', 'Completed', 'Missed', 'Cancelled'];
  const cellPad = compactDensity ? 'py-2.5 px-4' : 'py-3.5 px-4';

  const visiblePages = useMemo(
    () => getVisiblePageNumbers(paginationMeta.page, paginationMeta.totalPages),
    [paginationMeta.page, paginationMeta.totalPages]
  );

  const pageRangeStart =
    paginationMeta.total === 0 ? 0 : (paginationMeta.page - 1) * paginationMeta.pageSize + 1;
  const pageRangeEnd =
    paginationMeta.total === 0
      ? 0
      : Math.min(paginationMeta.page * paginationMeta.pageSize, paginationMeta.total);

  const renderSortHeader = (label: string, field: AppointmentSortField) => (
    <button
      type="button"
      onClick={() => toggleSort(field)}
      className="inline-flex items-center gap-1 font-semibold text-[#6B7B73] hover:text-[#1C2B25] transition-colors whitespace-nowrap"
      aria-label={`Sort by ${label} (${sortBy === field ? sortDir : 'none'})`}
    >
      <span>{label}</span>
      <ArrowUpDown
        className={`w-3 h-3 ${sortBy === field ? 'text-[#137A55]' : 'text-[#9BA8A1]'}`}
        aria-hidden="true"
      />
    </button>
  );

  return (
    <div className="space-y-5 animate-view-enter">
      {/* Toolbar & Calendar/List Toggle */}
      <div className="card-surface rounded-[24px] p-4 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <div className="relative flex-1 min-w-[165px]">
              <Search
                className="w-4 h-4 text-[#6B7B73] absolute left-3 top-1/2 -translate-y-1/2"
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
                placeholder="Search ID, patient, doctor..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-[#FAFBF9] border border-[#DCE8E0] rounded-full focus:bg-white focus:outline-none focus:border-[#34C38F]"
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
                    className="px-3 py-2 text-xs bg-[#FAFBF9] border border-[#DCE8E0] rounded-full"
                  />
                </div>
                {dateFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setDateFilter('');
                      setPage(1);
                    }}
                    className="text-xs font-semibold text-[#137A55] hover:underline whitespace-nowrap"
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
                className="px-3 py-2 text-xs bg-[#FAFBF9] border border-[#DCE8E0] rounded-full max-w-[155px]"
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
                className="px-3 py-2 text-xs bg-[#FAFBF9] border border-[#DCE8E0] rounded-full max-w-[155px]"
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
              className="flex items-center gap-1 p-1 bg-[#EEF3EF] border border-[#DCE8E0] rounded-full"
              role="group"
              aria-label="Appointment view mode"
            >
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap ${
                  viewMode === 'calendar' ? 'bg-[#0F3D2E] text-white' : 'text-[#6B7B73]'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                Calendar
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap ${
                  viewMode === 'list' ? 'bg-[#0F3D2E] text-white' : 'text-[#6B7B73]'
                }`}
              >
                <List className="w-3.5 h-3.5" aria-hidden="true" />
                List
              </button>
            </div>

            <button
              type="button"
              onClick={handleOpenAvailability}
              className="btn-press inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0F3D2E] bg-[#EEF3EF] hover:bg-[#DCE8E0] rounded-full transition-colors whitespace-nowrap"
            >
              <Clock className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
              {showAvailability ? 'Hide Slots' : 'Availability'}
            </button>
          </div>
        </div>

        {/* Status Pills */}
        <div
          className="flex flex-wrap items-center gap-1 p-1 bg-[#EEF3EF] border border-[#DCE8E0] rounded-2xl sm:rounded-full w-fit max-w-full"
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
              className={`px-3 sm:px-3.5 py-1 text-xs font-semibold rounded-full transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === st
                  ? 'bg-white text-[#0F3D2E] shadow-xs'
                  : 'text-[#6B7B73] hover:text-[#1C2B25]'
              }`}
            >
              {st === 'Scheduled' ? 'Pending' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Availability Finder Drawer */}
      {showAvailability && (
        <section className="card-surface rounded-[24px] p-5 space-y-4 animate-view-enter">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#1C2B25]">Conflict-Free Slot Availability</h3>
              <p className="text-xs text-[#6B7B73] mt-0.5">
                Next open 30-minute clinic slots across clinician calendars
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="avail-dept-select" className="text-xs text-[#6B7B73]">
                Department:
              </label>
              <select
                id="avail-dept-select"
                value={availDept}
                onChange={(e) => {
                  setAvailDept(e.target.value);
                  loadAvailability(e.target.value);
                }}
                className="px-3 py-1.5 text-xs border border-[#DCE8E0] rounded-full bg-white"
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
            <div className="h-20 bg-[#EEF3EF] rounded-2xl animate-pulse" />
          ) : (
            <div className="space-y-4">
              {availDoctors.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {availDoctors.map((doc) => (
                    <div
                      key={doc.staffId}
                      className="p-3.5 rounded-2xl border border-[#DCE8E0] bg-[#FAFBF9] space-y-1.5 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-[#1C2B25]">{doc.fullName}</div>
                          <div className="text-[11px] text-[#6B7B73]">
                            {doc.department} · {doc.workingHoursLabel}
                          </div>
                        </div>
                        <DoctorDutyStatusText status={doc.effectiveOperationalState} />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#6B7B73]">
                        <span>
                          Load {doc.bookedCount}/{doc.maxDailyCapacity}
                        </span>
                        {doc.nextAvailableSlot && (
                          <button
                            type="button"
                            onClick={() => handleBookFromSlot(doc.nextAvailableSlot!)}
                            className="text-[#137A55] hover:underline font-semibold"
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
                <p className="text-xs text-[#6B7B73]">No open slots available in this range.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {availSlots.map((slot, idx) => (
                    <div
                      key={`${slot.date}-${slot.time}-${slot.clinician}-${idx}`}
                      className="p-3 bg-[#F2F7F3] border border-[#DCE8E0] rounded-2xl flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-mono tabular-nums font-bold text-[#0F3D2E]">
                          {slot.date} · {slot.time}
                        </div>
                        <div className="text-[11px] text-[#6B7B73] truncate mt-0.5">
                          {slot.department} · {slot.clinician}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleBookFromSlot(slot)}
                        className="btn-press px-3 py-1 text-xs font-bold text-[#0F3D2E] bg-white hover:bg-[#34C38F] border border-[#DCE8E0] rounded-full shrink-0"
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

      {/* Calendar View: Week / Day Color-Coded Rounded Event Blocks */}
      {viewMode === 'calendar' && (
        <section className="card-surface rounded-[24px] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EEF3EF] pb-3.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setActiveFocusDate(addDaysIso(focusDate, calendarScale === 'week' ? -7 : -1))
                }
                aria-label={calendarScale === 'week' ? 'Previous week' : 'Previous day'}
                className="p-1.5 rounded-full bg-[#FAFBF9] border border-[#DCE8E0] text-[#1C2B25] hover:bg-[#EEF3EF]"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setActiveFocusDate(todayDate)}
                className="px-3 py-1 rounded-full text-xs font-semibold bg-[#EEF3EF] text-[#0F3D2E] hover:bg-[#DCE8E0]"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() =>
                  setActiveFocusDate(addDaysIso(focusDate, calendarScale === 'week' ? 7 : 1))
                }
                aria-label={calendarScale === 'week' ? 'Next week' : 'Next day'}
                className="p-1.5 rounded-full bg-[#FAFBF9] border border-[#DCE8E0] text-[#1C2B25] hover:bg-[#EEF3EF]"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
              <span className="text-xs font-mono font-semibold text-[#1C2B25] ml-1">
                {calendarScale === 'week' && weekColumns.length > 0
                  ? `${weekColumns[0].monthShort} ${weekColumns[0].dayNum} – ${weekColumns[weekColumns.length - 1].monthShort} ${weekColumns[weekColumns.length - 1].dayNum}`
                  : focusDate}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Visit-type Color Legend */}
              <div className="hidden md:flex items-center gap-3 text-[11px] text-[#6B7B73]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#5AA3E8]" aria-hidden="true" />
                  Check-up
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#34C38F]" aria-hidden="true" />
                  New Patient
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" aria-hidden="true" />
                  Follow-Up
                </span>
              </div>

              <div
                className="inline-flex items-center gap-1 p-1 bg-[#EEF3EF] border border-[#DCE8E0] rounded-full"
                role="group"
                aria-label="Calendar range toggle"
              >
                <button
                  type="button"
                  onClick={() => setCalendarScale('week')}
                  className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
                    calendarScale === 'week' ? 'bg-white text-[#0F3D2E] shadow-xs' : 'text-[#6B7B73]'
                  }`}
                >
                  Week
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarScale('day')}
                  className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
                    calendarScale === 'day' ? 'bg-white text-[#0F3D2E] shadow-xs' : 'text-[#6B7B73]'
                  }`}
                >
                  Day
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="h-72 bg-[#FAFBF9] rounded-2xl animate-pulse" />
          ) : (
            <div
              className={`grid gap-3 ${
                calendarScale === 'day'
                  ? 'grid-cols-1'
                  : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7'
              }`}
            >
              {weekColumns.map((col) => (
                <div
                  key={col.dateKey}
                  className={`rounded-[20px] p-3 flex flex-col gap-2.5 min-h-[210px] border transition-colors ${
                    col.isSelected
                      ? 'bg-[#F2F8F4] border-[#34C38F]'
                      : 'bg-[#FAFBF9] border-[#DCE8E0]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveFocusDate(col.dateKey)}
                    className="flex items-center justify-between gap-2 pb-2 border-b border-[#DCE8E0]/80 text-left w-full"
                  >
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7B73]">
                        {col.shortDay}
                      </span>
                      <div className="text-sm font-bold font-mono tabular-nums text-[#1C2B25]">
                        {col.monthShort} {col.dayNum}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold tabular-nums ${
                        col.isSelected
                          ? 'bg-[#34C38F] text-[#0F3D2E]'
                          : 'bg-white text-[#6B7B73] border border-[#DCE8E0]'
                      }`}
                    >
                      {col.appointments.length}
                    </span>
                  </button>

                  {col.appointments.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
                      <span className="text-[11px] text-[#6B7B73]">Open day</span>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => {
                            setNewDate(col.dateKey);
                            setCreateError(null);
                            setShowCreateModal(true);
                          }}
                          className="mt-1.5 text-[11px] font-semibold text-[#137A55] hover:underline"
                        >
                          + Book slot
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {col.appointments.map((apt) => {
                        const isSelected = detailApt?.id === apt.id;
                        return (
                          <button
                            key={apt.id}
                            type="button"
                            onClick={() => {
                              setActiveFocusDate(col.dateKey);
                              setDetailApt(apt);
                            }}
                            className={`btn-press w-full text-left rounded-2xl border p-2.5 space-y-1 transition-all ${getEventBlockClasses(
                              apt.appointmentType,
                              isSelected
                            )}`}
                          >
                            <div className="flex items-center justify-between gap-1 text-[11px]">
                              <span className="font-mono font-bold tabular-nums">
                                {apt.appointmentTime}
                              </span>
                              <span className="font-semibold opacity-90 truncate">
                                {getCalendarBlockLabel(apt.appointmentType)}
                              </span>
                            </div>
                            <div className="text-xs font-bold truncate">
                              {apt.patientName ?? apt.patientId}
                            </div>
                            <div className="text-[11px] opacity-80 truncate">
                              {apt.department} · {apt.clinician}
                            </div>
                            <div className="pt-0.5 flex items-center justify-between gap-1">
                              <AppointmentStatusText status={apt.status} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* List View Table (10 per page + Sorting + Pagination) */}
      {viewMode === 'list' && (
        <div className="card-surface rounded-[24px] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#EEF3EF] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#1C2B25]">Appointment Schedule</h2>
              <span className="text-xs font-mono tabular-nums text-[#6B7B73]">
                · Page {paginationMeta.page} of {paginationMeta.totalPages}
              </span>
            </div>
            <span className="text-xs font-mono tabular-nums text-[#6B7B73]">
              {paginationMeta.total} matching appointment{paginationMeta.total === 1 ? '' : 's'}
            </span>
          </div>

          {loading ? (
            <div className="p-5 space-y-3" aria-busy="true" aria-label="Loading appointments">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-[#FAFBF9] animate-pulse"
                >
                  <div className="w-9 h-9 rounded-full bg-[#DCE8E0] shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-44 bg-[#DCE8E0] rounded" />
                    <div className="h-2.5 w-32 bg-[#EEF3EF] rounded" />
                  </div>
                  <div className="h-5 w-20 bg-[#DCE8E0] rounded-full" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="p-10 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-rose-700 mx-auto" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#1C2B25]">
                  Unable to load appointment schedule
                </p>
                <p className="text-xs text-[#6B7B73] max-w-md mx-auto">{loadError}</p>
              </div>
              <button
                type="button"
                onClick={loadAppointments}
                className="btn-press px-4 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] rounded-full"
              >
                Retry
              </button>
            </div>
          ) : listAppointments.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <ClinicEmptyIllustration variant="appointments" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#1C2B25]">
                  No appointments match the current filters
                </p>
                <p className="text-xs text-[#6B7B73]">
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
                    className="btn-press px-4 py-2 text-xs font-semibold text-[#1C2B25] bg-[#FAFBF9] border border-[#DCE8E0] rounded-full"
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
                    className="btn-press px-4 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] rounded-full"
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
                    <tr className="border-b border-[#EEF3EF] bg-[#FAFBF9] text-xs">
                      <th className="py-3 px-4">{renderSortHeader('ID', 'id')}</th>
                      <th className="py-3 px-4">
                        {renderSortHeader('Date & Time', 'appointmentDate')}
                      </th>
                      <th className="py-3 px-4">{renderSortHeader('Patient', 'patientName')}</th>
                      <th className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          {renderSortHeader('Department', 'department')}
                          <span aria-hidden="true">·</span>
                          {renderSortHeader('Clinician', 'clinician')}
                        </div>
                      </th>
                      <th className="py-3 px-4">{renderSortHeader('Status', 'status')}</th>
                      <th className="py-3 px-4 text-right font-semibold text-[#6B7B73]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF3EF] text-sm">
                    {listAppointments.map((apt) => (
                      <tr
                        key={apt.id}
                        className={`hover:bg-[#F5F9F6] transition-colors ${
                          detailApt?.id === apt.id ? 'bg-[#E9F5EE]/75' : ''
                        }`}
                      >
                        <td
                          className={`${cellPad} font-mono tabular-nums text-xs font-semibold text-[#0F3D2E]`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setActiveFocusDate(apt.appointmentDate);
                              setDetailApt(apt);
                            }}
                            className="hover:underline text-left"
                          >
                            {apt.id}
                          </button>
                        </td>
                        <td
                          className={`${cellPad} font-mono tabular-nums text-xs text-[#1C2B25] whitespace-nowrap`}
                        >
                          {apt.appointmentDate} · {apt.appointmentTime}
                        </td>
                        <td className={cellPad}>
                          <div className="flex items-center gap-2.5">
                            <EditorialAvatar
                              name={apt.patientName ?? apt.patientId}
                              role="patient"
                              size="sm"
                            />
                            <div>
                              {onOpenPatient ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenPatient(apt.patientId)}
                                  className="font-semibold text-[#137A55] hover:underline text-left"
                                >
                                  {apt.patientName ?? apt.patientId}
                                </button>
                              ) : (
                                <div className="font-semibold text-[#1C2B25]">
                                  {apt.patientName ?? apt.patientId}
                                </div>
                              )}
                              <div className="text-[11px] font-mono text-[#6B7B73]">
                                {apt.patientId} · {getCalendarBlockLabel(apt.appointmentType)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className={`${cellPad} text-xs text-[#6B7B73]`}>
                          <span className="font-semibold text-[#1C2B25]">{apt.department}</span>
                          <span aria-hidden="true"> · </span>
                          {onOpenStaffByName ? (
                            <button
                              type="button"
                              onClick={() => onOpenStaffByName(apt.clinician)}
                              className="text-[#137A55] hover:underline font-medium"
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
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveFocusDate(apt.appointmentDate);
                                setDetailApt(apt);
                              }}
                              className="text-xs font-semibold text-[#6B7B73] hover:text-[#1C2B25]"
                            >
                              Inspect
                            </button>
                            {canWrite && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(apt)}
                                  className="text-xs font-semibold text-[#137A55] hover:text-[#0F3D2E]"
                                  aria-label={`Update or reschedule ${apt.id}`}
                                >
                                  Reschedule
                                </button>
                                {apt.status !== 'Cancelled' && apt.status !== 'Completed' && (
                                  <button
                                    type="button"
                                    onClick={() => setCancellingApt(apt)}
                                    className="text-xs font-semibold text-amber-700 hover:text-amber-800"
                                    aria-label={`Cancel appointment ${apt.id}`}
                                  >
                                    Cancel
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setDeletingApt(apt)}
                                  className="text-xs font-semibold text-rose-700 hover:text-rose-800 inline-flex items-center gap-1"
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
                className="px-6 py-4 border-t border-[#EEF3EF] bg-[#FAFBF9] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="text-xs text-[#6B7B73] font-mono tabular-nums">
                  Showing <span className="font-semibold text-[#1C2B25]">{pageRangeStart}</span>–
                  <span className="font-semibold text-[#1C2B25]">{pageRangeEnd}</span> of{' '}
                  <span className="font-semibold text-[#1C2B25]">{paginationMeta.total}</span> ·
                  Page <span className="font-semibold text-[#0F3D2E]">{paginationMeta.page}</span>/
                  {paginationMeta.totalPages}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={paginationMeta.page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#1C2B25] bg-white hover:bg-[#EEF3EF] border border-[#DCE8E0] rounded-full disabled:opacity-45 disabled:pointer-events-none"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                    Prev
                  </button>

                  {visiblePages.map((item, idx) =>
                    item === 'ellipsis' ? (
                      <span
                        key={`ellipsis-${idx}`}
                        className="px-1.5 text-xs text-[#6B7B73] select-none"
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
                        className={`min-w-[30px] h-[30px] px-2 text-xs font-mono font-semibold rounded-full transition-colors ${
                          item === paginationMeta.page
                            ? 'bg-[#0F3D2E] text-white'
                            : 'bg-white text-[#1C2B25] border border-[#DCE8E0] hover:bg-[#EEF3EF]'
                        }`}
                      >
                        {item}
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    disabled={paginationMeta.page >= paginationMeta.totalPages || loading}
                    onClick={() => setPage((p) => Math.min(paginationMeta.totalPages, p + 1))}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#1C2B25] bg-white hover:bg-[#EEF3EF] border border-[#DCE8E0] rounded-full disabled:opacity-45 disabled:pointer-events-none"
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
      )}

      {/* Create Appointment Modal */}
      <ModalShell
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        labelledBy="create-apt-title"
        maxWidthClass="max-w-lg"
      >
        <div className="flex items-center justify-between">
          <h3 id="create-apt-title" className="text-base font-bold text-[#1C2B25]">
            Schedule Appointment
          </h3>
          <button
            type="button"
            onClick={() => setShowCreateModal(false)}
            className="p-1.5 text-[#6B7B73] hover:text-[#1C2B25] rounded-full hover:bg-[#EEF3EF]"
            aria-label="Close schedule appointment dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {createError && (
          <div className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-2xl">
            {createError}
          </div>
        )}

        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-apt-patient" className="block text-xs font-semibold text-[#1C2B25] mb-1">
              Patient
            </label>
            <select
              id="new-apt-patient"
              value={newPatientId}
              onChange={(e) => setNewPatientId(e.target.value)}
              className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
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
              <label htmlFor="new-apt-date" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Date
              </label>
              <input
                id="new-apt-date"
                type="date"
                required
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="new-apt-time" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Time
              </label>
              <input
                id="new-apt-time"
                type="time"
                required
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="new-apt-dept" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Department
              </label>
              <select
                id="new-apt-dept"
                value={newDept}
                onChange={(e) => handleDeptChangeInCreate(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
              >
                {CLINIC_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="new-apt-clinician" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Clinician
              </label>
              <select
                id="new-apt-clinician"
                value={newClinician}
                onChange={(e) => setNewClinician(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
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
            <label htmlFor="new-apt-type" className="block text-xs font-semibold text-[#1C2B25] mb-1">
              Appointment Type
            </label>
            <select
              id="new-apt-type"
              value={newType}
              onChange={(e) => setNewType(e.target.value as AppointmentType)}
              className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
            >
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="new-apt-notes" className="block text-xs font-semibold text-[#1C2B25] mb-1">
              Administrative Notes
            </label>
            <input
              id="new-apt-notes"
              type="text"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Optional check-in or intake note"
              className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
            />
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
                <h3 id="edit-apt-title" className="text-base font-bold text-[#1C2B25]">
                  {rescheduleStep === 'confirm'
                    ? `Confirm Reschedule for ${editingApt.id}`
                    : `Update / Reschedule ${editingApt.id}`}
                </h3>
                <p className="text-xs text-[#6B7B73] mt-0.5">
                  {editingApt.patientName} ({editingApt.patientId})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingApt(null)}
                className="p-1.5 text-[#6B7B73] hover:text-[#1C2B25] rounded-full hover:bg-[#EEF3EF]"
                aria-label="Close update appointment dialog"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex items-center gap-2 text-[11px] font-semibold text-[#6B7B73] border-b border-[#DCE8E0] pb-3">
              <span className={rescheduleStep === 'edit' ? 'text-[#137A55]' : ''}>
                1. Schedule &amp; Availability
              </span>
              <span aria-hidden="true">/</span>
              <span className={rescheduleStep === 'confirm' ? 'text-[#137A55]' : ''}>
                2. Review &amp; Confirm
              </span>
            </div>

            {editError && (
              <div className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-2xl">
                {editError}
              </div>
            )}

            {rescheduleStep === 'edit' ? (
              <form onSubmit={handleEditFormSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="edit-apt-date" className="block text-xs font-semibold text-[#1C2B25] mb-1">
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
                      className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-apt-time" className="block text-xs font-semibold text-[#1C2B25] mb-1">
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
                      className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="edit-apt-dept" className="block text-xs font-semibold text-[#1C2B25] mb-1">
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
                      className="w-full px-3 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
                    >
                      {CLINIC_DEPARTMENTS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="edit-apt-clinician" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                      Clinician
                    </label>
                    <select
                      id="edit-apt-clinician"
                      value={editClinician}
                      onChange={(e) => {
                        setEditClinician(e.target.value);
                        setEditAvailabilityStatus(null);
                      }}
                      className="w-full px-3 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
                    >
                      {clinicianOptions.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="edit-apt-status" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                      Status
                    </label>
                    <select
                      id="edit-apt-status"
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as AppointmentStatus)}
                      className="w-full px-3 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
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
                  <label htmlFor="edit-apt-type" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                    Appointment Type
                  </label>
                  <select
                    id="edit-apt-type"
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as AppointmentType)}
                    className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
                  >
                    {APPOINTMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-3.5 bg-white border border-[#DCE8E0] rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#1C2B25]">
                      Slot Availability Check
                    </span>
                    <button
                      type="button"
                      disabled={editSlotChecking}
                      onClick={runEditAvailabilityCheck}
                      className="btn-press inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-[#0F3D2E] bg-[#EEF3EF] hover:bg-[#DCE8E0] rounded-full disabled:opacity-50"
                    >
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      {editSlotChecking ? 'Checking...' : 'Verify Slot'}
                    </button>
                  </div>

                  {editAvailabilityStatus && (
                    <div className="space-y-2">
                      <div
                        className={`p-2.5 rounded-xl border text-xs flex items-start gap-2 ${
                          editAvailabilityStatus.available
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : 'bg-rose-50 border-rose-200 text-rose-800'
                        }`}
                      >
                        {editAvailabilityStatus.available ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" aria-hidden="true" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-700" aria-hidden="true" />
                        )}
                        <span>{editAvailabilityStatus.message}</span>
                      </div>

                      {editAvailabilityStatus.suggestions.length > 0 && (
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
                              className="px-2.5 py-1 text-[11px] font-mono bg-[#FAFBF9] hover:bg-[#EEF3EF] text-[#0F3D2E] border border-[#DCE8E0] rounded-full"
                            >
                              {slot.date} · {slot.time}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="edit-apt-notes" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                    Notes
                  </label>
                  <input
                    id="edit-apt-notes"
                    type="text"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#DCE8E0]">
                  <button
                    type="button"
                    onClick={() => setEditingApt(null)}
                    className="btn-press px-4 py-2 text-xs font-semibold text-[#6B7B73] border border-[#DCE8E0] rounded-full"
                  >
                    Discard
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || editSlotChecking}
                    className="btn-press px-5 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full disabled:opacity-50"
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
                <div className="p-3.5 rounded-2xl bg-[#E9F5EE] border border-[#BCE2CD] text-xs text-[#0F3D2E] flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#137A55] shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <div className="font-bold">Availability Verified — Ready to Save</div>
                    <p className="text-[#3A5247] mt-0.5">
                      Review the previous and proposed schedule below before updating.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-2xl bg-white border border-[#DCE8E0] space-y-1">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-[#6B7B73]">
                      Previous
                    </div>
                    <div className="font-mono font-bold text-[#1C2B25]">
                      {editingApt.appointmentDate} · {editingApt.appointmentTime}
                    </div>
                    <div className="text-[#6B7B73]">
                      {editingApt.department} · {editingApt.clinician}
                    </div>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-[#E9F5EE] border border-[#34C38F] space-y-1">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-[#137A55]">
                      Proposed
                    </div>
                    <div className="font-mono font-bold text-[#0F3D2E]">
                      {editDate} · {editTime}
                    </div>
                    <div className="text-[#1C2B25]">
                      {editDept} · {editClinician}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#DCE8E0]">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setRescheduleStep('edit')}
                    className="btn-press px-4 py-2 text-xs font-semibold text-[#6B7B73] border border-[#DCE8E0] rounded-full"
                  >
                    Back to Edit
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={persistAppointmentUpdate}
                    className="btn-press px-5 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full disabled:opacity-50"
                  >
                    {submitting ? 'Saving...' : 'Confirm & Save'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </ModalShell>

      {/* Cancel Confirmation Modal */}
      <ModalShell
        open={Boolean(cancellingApt)}
        onClose={() => setCancellingApt(null)}
        labelledBy="cancel-apt-title"
        maxWidthClass="max-w-md"
      >
        {cancellingApt && (
          <>
            <h3 id="cancel-apt-title" className="text-base font-bold text-[#1C2B25]">
              Confirm Appointment Cancellation
            </h3>
            <p className="text-sm text-[#6B7B73]">
              Cancel appointment <span className="font-mono font-bold text-[#1C2B25]">{cancellingApt.id}</span> for{' '}
              <span className="font-semibold text-[#1C2B25]">{cancellingApt.patientName}</span> on{' '}
              <span className="font-mono">{cancellingApt.appointmentDate} {cancellingApt.appointmentTime}</span>?
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCancellingApt(null)}
                className="btn-press px-4 py-2 text-xs font-semibold text-[#6B7B73] border border-[#DCE8E0] rounded-full"
              >
                Keep Appointment
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmCancel}
                className="btn-press px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-full disabled:opacity-50"
              >
                {submitting ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </>
        )}
      </ModalShell>

      {/* Delete Confirmation Modal */}
      <ModalShell
        open={Boolean(deletingApt)}
        onClose={() => setDeletingApt(null)}
        labelledBy="delete-apt-title"
        maxWidthClass="max-w-md"
      >
        {deletingApt && (
          <>
            <h3 id="delete-apt-title" className="text-base font-bold text-[#1C2B25]">
              Delete Appointment Record
            </h3>
            <p className="text-sm text-[#6B7B73]">
              Permanently remove appointment{' '}
              <span className="font-mono font-bold text-[#1C2B25]">{deletingApt.id}</span> for{' '}
              <span className="font-semibold text-[#1C2B25]">{deletingApt.patientName}</span>? This is recorded in the clinic audit log.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletingApt(null)}
                className="btn-press px-4 py-2 text-xs font-semibold text-[#6B7B73] border border-[#DCE8E0] rounded-full"
              >
                Keep Record
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmDelete}
                className="btn-press px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-full disabled:opacity-50"
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
