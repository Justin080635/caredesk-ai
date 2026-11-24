import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Trash2,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import {
  addDoctorUnavailability,
  createConsultationRecord,
  deleteDoctorUnavailability,
  fetchAppointments,
  fetchDoctorActivity,
  fetchDoctorConsultations,
  fetchDoctorDashboard,
  fetchDoctorPatients,
  fetchDoctorSchedule,
  fetchDoctorUnavailability,
  fetchNotifications,
  fetchPatientDetail,
  markAllNotificationsRead,
  markNotificationRead,
  saveDoctorSchedule,
  updateAppointmentRecord,
  updateDoctorDutyStatus,
  updateDoctorProfile,
  updateFollowupRecord,
} from '../client/api';
import { requestPasswordReset } from '../client/firebase';
import {
  CLINIC_DEPARTMENTS,
  DOCTOR_DUTY_STATUSES,
  WEEKDAY_NAMES,
} from '../shared/constants';
import type {
  AccountSessionState,
  Appointment,
  AuditLogEntry,
  ConsultationRecord,
  DoctorDashboardData,
  DoctorDutyStatus,
  DoctorScheduleDay,
  DoctorUnavailability,
  FollowUpPriority,
  FollowUpStatus,
  NotificationItem,
  Patient,
  PatientDetail,
  PrescriptionItem,
  TestResultItem,
} from '../shared/types';
import { AssistantView } from './AssistantView';
import { EditorialAvatar } from './ClinicIllustrations';
import { ModalShell } from './ModalShell';
import {
  AppointmentStatusText,
  DoctorDutyStatusText,
  FollowUpStatusText,
  PriorityText,
} from './StatusText';

type DoctorTab = 'dashboard' | 'schedule' | 'patients' | 'activity' | 'profile' | 'assistant';

interface DoctorWorkspaceProps {
  session: AccountSessionState;
  onSessionRefresh: () => Promise<void>;
  onSwitchClinic: (clinicId: string) => Promise<void>;
  onSignOut: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
}

const DOCTOR_NAV: Array<{
  id: DoctorTab;
  label: string;
  subtitle: string;
  icon: typeof Activity;
}> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    subtitle: 'Today’s clinical queue, live duty status, and pending summaries',
    icon: Stethoscope,
  },
  {
    id: 'schedule',
    label: 'My Schedule',
    subtitle: 'Day, week & month appointments, working hours, and leave blocks',
    icon: Calendar,
  },
  {
    id: 'patients',
    label: 'My Patients',
    subtitle: 'Assigned caseload, consultation authoring, and clinical follow-ups',
    icon: Users,
  },
  {
    id: 'activity',
    label: 'My Activity',
    subtitle: 'Recorded clinical actions, schedule changes, and audit events',
    icon: Activity,
  },
  {
    id: 'profile',
    label: 'My Profile',
    subtitle: 'Credentials, license details, capacity settings, and account security',
    icon: UserCircle,
  },
  {
    id: 'assistant',
    label: 'AI Assistant',
    subtitle: 'Doctor-scoped schedule, caseload, and clinical workflow copilot',
    icon: Bot,
  },
];

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function addDays(dateKey: string, delta: number): string {
  const dt = new Date(`${dateKey}T12:00:00`);
  dt.setDate(dt.getDate() + delta);
  return formatDateKey(dt);
}

