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
  LogOut,
  MoreHorizontal,
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
  type AuthSessionUser,
  getCurrentIdToken,
  signOutFirebase,
  subscribeToAuthState,
} from './client/firebase';
import { AdminProfilePage } from './components/AdminProfilePage';
import {
  AppointmentsView,
  type AppointmentsRailAction,
} from './components/AppointmentsView';
import { AssistantView } from './components/AssistantView';
import { AuthView } from './components/AuthView';
import { CareDeskLogoMark, EditorialAvatar } from './components/ClinicIllustrations';
import { DashboardView, type DashboardFilteredTarget } from './components/DashboardView';
import { DoctorWorkspace } from './components/DoctorWorkspace';
import { FollowUpsView } from './components/FollowUpsView';
import { OnboardingRouterView } from './components/OnboardingRouterView';
import { PatientProfilePage } from './components/PatientProfilePage';
import { PatientsView } from './components/PatientsView';
import { PatientWorkspace } from './components/PatientWorkspace';
import { ReportsApiView } from './components/ReportsApiView';
import { RightRail } from './components/RightRail';
import { SettingsView } from './components/SettingsView';
import { SignatureLoader } from './components/SignatureLoader';
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
import { formatGreetingName, formatReadableHeaderDate } from './utils/workspaceMath';

type NavTab =
  | 'dashboard'
  | 'patients'
  | 'appointments'
  | 'followups'
  | 'reports'
  | 'assistant'
  | 'settings'
  | 'staff'
  | 'profile';

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

function getLocalTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTimeGreeting(): string {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  return 'Good evening';
}

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
    // Ignore storage access errors
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

const SIDEBAR_MAIN_ITEMS: Array<{
  id: NavTab;
  label: string;
  title: string;
  subtitle: string;
  icon: typeof Activity;
}> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    title: 'Dashboard',
    subtitle: 'Live clinic operations, schedules, and volume overview',
    icon: Activity,
  },
  {
    id: 'patients',
    label: 'Patients',
    title: 'Patients',
    subtitle: 'Clinic-isolated patient roster, intake, and profile drawer',
    icon: Users,
  },
  {
    id: 'appointments',
    label: 'Appointments',
    title: 'Appointments',
    subtitle: 'Color-coded calendar bookings and conflict-checked slots',
    icon: Calendar,
  },
  {
    id: 'followups',
    label: 'Follow-ups',
    title: 'Follow-ups',
    subtitle: 'Priority-grouped outreach tasks and overdue tracking',
    icon: ClipboardList,
  },
  {
    id: 'reports',
    label: 'Reports',
    title: 'Operational Reports',
    subtitle: 'Clinic capacity analytics, exports, and OpenAPI docs',
    icon: FileBarChart,
  },
  {
    id: 'assistant',
    label: 'AI Assistant',
    title: 'AI Assistant',
    subtitle: 'Conversational clinic copilot with tool tracing & approval gate',
    icon: Bot,
  },
];

const EXTRA_PAGE_META: Record<
  'settings' | 'staff' | 'profile',
  { label: string; title: string; subtitle: string }
