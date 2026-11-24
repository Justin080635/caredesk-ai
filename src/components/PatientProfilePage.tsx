import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  KeyRound,
  Lock,
  Mail,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Stethoscope,
  User,
  X,
} from 'lucide-react';
import {
  createFollowupRecord,
  fetchPatientDetail,
  generatePatientClaimCode,
  updateFollowupRecord,
  updatePatientRecord,
} from '../client/api';
import type {
  AdministrativeStatus,
  Appointment,
  FollowUpPriority,
  FollowUpStatus,
  PatientDetail,
  UserRole,
} from '../shared/types';
import { ClinicEmptyIllustration, EditorialAvatar } from './ClinicIllustrations';
import { ModalShell } from './ModalShell';
import {
  AdminStatusText,
  AppointmentStatusText,
  FollowUpStatusText,
  PriorityText,
} from './StatusText';

type PatientProfileTab =
  | 'overview'
  | 'appointments'
  | 'medical'
  | 'followups'
  | 'activity';

interface PatientProfilePageProps {
  patientId: string;
  sessionRole: UserRole;
  refreshSignal: number;
  onBack: () => void;
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  onQuickScheduleForPatient: (patientId: string) => void;
  onOpenAppointment?: (appointment: Appointment) => void;
  onOpenStaffByName?: (clinicianName: string) => void;
}

function getLocalTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeAgeLabel(dob: string): string {
  const parsed = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '—';
  const now = new Date();
  let age = now.getFullYear() - parsed.getFullYear();
  const m = now.getMonth() - parsed.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < parsed.getDate())) {
    age -= 1;
  }
  return age >= 0 ? `${age} yrs` : '—';
}