export function DoctorWorkspace({
  session,
  onSessionRefresh,
  onSwitchClinic,
  onSignOut,
  onErrorNotice,
  onSuccessNotice,
}: DoctorWorkspaceProps) {
  const { user, activeClinic, clinics, linkedStaff } = session;

  const [activeTab, setActiveTab] = useState<DoctorTab>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);

  // Dashboard & Core Data
  const [dashboard, setDashboard] = useState<DoctorDashboardData | null>(null);
  const [loadingDash, setLoadingDash] = useState(true);
  const [updatingDuty, setUpdatingDuty] = useState(false);
  const [updatingAptId, setUpdatingAptId] = useState<string | null>(null);

  // Notifications
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement | null>(null);

  // Schedule State
  const [scheduleMode, setScheduleMode] = useState<'day' | 'week' | 'month'>('week');
  const [focusDate, setFocusDate] = useState(() => formatDateKey(new Date()));
  const [scheduleDays, setScheduleDays] = useState<DoctorScheduleDay[]>([]);
  const [unavailability, setUnavailability] = useState<DoctorUnavailability[]>([]);
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  // Unavailability form
  const [unavailStart, setUnavailStart] = useState(() => formatDateKey(new Date()));
  const [unavailEnd, setUnavailEnd] = useState(() => formatDateKey(new Date()));
  const [unavailStartTime, setUnavailStartTime] = useState('09:00');
  const [unavailEndTime, setUnavailEndTime] = useState('17:00');
  const [unavailKind, setUnavailKind] = useState<DoctorUnavailability['kind']>('Leave');
  const [unavailReason, setUnavailReason] = useState('');
  const [addingUnavail, setAddingUnavail] = useState(false);

  // Patients & Consultations State
  const [patientSearch, setPatientSearch] = useState('');
  const [patients, setPatients] = useState<
    Array<
      Patient & {
        appointmentsCount: number;
        upcomingCount: number;
        lastAppointmentDate: string | null;
        consultationsCount: number;
      }
    >
  >([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [selectedPatientDetail, setSelectedPatientDetail] = useState<PatientDetail | null>(null);
  const [loadingPatientDetail, setLoadingPatientDetail] = useState(false);
  const [recentConsultations, setRecentConsultations] = useState<ConsultationRecord[]>([]);

  // Consultation Modal
  const [consultModalOpen, setConsultModalOpen] = useState(false);
  const [consultPatientId, setConsultPatientId] = useState('');
  const [consultAppointmentId, setConsultAppointmentId] = useState<string>('');
  const [consultDate, setConsultDate] = useState(() => formatDateKey(new Date()));
  const [consultSummary, setConsultSummary] = useState('');
  const [consultDiagnosis, setConsultDiagnosis] = useState('');
  const [consultRecommendations, setConsultRecommendations] = useState('');
  const [consultVisible, setConsultVisible] = useState(true);
  const [prescriptions, setPrescriptions] = useState<PrescriptionItem[]>([]);
  const [testResults, setTestResults] = useState<TestResultItem[]>([]);
  const [includeFollowup, setIncludeFollowup] = useState(false);
  const [fuDesc, setFuDesc] = useState('');
  const [fuReason, setFuReason] = useState('');
  const [fuDue, setFuDue] = useState(() => addDays(formatDateKey(new Date()), 7));
  const [fuPriority, setFuPriority] = useState<FollowUpPriority>('Medium');
  const [savingConsult, setSavingConsult] = useState(false);

  // Activity State
  const [activityLogs, setActivityLogs] = useState<AuditLogEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // Profile State
  const [profSpecialty, setProfSpecialty] = useState(linkedStaff?.specialty ?? '');
  const [profQualifications, setProfQualifications] = useState(linkedStaff?.qualifications ?? '');
  const [profLicense, setProfLicense] = useState(linkedStaff?.licenseNumber ?? '');
  const [profBio, setProfBio] = useState(linkedStaff?.bio ?? '');
  const [profContact, setProfContact] = useState(linkedStaff?.contactNumber ?? '');
  const [profDuration, setProfDuration] = useState(linkedStaff?.defaultAppointmentDuration ?? 30);
  const [profCapacity, setProfCapacity] = useState(linkedStaff?.maxDailyCapacity ?? 16);
  const [savingProfile, setSavingProfile] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const staffId = dashboard?.doctor?.id ?? linkedStaff?.id ?? '';

  const loadNotifications = useCallback(async () => {
    try {
      const data = await fetchNotifications(25);
      setNotifications(data.items);
      setUnreadCount(data.unreadCount);
    } catch {
      // Non-blocking
    }
  }, []);

  const loadDashboardData = useCallback(async () => {
    setLoadingDash(true);
    try {
      const [dash, consults] = await Promise.all([
        fetchDoctorDashboard(),
        fetchDoctorConsultations(),
      ]);
      setDashboard(dash);
      setRecentConsultations(consults);
      setProfSpecialty(dash.doctor.specialty ?? '');
      setProfQualifications(dash.doctor.qualifications ?? '');
      setProfLicense(dash.doctor.licenseNumber ?? '');
      setProfBio(dash.doctor.bio ?? '');
      setProfContact(dash.doctor.contactNumber ?? '');
      setProfDuration(dash.doctor.defaultAppointmentDuration ?? 30);
      setProfCapacity(dash.doctor.maxDailyCapacity ?? 16);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load doctor dashboard.');
    } finally {
      setLoadingDash(false);
    }
  }, [onErrorNotice]);

  useEffect(() => {
    loadDashboardData();
    loadNotifications();
  }, [loadDashboardData, loadNotifications, refreshSignal]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const loadScheduleData = useCallback(async () => {
    if (!staffId) return;
    setLoadingSchedule(true);
    try {
      const [days, blocks, apts] = await Promise.all([
        fetchDoctorSchedule(staffId),
        fetchDoctorUnavailability(staffId),
        fetchAppointments({ staffId }),
      ]);
      setScheduleDays(days);
      setUnavailability(blocks);
      setAllAppointments(apts);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load schedule configuration.');
    } finally {
      setLoadingSchedule(false);
    }
  }, [staffId, onErrorNotice]);

  const loadPatientsData = useCallback(async () => {
    setLoadingPatients(true);
    try {
      const list = await fetchDoctorPatients(patientSearch || undefined);
      setPatients(list);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load assigned patients.');
    } finally {
      setLoadingPatients(false);
    }
  }, [patientSearch, onErrorNotice]);

  const loadActivityData = useCallback(async () => {
    setLoadingActivity(true);
    try {
      const logs = await fetchDoctorActivity();
      setActivityLogs(logs);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load activity log.');
    } finally {
      setLoadingActivity(false);
    }
  }, [onErrorNotice]);

  useEffect(() => {
    if (activeTab === 'schedule') {
      loadScheduleData();
    } else if (activeTab === 'patients') {
      loadPatientsData();
    } else if (activeTab === 'activity') {
      loadActivityData();
    }
  }, [activeTab, refreshSignal, loadScheduleData, loadPatientsData, loadActivityData]);

  const triggerRefresh = useCallback(() => {
    setRefreshSignal((s) => s + 1);
  }, []);

  const handleOpenPatientDetail = async (patientId: string) => {
    setLoadingPatientDetail(true);
    try {
      const detail = await fetchPatientDetail(patientId);
      setSelectedPatientDetail(detail);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to open patient chart.');
    } finally {
      setLoadingPatientDetail(false);
    }
  };

  const handleDutyStatusChange = async (nextStatus: DoctorDutyStatus) => {
    if (!staffId) return;
    setUpdatingDuty(true);
    try {
      await updateDoctorDutyStatus(staffId, nextStatus);
      onSuccessNotice(`Duty status updated to ${nextStatus}.`);
      triggerRefresh();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to update duty status.');
    } finally {
      setUpdatingDuty(false);
    }
  };

  const handleAppointmentStatus = async (aptId: string, status: Appointment['status']) => {
    setUpdatingAptId(aptId);
    try {
      await updateAppointmentRecord(aptId, { status });
      onSuccessNotice(`Appointment ${aptId} updated to ${status}.`);
      triggerRefresh();
      if (selectedPatientDetail) {
        void handleOpenPatientDetail(selectedPatientDetail.id);
      }
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to update appointment.');
    } finally {
      setUpdatingAptId(null);
    }
  };

  const handleFollowupUpdate = async (taskId: string, status: FollowUpStatus) => {
    try {
      await updateFollowupRecord(taskId, { status });
      onSuccessNotice(`Follow-up ${taskId} marked as ${status}.`);
      triggerRefresh();
      if (selectedPatientDetail) {
        void handleOpenPatientDetail(selectedPatientDetail.id);
      }
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to update follow-up.');
    }
  };

  const openConsultationModal = (patientId: string, appointmentId = '') => {
    setConsultPatientId(patientId);
    setConsultAppointmentId(appointmentId);
    setConsultDate(formatDateKey(new Date()));
    setConsultSummary('');
    setConsultDiagnosis('');
    setConsultRecommendations('');
    setConsultVisible(true);
    setPrescriptions([]);
    setTestResults([]);
    setIncludeFollowup(false);
    setFuDesc('');
    setFuReason('');
    setFuDue(addDays(formatDateKey(new Date()), 7));
    setFuPriority('Medium');
    setConsultModalOpen(true);
  };

  const handleSaveConsultation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consultSummary.trim()) {
      onErrorNotice('Consultation summary is required.');
      return;
    }
    setSavingConsult(true);
    try {
      await createConsultationRecord({
        patientId: consultPatientId,
        appointmentId: consultAppointmentId || null,
        consultationDate: consultDate,
        summary: consultSummary.trim(),
        diagnosisNotes: consultDiagnosis.trim(),
        recommendations: consultRecommendations.trim(),
        prescriptions: prescriptions.filter((p) => p.medication.trim().length > 0),
        testResults: testResults.filter((t) => t.testName.trim().length > 0),
        patientVisible: consultVisible,
        createFollowUp:
          includeFollowup && fuDesc.trim()
            ? {
                description: fuDesc.trim(),
                reason: fuReason.trim(),
                dueDate: fuDue,
                priority: fuPriority,
              }
            : null,
      });
      setConsultModalOpen(false);
      onSuccessNotice(
        `Consultation record saved${consultVisible ? ' and published to Patient Portal' : ' (clinician-only)'}.`
      );
      triggerRefresh();
      if (selectedPatientDetail?.id === consultPatientId) {
        void handleOpenPatientDetail(consultPatientId);
      }
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to save consultation.');
    } finally {
      setSavingConsult(false);
    }
  };

  const handleSaveScheduleDays = async () => {
    if (!staffId) return;
    setSavingSchedule(true);
    try {
      const updated = await saveDoctorSchedule(
        staffId,
        scheduleDays.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          isWorking: d.isWorking,
          startTime: d.startTime,
          endTime: d.endTime,
          breakStart: d.breakStart,
          breakEnd: d.breakEnd,
          slotDurationMinutes: d.slotDurationMinutes,
        }))
      );
      setScheduleDays(updated);
      onSuccessNotice('Weekly schedule and break windows saved.');
      triggerRefresh();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to save schedule.');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleAddUnavailability = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffId) return;
    setAddingUnavail(true);
    try {
      await addDoctorUnavailability(staffId, {
        startDate: unavailStart,
        endDate: unavailEnd || unavailStart,
        startTime: unavailKind === 'Leave' ? '00:00' : unavailStartTime,
        endTime: unavailKind === 'Leave' ? '23:59' : unavailEndTime,
        kind: unavailKind,
        reason: unavailReason.trim(),
      });
      setUnavailReason('');
      onSuccessNotice('Blocked leave / unavailability window added.');
      await loadScheduleData();
      triggerRefresh();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to add unavailability block.');
    } finally {
      setAddingUnavail(false);
    }
  };

  const handleDeleteUnavailability = async (id: string) => {
    if (!staffId) return;
    try {
      await deleteDoctorUnavailability(staffId, id);
      onSuccessNotice('Removed unavailability block.');
      await loadScheduleData();
      triggerRefresh();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to remove block.');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateDoctorProfile({
        specialty: profSpecialty.trim(),
        qualifications: profQualifications.trim(),
        licenseNumber: profLicense.trim(),
        bio: profBio.trim(),
        contactNumber: profContact.trim(),
        defaultAppointmentDuration: Number(profDuration),
        maxDailyCapacity: Number(profCapacity),
      });
      await onSessionRefresh();
      triggerRefresh();
      onSuccessNotice('Doctor profile & capacity settings updated.');
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to update doctor profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSendPasswordReset = async () => {
    setSendingReset(true);
    try {
      await requestPasswordReset(user.email);
      onSuccessNotice(`Password reset link sent to ${user.email}.`);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to send reset email.');
    } finally {
      setSendingReset(false);
    }
  };

  const weekDates = useMemo(() => {
    const dt = new Date(`${focusDate}T12:00:00`);
    const day = dt.getDay();
    const sunday = addDays(focusDate, -day);
    return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
  }, [focusDate]);

  const monthDates = useMemo(() => {
    const dt = new Date(`${focusDate}T12:00:00`);
    const year = dt.getFullYear();
    const month = dt.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) =>
      `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
    );
  }, [focusDate]);

  const currentNav = DOCTOR_NAV.find((n) => n.id === activeTab) ?? DOCTOR_NAV[0];

  const renderSidebar = (isMobile: boolean, collapsed = false) => (
    <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto" aria-label="Doctor Portal Navigation">
      {!collapsed && (
        <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200/50">
          Doctor Workspace
        </div>
      )}
      {DOCTOR_NAV.map((item) => {
        const Icon = item.icon;
        const active = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setActiveTab(item.id);
              if (isMobile) setMobileMenuOpen(false);
            }}
            title={collapsed ? item.label : undefined}
            aria-current={active ? 'page' : undefined}
            className={`btn-press relative w-full flex items-center ${
              collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
            } rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              active
                ? 'bg-[#059669] text-white'
                : 'text-emerald-100/80 hover:bg-[#12382A] hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            {!collapsed && <span>{item.label}</span>}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-[#F6F8F6] text-[#111C17]">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen shrink-0 bg-[#0B261C] text-emerald-50 border-r border-[#174333] transition-[width] duration-200 ${
          sidebarCollapsed ? 'w-[76px]' : 'w-60'
        }`}
      >
        <div
          className={`px-4 py-4 border-b border-[#174333] flex items-center ${
            sidebarCollapsed ? 'justify-center flex-col gap-2' : 'justify-between gap-2'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#059669] text-white flex items-center justify-center shrink-0">
              <Stethoscope className="w-4 h-4" aria-hidden="true" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <div className="text-base font-bold text-white truncate">CareDesk AI</div>
                <div className="text-[11px] text-emerald-200/75 truncate">
                  {activeClinic?.name}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="p-1.5 text-emerald-200/75 hover:text-white hover:bg-[#12382A] rounded-md"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {!sidebarCollapsed && clinics.length > 1 && (
          <div className="px-3 pt-3">
            <select
              aria-label="Switch clinic workspace"
              value={activeClinic?.id ?? ''}
              onChange={(e) => onSwitchClinic(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-[#071D15] text-emerald-100 border border-[#174333] rounded-lg"
            >
              {clinics.map((c) => (
                <option key={c.clinic.id} value={c.clinic.id}>
                  {c.clinic.name} ({c.membership.role})
                </option>
              ))}
            </select>
          </div>
        )}

        {renderSidebar(false, sidebarCollapsed)}

        <div className="p-3.5 border-t border-[#174333] space-y-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'justify-center p-2' : 'gap-3 p-2.5'
            } rounded-lg bg-[#071D15] hover:bg-[#12382A] text-left`}
          >
            <EditorialAvatar name={dashboard?.doctor?.fullName ?? user.fullName} role="clinician" size="sm" />
            {!sidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-white truncate">
                  {dashboard?.doctor?.fullName ?? user.fullName}
                </div>
                <div className="text-[11px] font-mono text-emerald-300 truncate">
                  Doctor · {dashboard?.doctor?.department ?? 'Clinical'}
                </div>
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium text-emerald-100/85 hover:text-white bg-[#071D15] hover:bg-[#12382A] border border-[#174333] rounded-lg"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            {!sidebarCollapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-64 max-w-[82vw] bg-[#0B261C] text-emerald-50 flex flex-col z-10">
            <div className="px-5 py-4 border-b border-[#174333] flex items-center justify-between">
              <div className="text-base font-bold text-white">Doctor Portal</div>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-1 text-emerald-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderSidebar(true, false)}
            <div className="p-4 border-t border-[#174333]">
              <button
                type="button"
                onClick={onSignOut}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-[#071D15] border border-[#174333] rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-[#E3E8E4] px-4 sm:px-6 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-[#526259] hover:text-[#111C17] rounded-lg"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#526259]">
                <Building2 className="w-3 h-3 text-[#047857]" aria-hidden="true" />
                <span className="font-medium text-[#111C17]">{activeClinic?.name}</span>
                <span>·</span>
                <span>Doctor Portal</span>
                {staffId && (
                  <>
                    <span>·</span>
                    <span className="font-mono">{staffId}</span>
                  </>
                )}
              </div>
              <h1 className="text-base sm:text-lg font-semibold text-[#111C17] truncate">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {dashboard && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-[#F6F8F6] border border-[#E3E8E4] rounded-lg">
                <span className="text-[11px] text-[#526259]">Status:</span>
                <DoctorDutyStatusText status={dashboard.effectiveOperationalState} />
              </div>
            )}

            {/* Notifications */}
            <div ref={notifRef} className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((p) => !p)}
                className="relative p-2 text-[#526259] hover:text-[#111C17] bg-white hover:bg-[#F6F8F6] border border-[#E3E8E4] rounded-lg"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#059669] text-white text-[10px] font-mono font-semibold flex items-center justify-center tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-1.5 w-80 bg-white border border-[#E3E8E4] rounded-xl shadow-lg z-40 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[#E3E8E4] bg-[#F6F8F6] flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#111C17]">Clinical Notifications</span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          await markAllNotificationsRead();
                          loadNotifications();
                        }}
                        className="text-[11px] font-medium text-[#047857] hover:underline"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-[#EEF2EF] max-h-72 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="p-4 text-xs text-[#526259] text-center">
                        No notifications right now.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={async () => {
                            if (!n.isRead) {
                              await markNotificationRead(n.id);
                              loadNotifications();
                            }
                            setNotifOpen(false);
                          }}
                          className={`w-full text-left px-4 py-3 hover:bg-[#F6F8F6] transition-colors ${
                            !n.isRead ? 'bg-[#ECF4EF]/50' : ''
                          }`}
                        >
                          <div className="text-xs font-semibold text-[#111C17]">{n.title}</div>
                          <div className="text-[11px] text-[#526259] mt-0.5">{n.message}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={triggerRefresh}
              className="p-2 text-[#526259] hover:text-[#111C17] border border-[#E3E8E4] rounded-lg hover:bg-[#F6F8F6]"
              aria-label="Refresh workspace"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-6">
          {/* TAB 1: DOCTOR DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6 animate-view-enter">
              {loadingDash && !dashboard ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="h-32 card-surface rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : dashboard ? (
                <>
                  {/* Duty & Header Strip */}
                  <section className="card-surface rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#526259]">
                        <span className="font-mono font-semibold text-[#047857]">{dashboard.doctor.id}</span>
                        <span>·</span>
                        <span>{dashboard.doctor.department}</span>
                        <span>·</span>
                        <span>{dashboard.doctor.specialty}</span>
                      </div>
                      <h2 className="text-xl font-bold text-[#111C17]">
                        {dashboard.doctor.fullName}
                      </h2>
                      <p className="text-xs text-[#526259]">
                        {dashboard.todaySchedule?.isWorking
                          ? `Working Window Today (${dashboard.todayDate}): ${dashboard.todaySchedule.startTime}–${dashboard.todaySchedule.endTime}`
                          : `Off schedule on ${dashboard.todayDate}`}
                        {dashboard.todaySchedule?.breakStart
                          ? ` · Break ${dashboard.todaySchedule.breakStart}–${dashboard.todaySchedule.breakEnd}`
                          : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="doc-duty-select" className="text-xs font-medium text-[#526259]">
                        Duty Status:
                      </label>
                      <select
                        id="doc-duty-select"
                        disabled={updatingDuty}
                        value={dashboard.doctor.attendanceStatus ?? 'On Duty'}
                        onChange={(e) => handleDutyStatusChange(e.target.value as DoctorDutyStatus)}
                        className="px-3 py-2 text-xs font-medium border border-[#D4DAD4] rounded-lg bg-white"
                      >
                        {DOCTOR_DUTY_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setActiveTab('schedule')}
                        className="px-3.5 py-2 text-xs font-medium text-[#0B261C] bg-[#ECF4EF] hover:bg-[#D7E6DD] rounded-lg whitespace-nowrap shrink-0"
                      >
                        Configure Hours
                      </button>
                    </div>
                  </section>

                  {/* 4 KPI Cards */}
                  <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-[#0B261C] text-white rounded-xl p-5">
                      <div className="text-xs font-medium text-emerald-200/85">Today&apos;s Visits</div>
                      <div className="text-3xl font-bold font-mono tabular-nums mt-2">
                        {dashboard.todayAppointments.length}
                      </div>
                      <div className="text-[11px] text-emerald-100/75 mt-1">
                        {dashboard.nextAppointment
                          ? `Next: ${dashboard.nextAppointment.appointmentTime} · ${dashboard.nextAppointment.patientName}`
                          : 'No remaining visits today'}
                      </div>
                    </div>

                    <div className="card-surface rounded-xl p-5">
                      <div className="text-xs font-medium text-[#526259]">Assigned Patients</div>
                      <div className="text-3xl font-bold font-mono tabular-nums text-[#111C17] mt-2">
                        {dashboard.assignedPatientsCount}
                      </div>
                      <div className="text-[11px] text-[#526259] mt-1">Active clinic caseload</div>
                    </div>

                    <div className="card-surface rounded-xl p-5">
                      <div className="text-xs font-medium text-[#526259]">Pending Consultations</div>
                      <div className="text-3xl font-bold font-mono tabular-nums text-amber-700 mt-2">
                        {dashboard.pendingConsultationsCount}
                      </div>
                      <div className="text-[11px] text-[#526259] mt-1">
                        Visits needing clinical summary
                      </div>
                    </div>

                    <div className="card-surface rounded-xl p-5">
                      <div className="text-xs font-medium text-[#526259]">Follow-ups Attention</div>
                      <div className="text-3xl font-bold font-mono tabular-nums text-[#047857] mt-2">
                        {dashboard.followupsRequiringAttention.length}
                      </div>
                      <div className="text-[11px] text-[#526259] mt-1">
                        Assigned or clinical tasks open
                      </div>
                    </div>
                  </section>

                  {/* Today's Queue + Follow-ups */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    <section className="lg:col-span-7 card-surface rounded-xl overflow-hidden">
                      <div className="px-5 py-4 border-b border-[#E3E8E4] flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-[#111C17]">
                            Today&apos;s Appointment Queue ({dashboard.todayDate})
                          </h3>
                          <p className="text-xs text-[#526259]">
                            Update visit progress or document consultation summaries
                          </p>
                        </div>
                        <span className="text-xs font-mono text-[#526259]">
                          {dashboard.todayAppointments.length} visit{dashboard.todayAppointments.length === 1 ? '' : 's'}
                        </span>
                      </div>

                      {dashboard.todayAppointments.length === 0 ? (
                        <div className="p-8 text-center text-xs text-[#526259]">
                          No appointments scheduled for today ({dashboard.todayDate}).
                        </div>
                      ) : (
                        <div className="divide-y divide-[#EEF2EF]">
                          {dashboard.todayAppointments.map((apt) => (
                            <div
                              key={apt.id}
                              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F6F8F6]"
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <span className="font-mono font-semibold text-[#0B261C] tabular-nums">
                                    {apt.appointmentTime}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveTab('patients');
                                      void handleOpenPatientDetail(apt.patientId);
                                    }}
                                    className="font-semibold text-[#047857] hover:underline"
                                  >
                                    {apt.patientName ?? apt.patientId}
                                  </button>
                                  <span className="font-mono text-[#526259]">
                                    {apt.patientId} · {apt.appointmentType ?? 'Consultation'}
                                  </span>
                                </div>
                                {apt.notes && (
                                  <p className="text-xs text-[#526259]">{apt.notes}</p>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                <AppointmentStatusText status={apt.status} />
                                {apt.status === 'Scheduled' && (
                                  <button
                                    type="button"
                                    disabled={updatingAptId === apt.id}
                                    onClick={() => handleAppointmentStatus(apt.id, 'Confirmed')}
                                    className="px-2.5 py-1 text-xs font-medium bg-[#ECF4EF] text-[#047857] hover:bg-[#D7E6DD] rounded-md whitespace-nowrap"
                                  >
                                    Check In / Confirm
                                  </button>
                                )}
                                {(apt.status === 'Scheduled' || apt.status === 'Confirmed') && (
                                  <button
                                    type="button"
                                    disabled={updatingAptId === apt.id}
                                    onClick={() => handleAppointmentStatus(apt.id, 'Completed')}
                                    className="px-2.5 py-1 text-xs font-medium bg-[#059669] text-white hover:bg-[#047857] rounded-md whitespace-nowrap"
                                  >
                                    Complete Visit
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openConsultationModal(apt.patientId, apt.id)}
                                  className="px-2.5 py-1 text-xs font-medium border border-[#D4DAD4] text-[#111C17] hover:bg-[#F6F8F6] rounded-md whitespace-nowrap"
                                >
                                  Add Consultation
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="lg:col-span-5 card-surface rounded-xl overflow-hidden">
                      <div className="px-5 py-4 border-b border-[#E3E8E4] flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-[#111C17]">
                            Follow-ups Requiring Attention
                          </h3>
                          <p className="text-xs text-[#526259]">
                            Open clinical recommendations and assigned tasks
                          </p>
                        </div>
                        <ClipboardList className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                      </div>

                      {dashboard.followupsRequiringAttention.length === 0 ? (
                        <div className="p-6 text-xs text-[#526259]">
                          All follow-ups assigned to you are currently complete.
                        </div>
                      ) : (
                        <div className="divide-y divide-[#EEF2EF]">
                          {dashboard.followupsRequiringAttention.map((fu) => (
                            <div key={fu.id} className="p-4 space-y-2 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-mono font-semibold text-[#0B261C]">
                                  {fu.id} · {fu.patientName ?? fu.patientId}
                                </span>
                                <div className="flex items-center gap-2">
                                  <PriorityText priority={fu.priority} />
                                  <FollowUpStatusText status={fu.status} />
                                </div>
                              </div>
                              <p className="text-[#34433B]">{fu.description}</p>
                              <div className="flex items-center justify-between pt-1">
                                <span className="font-mono text-[#526259]">Due {fu.dueDate}</span>
                                <button
                                  type="button"
                                  onClick={() => handleFollowupUpdate(fu.id, 'Completed')}
                                  className="text-xs font-medium text-[#047857] hover:underline"
                                >
                                  Mark Completed
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </>
              ) : (
                <div className="card-surface rounded-xl p-8 text-center text-sm text-[#526259]">
                  Doctor profile data could not be retrieved. Ensure your clinician profile is active.
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MY SCHEDULE */}
          {activeTab === 'schedule' && (
            <div className="space-y-6 animate-view-enter">
              <div className="card-surface rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 p-1 bg-[#F1F5F2] rounded-lg">
                    {(['day', 'week', 'month'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setScheduleMode(m)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize ${
                          scheduleMode === m ? 'bg-white text-[#0B261C] shadow-xs' : 'text-[#526259]'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <input
                    type="date"
                    aria-label="Focus schedule date"
                    value={focusDate}
                    onChange={(e) => setFocusDate(e.target.value)}
                    className="px-3 py-1.5 text-xs font-mono border border-[#D4DAD4] rounded-lg bg-white"
                  />
                </div>
                <div className="text-xs text-[#526259] font-mono">
                  {allAppointments.length} total assigned visits
                </div>
              </div>

              {/* Calendar Grid (Day / Week / Month) */}
              <section className="card-surface rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-[#111C17]">
                  {scheduleMode === 'day'
                    ? `Day Schedule · ${focusDate}`
                    : scheduleMode === 'week'
                      ? `Week View (${weekDates[0]} to ${weekDates[6]})`
                      : `Month View · ${focusDate.slice(0, 7)}`}
                </h3>

                {loadingSchedule ? (
                  <div className="h-32 bg-[#F6F8F6] rounded-lg animate-pulse" />
                ) : scheduleMode === 'day' ? (
                  <div className="divide-y divide-[#EEF2EF]">
                    {allAppointments
                      .filter((a) => a.appointmentDate === focusDate)
                      .map((apt) => (
                        <div key={apt.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                          <div>
                            <span className="font-mono font-semibold text-[#0B261C] mr-2">
                              {apt.appointmentTime}
                            </span>
                            <span className="font-semibold text-[#111C17]">{apt.patientName}</span>
                            <span className="font-mono text-[#526259] ml-2">
                              {apt.id} · {apt.appointmentType ?? 'Consultation'} ({apt.durationMinutes}m)
                            </span>
                          </div>
                          <AppointmentStatusText status={apt.status} />
                        </div>
                      ))}
                    {allAppointments.filter((a) => a.appointmentDate === focusDate).length === 0 && (
                      <p className="py-4 text-xs text-[#526259]">No appointments on {focusDate}.</p>
                    )}
                  </div>
                ) : (
                  <div
                    className={`grid gap-2.5 ${
                      scheduleMode === 'week'
                        ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-7'
                        : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'
                    }`}
                  >
                    {(scheduleMode === 'week' ? weekDates : monthDates).map((dKey) => {
                      const dayApts = allAppointments.filter(
                        (a) => a.appointmentDate === dKey && a.status !== 'Cancelled'
                      );
                      const isSelected = dKey === focusDate;
                      return (
                        <div
                          key={dKey}
                          className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                            isSelected
                              ? 'border-[#059669] bg-[#ECF4EF]/50'
                              : 'border-[#E3E8E4] bg-[#F9FBFA]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-semibold text-[#0B261C]">
                              {dKey.slice(5)}
                            </span>
                            <span className="font-mono text-[11px] text-[#526259]">
                              {dayApts.length}
                            </span>
                          </div>
                          {dayApts.slice(0, 3).map((apt) => (
                            <div
                              key={apt.id}
                              className="p-1.5 rounded bg-white border border-[#E3E8E4] text-[11px] truncate"
                            >
                              <span className="font-mono font-semibold">{apt.appointmentTime}</span>{' '}
                              {apt.patientName}
                            </div>
                          ))}
                          {dayApts.length > 3 && (
                            <div className="text-[10px] font-mono text-[#047857]">
                              +{dayApts.length - 3} more
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Weekly Working Hours + Break Windows & Unavailability Blocks */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <section className="lg:col-span-7 card-surface rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-[#E3E8E4] pb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#111C17]">
                        Weekly Working Hours &amp; Break Windows
                      </h3>
                      <p className="text-xs text-[#526259]">
                        Open slots automatically exclude breaks, booked visits, and leave blocks.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={savingSchedule || scheduleDays.length === 0}
                      onClick={handleSaveScheduleDays}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {savingSchedule ? 'Saving...' : 'Save Weekly Hours'}
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {scheduleDays.map((day) => (
                      <div
                        key={day.dayOfWeek}
                        className="p-3 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                      >
                        <label className="inline-flex items-center gap-2 font-semibold text-[#111C17] min-w-[110px]">
                          <input
                            type="checkbox"
                            checked={day.isWorking}
                            onChange={(e) =>
                              setScheduleDays((prev) =>
                                prev.map((d) =>
                                  d.dayOfWeek === day.dayOfWeek
                                    ? { ...d, isWorking: e.target.checked }
                                    : d
                                )
                              )
                            }
                          />
                          <span>{WEEKDAY_NAMES[day.dayOfWeek]}</span>
                        </label>

                        {day.isWorking ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[#526259]">Hours:</span>
                            <input
                              type="time"
                              value={day.startTime}
                              onChange={(e) =>
                                setScheduleDays((prev) =>
                                  prev.map((d) =>
                                    d.dayOfWeek === day.dayOfWeek
                                      ? { ...d, startTime: e.target.value }
                                      : d
                                  )
                                )
                              }
                              className="px-2 py-1 border border-[#D4DAD4] rounded bg-white font-mono"
                            />
                            <span>–</span>
                            <input
                              type="time"
                              value={day.endTime}
                              onChange={(e) =>
                                setScheduleDays((prev) =>
                                  prev.map((d) =>
                                    d.dayOfWeek === day.dayOfWeek
                                      ? { ...d, endTime: e.target.value }
                                      : d
                                  )
                                )
                              }
                              className="px-2 py-1 border border-[#D4DAD4] rounded bg-white font-mono"
                            />
                            <span className="text-[#526259] ml-1">Break:</span>
                            <input
                              type="time"
                              value={day.breakStart}
                              onChange={(e) =>
                                setScheduleDays((prev) =>
                                  prev.map((d) =>
                                    d.dayOfWeek === day.dayOfWeek
                                      ? { ...d, breakStart: e.target.value }
                                      : d
                                  )
                                )
                              }
                              className="px-2 py-1 border border-[#D4DAD4] rounded bg-white font-mono"
                            />
                            <span>–</span>
                            <input
                              type="time"
                              value={day.breakEnd}
                              onChange={(e) =>
                                setScheduleDays((prev) =>
                                  prev.map((d) =>
                                    d.dayOfWeek === day.dayOfWeek
                                      ? { ...d, breakEnd: e.target.value }
                                      : d
                                  )
                                )
                              }
                              className="px-2 py-1 border border-[#D4DAD4] rounded bg-white font-mono"
                            />
                          </div>
                        ) : (
                          <span className="text-[#526259] italic">Not scheduled</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="lg:col-span-5 card-surface rounded-xl p-5 space-y-4">
                  <div className="border-b border-[#E3E8E4] pb-3">
                    <h3 className="text-sm font-semibold text-[#111C17]">
                      Leave &amp; Unavailability Blocks
                    </h3>
                    <p className="text-xs text-[#526259]">
                      Block specific dates or time windows from clinic &amp; patient booking.
                    </p>
                  </div>

                  <form onSubmit={handleAddUnavailability} className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block font-medium text-[#111C17] mb-1">Start Date</label>
                        <input
                          type="date"
                          required
                          value={unavailStart}
                          onChange={(e) => setUnavailStart(e.target.value)}
                          className="w-full px-2.5 py-1.5 border border-[#D4DAD4] rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-[#111C17] mb-1">End Date</label>
                        <input
                          type="date"
                          required
                          value={unavailEnd}
                          onChange={(e) => setUnavailEnd(e.target.value)}
                          className="w-full px-2.5 py-1.5 border border-[#D4DAD4] rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      <div>
                        <label className="block font-medium text-[#111C17] mb-1">Type</label>
                        <select
                          value={unavailKind}
                          onChange={(e) =>
                            setUnavailKind(e.target.value as DoctorUnavailability['kind'])
                          }
                          className="w-full px-2.5 py-1.5 border border-[#D4DAD4] rounded-lg bg-white"
                        >
                          <option value="Leave">Full Day Leave</option>
                          <option value="Break">Break Block</option>
                          <option value="Unavailable">Unavailable Window</option>
                        </select>
                      </div>
                      {unavailKind !== 'Leave' && (
                        <>
                          <div>
                            <label className="block font-medium text-[#111C17] mb-1">From</label>
                            <input
                              type="time"
                              value={unavailStartTime}
                              onChange={(e) => setUnavailStartTime(e.target.value)}
                              className="w-full px-2.5 py-1.5 border border-[#D4DAD4] rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="block font-medium text-[#111C17] mb-1">To</label>
                            <input
                              type="time"
                              value={unavailEndTime}
                              onChange={(e) => setUnavailEndTime(e.target.value)}
                              className="w-full px-2.5 py-1.5 border border-[#D4DAD4] rounded-lg"
                            />
                          </div>
                        </>
                      )}
                    </div>

                    <div>
                      <label className="block font-medium text-[#111C17] mb-1">Reason (Optional)</label>
                      <input
                        type="text"
                        value={unavailReason}
                        onChange={(e) => setUnavailReason(e.target.value)}
                        placeholder="e.g. Clinical conference, CME leave"
                        className="w-full px-2.5 py-1.5 border border-[#D4DAD4] rounded-lg"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={addingUnavail}
                      className="w-full py-2 text-xs font-semibold text-white bg-[#0B261C] hover:bg-[#12382A] rounded-lg disabled:opacity-50"
                    >
                      {addingUnavail ? 'Blocking...' : 'Add Unavailability Block'}
                    </button>
                  </form>

                  <div className="divide-y divide-[#EEF2EF] border-t border-[#E3E8E4] pt-2">
                    {unavailability.length === 0 ? (
                      <p className="py-2 text-xs text-[#526259]">No leave or unavailability blocks set.</p>
                    ) : (
                      unavailability.map((blk) => (
                        <div key={blk.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                          <div>
                            <div className="font-mono font-semibold text-[#111C17]">
                              {blk.startDate}
                              {blk.endDate !== blk.startDate ? ` → ${blk.endDate}` : ''} · {blk.kind}
                            </div>
                            <div className="text-[11px] text-[#526259]">
                              {blk.startTime}–{blk.endTime} {blk.reason ? `· ${blk.reason}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteUnavailability(blk.id)}
                            className="p-1.5 text-red-700 hover:bg-red-50 rounded"
                            aria-label="Remove block"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* TAB 3: MY PATIENTS & CONSULTATIONS */}
          {activeTab === 'patients' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-view-enter">
              <section className="lg:col-span-5 card-surface rounded-xl overflow-hidden">
                <div className="p-4 border-b border-[#E3E8E4] space-y-3">
                  <h3 className="text-sm font-semibold text-[#111C17]">Assigned Patient Caseload</h3>
                  <div className="relative">
                    <Search className="w-4 h-4 text-[#526259] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      placeholder="Search by name or P-XXXX..."
                      className="w-full pl-9 pr-3 py-2 text-xs border border-[#D4DAD4] rounded-lg"
                    />
                  </div>
                </div>

                {loadingPatients ? (
                  <div className="p-5 text-xs text-[#526259]">Loading patients...</div>
                ) : patients.length === 0 ? (
                  <div className="p-6 text-xs text-[#526259]">
                    No patients matched in your assigned clinic caseload.
                  </div>
                ) : (
                  <div className="divide-y divide-[#EEF2EF] max-h-[540px] overflow-y-auto">
                    {patients.map((pt) => (
                      <button
                        key={pt.id}
                        type="button"
                        onClick={() => handleOpenPatientDetail(pt.id)}
                        className={`w-full text-left p-4 hover:bg-[#F6F8F6] transition-colors flex items-center justify-between gap-2 ${
                          selectedPatientDetail?.id === pt.id ? 'bg-[#ECF4EF]/75' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#111C17] truncate">
                            {pt.fullName}
                          </div>
                          <div className="text-[11px] font-mono text-[#526259]">
                            {pt.id} · DOB {pt.dateOfBirth}
                          </div>
                        </div>
                        <div className="text-right text-[11px] font-mono text-[#047857] shrink-0">
                          <div>{pt.appointmentsCount} visits</div>
                          <div className="text-[#526259]">{pt.consultationsCount} notes</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="lg:col-span-7 card-surface rounded-xl p-5 space-y-5">
                {loadingPatientDetail ? (
                  <div className="p-6 text-xs text-[#526259]">Loading patient chart...</div>
                ) : !selectedPatientDetail ? (
                  <div className="p-8 text-center space-y-3">
                    <FileText className="w-8 h-8 text-[#047857] mx-auto" aria-hidden="true" />
                    <div className="text-sm font-semibold text-[#111C17]">
                      Select a patient to view clinical chart &amp; consultations
                    </div>
                    <p className="text-xs text-[#526259] max-w-md mx-auto">
                      View appointment history, author consultation summaries, add prescriptions or diagnostic test results, and schedule clinical follow-ups.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3E8E4] pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-[#047857]">
                            {selectedPatientDetail.id}
                          </span>
                          <span className="text-xs text-[#526259]">
                            DOB {selectedPatientDetail.dateOfBirth}
                          </span>
                        </div>
                        <h3 className="text-lg font-bold text-[#111C17] mt-0.5">
                          {selectedPatientDetail.fullName}
                        </h3>
                        <div className="text-xs text-[#526259]">
                          {selectedPatientDetail.contactNumber} · {selectedPatientDetail.email}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openConsultationModal(selectedPatientDetail.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg whitespace-nowrap shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        Document Consultation
                      </button>
                    </div>

                    {/* Consultation Records */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#526259]">
                        Recorded Consultations ({selectedPatientDetail.consultations.length})
                      </h4>
                      {selectedPatientDetail.consultations.length === 0 ? (
                        <p className="text-xs text-[#526259] bg-[#F6F8F6] p-4 rounded-lg border border-[#E3E8E4]">
                          No consultation summaries have been authored for {selectedPatientDetail.fullName} yet.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {selectedPatientDetail.consultations.map((c) => (
                            <div
                              key={c.id}
                              className="p-4 rounded-xl bg-[#F9FBFA] border border-[#E3E8E4] space-y-2 text-xs"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-mono font-semibold text-[#0B261C]">
                                  {c.consultationDate} · {c.doctorName}
                                </span>
                                <span
                                  className={`font-mono text-[11px] ${
                                    c.patientVisible ? 'text-[#047857]' : 'text-amber-700'
                                  }`}
                                >
                                  {c.patientVisible ? 'Visible in Patient Portal' : 'Clinician Only'}
                                </span>
                              </div>
                              <p className="text-[#111C17] font-medium">{c.summary}</p>
                              {c.diagnosisNotes && (
                                <p className="text-[#34433B]">
                                  <span className="font-semibold">Clinical Notes:</span> {c.diagnosisNotes}
                                </p>
                              )}
                              {c.recommendations && (
                                <p className="text-[#34433B]">
                                  <span className="font-semibold">Recommendations:</span> {c.recommendations}
                                </p>
                              )}
                              {c.prescriptions.length > 0 && (
                                <div className="pt-1">
                                  <div className="font-semibold text-[#0B261C]">Prescriptions:</div>
                                  <ul className="list-disc pl-4 text-[#34433B]">
                                    {c.prescriptions.map((rx, idx) => (
                                      <li key={idx}>
                                        {rx.medication} ({rx.dosage}, {rx.frequency}, {rx.duration})
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {c.testResults.length > 0 && (
                                <div className="pt-1">
                                  <div className="font-semibold text-[#0B261C]">Diagnostic Results:</div>
                                  <ul className="list-disc pl-4 text-[#34433B]">
                                    {c.testResults.map((tr, idx) => (
                                      <li key={idx}>
                                        {tr.testName} ({tr.statusLabel}): {tr.summary}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Recent Consultations Summary List */}
                    {selectedPatientDetail.followups.length > 0 && (
                      <div className="space-y-2 border-t border-[#E3E8E4] pt-4">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#526259]">
                          Follow-ups ({selectedPatientDetail.followups.length})
                        </h4>
                        <div className="divide-y divide-[#EEF2EF]">
                          {selectedPatientDetail.followups.map((fu) => (
                            <div key={fu.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                              <div>
                                <div className="font-medium text-[#111C17]">{fu.description}</div>
                                <div className="font-mono text-[11px] text-[#526259]">
                                  Due {fu.dueDate} · {fu.followupType ?? 'Administrative Contact'}
                                </div>
                              </div>
                              <FollowUpStatusText status={fu.status} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {recentConsultations.length > 0 && !selectedPatientDetail && (
                  <div className="border-t border-[#E3E8E4] pt-4 space-y-2">
                    <div className="text-xs font-semibold text-[#111C17]">
                      Your Recent Consultations ({recentConsultations.length})
                    </div>
                    <div className="divide-y divide-[#EEF2EF]">
                      {recentConsultations.slice(0, 5).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleOpenPatientDetail(c.patientId)}
                          className="w-full text-left py-2.5 hover:bg-[#F6F8F6] px-2 rounded flex items-center justify-between text-xs"
                        >
                          <span className="font-medium text-[#111C17]">
                            {c.patientName ?? c.patientId} — {c.summary}
                          </span>
                          <span className="font-mono text-[#526259] shrink-0">{c.consultationDate}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB 4: MY ACTIVITY */}
          {activeTab === 'activity' && (
            <section className="card-surface rounded-xl p-5 space-y-4 animate-view-enter">
              <div className="border-b border-[#E3E8E4] pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#111C17]">Doctor Activity Log</h3>
                  <p className="text-xs text-[#526259]">
                    Clinical notes, duty transitions, schedule changes, and appointment updates
                  </p>
                </div>
                <span className="text-xs font-mono text-[#526259]">
                  {activityLogs.length} events
                </span>
              </div>

              {loadingActivity ? (
                <div className="text-xs text-[#526259]">Loading activity timeline...</div>
              ) : activityLogs.length === 0 ? (
                <div className="text-xs text-[#526259]">No recorded clinical activity yet.</div>
              ) : (
                <ol className="relative border-l border-[#E3E8E4] ml-2 space-y-4">
                  {activityLogs.map((entry) => (
                    <li key={entry.id} className="pl-4 relative">
                      <span className="absolute -left-[4.5px] top-1.5 w-2 h-2 rounded-full bg-[#059669] ring-2 ring-white" />
                      <div className="text-[11px] font-mono text-[#526259]">
                        <span className="font-semibold text-[#0B261C]">{entry.action}</span> ·{' '}
                        {entry.resourceType}:{entry.resourceId} ·{' '}
                        {entry.createdAt.slice(0, 19).replace('T', ' ')}
                      </div>
                      <p className="text-xs text-[#111C17] mt-1">{entry.summary}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {/* TAB 5: MY PROFILE */}
          {activeTab === 'profile' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-view-enter">
              <section className="lg:col-span-8 card-surface rounded-xl p-6 space-y-5">
                <div className="border-b border-[#E3E8E4] pb-3">
                  <h3 className="text-base font-semibold text-[#111C17]">
                    Clinician Credentials &amp; Scheduling Preferences
                  </h3>
                  <p className="text-xs text-[#526259]">
                    Profile details are shared across clinic allocation and patient booking flows.
                  </p>
                </div>

                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[#111C17] mb-1">
                        Specialty
                      </label>
                      <input
                        type="text"
                        required
                        value={profSpecialty}
                        onChange={(e) => setProfSpecialty(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#111C17] mb-1">
                        Medical License Number
                      </label>
                      <input
                        type="text"
                        value={profLicense}
                        onChange={(e) => setProfLicense(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-[#D4DAD4] rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[#111C17] mb-1">
                        Qualifications
                      </label>
                      <input
                        type="text"
                        value={profQualifications}
                        onChange={(e) => setProfQualifications(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#111C17] mb-1">
                        Contact Phone
                      </label>
                      <input
                        type="tel"
                        value={profContact}
                        onChange={(e) => setProfContact(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[#111C17] mb-1">
                        Default Slot Duration (minutes)
                      </label>
                      <input
                        type="number"
                        min={10}
                        max={120}
                        step={5}
                        value={profDuration}
                        onChange={(e) => setProfDuration(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm font-mono border border-[#D4DAD4] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#111C17] mb-1">
                        Max Daily Patient Capacity
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={40}
                        value={profCapacity}
                        onChange={(e) => setProfCapacity(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm font-mono border border-[#D4DAD4] rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#111C17] mb-1">
                      Clinical Bio
                    </label>
                    <textarea
                      rows={3}
                      value={profBio}
                      onChange={(e) => setProfBio(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                    />
                  </div>

                  <div className="flex justify-end pt-2 border-t border-[#E3E8E4]">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="px-4 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-60"
                    >
                      {savingProfile ? 'Saving...' : 'Save Doctor Profile'}
                    </button>
                  </div>
                </form>
              </section>

              <section className="lg:col-span-4 card-surface rounded-xl p-6 space-y-4">
                <h3 className="text-sm font-semibold text-[#111C17]">Account &amp; Security</h3>
                <dl className="divide-y divide-[#EEF2EF] text-xs">
                  <div className="py-2 flex justify-between">
                    <dt className="text-[#526259]">Account Email</dt>
                    <dd className="font-mono text-[#111C17]">{user.email}</dd>
                  </div>
                  <div className="py-2 flex justify-between">
                    <dt className="text-[#526259]">Clinic</dt>
                    <dd className="font-medium text-[#111C17]">{activeClinic?.name}</dd>
                  </div>
                  <div className="py-2 flex justify-between">
                    <dt className="text-[#526259]">Department</dt>
                    <dd className="font-medium text-[#111C17]">
                      {dashboard?.doctor?.department ?? CLINIC_DEPARTMENTS[0]}
                    </dd>
                  </div>
                </dl>
                {user.authProvider === 'password' && (
                  <button
                    type="button"
                    disabled={sendingReset}
                    onClick={handleSendPasswordReset}
                    className="w-full py-2 text-xs font-medium text-[#0B261C] bg-[#ECF4EF] hover:bg-[#D7E6DD] rounded-lg"
                  >
                    {sendingReset ? 'Sending Reset Email...' : 'Send Password Reset Email'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onSignOut}
                  className="w-full py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg"
                >
                  Sign Out
                </button>
              </section>
            </div>
          )}

          {/* TAB 6: DOCTOR AI ASSISTANT */}
          {activeTab === 'assistant' && (
            <AssistantView
              role="Doctor"
              onDataMutated={triggerRefresh}
              onErrorNotice={onErrorNotice}
              onSuccessNotice={onSuccessNotice}
            />
          )}
        </main>
      </div>

      {/* Document Consultation Modal */}
      <ModalShell
        open={consultModalOpen}
        onClose={() => setConsultModalOpen(false)}
        labelledBy="doc-consult-modal-title"
        maxWidthClass="max-w-2xl"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 id="doc-consult-modal-title" className="text-base font-semibold text-[#111C17]">
              Document Consultation · {consultPatientId}
            </h3>
            <p className="text-xs text-[#526259]">
              Record clinical summary, prescriptions, diagnostic test results, and follow-up orders.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConsultModalOpen(false)}
            className="p-1 text-[#526259] hover:text-[#111C17]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSaveConsultation} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111C17] mb-1">
                Consultation Date
              </label>
              <input
                type="date"
                required
                value={consultDate}
                onChange={(e) => setConsultDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#111C17] mb-1">
                Linked Appointment ID (Optional)
              </label>
              <input
                type="text"
                value={consultAppointmentId}
                onChange={(e) => setConsultAppointmentId(e.target.value)}
                placeholder="APT-..."
                className="w-full px-3 py-2 text-sm font-mono border border-[#D4DAD4] rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#111C17] mb-1">
              Consultation Summary <span className="text-red-600">*</span>
            </label>
            <textarea
              required
              rows={2}
              value={consultSummary}
              onChange={(e) => setConsultSummary(e.target.value)}
              placeholder="Primary findings and visit summary..."
              className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111C17] mb-1">
                Clinical Assessment / Notes
              </label>
              <textarea
                rows={2}
                value={consultDiagnosis}
                onChange={(e) => setConsultDiagnosis(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#111C17] mb-1">
                Care Recommendations
              </label>
              <textarea
                rows={2}
                value={consultRecommendations}
                onChange={(e) => setConsultRecommendations(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
              />
            </div>
          </div>

          {/* Dynamic Prescriptions */}
          <div className="space-y-2 border-t border-[#E3E8E4] pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#111C17]">Prescriptions</span>
              <button
                type="button"
                onClick={() =>
                  setPrescriptions((prev) => [
                    ...prev,
                    { medication: '', dosage: '', frequency: '', duration: '', instructions: '' },
                  ])
                }
                className="text-xs font-medium text-[#047857] hover:underline"
              >
                + Add Prescription
              </button>
            </div>
            {prescriptions.map((rx, idx) => (
              <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-[#F6F8F6] p-2.5 rounded-lg text-xs">
                <input
                  type="text"
                  placeholder="Medication"
                  value={rx.medication}
                  onChange={(e) =>
                    setPrescriptions((p) =>
                      p.map((row, i) => (i === idx ? { ...row, medication: e.target.value } : row))
                    )
                  }
                  className="px-2 py-1.5 border border-[#D4DAD4] rounded bg-white"
                />
                <input
                  type="text"
                  placeholder="Dosage (e.g. 10mg)"
                  value={rx.dosage}
                  onChange={(e) =>
                    setPrescriptions((p) =>
                      p.map((row, i) => (i === idx ? { ...row, dosage: e.target.value } : row))
                    )
                  }
                  className="px-2 py-1.5 border border-[#D4DAD4] rounded bg-white"
                />
                <input
                  type="text"
                  placeholder="Frequency"
                  value={rx.frequency}
                  onChange={(e) =>
                    setPrescriptions((p) =>
                      p.map((row, i) => (i === idx ? { ...row, frequency: e.target.value } : row))
                    )
                  }
                  className="px-2 py-1.5 border border-[#D4DAD4] rounded bg-white"
                />
                <input
                  type="text"
                  placeholder="Duration (e.g. 30d)"
                  value={rx.duration}
                  onChange={(e) =>
                    setPrescriptions((p) =>
                      p.map((row, i) => (i === idx ? { ...row, duration: e.target.value } : row))
                    )
                  }
                  className="px-2 py-1.5 border border-[#D4DAD4] rounded bg-white"
                />
              </div>
            ))}
          </div>

          {/* Dynamic Test Results */}
          <div className="space-y-2 border-t border-[#E3E8E4] pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#111C17]">Diagnostic Test Results</span>
              <button
                type="button"
                onClick={() =>
                  setTestResults((prev) => [
                    ...prev,
                    {
                      testName: '',
                      observedDate: consultDate,
                      summary: '',
                      statusLabel: 'Normal',
                    },
                  ])
                }
                className="text-xs font-medium text-[#047857] hover:underline"
              >
                + Add Test Result
              </button>
            </div>
            {testResults.map((tr, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-[#F6F8F6] p-2.5 rounded-lg text-xs">
                <input
                  type="text"
                  placeholder="Test Name"
                  value={tr.testName}
                  onChange={(e) =>
                    setTestResults((p) =>
                      p.map((row, i) => (i === idx ? { ...row, testName: e.target.value } : row))
                    )
                  }
                  className="px-2 py-1.5 border border-[#D4DAD4] rounded bg-white"
                />
                <input
                  type="text"
                  placeholder="Result Summary"
                  value={tr.summary}
                  onChange={(e) =>
                    setTestResults((p) =>
                      p.map((row, i) => (i === idx ? { ...row, summary: e.target.value } : row))
                    )
                  }
                  className="px-2 py-1.5 border border-[#D4DAD4] rounded bg-white"
                />
                <select
                  value={tr.statusLabel}
                  onChange={(e) =>
                    setTestResults((p) =>
                      p.map((row, i) =>
                        i === idx
                          ? { ...row, statusLabel: e.target.value as TestResultItem['statusLabel'] }
                          : row
                      )
                    )
                  }
                  className="px-2 py-1.5 border border-[#D4DAD4] rounded bg-white"
                >
                  <option value="Normal">Normal</option>
                  <option value="Review Required">Review Required</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>
            ))}
          </div>

          {/* Optional Follow-up Order */}
          <div className="border-t border-[#E3E8E4] pt-3 space-y-2.5">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-[#111C17]">
              <input
                type="checkbox"
                checked={includeFollowup}
                onChange={(e) => setIncludeFollowup(e.target.checked)}
              />
              <span>Create Clinical Recommendation Follow-up</span>
            </label>
            {includeFollowup && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-[#F6F8F6] p-3 rounded-lg text-xs">
                <input
                  type="text"
                  placeholder="Follow-up action description"
                  value={fuDesc}
                  onChange={(e) => setFuDesc(e.target.value)}
                  className="sm:col-span-3 px-2.5 py-1.5 border border-[#D4DAD4] rounded bg-white"
                />
                <input
                  type="text"
                  placeholder="Clinical reason"
                  value={fuReason}
                  onChange={(e) => setFuReason(e.target.value)}
                  className="px-2.5 py-1.5 border border-[#D4DAD4] rounded bg-white"
                />
                <input
                  type="date"
                  value={fuDue}
                  onChange={(e) => setFuDue(e.target.value)}
                  className="px-2.5 py-1.5 border border-[#D4DAD4] rounded bg-white"
                />
                <select
                  value={fuPriority}
                  onChange={(e) => setFuPriority(e.target.value as FollowUpPriority)}
                  className="px-2.5 py-1.5 border border-[#D4DAD4] rounded bg-white"
                >
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-[#0B261C] bg-[#ECF4EF] p-3 rounded-lg">
            <input
              type="checkbox"
              checked={consultVisible}
              onChange={(e) => setConsultVisible(e.target.checked)}
            />
            <span>Publish consultation summary, prescriptions &amp; test results to Patient Portal</span>
          </label>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#E3E8E4]">
            <button
              type="button"
              onClick={() => setConsultModalOpen(false)}
              className="px-4 py-2 text-xs font-medium text-[#526259] border border-[#E3E8E4] rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingConsult}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-60"
            >
              {savingConsult ? 'Saving...' : 'Save Consultation Record'}
            </button>
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
