import { useCallback, useEffect, useState } from 'react';
import { Code2, Download, FileBarChart, FileSpreadsheet } from 'lucide-react';
import {
  fetchDailyReport,
  fetchOpenApiDocs,
  fetchOverviewReport,
} from '../client/api';
import type { DailyReport, OverviewReport } from '../shared/types';
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
  const [docs, setDocs] = useState<{
    openapi: string;
    info: { title: string; version: string; description: string };
    paths: Record<string, Record<string, { summary?: string }>>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const [dailyData, overviewData, openApiData] = await Promise.all([
        fetchDailyReport(selectedDate),
        fetchOverviewReport(),
        fetchOpenApiDocs(),
      ]);
      setDaily(dailyData);
      setOverview(overviewData);
      setDocs(openApiData);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load reports.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, onErrorNotice]);

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
    return <div className="h-64 bg-white border border-[#E4E7E2] rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      {/* Daily & Overview Reports */}
      <section className="bg-white border border-[#E4E7E2] rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4E7E2] pb-4">
          <div className="flex items-center gap-2.5">
            <FileBarChart className="w-5 h-5 text-[#047857]" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-[#16211C]">
                Operational Reports
              </h2>
              <p className="text-xs text-[#526058]">
                Generated directly from live relational SQLite records
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label
              htmlFor="report-date-input"
              className="text-xs font-medium text-[#526058] whitespace-nowrap"
            >
              Summary Date:
            </label>
            <input
              id="report-date-input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 text-sm border border-[#D4DDD6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
            />
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#16211C] bg-[#EDF4F0] hover:bg-[#DCECE3] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={handleDownloadJson}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#16211C] bg-[#F7F8F6] hover:bg-[#EDF4F0] border border-[#E4E7E2] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
              Export JSON
            </button>
          </div>
        </div>

        {daily && overview && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-semibold text-[#16211C] mb-3">
                Daily Status Breakdown ({daily.date})
              </h3>
              <div className="border border-[#E4E7E2] rounded-lg divide-y divide-[#E4E7E2] text-sm overflow-hidden">
                <div className="px-4 py-2.5 flex justify-between">
                  <span className="text-[#526058]">Total Appointments</span>
                  <span className="font-mono tabular-nums font-semibold text-[#16211C]">
                    {daily.totalAppointments}
                  </span>
                </div>
                {Object.entries(daily.statusBreakdown).map(([status, count]) => (
                  <div key={status} className="px-4 py-2.5 flex justify-between">
                    <span className="text-[#526058]">{status}</span>
                    <span className="font-mono tabular-nums font-medium text-[#16211C]">
                      {count}
                    </span>
                  </div>
                ))}
                <div className="px-4 py-2.5 flex justify-between bg-[#EDF4F0]/60">
                  <span className="text-[#16211C] font-medium">Clinic Open Follow-ups</span>
                  <span className="font-mono tabular-nums font-semibold text-[#0C291E]">
                    {daily.pendingFollowUps}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[#16211C] mb-3">
                Missed Appointments (Last 7 Days · {overview.missedLastSevenDaysCount})
              </h3>
              {overview.missedLastSevenDays.length === 0 ? (
                <p className="text-xs text-[#526058] p-4 border border-[#E4E7E2] rounded-lg">
                  No missed appointments recorded in the last seven days.
                </p>
              ) : (
                <div className="border border-[#E4E7E2] rounded-lg overflow-x-auto max-w-full">
                  <table className="w-full min-w-[480px] text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#E4E7E2] bg-[#F7F8F6] text-[#526058]">
                        <th className="py-2 px-3 whitespace-nowrap">Date</th>
                        <th className="py-2 px-3">Patient</th>
                        <th className="py-2 px-3">Department</th>
                        <th className="py-2 px-3 whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4E7E2]">
                      {overview.missedLastSevenDays.map((m) => (
                        <tr key={m.id}>
                          <td className="py-2 px-3 font-mono tabular-nums text-[#2E3C34] whitespace-nowrap">
                            {m.appointmentDate} {m.appointmentTime}
                          </td>
                          <td className="py-2 px-3">
                            <span className="font-medium text-[#16211C]">{m.patientName}</span>
                            <span className="font-mono text-[#526058]"> · {m.patientId}</span>
                          </td>
                          <td className="py-2 px-3 text-[#526058] whitespace-nowrap">
                            {m.department}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <AppointmentStatusText status={m.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* REST API Reference & Synapse Readiness */}
      <section className="bg-white border border-[#E4E7E2] rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E4E7E2] pb-4">
          <div className="flex items-center gap-2.5">
            <Code2 className="w-5 h-5 text-[#0C291E]" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-[#16211C]">
                REST API Reference &amp; Synapse CLI Readiness
              </h2>
              <p className="text-xs text-[#526058]">
                OpenAPI {docs?.openapi ?? '3.0.3'} available at{' '}
                <code className="font-mono text-[#16211C]">GET /api/docs</code> · Core endpoints isolated from agent orchestration
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto border border-[#E4E7E2] rounded-lg">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E4E7E2] bg-[#F7F8F6] text-[#526058]">
                <th className="py-2.5 px-4">Method</th>
                <th className="py-2.5 px-4">Endpoint</th>
                <th className="py-2.5 px-4">Operation Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E7E2]">
              {docs &&
                Object.entries(docs.paths).flatMap(([routePath, methods]) =>
                  Object.entries(methods).map(([method, op]) => (
                    <tr key={`${method}-${routePath}`}>
                      <td className="py-2.5 px-4 font-mono font-semibold uppercase text-[#047857]">
                        {method}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#16211C]">
                        /api{routePath}
                      </td>
                      <td className="py-2.5 px-4 text-[#526058]">{op.summary}</td>
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
