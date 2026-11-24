import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  fetchAppointments,
  fetchDailyReport,
  fetchOverviewReport,
  updateAppointmentRecord,
} from '../client/api';
import type { Appointment, DailyReport, OverviewReport } from '../shared/types';
import { ClinicCalendar } from './ClinicCalendar';
import { AppointmentStatusText } from './StatusText';

export interface DashboardFilteredTarget {
  tab: 'assistant' | 'patients' | 'appointments' | 'followups' | 'reports';
  status?: string;
  date?: string;
  followUpView?: 'pending' | 'overdue' | 'Completed' | 'all';
  appointmentId?: string;
}

interface DashboardViewProps {
  onNavigate: (
    tab: 'assistant' | 'patients' | 'appointments' | 'followups' | 'reports'
  ) => void;
  onNavigateToFiltered?: (target: DashboardFilteredTarget) => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  refreshSignal: number;
  compactDensity?: boolean;
}

function getLocalTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DashboardView({
  onNavigate,
  onNavigateToFiltered,
  onErrorNotice,
  onSuccessNotice,
  refreshSignal,
  compactDensity = false,
}: DashboardViewProps) {
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [overview, setOverview] = useState<OverviewReport | null>(null);
  const [activeDate, setActiveDate] = useState<string>(getLocalTodayKey);
  const [calendarDayAppointments, setCalendarDayAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dailyData, overviewData, dayApts] = await Promise.all([
        fetchDailyReport(activeDate),
        fetchOverviewReport(),
        fetchAppointments({ date: activeDate }),
      ]);
      setDaily(dailyData);
      setOverview(overviewData);
      setCalendarDayAppointments(dayApts);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load dashboard metrics.');
    } finally {
      setLoading(false);
    }
  }, [activeDate, onErrorNotice]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshSignal]);

  const handleSelectDate = (date: string) => {
    if (!date) return;
    setActiveDate(date);
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
      onSuccessNotice(`Appointment ${appointmentId} marked as Confirmed.`);
      await loadData();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to confirm appointment.');
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading && !daily) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading operations dashboard">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={idx} className="h-28 bg-white border border-[#E4E7E2] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-80 bg-white border border-[#E4E7E2] rounded-xl animate-pulse" />
          <div className="h-80 bg-white border border-[#E4E7E2] rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (!daily || !overview) {
    return (
      <div className="bg-white border border-[#E4E7E2] rounded-xl p-8 text-center">
        <p className="text-sm text-[#526058] mb-4">Operational metrics could not be retrieved.</p>
        <button
          type="button"
          onClick={loadData}
          className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors"
        >
          Retry Loading Metrics
        </button>
      </div>
    );
  }

  const maxTrendTotal = Math.max(1, ...overview.dailyTrend.map((d) => d.total));
  const maxRegCount = Math.max(1, ...overview.patientRegistrationTrend.map((r) => r.count));
  const totalWindowApts = Math.max(1, overview.totalAppointmentsInWindow);
  const deltaVsYesterday = overview.todayTotalAppointments - overview.yesterdayTotalAppointments;
  const isViewingToday = activeDate === overview.todayDate;

  const kpis: Array<{
    id: string;
    label: string;
    value: number;
    icon: typeof Users;
    description: string;
    trend: string;
    accentClass: string;
    iconBg: string;
    target: DashboardFilteredTarget;
  }> = [
    {
      id: 'kpi-total-patients',
      label: 'Total Patients',
      value: overview.totalPatients,
      icon: Users,
      description: `${overview.activePatients} active patient records`,
      trend: 'View directory →',
      accentClass: 'text-[#0C291E]',
      iconBg: 'bg-[#EDF4F0] text-[#047857]',
      target: { tab: 'patients', status: 'All' },
    },
    {
      id: 'kpi-total-appointments',
      label: isViewingToday ? "Today's Appointments" : `Appointments (${activeDate.slice(5)})`,
      value: daily.totalAppointments,
      icon: CalendarIcon,
      description: `${daily.upcomingAppointments.length} remaining · ${daily.completedAppointments} done`,
      trend: isViewingToday
        ? deltaVsYesterday === 0
          ? 'Same as yesterday'
          : `${deltaVsYesterday > 0 ? '+' : ''}${deltaVsYesterday} vs yesterday`
        : `Date ${activeDate} →`,
      accentClass: 'text-[#0C291E]',
      iconBg: 'bg-[#EDF4F0] text-[#047857]',
      target: { tab: 'appointments', date: activeDate, status: 'All' },
    },
    {
      id: 'kpi-confirmed-appointments',
      label: 'Confirmed Appointments',
      value: daily.confirmedAppointments,
      icon: CheckCircle2,
      description: `${daily.unconfirmedAppointments} awaiting confirmation`,
      trend:
        daily.totalAppointments > 0
          ? `${Math.round((daily.confirmedAppointments / daily.totalAppointments) * 100)}% of ${isViewingToday ? 'today' : activeDate.slice(5)}`
          : '0% confirmed',
      accentClass: 'text-[#047857]',
      iconBg: 'bg-emerald-50 text-[#059669]',
      target: { tab: 'appointments', date: activeDate, status: 'Confirmed' },
    },
    {
      id: 'kpi-pending-followups',
      label: 'Pending Follow-ups',
      value: overview.pendingFollowUpsCount,
      icon: ClipboardList,
      description: `${overview.highPriorityFollowUpsCount} high priority tasks`,
      trend:
        overview.overdueFollowUpsCount > 0
          ? `${overview.overdueFollowUpsCount} overdue`
          : 'None overdue',
      accentClass: 'text-[#16211C]',
      iconBg: 'bg-amber-50 text-amber-700',
      target: { tab: 'followups', followUpView: 'pending' },
    },
    {
      id: 'kpi-missed-appointments',
      label: 'Missed Appointments',
      value: overview.missedLastSevenDaysCount,
      icon: AlertTriangle,
      description: `${daily.missedAppointments} missed on ${activeDate.slice(5)}`,
      trend: 'Last 7 days window →',
      accentClass: overview.missedLastSevenDaysCount > 0 ? 'text-red-700' : 'text-[#047857]',
      iconBg: 'bg-red-50 text-red-700',
      target: { tab: 'appointments', status: 'Missed', date: '' },
    },
  ];

  const rowPad = compactDensity ? 'py-2 px-4' : 'py-3 px-4';

  return (
    <div className="space-y-6">
      {/* Copilot Banner */}
      <section className="bg-[#0C291E] text-white rounded-xl p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-emerald-300">
            CareDesk Operations Intelligence · Local REST Preview
          </p>
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-balance">
            Less time managing healthcare administration. More time delivering healthcare.
          </h2>
          <p className="text-xs sm:text-sm text-emerald-100/80">
            {daily.unconfirmedAppointments} unconfirmed visits on {daily.date}, {overview.overdueFollowUpsCount} overdue follow-ups, and {overview.missedLastSevenDaysCount} missed visits in the past 7 days need review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('assistant')}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#059669] hover:bg-[#047857] text-white rounded-lg transition-colors whitespace-nowrap shrink-0 self-start lg:self-auto"
        >
          Ask CareDesk Assistant
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </section>

      {/* Operations Date Filter Bar */}
      <div className="bg-white border border-[#E4E7E2] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-[#526058]">
          <CalendarIcon className="w-4 h-4 text-[#047857]" aria-hidden="true" />
          <span className="font-medium text-[#16211C]">Operations Date Focus:</span>
          <span className="font-mono text-[#0C291E] font-semibold">{activeDate}</span>
          {isViewingToday && (
            <span className="text-[11px] font-medium text-[#047857] bg-[#EDF4F0] px-2 py-0.5 rounded">
              Today
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <label htmlFor="dashboard-date-filter" className="text-xs text-[#526058]">
            Inspect Date:
          </label>
          <input
            id="dashboard-date-filter"
            type="date"
            value={activeDate}
            onChange={(e) => handleSelectDate(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-[#D4DAD4] rounded-lg bg-white"
          />
          {!isViewingToday && (
            <button
              type="button"
              onClick={() => setActiveDate(overview.todayDate)}
              className="px-2.5 py-1.5 text-xs font-medium text-[#047857] bg-[#EDF4F0] hover:bg-[#D7E6DD] rounded-lg transition-colors"
            >
              Reset to Today
            </button>
          )}
        </div>
      </div>

      {/* 5 Clickable Core KPI Cards */}
      <section aria-label="Operational Key Performance Indicators">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <button
                key={kpi.id}
                type="button"
                data-testid={kpi.id}
                onClick={() => navigateTarget(kpi.target)}
                className="text-left bg-white border border-[#E4E7E2] hover:border-[#059669] hover:bg-[#FAFDFB] rounded-xl p-4 flex flex-col justify-between transition-colors group"
              >
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="text-xs font-medium text-[#526058] group-hover:text-[#0C291E]">
                    {kpi.label}
                  </span>
                  <div className={`p-2 rounded-lg ${kpi.iconBg}`}>
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </div>
                </div>
                <div className={`text-2xl font-bold font-mono tabular-nums mt-3 ${kpi.accentClass}`}>
                  {kpi.value}
                </div>
                <div className="mt-2 pt-2 border-t border-[#F0F2EF] space-y-0.5 w-full">
                  <div className="text-xs text-[#16211C]">{kpi.description}</div>
                  <div className="text-[11px] font-mono text-[#526058] group-hover:text-[#047857]">
                    {kpi.trend}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Analytics Row: Appointment Trends + Status Distribution + Patient Registrations */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Appointment Trends */}
        <div className="lg:col-span-7 bg-white border border-[#E4E7E2] rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="text-base font-semibold text-[#16211C]">
                  Appointment Volume &amp; Status Trends
                </h3>
                <p className="text-xs text-[#526058] mt-0.5">
                  {overview.windowStart} to {overview.windowEnd} · Click any day bar to inspect schedule
                </p>
              </div>
              <button
                type="button"
                onClick={loadData}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#526058] hover:text-[#16211C] border border-[#E4E7E2] rounded-lg transition-colors whitespace-nowrap shrink-0"
                aria-label="Refresh operational analytics"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                Refresh
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-[#526058] mb-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#047857]" aria-hidden="true" />
                Completed / Confirmed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" aria-hidden="true" />
                Scheduled
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-600" aria-hidden="true" />
                Missed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-slate-300" aria-hidden="true" />
                Cancelled
              </span>
            </div>

            <div className="grid grid-cols-8 gap-2.5 items-end h-44 pt-2 border-b border-[#E4E7E2] pb-2">
              {overview.dailyTrend.map((day) => {
                const positive = day.completed + day.confirmed;
                const positiveH = Math.round((positive / maxTrendTotal) * 120);
                const schedH = Math.round((day.scheduled / maxTrendTotal) * 120);
                const missedH = Math.round((day.missed / maxTrendTotal) * 120);
                const cancelH = Math.round((day.cancelled / maxTrendTotal) * 120);
                const isSelected = day.date === activeDate;
                const isToday = day.date === overview.todayDate;

                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => handleSelectDate(day.date)}
                    className={`flex flex-col items-center gap-1.5 h-full justify-end rounded-md py-1 transition-colors ${
                      isSelected ? 'bg-[#EDF4F0]/80' : 'hover:bg-[#F7F8F6]'
                    }`}
                    title={`${day.date}: ${day.total} total (${day.confirmed} confirmed, ${day.scheduled} scheduled, ${day.missed} missed)`}
                    aria-label={`Inspect clinic operations for ${day.date} (${day.total} appointments)`}
                  >
                    <span className="text-xs font-mono tabular-nums text-[#526058]">
                      {day.total}
                    </span>
                    <div className="w-full max-w-[36px] flex flex-col-reverse rounded-sm overflow-hidden bg-[#F1F4F1]">
                      {positiveH > 0 && (
                        <div
                          style={{ height: `${positiveH}px` }}
                          className="bg-[#047857] w-full transition-all duration-300"
                        />
                      )}
                      {schedH > 0 && (
                        <div
                          style={{ height: `${schedH}px` }}
                          className="bg-amber-500 w-full transition-all duration-300"
                        />
                      )}
                      {missedH > 0 && (
                        <div
                          style={{ height: `${missedH}px` }}
                          className="bg-red-600 w-full transition-all duration-300"
                        />
                      )}
                      {cancelH > 0 && (
                        <div
                          style={{ height: `${cancelH}px` }}
                          className="bg-slate-300 w-full transition-all duration-300"
                        />
                      )}
                    </div>
                    <span
                      className={`text-[11px] font-mono tabular-nums ${
                        isSelected || isToday ? 'font-bold text-[#0C291E]' : 'text-[#526058]'
                      }`}
                    >
                      {day.date.slice(5)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status Distribution Horizontal Bar */}
          <div className="mt-5 pt-4 border-t border-[#E4E7E2] space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#16211C]">
                Status Distribution ({overview.totalAppointmentsInWindow} window visits)
              </span>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="font-medium text-[#047857] hover:text-[#0C291E]"
              >
                View Full Reports
              </button>
            </div>
            <div className="h-3 w-full rounded-full overflow-hidden flex bg-[#F1F4F1]">
              {(
                [
                  { key: 'Completed', color: 'bg-[#0C291E]' },
                  { key: 'Confirmed', color: 'bg-[#059669]' },
                  { key: 'Scheduled', color: 'bg-amber-500' },
                  { key: 'Missed', color: 'bg-red-600' },
                  { key: 'Cancelled', color: 'bg-slate-300' },
                ] as const
              ).map((seg) => {
                const count = overview.statusBreakdown[seg.key] ?? 0;
                const pct = (count / totalWindowApts) * 100;
                if (pct <= 0) return null;
                return (
                  <div
                    key={seg.key}
                    style={{ width: `${pct}%` }}
                    className={`${seg.color} h-full`}
                    title={`${seg.key}: ${count}`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#526058] font-mono tabular-nums">
              {(['Completed', 'Confirmed', 'Scheduled', 'Missed', 'Cancelled'] as const).map(
                (statusKey) => (
                  <button
                    key={statusKey}
                    type="button"
                    onClick={() =>
                      navigateTarget({ tab: 'appointments', status: statusKey, date: '' })
                    }
                    className="hover:text-[#047857] hover:underline"
                  >
                    {statusKey}: {overview.statusBreakdown[statusKey]}
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        {/* Patient Registration Trends & Operational Alerts */}
        <div className="lg:col-span-5 space-y-6">
          {/* Patient Registration Cohorts */}
          <div className="bg-white border border-[#E4E7E2] rounded-xl p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#16211C] flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                  Patient Registration Cohorts
                </h3>
                <p className="text-xs text-[#526058]">
                  Recent monthly registrations from database records
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigateTarget({ tab: 'patients', status: 'All' })}
                className="text-xs font-mono tabular-nums font-semibold text-[#047857] hover:underline"
              >
                {overview.totalPatients} total
              </button>
            </div>

            <div className="grid grid-cols-8 gap-2 items-end h-24 pt-2 border-b border-[#E4E7E2] pb-1.5">
              {overview.patientRegistrationTrend.map((cohort) => {
                const h = Math.max(8, Math.round((cohort.count / maxRegCount) * 64));
                return (
                  <div key={cohort.period} className="flex flex-col items-center gap-1">
                    <span className="text-[11px] font-mono tabular-nums text-[#526058]">
                      {cohort.count}
                    </span>
                    <div
                      style={{ height: `${h}px` }}
                      className="w-full max-w-[26px] bg-[#10B981]/80 hover:bg-[#059669] rounded-t-sm transition-colors"
                      title={`${cohort.period}: ${cohort.count} registered`}
                    />
                    <span className="text-[10px] font-mono text-[#526058]">
                      {cohort.period.slice(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Operational Alerts */}
          <div className="bg-white border border-[#E4E7E2] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#16211C]">Operational Alerts</h3>
              <span className="text-xs font-mono tabular-nums text-[#526058]">
                {daily.unconfirmedAppointments +
                  overview.overdueFollowUpsCount +
                  daily.missedAppointments}{' '}
                active
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <button
                type="button"
                onClick={() =>
                  navigateTarget({ tab: 'appointments', status: 'Scheduled', date: activeDate })
                }
                className="w-full text-left p-3 rounded-lg bg-amber-50/70 hover:bg-amber-50 border border-amber-200/80 flex items-center justify-between gap-3 transition-colors"
              >
                <div>
                  <div className="font-semibold text-amber-900">
                    {daily.unconfirmedAppointments} Unconfirmed Appointment
                    {daily.unconfirmedAppointments === 1 ? '' : 's'} ({daily.date})
                  </div>
                  <div className="text-amber-800/80 mt-0.5">
                    Pending patient attendance confirmation for {daily.date}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => navigateTarget({ tab: 'followups', followUpView: 'overdue' })}
                className="w-full text-left p-3 rounded-lg bg-red-50/60 hover:bg-red-50 border border-red-200/80 flex items-center justify-between gap-3 transition-colors"
              >
                <div>
                  <div className="font-semibold text-red-900">
                    {overview.overdueFollowUpsCount} Overdue Administrative Follow-up
                    {overview.overdueFollowUpsCount === 1 ? '' : 's'}
                  </div>
                  <div className="text-red-800/80 mt-0.5">
                    Tasks past due date requiring immediate outreach
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-red-700 shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('assistant')}
                className="w-full text-left p-3 rounded-lg bg-[#EDF4F0] hover:bg-[#E1EFE7] border border-[#C5DDD0] flex items-center justify-between gap-3 transition-colors"
              >
                <div>
                  <div className="font-semibold text-[#0C291E]">
                    {overview.missedLastSevenDaysCount} Missed Appointments (Last 7 Days)
                  </div>
                  <div className="text-[#3A5247] mt-0.5">
                    Prepare follow-up outreach or reschedule via CareDesk Assistant
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-[#047857] shrink-0" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Calendar + Selected Date / Today's Schedule + Daily Clinic Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Interactive Calendar */}
        <div className="lg:col-span-4 bg-white border border-[#E4E7E2] rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-[#16211C]">Clinic Schedule Calendar</h3>
            <p className="text-xs text-[#526058] mt-0.5">
              Select a date to inspect scheduled visits &amp; daily metrics
            </p>
          </div>
          <ClinicCalendar
            selectedDate={activeDate}
            onSelectDate={handleSelectDate}
            daySummaries={overview.calendarSummary}
            compact
          />
        </div>

        {/* Selected Date / Today's Appointments */}
        <div className="lg:col-span-5 bg-white border border-[#E4E7E2] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E4E7E2] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-[#16211C]">
                Appointments on <span className="font-mono">{activeDate}</span>
              </h3>
              <p className="text-xs text-[#526058] mt-0.5">
                {calendarDayAppointments.length} appointment
                {calendarDayAppointments.length === 1 ? '' : 's'} · Click a row to open details
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                navigateTarget({ tab: 'appointments', date: activeDate, status: 'All' })
              }
              className="text-xs font-medium text-[#047857] hover:text-[#0C291E] whitespace-nowrap shrink-0"
            >
              Manage All
            </button>
          </div>

          {calendarDayAppointments.length === 0 ? (
            <div className="p-8 text-center">
              <Clock className="w-7 h-7 text-slate-300 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm text-[#526058]">
                No appointments scheduled on {activeDate}.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E4E7E2] max-h-96 overflow-y-auto">
              {calendarDayAppointments.map((apt) => (
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
                  className={`${rowPad} flex flex-col gap-2 hover:bg-[#F7F8F6] transition-colors cursor-pointer focus:outline-none focus:bg-[#EDF4F0]/50`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs min-w-0">
                      <span className="font-mono tabular-nums font-semibold text-[#0C291E] shrink-0">
                        {apt.appointmentTime}
                      </span>
                      <span className="font-medium text-[#16211C] truncate">
                        {apt.patientName}
                      </span>
                      <span className="font-mono text-[#526058] whitespace-nowrap shrink-0">
                        · {apt.patientId} · {apt.id}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <AppointmentStatusText status={apt.status} />
                      {apt.status === 'Scheduled' && (
                        <button
                          type="button"
                          disabled={updatingId === apt.id}
                          onClick={(e) => handleQuickConfirm(e, apt.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-[#047857] bg-[#EDF4F0] hover:bg-[#D7E6DD] rounded-md transition-colors disabled:opacity-50"
                          aria-label={`Confirm appointment ${apt.id}`}
                        >
                          <Check className="w-3 h-3" aria-hidden="true" />
                          Confirm
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-[#526058] truncate">
                    {apt.department} · {apt.clinician}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Daily Clinic Activity */}
        <div className="lg:col-span-3 bg-white border border-[#E4E7E2] rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[#E4E7E2]">
            <h3 className="text-base font-semibold text-[#16211C]">Daily Clinic Activity</h3>
            <p className="text-xs text-[#526058] mt-0.5">Live administrative audit log</p>
          </div>
          <div className="divide-y divide-[#E4E7E2] max-h-96 overflow-y-auto">
            {overview.recentActivity.length === 0 ? (
              <p className="p-5 text-xs text-[#526058]">No recent activity recorded.</p>
            ) : (
              overview.recentActivity.map((entry) => (
                <div key={entry.id} className="px-4 py-3">
                  <p className="text-xs text-[#16211C] leading-relaxed">{entry.summary}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono text-[#526058]">
                    <span className="truncate max-w-[140px]">{entry.actor}</span>
                    <span aria-hidden="true">·</span>
                    <span>{entry.resourceId}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
