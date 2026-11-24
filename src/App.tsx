import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  FileBarChart,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Stethoscope,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  fetchAppointments,
  fetchDailyReport,
  fetchNotifications,
  fetchOverviewReport,
  fetchPatients,
  fetchStaff,
  markAllNotificationsRead,
  markNotificationRead,
  recordLogoutAudit,
  setActiveClinicId,
  setSessionToken,
  setTokenProvider,
  syncAuthSession,
} from './client/api';
import {
  getCurrentIdToken,
  signOutFirebase,
  subscribeToAuthState,
} from './client/firebase';
import { AdminProfilePage } from './components/AdminProfilePage';
import { AppointmentsView } from './components/AppointmentsView';
import { AssistantView } from './components/AssistantView';
import { AuthView } from './components/AuthView';
import { EditorialAvatar } from './components/ClinicIllustrations';
import { DashboardView, type DashboardFilteredTarget } from './components/DashboardView';
import { DoctorWorkspace } from './components/DoctorWorkspace';
import { FollowUpsView } from './components/FollowUpsView';
import { OnboardingRouterView } from './components/OnboardingRouterView';
import { PatientProfilePage } from './components/PatientProfilePage';
import { PatientsView } from './components/PatientsView';
import { PatientWorkspace } from './components/PatientWorkspace';
import { ReportsApiView } from './components/ReportsApiView';
import { SettingsView } from './components/SettingsView';
import { StaffProfilePage } from './components/StaffProfilePage';
import { StaffView } from './components/StaffView';
import type {
  AccountSessionState,
  Appointment,
  DailyReport,
  NotificationItem,
  OverviewReport,
  Patient,
  StaffMember,
} from './shared/types';

type NavTab =
  | 'dashboard'
  | 'assistant'
  | 'patients'
  | 'appointments'
  | 'followups'
  | 'staff'
  | 'reports'
  | 'settings'
  | 'profile';

type NavGroup = 'Operations' | 'Clinic Management' | 'Intelligence';

interface RouteState {
  tab: NavTab;
  patientId: string | null;
  staffId: string | null;
}

const VALID_TABS: ReadonlySet<NavTab> = new Set([
  'dashboard',
  'assistant',
  'patients',
  'appointments',
  'followups',
  'staff',
  'reports',
  'settings',
  'profile',
]);

const CLINIC_STORAGE_KEY = 'caredesk.activeClinicId';

