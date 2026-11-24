import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileBarChart,
  Lock,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  fetchAppointments,
  fetchAuthConfig,
  fetchDailyReport,
  fetchOverviewReport,
  fetchPatients,
  startAuthSession,
} from './client/api';
import { AppointmentsView } from './components/AppointmentsView';
import { AssistantView } from './components/AssistantView';
import { DashboardView, type DashboardFilteredTarget } from './components/DashboardView';
import { FollowUpsView } from './components/FollowUpsView';
import { PatientsView } from './components/PatientsView';
import { ReportsApiView } from './components/ReportsApiView';
import { SettingsView } from './components/SettingsView';
import type {
  Appointment,
  DailyReport,
  OverviewReport,
  Patient,
  UserRole,
} from './shared/types';

type NavTab =
  | 'dashboard'
  | 'assistant'
  | 'patients'
  | 'appointments'
  | 'followups'
  | 'reports'
  | 'settings';

const VALID_TABS: ReadonlySet<NavTab> = new Set([
  'dashboard',
  'assistant',
  'patients',
  'appointments',
  'followups',
  'reports',
  'settings',
]);

function getTabFromPathname(pathname: string): NavTab {
  const cleaned = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!cleaned) return 'dashboard';
  return VALID_TABS.has(cleaned as NavTab) ? (cleaned as NavTab) : 'dashboard';
}

function getPathForTab(tab: NavTab): string {
  return `/${tab}`;
}

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  title: string;
  subtitle: string;
  icon: typeof Activity;
}> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    title: 'Operations Dashboard',
    subtitle: 'Live clinic KPIs, analytics, and calendar scheduling',
    icon: Activity,
  },
  {
    id: 'assistant',
    label: 'AI Assistant',
    title: 'CareDesk Assistant',
    subtitle: 'Conversational clinic copilot via Local REST Preview',
    icon: Bot,
  },
  {
    id: 'patients',
    label: 'Patients',
    title: 'Patient Management',
    subtitle: 'Synthetic patient directory, sorting, and profiles',
    icon: Users,
  },
  {
    id: 'appointments',
    label: 'Appointments',
    title: 'Appointment Management',
    subtitle: 'Conflict-checked bookings, list & monthly calendar views',
    icon: Calendar,
  },
  {
    id: 'followups',
    label: 'Follow-ups',
    title: 'Administrative Follow-ups',
    subtitle: 'Pending, overdue, and completed administrative queues',
    icon: ClipboardList,
  },
  {
    id: 'reports',
    label: 'Reports',
    title: 'Operational Reports & API',
    subtitle: 'Live SQLite metrics, exports, and OpenAPI reference',
    icon: FileBarChart,
  },
  {
    id: 'settings',
    label: 'Settings',
    title: 'Clinic Settings',
    subtitle: 'Display preferences, access control, and MCP status',
    icon: Settings,
  },
];

interface ToastItem {
  id: string;
  kind: 'success' | 'error';
  message: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>(() =>
    typeof window !== 'undefined' ? getTabFromPathname(window.location.pathname) : 'dashboard'
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [compactDensity, setCompactDensity] = useState(false);

  // Trigger creation modals & cross-view deep links / filters
  const [patientCreateSignal, setPatientCreateSignal] = useState(0);
  const [appointmentCreateSignal, setAppointmentCreateSignal] = useState(0);
  const [followupCreateSignal, setFollowupCreateSignal] = useState(0);
  const [selectedPatientIdForProfile, setSelectedPatientIdForProfile] = useState<
    string | null
  >(null);
  const [prefillAppointmentPatientId, setPrefillAppointmentPatientId] = useState<
    string | null
  >(null);
  const [patientsStatusFilter, setPatientsStatusFilter] = useState<string>('All');
  const [appointmentsStatusFilter, setAppointmentsStatusFilter] = useState<string>('All');
  const [appointmentsDateFilter, setAppointmentsDateFilter] = useState<string>('');
  const [selectedAppointmentIdForDetail, setSelectedAppointmentIdForDetail] = useState<
    string | null
  >(null);
  const [followupsViewMode, setFollowupsViewMode] = useState<
    'pending' | 'overdue' | 'Completed' | 'all'
  >('pending');

  // Session & Access Control State
  const [sessionRole, setSessionRole] = useState<UserRole>('viewer');
  const [sessionActor, setSessionActor] = useState<string>('Operations Viewer');
  const [passcodeRequired, setPasscodeRequired] = useState(false);
  const [showPasscodeModal, setShowPasscodeModal] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  // Global Search State
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    patients: Patient[];
    appointments: Appointment[];
  }>({ patients: [], appointments: [] });
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Operational Notifications State
  const [notifOpen, setNotifOpen] = useState(false);
  const [overviewSnapshot, setOverviewSnapshot] = useState<OverviewReport | null>(null);
  const [dailySnapshot, setDailySnapshot] = useState<DailyReport | null>(null);
  const notifContainerRef = useRef<HTMLDivElement | null>(null);