export function PatientProfilePage({
  patientId,
  sessionRole,
  refreshSignal,
  onBack,
  onDataMutated,
  onErrorNotice,
  onSuccessNotice,
  onQuickScheduleForPatient,
  onOpenAppointment,
  onOpenStaffByName,
}: PatientProfilePageProps) {
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<PatientProfileTab>('overview');
  const [aptFilter, setAptFilter] = useState<'all' | 'upcoming' | 'history'>('all');

  // Edit Patient Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editEmergencyName, setEditEmergencyName] = useState('');
  const [editEmergencyPhone, setEditEmergencyPhone] = useState('');
  const [editStatus, setEditStatus] = useState<AdministrativeStatus>('Active');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Portal Claim Code Generation State
  const [generatingClaimCode, setGeneratingClaimCode] = useState(false);
  const [issuedClaimCode, setIssuedClaimCode] = useState<{
    claimCode: string;
    expiresAt: string;
  } | null>(null);

  // Create Follow-up Modal State
  const [showFollowupModal, setShowFollowupModal] = useState(false);
  const [fuAppointmentId, setFuAppointmentId] = useState('');
  const [fuDescription, setFuDescription] = useState('');
  const [fuPriority, setFuPriority] = useState<FollowUpPriority>('Medium');
  const [fuDueDate, setFuDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [fuError, setFuError] = useState<string | null>(null);
  const [fuSubmitting, setFuSubmitting] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  const todayKey = useMemo(getLocalTodayKey, []);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchPatientDetail(patientId);
      setDetail(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load patient profile.';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    setActiveSection('overview');
    setAptFilter('all');
    setIssuedClaimCode(null);
  }, [patientId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail, sessionRole, refreshSignal]);

  const canEdit = sessionRole === 'administrator' && (detail?.permissions?.canEdit ?? true);

  const openEditModal = () => {
    if (!detail) return;
    setEditFullName(detail.fullName);
    setEditDob(detail.dateOfBirth);
    setEditContact(detail.contactNumber);
    setEditEmail(detail.email);
    setEditEmergencyName(detail.emergencyContactName ?? '');
    setEditEmergencyPhone(detail.emergencyContactPhone ?? '');
    setEditStatus(detail.administrativeStatus);
    setEditError(null);
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setEditError(null);
    setEditSubmitting(true);
    try {
      const updated = await updatePatientRecord(detail.id, {
        fullName: editFullName,
        dateOfBirth: editDob,
        contactNumber: editContact,
        email: editEmail,
        emergencyContactName: editEmergencyName.trim() || undefined,
        emergencyContactPhone: editEmergencyPhone.trim() || undefined,
        administrativeStatus: editStatus,
      });
      setShowEditModal(false);
      onSuccessNotice(`Updated patient ${updated.fullName} (${updated.id}).`);
      await loadDetail();
      onDataMutated();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unable to update patient record.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleGenerateClaimCode = async () => {
    if (!detail) return;
    setGeneratingClaimCode(true);
    try {
      const res = await generatePatientClaimCode(detail.id);
      setIssuedClaimCode({ claimCode: res.claimCode, expiresAt: res.expiresAt });
      onSuccessNotice(`Generated one-time Patient Portal claim code for ${detail.fullName}.`);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to generate portal claim code.');
    } finally {
      setGeneratingClaimCode(false);
    }
  };

  const handleCreateFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    if (fuDescription.trim().length < 4) {
      setFuError('Description must be at least 4 characters.');
      return;
    }
    setFuError(null);
    setFuSubmitting(true);
    try {
      const created = await createFollowupRecord({
        patientId: detail.id,
        appointmentId: fuAppointmentId || null,
        description: fuDescription.trim(),
        priority: fuPriority,
        dueDate: fuDueDate,
      });
      setShowFollowupModal(false);
      setFuDescription('');
      setFuAppointmentId('');
      onSuccessNotice(`Created follow-up ${created.id} for ${detail.fullName}.`);
      await loadDetail();
      onDataMutated();
    } catch (err) {
      setFuError(err instanceof Error ? err.message : 'Unable to create follow-up task.');
    } finally {
      setFuSubmitting(false);
    }
  };

  const handleFollowupStatusChange = async (taskId: string, status: FollowUpStatus) => {
    setUpdatingTaskId(taskId);
    try {
      await updateFollowupRecord(taskId, { status });
      onSuccessNotice(`Updated follow-up ${taskId} to ${status}.`);
      await loadDetail();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to update follow-up task.');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const upcomingAppointments = useMemo(() => {
    if (!detail) return [];
    return detail.appointments.filter(
      (a) => a.appointmentDate >= todayKey && (a.status === 'Scheduled' || a.status === 'Confirmed')
    );
  }, [detail, todayKey]);

  const pastAppointments = useMemo(() => {
    if (!detail) return [];
    const upcomingIds = new Set(upcomingAppointments.map((a) => a.id));
    return [...detail.appointments]
      .filter((a) => !upcomingIds.has(a.id))
      .sort((a, b) =>
        `${b.appointmentDate} ${b.appointmentTime}`.localeCompare(
          `${a.appointmentDate} ${a.appointmentTime}`
        )
      );
  }, [detail, upcomingAppointments]);

  const openFollowups = useMemo(
    () =>
      detail?.followups.filter(
        (f) =>
          f.status === 'Pending' ||
          f.status === 'Scheduled' ||
          f.status === 'Due' ||
          f.status === 'Overdue'
      ) ?? [],
    [detail]
  );

  const closedFollowups = useMemo(
    () =>
      detail?.followups.filter((f) => f.status === 'Completed' || f.status === 'Cancelled') ?? [],
    [detail]
  );

  const departmentSummary = useMemo(() => {
    if (!detail) return [];
    const map = new Map<string, { department: string; count: number; latestDate: string }>();
    for (const apt of detail.appointments) {
      const existing = map.get(apt.department);
      if (!existing) {
        map.set(apt.department, {
          department: apt.department,
          count: 1,
          latestDate: apt.appointmentDate,
        });
      } else {
        existing.count += 1;
        if (apt.appointmentDate > existing.latestDate) {
          existing.latestDate = apt.appointmentDate;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [detail]);

  const clinicianSummary = useMemo(() => {
    if (!detail) return [];
    const map = new Map<string, { clinician: string; department: string; count: number }>();
    for (const apt of detail.appointments) {
      const existing = map.get(apt.clinician);
      if (!existing) {
        map.set(apt.clinician, {
          clinician: apt.clinician,
          department: apt.department,
          count: 1,
        });
      } else {
        existing.count += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [detail]);

  const appointmentNotes = useMemo(() => {
    if (!detail) return [];
    return [...detail.appointments]
      .filter((a) => a.notes && a.notes.trim().length > 0)
      .sort((a, b) => b.appointmentDate.localeCompare(a.appointmentDate));
  }, [detail]);

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading patient profile">
        <div className="h-8 w-44 bg-[#E3E8E4] rounded-lg animate-pulse" />
        <div className="card-surface rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#E3E8E4] animate-pulse" />
            <div className="space-y-2 flex-1">
              <div className="h-5 w-52 bg-[#E3E8E4] rounded animate-pulse" />
              <div className="h-3.5 w-72 bg-[#EEF2EF] rounded animate-pulse" />
            </div>
          </div>
          <div className="h-10 bg-[#F6F8F6] rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 h-52 card-surface rounded-xl animate-pulse" />
          <div className="lg:col-span-6 h-52 card-surface rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (loadError || !detail) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#047857] hover:text-[#0B261C]"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Back to Patient Directory
        </button>
        <div className="card-surface rounded-xl p-8 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-red-700 mx-auto" aria-hidden="true" />
          <h2 className="text-base font-semibold text-[#111C17]">
            Patient Profile Unavailable
          </h2>
          <p className="text-xs text-[#526259] max-w-md mx-auto">
            {loadError ?? `Could not find patient record ${patientId}.`}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={loadDetail}
              className="px-4 py-2 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg btn-press"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2 text-xs font-medium text-[#111C17] bg-white border border-[#D4DAD4] hover:bg-[#F6F8F6] rounded-lg"
            >
              Return to Directory
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: PatientProfileTab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'appointments', label: 'Appointments', count: detail.appointments.length },
    { id: 'medical', label: 'Medical Information' },
    { id: 'followups', label: 'Follow-ups', count: detail.followups.length },
    { id: 'activity', label: 'Activity History' },
  ];

  const completedVisits = detail.appointments.filter((a) => a.status === 'Completed').length;
  const missedVisits = detail.appointments.filter((a) => a.status === 'Missed').length;
  const displayedAppointments =
    aptFilter === 'upcoming'
      ? upcomingAppointments
      : aptFilter === 'history'
        ? pastAppointments
        : [...upcomingAppointments, ...pastAppointments];

  return (
    <div className="space-y-5">
      {/* Top Breadcrumb Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#047857] hover:text-[#0B261C] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Back to Patient Directory
        </button>
        <div className="text-[11px] font-mono text-[#526259]">
          Route: /patients/{detail.id} · Synthetic Administrative Record
        </div>
      </div>

      {/* A. PATIENT PROFILE HEADER */}
      <section className="card-surface rounded-xl overflow-hidden">
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start sm:items-center gap-4 min-w-0">
            <EditorialAvatar name={detail.fullName} role="patient" size="lg" />
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-[#ECF4EF] text-[#0B261C] border border-[#C6DFD1]">
                  {detail.id}
                </span>
                <AdminStatusText status={detail.administrativeStatus} />
                <span className="text-xs text-[#526259] font-mono tabular-nums">
                  DOB {detail.dateOfBirth} ({computeAgeLabel(detail.dateOfBirth)})
                </span>
              </div>

              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#111C17] truncate">
                {detail.fullName}
              </h2>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#526259]">
                <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-[#111C17]">
                  <Phone className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                  {detail.contactNumber}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[#111C17]">
                  <Mail className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                  {detail.email}
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                  <Calendar className="w-3.5 h-3.5 text-[#526259]" aria-hidden="true" />
                  Registered {detail.registrationDate}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={!canEdit}
              onClick={openEditModal}
              title={!canEdit ? 'Administrator session required to edit patient records' : undefined}
              className="btn-press inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111C17] bg-white hover:bg-[#F6F8F6] border border-[#D4DAD4] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Pencil className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
              Edit Patient Info
            </button>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                setFuError(null);
                setShowFollowupModal(true);
              }}
              title={!canEdit ? 'Administrator session required to create follow-ups' : undefined}
              className="btn-press inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#0B261C] bg-[#ECF4EF] hover:bg-[#D7E6DD] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
              Add Follow-up
            </button>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onQuickScheduleForPatient(detail.id)}
              title={!canEdit ? 'Administrator session required to schedule visits' : undefined}
              className="btn-press inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
              Schedule Appointment
            </button>
          </div>
        </div>

        {!canEdit && (
          <div className="px-5 sm:px-6 py-2.5 bg-amber-50/75 border-t border-amber-200/80 flex items-center gap-2 text-xs text-amber-900">
            <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
            <span>
              Read-Only Viewer session active. Switch to Administrator to edit patient records, schedule visits, or modify follow-up tasks.
            </span>
          </div>
        )}

        {/* B. PROFILE NAVIGATION */}
        <div
          className="px-5 sm:px-6 py-2 bg-[#F6F8F6] border-t border-[#E3E8E4] flex items-center gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Patient profile sections"
        >
          {tabs.map((tab) => {
            const active = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveSection(tab.id)}
                className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  active
                    ? 'bg-white text-[#0B261C] shadow-xs border border-[#E3E8E4]'
                    : 'text-[#526259] hover:text-[#111C17] hover:bg-white/60'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`font-mono text-[11px] px-1.5 py-0.2 rounded ${
                      active ? 'bg-[#ECF4EF] text-[#047857]' : 'bg-[#E3E8E4]/80 text-[#526259]'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Tab Content Viewport */}
      <div key={activeSection} className="animate-view-enter space-y-5">
        {/* C. OVERVIEW */}
        {activeSection === 'overview' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#0B261C] text-white rounded-xl p-4">
                <div className="text-xs font-medium text-emerald-200/85">Upcoming Visits</div>
                <div className="text-2xl font-bold font-mono tabular-nums mt-1.5">
                  {upcomingAppointments.length}
                </div>
                <div className="text-[11px] text-emerald-100/75 mt-0.5">
                  Scheduled or confirmed
                </div>
              </div>

              <div className="card-surface rounded-xl p-4">
                <div className="text-xs font-medium text-[#526259]">Total Visits</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[#111C17] mt-1.5">
                  {detail.appointments.length}
                </div>
                <div className="text-[11px] text-[#526259] mt-0.5">
                  {completedVisits} completed on file
                </div>
              </div>

              <div className="card-surface rounded-xl p-4">
                <div className="text-xs font-medium text-[#526259]">Missed Visits</div>
                <div
                  className={`text-2xl font-bold font-mono tabular-nums mt-1.5 ${
                    missedVisits > 0 ? 'text-[#DC2626]' : 'text-[#047857]'
                  }`}
                >
                  {missedVisits}
                </div>
                <div className="text-[11px] text-[#526259] mt-0.5">
                  Historical no-show count
                </div>
              </div>

              <div className="card-surface rounded-xl p-4">
                <div className="text-xs font-medium text-[#526259]">Open Follow-ups</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1.5">
                  {openFollowups.length}
                </div>
                <div className="text-[11px] text-[#526259] mt-0.5">
                  {closedFollowups.length} resolved
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <section className="lg:col-span-6 card-surface rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-[#E3E8E4] pb-3">
                  <User className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Patient Identity &amp; Contact Details
                  </h3>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <dt className="text-[#526259]">Full Name</dt>
                    <dd className="font-semibold text-[#111C17] mt-0.5">{detail.fullName}</dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Patient Identifier</dt>
                    <dd className="font-mono font-semibold text-[#0B261C] mt-0.5">{detail.id}</dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Date of Birth</dt>
                    <dd className="font-mono tabular-nums text-[#111C17] mt-0.5">
                      {detail.dateOfBirth} ({computeAgeLabel(detail.dateOfBirth)})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Administrative Status</dt>
                    <dd className="mt-0.5">
                      <AdminStatusText status={detail.administrativeStatus} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Phone Number</dt>
                    <dd className="font-mono tabular-nums text-[#111C17] mt-0.5">
                      {detail.contactNumber}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Email Address</dt>
                    <dd className="text-[#111C17] mt-0.5 break-all">{detail.email}</dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Registration Date</dt>
                    <dd className="font-mono tabular-nums text-[#111C17] mt-0.5">
                      {detail.registrationDate}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Departments Visited</dt>
                    <dd className="text-[#111C17] mt-0.5">
                      {departmentSummary.length > 0
                        ? departmentSummary.map((d) => d.department).join(', ')
                        : 'None recorded'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Emergency Contact</dt>
                    <dd className="text-[#111C17] mt-0.5">
                      {detail.emergencyContactName || detail.emergencyContactPhone ? (
                        <>
                          <span>{detail.emergencyContactName || 'Contact'}</span>
                          {detail.emergencyContactPhone && (
                            <span className="font-mono text-[#526259] ml-1.5">
                              {detail.emergencyContactPhone}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[#64746B]">Not recorded</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Patient Portal Access</dt>
                    <dd className="mt-0.5 flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium ${
                          detail.portalLinked ? 'text-[#047857]' : 'text-[#526259]'
                        }`}
                      >
                        {detail.portalLinked ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            Portal Linked
                          </>
                        ) : (
                          'Not Linked'
                        )}
                      </span>
                      {detail.permissions?.canManagePortalLink && (
                        <button
                          type="button"
                          disabled={generatingClaimCode}
                          onClick={handleGenerateClaimCode}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#0B261C] bg-[#ECF4EF] hover:bg-[#DCECE3] rounded-md disabled:opacity-50"
                        >
                          <KeyRound className="w-3 h-3 text-[#047857]" aria-hidden="true" />
                          {generatingClaimCode ? 'Generating...' : 'Generate Claim Code'}
                        </button>
                      )}
                    </dd>
                  </div>
                </dl>

                {issuedClaimCode && (
                  <div className="p-3.5 rounded-lg bg-[#ECF4EF] border border-[#B7DFCA] space-y-1 text-xs">
                    <div className="font-semibold text-[#0B261C]">
                      One-Time Patient Portal Claim Code
                    </div>
                    <div className="font-mono text-base font-bold text-[#047857] tracking-wider">
                      {issuedClaimCode.claimCode}
                    </div>
                    <p className="text-[11px] text-[#34433B]">
                      Share securely with {detail.fullName}. Requires matching DOB (
                      <span className="font-mono">{detail.dateOfBirth}</span>) and expires{' '}
                      <span className="font-mono">{issuedClaimCode.expiresAt.slice(0, 10)}</span>.
                    </p>
                  </div>
                )}
              </section>

              <section className="lg:col-span-6 card-surface rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-[#E3E8E4] pb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-[#111C17]">
                      Next Scheduled Visit &amp; Active Queue
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSection('appointments')}
                    className="text-xs font-medium text-[#047857] hover:underline"
                  >
                    All Appointments →
                  </button>
                </div>

                {upcomingAppointments.length > 0 ? (
                  <div className="p-3.5 rounded-lg bg-[#ECF4EF]/75 border border-[#C6DFD1] space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-[#0B261C]">
                        {upcomingAppointments[0].appointmentDate} · {upcomingAppointments[0].appointmentTime}
                      </span>
                      <AppointmentStatusText status={upcomingAppointments[0].status} />
                    </div>
                    <div className="text-xs text-[#111C17] font-medium">
                      {upcomingAppointments[0].department} · {upcomingAppointments[0].clinician}
                    </div>
                    <div className="text-[11px] font-mono text-[#526259]">
                      {upcomingAppointments[0].id} · {upcomingAppointments[0].durationMinutes} min
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4] text-xs text-[#526259]">
                    No upcoming appointments currently scheduled for {detail.fullName}.
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#111C17]">
                      Open Follow-up Tasks ({openFollowups.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveSection('followups')}
                      className="text-xs font-medium text-[#047857] hover:underline"
                    >
                      Manage Queue →
                    </button>
                  </div>
                  {openFollowups.length === 0 ? (
                    <p className="text-xs text-[#526259]">No pending follow-up outreach required.</p>
                  ) : (
                    <div className="divide-y divide-[#EEF2EF]">
                      {openFollowups.slice(0, 3).map((fu) => (
                        <div key={fu.id} className="py-2 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-medium text-[#111C17]">
                              {fu.id} · Due {fu.dueDate}
                            </span>
                            <PriorityText priority={fu.priority} />
                          </div>
                          <p className="text-[#526259]">{fu.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* D. APPOINTMENTS */}
        {activeSection === 'appointments' && (
          <section className="card-surface rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E3E8E4] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#111C17]">
                  Patient Appointment Schedule &amp; History
                </h3>
                <p className="text-xs text-[#526259] mt-0.5">
                  {upcomingAppointments.length} upcoming · {pastAppointments.length} historical visits for {detail.fullName}
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-[#F1F5F2] rounded-lg w-fit">
                {[
                  { id: 'all', label: `All (${detail.appointments.length})` },
                  { id: 'upcoming', label: `Upcoming (${upcomingAppointments.length})` },
                  { id: 'history', label: `History (${pastAppointments.length})` },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAptFilter(opt.id as typeof aptFilter)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      aptFilter === opt.id
                        ? 'bg-white text-[#0B261C] shadow-xs'
                        : 'text-[#526259] hover:text-[#111C17]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {displayedAppointments.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <ClinicEmptyIllustration variant="appointments" />
                <p className="text-sm font-medium text-[#111C17]">
                  No appointments in this category
                </p>
                <p className="text-xs text-[#526259]">
                  Switch filter tabs or schedule a new clinic appointment for {detail.fullName}.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E3E8E4] bg-[#F6F8F6] text-xs font-medium text-[#526259]">
                      <th className="py-2.5 px-4">ID</th>
                      <th className="py-2.5 px-4">Date &amp; Time</th>
                      <th className="py-2.5 px-4">Department</th>
                      <th className="py-2.5 px-4">Clinician</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4">Notes</th>
                      {onOpenAppointment && <th className="py-2.5 px-4 text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF2EF] text-xs">
                    {displayedAppointments.map((apt) => (
                      <tr key={apt.id} className="hover:bg-[#F6F8F6] transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-[#0B261C] whitespace-nowrap">
                          {apt.id}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-[#111C17] whitespace-nowrap">
                          {apt.appointmentDate} · {apt.appointmentTime} ({apt.durationMinutes}m)
                        </td>
                        <td className="py-3 px-4 font-medium text-[#111C17] whitespace-nowrap">
                          {apt.department}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {onOpenStaffByName ? (
                            <button
                              type="button"
                              onClick={() => onOpenStaffByName(apt.clinician)}
                              className="text-[#047857] hover:underline font-medium"
                            >
                              {apt.clinician}
                            </button>
                          ) : (
                            <span className="text-[#111C17]">{apt.clinician}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <AppointmentStatusText status={apt.status} />
                        </td>
                        <td className="py-3 px-4 text-[#526259] max-w-xs">
                          {apt.notes || '—'}
                        </td>
                        {onOpenAppointment && (
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => onOpenAppointment(apt)}
                              className="text-xs font-medium text-[#047857] hover:text-[#0B261C]"
                            >
                              Inspect in Schedule
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* E. MEDICAL INFORMATION (Recorded consultations + clinic care-coordination context) */}
        {activeSection === 'medical' && (
          <div className="space-y-5">
            <div className="p-4 rounded-xl bg-[#ECF4EF] border border-[#C6DFD1] flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-[#047857] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1 text-xs">
                <div className="font-semibold text-[#0B261C]">
                  Verified Clinic Records &amp; Doctor-Authored Consultations
                </div>
                <p className="text-[#34433B] leading-relaxed">
                  Displays only recorded consultations, prescriptions, test summaries, consulting clinicians, and administrative visit notes persisted in CareDesk&apos;s database.
                </p>
              </div>
            </div>

            {/* Doctor-Authored Consultations */}
            <section className="card-surface rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#E3E8E4] pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Recorded Consultation Summaries ({detail.consultations?.length ?? 0})
                  </h3>
                </div>
              </div>

              {!detail.consultations || detail.consultations.length === 0 ? (
                <p className="text-xs text-[#526259]">
                  No doctor-authored consultations have been recorded for {detail.fullName} yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {detail.consultations.map((rec) => (
                    <div
                      key={rec.id}
                      className="p-4 rounded-xl bg-[#F6F8F6] border border-[#E3E8E4] space-y-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-mono font-semibold text-[#0B261C]">
                          {rec.consultationDate} · {rec.id} · {rec.doctorName}
                        </div>
                        <span
                          className={`font-mono text-[11px] font-medium ${
                            rec.patientVisible ? 'text-[#047857]' : 'text-[#526259]'
                          }`}
                        >
                          {rec.patientVisible ? 'Visible in Patient Portal' : 'Clinician Internal Only'}
                        </span>
                      </div>
                      <p className="text-[#111C17] leading-relaxed">{rec.summary}</p>
                      {rec.diagnosisNotes && (
                        <div className="text-[#34433B]">
                          <span className="font-semibold">Clinical Notes:</span> {rec.diagnosisNotes}
                        </div>
                      )}
                      {rec.recommendations && (
                        <div className="text-[#34433B]">
                          <span className="font-semibold">Recommendations:</span>{' '}
                          {rec.recommendations}
                        </div>
                      )}
                      {rec.prescriptions.length > 0 && (
                        <div className="pt-1 space-y-1">
                          <div className="text-[11px] font-semibold text-[#526259]">
                            Prescriptions
                          </div>
                          <ul className="space-y-1">
                            {rec.prescriptions.map((rx, idx) => (
                              <li key={idx} className="font-mono text-[11px] text-[#111C17]">
                                • {rx.medication} — {rx.dosage}, {rx.frequency} ({rx.duration})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {rec.testResults.length > 0 && (
                        <div className="pt-1 space-y-1">
                          <div className="text-[11px] font-semibold text-[#526259]">
                            Test Results
                          </div>
                          <ul className="space-y-1">
                            {rec.testResults.map((tr, idx) => (
                              <li key={idx} className="text-[11px] text-[#111C17]">
                                • <span className="font-semibold">{tr.testName}</span> (
                                {tr.observedDate}) — {tr.summary}{' '}
                                <span className="font-mono text-[#047857]">[{tr.statusLabel}]</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <section className="lg:col-span-5 card-surface rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-[#E3E8E4] pb-3">
                  <Stethoscope className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Departments &amp; Consulting Clinicians
                  </h3>
                </div>

                {departmentSummary.length === 0 ? (
                  <p className="text-xs text-[#526259]">
                    No clinic departments or clinicians have been associated with this patient yet.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#526259]">
                        Departments Visited
                      </div>
                      <div className="divide-y divide-[#EEF2EF]">
                        {departmentSummary.map((item) => (
                          <div
                            key={item.department}
                            className="py-2 flex items-center justify-between text-xs"
                          >
                            <span className="font-medium text-[#111C17]">{item.department}</span>
                            <span className="font-mono text-[#526259]">
                              {item.count} visit{item.count === 1 ? '' : 's'} · Last {item.latestDate}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-[#EEF2EF]">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#526259]">
                        Assigned Clinicians
                      </div>
                      <div className="divide-y divide-[#EEF2EF]">
                        {clinicianSummary.map((item) => (
                          <div
                            key={item.clinician}
                            className="py-2 flex items-center justify-between text-xs"
                          >
                            <div>
                              {onOpenStaffByName ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenStaffByName(item.clinician)}
                                  className="font-medium text-[#047857] hover:underline"
                                >
                                  {item.clinician}
                                </button>
                              ) : (
                                <span className="font-medium text-[#111C17]">{item.clinician}</span>
                              )}
                              <div className="text-[11px] text-[#526259]">{item.department}</div>
                            </div>
                            <span className="font-mono text-[#526259]">
                              {item.count} visit{item.count === 1 ? '' : 's'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="lg:col-span-7 card-surface rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-[#E3E8E4] pb-3">
                  <FileText className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Recorded Administrative Visit Notes
                  </h3>
                </div>

                {appointmentNotes.length === 0 ? (
                  <p className="text-xs text-[#526259]">
                    No administrative visit notes recorded on file for this patient.
                  </p>
                ) : (
                  <div className="divide-y divide-[#EEF2EF]">
                    {appointmentNotes.map((apt) => (
                      <div key={apt.id} className="py-3 space-y-1 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-[#0B261C]">
                            {apt.appointmentDate} · {apt.id} · {apt.department}
                          </span>
                          <AppointmentStatusText status={apt.status} />
                        </div>
                        <p className="text-[#111C17] leading-relaxed">{apt.notes}</p>
                        <div className="text-[11px] text-[#526259]">Clinician: {apt.clinician}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* F. FOLLOW-UPS */}
        {activeSection === 'followups' && (
          <section className="card-surface rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E3E8E4] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#111C17]">
                  Patient Follow-up Tasks
                </h3>
                <p className="text-xs text-[#526259] mt-0.5">
                  {openFollowups.length} open · {closedFollowups.length} completed or dismissed
                </p>
              </div>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  setFuError(null);
                  setShowFollowupModal(true);
                }}
                className="btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50"
              >
                <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />
                New Follow-up
              </button>
            </div>

            {detail.followups.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <ClinicEmptyIllustration variant="followups" />
                <p className="text-sm font-medium text-[#111C17]">
                  No follow-up tasks associated with {detail.fullName}
                </p>
                <p className="text-xs text-[#526259]">
                  Follow-up outreach tasks created for missed visits or intake verification will appear here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#EEF2EF]">
                {detail.followups.map((fu) => {
                  const isOpen =
                    fu.status === 'Pending' ||
                    fu.status === 'Scheduled' ||
                    fu.status === 'Due' ||
                    fu.status === 'Overdue';
                  const isOverdue =
                    fu.status === 'Overdue' || (isOpen && fu.dueDate < todayKey);
                  const busy = updatingTaskId === fu.id;
                  return (
                    <div
                      key={fu.id}
                      className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-[#F6F8F6] transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5 text-xs">
                          <span className="font-mono font-semibold text-[#0B261C]">{fu.id}</span>
                          {fu.appointmentId && (
                            <span className="font-mono text-[#526259]">
                              Linked {fu.appointmentId}
                            </span>
                          )}
                          <PriorityText priority={fu.priority} />
                          <FollowUpStatusText status={fu.status} />
                          <span
                            className={`font-mono tabular-nums ${
                              isOverdue ? 'text-red-700 font-semibold' : 'text-[#526259]'
                            }`}
                          >
                            {isOverdue ? `Overdue (${fu.dueDate})` : `Due ${fu.dueDate}`}
                          </span>
                        </div>
                        <p className="text-xs text-[#111C17]">{fu.description}</p>
                      </div>

                      {canEdit && (
                        <div className="flex items-center gap-2.5 shrink-0 text-xs">
                          {fu.status === 'Pending' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleFollowupStatusChange(fu.id, 'Scheduled')}
                              className="font-medium text-[#047857] hover:text-[#0B261C] disabled:opacity-50"
                            >
                              Schedule
                            </button>
                          )}
                          {isOpen && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleFollowupStatusChange(fu.id, 'Completed')}
                              className="font-medium text-emerald-700 hover:text-emerald-900 disabled:opacity-50"
                            >
                              Complete
                            </button>
                          )}
                          {(fu.status === 'Completed' || fu.status === 'Cancelled') && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleFollowupStatusChange(fu.id, 'Pending')}
                              className="font-medium text-[#526259] hover:text-[#111C17] disabled:opacity-50"
                            >
                              Reopen
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* G. ACTIVITY HISTORY */}
        {activeSection === 'activity' && (
          <section className="card-surface rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E3E8E4] pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Administrative Activity &amp; Audit History
                  </h3>
                  <p className="text-xs text-[#526259]">
                    Recorded updates across patient demographics, appointments, and follow-up tasks
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono text-[#526259]">
                {detail.permissions.canViewAuditHistory
                  ? `${detail.activity.length} audit event${detail.activity.length === 1 ? '' : 's'}`
                  : 'Viewer Restricted'}
              </span>
            </div>

            {!detail.permissions.canViewAuditHistory ? (
              <div className="p-4 rounded-lg bg-amber-50/75 border border-amber-200/80 text-xs text-amber-900 flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="font-semibold">Audit Trail Restricted to Administrator Sessions</div>
                  <p className="mt-0.5 text-amber-800">
                    For privacy and operational governance, detailed actor audit logs require an Administrator session. Switch to Administrator to inspect full audit entries for {detail.id}.
                  </p>
                </div>
              </div>
            ) : detail.activity.length === 0 ? (
              <p className="text-xs text-[#526259] py-4">
                No individual audit log entries recorded for {detail.id} yet.
              </p>
            ) : (
              <ol className="relative border-l border-[#E3E8E4] ml-2 space-y-4">
                {detail.activity.map((entry) => (
                  <li key={entry.id} className="pl-4 relative">
                    <span
                      className="absolute -left-[4.5px] top-1.5 w-2 h-2 rounded-full bg-[#059669] ring-2 ring-white"
                      aria-hidden="true"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#526259]">
                      <span className="font-semibold text-[#0B261C]">
                        {entry.action} · {entry.resourceType.toUpperCase()} {entry.resourceId}
                      </span>
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-[#111C17] mt-1">{entry.summary}</p>
                    <div className="text-[11px] text-[#526259] mt-0.5">Actor: {entry.actor}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>

      {/* Edit Patient Modal */}
      <ModalShell
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        labelledBy="profile-edit-patient-title"
        maxWidthClass="max-w-lg"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 id="profile-edit-patient-title" className="text-base font-semibold text-[#16211C]">
              Edit Patient Record · {detail.id}
            </h3>
            <p className="text-xs text-[#526058] mt-0.5">
              Changes persist directly to CareDesk&apos;s relational patient directory.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowEditModal(false)}
            className="p-1 text-[#526058] hover:text-[#16211C]"
            aria-label="Close edit patient dialog"
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
            <label htmlFor="profile-edit-name" className="block text-xs font-medium text-[#16211C] mb-1">
              Full Name
            </label>
            <input
              id="profile-edit-name"
              type="text"
              required
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="profile-edit-dob" className="block text-xs font-medium text-[#16211C] mb-1">
                Date of Birth
              </label>
              <input
                id="profile-edit-dob"
                type="date"
                required
                value={editDob}
                onChange={(e) => setEditDob(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="profile-edit-phone" className="block text-xs font-medium text-[#16211C] mb-1">
                Contact Number
              </label>
              <input
                id="profile-edit-phone"
                type="tel"
                required
                value={editContact}
                onChange={(e) => setEditContact(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="profile-edit-email" className="block text-xs font-medium text-[#16211C] mb-1">
                Email
              </label>
              <input
                id="profile-edit-email"
                type="email"
                required
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="profile-edit-status" className="block text-xs font-medium text-[#16211C] mb-1">
                Administrative Status
              </label>
              <select
                id="profile-edit-status"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as AdministrativeStatus)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
              >
                <option value="Active">Active</option>
                <option value="Pending Verification">Pending Verification</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="profile-edit-em-name" className="block text-xs font-medium text-[#16211C] mb-1">
                Emergency Contact Name
              </label>
              <input
                id="profile-edit-em-name"
                type="text"
                value={editEmergencyName}
                onChange={(e) => setEditEmergencyName(e.target.value)}
                placeholder="Optional emergency contact"
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="profile-edit-em-phone" className="block text-xs font-medium text-[#16211C] mb-1">
                Emergency Contact Phone
              </label>
              <input
                id="profile-edit-em-phone"
                type="tel"
                value={editEmergencyPhone}
                onChange={(e) => setEditEmergencyPhone(e.target.value)}
                placeholder="+1-555-0199"
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E4E7E2]">
            <button
              type="button"
              onClick={() => setShowEditModal(false)}
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
      </ModalShell>

      {/* Create Follow-up Modal */}
      <ModalShell
        open={showFollowupModal}
        onClose={() => setShowFollowupModal(false)}
        labelledBy="profile-create-fu-title"
        maxWidthClass="max-w-lg"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 id="profile-create-fu-title" className="text-base font-semibold text-[#16211C]">
              New Follow-up for {detail.fullName}
            </h3>
            <p className="text-xs text-[#526058] mt-0.5">Linked to patient {detail.id}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowFollowupModal(false)}
            className="p-1 text-[#526058] hover:text-[#16211C]"
            aria-label="Close create follow-up dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {fuError && (
          <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
            {fuError}
          </div>
        )}

        <form onSubmit={handleCreateFollowup} className="space-y-4">
          <div>
            <label htmlFor="profile-fu-apt" className="block text-xs font-medium text-[#16211C] mb-1">
              Linked Appointment (Optional)
            </label>
            <select
              id="profile-fu-apt"
              value={fuAppointmentId}
              onChange={(e) => setFuAppointmentId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
            >
              <option value="">None</option>
              {detail.appointments.map((apt) => (
                <option key={apt.id} value={apt.id}>
                  {apt.id} — {apt.appointmentDate} {apt.appointmentTime} ({apt.department})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="profile-fu-desc" className="block text-xs font-medium text-[#16211C] mb-1">
              Description
            </label>
            <textarea
              id="profile-fu-desc"
              rows={3}
              required
              value={fuDescription}
              onChange={(e) => setFuDescription(e.target.value)}
              placeholder="Describe administrative outreach or verification step..."
              className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="profile-fu-priority" className="block text-xs font-medium text-[#16211C] mb-1">
                Priority
              </label>
              <select
                id="profile-fu-priority"
                value={fuPriority}
                onChange={(e) => setFuPriority(e.target.value as FollowUpPriority)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div>
              <label htmlFor="profile-fu-due" className="block text-xs font-medium text-[#16211C] mb-1">
                Due Date
              </label>
              <input
                id="profile-fu-due"
                type="date"
                required
                value={fuDueDate}
                onChange={(e) => setFuDueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E4E7E2]">
            <button
              type="button"
              onClick={() => setShowFollowupModal(false)}
              className="px-4 py-2 text-sm font-medium text-[#526058] border border-[#E4E7E2] rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={fuSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 btn-press"
            >
              {fuSubmitting ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