function readStoredClinicId(): string | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage.getItem(CLINIC_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function writeStoredClinicId(clinicId: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (clinicId) {
      window.sessionStorage.setItem(CLINIC_STORAGE_KEY, clinicId);
    } else {
      window.sessionStorage.removeItem(CLINIC_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access errors in restricted contexts
  }
}

function parseRouteFromPathname(pathname: string): RouteState {
  const segments = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (segments.length === 0) {
    return { tab: 'dashboard', patientId: null, staffId: null };
  }
  const head = segments[0].toLowerCase();
  if (head === 'patients' && segments[1]) {
    return {
      tab: 'patients',
      patientId: decodeURIComponent(segments[1]),
      staffId: null,
    };
  }
  if (head === 'staff' && segments[1]) {
    return {
      tab: 'staff',
      patientId: null,
      staffId: decodeURIComponent(segments[1]),
    };
  }
  const tab = VALID_TABS.has(head as NavTab) ? (head as NavTab) : 'dashboard';
  return { tab, patientId: null, staffId: null };
}

function getPathForRoute(route: RouteState): string {
  if (route.tab === 'patients' && route.patientId) {
    return `/patients/${encodeURIComponent(route.patientId)}`;
  }
  if (route.tab === 'staff' && route.staffId) {
    return `/staff/${encodeURIComponent(route.staffId)}`;
  }
  return `/${route.tab}`;
}

const NAV_ITEMS: Array<{
  id: NavTab;
  group: NavGroup;
  label: string;
  title: string;
  subtitle: string;
  icon: typeof Activity;
}> = [
  {
    id: 'dashboard',
    group: 'Operations',
    label: 'Dashboard',
    title: 'Operations Dashboard',
    subtitle: 'Live clinic KPIs, analytics, and calendar scheduling',
    icon: Activity,
  },
  {
    id: 'patients',
    group: 'Clinic Management',
    label: 'Patients',
    title: 'Patient Management',
    subtitle: 'Clinic-isolated patient directory, sorting, and profiles',
    icon: Users,
  },
  {
    id: 'appointments',
    group: 'Clinic Management',
    label: 'Appointments',
    title: 'Appointment Management',
    subtitle: 'Conflict-checked bookings, paginated schedule & monthly calendar',
    icon: Calendar,
  },
  {
    id: 'followups',
    group: 'Clinic Management',
    label: 'Follow-ups',
    title: 'Administrative Follow-ups',
    subtitle: 'Pending, overdue, and completed administrative queues',
    icon: ClipboardList,
  },
  {
    id: 'staff',
    group: 'Clinic Management',
    label: 'Staff',
    title: 'Clinic Staff Roster',
    subtitle: 'Clinicians, coordinators, administrators, and assigned schedules',
    icon: Stethoscope,
  },
  {
    id: 'reports',
    group: 'Intelligence',
    label: 'Reports',
    title: 'Operational Reports & API',
    subtitle: 'Live SQLite metrics, exports, and OpenAPI reference',
    icon: FileBarChart,
  },
  {
    id: 'assistant',
    group: 'Intelligence',
    label: 'AI Assistant',
    title: 'CareDesk Assistant',
    subtitle: 'Conversational clinic copilot via Local REST Preview',
    icon: Bot,
  },
  {
    id: 'profile',
    group: 'Intelligence',
    label: 'My Profile',
    title: 'Administrator Profile & Team',
    subtitle: 'Personal account, clinic workspace, security, and RBAC roles',
    icon: UserCircle,
  },
  {
    id: 'settings',
    group: 'Intelligence',
    label: 'Settings',
    title: 'Clinic Settings',
    subtitle: 'Display preferences, access control, and MCP status',
    icon: Settings,
  },
];

const NAV_GROUPS: NavGroup[] = ['Operations', 'Clinic Management', 'Intelligence'];

interface ToastItem {
  id: string;
  kind: 'success' | 'error';
  message: string;
}

export default function App() {
  const initialRoute = useMemo<RouteState>(
    () =>
      typeof window !== 'undefined'
        ? parseRouteFromPathname(window.location.pathname)
        : { tab: 'dashboard', patientId: null, staffId: null },
    []
  );

  // Authentication & Multi-Clinic Session State
  const [authBooting, setAuthBooting] = useState(true);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [accountSession, setAccountSession] = useState<AccountSessionState | null>(null);
  const [authSyncError, setAuthSyncError] = useState<string | null>(null);
  const registrationMetaRef = useRef<{ fullName?: string; phoneNumber?: string }>({});

  const [activeTab, setActiveTab] = useState<NavTab>(initialRoute.tab);
  const [routePatientId, setRoutePatientId] = useState<string | null>(initialRoute.patientId);
  const [routeStaffId, setRouteStaffId] = useState<string | null>(initialRoute.staffId);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [compactDensity, setCompactDensity] = useState(false);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const [pendingAssistantPrompt, setPendingAssistantPrompt] = useState<string | null>(null);
  const [staffDirectory, setStaffDirectory] = useState<StaffMember[]>([]);

  // Trigger creation modals & cross-view deep links / filters
  const [patientCreateSignal, setPatientCreateSignal] = useState(0);
  const [appointmentCreateSignal, setAppointmentCreateSignal] = useState(0);
  const [followupCreateSignal, setFollowupCreateSignal] = useState(0);
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

  // Global Search State
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    patients: Patient[];
    appointments: Appointment[];
    staff: StaffMember[];
  }>({ patients: [], appointments: [], staff: [] });
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Operational Notifications State
  const [notifOpen, setNotifOpen] = useState(false);
  const [overviewSnapshot, setOverviewSnapshot] = useState<OverviewReport | null>(null);
  const [dailySnapshot, setDailySnapshot] = useState<DailyReport | null>(null);
  const [notificationsList, setNotificationsList] = useState<NotificationItem[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
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

  const synchronizeWithBackend = useCallback(
    async (user: FirebaseUser, preferredClinicId?: string | null) => {
      setAuthSyncError(null);
      const token = await user.getIdToken();
      setSessionToken(token);

      const storedClinicId = preferredClinicId ?? readStoredClinicId();
      if (storedClinicId) {
        setActiveClinicId(storedClinicId);
      }

      const pendingMeta = registrationMetaRef.current;
      registrationMetaRef.current = {};

      let synced: AccountSessionState;
      try {
        synced = await syncAuthSession({
          fullName: pendingMeta.fullName || user.displayName || undefined,
          phoneNumber: pendingMeta.phoneNumber || undefined,
          requestedClinicId: storedClinicId || undefined,
        });
      } catch {
        // Retry once without stale stored clinic ID if membership changed
        if (storedClinicId) {
          setActiveClinicId(null);
          writeStoredClinicId(null);
          synced = await syncAuthSession({
            fullName: pendingMeta.fullName || user.displayName || undefined,
            phoneNumber: pendingMeta.phoneNumber || undefined,
          });
        } else {
          throw new Error('Unable to synchronize your clinic account session.');
        }
      }

      const resolvedClinicId = synced.activeClinic?.id ?? null;
      setActiveClinicId(resolvedClinicId);
      writeStoredClinicId(resolvedClinicId);
      setAccountSession(synced);
      setAvatarLoadError(false);
    },
    []
  );

  useEffect(() => {
    setTokenProvider(() => getCurrentIdToken());
    const unsubscribe = subscribeToAuthState(async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setSessionToken(null);
        setActiveClinicId(null);
        setAccountSession(null);
        setOverviewSnapshot(null);
        setDailySnapshot(null);
        setNotificationsList([]);
        setUnreadNotificationsCount(0);
        setStaffDirectory([]);
        setAuthSyncError(null);
        setAuthBooting(false);
        return;
      }

      setAuthBooting(true);
      try {
        await synchronizeWithBackend(user);
      } catch (err) {
        setAuthSyncError(
          err instanceof Error ? err.message : 'Unable to establish authenticated clinic session.'
        );
      } finally {
        setAuthBooting(false);
      }
    });

    return () => {
      unsubscribe();
      setTokenProvider(null);
    };
  }, [synchronizeWithBackend]);

  const navigateToRoute = useCallback(
    (route: RouteState, options?: { preserveFilters?: boolean }) => {
      if (!options?.preserveFilters) {
        setPatientsStatusFilter('All');
        setAppointmentsStatusFilter('All');
        setAppointmentsDateFilter('');
        setSelectedAppointmentIdForDetail(null);
        setFollowupsViewMode('pending');
      }
      setActiveTab(route.tab);
      setRoutePatientId(route.patientId);
      setRouteStaffId(route.staffId);
      const targetPath = getPathForRoute(route);
      if (typeof window !== 'undefined' && window.location.pathname !== targetPath) {
        window.history.pushState(route, '', targetPath);
      }
    },
    []
  );

  const navigateToTab = useCallback(
    (tab: NavTab, options?: { preserveFilters?: boolean }) => {
      navigateToRoute({ tab, patientId: null, staffId: null }, options);
    },
    [navigateToRoute]
  );

  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseRouteFromPathname(window.location.pathname);
      setActiveTab(parsed.tab);
      setRoutePatientId(parsed.patientId);
      setRouteStaffId(parsed.staffId);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const activeClinicId = accountSession?.activeClinic?.id ?? null;
  const activeRole = accountSession?.activeMembership?.role ?? null;

  // Load notification summary & staff directory lookup for Admin/Staff workspaces only
  useEffect(() => {
    if (
      !firebaseUser ||
      !activeClinicId ||
      accountSession?.needsOnboarding ||
      activeRole === 'Patient' ||
      activeRole === 'Doctor'
    ) {
      return;
    }
    let cancelled = false;
    async function loadOperationalAlerts() {
      try {
        const [ov, dy, staff, notifData] = await Promise.all([
          fetchOverviewReport(),
          fetchDailyReport(),
          fetchStaff(),
          fetchNotifications(20).catch(() => ({ items: [], unreadCount: 0 })),
        ]);
        if (!cancelled) {
          setOverviewSnapshot(ov);
          setDailySnapshot(dy);
          setStaffDirectory(staff);
          setNotificationsList(notifData.items);
          setUnreadNotificationsCount(notifData.unreadCount);
        }
      } catch {
        // Non-blocking background alert refresh
      }
    }
    loadOperationalAlerts();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, activeClinicId, activeRole, accountSession?.needsOnboarding, refreshSignal]);

  // Debounced Global Search across clinic-isolated patients, appointments & staff
  useEffect(() => {
    const q = globalSearch.trim();
    if (!q || !activeClinicId) {
      setSearchResults({ patients: [], appointments: [], staff: [] });
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const [pts, apts, staff] = await Promise.all([
          fetchPatients({ search: q }),
          fetchAppointments({ search: q }),
          fetchStaff({ search: q }),
        ]);
        if (!cancelled) {
          setSearchResults({
            patients: pts.slice(0, 4),
            appointments: apts.slice(0, 4),
            staff: staff.slice(0, 4),
          });
        }
      } catch {
        if (!cancelled) {
          setSearchResults({ patients: [], appointments: [], staff: [] });
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [globalSearch, activeClinicId]);

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

  const handleDataMutated = useCallback(() => {
    setRefreshSignal((s) => s + 1);
  }, []);

  const handleSessionRefresh = useCallback(async () => {
    if (!firebaseUser) return;
    await synchronizeWithBackend(firebaseUser, accountSession?.activeClinic?.id ?? null);
  }, [firebaseUser, accountSession?.activeClinic?.id, synchronizeWithBackend]);

  const handleSwitchClinic = async (clinicId: string) => {
    if (!firebaseUser) return;
    try {
      await synchronizeWithBackend(firebaseUser, clinicId);
      setRefreshSignal((s) => s + 1);
      navigateToTab('dashboard');
      handleSuccessNotice('Switched active clinic workspace.');
    } catch (err) {
      handleErrorNotice(
        err instanceof Error ? err.message : 'Unable to switch clinic workspace.'
      );
    }
  };

  const handleSignOut = async () => {
    try {
      if (accountSession?.activeClinic) {
        await recordLogoutAudit();
      }
    } finally {
      setSessionToken(null);
      setActiveClinicId(null);
      writeStoredClinicId(null);
      setAccountSession(null);
      await signOutFirebase();
    }
  };

  const handleQuickRegisterPatient = useCallback(() => {
    navigateToTab('patients');
    setPatientCreateSignal((s) => s + 1);
  }, [navigateToTab]);

  const handleQuickScheduleAppointment = useCallback(() => {
    setPrefillAppointmentPatientId(null);
    navigateToTab('appointments');
    setAppointmentCreateSignal((s) => s + 1);
  }, [navigateToTab]);

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
      navigateToRoute({ tab: 'patients', patientId, staffId: null }, { preserveFilters: true });
    },
    [navigateToRoute]
  );

  const handleOpenStaffProfile = useCallback(
    (staffId: string) => {
      navigateToRoute({ tab: 'staff', patientId: null, staffId }, { preserveFilters: true });
    },
    [navigateToRoute]
  );

  const handleOpenStaffByName = useCallback(
    async (clinicianName: string) => {
      const normalized = clinicianName.trim().toLowerCase();
      const cached = staffDirectory.find((s) => s.fullName.toLowerCase() === normalized);
      if (cached) {
        handleOpenStaffProfile(cached.id);
        return;
      }
      try {
        const matched = await fetchStaff({ search: clinicianName });
        const exact = matched.find((s) => s.fullName.toLowerCase() === normalized) ?? matched[0];
        if (exact) {
          handleOpenStaffProfile(exact.id);
          return;
        }
      } catch {
        // Fall through to roster directory
      }
      navigateToTab('staff');
    },
    [staffDirectory, handleOpenStaffProfile, navigateToTab]
  );

  const handleLaunchAssistantPrompt = useCallback(
    (prompt: string) => {
      setPendingAssistantPrompt(prompt);
      navigateToTab('assistant');
    },
    [navigateToTab]
  );

  const handleNavigateToFiltered = useCallback(
    (target: DashboardFilteredTarget) => {
      if (target.tab === 'patients') {
        setPatientsStatusFilter(target.status ?? 'All');
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

  const pendingVerificationsCount =
    (accountSession?.pendingDoctorApplications?.length ?? 0) +
    (accountSession?.pendingPatientLinkRequests?.length ?? 0);

  const alertBadgeCount =
    (dailySnapshot?.unconfirmedAppointments ?? 0) +
    (overviewSnapshot?.overdueFollowUpsCount ?? 0) +
    unreadNotificationsCount +
    pendingVerificationsCount;

  // Loading Splash during Firebase & Session Verification
  if (authBooting) {
    return (
      <div className="min-h-screen bg-[#0B261C] text-emerald-50 flex flex-col items-center justify-center p-6">
        <div className="w-12 h-12 rounded-2xl bg-[#059669] text-white flex items-center justify-center shadow-sm mb-4">
          <svg
            viewBox="0 0 24 24"
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <div className="text-base font-bold text-white tracking-tight">CareDesk AI</div>
        <p className="text-xs text-emerald-200/75 mt-1">
          Verifying clinic credentials and workspace boundary...
        </p>
      </div>
    );
  }

  // Sync error recovery view if Firebase user exists but backend sync failed
  if (firebaseUser && authSyncError && !accountSession) {
    return (
      <div className="min-h-screen bg-[#F6F8F6] text-[#111C17] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-[#E3E8E4] rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2.5 text-red-700 font-semibold text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>Unable to Load Clinic Session</span>
          </div>
          <p className="text-xs text-[#526259] leading-relaxed">{authSyncError}</p>
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={handleSignOut}
              className="px-3.5 py-2 text-xs font-medium text-[#526259] border border-[#E3E8E4] rounded-lg"
            >
              Sign Out
            </button>
            <button
              type="button"
              onClick={async () => {
                setAuthBooting(true);
                try {
                  await synchronizeWithBackend(firebaseUser);
                } catch (err) {
                  setAuthSyncError(err instanceof Error ? err.message : 'Sync retry failed.');
                } finally {
                  setAuthBooting(false);
                }
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg"
            >
              Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Unauthenticated Entry Gate
  if (!firebaseUser || !accountSession) {
    return (
      <AuthView
        onRegistrationMetadata={(meta) => {
          registrationMetaRef.current = meta;
        }}
      />
    );
  }

  const renderFixedToasts = () =>
    toasts.length > 0 ? (
      <div
        className="fixed bottom-4 right-4 z-50 w-full max-w-sm space-y-2 px-4 sm:px-0"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`animate-toast-enter px-4 py-3 rounded-xl border shadow-md flex items-center justify-between gap-4 text-xs ${
              toast.kind === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-[#ECF4EF] border-[#B7DFCA] text-[#0B261C]'
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
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
              className="p-1 opacity-75 hover:opacity-100"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    ) : null;

  // Clinic Workspace / Doctor Verification / Patient Link Onboarding Gate
  if (accountSession.needsOnboarding || !accountSession.activeClinic) {
    return (
      <>
        <OnboardingRouterView
          session={accountSession}
          onSessionUpdated={(nextSession) => {
            const clinicId = nextSession.activeClinic?.id ?? null;
            setActiveClinicId(clinicId);
            writeStoredClinicId(clinicId);
            setAccountSession(nextSession);
            setRefreshSignal((s) => s + 1);
            navigateToTab('dashboard');
            handleSuccessNotice(
              nextSession.activeClinic
                ? `Connected to "${nextSession.activeClinic.name}".`
                : 'Workspace session updated.'
            );
          }}
          onRefreshSession={handleSessionRefresh}
          onSignOut={handleSignOut}
        />
        {renderFixedToasts()}
      </>
    );
  }

  // Dedicated Doctor Workspace
  if (accountSession.activeMembership?.role === 'Doctor') {
    return (
      <>
        <DoctorWorkspace
          session={accountSession}
          onSessionRefresh={handleSessionRefresh}
          onSwitchClinic={handleSwitchClinic}
          onSignOut={handleSignOut}
          onErrorNotice={handleErrorNotice}
          onSuccessNotice={handleSuccessNotice}
        />
        {renderFixedToasts()}
      </>
    );
  }

  // Strictly Isolated Patient Portal Workspace
  if (accountSession.activeMembership?.role === 'Patient') {
    return (
      <>
        <PatientWorkspace
          session={accountSession}
          onSessionRefresh={handleSessionRefresh}
          onSwitchClinic={handleSwitchClinic}
          onSignOut={handleSignOut}
          onErrorNotice={handleErrorNotice}
          onSuccessNotice={handleSuccessNotice}
        />
        {renderFixedToasts()}
      </>
    );
  }

  const { user, activeClinic, activeMembership, clinics, permissions } = accountSession;
  const activeNavItem = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];
  const headerTitle =
    activeTab === 'patients' && routePatientId
      ? `Patient Profile · ${routePatientId}`
      : activeTab === 'staff' && routeStaffId
        ? `Staff Profile · ${routeStaffId}`
        : activeNavItem.title;

  const topCtaLabel =
    activeTab === 'dashboard' && permissions.canManageAppointments
      ? 'Schedule Appointment'
      : activeTab === 'reports'
        ? 'Open Assistant'
        : null;

  const handleTopPrimaryAction = () => {
    if (activeTab === 'dashboard') {
      handleQuickScheduleAppointment();
    } else if (activeTab === 'reports') {
      navigateToTab('assistant');
    }
  };

  const patientUiRole = permissions.canManagePatients ? 'administrator' : 'viewer';
  const appointmentUiRole = permissions.canManageAppointments ? 'administrator' : 'viewer';
  const staffUiRole = permissions.canManageStaff ? 'administrator' : 'viewer';

  const renderBrandMark = () => (
    <div className="w-8 h-8 rounded-lg bg-[#059669] text-white flex items-center justify-center shrink-0 shadow-xs">
      <svg
        viewBox="0 0 24 24"
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </div>
  );

  const renderUserAvatar = (sizeClass: string, smallFallback = true) =>
    user.avatarUrl && !avatarLoadError ? (
      <img
        src={user.avatarUrl}
        alt={user.fullName}
        referrerPolicy="no-referrer"
        onError={() => setAvatarLoadError(true)}
        className={`${sizeClass} rounded-lg object-cover shrink-0 border border-white/15`}
      />
    ) : (
      <EditorialAvatar
        name={user.fullName}
        role="administrator"
        size={smallFallback ? 'sm' : 'md'}
      />
    );

  const renderSidebarNav = (isMobile: boolean, collapsed = false) => (
    <nav
      className="flex-1 px-3 py-4 space-y-5 overflow-y-auto overflow-x-hidden"
      aria-label={isMobile ? 'Mobile Navigation' : 'Primary Navigation'}
    >
      {NAV_GROUPS.map((group) => {
        const items = NAV_ITEMS.filter((item) => item.group === group);
        return (
          <div key={group} className="space-y-1">
            {!collapsed && (
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200/50 whitespace-nowrap">
                {group}
              </div>
            )}
            {items.map((item) => {
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
                  title={collapsed ? item.label : undefined}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={`btn-press relative w-full flex items-center ${
                    collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
                  } rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#059669] text-white shadow-xs'
                      : 'text-emerald-100/80 hover:bg-[#12382A] hover:text-white'
                  }`}
                >
                  {isActive && !collapsed && (
                    <span
                      className="absolute left-1 top-2 bottom-2 w-0.5 rounded-full bg-emerald-200"
                      aria-hidden="true"
                    />
                  )}
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-[#F6F8F6] text-[#111C17]">
      {/* Desktop Deep Forest-Green Collapsible Sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen shrink-0 overflow-hidden bg-[#0B261C] text-emerald-50 border-r border-[#174333] transition-[width] duration-200 ease-out ${
          sidebarCollapsed ? 'w-[76px]' : 'w-60'
        }`}
      >
        <div
          className={`px-4 py-4 border-b border-[#174333] flex items-center ${
            sidebarCollapsed ? 'justify-center flex-col gap-2' : 'justify-between gap-2'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            {renderBrandMark()}
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <div className="text-base font-bold tracking-tight text-white truncate">
                  CareDesk AI
                </div>
                <p className="text-[11px] text-emerald-200/75 truncate" title={activeClinic.name}>
                  {activeClinic.name}
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="btn-press p-1.5 text-emerald-200/75 hover:text-white hover:bg-[#12382A] rounded-md transition-colors shrink-0"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Multi-clinic switcher when user belongs to multiple authorized clinics */}
        {!sidebarCollapsed && clinics.length > 1 && (
          <div className="px-3 pt-3">
            <label htmlFor="clinic-switcher" className="sr-only">
              Switch clinic workspace
            </label>
            <select
              id="clinic-switcher"
              value={activeClinic.id}
              onChange={(e) => handleSwitchClinic(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-medium bg-[#071D15] text-emerald-100 border border-[#174333] rounded-lg focus:outline-none focus:border-emerald-400"
            >
              {clinics.map((c) => (
                <option key={c.clinic.id} value={c.clinic.id}>
                  {c.clinic.name} ({c.membership.role})
                </option>
              ))}
            </select>
          </div>
        )}

        {renderSidebarNav(false, sidebarCollapsed)}

        {/* Sidebar Authenticated User Profile & Sign Out */}
        <div className="p-3.5 border-t border-[#174333] space-y-2.5">
          <button
            type="button"
            onClick={() => navigateToTab('profile')}
            title={
              sidebarCollapsed
                ? `${user.fullName} (${activeMembership?.role ?? 'Clinic Administrator'})`
                : undefined
            }
            className={`btn-press w-full flex items-center ${
              sidebarCollapsed ? 'justify-center p-2' : 'gap-3 p-2.5'
            } rounded-lg bg-[#071D15] hover:bg-[#12382A] transition-colors text-left`}
          >
            {renderUserAvatar('w-8 h-8')}
            {!sidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-white truncate">{user.fullName}</div>
                <div className="text-[11px] font-mono text-emerald-300 truncate">
                  {activeMembership?.role ?? 'Clinic Administrator'}
                </div>
              </div>
            )}
          </button>

          {!sidebarCollapsed ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="btn-press w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium text-emerald-100/85 hover:text-white bg-[#071D15] hover:bg-[#12382A] border border-[#174333] rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              Sign Out
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign Out"
              aria-label="Sign Out"
              className="btn-press w-full py-1.5 flex items-center justify-center text-emerald-200 bg-[#071D15] hover:bg-[#12382A] rounded-md"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50 animate-modal-overlay"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-64 max-w-[82vw] bg-[#0B261C] text-emerald-50 flex flex-col z-10 animate-drawer-enter">
            <div className="px-5 py-4 border-b border-[#174333] flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                {renderBrandMark()}
                <div className="min-w-0">
                  <div className="text-base font-bold text-white truncate">CareDesk AI</div>
                  <div className="text-[11px] text-emerald-200/75 truncate">{activeClinic.name}</div>
                </div>
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
            {renderSidebarNav(true, false)}
            <div className="p-4 border-t border-[#174333] space-y-2.5">
              <button
                type="button"
                onClick={() => {
                  navigateToTab('profile');
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 text-left"
              >
                {renderUserAvatar('w-7 h-7')}
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white truncate">{user.fullName}</div>
                  <div className="text-[11px] font-mono text-emerald-300 truncate">
                    {activeMembership?.role}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium text-emerald-100 bg-[#071D15] border border-[#174333] rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Workspace Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navigation Bar */}
        <header className="h-16 bg-white border-b border-[#E3E8E4] px-4 sm:px-6 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-[#526259] hover:text-[#111C17] rounded-lg"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#526259] whitespace-nowrap truncate">
                <span className="inline-flex items-center gap-1 font-medium text-[#111C17]">
                  <Building2 className="w-3 h-3 text-[#047857]" aria-hidden="true" />
                  {activeClinic.name}
                </span>
                <ChevronRight className="w-3 h-3 text-[#8E9B94] shrink-0" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => navigateToTab(activeTab)}
                  className="font-medium text-[#047857] hover:underline"
                >
                  {activeNavItem.label}
                </button>
                {activeTab === 'patients' && routePatientId && (
                  <>
                    <ChevronRight className="w-3 h-3 text-[#8E9B94] shrink-0" aria-hidden="true" />
                    <span className="font-mono text-[#111C17]">{routePatientId}</span>
                  </>
                )}
                {activeTab === 'staff' && routeStaffId && (
                  <>
                    <ChevronRight className="w-3 h-3 text-[#8E9B94] shrink-0" aria-hidden="true" />
                    <span className="font-mono text-[#111C17]">{routeStaffId}</span>
                  </>
                )}
                {overviewSnapshot?.todayDate && (
                  <>
                    <span className="hidden lg:inline" aria-hidden="true">
                      ·
                    </span>
                    <span className="hidden lg:inline font-mono tabular-nums">
                      {overviewSnapshot.todayDate}
                    </span>
                  </>
                )}
              </div>
              <h1 className="text-base sm:text-lg font-semibold text-[#111C17] truncate leading-tight">
                {headerTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            {/* Global Search */}
            <div ref={searchContainerRef} className="relative hidden md:block w-44 lg:w-64 xl:w-72">
              <Search
                className="w-3.5 h-3.5 text-[#526259] absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                id="global-search"
                type="search"
                value={globalSearch}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setGlobalSearch(e.target.value);
                  setSearchOpen(true);
                }}
                placeholder="Search patient, staff, or ID..."
                aria-label="Global clinic search"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#F6F8F6] border border-[#E3E8E4] rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
              />

              {searchOpen && globalSearch.trim().length > 0 && (
                <div className="absolute right-0 mt-1.5 w-80 bg-white border border-[#E3E8E4] rounded-xl shadow-lg z-40 overflow-hidden">
                  <div className="px-3.5 py-2 border-b border-[#E3E8E4] bg-[#F6F8F6] text-[11px] font-medium text-[#526259] flex items-center justify-between">
                    <span>Search Results ({activeClinic.id})</span>
                    {searchLoading && <span>Searching...</span>}
                  </div>
                  {searchResults.patients.length === 0 &&
                  searchResults.appointments.length === 0 &&
                  searchResults.staff.length === 0 &&
                  !searchLoading ? (
                    <div className="px-4 py-5 text-xs text-[#526259] text-center">
                      No matching patients, staff, or appointments found in this clinic.
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y divide-[#E3E8E4]">
                      {searchResults.patients.map((pt) => (
                        <button
                          key={pt.id}
                          type="button"
                          onClick={() => {
                            handleOpenPatientProfile(pt.id);
                            setSearchOpen(false);
                            setGlobalSearch('');
                          }}
                          className="w-full text-left px-3.5 py-2.5 hover:bg-[#ECF4EF]/60 transition-colors"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-[#111C17]">{pt.fullName}</span>
                            <span className="font-mono text-[#047857]">{pt.id}</span>
                          </div>
                          <div className="text-[11px] text-[#526259] mt-0.5">
                            Patient · {pt.administrativeStatus}
                          </div>
                        </button>
                      ))}
                      {searchResults.staff.map((stf) => (
                        <button
                          key={stf.id}
                          type="button"
                          onClick={() => {
                            handleOpenStaffProfile(stf.id);
                            setSearchOpen(false);
                            setGlobalSearch('');
                          }}
                          className="w-full text-left px-3.5 py-2.5 hover:bg-[#ECF4EF]/60 transition-colors"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-[#111C17]">{stf.fullName}</span>
                            <span className="font-mono text-[#0B261C]">{stf.id}</span>
                          </div>
                          <div className="text-[11px] text-[#526259] mt-0.5">
                            Staff ({stf.role}) · {stf.department}
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
                          className="w-full text-left px-3.5 py-2.5 hover:bg-[#ECF4EF]/60 transition-colors"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-[#111C17]">
                              {apt.patientName ?? apt.patientId}
                            </span>
                            <span className="font-mono text-[#526259]">{apt.id}</span>
                          </div>
                          <div className="text-[11px] text-[#526259] mt-0.5 font-mono tabular-nums">
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
                className="relative p-2 text-[#526259] hover:text-[#111C17] hover:bg-[#F6F8F6] border border-[#E3E8E4] rounded-lg transition-colors"
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
                <div className="absolute right-0 mt-1.5 w-96 max-w-[92vw] bg-white border border-[#E3E8E4] rounded-xl shadow-lg z-40 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[#E3E8E4] bg-[#F6F8F6] flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#111C17]">
                      Operational Notifications
                    </span>
                    <div className="flex items-center gap-2">
                      {unreadNotificationsCount > 0 && (
                        <button
                          type="button"
                          onClick={async () => {
                            await markAllNotificationsRead().catch(() => {});
                            setNotificationsList((prev) =>
                              prev.map((item) => ({ ...item, isRead: true }))
                            );
                            setUnreadNotificationsCount(0);
                          }}
                          className="text-[11px] font-medium text-[#047857] hover:underline"
                        >
                          Mark all read
                        </button>
                      )}
                      <span className="text-[11px] font-mono text-[#526259]">{activeClinic.id}</span>
                    </div>
                  </div>
                  <div className="divide-y divide-[#E3E8E4] max-h-96 overflow-y-auto">
                    {pendingVerificationsCount > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          navigateToTab('profile');
                          setNotifOpen(false);
                        }}
                        className="w-full text-left px-4 py-3 bg-amber-50/75 hover:bg-amber-50 transition-colors flex items-start gap-2.5"
                      >
                        <ShieldCheck
                          className="w-4 h-4 text-amber-700 mt-0.5 shrink-0"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-amber-950">
                            {pendingVerificationsCount} pending verification request
                            {pendingVerificationsCount === 1 ? '' : 's'}
                          </div>
                          <div className="text-[11px] text-amber-800 mt-0.5">
                            {accountSession.pendingDoctorApplications.length} doctor application(s) ·{' '}
                            {accountSession.pendingPatientLinkRequests.length} patient link request(s)
                          </div>
                        </div>
                      </button>
                    )}

                    {notificationsList.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={async () => {
                          if (!n.isRead) {
                            await markNotificationRead(n.id).catch(() => {});
                            setNotificationsList((prev) =>
                              prev.map((item) =>
                                item.id === n.id ? { ...item, isRead: true } : item
                              )
                            );
                            setUnreadNotificationsCount((c) => Math.max(0, c - 1));
                          }
                          if (n.relatedType === 'appointment') {
                            navigateToTab('appointments');
                          } else if (n.relatedType === 'followup') {
                            navigateToTab('followups');
                          } else if (
                            n.relatedType === 'doctor_application' ||
                            n.relatedType === 'patient_link'
                          ) {
                            navigateToTab('profile');
                          }
                          setNotifOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 hover:bg-[#F6F8F6] transition-colors flex items-start gap-2.5 ${
                          n.isRead ? 'opacity-75' : 'bg-[#F9FBFA]'
                        }`}
                      >
                        <Bell
                          className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                            n.isRead ? 'text-[#8E9B94]' : 'text-[#047857]'
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-[#111C17] flex items-center justify-between gap-2">
                            <span className="truncate">{n.title}</span>
                            {!n.isRead && (
                              <span className="text-[10px] font-mono text-[#047857] shrink-0">
                                New
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#526259] mt-0.5">{n.message}</div>
                        </div>
                      </button>
                    ))}

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
                        className="w-full text-left px-4 py-3 hover:bg-[#F6F8F6] transition-colors flex items-start gap-2.5"
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
                          <div className="text-xs font-semibold text-[#111C17]">
                            {alert.title}
                          </div>
                          <div className="text-[11px] text-[#526259] mt-0.5">
                            {alert.detail}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Settings Shortcut */}
            <button
              type="button"
              onClick={() => navigateToTab('settings')}
              className={`hidden lg:inline-flex p-2 border rounded-lg transition-colors ${
                activeTab === 'settings'
                  ? 'text-[#0B261C] bg-[#ECF4EF] border-[#C6DFD1]'
                  : 'text-[#526259] hover:text-[#111C17] hover:bg-[#F6F8F6] border-[#E3E8E4]'
              }`}
              aria-label="Open clinic settings"
              title="Clinic settings"
            >
              <Settings className="w-4 h-4" aria-hidden="true" />
            </button>

            {/* User Profile Button */}
            <button
              type="button"
              onClick={() => navigateToTab('profile')}
              className={`hidden sm:inline-flex items-center gap-2 pl-1.5 pr-2 xl:pr-2.5 py-1 text-xs border rounded-lg transition-colors whitespace-nowrap ${
                activeTab === 'profile'
                  ? 'bg-[#ECF4EF] border-[#C6DFD1] text-[#0B261C]'
                  : 'bg-[#F6F8F6] hover:bg-[#ECF4EF] border-[#E3E8E4] text-[#111C17]'
              }`}
              title="Open personal administrator profile"
            >
              {renderUserAvatar('w-6 h-6')}
              <ShieldCheck className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
              <span className="hidden xl:inline font-medium">{user.fullName}</span>
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
                className={`animate-toast-enter px-4 py-3 rounded-xl border flex items-center justify-between gap-4 text-xs ${
                  toast.kind === 'error'
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : 'bg-[#ECF4EF] border-[#B7DFCA] text-[#0B261C]'
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
          <div
            key={`${activeClinic.id}-${activeTab}-${routePatientId ?? ''}-${routeStaffId ?? ''}`}
            className="animate-view-enter"
          >
            {activeTab === 'dashboard' && (
              <DashboardView
                onNavigate={(tab) => navigateToTab(tab)}
                onNavigateToFiltered={handleNavigateToFiltered}
                onQuickRegisterPatient={handleQuickRegisterPatient}
                onQuickScheduleAppointment={handleQuickScheduleAppointment}
                onLaunchAssistantPrompt={handleLaunchAssistantPrompt}
                actorName={user.fullName}
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
                onNavigateToFiltered={handleNavigateToFiltered}
                initialPrompt={pendingAssistantPrompt}
                onInitialPromptConsumed={() => setPendingAssistantPrompt(null)}
              />
            )}
            {activeTab === 'patients' &&
              (routePatientId ? (
                <PatientProfilePage
                  patientId={routePatientId}
                  sessionRole={patientUiRole}
                  refreshSignal={refreshSignal}
                  onBack={() => navigateToTab('patients')}
                  onDataMutated={handleDataMutated}
                  onErrorNotice={handleErrorNotice}
                  onSuccessNotice={handleSuccessNotice}
                  onQuickScheduleForPatient={handleQuickScheduleForPatient}
                  onOpenAppointment={(apt) =>
                    handleNavigateToFiltered({
                      tab: 'appointments',
                      date: '',
                      status: 'All',
                      appointmentId: apt.id,
                    })
                  }
                  onOpenStaffByName={handleOpenStaffByName}
                />
              ) : (
                <PatientsView
                  onDataMutated={handleDataMutated}
                  onErrorNotice={handleErrorNotice}
                  onSuccessNotice={handleSuccessNotice}
                  onQuickScheduleForPatient={handleQuickScheduleForPatient}
                  openCreateSignal={patientCreateSignal}
                  initialStatusFilter={patientsStatusFilter}
                  onOpenPatient={handleOpenPatientProfile}
                  sessionRole={patientUiRole}
                  compactDensity={compactDensity}
                />
              ))}
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
                onOpenStaffByName={handleOpenStaffByName}
                sessionRole={appointmentUiRole}
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
                canManageFollowups={permissions.canManageFollowups}
                compactDensity={compactDensity}
              />
            )}
            {activeTab === 'staff' &&
              (routeStaffId ? (
                <StaffProfilePage
                  staffId={routeStaffId}
                  sessionRole={staffUiRole}
                  refreshSignal={refreshSignal}
                  onBack={() => navigateToTab('staff')}
                  onDataMutated={handleDataMutated}
                  onErrorNotice={handleErrorNotice}
                  onSuccessNotice={handleSuccessNotice}
                  onOpenPatient={handleOpenPatientProfile}
                  onOpenAppointment={(apt) =>
                    handleNavigateToFiltered({
                      tab: 'appointments',
                      date: '',
                      status: 'All',
                      appointmentId: apt.id,
                    })
                  }
                />
              ) : (
                <StaffView
                  onOpenStaff={handleOpenStaffProfile}
                  onErrorNotice={handleErrorNotice}
                  refreshSignal={refreshSignal}
                  compactDensity={compactDensity}
                />
              ))}
            {activeTab === 'reports' && (
              <ReportsApiView
                onErrorNotice={handleErrorNotice}
                onSuccessNotice={handleSuccessNotice}
                refreshSignal={refreshSignal}
              />
            )}
            {activeTab === 'profile' && (
              <AdminProfilePage
                session={accountSession}
                onSessionRefresh={handleSessionRefresh}
                onDataMutated={handleDataMutated}
                onErrorNotice={handleErrorNotice}
                onSuccessNotice={handleSuccessNotice}
                onSignOut={handleSignOut}
              />
            )}
            {activeTab === 'settings' && (
              <SettingsView
                session={accountSession}
                onOpenProfile={() => navigateToTab('profile')}
                compactDensity={compactDensity}
                onToggleCompactDensity={setCompactDensity}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebarCollapsed={setSidebarCollapsed}
                onSuccessNotice={handleSuccessNotice}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
