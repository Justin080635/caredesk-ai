import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Calendar as CalendarIcon,
  Check,
  ClipboardList,
  Clock,
  RefreshCw,
  Send,
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
import { CLINIC_CLINICIANS } from '../shared/constants';
import type {
  Appointment,
  DailyReport,
  DoctorAvailabilitySummary,
  OverviewReport,
} from '../shared/types';
import {
  AppointmentActivityChart,
  PatientCohortChart,
  StatusDonutChart,
} from './AnalyticsCharts';
import { ClinicCalendar } from './ClinicCalendar';
import {
  ClinicEmptyIllustration,
  DashboardOpsSpotIllustration,
  EditorialAvatar,
} from './ClinicIllustrations';
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

const QUICK_ASSISTANT_PROMPTS = [
  "Give me today's clinic briefing.",
  'Which appointments are still unconfirmed?',
  'Identify patients who missed appointments during the last seven days.',
  'Find the next available appointment slot.',
];

export function DashboardView({
  onNavigate,
  onNavigateToFiltered,
  onQuickRegisterPatient,
  onQuickScheduleAppointment,
  onLaunchAssistantPrompt,
  actorName = 'Clinic Administrator',
  onErrorNotice,
  onSuccessNotice,
  refreshSignal,
  compactDensity = false,
}: DashboardViewProps) {
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [overview, setOverview] = useState<OverviewReport | null>(null);
  const [calendarDayAppointments, setCalendarDayAppointments] = useState<Appointment[]>([]);
  const [doctorAvailability, setDoctorAvailability] = useState<DoctorAvailabilitySummary[]>([]);
  const [activeDate, setActiveDate] = useState<string>(getLocalTodayKey);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [assistantQuickInput, setAssistantQuickInput] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dailyData, overviewData, dayApts, docAvail] = await Promise.all([
        fetchDailyReport(activeDate),
        fetchOverviewReport(),
        fetchAppointments({ date: activeDate }),
        fetchDoctorAvailability({ date: activeDate }).catch(() => []),
      ]);
      setDaily(dailyData);
      setOverview(overviewData);
      setCalendarDayAppointments(dayApts);
      setDoctorAvailability(docAvail);
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

  const handleQuickAssistantSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = assistantQuickInput.trim();
    if (!trimmed) return;
    if (onLaunchAssistantPrompt) {
      onLaunchAssistantPrompt(trimmed);
    } else {
      onNavigate('assistant');
    }
  };

  const activeCliniciansToday = useMemo(() => {
    const names = new Set<string>();
    for (const apt of calendarDayAppointments) {
      if (apt.status !== 'Cancelled' && apt.clinician) {
        names.add(apt.clinician);
      }
    }
    return Array.from(names);
  }, [calendarDayAppointments]);

  if (loading && !daily) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading operations dashboard">
        <div className="h-20 bg-white border border-[#E3E8E4] rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-36 bg-white border border-[#E3E8E4] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-80 bg-white border border-[#E3E8E4] rounded-xl animate-pulse" />
          <div className="lg:col-span-5 h-80 bg-white border border-[#E3E8E4] rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (!daily || !overview) {
    return (
      <div className="card-surface rounded-xl p-8 text-center">
        <p className="text-sm text-[#526259] mb-4">Operational metrics could not be retrieved.</p>
        <button
          type="button"
          onClick={loadData}
          className="btn-press px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg"
        >
          Retry Loading Metrics
        </button>
      </div>
    );
  }

  const deltaVsYesterday = overview.todayTotalAppointments - overview.yesterdayTotalAppointments;
  const isViewingToday = activeDate === overview.todayDate;
  const confirmationPct =
    daily.totalAppointments > 0
      ? Math.round((daily.confirmedAppointments / daily.totalAppointments) * 100)
      : 0;
  const completionPct =
    daily.totalAppointments > 0
      ? Math.round(
          ((daily.confirmedAppointments + daily.completedAppointments) / daily.totalAppointments) *
            100
        )
      : 0;
  const activePatientPct =
    overview.totalPatients > 0
      ? Math.round((overview.activePatients / overview.totalPatients) * 100)
      : 0;

  const rowPad = compactDensity ? 'py-2.5 px-4' : 'py-3.5 px-5';

  return (
    <div className="space-y-6">
      {/* Section 1: Contextual Welcome Header & Command Actions */}
      <section className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 pb-1">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#526259]">
            <span className="font-medium text-[#047857]">Facility Operations Overview</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{daily.date}</span>
            {isViewingToday && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#111C17] font-medium">Today&apos;s Live Schedule</span>
              </>
            )}
          </div>
          <h2 className="text-2xl sm:text-[26px] font-bold tracking-tight text-[#111C17] text-balance">
            {getGreetingPrefix()}, {actorName}
          </h2>
          <p className="text-sm text-[#526259] max-w-3xl">
            {daily.totalAppointments} appointment{daily.totalAppointments === 1 ? '' : 's'} on{' '}
            <span className="font-mono text-[#111C17] font-medium">{daily.date}</span>
            <span aria-hidden="true"> · </span>
            {daily.unconfirmedAppointments} awaiting confirmation
            <span aria-hidden="true"> · </span>
            {overview.overdueFollowUpsCount} overdue follow-up{overview.overdueFollowUpsCount === 1 ? '' : 's'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-[#E3E8E4] rounded-lg">
            <label htmlFor="dashboard-date-filter" className="text-xs font-medium text-[#526259]">
              Focus Date
            </label>
            <input
              id="dashboard-date-filter"
              type="date"
              value={activeDate}
              onChange={(e) => handleSelectDate(e.target.value)}
              className="text-xs font-mono text-[#111C17] bg-transparent border-0 p-0 focus:outline-none"
            />
            {!isViewingToday && (
              <button
                type="button"
                onClick={() => setActiveDate(overview.todayDate)}
                className="text-[11px] font-medium text-[#047857] hover:underline whitespace-nowrap"
              >
                Today
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              onQuickRegisterPatient
                ? onQuickRegisterPatient()
                : navigateTarget({ tab: 'patients', status: 'All' })
            }
            className="btn-press inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium text-[#0B261C] bg-white hover:bg-[#ECF4EF] border border-[#D4E4DA] rounded-lg whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4 text-[#047857]" aria-hidden="true" />
            Register Patient
          </button>

          <button
            type="button"
            onClick={() =>
              onQuickScheduleAppointment
                ? onQuickScheduleAppointment()
                : navigateTarget({ tab: 'appointments', date: activeDate })
            }
            className="btn-press inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium text-white bg-[#0B261C] hover:bg-[#12382A] rounded-lg whitespace-nowrap shrink-0"
          >
            <CalendarIcon className="w-4 h-4 text-emerald-300" aria-hidden="true" />
            New Appointment
          </button>
        </div>
      </section>

      {/* Section 2: 4 Core Operational KPI Cards */}
      <section aria-label="Operational Key Performance Indicators">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Today's Appointments (Focal Anchor Card) */}
          <button
            type="button"
            data-testid="kpi-total-appointments"
            onClick={() =>
              navigateTarget({ tab: 'appointments', date: activeDate, status: 'All' })
            }
            className="btn-press text-left bg-[#0B261C] hover:bg-[#12382A] text-white rounded-xl p-5 flex flex-col justify-between transition-colors group shadow-xs"
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <span className="text-xs font-medium text-emerald-100/85">
                {isViewingToday ? "Today's Appointments" : `Appointments (${activeDate.slice(5)})`}
              </span>
              <ArrowUpRight
                className="w-4 h-4 text-emerald-300 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                aria-hidden="true"
              />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums text-white">
                {daily.totalAppointments}
              </span>
              <span className="text-[11px] font-mono text-emerald-300">
                {isViewingToday
                  ? deltaVsYesterday === 0
                    ? 'Same vs yesterday'
                    : `${deltaVsYesterday > 0 ? '+' : ''}${deltaVsYesterday} vs yesterday`
                  : `${daily.confirmedAppointments} confirmed`}
              </span>
            </div>
            <div className="mt-3.5 space-y-1.5 w-full">
              <div className="h-1.5 w-full rounded-full bg-white/15 overflow-hidden">
                <div
                  style={{ transform: `scaleX(${Math.max(0, Math.min(100, completionPct)) / 100})` }}
                  className="h-full w-full origin-left rounded-full bg-emerald-400 transition-transform duration-300 ease-out"
                />
              </div>
              <div className="text-[11px] text-emerald-100/80 flex items-center justify-between">
                <span>{daily.upcomingAppointments.length} remaining</span>
                <span>{daily.completedAppointments} completed</span>
              </div>
            </div>
          </button>

          {/* 2. Total Patients */}
          <button
            type="button"
            data-testid="kpi-total-patients"
            onClick={() => navigateTarget({ tab: 'patients', status: 'All' })}
            className="btn-press card-interactive text-left card-surface rounded-xl p-5 flex flex-col justify-between group"
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <span className="text-xs font-medium text-[#526259] group-hover:text-[#0B261C]">
                Total Patients
              </span>
              <div className="w-7 h-7 rounded-lg bg-[#ECF4EF] text-[#047857] flex items-center justify-center">
                <Users className="w-4 h-4" aria-hidden="true" />
              </div>
            </div>
            <div className="mt-2.5 flex items-baseline justify-between gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums text-[#111C17]">
                {overview.totalPatients}
              </span>
              <span className="text-[11px] font-mono tabular-nums text-[#047857]">
                {activePatientPct}% active
              </span>
            </div>
            <div className="mt-3.5 pt-2.5 border-t border-[#EFF3F0] w-full flex items-center justify-between text-[11px]">
              <span className="text-[#34433B]">{overview.activePatients} active profiles</span>
              <span className="font-mono text-[#047857] group-hover:underline">Directory →</span>
            </div>
          </button>

          {/* 3. Pending Follow-ups */}
          <button
            type="button"
            data-testid="kpi-pending-followups"
            onClick={() => navigateTarget({ tab: 'followups', followUpView: 'pending' })}
            className="btn-press card-interactive text-left card-surface rounded-xl p-5 flex flex-col justify-between group"
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <span className="text-xs font-medium text-[#526259] group-hover:text-[#0B261C]">
                Pending Follow-ups
              </span>
              <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
                <ClipboardList className="w-4 h-4" aria-hidden="true" />
              </div>
            </div>
            <div className="mt-2.5 flex items-baseline justify-between gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums text-[#111C17]">
                {overview.pendingFollowUpsCount}
              </span>
              <span
                className={`text-[11px] font-mono tabular-nums ${
                  overview.overdueFollowUpsCount > 0 ? 'text-red-700 font-semibold' : 'text-[#526259]'
                }`}
              >
                {overview.overdueFollowUpsCount} overdue
              </span>
            </div>
            <div className="mt-3.5 pt-2.5 border-t border-[#EFF3F0] w-full flex items-center justify-between text-[11px]">
              <span className="text-[#34433B]">
                {overview.highPriorityFollowUpsCount} high priority
              </span>
              <span className="font-mono text-[#047857] group-hover:underline">Open Queue →</span>
            </div>
          </button>

          {/* 4. Staff on Duty (derived from real clinicians scheduled on activeDate) */}
          <button
            type="button"
            data-testid="kpi-staff-on-duty"
            onClick={() => navigateTarget({ tab: 'staff' })}
            className="btn-press card-interactive text-left card-surface rounded-xl p-5 flex flex-col justify-between group"
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <span className="text-xs font-medium text-[#526259] group-hover:text-[#0B261C]">
                Staff on Duty
              </span>
              <div className="w-7 h-7 rounded-lg bg-[#ECF4EF] text-[#047857] flex items-center justify-center">
                <Stethoscope className="w-4 h-4" aria-hidden="true" />
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums text-[#111C17]">
                {doctorAvailability.length > 0
                  ? doctorAvailability.filter((d) => d.isBookableOnDate).length
                  : activeCliniciansToday.length}
                <span className="text-sm font-normal text-[#526259]">
                  /{doctorAvailability.length > 0 ? doctorAvailability.length : CLINIC_CLINICIANS.length}
                </span>
              </span>
              <div className="flex -space-x-1.5" aria-hidden="true">
                {(doctorAvailability.length > 0
                  ? doctorAvailability.filter((d) => d.isBookableOnDate).map((d) => d.fullName)
                  : activeCliniciansToday
                )
                  .slice(0, 4)
                  .map((name) => (
                    <EditorialAvatar key={name} name={name} role="clinician" size="xs" />
                  ))}
              </div>
            </div>
            <div className="mt-3.5 pt-2.5 border-t border-[#EFF3F0] w-full flex items-center justify-between text-[11px]">
              <span className="text-[#34433B] truncate max-w-[165px]">
                {doctorAvailability.length > 0
                  ? doctorAvailability
                      .filter((d) => d.isBookableOnDate)
                      .slice(0, 2)
                      .map((d) => d.fullName)
                      .join(', ') || 'No clinicians bookable'
                  : activeCliniciansToday.length > 0
                    ? activeCliniciansToday.slice(0, 2).join(', ')
                    : 'No clinicians scheduled'}
              </span>
              <span className="font-mono text-[#047857] group-hover:underline shrink-0">
                Roster →
              </span>
            </div>
          </button>
        </div>
      </section>

      {/* Section 3: Analytics Composition (Asymmetric 7 : 5 Split) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Interactive SVG Appointment Activity Chart */}
        <div className="lg:col-span-7 card-surface rounded-xl p-6 flex flex-col justify-between">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-semibold text-[#111C17]">
                Appointment Activity Over Time
              </h3>
              <p className="text-xs text-[#526259] mt-0.5">
                {overview.windowStart} to {overview.windowEnd} · Hover any date for status breakdown or select to focus schedule
              </p>
            </div>
            <button
              type="button"
              onClick={loadData}
              className="btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#526259] hover:text-[#111C17] border border-[#E3E8E4] hover:bg-[#F6F8F6] rounded-lg whitespace-nowrap shrink-0"
              aria-label="Refresh operational analytics"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              Refresh
            </button>
          </div>

          <AppointmentActivityChart
            dailyTrend={overview.dailyTrend}
            todayDate={overview.todayDate}
            activeDate={activeDate}
            onSelectDate={handleSelectDate}
          />
        </div>

        {/* Right: Appointment Status Distribution + Patient Overview & Operational Indicators */}
        <div className="lg:col-span-5 card-surface rounded-xl p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-semibold text-[#111C17]">
                  Appointment Status Distribution
                </h3>
                <p className="text-xs text-[#526259] mt-0.5">
                  Click any status slice to filter clinic schedule
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-medium text-[#047857] hover:underline whitespace-nowrap shrink-0"
              >
                Full Reports
              </button>
            </div>

            <StatusDonutChart
              statusBreakdown={overview.statusBreakdown}
              totalInWindow={overview.totalAppointmentsInWindow}
              onSelectStatus={(status) =>
                navigateTarget({ tab: 'appointments', status, date: '' })
              }
            />
          </div>

          {/* Patient Overview & Operational Performance Strip */}
          <div className="pt-4 border-t border-[#E3E8E4] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#111C17]">
                Patient Overview &amp; Confirmation Rate
              </span>
              <button
                type="button"
                onClick={() => navigateTarget({ tab: 'patients', status: 'All' })}
                className="text-[11px] font-mono tabular-nums text-[#047857] hover:underline"
              >
                {overview.totalPatients} synthetic records
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs pb-1">
              <button
                type="button"
                onClick={() =>
                  navigateTarget({ tab: 'appointments', date: activeDate, status: 'Confirmed' })
                }
                className="text-left p-2.5 rounded-lg bg-[#F6F8F6] hover:bg-[#ECF4EF] transition-colors"
                data-testid="kpi-confirmed-appointments"
              >
                <div className="text-[11px] text-[#526259]">Confirmed Rate</div>
                <div className="text-sm font-bold font-mono tabular-nums text-[#047857] mt-0.5">
                  {confirmationPct}%
                </div>
              </button>
              <button
                type="button"
                onClick={() => navigateTarget({ tab: 'patients', status: 'Active' })}
                className="text-left p-2.5 rounded-lg bg-[#F6F8F6] hover:bg-[#ECF4EF] transition-colors"
              >
                <div className="text-[11px] text-[#526259]">Active Patients</div>
                <div className="text-sm font-bold font-mono tabular-nums text-[#111C17] mt-0.5">
                  {overview.activePatients}
                </div>
              </button>
              <button
                type="button"
                onClick={() => navigateTarget({ tab: 'appointments', status: 'Missed', date: '' })}
                className="text-left p-2.5 rounded-lg bg-[#F6F8F6] hover:bg-red-50/80 transition-colors"
                data-testid="kpi-missed-appointments"
              >
                <div className="text-[11px] text-[#526259]">Missed (7d)</div>
                <div
                  className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${
                    overview.missedLastSevenDaysCount > 0 ? 'text-[#DC2626]' : 'text-[#047857]'
                  }`}
                >
                  {overview.missedLastSevenDaysCount}
                </div>
              </button>
            </div>

            <PatientCohortChart trend={overview.patientRegistrationTrend} />
          </div>
        </div>
      </section>

      {/* Section 4: Integrated CareDesk AI Operational Launchpad */}
      <section
        aria-label="CareDesk AI Assistant Quick Launch"
        className="card-surface rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 min-w-0">
          <DashboardOpsSpotIllustration />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium text-[#047857]">
              <span>CareDesk Operations Copilot</span>
              <span aria-hidden="true">·</span>
              <span className="text-[#526259] font-normal">Local REST Preview</span>
            </div>
            <h3 className="text-sm sm:text-base font-semibold text-[#111C17]">
              Initiate an administrative request in natural language
            </h3>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {QUICK_ASSISTANT_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() =>
                    onLaunchAssistantPrompt
                      ? onLaunchAssistantPrompt(prompt)
                      : onNavigate('assistant')
                  }
                  className="btn-press text-left px-2.5 py-1 text-xs font-medium text-[#0B261C] bg-[#F4F8F5] hover:bg-[#DCECE3] border border-[#D4E4DA] rounded-md transition-colors max-w-full"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>

        <form
          onSubmit={handleQuickAssistantSubmit}
          className="flex items-center gap-2 w-full lg:w-[390px] shrink-0"
        >
          <label htmlFor="dashboard-assistant-input" className="sr-only">
            Ask CareDesk Assistant
          </label>
          <input
            id="dashboard-assistant-input"
            type="text"
            value={assistantQuickInput}
            onChange={(e) => setAssistantQuickInput(e.target.value)}
            placeholder="Ask about schedule, missed visits, or P-1042..."
            className="flex-1 min-w-0 px-3 py-2 text-xs sm:text-sm bg-[#F6F8F6] border border-[#D4DAD4] rounded-lg focus:bg-white"
          />
          <button
            type="submit"
            disabled={!assistantQuickInput.trim()}
            className="btn-press inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            Ask CareDesk AI
          </button>
        </form>
      </section>

      {/* Section 5: Asymmetrical Lower Operational Grid (5 : 4 : 3 Split) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left (5 cols): Today's / Focused Date Schedule */}
        <div className="lg:col-span-5 card-surface rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E3E8E4] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-[#111C17]">
                Appointments on <span className="font-mono">{activeDate}</span>
              </h3>
              <p className="text-xs text-[#526259] mt-0.5">
                {calendarDayAppointments.length} visit
                {calendarDayAppointments.length === 1 ? '' : 's'} · Select row to inspect or reschedule
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                navigateTarget({ tab: 'appointments', date: activeDate, status: 'All' })
              }
              className="text-xs font-medium text-[#047857] hover:text-[#0B261C] whitespace-nowrap shrink-0"
            >
              Manage All
            </button>
          </div>

          {calendarDayAppointments.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <ClinicEmptyIllustration variant="appointments" />
              <p className="text-sm text-[#526259]">
                No appointments scheduled on {activeDate}.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#EEF2EF] max-h-[430px] overflow-y-auto">
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
                  className={`${rowPad} flex items-center justify-between gap-3 hover:bg-[#F6F8F6] transition-colors cursor-pointer focus:outline-none focus:bg-[#ECF4EF]/50`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <EditorialAvatar
                      name={apt.patientName ?? apt.patientId}
                      role="patient"
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs min-w-0">
                        <span className="font-mono tabular-nums font-semibold text-[#0B261C] shrink-0">
                          {apt.appointmentTime}
                        </span>
                        <span className="font-semibold text-[#111C17] truncate">
                          {apt.patientName}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#526259] truncate mt-0.5">
                        <span className="font-mono text-[#64746B]">{apt.patientId}</span>
                        {' · '}
                        {apt.department} · {apt.clinician}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <AppointmentStatusText status={apt.status} />
                    {apt.status === 'Scheduled' && (
                      <button
                        type="button"
                        disabled={updatingId === apt.id}
                        onClick={(e) => handleQuickConfirm(e, apt.id)}
                        className="btn-press inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-[#047857] bg-[#ECF4EF] hover:bg-[#D4E4DA] rounded-md disabled:opacity-50"
                        aria-label={`Confirm appointment ${apt.id}`}
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

        {/* Middle (4 cols): Clinic Calendar + Operational Alerts */}
        <div className="lg:col-span-4 card-surface rounded-xl p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-[#111C17]">Schedule Calendar</h3>
            <p className="text-xs text-[#526259] mt-0.5">
              Select any date to inspect clinic load
            </p>
          </div>

          <ClinicCalendar
            selectedDate={activeDate}
            onSelectDate={handleSelectDate}
            daySummaries={overview.calendarSummary}
            compact
          />

          <div className="pt-4 border-t border-[#E3E8E4] space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-[#111C17]">Operational Alerts</h4>
              <span className="text-[11px] font-mono tabular-nums text-[#526259]">
                {daily.unconfirmedAppointments +
                  overview.overdueFollowUpsCount +
                  daily.missedAppointments}{' '}
                open
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <button
                type="button"
                onClick={() =>
                  navigateTarget({ tab: 'appointments', status: 'Scheduled', date: activeDate })
                }
                className={`btn-press w-full text-left px-3 py-2.5 rounded-lg border flex items-center justify-between gap-2 ${
                  daily.unconfirmedAppointments > 0
                    ? 'bg-amber-50/75 hover:bg-amber-50 border-amber-200/80'
                    : 'bg-[#F4F8F5] hover:bg-[#ECF4EF] border-[#D4E4DA]'
                }`}
              >
                <div className="min-w-0">
                  <div
                    className={`font-semibold truncate ${
                      daily.unconfirmedAppointments > 0 ? 'text-amber-950' : 'text-[#0B261C]'
                    }`}
                  >
                    {daily.unconfirmedAppointments > 0
                      ? `${daily.unconfirmedAppointments} unconfirmed on ${daily.date}`
                      : `All visits confirmed on ${daily.date}`}
                  </div>
                  <div
                    className={`text-[11px] truncate ${
                      daily.unconfirmedAppointments > 0 ? 'text-amber-800/85' : 'text-[#526259]'
                    }`}
                  >
                    {daily.unconfirmedAppointments > 0
                      ? 'Review scheduled confirmation queue'
                      : 'No pending confirmations for date'}
                  </div>
                </div>
                <ArrowRight
                  className={`w-3.5 h-3.5 shrink-0 ${
                    daily.unconfirmedAppointments > 0 ? 'text-amber-700' : 'text-[#047857]'
                  }`}
                  aria-hidden="true"
                />
              </button>

              <button
                type="button"
                onClick={() =>
                  navigateTarget({
                    tab: 'followups',
                    followUpView: overview.overdueFollowUpsCount > 0 ? 'overdue' : 'pending',
                  })
                }
                className={`btn-press w-full text-left px-3 py-2.5 rounded-lg border flex items-center justify-between gap-2 ${
                  overview.overdueFollowUpsCount > 0
                    ? 'bg-red-50/65 hover:bg-red-50 border-red-200/80'
                    : 'bg-[#F4F8F5] hover:bg-[#ECF4EF] border-[#D4E4DA]'
                }`}
              >
                <div className="min-w-0">
                  <div
                    className={`font-semibold truncate ${
                      overview.overdueFollowUpsCount > 0 ? 'text-red-950' : 'text-[#0B261C]'
                    }`}
                  >
                    {overview.overdueFollowUpsCount > 0
                      ? `${overview.overdueFollowUpsCount} overdue follow-up${
                          overview.overdueFollowUpsCount === 1 ? '' : 's'
                        }`
                      : 'No overdue follow-ups'}
                  </div>
                  <div
                    className={`text-[11px] truncate ${
                      overview.overdueFollowUpsCount > 0 ? 'text-red-800/85' : 'text-[#526259]'
                    }`}
                  >
                    {overview.overdueFollowUpsCount > 0
                      ? 'Requires outreach priority'
                      : `${overview.pendingFollowUpsCount} open outreach task${
                          overview.pendingFollowUpsCount === 1 ? '' : 's'
                        } on track`}
                  </div>
                </div>
                <ArrowRight
                  className={`w-3.5 h-3.5 shrink-0 ${
                    overview.overdueFollowUpsCount > 0 ? 'text-red-700' : 'text-[#047857]'
                  }`}
                  aria-hidden="true"
                />
              </button>

              <button
                type="button"
                onClick={() =>
                  onLaunchAssistantPrompt
                    ? onLaunchAssistantPrompt('Prepare an administrative follow-up list.')
                    : onNavigate('assistant')
                }
                className="btn-press w-full text-left px-3 py-2.5 rounded-lg bg-[#ECF4EF] hover:bg-[#DCECE3] border border-[#C6DFD1] flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-[#0B261C] truncate">
                    Prepare Follow-up Outreach List
                  </div>
                  <div className="text-[11px] text-[#34433B] truncate">
                    Triage {overview.missedLastSevenDaysCount} missed 7d visits in Assistant
                  </div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-[#047857] shrink-0" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* Right (3 cols): Activity Timeline */}
        <div className="lg:col-span-3 card-surface rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[#E3E8E4] flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-[#111C17]">Activity Timeline</h3>
              <p className="text-xs text-[#526259] mt-0.5">Recent clinic actions</p>
            </div>
            <Clock className="w-4 h-4 text-[#526259]" aria-hidden="true" />
          </div>
          <div className="p-4 max-h-[430px] overflow-y-auto">
            {overview.recentActivity.length === 0 ? (
              <p className="text-xs text-[#526259]">No recent activity recorded.</p>
            ) : (
              <ol className="relative border-l border-[#E3E8E4] ml-2 space-y-4">
                {overview.recentActivity.map((entry) => (
                  <li key={entry.id} className="pl-4 relative">
                    <span
                      className="absolute -left-[4.5px] top-1.5 w-2 h-2 rounded-full bg-[#059669] ring-2 ring-white"
                      aria-hidden="true"
                    />
                    <p className="text-xs text-[#111C17] leading-relaxed">{entry.summary}</p>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono text-[#64746B]">
                      <span className="truncate max-w-[125px]">{entry.actor}</span>
                      <span aria-hidden="true">·</span>
                      <span>{entry.resourceId}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>

      {/* Section 6: Clinician Live Duty & Availability */}
      {doctorAvailability.length > 0 && (
        <section className="card-surface rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3E8E4] pb-3">
            <div>
              <h3 className="text-base font-semibold text-[#111C17]">
                Clinician Live Duty &amp; Availability ({activeDate})
              </h3>
              <p className="text-xs text-[#526259] mt-0.5">
                Real-time operational duty states, shift hours, daily caseload, and next open slots
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigateTarget({ tab: 'staff' })}
              className="text-xs font-medium text-[#047857] hover:text-[#0B261C] whitespace-nowrap shrink-0"
            >
              Manage Roster →
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {doctorAvailability.map((doc) => (
              <div
                key={doc.staffId}
                className="p-3.5 rounded-xl border border-[#E3E8E4] bg-[#F9FBFA] space-y-2 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <EditorialAvatar name={doc.fullName} role="clinician" size="sm" />
                    <div className="min-w-0">
                      <div className="font-semibold text-[#111C17] truncate">{doc.fullName}</div>
                      <div className="text-[11px] text-[#526259] truncate">
                        {doc.department} · {doc.specialty}
                      </div>
                    </div>
                  </div>
                  <DoctorDutyStatusText status={doc.effectiveOperationalState} />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-[#526259] pt-1 border-t border-[#EEF2EF]">
                  <span>{doc.workingHoursLabel}</span>
                  <span>
                    Load {doc.bookedCount}/{doc.maxDailyCapacity}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono text-[#047857]">
                    {doc.nextAvailableSlot
                      ? `Next open: ${doc.nextAvailableSlot.date} ${doc.nextAvailableSlot.time}`
                      : 'No open slots on date'}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      navigateTarget({ tab: 'appointments', date: activeDate, status: 'All' })
                    }
                    className="font-medium text-[#0B261C] hover:text-[#047857] hover:underline whitespace-nowrap"
                  >
                    Schedule →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
