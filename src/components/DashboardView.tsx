import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Calendar as CalendarIcon,
  CalendarClock,
  Check,
  ClipboardCheck,
  Clock,
  RefreshCw,
  Stethoscope,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  fetchAppointments,
  fetchDailyReport,
  fetchDoctorAvailability,
  fetchOverviewReport,
  updateAppointmentRecord,
} from '../client/api';
import type {
  Appointment,
  DailyReport,
  DoctorAvailabilitySummary,
  OverviewReport,
} from '../shared/types';
import { DualSeriesAreaChart } from './AnalyticsCharts';
import {
  ClinicEmptyIllustration,
  EditorialAvatar,
  WelcomeBannerMotif,
} from './ClinicIllustrations';
import { DashboardSkeleton } from './Skeletons';
import { formatGreetingName } from '../utils/workspaceMath';
import { AppointmentStatusText, DoctorDutyStatusText } from './StatusText';

export interface DashboardFilteredTarget {
  tab: 'assistant' | 'patients' | 'appointments' | 'followups' | 'reports' | 'staff';
  status?: string;
  date?: string;
  followUpView?: 'pending' | 'overdue' | 'Completed' | 'all';
  appointmentId?: string;
}

interface DashboardViewProps {
  onNavigate: (
    tab: 'assistant' | 'patients' | 'appointments' | 'followups' | 'reports' | 'staff'
  ) => void;
  onNavigateToFiltered?: (target: DashboardFilteredTarget) => void;
  onQuickRegisterPatient?: () => void;
  onQuickScheduleAppointment?: () => void;
  onLaunchAssistantPrompt?: (prompt: string) => void;
  actorName?: string;
  activeDate?: string;
  onSelectDate?: (date: string) => void;
  onDataSnapshot?: (snapshot: {
    overview: OverviewReport;
    dayAppointments: Appointment[];
  }) => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  refreshSignal: number;
  compactDensity?: boolean;
}

function getLocalTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getGreetingPrefix(): string {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardView({
  onNavigate,
  onNavigateToFiltered,
  onQuickRegisterPatient,
  onQuickScheduleAppointment,
  onLaunchAssistantPrompt,
  actorName = 'Clinic Administrator',
  activeDate: controlledDate,
  onSelectDate,
  onDataSnapshot,
  onErrorNotice,
  onSuccessNotice,
  refreshSignal,
  compactDensity = false,
}: DashboardViewProps) {
  const [internalDate, setInternalDate] = useState<string>(getLocalTodayKey);
  const activeDate = controlledDate || internalDate;

  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [overview, setOverview] = useState<OverviewReport | null>(null);
  const [dayAppointments, setDayAppointments] = useState<Appointment[]>([]);
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);
  const [doctorAvailability, setDoctorAvailability] = useState<DoctorAvailabilitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const onDataSnapshotRef = useRef(onDataSnapshot);
  const onErrorNoticeRef = useRef(onErrorNotice);
  onDataSnapshotRef.current = onDataSnapshot;
  onErrorNoticeRef.current = onErrorNotice;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dailyData, overviewData, dayApts, allApts, docAvail] = await Promise.all([
        fetchDailyReport(activeDate),
        fetchOverviewReport(),
        fetchAppointments({ date: activeDate }),
        fetchAppointments().catch(() => []),
        fetchDoctorAvailability({ date: activeDate }).catch(() => []),
      ]);
      setDaily(dailyData);
      setOverview(overviewData);
      setDayAppointments(dayApts);
      setAllAppointments(allApts);
      setDoctorAvailability(docAvail);
      onDataSnapshotRef.current?.({ overview: overviewData, dayAppointments: dayApts });
    } catch (err) {
      onErrorNoticeRef.current(
        err instanceof Error ? err.message : 'Unable to load dashboard metrics.'
      );
    } finally {
      setLoading(false);
    }
  }, [activeDate]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshSignal]);

  const handleSelectDate = (date: string) => {
    if (!date) return;
    setInternalDate(date);
    onSelectDate?.(date);
  };

  const navigateTarget = (target: DashboardFilteredTarget) => {
    if (onNavigateToFiltered) {
      onNavigateToFiltered(target);
    } else {
      onNavigate(target.tab);
    }
  };

  const handleQuickConfirm = async (e: React.MouseEvent, appointmentId: string) => {
    e.stopPropagation();
    setUpdatingId(appointmentId);
    try {
      await updateAppointmentRecord(appointmentId, { status: 'Confirmed' });
      onSuccessNotice(`Appointment ${appointmentId} confirmed.`);
      await loadData();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to confirm appointment.');
    } finally {
      setUpdatingId(null);
    }
  };

  const newPatientsCount = useMemo(() => {
    if (!overview) return 0;
    const trend = overview.patientRegistrationTrend;
    if (trend && trend.length > 0) {
      return trend[trend.length - 1].count;
    }
    return overview.totalPatients;
  }, [overview]);

  const newPatientsPeriodLabel = useMemo(() => {
    const trend = overview?.patientRegistrationTrend;
    if (trend && trend.length > 0) {
      return `${trend[trend.length - 1].period} cohort`;
    }
    return 'Registered roster';
  }, [overview]);

  if (loading && !daily) {
    return <DashboardSkeleton />;
  }

  if (!daily || !overview) {
    return (
      <div className="card-surface rounded-[24px] p-8 text-center space-y-3">
        <p className="text-sm font-medium text-[#1C2B25]">
          Operational metrics could not be retrieved.
        </p>
        <button
          type="button"
          onClick={loadData}
          className="btn-press px-5 py-2.5 text-xs font-semibold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full"
        >
          Retry Loading Metrics
        </button>
      </div>
    );
  }

  const isViewingToday = activeDate === overview.todayDate;
  const sortedDayAppointments = [...dayAppointments].sort((a, b) =>
    a.appointmentTime.localeCompare(b.appointmentTime)
  );
  const firstName = formatGreetingName(actorName);
  const rowPad = compactDensity ? 'py-2.5 px-4' : 'py-3.5 px-5';

  const alertsList = [
    {
      id: 'unconfirmed',
      tone: daily.unconfirmedAppointments > 0 ? 'amber' : 'emerald',
      icon: Clock,
      message:
        daily.unconfirmedAppointments > 0
          ? `${daily.unconfirmedAppointments} visit${daily.unconfirmedAppointments === 1 ? '' : 's'} on ${daily.date} still awaiting confirmation`
          : `All visits on ${daily.date} are confirmed`,
      detail:
        daily.unconfirmedAppointments > 0
          ? 'Review pending confirmation queue before clinic hours.'
          : 'Zero pending confirmation calls for selected day.',
      cta: 'Review',
      onClick: () =>
        navigateTarget({ tab: 'appointments', status: 'Scheduled', date: activeDate }),
    },
    {
      id: 'overdue',
      tone: overview.overdueFollowUpsCount > 0 ? 'rose' : 'emerald',
      icon: AlertCircle,
      message:
        overview.overdueFollowUpsCount > 0
          ? `${overview.overdueFollowUpsCount} overdue follow-up task${overview.overdueFollowUpsCount === 1 ? '' : 's'} past due`
          : 'No overdue follow-up tasks',
      detail: `${overview.pendingFollowUpsCount} open tasks · ${overview.highPriorityFollowUpsCount} high priority`,
      cta: 'Open Queue',
      onClick: () =>
        navigateTarget({
          tab: 'followups',
          followUpView: overview.overdueFollowUpsCount > 0 ? 'overdue' : 'pending',
        }),
    },
    {
      id: 'missed',
      tone: overview.missedLastSevenDaysCount > 0 ? 'rose' : 'sky',
      icon: CalendarClock,
      message:
        overview.missedLastSevenDaysCount > 0
          ? `${overview.missedLastSevenDaysCount} missed visit${overview.missedLastSevenDaysCount === 1 ? '' : 's'} in the last 7 days`
          : 'Zero missed visits over the past 7 days',
      detail: 'Triage rescheduling outreach directly with CareDesk Assistant.',
      cta: 'Triage',
      onClick: () =>
        onLaunchAssistantPrompt
          ? onLaunchAssistantPrompt('Identify patients who missed appointments during the last seven days.')
          : onNavigate('assistant'),
    },
  ] as const;

  return (
    <div className="space-y-5 animate-view-enter">
      {/* 1. Forest-to-Emerald Welcome Banner */}
      <section
        aria-label="Daily operations briefing banner"
        className="rounded-[24px] bg-gradient-to-br from-[#0F3D2E] via-[#13513D] to-[#268B67] text-white p-6 sm:p-7 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 overflow-hidden relative"
      >
        <div className="space-y-3 max-w-xl relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-[11px] font-semibold text-[#DDF8ED]">
            <span>{isViewingToday ? "Today's Operations" : `Focus Date · ${activeDate}`}</span>
          </div>

          <h2 className="text-2xl sm:text-[28px] font-bold tracking-tight leading-tight text-balance">
            {getGreetingPrefix()}, {firstName}
          </h2>

          <p className="text-sm text-emerald-50/90 leading-relaxed">
            You have{' '}
            <span className="font-mono font-bold text-white tabular-nums">
              {daily.totalAppointments}
            </span>{' '}
            appointment{daily.totalAppointments === 1 ? '' : 's'} and{' '}
            <span className="font-mono font-bold text-[#A7F3D0] tabular-nums">
              {overview.overdueFollowUpsCount}
            </span>{' '}
            overdue follow-up{overview.overdueFollowUpsCount === 1 ? '' : 's'}{' '}
            {isViewingToday ? 'today' : `on ${daily.date}`}.
          </p>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() =>
                onQuickScheduleAppointment
                  ? onQuickScheduleAppointment()
                  : navigateTarget({ tab: 'appointments', date: activeDate })
              }
              className="btn-press min-h-[44px] sm:min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold bg-[#34C38F] text-[#0F3D2E] hover:bg-[#49d39f] shadow-xs whitespace-nowrap"
            >
              <CalendarIcon className="w-3.5 h-3.5" aria-hidden="true" />
              Schedule Appointment
            </button>
            <button
              type="button"
              onClick={() =>
                onQuickRegisterPatient
                  ? onQuickRegisterPatient()
                  : navigateTarget({ tab: 'patients', status: 'All' })
              }
              className="btn-press min-h-[44px] sm:min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold bg-white/15 hover:bg-white/25 text-white whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              Register Patient
            </button>
          </div>
        </div>

        <div className="hidden sm:flex items-center justify-end relative z-10">
          <WelcomeBannerMotif />
        </div>
      </section>

      {/* 2. 5 Compact KPI Cards with Pastel Icon Chips */}
      <section aria-label="Operational Key Metrics">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 2xl:gap-3.5">
          {/* Today's Appointments */}
          <button
            type="button"
            data-testid="kpi-total-appointments"
            onClick={() =>
              navigateTarget({ tab: 'appointments', date: activeDate, status: 'All' })
            }
            className="btn-press card-surface card-interactive text-left rounded-[22px] p-3.5 sm:p-4 2xl:p-5 flex flex-col justify-between gap-3 min-w-0"
          >
            <div className="flex items-start justify-between gap-2 w-full min-w-0">
              <span className="text-[12px] 2xl:text-[12.5px] font-medium text-[#6B7B73] leading-snug min-w-0">
                {isViewingToday ? "Today's Appointments" : `Visits (${activeDate.slice(5)})`}
              </span>
              <span className="w-8 h-8 2xl:w-9 2xl:h-9 rounded-xl 2xl:rounded-2xl bg-[#E6F7EF] text-[#137A55] flex items-center justify-center shrink-0">
                <CalendarIcon className="w-4 h-4" aria-hidden="true" />
              </span>
            </div>
            <div>
              <div className="text-[28px] 2xl:text-[30px] leading-none font-bold font-mono tabular-nums text-[#1C2B25]">
                {daily.totalAppointments}
              </div>
              <div className="text-[11px] text-[#6B7B73] mt-1.5 truncate">
                {daily.confirmedAppointments} confirmed
              </div>
            </div>
          </button>

          {/* Unconfirmed */}
          <button
            type="button"
            data-testid="kpi-confirmed-appointments"
            onClick={() =>
              navigateTarget({ tab: 'appointments', date: activeDate, status: 'Scheduled' })
            }
            className="btn-press card-surface card-interactive text-left rounded-[22px] p-3.5 sm:p-4 2xl:p-5 flex flex-col justify-between gap-3 min-w-0"
          >
            <div className="flex items-start justify-between gap-2 w-full min-w-0">
              <span className="text-[12px] 2xl:text-[12.5px] font-medium text-[#6B7B73] leading-snug min-w-0">
                Unconfirmed
              </span>
              <span className="w-8 h-8 2xl:w-9 2xl:h-9 rounded-xl 2xl:rounded-2xl bg-[#FFF2E5] text-[#C26A1B] flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" aria-hidden="true" />
              </span>
            </div>
            <div>
              <div className="text-[28px] 2xl:text-[30px] leading-none font-bold font-mono tabular-nums text-[#1C2B25]">
                {daily.unconfirmedAppointments}
              </div>
              <div className="text-[11px] text-[#6B7B73] mt-1.5 truncate">Pending outreach</div>
            </div>
          </button>

          {/* Missed (7 days) */}
          <button
            type="button"
            data-testid="kpi-missed-appointments"
            onClick={() => navigateTarget({ tab: 'appointments', status: 'Missed', date: '' })}
            className="btn-press card-surface card-interactive text-left rounded-[22px] p-3.5 sm:p-4 2xl:p-5 flex flex-col justify-between gap-3 min-w-0"
          >
            <div className="flex items-start justify-between gap-2 w-full min-w-0">
              <span className="text-[12px] 2xl:text-[12.5px] font-medium text-[#6B7B73] leading-snug min-w-0">
                Missed (7 days)
              </span>
              <span className="w-8 h-8 2xl:w-9 2xl:h-9 rounded-xl 2xl:rounded-2xl bg-[#FFEAF0] text-[#BE123C] flex items-center justify-center shrink-0">
                <AlertCircle className="w-4 h-4" aria-hidden="true" />
              </span>
            </div>
            <div>
              <div className="text-[28px] 2xl:text-[30px] leading-none font-bold font-mono tabular-nums text-[#1C2B25]">
                {overview.missedLastSevenDaysCount}
              </div>
              <div className="text-[11px] text-[#6B7B73] mt-1.5 truncate">Eligible to rebook</div>
            </div>
          </button>

          {/* Overdue Follow-ups */}
          <button
            type="button"
            data-testid="kpi-pending-followups"
            onClick={() =>
              navigateTarget({
                tab: 'followups',
                followUpView: overview.overdueFollowUpsCount > 0 ? 'overdue' : 'pending',
              })
            }
            className="btn-press card-surface card-interactive text-left rounded-[22px] p-3.5 sm:p-4 2xl:p-5 flex flex-col justify-between gap-3 min-w-0"
          >
            <div className="flex items-start justify-between gap-2 w-full min-w-0">
              <span className="text-[12px] 2xl:text-[12.5px] font-medium text-[#6B7B73] leading-snug min-w-0">
                Overdue Follow-ups
              </span>
              <span className="w-8 h-8 2xl:w-9 2xl:h-9 rounded-xl 2xl:rounded-2xl bg-[#F2ECFC] text-[#6D28D9] flex items-center justify-center shrink-0">
                <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
              </span>
            </div>
            <div>
              <div className="text-[28px] 2xl:text-[30px] leading-none font-bold font-mono tabular-nums text-[#1C2B25]">
                {overview.overdueFollowUpsCount}
              </div>
              <div className="text-[11px] text-[#6B7B73] mt-1.5 truncate">
                {overview.pendingFollowUpsCount} total open
              </div>
            </div>
          </button>

          {/* New Patients */}
          <button
            type="button"
            data-testid="kpi-total-patients"
            onClick={() => navigateTarget({ tab: 'patients', status: 'All' })}
            className="col-span-2 sm:col-span-1 btn-press card-surface card-interactive text-left rounded-[22px] p-3.5 sm:p-4 2xl:p-5 flex flex-col justify-between gap-3 min-w-0"
          >
            <div className="flex items-start justify-between gap-2 w-full min-w-0">
              <span className="text-[12px] 2xl:text-[12.5px] font-medium text-[#6B7B73] leading-snug min-w-0">
                New Patients
              </span>
              <span className="w-8 h-8 2xl:w-9 2xl:h-9 rounded-xl 2xl:rounded-2xl bg-[#E7F3FD] text-[#0369A1] flex items-center justify-center shrink-0">
                <Users className="w-4 h-4" aria-hidden="true" />
              </span>
            </div>
            <div>
              <div className="text-[28px] 2xl:text-[30px] leading-none font-bold font-mono tabular-nums text-[#1C2B25]">
                {newPatientsCount}
              </div>
              <div className="text-[11px] text-[#6B7B73] mt-1.5 truncate">
                {newPatientsPeriodLabel} · {overview.totalPatients} total
              </div>
            </div>
          </button>
        </div>
      </section>

      {/* 3. Main Chart Card (DualSeriesAreaChart + Segmented Filter Pills + Left Stat Tiles) */}
      <section className="card-surface rounded-[24px] p-4 sm:p-6 min-w-0 overflow-hidden">
        <div className="flex items-center justify-end gap-2 mb-1">
          <button
            type="button"
            onClick={loadData}
            className="btn-press min-h-[44px] sm:min-h-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold text-[#6B7B73] hover:text-[#1C2B25] bg-[#FAFBF9] border border-[#DCE8E0]"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            Sync
          </button>
        </div>

        <DualSeriesAreaChart
          dailyTrend={overview.dailyTrend}
          appointments={allAppointments}
          todayDate={overview.todayDate}
          activeDate={activeDate}
          onSelectDate={handleSelectDate}
        />
      </section>

      {/* 4. Unequal Lower Row: Today's Appointments (7 cols) & Operational Alerts (5 cols) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Today's Appointments */}
        <div className="lg:col-span-7 min-w-0 card-surface rounded-[24px] overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-[#EEF3EF] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-[#1C2B25]">
                {isViewingToday ? "Today's Appointments" : `Schedule · ${activeDate}`}
              </h3>
              <p className="text-xs text-[#6B7B73] mt-0.5">
                {sortedDayAppointments.length} visit
                {sortedDayAppointments.length === 1 ? '' : 's'} scheduled
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                navigateTarget({ tab: 'appointments', date: activeDate, status: 'All' })
              }
              className="min-h-[44px] sm:min-h-0 px-3.5 py-1.5 rounded-full text-xs font-semibold text-[#0F3D2E] bg-[#EEF3EF] hover:bg-[#DCE8E0] transition-colors whitespace-nowrap"
            >
              View Calendar
            </button>
          </div>

          {sortedDayAppointments.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <ClinicEmptyIllustration variant="appointments" />
              <p className="text-sm font-medium text-[#1C2B25]">
                No appointments scheduled for {activeDate}.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#EEF3EF] max-h-[380px] overflow-y-auto">
              {sortedDayAppointments.map((apt) => (
                <div
                  key={apt.id}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    navigateTarget({
                      tab: 'appointments',
                      date: apt.appointmentDate,
                      status: 'All',
                      appointmentId: apt.id,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigateTarget({
                        tab: 'appointments',
                        date: apt.appointmentDate,
                        status: 'All',
                        appointmentId: apt.id,
                      });
                    }
                  }}
                  className={`${rowPad} flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 sm:gap-3 hover:bg-[#F7FAF8] transition-colors cursor-pointer`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1 basis-[200px]">
                    <EditorialAvatar
                      name={apt.patientName ?? apt.patientId}
                      role="patient"
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[#1C2B25] truncate">
                        {apt.patientName ?? apt.patientId}
                      </div>
                      <div className="text-xs text-[#6B7B73] truncate mt-0.5">
                        {apt.department} · {apt.clinician}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 ml-auto">
                    <span className="font-mono text-xs font-semibold text-[#1C2B25] tabular-nums">
                      {apt.appointmentTime}
                    </span>
                    <AppointmentStatusText status={apt.status} />
                    {apt.status === 'Scheduled' && (
                      <button
                        type="button"
                        disabled={updatingId === apt.id}
                        onClick={(e) => handleQuickConfirm(e, apt.id)}
                        aria-label={`Confirm appointment ${apt.id}`}
                        className="btn-press min-h-[44px] sm:min-h-0 inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-semibold text-[#0F3D2E] bg-[#DDF5E9] hover:bg-[#BCEAD4] disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" aria-hidden="true" />
                        Confirm
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Operational Alerts & Duty Summary */}
        <div className="lg:col-span-5 min-w-0 space-y-5">
          <div className="card-surface rounded-[24px] p-4 sm:p-5 space-y-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#1C2B25]">Operational Alerts</h3>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="min-h-[44px] sm:min-h-0 inline-flex items-center px-2 sm:px-0 text-xs font-semibold text-[#137A55] hover:text-[#0F3D2E]"
              >
                Reports
              </button>
            </div>

            <div className="space-y-2.5">
              {alertsList.map((alert) => {
                const Icon = alert.icon;
                const toneClass =
                  alert.tone === 'amber'
                    ? 'bg-[#FFF5E8] text-[#B45309]'
                    : alert.tone === 'rose'
                      ? 'bg-[#FFECF0] text-[#BE123C]'
                      : alert.tone === 'sky'
                        ? 'bg-[#E9F4FC] text-[#0369A1]'
                        : 'bg-[#E6F7EF] text-[#137A55]';

                return (
                  <div
                    key={alert.id}
                    className="p-3.5 rounded-[18px] bg-[#FAFBF9] border border-[#DCE8E0] flex flex-wrap sm:flex-nowrap items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${toneClass}`}
                      >
                        <Icon className="w-4 h-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#1C2B25] leading-snug">
                          {alert.message}
                        </div>
                        <div className="text-[11px] text-[#6B7B73] mt-0.5 leading-snug">
                          {alert.detail}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={alert.onClick}
                      className="btn-press min-h-[44px] sm:min-h-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-white border border-[#DCE8E0] text-[#0F3D2E] hover:bg-[#EEF3EF] shrink-0 ml-auto"
                    >
                      {alert.cta}
                      <ArrowRight className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {doctorAvailability.length > 0 && (
            <div className="card-surface rounded-[24px] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-[#137A55]" aria-hidden="true" />
                  <h3 className="text-sm font-bold text-[#1C2B25]">Clinicians on Duty</h3>
                </div>
                <button
                  type="button"
                  onClick={() => navigateTarget({ tab: 'staff' })}
                  className="min-h-[44px] sm:min-h-0 inline-flex items-center px-2 sm:px-0 text-xs font-semibold text-[#137A55] hover:underline"
                >
                  Roster
                </button>
              </div>
              <div className="space-y-2">
                {doctorAvailability.slice(0, 3).map((doc) => (
                  <div
                    key={doc.staffId}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-2xl bg-[#FAFBF9] border border-[#EEF3EF] text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <EditorialAvatar name={doc.fullName} role="clinician" size="xs" />
                      <div className="min-w-0">
                        <div className="font-semibold text-[#1C2B25] truncate">{doc.fullName}</div>
                        <div className="text-[11px] text-[#6B7B73] truncate">
                          {doc.department} · {doc.bookedCount}/{doc.maxDailyCapacity} load
                        </div>
                      </div>
                    </div>
                    <DoctorDutyStatusText status={doc.effectiveOperationalState} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
