import { useCallback, useEffect, useState } from 'react';
import { Code2, Download, FileBarChart, FileSpreadsheet, RefreshCw, ShieldCheck } from 'lucide-react';
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
import { DepartmentLoadChart } from './AnalyticsCharts';
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
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading operational reports">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 card-surface rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-72 card-surface rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!daily || !overview) {
    return (
      <div className="card-surface rounded-xl p-8 text-center space-y-3">
        <p className="text-sm font-medium text-[#111C17]">
          Operational reports could not be loaded.
        </p>
        <p className="text-xs text-[#526259]">
          Verify the local clinic API service is running and try again.
        </p>
        <button
          type="button"
          onClick={loadReports}
          className="btn-press px-4 py-2 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg"
        >
          Retry Loading Reports
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Executive Operational Summary Strip */}
      {daily && overview && (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#0B261C] text-white rounded-xl p-4">
            <div className="text-xs font-medium text-emerald-200/80">Total Roster</div>
            <div className="text-2xl font-bold font-mono tabular-nums mt-2">
              {overview.totalPatients}
            </div>
            <div className="text-[11px] text-emerald-100/75 mt-1">
              {overview.activePatients} active synthetic profiles
            </div>
          </div>

          <div className="card-surface rounded-xl p-4">
            <div className="text-xs font-medium text-[#526259]">
              Visits on {daily.date.slice(5)}
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-[#111C17] mt-2">
              {daily.totalAppointments}
            </div>
            <div className="text-[11px] text-[#047857] mt-1 font-mono tabular-nums">
              {daily.confirmedAppointments} confirmed · {daily.unconfirmedAppointments} unconfirmed
            </div>
          </div>

          <div className="card-surface rounded-xl p-4">
            <div className="text-xs font-medium text-[#526259]">Open Follow-up Queue</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-[#111C17] mt-2">
              {overview.pendingFollowUpsCount}
            </div>
            <div className="text-[11px] text-[#526259] mt-1">
              {overview.overdueFollowUpsCount} overdue · {overview.highPriorityFollowUpsCount} high priority
            </div>
          </div>

          <div className="card-surface rounded-xl p-4">
            <div className="text-xs font-medium text-[#526259]">Missed Visits (7d)</div>
            <div
              className={`text-2xl font-bold font-mono tabular-nums mt-2 ${
                overview.missedLastSevenDaysCount > 0 ? 'text-[#DC2626]' : 'text-[#047857]'
              }`}
            >
              {overview.missedLastSevenDaysCount}
            </div>
            <div className="text-[11px] text-[#526259] mt-1">
              Across {appointments.length} total clinic records
            </div>
          </div>
        </section>
      )}

      {/* Daily Summary + Department Volume & Confirmation Rate */}
      <section className="card-surface rounded-xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3E8E4] pb-4">
          <div className="flex items-center gap-2.5">
            <FileBarChart className="w-5 h-5 text-[#047857]" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-[#111C17]">
                Operational Reports &amp; Exports
              </h2>
              <p className="text-xs text-[#526259]">
                Computed live from relational SQLite clinic records
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label
              htmlFor="report-date-input"
              className="text-xs font-medium text-[#526259] whitespace-nowrap"
            >
              Summary Date:
            </label>
            <input
              id="report-date-input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 text-sm font-mono border border-[#D4DDD6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
            />
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0B261C] bg-[#ECF4EF] hover:bg-[#DCECE3] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={handleDownloadJson}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#111C17] bg-[#F6F8F6] hover:bg-[#ECF4EF] border border-[#E3E8E4] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
              Export JSON
            </button>
          </div>
        </div>

        {daily && overview && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 space-y-3">
              <h3 className="text-sm font-semibold text-[#111C17]">
                Daily Status Breakdown ({daily.date})
              </h3>
              <div className="divide-y divide-[#E3E8E4] border-y border-[#E3E8E4] text-sm">
                <div className="py-2.5 flex justify-between">
                  <span className="text-[#526259]">Total Appointments</span>
                  <span className="font-mono tabular-nums font-semibold text-[#111C17]">
                    {daily.totalAppointments}
                  </span>
                </div>
                {Object.entries(daily.statusBreakdown).map(([status, count]) => (
                  <div key={status} className="py-2.5 flex justify-between">
                    <span className="text-[#526259]">{status}</span>
                    <span className="font-mono tabular-nums font-medium text-[#111C17]">
                      {count}
                    </span>
                  </div>
                ))}
                <div className="py-2.5 px-2.5 -mx-2.5 flex justify-between bg-[#ECF4EF]/65 rounded-md">
                  <span className="text-[#111C17] font-medium">Clinic Open Follow-ups</span>
                  <span className="font-mono tabular-nums font-semibold text-[#0B261C]">
                    {daily.pendingFollowUps}
                  </span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 space-y-3 lg:pl-6 lg:border-l lg:border-[#E3E8E4]">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#111C17]">
                  Department Volume &amp; Confirmation Rate
                </h3>
                <span className="text-[11px] font-mono text-[#526259]">
                  All scheduled history
                </span>
              </div>
              <DepartmentLoadChart appointments={appointments} />
            </div>
          </div>
        )}
      </section>

      {/* Operational Intelligence & Explainable Reports */}
      {explainable && (
        <section className="card-surface rounded-xl p-6 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#E3E8E4] pb-4">
            <div>
              <h2 className="text-base font-semibold text-[#111C17]">
                Operational Intelligence &amp; Explainable Reports
              </h2>
              <p className="text-xs text-[#526259] mt-0.5">
                Period <span className="font-mono">{explainable.periodStart}</span> to{' '}
                <span className="font-mono">{explainable.periodEnd}</span> vs prior baseline{' '}
                <span className="font-mono">
                  {explainable.compareStart}–{explainable.compareEnd}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="explain-period-start" className="text-xs text-[#526259]">
                From
              </label>
              <input
                id="explain-period-start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono border border-[#D4DAD4] rounded-lg bg-white"
              />
              <label htmlFor="explain-period-end" className="text-xs text-[#526259]">
                To
              </label>
              <input
                id="explain-period-end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono border border-[#D4DAD4] rounded-lg bg-white"
              />
              <button
                type="button"
                disabled={loadingExplainable}
                onClick={handleReloadExplainable}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0B261C] bg-[#ECF4EF] hover:bg-[#DCECE3] rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-[#047857] ${loadingExplainable ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                Reload Analysis
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4]">
              <div className="text-[#526259]">Confirmed / Completed Rate</div>
              <div className="text-xl font-bold font-mono tabular-nums text-[#047857] mt-1">
                {explainable.rawSummary.confirmedOrCompletedRate}%
              </div>
              <div className="text-[11px] text-[#526259] mt-0.5">
                {explainable.rawSummary.completedAppointments} completed of{' '}
                {explainable.rawSummary.totalAppointments}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4]">
              <div className="text-[#526259]">No-Show / Missed Rate</div>
              <div
                className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                  explainable.rawSummary.noShowRate > 12 ? 'text-[#DC2626]' : 'text-[#111C17]'
                }`}
              >
                {explainable.rawSummary.noShowRate}%
              </div>
              <div className="text-[11px] text-[#526259] mt-0.5">
                {explainable.rawSummary.missedAppointments} missed ·{' '}
                {explainable.rawSummary.cancelledAppointments} cancelled
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4]">
              <div className="text-[#526259]">Follow-ups Completed</div>
              <div className="text-xl font-bold font-mono tabular-nums text-[#0B261C] mt-1">
                {explainable.rawSummary.followupsCompletedInPeriod}
              </div>
              <div className="text-[11px] text-[#526259] mt-0.5">
                {explainable.rawSummary.followupsOverdueCount} currently overdue
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4]">
              <div className="text-[#526259]">New Registrations</div>
              <div className="text-xl font-bold font-mono tabular-nums text-[#111C17] mt-1">
                {explainable.rawSummary.newRegistrationsInPeriod}
              </div>
              <div className="text-[11px] text-[#526259] mt-0.5">
                {explainable.rawSummary.activePatients} active clinic patients
              </div>
            </div>
          </div>

          {/* 4-Part Explainable Narrative Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {explainable.sections.map((sec) => (
              <article
                key={sec.id}
                className="p-4 rounded-xl border border-[#E3E8E4] bg-[#F9FBFA] space-y-3"
              >
                <div className="flex items-start justify-between gap-3 border-b border-[#E3E8E4] pb-2.5">
                  <div>
                    <h3 className="text-sm font-semibold text-[#0B261C]">{sec.title}</h3>
                    <div className="text-[11px] text-[#526259] mt-0.5">
                      {sec.headlineMetricLabel} ·{' '}
                      <span className="font-mono text-[#047857]">{sec.comparisonDeltaLabel}</span>
                    </div>
                  </div>
                  <div className="text-lg font-bold font-mono tabular-nums text-[#0B261C] shrink-0">
                    {sec.headlineMetricValue}
                  </div>
                </div>

                {sec.metrics.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-[#34433B]">
                    {sec.metrics.map((m) => (
                      <span key={m.label}>
                        {m.label}: <strong className="text-[#111C17]">{m.value}</strong>
                      </span>
                    ))}
                  </div>
                )}

                <dl className="space-y-1.5 text-xs">
                  <div>
                    <dt className="font-semibold text-[#111C17] inline">What happened: </dt>
                    <dd className="text-[#34433B] inline">{sec.explanation.whatHappened}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-[#111C17] inline">What it means: </dt>
                    <dd className="text-[#34433B] inline">{sec.explanation.whatItMeans}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-[#111C17] inline">Why it matters: </dt>
                    <dd className="text-[#34433B] inline">{sec.explanation.whyItMatters}</dd>
                  </div>
                  <div className="pt-1 text-[#0B261C] bg-[#ECF4EF]/80 px-2.5 py-1.5 rounded-md">
                    <dt className="font-semibold inline">Appropriate action: </dt>
                    <dd className="inline">{sec.explanation.appropriateAction}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          {/* Clinician Capacity & Utilization Table */}
          {explainable.doctorUtilization.length > 0 && (
            <div className="border border-[#E3E8E4] rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-[#F6F8F6] border-b border-[#E3E8E4] flex items-center justify-between">
                <h3 className="text-xs font-semibold text-[#111C17]">
                  Clinician Utilization &amp; Capacity Breakdown
                </h3>
                <span className="text-[11px] font-mono text-[#526259]">
                  {explainable.doctorUtilization.length} clinicians
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E3E8E4] text-[#526259] bg-white">
                      <th className="py-2 px-4">Clinician</th>
                      <th className="py-2 px-4">Department</th>
                      <th className="py-2 px-4 font-mono">Scheduled</th>
                      <th className="py-2 px-4 font-mono">Completed</th>
                      <th className="py-2 px-4 font-mono">Missed</th>
                      <th className="py-2 px-4 font-mono">Period Slots</th>
                      <th className="py-2 px-4 font-mono text-right">Utilization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF2EF]">
                    {explainable.doctorUtilization.map((doc) => (
                      <tr key={doc.staffId} className="hover:bg-[#F6F8F6]">
                        <td className="py-2 px-4 font-medium text-[#111C17]">{doc.doctorName}</td>
                        <td className="py-2 px-4 text-[#526259]">{doc.department}</td>
                        <td className="py-2 px-4 font-mono tabular-nums">
                          {doc.scheduledAppointments}
                        </td>
                        <td className="py-2 px-4 font-mono tabular-nums text-[#047857]">
                          {doc.completedAppointments}
                        </td>
                        <td className="py-2 px-4 font-mono tabular-nums text-[#DC2626]">
                          {doc.missedAppointments}
                        </td>
                        <td className="py-2 px-4 font-mono tabular-nums text-[#526259]">
                          {doc.capacitySlotsInPeriod}
                        </td>
                        <td className="py-2 px-4 font-mono tabular-nums font-semibold text-[#0B261C] text-right">
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
      {overview && (
        <section className="card-surface rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E3E8E4] flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#111C17]">
                Missed Appointments (Last 7 Days)
              </h2>
              <p className="text-xs text-[#526259] mt-0.5">
                Patients flagged for rescheduling outreach and follow-up tracking
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-[#526259]">
              {overview.missedLastSevenDaysCount} record
              {overview.missedLastSevenDaysCount === 1 ? '' : 's'}
            </span>
          </div>

          {overview.missedLastSevenDays.length === 0 ? (
            <p className="text-xs text-[#526259] p-6">
              No missed appointments recorded in the last seven days.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E3E8E4] bg-[#F6F8F6] text-[#526259]">
                    <th className="py-2.5 px-6 whitespace-nowrap">Appointment</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Date · Time</th>
                    <th className="py-2.5 px-4">Patient</th>
                    <th className="py-2.5 px-4">Department · Clinician</th>
                    <th className="py-2.5 px-6 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2EF]">
                  {overview.missedLastSevenDays.map((m) => (
                    <tr key={m.id} className="hover:bg-[#F6F8F6] transition-colors">
                      <td className="py-2.5 px-6 font-mono font-semibold text-[#0B261C] whitespace-nowrap">
                        {m.id}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-[#34433B] whitespace-nowrap">
                        {m.appointmentDate} {m.appointmentTime}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="font-medium text-[#111C17]">{m.patientName}</span>
                        <span className="font-mono text-[#526259]"> · {m.patientId}</span>
                      </td>
                      <td className="py-2.5 px-4 text-[#526259] whitespace-nowrap">
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
          )}
        </section>
      )}

      {/* REST API Reference & Synapse Readiness */}
      <section className="card-surface rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E3E8E4] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Code2 className="w-5 h-5 text-[#0B261C]" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-[#111C17]">
                REST API Reference &amp; Synapse CLI Readiness
              </h2>
              <p className="text-xs text-[#526259]">
                OpenAPI {docs?.openapi ?? '3.0.3'} served live at{' '}
                <code className="font-mono text-[#111C17]">GET /api/docs</code> · Core routes isolated from agent orchestration
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[#047857] shrink-0">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            <span>Synapse MCP Pending</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E3E8E4] bg-[#F6F8F6] text-[#526259]">
                <th className="py-2.5 px-6">Method</th>
                <th className="py-2.5 px-4">Endpoint</th>
                <th className="py-2.5 px-6">Operation Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2EF]">
              {docs &&
                Object.entries(docs.paths).flatMap(([routePath, methods]) =>
                  Object.entries(methods).map(([method, op]) => (
                    <tr key={`${method}-${routePath}`} className="hover:bg-[#F6F8F6]">
                      <td className="py-2.5 px-6 font-mono font-semibold uppercase text-[#047857]">
                        {method}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#111C17]">
                        /api{routePath}
                      </td>
                      <td className="py-2.5 px-6 text-[#526259]">{op.summary}</td>
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