  const pushToast = useCallback((kind: 'success' | 'error', message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
    if (kind === 'success') {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    }
  }, []);

  const handleSuccessNotice = useCallback(
    (msg: string) => {
      pushToast('success', msg);
    },
    [pushToast]
  );

  const handleErrorNotice = useCallback(
    (msg: string) => {
      pushToast('error', msg);
    },
    [pushToast]
  );

  useEffect(() => {
    let cancelled = false;
    async function initSession() {
      try {
        const cfg = await fetchAuthConfig();
        if (cancelled) return;
        setPasscodeRequired(cfg.passcodeRequired);
        if (cfg.passcodeRequired) {
          const info = await startAuthSession({ role: 'viewer', actor: 'Operations Viewer' });
          if (!cancelled) {
            setSessionRole(info.role);
            setSessionActor(info.actor);
          }
        } else {
          const info = await startAuthSession({
            role: 'administrator',
            actor: 'Clinic Administrator',
          });
          if (!cancelled) {
            setSessionRole(info.role);
            setSessionActor(info.actor);
          }
        }
      } catch {
        // Keep viewer fallback if session init fails
      }
    }
    initSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const navigateToTab = useCallback((tab: NavTab, options?: { preserveFilters?: boolean }) => {
    if (!options?.preserveFilters) {
      setSelectedPatientIdForProfile(null);
      setPatientsStatusFilter('All');
      setAppointmentsStatusFilter('All');
      setAppointmentsDateFilter('');
      setSelectedAppointmentIdForDetail(null);
      setFollowupsViewMode('pending');
    }
    setActiveTab(tab);
    const targetPath = getPathForTab(tab);
    if (typeof window !== 'undefined' && window.location.pathname !== targetPath) {
      window.history.pushState({ tab }, '', targetPath);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(getTabFromPathname(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Load real notification summary whenever data changes
  useEffect(() => {
    let cancelled = false;
    async function loadOperationalAlerts() {
      try {
        const [ov, dy] = await Promise.all([fetchOverviewReport(), fetchDailyReport()]);
        if (!cancelled) {
          setOverviewSnapshot(ov);
          setDailySnapshot(dy);
        }
      } catch {
        // Non-blocking background alert refresh
      }
    }
    loadOperationalAlerts();
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  // Debounced Global Search across patients & appointments
  useEffect(() => {
    const q = globalSearch.trim();
    if (!q) {
      setSearchResults({ patients: [], appointments: [] });
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const [pts, apts] = await Promise.all([
          fetchPatients({ search: q }),
          fetchAppointments({ search: q }),
        ]);
        if (!cancelled) {
          setSearchResults({
            patients: pts.slice(0, 4),
            appointments: apts.slice(0, 4),
          });
        }
      } catch {
        if (!cancelled) {
          setSearchResults({ patients: [], appointments: [] });
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [globalSearch]);

  // Close popovers on outside click
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
      if (
        notifContainerRef.current &&
        !notifContainerRef.current.contains(e.target as Node)
      ) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const handleRoleSwitch = async (targetRole: UserRole) => {
    if (targetRole === 'administrator' && passcodeRequired) {
      setAuthError(null);
      setPasscodeInput('');
      setShowPasscodeModal(true);
      return;
    }

    try {
      const info = await startAuthSession({
        role: targetRole,
        actor: targetRole === 'administrator' ? 'Clinic Administrator' : 'Operations Viewer',
      });
      setSessionRole(info.role);
      setSessionActor(info.actor);
      handleSuccessNotice(
        `Session switched to ${info.role === 'administrator' ? 'Administrator' : 'Read-Only Viewer'}.`
      );
    } catch (err) {
      handleErrorNotice(
        err instanceof Error ? err.message : 'Unable to switch session role.'
      );
    }
  };

  const handlePasscodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const info = await startAuthSession({
        role: 'administrator',
        actor: 'Clinic Administrator',
        passcode: passcodeInput,
      });
      setSessionRole(info.role);
      setSessionActor(info.actor);
      setShowPasscodeModal(false);
      handleSuccessNotice('Administrator session unlocked.');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Invalid administrator passcode.');
    }
  };

  const handleDataMutated = useCallback(() => {
    setRefreshSignal((s) => s + 1);
  }, []);

  const handleQuickScheduleForPatient = useCallback(
    (patientId: string) => {
      setPrefillAppointmentPatientId(patientId);
      navigateToTab('appointments');
      setAppointmentCreateSignal((s) => s + 1);
    },
    [navigateToTab]
  );

  const handleOpenPatientProfile = useCallback(
    (patientId: string) => {
      setPatientsStatusFilter('All');
      setSelectedPatientIdForProfile(patientId);
      navigateToTab('patients', { preserveFilters: true });
    },
    [navigateToTab]
  );

  const handleNavigateToFiltered = useCallback(
    (target: DashboardFilteredTarget) => {
      if (target.tab === 'patients') {
        setPatientsStatusFilter(target.status ?? 'All');
        setSelectedPatientIdForProfile(null);
      } else if (target.tab === 'appointments') {
        setAppointmentsStatusFilter(target.status ?? 'All');
        setAppointmentsDateFilter(target.date ?? '');
        setSelectedAppointmentIdForDetail(target.appointmentId ?? null);
      } else if (target.tab === 'followups') {
        setFollowupsViewMode(target.followUpView ?? 'pending');
      }
      navigateToTab(target.tab, { preserveFilters: true });
    },
    [navigateToTab]
  );

  const activeNavItem = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];

  const handleTopPrimaryAction = () => {
    if (activeTab === 'dashboard') {
      setPrefillAppointmentPatientId(null);
      navigateToTab('appointments');
      setAppointmentCreateSignal((s) => s + 1);
    } else if (activeTab === 'reports') {
      navigateToTab('assistant');
    } else if (activeTab === 'settings') {
      navigateToTab('dashboard');
    }
  };

  const topCtaLabel =
    activeTab === 'dashboard'
      ? 'Schedule Appointment'
      : activeTab === 'reports'
        ? 'Open Assistant'
        : null;

  const operationalAlerts = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      detail: string;
      severity: 'amber' | 'red' | 'emerald';
      targetTab: NavTab;
    }> = [];

    if (dailySnapshot && dailySnapshot.unconfirmedAppointments > 0) {
      items.push({
        id: 'unconfirmed-today',
        title: `${dailySnapshot.unconfirmedAppointments} unconfirmed appointments today`,
        detail: 'Confirmation outreach pending before scheduled visit times.',
        severity: 'amber',
        targetTab: 'appointments',
      });
    }
    if (overviewSnapshot && overviewSnapshot.overdueFollowUpsCount > 0) {
      items.push({
        id: 'overdue-followups',
        title: `${overviewSnapshot.overdueFollowUpsCount} overdue follow-up tasks`,
        detail: 'Administrative tasks past target due date require attention.',
        severity: 'red',
        targetTab: 'followups',
      });
    }
    if (overviewSnapshot && overviewSnapshot.missedLastSevenDaysCount > 0) {
      items.push({
        id: 'missed-7d',
        title: `${overviewSnapshot.missedLastSevenDaysCount} missed appointments (7d)`,
        detail: 'Review missed visits and prepare rescheduling outreach.',
        severity: 'red',
        targetTab: 'assistant',
      });
    }
    if (items.length === 0 && overviewSnapshot) {
      items.push({
        id: 'all-clear',
        title: 'All daily operations on track',
        detail: `${overviewSnapshot.pendingFollowUpsCount} open follow-ups within SLA.`,
        severity: 'emerald',
        targetTab: 'dashboard',
      });
    }
    return items;
  }, [dailySnapshot, overviewSnapshot]);

  const alertBadgeCount =
    (dailySnapshot?.unconfirmedAppointments ?? 0) +
    (overviewSnapshot?.overdueFollowUpsCount ?? 0);

  const actorInitials = sessionRole === 'administrator' ? 'CA' : 'OV';

  const renderSidebarNav = (isMobile: boolean) => (
    <nav
      className="flex-1 px-3 py-5 space-y-1 overflow-y-auto"
      aria-label={isMobile ? 'Mobile Navigation' : 'Primary Navigation'}
    >
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              navigateToTab(item.id);
              if (isMobile) setMobileMenuOpen(false);
            }}
            aria-current={isActive ? 'page' : undefined}
            className={`relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              isActive
                ? 'bg-[#059669] text-white'
                : 'text-emerald-100/80 hover:bg-[#143D2D] hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
      <div className="min-h-screen flex bg-[#F7F8F6] text-[#16211C]">
        {/* Desktop Forest-Green Sidebar */}
        <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-[#0C291E] text-emerald-50 border-r border-[#174333]">
          <div className="px-6 py-5 border-b border-[#174333] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#059669] text-white flex items-center justify-center font-bold text-sm shrink-0">
              CD
            </div>
            <div className="min-w-0">
              <div className="text-base font-bold tracking-tight text-white truncate">
                CareDesk AI
              </div>
              <p className="text-[11px] text-emerald-200/75 truncate">
                Healthcare Operations Copilot
              </p>
            </div>
          </div>

          {renderSidebarNav(false)}

          {/* Sidebar User Profile & Access Mode Footer */}
          <div className="p-4 border-t border-[#174333] space-y-3">
            <button
              type="button"
              onClick={() => navigateToTab('settings')}
              className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-[#081F16] hover:bg-[#143D2D] transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-[#174333] text-emerald-200 font-mono text-xs font-semibold flex items-center justify-center shrink-0">
                {actorInitials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-white truncate">{sessionActor}</div>
                <div className="text-[11px] font-mono text-emerald-300 truncate">
                  {sessionRole === 'administrator' ? 'Administrator' : 'Read-Only Viewer'}
                </div>
              </div>
            </button>

            <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#081F16] rounded-lg">
              <button
                type="button"
                onClick={() => handleRoleSwitch('administrator')}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  sessionRole === 'administrator'
                    ? 'bg-[#059669] text-white'
                    : 'text-emerald-200/75 hover:text-white'
                }`}
              >
                Admin
              </button>
              <button
                type="button"
                onClick={() => handleRoleSwitch('viewer')}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  sessionRole === 'viewer'
                    ? 'bg-[#174333] text-white'
                    : 'text-emerald-200/75 hover:text-white'
                }`}
              >
                Viewer
              </button>
            </div>
            <p className="text-[11px] text-emerald-200/65 leading-snug">
              Synthetic patient data only · Non-diagnostic operational workspace.
            </p>
          </div>
        </aside>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-black/50 transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
            <aside className="relative w-64 max-w-[82vw] bg-[#0C291E] text-emerald-50 flex flex-col z-10 animate-view-enter">
                <div className="px-5 py-4 border-b border-[#174333] flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-md bg-[#059669] text-white flex items-center justify-center font-bold text-xs">
                      CD
                    </div>
                    <span className="text-base font-bold text-white">CareDesk AI</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    className="p-1.5 text-emerald-200 hover:text-white"
                    aria-label="Close navigation menu"
                  >
                    <X className="w-5 h-5" aria-hidden="true" />
                  </button>
                </div>
                {renderSidebarNav(true)}
                <div className="p-4 border-t border-[#174333] space-y-2">
                  <div className="text-xs text-emerald-200/80">{sessionActor}</div>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#081F16] rounded-lg">
                    <button
                      type="button"
                      onClick={() => handleRoleSwitch('administrator')}
                      className={`px-2 py-1.5 text-xs font-medium rounded-md ${
                        sessionRole === 'administrator'
                          ? 'bg-[#059669] text-white'
                          : 'text-emerald-200/75'
                      }`}
                    >
                      Admin
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRoleSwitch('viewer')}
                      className={`px-2 py-1.5 text-xs font-medium rounded-md ${
                        sessionRole === 'viewer'
                          ? 'bg-[#174333] text-white'
                          : 'text-emerald-200/75'
                      }`}
                    >
                      Viewer
                    </button>
                  </div>
                </div>
            </aside>
          </div>
        )}

        {/* Main Workspace Column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Navigation Bar */}
          <header className="h-16 bg-white border-b border-[#E4E7E2] px-4 sm:px-6 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 text-[#526058] hover:text-[#16211C] rounded-lg"
                aria-label="Open navigation menu"
              >
                <Menu className="w-5 h-5" aria-hidden="true" />
              </button>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-semibold text-[#16211C] truncate">
                  {activeNavItem.title}
                </h1>
                <p className="hidden xl:block text-[11px] text-[#526058] truncate">
                  {activeNavItem.subtitle}
                  {overviewSnapshot?.todayDate ? ` · Clinic Date ${overviewSnapshot.todayDate}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
              {/* Global Search */}
              <div ref={searchContainerRef} className="relative hidden md:block w-64 lg:w-72">
                <Search
                  className="w-3.5 h-3.5 text-[#526058] absolute left-3 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={globalSearch}
                  onFocus={() => setSearchOpen(true)}
                  onChange={(e) => {
                    setGlobalSearch(e.target.value);
                    setSearchOpen(true);
                  }}
                  placeholder="Search patient, P-ID, or clinician..."
                  aria-label="Global clinic search"
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#F7F8F6] border border-[#E4E7E2] rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
                />

                {searchOpen && globalSearch.trim().length > 0 && (
                  <div className="absolute right-0 mt-1.5 w-80 bg-white border border-[#E4E7E2] rounded-xl shadow-lg z-40 overflow-hidden">
                    <div className="px-3.5 py-2 border-b border-[#E4E7E2] bg-[#F7F8F6] text-[11px] font-medium text-[#526058] flex items-center justify-between">
                      <span>Search Results</span>
                      {searchLoading && <span>Searching...</span>}
                    </div>
                    {searchResults.patients.length === 0 &&
                    searchResults.appointments.length === 0 &&
                    !searchLoading ? (
                      <div className="px-4 py-5 text-xs text-[#526058] text-center">
                        No matching synthetic patients or appointments found.
                      </div>
                    ) : (
                      <div className="max-h-72 overflow-y-auto divide-y divide-[#E4E7E2]">
                        {searchResults.patients.map((pt) => (
                          <button
                            key={pt.id}
                            type="button"
                            onClick={() => {
                              handleOpenPatientProfile(pt.id);
                              setSearchOpen(false);
                              setGlobalSearch('');
                            }}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-[#EDF4F0]/60 transition-colors"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-[#16211C]">{pt.fullName}</span>
                              <span className="font-mono text-[#047857]">{pt.id}</span>
                            </div>
                            <div className="text-[11px] text-[#526058] mt-0.5">
                              Patient · {pt.administrativeStatus}
                            </div>
                          </button>
                        ))}
                        {searchResults.appointments.map((apt) => (
                          <button
                            key={apt.id}
                            type="button"
                            onClick={() => {
                              handleNavigateToFiltered({
                                tab: 'appointments',
                                date: '',
                                status: 'All',
                                appointmentId: apt.id,
                              });
                              setSearchOpen(false);
                              setGlobalSearch('');
                            }}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-[#EDF4F0]/60 transition-colors"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-[#16211C]">
                                {apt.patientName ?? apt.patientId}
                              </span>
                              <span className="font-mono text-[#526058]">{apt.id}</span>
                            </div>
                            <div className="text-[11px] text-[#526058] mt-0.5 font-mono tabular-nums">
                              {apt.appointmentDate} {apt.appointmentTime} · {apt.department}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Notifications Popover */}
              <div ref={notifContainerRef} className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((prev) => !prev)}
                  className="relative p-2 text-[#526058] hover:text-[#16211C] hover:bg-[#F7F8F6] border border-[#E4E7E2] rounded-lg transition-colors"
                  aria-label="Operational notifications"
                  aria-expanded={notifOpen}
                >
                  <Bell className="w-4 h-4" aria-hidden="true" />
                  {alertBadgeCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#059669] text-white text-[10px] font-mono font-semibold flex items-center justify-center tabular-nums">
                      {alertBadgeCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-1.5 w-80 bg-white border border-[#E4E7E2] rounded-xl shadow-lg z-40 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-[#E4E7E2] bg-[#F7F8F6] flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#16211C]">
                        Operational Notifications
                      </span>
                      <span className="text-[11px] font-mono text-[#526058]">Live queue</span>
                    </div>
                    <div className="divide-y divide-[#E4E7E2] max-h-72 overflow-y-auto">
                      {operationalAlerts.map((alert) => (
                        <button
                          key={alert.id}
                          type="button"
                          onClick={() => {
                            if (alert.id === 'unconfirmed-today') {
                              handleNavigateToFiltered({
                                tab: 'appointments',
                                status: 'Scheduled',
                                date: dailySnapshot?.date ?? '',
                              });
                            } else if (alert.id === 'overdue-followups') {
                              handleNavigateToFiltered({
                                tab: 'followups',
                                followUpView: 'overdue',
                              });
                            } else {
                              navigateToTab(alert.targetTab);
                            }
                            setNotifOpen(false);
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-[#F7F8F6] transition-colors flex items-start gap-2.5"
                        >
                          {alert.severity === 'red' ? (
                            <AlertTriangle
                              className="w-4 h-4 text-red-700 mt-0.5 shrink-0"
                              aria-hidden="true"
                            />
                          ) : alert.severity === 'amber' ? (
                            <Clock
                              className="w-4 h-4 text-amber-700 mt-0.5 shrink-0"
                              aria-hidden="true"
                            />
                          ) : (
                            <CheckCircle2
                              className="w-4 h-4 text-[#047857] mt-0.5 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#16211C]">
                              {alert.title}
                            </div>
                            <div className="text-[11px] text-[#526058] mt-0.5">
                              {alert.detail}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* User Profile Pill / Button */}
              <button
                type="button"
                onClick={() => navigateToTab('settings')}
                className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 text-xs text-[#16211C] bg-[#F7F8F6] hover:bg-[#EDF4F0] border border-[#E4E7E2] rounded-lg transition-colors whitespace-nowrap"
                title="Open profile & clinic settings"
              >
                {sessionRole === 'administrator' ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
                )}
                <span className="font-medium">{sessionActor}</span>
              </button>

              {topCtaLabel && (
                <button
                  type="button"
                  onClick={handleTopPrimaryAction}
                  className="px-3 sm:px-3.5 py-2 text-xs sm:text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {activeTab === 'dashboard' ? (
                    <>
                      <span className="hidden sm:inline">Schedule Appointment</span>
                      <span className="sm:hidden">Book</span>
                    </>
                  ) : (
                    topCtaLabel
                  )}
                </button>
              )}
            </div>
          </header>

          {/* Global Toast Notifications */}
          {toasts.length > 0 && (
            <div
              className="mx-4 sm:mx-6 mt-4 space-y-2"
              aria-live="polite"
              aria-atomic="true"
            >
              {toasts.map((toast) => (
                <div
                  key={toast.id}
                  role={toast.kind === 'error' ? 'alert' : 'status'}
                  className={`px-4 py-3 rounded-xl border flex items-center justify-between gap-4 text-xs ${
                    toast.kind === 'error'
                      ? 'bg-red-50 border-red-200 text-red-800'
                      : 'bg-[#EDF4F0] border-[#B7DFCA] text-[#0C291E]'
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    {toast.kind === 'error' ? (
                      <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0" aria-hidden="true" />
                    )}
                    <span>{toast.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setToasts((prev) => prev.filter((item) => item.id !== toast.id))
                    }
                    className="p-1 opacity-75 hover:opacity-100"
                    aria-label="Dismiss notification"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Active View Viewport */}
          <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
            <div key={activeTab} className="animate-view-enter">
              {activeTab === 'dashboard' && (
                <DashboardView
                  onNavigate={(tab) => navigateToTab(tab)}
                  onNavigateToFiltered={handleNavigateToFiltered}
                  onErrorNotice={handleErrorNotice}
                  onSuccessNotice={handleSuccessNotice}
                  refreshSignal={refreshSignal}
                  compactDensity={compactDensity}
                />
              )}
              {activeTab === 'assistant' && (
                <AssistantView
                  onDataMutated={handleDataMutated}
                  onErrorNotice={handleErrorNotice}
                  onSuccessNotice={handleSuccessNotice}
                />
              )}
              {activeTab === 'patients' && (
                <PatientsView
                  onDataMutated={handleDataMutated}
                  onErrorNotice={handleErrorNotice}
                  onSuccessNotice={handleSuccessNotice}
                  onQuickScheduleForPatient={handleQuickScheduleForPatient}
                  openCreateSignal={patientCreateSignal}
                  initialSelectedPatientId={selectedPatientIdForProfile}
                  initialStatusFilter={patientsStatusFilter}
                  compactDensity={compactDensity}
                />
              )}
              {activeTab === 'appointments' && (
                <AppointmentsView
                  onDataMutated={handleDataMutated}
                  onErrorNotice={handleErrorNotice}
                  onSuccessNotice={handleSuccessNotice}
                  openCreateSignal={appointmentCreateSignal}
                  prefillPatientId={prefillAppointmentPatientId}
                  initialStatusFilter={appointmentsStatusFilter}
                  initialDateFilter={appointmentsDateFilter}
                  initialDetailAppointmentId={selectedAppointmentIdForDetail}
                  onOpenPatient={handleOpenPatientProfile}
                  compactDensity={compactDensity}
                />
              )}
              {activeTab === 'followups' && (
                <FollowUpsView
                  onDataMutated={handleDataMutated}
                  onErrorNotice={handleErrorNotice}
                  onSuccessNotice={handleSuccessNotice}
                  openCreateSignal={followupCreateSignal}
                  initialViewMode={followupsViewMode}
                  onOpenPatient={handleOpenPatientProfile}
                  compactDensity={compactDensity}
                />
              )}
              {activeTab === 'reports' && (
                <ReportsApiView
                  onErrorNotice={handleErrorNotice}
                  onSuccessNotice={handleSuccessNotice}
                  refreshSignal={refreshSignal}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsView
                  sessionRole={sessionRole}
                  sessionActor={sessionActor}
                  passcodeRequired={passcodeRequired}
                  onRoleSwitch={handleRoleSwitch}
                  compactDensity={compactDensity}
                  onToggleCompactDensity={setCompactDensity}
                  onSuccessNotice={handleSuccessNotice}
                />
              )}
            </div>
          </main>
        </div>

        {/* Administrator Passcode Modal */}
        {showPasscodeModal && (
          <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-passcode-title"
          >
            <div className="bg-white border border-[#E4E7E2] rounded-xl w-full max-w-sm p-6 space-y-4">
              <h2 id="admin-passcode-title" className="text-base font-semibold text-[#16211C]">
                Administrator Sign-In
              </h2>
              <p className="text-xs text-[#526058]">
                Enter the configured clinic administrator passcode to unlock record updates.
              </p>
              {authError && (
                <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {authError}
                </div>
              )}
              <form onSubmit={handlePasscodeSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="admin-passcode-input"
                    className="block text-xs font-medium text-[#16211C] mb-1"
                  >
                    Administrator Passcode
                  </label>
                  <input
                    id="admin-passcode-input"
                    type="password"
                    required
                    value={passcodeInput}
                    onChange={(e) => setPasscodeInput(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DDD6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
                  />
                </div>
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowPasscodeModal(false)}
                    className="px-3.5 py-2 text-xs font-medium text-[#526058] border border-[#E4E7E2] rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg"
                  >
                    Unlock Admin Mode
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
  );
}