> = {
  settings: {
    label: 'Settings',
    title: 'Clinic Settings',
    subtitle: 'Display preferences, navigation layout, and Synapse MCP readiness',
  },
  staff: {
    label: 'Staff',
    title: 'Clinic Staff Roster',
    subtitle: 'Clinicians, coordinators, and duty schedules',
  },
  profile: {
    label: 'My Profile',
    title: 'Administrator Profile & Team',
    subtitle: 'Personal account, clinic workspace, security, and RBAC roles',
  },
};

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
  const [firebaseUser, setFirebaseUser] = useState<AuthSessionUser | null>(null);
  const [accountSession, setAccountSession] = useState<AccountSessionState | null>(null);
  const [authSyncError, setAuthSyncError] = useState<string | null>(null);
  const registrationMetaRef = useRef<{ fullName?: string; phoneNumber?: string }>({});

  const [activeTab, setActiveTab] = useState<NavTab>(initialRoute.tab);
  const [routePatientId, setRoutePatientId] = useState<string | null>(initialRoute.patientId);
  const [routeStaffId, setRouteStaffId] = useState<string | null>(initialRoute.staffId);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  // Default to floating icon-only pill sidebar per redesign specification
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [compactDensity, setCompactDensity] = useState(false);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const [pendingAssistantPrompt, setPendingAssistantPrompt] = useState<string | null>(null);
  const [staffDirectory, setStaffDirectory] = useState<StaffMember[]>([]);
  const [routeTransitioning, setRouteTransitioning] = useState(false);
  const [initialOpsReady, setInitialOpsReady] = useState(false);
  const routeRafRef = useRef<number | null>(null);

  // Right Rail shared synchronization state (for Dashboard & Appointments)
  const [focusDate, setFocusDate] = useState<string>(getLocalTodayIso);
  const [rightRailOverview, setRightRailOverview] = useState<OverviewReport | null>(null);
  const [rightRailDayAppointments, setRightRailDayAppointments] = useState<Appointment[]>([]);
  const [railSelectedAppointment, setRailSelectedAppointment] = useState<Appointment | null>(null);
  const [appointmentsRailAction, setAppointmentsRailAction] =
    useState<AppointmentsRailAction | null>(null);

  // Modals & Cross-view deep links
  const [patientCreateSignal, setPatientCreateSignal] = useState(0);
  const [appointmentCreateSignal, setAppointmentCreateSignal] = useState(0);
  const [followupCreateSignal, setFollowupCreateSignal] = useState(0);
  const [prefillAppointmentPatientId, setPrefillAppointmentPatientId] = useState<string | null>(
    null
  );
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
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
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
    async (user: AuthSessionUser, preferredClinicId?: string | null) => {
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
      const isMajorRouteSwitch =
        route.tab !== activeTab ||
        route.patientId !== routePatientId ||
        route.staffId !== routeStaffId;

      if (!options?.preserveFilters) {
        setPatientsStatusFilter('All');
        setAppointmentsStatusFilter('All');
        setAppointmentsDateFilter('');
        setSelectedAppointmentIdForDetail(null);
        setFollowupsViewMode('pending');
      }

      if (isMajorRouteSwitch) {
        if (routeRafRef.current !== null) {
          window.cancelAnimationFrame(routeRafRef.current);
        }
        setRouteTransitioning(true);
        routeRafRef.current = window.requestAnimationFrame(() => {
          routeRafRef.current = window.requestAnimationFrame(() => {
            setRouteTransitioning(false);
            routeRafRef.current = null;
          });
        });
      }

      setActiveTab(route.tab);
      setRoutePatientId(route.patientId);
      setRouteStaffId(route.staffId);
      if (route.tab !== 'appointments') {
        setRailSelectedAppointment(null);
      }
      const targetPath = getPathForRoute(route);
      if (typeof window !== 'undefined' && window.location.pathname !== targetPath) {
        window.history.pushState(route, '', targetPath);
      }
    },
    [activeTab, routePatientId, routeStaffId]
  );

  const navigateToTab = useCallback(
    (tab: NavTab, options?: { preserveFilters?: boolean }) => {
      navigateToRoute({ tab, patientId: null, staffId: null }, options);
    },
    [navigateToRoute]
  );

  useEffect(() => {
    return () => {
      if (routeRafRef.current !== null) {
        window.cancelAnimationFrame(routeRafRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    if (
      !firebaseUser ||
      !activeClinicId ||
      accountSession?.needsOnboarding ||
      activeRole === 'Patient' ||
      activeRole === 'Doctor'
    ) {
      setInitialOpsReady(true);
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
          setRightRailOverview(ov);
          setDailySnapshot(dy);
          setStaffDirectory(staff);
          setNotificationsList(notifData.items);
          setUnreadNotificationsCount(notifData.unreadCount);
        }
      } catch {
        // Non-blocking alert refresh
      } finally {
        if (!cancelled) {
          setInitialOpsReady(true);
        }
      }
    }
    loadOperationalAlerts();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, activeClinicId, activeRole, accountSession?.needsOnboarding, refreshSignal]);

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
      setToasts([]);
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
        // Fall through
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
        if (target.date) {
          setFocusDate(target.date);
        }
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

  const isAdminSessionActive = Boolean(
    firebaseUser &&
      accountSession &&
      !accountSession.needsOnboarding &&
      accountSession.activeClinic &&
      accountSession.activeMembership?.role !== 'Doctor' &&
      accountSession.activeMembership?.role !== 'Patient'
  );
  const bootLoaderActive = authBooting || (isAdminSessionActive && !initialOpsReady);
  const showSignatureLoader = bootLoaderActive || routeTransitioning;

  if (authBooting) {
    return (
      <div className="min-h-dvh bg-[#0F3D2E]">
        <SignatureLoader active variant="boot" />
      </div>
    );
  }

  if (firebaseUser && authSyncError && !accountSession) {
    return (
      <div className="min-h-dvh bg-[#EEF3EF] text-[#1C2B25] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-[#DCE8E0] rounded-[24px] p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2.5 text-rose-700 font-semibold text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>Unable to Load Clinic Session</span>
          </div>
          <p className="text-xs text-[#6B7B73] leading-relaxed">{authSyncError}</p>
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={handleSignOut}
              className="px-4 py-2 text-xs font-semibold text-[#6B7B73] border border-[#DCE8E0] rounded-full"
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
              className="px-5 py-2 text-xs font-semibold text-white bg-[#34C38F] hover:bg-[#24B07D] rounded-full"
            >
              Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !accountSession) {
    return (
      <>
        <SignatureLoader active={false} variant="boot" />
        <AuthView
          onRegistrationMetadata={(meta) => {
            registrationMetaRef.current = meta;
          }}
        />
      </>
    );
  }

  const renderFixedToasts = () =>
    toasts.length > 0 ? (
      <div
        className="fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-50 w-full max-w-sm space-y-2 px-4 sm:px-0"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`animate-toast-enter px-4 py-3 rounded-2xl border shadow-md flex items-center justify-between gap-4 text-xs ${
              toast.kind === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : 'bg-[#E3F7EF] border-[#B5E5D0] text-[#0F3D2E]'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {toast.kind === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-[#137A55] shrink-0" aria-hidden="true" />
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
  const activeSidebarItem = SIDEBAR_MAIN_ITEMS.find((n) => n.id === activeTab);
  const showRightRail = activeTab === 'dashboard' || activeTab === 'appointments';
  const todayDateIso = overviewSnapshot?.todayDate ?? getLocalTodayIso();
  const formattedHeaderDate = formatReadableHeaderDate(todayDateIso);
  const firstName = formatGreetingName(user.fullName);

  const headerHeading =
    activeTab === 'dashboard'
      ? `${getTimeGreeting()}, ${firstName}`
      : activeTab === 'patients' && routePatientId
        ? `Patient Chart · ${routePatientId}`
        : activeTab === 'staff' && routeStaffId
          ? `Staff Profile · ${routeStaffId}`
          : activeSidebarItem
            ? activeSidebarItem.title
            : EXTRA_PAGE_META[activeTab as 'settings' | 'staff' | 'profile'].title;

  const headerSubtitle =
    activeTab === 'dashboard'
      ? `${activeClinic.name} · ${formattedHeaderDate}`
      : activeSidebarItem
        ? `${activeSidebarItem.subtitle} · ${formattedHeaderDate}`
        : `${EXTRA_PAGE_META[activeTab as 'settings' | 'staff' | 'profile'].subtitle} · ${formattedHeaderDate}`;

  const patientUiRole = permissions.canManagePatients ? 'administrator' : 'viewer';
  const appointmentUiRole = permissions.canManageAppointments ? 'administrator' : 'viewer';
  const staffUiRole = permissions.canManageStaff ? 'administrator' : 'viewer';

  const renderUserAvatar = (sizeClass: string, smallFallback = true) =>
    user.avatarUrl && !avatarLoadError ? (
      <img
        src={user.avatarUrl}
        alt={user.fullName}
        referrerPolicy="no-referrer"
        onError={() => setAvatarLoadError(true)}
        className={`${sizeClass} rounded-full object-cover shrink-0 border border-[#DCE8E0]`}
      />
    ) : (
      <EditorialAvatar
        name={user.fullName}
        role="administrator"
        size={smallFallback ? 'sm' : 'md'}
      />
    );

  return (
    <div className="w-full min-h-dvh lg:h-dvh lg:overflow-hidden bg-[#EEF3EF] text-[#1C2B25] p-0 lg:p-2.5 pb-[76px] lg:pb-2.5">
      <SignatureLoader
        active={showSignatureLoader}
        variant={bootLoaderActive ? 'boot' : 'route'}
      />

      {/* Full-Viewport Application Shell */}
      <div className="shell-frame w-full min-h-dvh lg:min-h-0 lg:h-full lg:overflow-hidden rounded-none lg:rounded-[24px] p-3 sm:p-4 lg:p-4 flex gap-3 lg:gap-4 relative">
        {/* 1. Full-Height Forest-Green Sidebar (Desktop) */}
        <aside
          aria-label="Primary Clinic Navigation"
          className={`hidden lg:flex lg:flex-col lg:justify-between shrink-0 z-30 rounded-[28px] bg-[#0F3D2E] text-emerald-50 py-4 px-3 h-full shadow-md transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-[74px] items-center' : 'w-[216px] items-stretch'
          }`}
        >
          {/* Top Brand Mark */}
          <div
            className={`flex items-center ${
              sidebarCollapsed ? 'justify-center' : 'gap-3 px-2'
            }`}
          >
            <button
              type="button"
              onClick={() => navigateToTab('dashboard')}
              title="CareDesk AI · Dashboard"
              aria-label="CareDesk AI Home"
              className="btn-press focus:outline-none rounded-2xl"
            >
              <CareDeskLogoMark className="w-10 h-10 shadow-sm" />
            </button>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <div className="text-sm font-bold text-white tracking-tight truncate">
                  CareDesk AI
                </div>
                <div className="text-[10px] text-emerald-200/75 truncate">{activeClinic.name}</div>
              </div>
            )}
          </div>

          {/* Center Main Icons */}
          <nav
            aria-label="Primary Sections"
            className={`flex-1 flex flex-col justify-center gap-2 my-4 overflow-y-auto overflow-x-hidden ${
              sidebarCollapsed ? 'items-center' : 'items-stretch'
            }`}
          >
            {SIDEBAR_MAIN_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateToTab(item.id)}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`group relative btn-press flex items-center ${
                    sidebarCollapsed
                      ? 'w-11 h-11 justify-center'
                      : 'w-full gap-3 px-3.5 py-2.5'
                  } rounded-2xl transition-all ${
                    isActive
                      ? 'bg-[#34C38F] text-white shadow-sm'
                      : 'text-emerald-100/80 hover:bg-white/12 hover:text-white hover:-translate-y-0.5'
                  }`}
                >
                  <Icon className="w-[19px] h-[19px] shrink-0" aria-hidden="true" />
                  {!sidebarCollapsed && (
                    <span className="text-xs font-semibold truncate">{item.label}</span>
                  )}
                  {sidebarCollapsed && (
                    <span className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity absolute left-full ml-3 px-2.5 py-1 rounded-full bg-[#1C2B25] text-white text-[11px] font-semibold whitespace-nowrap shadow-md z-50">
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Bottom Pinned: Expand/Collapse, Settings & Logout */}
          <div
            className={`flex flex-col gap-1.5 pt-3 border-t border-white/10 ${
              sidebarCollapsed ? 'items-center' : 'items-stretch'
            }`}
          >
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`group relative btn-press flex items-center ${
                sidebarCollapsed
                  ? 'w-11 h-11 justify-center'
                  : 'w-full gap-3 px-3.5 py-2.5'
              } rounded-2xl text-emerald-100/80 hover:bg-white/12 hover:text-white transition-all`}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
              )}
              {!sidebarCollapsed && <span className="text-xs font-semibold">Collapse Rail</span>}
              {sidebarCollapsed && (
                <span className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity absolute left-full ml-3 px-2.5 py-1 rounded-full bg-[#1C2B25] text-white text-[11px] font-semibold whitespace-nowrap shadow-md z-50">
                  Expand Rail
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigateToTab('settings')}
              aria-label="Settings"
              aria-current={activeTab === 'settings' ? 'page' : undefined}
              title={sidebarCollapsed ? 'Settings' : undefined}
              className={`group relative btn-press flex items-center ${
                sidebarCollapsed
                  ? 'w-11 h-11 justify-center'
                  : 'w-full gap-3 px-3.5 py-2.5'
              } rounded-2xl transition-all ${
                activeTab === 'settings'
                  ? 'bg-[#34C38F] text-white shadow-sm'
                  : 'text-emerald-100/80 hover:bg-white/12 hover:text-white hover:-translate-y-0.5'
              }`}
            >
              <Settings className="w-[19px] h-[19px] shrink-0" aria-hidden="true" />
              {!sidebarCollapsed && <span className="text-xs font-semibold">Settings</span>}
              {sidebarCollapsed && (
                <span className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity absolute left-full ml-3 px-2.5 py-1 rounded-full bg-[#1C2B25] text-white text-[11px] font-semibold whitespace-nowrap shadow-md z-50">
                  Settings
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sign Out"
              title={sidebarCollapsed ? 'Sign Out' : undefined}
              className={`group relative btn-press flex items-center ${
                sidebarCollapsed
                  ? 'w-11 h-11 justify-center'
                  : 'w-full gap-3 px-3.5 py-2.5'
              } rounded-2xl text-emerald-100/80 hover:bg-white/12 hover:text-white hover:-translate-y-0.5 transition-all`}
            >
              <LogOut className="w-[19px] h-[19px] shrink-0" aria-hidden="true" />
              {!sidebarCollapsed && <span className="text-xs font-semibold">Logout</span>}
              {sidebarCollapsed && (
                <span className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity absolute left-full ml-3 px-2.5 py-1 rounded-full bg-[#1C2B25] text-white text-[11px] font-semibold whitespace-nowrap shadow-md z-50">
                  Logout
                </span>
              )}
            </button>
          </div>
        </aside>

        {/* 2. Central Workspace + Conditional Right Rail */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 lg:h-full lg:min-h-0">
          {/* Lightweight Header (Pinned at top on desktop) */}
          <header className="shrink-0 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 px-0.5 sm:px-1 pt-0.5">
            <div className="flex items-center justify-between gap-2.5 min-w-0 sm:flex-1">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                <div className="lg:hidden shrink-0">
                  <CareDeskLogoMark className="w-9 h-9" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight text-[#1C2B25] leading-tight sm:truncate">
                    {headerHeading}
                  </h1>
                  <p className="hidden sm:block text-xs md:text-[13px] text-[#6B7B73] truncate mt-0.5">
                    {headerSubtitle}
                  </p>
                </div>
              </div>

              {/* Mobile-only right utility icons aligned beside title */}
              <div className="flex sm:hidden items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setMobileSearchOpen((v) => !v)}
                  aria-label="Toggle global clinic search"
                  aria-expanded={mobileSearchOpen}
                  className={`btn-press w-11 h-11 flex items-center justify-center border rounded-full transition-colors ${
                    mobileSearchOpen
                      ? 'bg-[#0F3D2E] border-[#0F3D2E] text-white'
                      : 'bg-white border-[#DCE8E0] text-[#1C2B25] hover:bg-[#EEF3EF]'
                  }`}
                >
                  <Search className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
              <p className="sm:hidden text-xs text-[#6B7B73] truncate min-w-0 flex-1">
                {activeClinic.name} · {formattedHeaderDate}
              </p>

              {/* Tablet Search Toggle (sm to < lg) */}
              <button
                type="button"
                onClick={() => setMobileSearchOpen((v) => !v)}
                aria-label="Toggle clinic search"
                aria-expanded={mobileSearchOpen}
                className={`hidden sm:flex lg:hidden btn-press w-10 h-10 items-center justify-center border rounded-full transition-colors ${
                  mobileSearchOpen
                    ? 'bg-[#0F3D2E] border-[#0F3D2E] text-white'
                    : 'bg-white border-[#DCE8E0] text-[#1C2B25] hover:bg-[#EEF3EF]'
                }`}
              >
                <Search className="w-4 h-4" aria-hidden="true" />
              </button>

              {/* Search Pill (Desktop >= lg) */}
              <div ref={searchContainerRef} className="relative hidden lg:block w-52 xl:w-64">
                <Search
                  className="w-3.5 h-3.5 text-[#6B7B73] absolute left-3.5 top-1/2 -translate-y-1/2"
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
                  placeholder="Search patient, staff, ID..."
                  aria-label="Global clinic search"
                  className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-[#DCE8E0] rounded-full focus:outline-none focus:ring-2 focus:ring-[#34C38F]/25 focus:border-[#34C38F]"
                />

                {searchOpen && globalSearch.trim().length > 0 && (
                  <div className="absolute right-0 mt-2 w-80 bg-white border border-[#DCE8E0] rounded-2xl shadow-xl z-40 overflow-hidden">
                    <div className="px-4 py-2 border-b border-[#EEF3EF] bg-[#FAFBF9] text-[11px] font-semibold text-[#6B7B73] flex items-center justify-between">
                      <span>Search Results ({activeClinic.id})</span>
                      {searchLoading && <span>Searching...</span>}
                    </div>
                    {searchResults.patients.length === 0 &&
                    searchResults.appointments.length === 0 &&
                    searchResults.staff.length === 0 &&
                    !searchLoading ? (
                      <div className="px-4 py-5 text-xs text-[#6B7B73] text-center">
                        No matching patients, staff, or appointments found.
                      </div>
                    ) : (
                      <div className="max-h-72 overflow-y-auto divide-y divide-[#EEF3EF]">
                        {searchResults.patients.map((pt) => (
                          <button
                            key={pt.id}
                            type="button"
                            onClick={() => {
                              handleOpenPatientProfile(pt.id);
                              setSearchOpen(false);
                              setGlobalSearch('');
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-[#FAFBF9] transition-colors"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-[#1C2B25]">{pt.fullName}</span>
                              <span className="font-mono text-[#137A55]">{pt.id}</span>
                            </div>
                            <div className="text-[11px] text-[#6B7B73] mt-0.5">
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
                            className="w-full text-left px-4 py-2.5 hover:bg-[#FAFBF9] transition-colors"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-[#1C2B25]">{stf.fullName}</span>
                              <span className="font-mono text-[#0F3D2E]">{stf.id}</span>
                            </div>
                            <div className="text-[11px] text-[#6B7B73] mt-0.5">
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
                                date: apt.appointmentDate,
                                status: 'All',
                                appointmentId: apt.id,
                              });
                              setSearchOpen(false);
                              setGlobalSearch('');
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-[#FAFBF9] transition-colors"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-[#1C2B25]">
                                {apt.patientName ?? apt.patientId}
                              </span>
                              <span className="font-mono text-[#6B7B73]">{apt.id}</span>
                            </div>
                            <div className="text-[11px] text-[#6B7B73] mt-0.5 font-mono tabular-nums">
                              {apt.appointmentDate} {apt.appointmentTime} · {apt.department}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Staff Roster Shortcut Pill (subtle quick link) */}
              <button
                type="button"
                onClick={() => navigateToTab('staff')}
                className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs font-semibold transition-colors ${
                  activeTab === 'staff'
                    ? 'bg-[#0F3D2E] border-[#0F3D2E] text-white'
                    : 'bg-white border-[#DCE8E0] text-[#1C2B25] hover:bg-[#EEF3EF]'
                }`}
                aria-label="Open staff roster"
                title="Staff & Clinicians"
              >
                <Stethoscope className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden xl:inline">Staff</span>
              </button>

              {/* Notification Bell with Dot */}
              <div ref={notifContainerRef} className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((prev) => !prev)}
                  className="btn-press relative w-11 h-11 sm:w-10 sm:h-10 flex items-center justify-center text-[#1C2B25] bg-white hover:bg-[#EEF3EF] border border-[#DCE8E0] rounded-full transition-colors"
                  aria-label="Operational notifications"
                  aria-expanded={notifOpen}
                >
                  <Bell className="w-4 h-4" aria-hidden="true" />
                  {alertBadgeCount > 0 && (
                    <span
                      className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-[#34C38F] ring-2 ring-white"
                      aria-label={`${alertBadgeCount} active alerts`}
                    />
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-96 max-w-[92vw] bg-white border border-[#DCE8E0] rounded-2xl shadow-xl z-40 overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#EEF3EF] bg-[#FAFBF9] flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#1C2B25]">
                        Operational Notifications ({alertBadgeCount})
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
                            className="text-[11px] font-semibold text-[#137A55] hover:underline"
                          >
                            Mark all read
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="divide-y divide-[#EEF3EF] max-h-96 overflow-y-auto">
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
                              {accountSession.pendingDoctorApplications.length} doctor app(s) ·{' '}
                              {accountSession.pendingPatientLinkRequests.length} patient link(s)
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
                          className={`w-full text-left px-4 py-2.5 hover:bg-[#FAFBF9] transition-colors flex items-start gap-2.5 ${
                            n.isRead ? 'opacity-70' : ''
                          }`}
                        >
                          <Bell
                            className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                              n.isRead ? 'text-[#6B7B73]' : 'text-[#137A55]'
                            }`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-[#1C2B25] flex items-center justify-between gap-2">
                              <span className="truncate">{n.title}</span>
                              {!n.isRead && (
                                <span className="text-[10px] font-mono text-[#137A55] shrink-0">
                                  New
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#6B7B73] mt-0.5">{n.message}</div>
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
                          className="w-full text-left px-4 py-3 hover:bg-[#FAFBF9] transition-colors flex items-start gap-2.5"
                        >
                          {alert.severity === 'red' ? (
                            <AlertTriangle
                              className="w-4 h-4 text-rose-600 mt-0.5 shrink-0"
                              aria-hidden="true"
                            />
                          ) : alert.severity === 'amber' ? (
                            <Clock
                              className="w-4 h-4 text-amber-600 mt-0.5 shrink-0"
                              aria-hidden="true"
                            />
                          ) : (
                            <CheckCircle2
                              className="w-4 h-4 text-[#137A55] mt-0.5 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#1C2B25]">
                              {alert.title}
                            </div>
                            <div className="text-[11px] text-[#6B7B73] mt-0.5">
                              {alert.detail}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Profile Avatar Pill */}
              <button
                type="button"
                onClick={() => navigateToTab('profile')}
                aria-label="Open administrator profile"
                className={`hidden sm:inline-flex items-center gap-2 p-1 xl:pl-1.5 xl:pr-3 rounded-full border text-left transition-colors ${
                  activeTab === 'profile'
                    ? 'bg-[#E3F7EF] border-[#34C38F] text-[#0F3D2E]'
                    : 'bg-white border-[#DCE8E0] hover:bg-[#EEF3EF] text-[#1C2B25]'
                }`}
                title="Open administrator profile & team"
              >
                {renderUserAvatar('w-7 h-7')}
                <div className="hidden xl:block leading-tight">
                  <div className="text-xs font-semibold text-[#1C2B25] truncate max-w-[120px]">
                    {user.fullName}
                  </div>
                  <div className="text-[10px] text-[#6B7B73] truncate">
                    {activeMembership?.role ?? 'Administrator'}
                  </div>
                </div>
              </button>

              {/* Primary + New Appointment Pill */}
              {permissions.canManageAppointments && (
                <button
                  type="button"
                  onClick={handleQuickScheduleAppointment}
                  className="btn-press min-h-[44px] sm:min-h-0 px-3.5 md:px-3 lg:px-4 py-2 text-xs lg:text-sm font-semibold text-white bg-[#0F3D2E] hover:bg-[#144D3B] rounded-full shadow-xs transition-colors whitespace-nowrap shrink-0"
                >
                  + New Appointment
                </button>
              )}
            </div>
          </header>

          {/* Collapsible Mobile & Tablet Search Bar (< lg) */}
          {mobileSearchOpen && (
            <div className="lg:hidden relative px-1 animate-view-enter">
              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-[#6B7B73] absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="mobile-global-search"
                  type="search"
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  placeholder="Search patient, staff, appointment ID..."
                  aria-label="Mobile global clinic search"
                  className="w-full pl-9 pr-9 py-2.5 text-xs bg-white border border-[#DCE8E0] rounded-full focus:outline-none focus:ring-2 focus:ring-[#34C38F]/25 focus:border-[#34C38F]"
                />
                {globalSearch && (
                  <button
                    type="button"
                    onClick={() => setGlobalSearch('')}
                    aria-label="Clear mobile search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7B73] hover:text-[#1C2B25]"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              {globalSearch.trim().length > 0 && (
                <div className="mt-2 bg-white border border-[#DCE8E0] rounded-2xl shadow-lg overflow-hidden">
                  <div className="px-4 py-2 border-b border-[#EEF3EF] bg-[#FAFBF9] text-[11px] font-semibold text-[#6B7B73] flex items-center justify-between">
                    <span>Search Results ({activeClinic.id})</span>
                    {searchLoading && <span>Searching...</span>}
                  </div>
                  {searchResults.patients.length === 0 &&
                  searchResults.appointments.length === 0 &&
                  searchResults.staff.length === 0 &&
                  !searchLoading ? (
                    <div className="px-4 py-4 text-xs text-[#6B7B73] text-center">
                      No matching patients, staff, or appointments found.
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto divide-y divide-[#EEF3EF]">
                      {searchResults.patients.map((pt) => (
                        <button
                          key={pt.id}
                          type="button"
                          onClick={() => {
                            handleOpenPatientProfile(pt.id);
                            setMobileSearchOpen(false);
                            setGlobalSearch('');
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-[#FAFBF9]"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-[#1C2B25]">{pt.fullName}</span>
                            <span className="font-mono text-[#137A55]">{pt.id}</span>
                          </div>
                          <div className="text-[11px] text-[#6B7B73] mt-0.5">
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
                            setMobileSearchOpen(false);
                            setGlobalSearch('');
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-[#FAFBF9]"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-[#1C2B25]">{stf.fullName}</span>
                            <span className="font-mono text-[#0F3D2E]">{stf.id}</span>
                          </div>
                          <div className="text-[11px] text-[#6B7B73] mt-0.5">
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
                              date: apt.appointmentDate,
                              status: 'All',
                              appointmentId: apt.id,
                            });
                            setMobileSearchOpen(false);
                            setGlobalSearch('');
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-[#FAFBF9]"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-[#1C2B25]">
                              {apt.patientName ?? apt.patientId}
                            </span>
                            <span className="font-mono text-[#6B7B73]">{apt.id}</span>
                          </div>
                          <div className="text-[11px] text-[#6B7B73] mt-0.5 font-mono tabular-nums">
                            {apt.appointmentDate} {apt.appointmentTime} · {apt.department}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Inline Toasts */}
          {toasts.length > 0 && (
            <div className="space-y-2 px-1" aria-live="polite" aria-atomic="true">
              {toasts.map((toast) => (
                <div
                  key={toast.id}
                  role={toast.kind === 'error' ? 'alert' : 'status'}
                  className={`animate-toast-enter px-4 py-2.5 rounded-2xl border flex items-center justify-between gap-4 text-xs ${
                    toast.kind === 'error'
                      ? 'bg-rose-50 border-rose-200 text-rose-800'
                      : 'bg-[#E3F7EF] border-[#B5E5D0] text-[#0F3D2E]'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    {toast.kind === 'error' ? (
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-[#137A55] shrink-0" aria-hidden="true" />
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

          {/* Central Workspace + Conditional Right-Hand Rail (inner-only scroll on desktop) */}
          <div
            className={`flex-1 min-w-0 lg:min-h-0 ${
              showRightRail
                ? 'flex flex-col xl:flex-row gap-4 lg:gap-5 items-stretch lg:overflow-y-auto xl:overflow-hidden'
                : 'flex flex-col lg:overflow-y-auto'
            }`}
          >
            <main
              className={`${
                showRightRail
                  ? 'w-full xl:flex-1 min-w-0 xl:h-full xl:overflow-y-auto xl:pr-1'
                  : 'w-full flex-1 min-w-0 flex flex-col'
              } ${activeTab === 'assistant' ? 'lg:h-full lg:min-h-0 lg:overflow-hidden' : ''}`}
            >
              <div
                key={`${activeClinic.id}-${activeTab}-${routePatientId ?? ''}-${routeStaffId ?? ''}`}
                className={`animate-view-enter ${
                  activeTab === 'assistant' ? 'flex-1 min-h-0 flex flex-col lg:h-full' : ''
                }`}
              >
                {activeTab === 'dashboard' && (
                  <DashboardView
                    onNavigate={(tab) => navigateToTab(tab)}
                    onNavigateToFiltered={handleNavigateToFiltered}
                    onQuickRegisterPatient={handleQuickRegisterPatient}
                    onQuickScheduleAppointment={handleQuickScheduleAppointment}
                    onLaunchAssistantPrompt={handleLaunchAssistantPrompt}
                    actorName={user.fullName}
                    activeDate={focusDate}
                    onSelectDate={setFocusDate}
                    onDataSnapshot={({ overview, dayAppointments }) => {
                      setRightRailOverview(overview);
                      setRightRailDayAppointments(dayAppointments);
                    }}
                    onErrorNotice={handleErrorNotice}
                    onSuccessNotice={handleSuccessNotice}
                    refreshSignal={refreshSignal}
                    compactDensity={compactDensity}
                  />
                )}
                {activeTab === 'assistant' && (
                  <AssistantView
                    userName={user.fullName}
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
                          date: apt.appointmentDate,
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
                    activeDate={focusDate}
                    onSelectDate={setFocusDate}
                    selectedDetail={railSelectedAppointment}
                    onSelectDetail={setRailSelectedAppointment}
                    onDayAppointmentsChange={setRightRailDayAppointments}
                    railActionSignal={appointmentsRailAction}
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
                          date: apt.appointmentDate,
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

            {showRightRail && (
              <div className="w-full xl:w-[300px] 2xl:w-[330px] shrink-0 xl:h-full xl:overflow-y-auto xl:pr-0.5">
                <RightRail
                  mode={activeTab === 'appointments' ? 'appointments' : 'dashboard'}
                  user={user}
                  roleLabel={activeMembership?.role ?? 'Clinic Administrator'}
                  activeClinic={activeClinic}
                  clinics={clinics}
                  avatarLoadError={avatarLoadError}
                  onAvatarError={() => setAvatarLoadError(true)}
                  onSwitchClinic={handleSwitchClinic}
                  onOpenProfile={() => navigateToTab('profile')}
                  onOpenStaffRoster={() => navigateToTab('staff')}
                  focusDate={focusDate}
                  todayDate={todayDateIso}
                  onSelectDate={setFocusDate}
                  dayAppointments={rightRailDayAppointments}
                  overview={rightRailOverview || overviewSnapshot}
                  onOpenAppointmentDetail={(apt) =>
                    handleNavigateToFiltered({
                      tab: 'appointments',
                      date: apt.appointmentDate,
                      status: 'All',
                      appointmentId: apt.id,
                    })
                  }
                  selectedAppointment={railSelectedAppointment}
                  canWrite={permissions.canManageAppointments}
                  onSelectAppointment={setRailSelectedAppointment}
                  onEditAppointment={(apt) =>
                    setAppointmentsRailAction({ type: 'edit', apt, seq: Date.now() })
                  }
                  onCancelAppointment={(apt) =>
                    setAppointmentsRailAction({ type: 'cancel', apt, seq: Date.now() })
                  }
                  onDeleteAppointment={(apt) =>
                    setAppointmentsRailAction({ type: 'delete', apt, seq: Date.now() })
                  }
                  onTriageRequest={(apt, action) =>
                    setAppointmentsRailAction({
                      type: action === 'approve_cancel' ? 'triage_cancel' : 'triage_clear',
                      apt,
                      seq: Date.now(),
                    })
                  }
                  onOpenPatient={handleOpenPatientProfile}
                  onOpenStaffByName={handleOpenStaffByName}
                  onQuickBookDate={(d) => {
                    setFocusDate(d);
                    handleQuickScheduleAppointment();
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Bottom Tab Bar (< lg) */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 min-h-[64px] bg-[#0F3D2E] text-emerald-50 border-t border-white/10 px-2 py-1.5 flex items-center justify-around shadow-lg"
      >
        {[
          { id: 'dashboard' as NavTab, label: 'Home', icon: Activity },
          { id: 'patients' as NavTab, label: 'Patients', icon: Users },
          { id: 'appointments' as NavTab, label: 'Visits', icon: Calendar },
          { id: 'assistant' as NavTab, label: 'Assistant', icon: Bot },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                navigateToTab(item.id);
                setMobileMoreOpen(false);
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`min-w-[52px] min-h-[44px] flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${
                isActive ? 'text-[#34C38F]' : 'text-emerald-100/75 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span className="text-[10px] font-semibold">{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileMoreOpen((v) => !v)}
          aria-expanded={mobileMoreOpen}
          className={`min-w-[52px] min-h-[44px] flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${
            mobileMoreOpen ||
            activeTab === 'followups' ||
            activeTab === 'reports' ||
            activeTab === 'staff' ||
            activeTab === 'settings' ||
            activeTab === 'profile'
              ? 'text-[#34C38F]'
              : 'text-emerald-100/75 hover:text-white'
          }`}
        >
          <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
          <span className="text-[10px] font-semibold">More</span>
        </button>
      </nav>

      {/* Mobile More Sheet */}
      {mobileMoreOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end">
          <div
            className="fixed inset-0 bg-black/40 animate-modal-overlay"
            onClick={() => setMobileMoreOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full rounded-t-[28px] bg-white border-t border-[#DCE8E0] p-5 pb-8 space-y-4 animate-modal-panel">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-[#1C2B25]">Workspace Sections</div>
              <button
                type="button"
                onClick={() => setMobileMoreOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-[#EEF3EF]"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { id: 'followups' as NavTab, label: 'Follow-ups', icon: ClipboardList },
                { id: 'reports' as NavTab, label: 'Reports', icon: FileBarChart },
                { id: 'staff' as NavTab, label: 'Staff Roster', icon: Stethoscope },
                { id: 'profile' as NavTab, label: 'My Profile', icon: UserCircle },
                { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
              ].map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      navigateToTab(item.id);
                      setMobileMoreOpen(false);
                    }}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-xs font-semibold ${
                      active
                        ? 'bg-[#0F3D2E] border-[#0F3D2E] text-white'
                        : 'bg-[#FAFBF9] border-[#DCE8E0] text-[#1C2B25]'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={handleSignOut}
                className="flex items-center gap-2.5 px-4 py-3 rounded-2xl border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-800"
              >
                <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
