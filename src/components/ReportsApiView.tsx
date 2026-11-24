import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  Code2,
  Download,
  FileBarChart,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  fetchAppointments,
  fetchDailyReport,
  fetchExplainableReport,
  fetchOpenApiDocs,
  fetchOverviewReport,
} from '../client/api';
import type {
  Appointment,
  DailyReport,
  ExplainableOperationalReport,
  OverviewReport,
} from '../shared/types';
import {
  AppointmentActivityChart,
  DepartmentLoadChart,
  StatusDonutChart,
} from './AnalyticsCharts';
import { ChartSkeleton } from './Skeletons';
import { AppointmentStatusText } from './StatusText';

interface ReportsApiViewProps {
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  refreshSignal: number;
}

export function ReportsApiView({
  onErrorNotice,
  onSuccessNotice,
  refreshSignal,
}: ReportsApiViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [overview, setOverview] = useState<OverviewReport | null>(null);
  const [explainable, setExplainable] = useState<ExplainableOperationalReport | null>(null);
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [periodEnd, setPeriodEnd] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [docs, setDocs] = useState<{
    openapi: string;
    info: { title: string; version: string; description: string };
    paths: Record<string, Record<string, { summary?: string }>>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingExplainable, setLoadingExplainable] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const [dailyData, overviewData, allApts, openApiData, explainableData] = await Promise.all([
        fetchDailyReport(selectedDate),
        fetchOverviewReport(),
        fetchAppointments(),
        fetchOpenApiDocs(),
        fetchExplainableReport({ periodStart, periodEnd }).catch(() => null),
      ]);
      setDaily(dailyData);
      setOverview(overviewData);
      setAppointments(allApts);
      setDocs(openApiData);
      if (explainableData) setExplainable(explainableData);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load reports.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, periodStart, periodEnd, onErrorNotice]);

  const handleReloadExplainable = async () => {
    setLoadingExplainable(true);
    try {
      const data = await fetchExplainableReport({ periodStart, periodEnd });
      setExplainable(data);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load explainable report.');
    } finally {
      setLoadingExplainable(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, [loadReports, refreshSignal]);

  const handleDownloadJson = () => {
    if (!daily || !overview) return;
    const blob = new Blob([JSON.stringify({ daily, overview }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `caredesk-operational-report-${daily.date}.json`;
    link.click();
    URL.revokeObjectURL(url);
    onSuccessNotice(`Exported JSON operational report for ${daily.date}.`);
  };

  const handleDownloadCsv = () => {
    if (!daily || !overview) return;
    const lines = [
      'Section,MetricOrId,DateOrStatus,Details,Value',
      `Daily Summary,Total Appointments,${daily.date},All statuses,${daily.totalAppointments}`,
      ...Object.entries(daily.statusBreakdown).map(
        ([status, count]) => `Daily Status Breakdown,${status},${daily.date},Appointment count,${count}`
      ),
      `Follow-up Queue,Pending Follow-ups,${daily.date},Active open tasks,${daily.pendingFollowUps}`,
      ...overview.missedLastSevenDays.map(
        (m) =>
          `Missed Last 7d,${m.id},${m.appointmentDate} ${m.appointmentTime},"${m.patientName} (${m.patientId}) · ${m.department}",${m.status}`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `caredesk-operational-report-${daily.date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    onSuccessNotice(`Exported CSV operational report for ${daily.date}.`);
  };

  if (loading && !daily) {
    return <ChartSkeleton label="Loading operational reports" />;
  }

  if (!daily || !overview) {
    return (
      <div className="card-surface rounded-[24px] p-10 text-center space-y-3">
        <p className="text-sm font-semibold text-[#1C2B25]">
          Operational reports could not be loaded.
        </p>
        <p className="text-xs text-[#6B7B73]">
          Verify the local clinic API service is running and try again.
        </p>
        <button
          type="button"
          onClick={loadReports}
          className="btn-press px-5 py-2.5 text-xs font-semibold text-white bg-[#34C38F] hover:bg-[#24B07D] rounded-full"
        >
          Retry Loading Reports
        </button>
      </div>
    );
  }

  const summaryTiles = [
    {
      label: 'Total Roster',
      value: overview.totalPatients,
      detail: `${overview.activePatients} active patient records`,
      icon: Users,
      chipBg: 'bg-[#E3F7EF] text-[#137A55]',
    },
    {
      label: `Visits (${daily.date.slice(5)})`,
      value: daily.totalAppointments,
      detail: `${daily.confirmedAppointments} confirmed · ${daily.unconfirmedAppointments} pending`,
      icon: CalendarClock,
      chipBg: 'bg-[#E7F2FD] text-[#1E6BB8]',
    },
    {
      label: 'Open Follow-ups',
      value: overview.pendingFollowUpsCount,
      detail: `${overview.overdueFollowUpsCount} overdue · ${overview.highPriorityFollowUpsCount} high priority`,
      icon: ClipboardCheck,
      chipBg: 'bg-[#EEEBFC] text-[#5B47B0]',
    },
    {
      label: 'Missed Visits (7d)',
      value: overview.missedLastSevenDaysCount,
      detail: `Across ${appointments.length} total clinic records`,
      icon: AlertTriangle,
      chipBg:
        overview.missedLastSevenDaysCount > 0
          ? 'bg-[#FFEBE4] text-[#C84E28]'
          : 'bg-[#E3F7EF] text-[#137A55]',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Executive Summary Tiles */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryTiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <div
              key={tile.label}
              className="card-surface card-interactive rounded-[22px] p-5 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-[#6B7B73]">{tile.label}</div>
                <div className="text-[30px] leading-tight font-bold font-mono tabular-nums text-[#1C2B25] mt-1.5">
                  {tile.value}
                </div>
                <div className="text-[11px] text-[#6B7B73] mt-1">{tile.detail}</div>
              </div>
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${tile.chipBg}`}
              >
                <Icon className="w-4.5 h-4.5" aria-hidden="true" />
              </div>
            </div>
          );
        })}
      </section>

      {/* Large Analytical Chart Cards */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 min-w-0 card-surface rounded-[24px] p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#1C2B25]">
                Daily Appointment Activity &amp; Confirmation Pace
              </h2>
              <p className="text-xs text-[#6B7B73] mt-0.5">
                Click any date bar or point to inspect that day&apos;s summary below
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="report-date-input" className="text-xs font-medium text-[#6B7B73]">
                Date
              </label>
              <input
                id="report-date-input"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="min-h-[40px] sm:min-h-0 px-3 py-1.5 text-xs font-mono border border-[#DCE8E0] rounded-full bg-[#FAFBF9] focus:outline-none focus:border-[#34C38F]"
              />
            </div>
          </div>

          <AppointmentActivityChart
            dailyTrend={overview.dailyTrend}
            todayDate={overview.todayDate}
            activeDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
        </div>

        <div className="xl:col-span-5 min-w-0 card-surface rounded-[24px] p-5 sm:p-6 space-y-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#1C2B25]">Status Distribution</h2>
              <p className="text-xs text-[#6B7B73] mt-0.5">
                Share of bookings across current reporting window
              </p>
            </div>
            <span className="px-3 py-1 rounded-full bg-[#EEF3EF] text-[#0F3D2E] text-[11px] font-semibold font-mono tabular-nums shrink-0">
              {overview.totalAppointmentsInWindow} total
            </span>
          </div>

          <StatusDonutChart
            statusBreakdown={overview.statusBreakdown}
            totalInWindow={Object.values(overview.statusBreakdown).reduce((a, b) => a + b, 0)}
          />

          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#EEF3EF]">
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="btn-press inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-semibold text-[#0F3D2E] bg-[#E3F7EF] hover:bg-[#D0EFE3] rounded-full whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={handleDownloadJson}
              className="btn-press inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-semibold text-[#1C2B25] bg-[#FAFBF9] hover:bg-[#EEF3EF] border border-[#DCE8E0] rounded-full whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-[#0F3D2E]" aria-hidden="true" />
              Export JSON
            </button>
          </div>
        </div>
      </section>

      {/* Department Load + Selected Day Breakdown */}
      <section className="card-surface rounded-[24px] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#EEF3EF] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E3F7EF] text-[#137A55] flex items-center justify-center shrink-0">
              <FileBarChart className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1C2B25]">
                Department Capacity &amp; Daily Summary ({daily.date})
              </h2>
              <p className="text-xs text-[#6B7B73]">
                Live relational metrics computed directly from clinic SQLite records
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 min-w-0 space-y-3">
            <h3 className="text-sm font-semibold text-[#1C2B25]">
              Daily Status Breakdown ({daily.date})
            </h3>
            <div className="divide-y divide-[#EEF3EF] border-y border-[#EEF3EF] text-sm">
              <div className="py-2.5 flex justify-between">
                <span className="text-[#6B7B73]">Total Appointments</span>
                <span className="font-mono tabular-nums font-bold text-[#1C2B25]">
                  {daily.totalAppointments}
                </span>
              </div>
              {Object.entries(daily.statusBreakdown).map(([status, count]) => (
                <div key={status} className="py-2.5 flex justify-between">
                  <span className="text-[#6B7B73]">{status}</span>
                  <span className="font-mono tabular-nums font-semibold text-[#1C2B25]">
                    {count}
                  </span>
                </div>
              ))}
              <div className="py-2.5 px-3 -mx-3 flex justify-between bg-[#E3F7EF]/60 rounded-xl">
                <span className="text-[#0F3D2E] font-semibold">Clinic Open Follow-ups</span>
                <span className="font-mono tabular-nums font-bold text-[#0F3D2E]">
                  {daily.pendingFollowUps}
                </span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 min-w-0 space-y-3 lg:pl-6 lg:border-l lg:border-[#EEF3EF]">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[#1C2B25]">
                Department Volume &amp; Confirmation Rate
              </h3>
              <span className="text-[11px] font-mono text-[#6B7B73]">All scheduled history</span>
            </div>
            <DepartmentLoadChart appointments={appointments} />
          </div>
        </div>
      </section>

      {/* Operational Intelligence & Explainable Reports */}
      {explainable && (
        <section className="card-surface rounded-[24px] p-5 sm:p-6 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#EEF3EF] pb-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#1C2B25]">
                Operational Intelligence &amp; Explainable Reports
              </h2>
              <p className="text-xs text-[#6B7B73] mt-0.5 break-words">
                Period <span className="font-mono">{explainable.periodStart}</span> to{' '}
                <span className="font-mono">{explainable.periodEnd}</span> vs prior baseline{' '}
                <span className="font-mono">
                  {explainable.compareStart}–{explainable.compareEnd}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <label htmlFor="explain-period-start" className="text-xs text-[#6B7B73]">
                  From
                </label>
                <input
                  id="explain-period-start"
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="min-h-[40px] sm:min-h-0 px-3 py-1.5 text-xs font-mono border border-[#DCE8E0] rounded-full bg-[#FAFBF9]"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label htmlFor="explain-period-end" className="text-xs text-[#6B7B73]">
                  To
                </label>
                <input
                  id="explain-period-end"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="min-h-[40px] sm:min-h-0 px-3 py-1.5 text-xs font-mono border border-[#DCE8E0] rounded-full bg-[#FAFBF9]"
                />
              </div>
              <button
                type="button"
                disabled={loadingExplainable}
                onClick={handleReloadExplainable}
                className="btn-press inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 px-4 py-1.5 text-xs font-semibold text-[#0F3D2E] bg-[#E3F7EF] hover:bg-[#D0EFE3] rounded-full disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-[#137A55] ${loadingExplainable ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                Reload Analysis
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-4 rounded-2xl bg-[#FAFBF9] border border-[#DCE8E0]">
              <div className="text-[#6B7B73]">Confirmed / Completed Rate</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[#137A55] mt-1">
                {explainable.rawSummary.confirmedOrCompletedRate}%
              </div>
              <div className="text-[11px] text-[#6B7B73] mt-0.5">
                {explainable.rawSummary.completedAppointments} completed of{' '}
                {explainable.rawSummary.totalAppointments}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#FAFBF9] border border-[#DCE8E0]">
              <div className="text-[#6B7B73]">No-Show / Missed Rate</div>
              <div
                className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
                  explainable.rawSummary.noShowRate > 12 ? 'text-rose-600' : 'text-[#1C2B25]'
                }`}
              >
                {explainable.rawSummary.noShowRate}%
              </div>
              <div className="text-[11px] text-[#6B7B73] mt-0.5">
                {explainable.rawSummary.missedAppointments} missed ·{' '}
                {explainable.rawSummary.cancelledAppointments} cancelled
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#FAFBF9] border border-[#DCE8E0]">
              <div className="text-[#6B7B73]">Follow-ups Completed</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[#0F3D2E] mt-1">
                {explainable.rawSummary.followupsCompletedInPeriod}
              </div>
              <div className="text-[11px] text-[#6B7B73] mt-0.5">
                {explainable.rawSummary.followupsOverdueCount} currently overdue
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#FAFBF9] border border-[#DCE8E0]">
              <div className="text-[#6B7B73]">New Registrations</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[#1C2B25] mt-1">
                {explainable.rawSummary.newRegistrationsInPeriod}
              </div>
              <div className="text-[11px] text-[#6B7B73] mt-0.5">
                {explainable.rawSummary.activePatients} active clinic patients
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {explainable.sections.map((sec) => (
              <article
                key={sec.id}
                className="p-5 rounded-[20px] border border-[#DCE8E0] bg-[#FAFBF9] space-y-3"
              >
                <div className="flex items-start justify-between gap-3 border-b border-[#DCE8E0] pb-2.5">
                  <div>
                    <h3 className="text-sm font-bold text-[#0F3D2E]">{sec.title}</h3>
                    <div className="text-[11px] text-[#6B7B73] mt-0.5">
                      {sec.headlineMetricLabel} ·{' '}
                      <span className="font-mono text-[#137A55]">{sec.comparisonDeltaLabel}</span>
                    </div>
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-[#0F3D2E] shrink-0">
                    {sec.headlineMetricValue}
                  </div>
                </div>

                {sec.metrics.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-[#43564D]">
                    {sec.metrics.map((m) => (
                      <span key={m.label}>
                        {m.label}: <strong className="text-[#1C2B25]">{m.value}</strong>
                      </span>
                    ))}
                  </div>
                )}

                <dl className="space-y-1.5 text-xs">
                  <div>
                    <dt className="font-semibold text-[#1C2B25] inline">What happened: </dt>
                    <dd className="text-[#43564D] inline">{sec.explanation.whatHappened}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-[#1C2B25] inline">What it means: </dt>
                    <dd className="text-[#43564D] inline">{sec.explanation.whatItMeans}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-[#1C2B25] inline">Why it matters: </dt>
                    <dd className="text-[#43564D] inline">{sec.explanation.whyItMatters}</dd>
                  </div>
                  <div className="pt-1.5 text-[#0F3D2E] bg-[#E3F7EF]/80 px-3 py-2 rounded-xl">
                    <dt className="font-semibold inline">Recommended action: </dt>
                    <dd className="inline">{sec.explanation.appropriateAction}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          {explainable.doctorUtilization.length > 0 && (
            <div className="border border-[#DCE8E0] rounded-[20px] overflow-hidden">
              <div className="px-5 py-3.5 bg-[#FAFBF9] border-b border-[#DCE8E0] flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-[#1C2B25]">
                  Clinician Utilization &amp; Capacity Breakdown
                </h3>
                <span className="text-[11px] font-mono text-[#6B7B73]">
                  {explainable.doctorUtilization.length} clinicians
                </span>
              </div>
              <div className="md:hidden divide-y divide-[#EEF3EF]">
                {explainable.doctorUtilization.map((doc) => (
                  <div key={doc.staffId} className="p-4 space-y-2 bg-white text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[#1C2B25] truncate">{doc.doctorName}</div>
                        <div className="text-[11px] text-[#6B7B73]">{doc.department}</div>
                      </div>
                      <span className="font-mono font-bold text-[#0F3D2E] bg-[#E3F7EF] px-2.5 py-0.5 rounded-full shrink-0">
                        {doc.utilizationRate}%
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-[11px] font-mono bg-[#FAFBF9] p-2 rounded-xl">
                      <div>
                        <span className="text-[#6B7B73] block">Sched</span>
                        <span className="font-semibold text-[#1C2B25]">{doc.scheduledAppointments}</span>
                      </div>
                      <div>
                        <span className="text-[#6B7B73] block">Done</span>
                        <span className="font-semibold text-[#137A55]">{doc.completedAppointments}</span>
                      </div>
                      <div>
                        <span className="text-[#6B7B73] block">Missed</span>
                        <span className="font-semibold text-rose-600">{doc.missedAppointments}</span>
                      </div>
                      <div>
                        <span className="text-[#6B7B73] block">Slots</span>
                        <span className="font-semibold text-[#6B7B73]">{doc.capacitySlotsInPeriod}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#DCE8E0] text-[#6B7B73] bg-white">
                      <th className="py-2.5 px-5">Clinician</th>
                      <th className="py-2.5 px-4">Department</th>
                      <th className="py-2.5 px-4 font-mono">Scheduled</th>
                      <th className="py-2.5 px-4 font-mono">Completed</th>
                      <th className="py-2.5 px-4 font-mono">Missed</th>
                      <th className="py-2.5 px-4 font-mono">Period Slots</th>
                      <th className="py-2.5 px-5 font-mono text-right">Utilization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF3EF]">
                    {explainable.doctorUtilization.map((doc) => (
                      <tr key={doc.staffId} className="hover:bg-[#FAFBF9]">
                        <td className="py-2.5 px-5 font-semibold text-[#1C2B25]">{doc.doctorName}</td>
                        <td className="py-2.5 px-4 text-[#6B7B73]">{doc.department}</td>
                        <td className="py-2.5 px-4 font-mono tabular-nums">
                          {doc.scheduledAppointments}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-[#137A55]">
                          {doc.completedAppointments}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-rose-600">
                          {doc.missedAppointments}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-[#6B7B73]">
                          {doc.capacitySlotsInPeriod}
                        </td>
                        <td className="py-2.5 px-5 font-mono tabular-nums font-bold text-[#0F3D2E] text-right">
                          {doc.utilizationRate}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Missed Appointments 7-Day Table */}
      <section className="card-surface rounded-[24px] overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-[#EEF3EF] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#1C2B25]">
              Missed Appointments (Last 7 Days)
            </h2>
            <p className="text-xs text-[#6B7B73] mt-0.5">
              Patients flagged for rescheduling outreach and follow-up tracking
            </p>
          </div>
          <span className="px-3 py-1 rounded-full bg-[#EEF3EF] text-[#0F3D2E] text-xs font-mono tabular-nums shrink-0">
            {overview.missedLastSevenDaysCount} record
            {overview.missedLastSevenDaysCount === 1 ? '' : 's'}
          </span>
        </div>

        {overview.missedLastSevenDays.length === 0 ? (
          <p className="text-xs text-[#6B7B73] p-6">
            No missed appointments recorded in the last seven days.
          </p>
        ) : (
          <>
            <div className="md:hidden divide-y divide-[#EEF3EF]">
              {overview.missedLastSevenDays.map((m) => (
                <article key={m.id} className="p-4 space-y-2 bg-white text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-[#1C2B25] truncate">{m.patientName}</div>
                      <div className="text-[11px] font-mono text-[#6B7B73]">
                        {m.id} · {m.patientId}
                      </div>
                    </div>
                    <AppointmentStatusText status={m.status} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6B7B73]">
                    <span className="font-mono text-[#1C2B25]">
                      {m.appointmentDate} · {m.appointmentTime}
                    </span>
                    <span className="truncate">
                      {m.department} · {m.clinician}
                    </span>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#DCE8E0] bg-[#FAFBF9] text-[#6B7B73]">
                    <th className="py-2.5 px-6 whitespace-nowrap">Appointment</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Date · Time</th>
                    <th className="py-2.5 px-4">Patient</th>
                    <th className="py-2.5 px-4">Department · Clinician</th>
                    <th className="py-2.5 px-6 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF3EF]">
                  {overview.missedLastSevenDays.map((m) => (
                    <tr key={m.id} className="hover:bg-[#FAFBF9] transition-colors">
                      <td className="py-2.5 px-6 font-mono font-semibold text-[#0F3D2E] whitespace-nowrap">
                        {m.id}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-[#43564D] whitespace-nowrap">
                        {m.appointmentDate} {m.appointmentTime}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="font-semibold text-[#1C2B25]">{m.patientName}</span>
                        <span className="font-mono text-[#6B7B73]"> · {m.patientId}</span>
                      </td>
                      <td className="py-2.5 px-4 text-[#6B7B73] whitespace-nowrap">
                        {m.department} · {m.clinician}
                      </td>
                      <td className="py-2.5 px-6 whitespace-nowrap">
                        <AppointmentStatusText status={m.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* REST API Reference */}
      <section className="card-surface rounded-[24px] overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-[#EEF3EF] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-[#EEF3EF] text-[#0F3D2E] flex items-center justify-center shrink-0">
              <Code2 className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#1C2B25]">
                REST API Reference &amp; Synapse Readiness
              </h2>
              <p className="text-xs text-[#6B7B73] break-words">
                OpenAPI {docs?.openapi ?? '3.0.3'} served live at{' '}
                <code className="font-mono text-[#1C2B25]">GET /api/docs</code>
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#E3F7EF] text-xs font-semibold text-[#137A55] shrink-0 self-start sm:self-auto">
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Synapse MCP Ready</span>
          </div>
        </div>

        <div className="md:hidden divide-y divide-[#EEF3EF]">
          {docs &&
            Object.entries(docs.paths).flatMap(([routePath, methods]) =>
              Object.entries(methods).map(([method, op]) => (
                <div key={`${method}-${routePath}-mob`} className="p-4 space-y-1 bg-white text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold uppercase text-[#137A55] shrink-0">
                      {method}
                    </span>
                    <span className="font-mono text-[#1C2B25] break-all">/api{routePath}</span>
                  </div>
                  <p className="text-[#6B7B73]">{op.summary}</p>
                </div>
              ))
            )}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#DCE8E0] bg-[#FAFBF9] text-[#6B7B73]">
                <th className="py-2.5 px-6">Method</th>
                <th className="py-2.5 px-4">Endpoint</th>
                <th className="py-2.5 px-6">Operation Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF3EF]">
              {docs &&
                Object.entries(docs.paths).flatMap(([routePath, methods]) =>
                  Object.entries(methods).map(([method, op]) => (
                    <tr key={`${method}-${routePath}`} className="hover:bg-[#FAFBF9]">
                      <td className="py-2.5 px-6 font-mono font-semibold uppercase text-[#137A55]">
                        {method}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#1C2B25]">/api{routePath}</td>
                      <td className="py-2.5 px-6 text-[#6B7B73]">{op.summary}</td>
                    </tr>
                  ))
                )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
