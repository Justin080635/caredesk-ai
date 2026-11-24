import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Lock,
  Mail,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Stethoscope,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import adminAvatarUrl from '../assets/images/avatar_clinic_admin_1795511733855.jpg';
import {
  addDoctorUnavailability,
  deleteDoctorUnavailability,
  fetchStaffDetail,
  saveDoctorSchedule,
  updateStaffRecord,
} from '../client/api';
import { CLINIC_DEPARTMENTS, WEEKDAY_NAMES } from '../shared/constants';
import type {
  Appointment,
  DoctorScheduleDay,
  DoctorUnavailability,
  StaffDetail,
  StaffRole,
  StaffStatus,
  UserRole,
} from '../shared/types';
import { ClinicEmptyIllustration, EditorialAvatar } from './ClinicIllustrations';
import { ModalShell } from './ModalShell';
import { AppointmentStatusText, DoctorDutyStatusText, StaffStatusText } from './StatusText';

type StaffProfileSection = 'overview' | 'appointments' | 'responsibilities' | 'activity';

interface StaffProfilePageProps {
  staffId: string;
  sessionRole: UserRole;
  refreshSignal: number;
  onBack: () => void;
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  onOpenPatient: (patientId: string) => void;
  onOpenAppointment?: (appointment: Appointment) => void;
}

function getLocalTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function StaffProfilePage({
  staffId,
  sessionRole,
  refreshSignal,
  onBack,
  onDataMutated,
  onErrorNotice,
  onSuccessNotice,
  onOpenPatient,
  onOpenAppointment,
}: StaffProfilePageProps) {
  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<StaffProfileSection>('overview');
  const [aptScope, setAptScope] = useState<'all' | 'upcoming' | 'past'>('all');
  const [avatarError, setAvatarError] = useState(false);

  // Edit Staff Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editRole, setEditRole] = useState<StaffRole>('Clinician');
  const [editDepartment, setEditDepartment] = useState('');
  const [editSpecialty, setEditSpecialty] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editStatus, setEditStatus] = useState<StaffStatus>('Active');
  const [editError, setEditError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Schedule & Unavailability State
  const [scheduleDraft, setScheduleDraft] = useState<DoctorScheduleDay[]>([]);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [unavailStartDate, setUnavailStartDate] = useState(getLocalTodayKey);
  const [unavailEndDate, setUnavailEndDate] = useState(getLocalTodayKey);
  const [unavailStartTime, setUnavailStartTime] = useState('09:00');
  const [unavailEndTime, setUnavailEndTime] = useState('17:00');
  const [unavailKind, setUnavailKind] = useState<DoctorUnavailability['kind']>('Leave');
  const [unavailReason, setUnavailReason] = useState('');
  const [savingUnavail, setSavingUnavail] = useState(false);

  const todayKey = useMemo(getLocalTodayKey, []);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchStaffDetail(staffId);
      setDetail(data);
      setScheduleDraft(data.schedules ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load staff profile.';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  useEffect(() => {
    setActiveSection('overview');
    setAptScope('all');
  }, [staffId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail, sessionRole, refreshSignal]);

  const canManage = sessionRole === 'administrator' && (detail?.permissions?.canEditProfile ?? true);

  const openEditModal = () => {
    if (!detail) return;
    setEditRole(detail.role);
    setEditDepartment(detail.department);
    setEditSpecialty(detail.specialty);
    setEditEmail(detail.email);
    setEditContact(detail.contactNumber);
    setEditStatus(detail.status);
    setEditError(null);
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setEditError(null);
    setSubmitting(true);
    try {
      const updated = await updateStaffRecord(detail.id, {
        role: editRole,
        department: editDepartment,
        specialty: editSpecialty,
        email: editEmail,
        contactNumber: editContact,
        status: editStatus,
      });
      setShowEditModal(false);
      onSuccessNotice(`Updated staff profile for ${updated.fullName} (${updated.id}).`);
      await loadDetail();
      onDataMutated();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unable to update staff profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickStatusUpdate = async (nextStatus: StaffStatus) => {
    if (!detail || !canManage) return;
    setSubmitting(true);
    try {
      await updateStaffRecord(detail.id, { status: nextStatus });
      onSuccessNotice(`${detail.fullName} status updated to ${nextStatus}.`);
      await loadDetail();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to update staff status.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveSchedule = async () => {
    if (!detail || !canManage) return;
    setSavingSchedule(true);
    try {
      const saved = await saveDoctorSchedule(
        detail.id,
        scheduleDraft.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          isWorking: d.isWorking,
          startTime: d.startTime,
          endTime: d.endTime,
          breakStart: d.breakStart,
          breakEnd: d.breakEnd,
          slotDurationMinutes: d.slotDurationMinutes,
        }))
      );
      setScheduleDraft(saved);
      onSuccessNotice(`Saved weekly schedule for ${detail.fullName}.`);
      await loadDetail();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to save doctor schedule.');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleAddUnavailability = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !canManage) return;
    setSavingUnavail(true);
    try {
      await addDoctorUnavailability(detail.id, {
        startDate: unavailStartDate,
        endDate: unavailEndDate || unavailStartDate,
        startTime: unavailStartTime,
        endTime: unavailEndTime,
        kind: unavailKind,
        reason: unavailReason.trim(),
      });
      setUnavailReason('');
      onSuccessNotice(`Added ${unavailKind.toLowerCase()} block for ${detail.fullName}.`);
      await loadDetail();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to add unavailability block.');
    } finally {
      setSavingUnavail(false);
    }
  };

  const handleDeleteUnavailability = async (unavailId: string) => {
    if (!detail || !canManage) return;
    setSavingUnavail(true);
    try {
      await deleteDoctorUnavailability(detail.id, unavailId);
      onSuccessNotice('Removed unavailability block.');
      await loadDetail();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to remove unavailability block.');
    } finally {
      setSavingUnavail(false);
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

  const displayedAppointments =
    aptScope === 'upcoming'
      ? upcomingAppointments
      : aptScope === 'past'
        ? pastAppointments
        : [...upcomingAppointments, ...pastAppointments];

  const distinctPatientsServed = useMemo(() => {
    if (!detail) return 0;
    return new Set(detail.appointments.map((a) => a.patientId)).size;
  }, [detail]);

  const departmentOptions = useMemo(() => {
    const list = new Set<string>(CLINIC_DEPARTMENTS);
    list.add('Clinic Operations');
    list.add('Front Desk & Intake');
    if (detail?.department) list.add(detail.department);
    return Array.from(list);
  }, [detail]);

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading staff profile">
        <div className="h-6 w-40 bg-[#E3E8E4] rounded animate-pulse" />
        <div className="h-44 rounded-xl bg-[#0B261C]/90 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 h-72 card-surface rounded-xl animate-pulse" />
          <div className="lg:col-span-8 h-72 card-surface rounded-xl animate-pulse" />
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
          Back to Staff Directory
        </button>
        <div className="card-surface rounded-xl p-8 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-red-700 mx-auto" aria-hidden="true" />
          <h2 className="text-base font-semibold text-[#111C17]">Staff Profile Unavailable</h2>
          <p className="text-xs text-[#526259] max-w-md mx-auto">
            {loadError ?? `Could not find staff member ${staffId}.`}
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
              Return to Staff Roster
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sections: Array<{
    id: StaffProfileSection;
    label: string;
    icon: typeof Briefcase;
    count?: number;
  }> = [
    { id: 'overview', label: 'Overview', icon: Briefcase },
    {
      id: 'appointments',
      label: 'Assigned Appointments',
      icon: Calendar,
      count: detail.appointments.length,
    },
    {
      id: 'responsibilities',
      label: 'Responsibilities',
      icon: ClipboardCheck,
      count: detail.responsibilities.length,
    },
    {
      id: 'activity',
      label: 'Activity History',
      icon: Activity,
      count: detail.permissions.canViewAuditHistory ? detail.activity.length : undefined,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Breadcrumb Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#047857] hover:text-[#0B261C] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Back to Staff Roster
        </button>
        <div className="text-[11px] font-mono text-[#526259]">
          Route: /staff/{detail.id} · Clinic Workforce Profile
        </div>
      </div>

      {/* A. DISTINCT EXECUTIVE WORKFORCE HEADER (Forest-Green Identity Band) */}
      <section className="rounded-xl overflow-hidden bg-[#0B261C] text-white border border-[#174333] shadow-xs">
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start sm:items-center gap-4 min-w-0">
            {detail.id === 'STF-1007' && !avatarError ? (
              <img
                src={adminAvatarUrl}
                alt={detail.fullName}
                referrerPolicy="no-referrer"
                onError={() => setAvatarError(true)}
                className="w-14 h-14 rounded-xl object-cover shrink-0 border border-emerald-300/30"
              />
            ) : (
              <div className="rounded-xl p-0.5 bg-[#174333] border border-emerald-400/25 shrink-0">
                <EditorialAvatar
                  name={detail.fullName}
                  role={detail.role === 'Clinician' ? 'clinician' : 'patient'}
                  size="lg"
                />
              </div>
            )}

            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-[#174333] text-emerald-200 border border-emerald-400/20">
                  {detail.id}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-200">
                  <Stethoscope className="w-3.5 h-3.5" aria-hidden="true" />
                  {detail.role}
                </span>
                <span aria-hidden="true" className="text-emerald-200/40">
                  ·
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-emerald-100/85">
                  <Building2 className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                  {detail.department}
                  {detail.specialty ? ` (${detail.specialty})` : ''}
                </span>
              </div>

              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white truncate">
                {detail.fullName}
              </h2>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-emerald-100/80">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                  {detail.email || 'Email not recorded in directory'}
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                  <Phone className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                  {detail.contactNumber || 'Phone not recorded'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end gap-3 shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="px-3 py-1 rounded-lg bg-white text-[#111C17]">
                <StaffStatusText status={detail.status} />
              </div>
              {detail.role === 'Clinician' && (
                <div className="px-3 py-1 rounded-lg bg-white text-[#111C17]">
                  <DoctorDutyStatusText
                    status={detail.effectiveOperationalState ?? detail.attendanceStatus}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canManage || submitting}
                onClick={openEditModal}
                title={!canManage ? 'Administrator access required to edit staff profiles' : undefined}
                className="btn-press inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#0B261C] bg-white hover:bg-[#ECF4EF] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Pencil className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                Edit Staff Profile
              </button>

              {detail.status === 'Active' ? (
                <button
                  type="button"
                  disabled={!canManage || submitting}
                  onClick={() => handleQuickStatusUpdate('On Leave')}
                  title={!canManage ? 'Administrator access required to update staff status' : undefined}
                  className="btn-press inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-100 bg-[#174333] hover:bg-[#1E5440] border border-emerald-400/20 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  Mark On Leave
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!canManage || submitting}
                  onClick={() => handleQuickStatusUpdate('Active')}
                  title={!canManage ? 'Administrator access required to update staff status' : undefined}
                  className="btn-press inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  Set Active
                </button>
              )}
            </div>
          </div>
        </div>

        {!canManage && (
          <div className="px-5 sm:px-6 py-2.5 bg-[#071D15] border-t border-[#174333] flex items-center gap-2 text-xs text-emerald-100/85">
            <Lock className="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden="true" />
            <span>
              Read-Only Viewer session active. Switch to Administrator to update staff contact details, role assignments, or employment status.
            </span>
          </div>
        )}
      </section>

      {/* B. TWO-COLUMN WORKFORCE LAYOUT: Sticky Left Rail + Right Operational Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Navigation & Capacity Rail */}
        <aside className="lg:col-span-4 space-y-4 lg:sticky lg:top-6">
          <nav
            className="card-surface rounded-xl p-2 space-y-1"
            aria-label="Staff profile sections"
          >
            {sections.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[#0B261C] text-white'
                      : 'text-[#526259] hover:bg-[#F6F8F6] hover:text-[#111C17]'
                  }`}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Icon
                      className={`w-4 h-4 ${active ? 'text-emerald-300' : 'text-[#047857]'}`}
                      aria-hidden="true"
                    />
                    <span>{section.label}</span>
                  </span>
                  {section.count !== undefined && (
                    <span
                      className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
                        active ? 'bg-[#174333] text-emerald-200' : 'bg-[#EEF2EF] text-[#526259]'
                      }`}
                    >
                      {section.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Workforce Snapshot Card */}
          <div className="card-surface rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#526259]">
              Operational Snapshot
            </h3>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-[#F6F8F6]">
                <dt className="text-[#526259]">Assigned Visits</dt>
                <dd className="text-lg font-bold font-mono tabular-nums text-[#0B261C] mt-0.5">
                  {detail.assignedAppointmentsCount ?? 0}
                </dd>
              </div>
              <div className="p-3 rounded-lg bg-[#F6F8F6]">
                <dt className="text-[#526259]">Upcoming</dt>
                <dd className="text-lg font-bold font-mono tabular-nums text-[#047857] mt-0.5">
                  {detail.upcomingAppointmentsCount ?? 0}
                </dd>
              </div>
              <div className="p-3 rounded-lg bg-[#F6F8F6]">
                <dt className="text-[#526259]">Completed</dt>
                <dd className="text-lg font-bold font-mono tabular-nums text-[#111C17] mt-0.5">
                  {detail.completedAppointmentsCount ?? 0}
                </dd>
              </div>
              <div className="p-3 rounded-lg bg-[#F6F8F6]">
                <dt className="text-[#526259]">Unique Patients</dt>
                <dd className="text-lg font-bold font-mono tabular-nums text-[#111C17] mt-0.5">
                  {distinctPatientsServed}
                </dd>
              </div>
            </dl>
            <div className="pt-3 border-t border-[#EEF2EF] text-[11px] text-[#526259] space-y-1">
              <div className="flex items-center justify-between">
                <span>Record Created</span>
                <span className="font-mono">{detail.createdAt.slice(0, 10)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Last Updated</span>
                <span className="font-mono">{detail.updatedAt.slice(0, 10)}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Section Viewport */}
        <div key={activeSection} className="lg:col-span-8 animate-view-enter space-y-5">
          {/* C. OVERVIEW */}
          {activeSection === 'overview' && (
            <div className="space-y-5">
              <section className="card-surface rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-[#E3E8E4] pb-3">
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Staff Profile &amp; Assignment Details
                  </h3>
                  <StaffStatusText status={detail.status} />
                </div>

                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <dt className="text-[#526259]">Full Name</dt>
                    <dd className="font-semibold text-[#111C17] mt-0.5">{detail.fullName}</dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Staff Identifier</dt>
                    <dd className="font-mono font-semibold text-[#0B261C] mt-0.5">{detail.id}</dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Role Classification</dt>
                    <dd className="font-medium text-[#111C17] mt-0.5">{detail.role}</dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Department</dt>
                    <dd className="font-medium text-[#111C17] mt-0.5">{detail.department}</dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Specialty / Focus Area</dt>
                    <dd className="text-[#111C17] mt-0.5">
                      {detail.specialty || 'Not specified'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Employment / Account Status</dt>
                    <dd className="mt-0.5">
                      <StaffStatusText status={detail.status} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Work Email</dt>
                    <dd className="text-[#111C17] mt-0.5">
                      {detail.email ? (
                        detail.email
                      ) : (
                        <span className="italic text-[#64746B]">
                          Not recorded in clinic directory
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#526259]">Direct Contact Number</dt>
                    <dd className="font-mono text-[#111C17] mt-0.5">
                      {detail.contactNumber ? (
                        detail.contactNumber
                      ) : (
                        <span className="font-sans italic text-[#64746B]">
                          Not recorded in clinic directory
                        </span>
                      )}
                    </dd>
                  </div>
                  {detail.role === 'Clinician' && (
                    <>
                      <div>
                        <dt className="text-[#526259]">Qualifications</dt>
                        <dd className="text-[#111C17] mt-0.5">
                          {detail.qualifications || 'Not recorded'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[#526259]">Medical License &amp; Daily Capacity</dt>
                        <dd className="font-mono text-[#111C17] mt-0.5">
                          {detail.licenseNumber || 'N/A'} · Max {detail.maxDailyCapacity ?? 16} visits/day
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[#526259]">Live Duty Status</dt>
                        <dd className="mt-0.5">
                          <DoctorDutyStatusText
                            status={detail.effectiveOperationalState ?? detail.attendanceStatus}
                          />
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </section>

              {/* Working Schedule & Unavailability / Leave */}
              {(detail.role === 'Clinician' || scheduleDraft.length > 0) && (
                <section className="card-surface rounded-xl p-5 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3E8E4] pb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#111C17]">
                        Working Schedule &amp; Unavailability / Leave
                      </h3>
                      <p className="text-xs text-[#526259] mt-0.5">
                        Weekly clinic hours, break windows, and scheduled leave blocks used by slot availability
                      </p>
                    </div>
                    {canManage && scheduleDraft.length > 0 && (
                      <button
                        type="button"
                        disabled={savingSchedule}
                        onClick={handleSaveSchedule}
                        className="btn-press px-3.5 py-1.5 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50"
                      >
                        {savingSchedule ? 'Saving...' : 'Save Weekly Schedule'}
                      </button>
                    )}
                  </div>

                  {scheduleDraft.length === 0 ? (
                    <p className="text-xs text-[#526259]">
                      No weekly working schedule configured yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-[#EEF2EF] text-xs">
                      {scheduleDraft.map((day) => (
                        <div
                          key={day.dayOfWeek}
                          className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                        >
                          <label className="inline-flex items-center gap-2 font-medium text-[#111C17] min-w-[120px]">
                            <input
                              type="checkbox"
                              disabled={!canManage}
                              checked={day.isWorking}
                              onChange={(e) =>
                                setScheduleDraft((prev) =>
                                  prev.map((d) =>
                                    d.dayOfWeek === day.dayOfWeek
                                      ? { ...d, isWorking: e.target.checked }
                                      : d
                                  )
                                )
                              }
                              className="rounded border-[#D4DAD4] text-[#059669]"
                            />
                            <span>{WEEKDAY_NAMES[day.dayOfWeek] ?? `Day ${day.dayOfWeek}`}</span>
                          </label>

                          {day.isWorking ? (
                            <div className="flex flex-wrap items-center gap-2 font-mono">
                              <span className="text-[#526259]">Shift</span>
                              <input
                                type="time"
                                disabled={!canManage}
                                value={day.startTime}
                                onChange={(e) =>
                                  setScheduleDraft((prev) =>
                                    prev.map((d) =>
                                      d.dayOfWeek === day.dayOfWeek
                                        ? { ...d, startTime: e.target.value }
                                        : d
                                    )
                                  )
                                }
                                className="px-2 py-1 border border-[#D4DAD4] rounded bg-white text-xs"
                              />
                              <span>–</span>
                              <input
                                type="time"
                                disabled={!canManage}
                                value={day.endTime}
                                onChange={(e) =>
                                  setScheduleDraft((prev) =>
                                    prev.map((d) =>
                                      d.dayOfWeek === day.dayOfWeek
                                        ? { ...d, endTime: e.target.value }
                                        : d
                                    )
                                  )
                                }
                                className="px-2 py-1 border border-[#D4DAD4] rounded bg-white text-xs"
                              />
                              <span className="text-[#526259] ml-1">Break</span>
                              <input
                                type="time"
                                disabled={!canManage}
                                value={day.breakStart}
                                onChange={(e) =>
                                  setScheduleDraft((prev) =>
                                    prev.map((d) =>
                                      d.dayOfWeek === day.dayOfWeek
                                        ? { ...d, breakStart: e.target.value }
                                        : d
                                    )
                                  )
                                }
                                className="px-2 py-1 border border-[#D4DAD4] rounded bg-white text-xs"
                              />
                              <span>–</span>
                              <input
                                type="time"
                                disabled={!canManage}
                                value={day.breakEnd}
                                onChange={(e) =>
                                  setScheduleDraft((prev) =>
                                    prev.map((d) =>
                                      d.dayOfWeek === day.dayOfWeek
                                        ? { ...d, breakEnd: e.target.value }
                                        : d
                                    )
                                  )
                                }
                                className="px-2 py-1 border border-[#D4DAD4] rounded bg-white text-xs"
                              />
                            </div>
                          ) : (
                            <span className="text-[#64746B] italic">Off / Non-working day</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Unavailability / Leave Blocks */}
                  <div className="pt-3 border-t border-[#E3E8E4] space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-[#111C17]">
                        Scheduled Leave &amp; Unavailability Blocks
                      </h4>
                      <span className="text-[11px] font-mono text-[#526259]">
                        {detail.unavailability?.length ?? 0} block
                        {(detail.unavailability?.length ?? 0) === 1 ? '' : 's'}
                      </span>
                    </div>

                    {(detail.unavailability ?? []).length > 0 && (
                      <div className="space-y-2">
                        {detail.unavailability.map((block) => (
                          <div
                            key={block.id}
                            className="p-2.5 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4] flex items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <span className="font-semibold text-[#0B261C]">{block.kind}</span>
                              <span className="mx-1.5 text-[#526259]">·</span>
                              <span className="font-mono text-[#111C17]">
                                {block.startDate}
                                {block.endDate !== block.startDate ? ` to ${block.endDate}` : ''}{' '}
                                ({block.startTime}–{block.endTime})
                              </span>
                              {block.reason && (
                                <span className="text-[#526259]"> — {block.reason}</span>
                              )}
                            </div>
                            {canManage && (
                              <button
                                type="button"
                                disabled={savingUnavail}
                                onClick={() => handleDeleteUnavailability(block.id)}
                                aria-label={`Remove ${block.kind} block`}
                                className="p-1 text-red-700 hover:bg-red-50 rounded"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {canManage && (
                      <form
                        onSubmit={handleAddUnavailability}
                        className="p-3 rounded-lg bg-[#F9FBFA] border border-[#E3E8E4] grid grid-cols-1 sm:grid-cols-6 gap-2 text-xs items-end"
                      >
                        <div>
                          <label className="block text-[11px] text-[#526259] mb-1">Type</label>
                          <select
                            value={unavailKind}
                            onChange={(e) =>
                              setUnavailKind(e.target.value as DoctorUnavailability['kind'])
                            }
                            className="w-full px-2 py-1.5 border border-[#D4DAD4] rounded bg-white"
                          >
                            <option value="Leave">Leave</option>
                            <option value="Break">Break</option>
                            <option value="Unavailable">Unavailable</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-[#526259] mb-1">Start Date</label>
                          <input
                            type="date"
                            required
                            value={unavailStartDate}
                            onChange={(e) => setUnavailStartDate(e.target.value)}
                            className="w-full px-2 py-1.5 border border-[#D4DAD4] rounded bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-[#526259] mb-1">End Date</label>
                          <input
                            type="date"
                            required
                            value={unavailEndDate}
                            onChange={(e) => setUnavailEndDate(e.target.value)}
                            className="w-full px-2 py-1.5 border border-[#D4DAD4] rounded bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-[#526259] mb-1">Hours</label>
                          <div className="flex items-center gap-1">
                            <input
                              type="time"
                              value={unavailStartTime}
                              onChange={(e) => setUnavailStartTime(e.target.value)}
                              className="w-full px-1.5 py-1.5 border border-[#D4DAD4] rounded bg-white font-mono"
                            />
                            <input
                              type="time"
                              value={unavailEndTime}
                              onChange={(e) => setUnavailEndTime(e.target.value)}
                              className="w-full px-1.5 py-1.5 border border-[#D4DAD4] rounded bg-white font-mono"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[11px] text-[#526259] mb-1">Reason</label>
                          <input
                            type="text"
                            value={unavailReason}
                            onChange={(e) => setUnavailReason(e.target.value)}
                            placeholder="Optional reason"
                            className="w-full px-2 py-1.5 border border-[#D4DAD4] rounded bg-white"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={savingUnavail}
                          className="btn-press inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-[#0B261C] hover:bg-[#12382A] rounded disabled:opacity-50"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          Add Block
                        </button>
                      </form>
                    )}
                  </div>
                </section>
              )}

              {/* Highlighted Responsibilities Summary */}
              <section className="card-surface rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-[#E3E8E4] pb-3">
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Core Assigned Responsibilities
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveSection('responsibilities')}
                    className="text-xs font-medium text-[#047857] hover:underline"
                  >
                    View All ({detail.responsibilities.length}) →
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {detail.responsibilities.slice(0, 2).map((resp) => (
                    <div
                      key={resp.id}
                      className="p-3.5 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4] space-y-1.5"
                    >
                      <div className="text-xs font-semibold text-[#0B261C]">{resp.title}</div>
                      <p className="text-xs text-[#526259] leading-relaxed">{resp.scope}</p>
                      {resp.metricLabel && resp.metricValue && (
                        <div className="pt-1 text-[11px] font-mono text-[#047857] font-semibold">
                          {resp.metricLabel}: {resp.metricValue}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Upcoming Schedule Preview */}
              <section className="card-surface rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-[#E3E8E4] pb-3">
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Upcoming Assigned Appointments
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveSection('appointments')}
                    className="text-xs font-medium text-[#047857] hover:underline"
                  >
                    Full Schedule ({detail.appointments.length}) →
                  </button>
                </div>

                {detail.role !== 'Clinician' ? (
                  <p className="text-xs text-[#526259]">
                    {detail.role} accounts oversee operational queues rather than direct patient appointment slots.
                  </p>
                ) : upcomingAppointments.length === 0 ? (
                  <p className="text-xs text-[#526259]">
                    No upcoming scheduled or confirmed appointments currently assigned to {detail.fullName}.
                  </p>
                ) : (
                  <div className="divide-y divide-[#EEF2EF]">
                    {upcomingAppointments.slice(0, 4).map((apt) => (
                      <div
                        key={apt.id}
                        className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-[#0B261C]">
                              {apt.appointmentDate} {apt.appointmentTime}
                            </span>
                            <button
                              type="button"
                              onClick={() => onOpenPatient(apt.patientId)}
                              className="font-semibold text-[#047857] hover:underline"
                            >
                              {apt.patientName ?? apt.patientId}
                            </button>
                            <span className="font-mono text-[#526259]">· {apt.id}</span>
                          </div>
                          {apt.notes && <div className="text-[#526259] mt-0.5">{apt.notes}</div>}
                        </div>
                        <AppointmentStatusText status={apt.status} />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* D. ASSIGNED APPOINTMENTS */}
          {activeSection === 'appointments' && (
            <section className="card-surface rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#E3E8E4] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Assigned Appointment Schedule
                  </h3>
                  <p className="text-xs text-[#526259] mt-0.5">
                    {upcomingAppointments.length} upcoming · {pastAppointments.length} past or closed visits for {detail.fullName}
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 bg-[#F1F5F2] rounded-lg w-fit">
                  {[
                    { id: 'all', label: `All (${detail.appointments.length})` },
                    { id: 'upcoming', label: `Upcoming (${upcomingAppointments.length})` },
                    { id: 'past', label: `Past (${pastAppointments.length})` },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setAptScope(opt.id as typeof aptScope)}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        aptScope === opt.id
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
                    {detail.role === 'Clinician'
                      ? 'No appointments in this filter'
                      : 'No direct appointment bookings for this role'}
                  </p>
                  <p className="text-xs text-[#526259] max-w-md mx-auto">
                    {detail.role === 'Clinician'
                      ? `No matching clinic appointments are currently assigned to ${detail.fullName}.`
                      : `${detail.role} staff coordinate clinic operations and do not carry direct clinician appointment slots.`}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#E3E8E4] bg-[#F6F8F6] text-xs font-medium text-[#526259]">
                        <th className="py-2.5 px-4">ID</th>
                        <th className="py-2.5 px-4">Date &amp; Time</th>
                        <th className="py-2.5 px-4">Patient</th>
                        <th className="py-2.5 px-4">Department</th>
                        <th className="py-2.5 px-4">Status</th>
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
                            {apt.appointmentDate} · {apt.appointmentTime}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => onOpenPatient(apt.patientId)}
                              className="font-medium text-[#047857] hover:underline"
                            >
                              {apt.patientName ?? apt.patientId}
                            </button>
                            <span className="font-mono text-[#526259] ml-1.5">{apt.patientId}</span>
                          </td>
                          <td className="py-3 px-4 text-[#526259] whitespace-nowrap">
                            {apt.department}
                          </td>
                          <td className="py-3 px-4">
                            <AppointmentStatusText status={apt.status} />
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

          {/* E. RESPONSIBILITIES */}
          {activeSection === 'responsibilities' && (
            <section className="card-surface rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#E3E8E4] pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Assigned Operational Responsibilities
                  </h3>
                  <p className="text-xs text-[#526259] mt-0.5">
                    Derived from CareDesk role scope, department coverage, and live database caseload
                  </p>
                </div>
                <ShieldCheck className="w-4 h-4 text-[#047857]" aria-hidden="true" />
              </div>

              {detail.responsibilities.length === 0 ? (
                <p className="text-xs text-[#526259]">
                  No operational responsibilities configured for this profile.
                </p>
              ) : (
                <div className="space-y-3">
                  {detail.responsibilities.map((resp) => (
                    <div
                      key={resp.id}
                      className="p-4 rounded-xl bg-[#F6F8F6] border border-[#E3E8E4] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs font-semibold text-[#0B261C]">
                          <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" aria-hidden="true" />
                          <span>{resp.title}</span>
                        </div>
                        <p className="text-xs text-[#526259] leading-relaxed pl-6">{resp.scope}</p>
                      </div>
                      {resp.metricLabel && resp.metricValue && (
                        <div className="pl-6 sm:pl-0 sm:text-right shrink-0">
                          <div className="text-[11px] text-[#526259]">{resp.metricLabel}</div>
                          <div className="text-xs font-mono font-semibold text-[#047857]">
                            {resp.metricValue}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* F. ACTIVITY HISTORY */}
          {activeSection === 'activity' && (
            <section className="card-surface rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#E3E8E4] pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Recorded Workforce &amp; Audit Activity
                  </h3>
                  <p className="text-xs text-[#526259] mt-0.5">
                    Profile updates, actor events, and assigned appointment audit entries
                  </p>
                </div>
                <span className="text-xs font-mono text-[#526259]">
                  {detail.permissions.canViewAuditHistory
                    ? `${detail.activity.length} event${detail.activity.length === 1 ? '' : 's'}`
                    : 'Restricted'}
                </span>
              </div>

              {!detail.permissions.canViewAuditHistory ? (
                <div className="p-6 rounded-xl bg-[#F6F8F6] border border-[#E3E8E4] text-center space-y-2">
                  <Lock className="w-6 h-6 text-amber-700 mx-auto" aria-hidden="true" />
                  <p className="text-sm font-medium text-[#111C17]">
                    Administrator Privileges Required for Audit History
                  </p>
                  <p className="text-xs text-[#526259] max-w-md mx-auto">
                    Detailed staff audit trails are restricted to Administrator sessions.
                  </p>
                </div>
              ) : detail.activity.length === 0 ? (
                <p className="text-xs text-[#526259] py-4">
                  No recorded audit activity for {detail.fullName} yet.
                </p>
              ) : (
                <ol className="relative border-l border-[#E3E8E4] ml-2 space-y-4">
                  {detail.activity.map((entry) => (
                    <li key={entry.id} className="pl-4 relative">
                      <span
                        className="absolute -left-[4.5px] top-1.5 w-2 h-2 rounded-full bg-[#059669] ring-2 ring-white"
                        aria-hidden="true"
                      />
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#526259]">
                        <span className="font-semibold text-[#0B261C]">{entry.action}</span>
                        <span>·</span>
                        <span>
                          {entry.resourceType}:{entry.resourceId}
                        </span>
                        <span>·</span>
                        <span>{entry.createdAt.slice(0, 19).replace('T', ' ')}</span>
                      </div>
                      <p className="text-xs text-[#111C17] mt-1 leading-relaxed">{entry.summary}</p>
                      <div className="text-[11px] text-[#526259] mt-0.5">Actor: {entry.actor}</div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Edit Staff Profile Modal */}
      <ModalShell
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        labelledBy="staff-edit-title"
        maxWidthClass="max-w-lg"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 id="staff-edit-title" className="text-base font-semibold text-[#16211C]">
              Edit Staff Profile · {detail.fullName}
            </h3>
            <p className="text-xs text-[#526058] mt-0.5">
              Update department, specialty, contact info, or employment status in SQLite.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowEditModal(false)}
            className="p-1 text-[#526058] hover:text-[#16211C]"
            aria-label="Close edit staff dialog"
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
              <label htmlFor="staff-edit-role" className="block text-xs font-medium text-[#16211C] mb-1">
                Role
              </label>
              <select
                id="staff-edit-role"
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as StaffRole)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
              >
                <option value="Clinician">Clinician</option>
                <option value="Administrator">Administrator</option>
                <option value="Coordinator">Coordinator</option>
                <option value="Viewer">Viewer</option>
              </select>
            </div>
            <div>
              <label htmlFor="staff-edit-status" className="block text-xs font-medium text-[#16211C] mb-1">
                Employment Status
              </label>
              <select
                id="staff-edit-status"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as StaffStatus)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
              >
                <option value="Active">Active</option>
                <option value="On Leave">On Leave</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="staff-edit-dept" className="block text-xs font-medium text-[#16211C] mb-1">
                Department
              </label>
              <select
                id="staff-edit-dept"
                value={editDepartment}
                onChange={(e) => setEditDepartment(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
              >
                {departmentOptions.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="staff-edit-spec" className="block text-xs font-medium text-[#16211C] mb-1">
                Specialty
              </label>
              <input
                id="staff-edit-spec"
                type="text"
                value={editSpecialty}
                onChange={(e) => setEditSpecialty(e.target.value)}
                placeholder="e.g. Preventive Cardiology"
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="staff-edit-email" className="block text-xs font-medium text-[#16211C] mb-1">
                Work Email (optional)
              </label>
              <input
                id="staff-edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="staff@caredesk.example.org"
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="staff-edit-phone" className="block text-xs font-medium text-[#16211C] mb-1">
                Contact Number (optional)
              </label>
              <input
                id="staff-edit-phone"
                type="tel"
                value={editContact}
                onChange={(e) => setEditContact(e.target.value)}
                placeholder="+1-555-0100"
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E4E7E2]">
            <button
              type="button"
              onClick={() => setShowEditModal(false)}
              className="px-4 py-2 text-sm font-medium text-[#526058] hover:text-[#16211C] border border-[#E4E7E2] rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 btn-press"
            >
              {submitting ? 'Saving...' : 'Save Staff Profile'}
            </button>
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
