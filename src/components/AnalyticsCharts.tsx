import { useMemo, useRef, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { Appointment, AppointmentStatus, OverviewReport } from '../shared/types';
import {
  buildSmoothAreaPath,
  buildSmoothBezierPath,
  computeChartDimensions,
  computeDepartmentStats,
  computeDonutSlices,
  computeYAxisScale,
  formatAxisDateLabel,
} from '../utils/chartMath';
import {
  useAnimationProgress,
  useContainerWidth,
  useTweenedNumbers,
} from '../utils/useChartAnimation';
import { computeDualSeriesActivity } from '../utils/workspaceMath';

interface DualSeriesAreaChartProps {
  dailyTrend: OverviewReport['dailyTrend'];
  appointments: Appointment[];
  todayDate: string;
  activeDate: string;
  onSelectDate: (date: string) => void;
}

export function DualSeriesAreaChart({
  dailyTrend,
  appointments,
  todayDate,
  activeDate,
  onSelectDate,
}: DualSeriesAreaChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerWidth = useContainerWidth(containerRef, 560);
  const [filter, setFilter] = useState<'All' | 'New' | 'Follow-up'>('All');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const summary = useMemo(
    () => computeDualSeriesActivity(dailyTrend, appointments, filter),
    [dailyTrend, appointments, filter]
  );

  const pointsData = summary.points;
  const dataSig = useMemo(
    () => pointsData.map((p) => `${p.date}:${p.primary}:${p.secondary}`).join('|'),
    [pointsData]
  );
  const reveal = useAnimationProgress(`dual:${filter}:${dataSig}`, 440);

  const dims = useMemo(
    () => computeChartDimensions(containerWidth, Math.max(2, pointsData.length)),
    [containerWidth, pointsData.length]
  );

  const maxVal = useMemo(
    () => Math.max(4, ...pointsData.map((p) => Math.max(p.primary, p.secondary))),
    [pointsData]
  );
  const yTicks = useMemo(() => computeYAxisScale(maxVal, 4), [maxVal]);

  const primaryTargets = useMemo(() => pointsData.map((p) => p.primary), [pointsData]);
  const secondaryTargets = useMemo(() => pointsData.map((p) => p.secondary), [pointsData]);
  const animPrimary = useTweenedNumbers(primaryTargets, 320);
  const animSecondary = useTweenedNumbers(secondaryTargets, 320);

  const primaryCoords = useMemo(
    () =>
      pointsData.map((p, i) => {
        const x = dims.padLeft + dims.slotW * i + dims.slotW / 2;
        const val = (animPrimary[i] ?? p.primary) * reveal;
        const y = dims.padTop + dims.plotH - (val / yTicks.top) * dims.plotH;
        return { x, y, point: p };
      }),
    [pointsData, dims, animPrimary, reveal, yTicks.top]
  );

  const secondaryCoords = useMemo(
    () =>
      pointsData.map((p, i) => {
        const x = dims.padLeft + dims.slotW * i + dims.slotW / 2;
        const val = (animSecondary[i] ?? p.secondary) * reveal;
        const y = dims.padTop + dims.plotH - (val / yTicks.top) * dims.plotH;
        return { x, y, point: p };
      }),
    [pointsData, dims, animSecondary, reveal, yTicks.top]
  );

  const primaryLine = useMemo(() => buildSmoothBezierPath(primaryCoords), [primaryCoords]);
  const primaryArea = useMemo(
    () => buildSmoothAreaPath(primaryCoords, dims.padTop + dims.plotH),
    [primaryCoords, dims.padTop, dims.plotH]
  );
  const secondaryLine = useMemo(() => buildSmoothBezierPath(secondaryCoords), [secondaryCoords]);
  const secondaryArea = useMemo(
    () => buildSmoothAreaPath(secondaryCoords, dims.padTop + dims.plotH),
    [secondaryCoords, dims.padTop, dims.plotH]
  );

  const hovered = hoveredIndex !== null ? pointsData[hoveredIndex] : null;
  const hoveredX =
    hoveredIndex !== null && primaryCoords[hoveredIndex] ? primaryCoords[hoveredIndex].x : null;
  const tooltipX =
    hoveredX !== null
      ? hoveredX > dims.width * 0.62
        ? Math.max(8, hoveredX - 188)
        : Math.min(dims.width - 188, Math.max(8, hoveredX + 12))
      : 8;

  const renderDeltaBadge = (delta: number) => {
    const isUp = delta >= 0;
    return (
      <span
        className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono tabular-nums ${
          isUp
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80'
            : 'bg-rose-50 text-rose-800 border border-rose-200/80'
        }`}
      >
        {isUp ? (
          <TrendingUp className="w-3 h-3" aria-hidden="true" />
        ) : (
          <TrendingDown className="w-3 h-3" aria-hidden="true" />
        )}
        {delta > 0 ? `+${delta}%` : `${delta}%`}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-[#1C2B25] tracking-tight">
            Patient Visit Activity
          </h3>
          <p className="text-xs text-[#6B7B73] mt-0.5 truncate">
            Scheduled volume vs confirmed &amp; completed visits · Hover or click a day to inspect
          </p>
        </div>

        {/* Segmented Filter Pills (All / New / Follow-up) */}
        <div
          className="inline-flex items-center gap-1 p-1 bg-[#EEF3EF] border border-[#DCE8E0] rounded-full shrink-0 w-fit"
          role="group"
          aria-label="Filter patient activity by appointment type"
        >
          {(['All', 'New', 'Follow-up'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              aria-pressed={filter === tab}
              className={`btn-press px-3.5 py-1.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap ${
                filter === tab
                  ? 'bg-[#0F3D2E] text-white shadow-xs'
                  : 'text-[#6B7B73] hover:text-[#1C2B25]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 2xl:gap-5 items-center">
        {/* Left: Two Small Stat Tiles with % Change Badges */}
        <div className="md:col-span-4 grid grid-cols-2 md:grid-cols-1 gap-3">
          <div className="p-3.5 2xl:p-4 rounded-[20px] bg-[#FAFBF9] border border-[#DCE8E0] space-y-1.5">
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7B73] truncate">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0F3D2E] shrink-0" aria-hidden="true" />
                Total Visits
              </span>
              {renderDeltaBadge(summary.primaryDeltaPct)}
            </div>
            <div className="text-[26px] 2xl:text-[28px] leading-none font-bold font-mono tabular-nums text-[#1C2B25]">
              {summary.totalPrimary}
            </div>
            <p className="text-[11px] text-[#6B7B73] truncate">
              {filter === 'All' ? 'All clinic appointments' : `${filter} appointments in window`}
            </p>
          </div>

          <div className="p-3.5 2xl:p-4 rounded-[20px] bg-[#F2F8F4] border border-[#DCE8E0] space-y-1.5">
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7B73] truncate">
                <span className="w-2.5 h-2.5 rounded-full bg-[#34C38F] shrink-0" aria-hidden="true" />
                Confirmed &amp; Done
              </span>
              {renderDeltaBadge(summary.secondaryDeltaPct)}
            </div>
            <div className="text-[26px] 2xl:text-[28px] leading-none font-bold font-mono tabular-nums text-[#0F3D2E]">
              {summary.totalSecondary}
            </div>
            <p className="text-[11px] text-[#137A55] font-medium truncate">
              {summary.confirmationRatePct}% fulfillment rate
            </p>
          </div>
        </div>

        {/* Right: Smooth Curved Dual-Series Area Chart */}
        <div ref={containerRef} className="md:col-span-8 relative w-full">
          <div
            aria-hidden={!hovered}
            className={`pointer-events-none absolute top-1 z-10 w-[180px] bg-[#0F3D2E] text-white text-[11px] rounded-2xl px-3.5 py-2.5 shadow-lg transition-all duration-150 ${
              hovered ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
            }`}
            style={{ left: `${tooltipX}px` }}
          >
            {hovered && (
              <div className="space-y-1">
                <div className="font-mono font-semibold text-[#A7F3D0] border-b border-white/15 pb-1">
                  {hovered.date}
                  {hovered.date === todayDate ? ' · Today' : ''}
                </div>
                <div className="flex items-center justify-between font-mono tabular-nums">
                  <span className="text-white/80">Total</span>
                  <span className="font-semibold text-white">{hovered.primary}</span>
                </div>
                <div className="flex items-center justify-between font-mono tabular-nums">
                  <span className="text-[#A7F3D0]">Confirmed/Done</span>
                  <span className="font-semibold text-[#34C38F]">{hovered.secondary}</span>
                </div>
              </div>
            )}
          </div>

          {pointsData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center rounded-2xl bg-[#FAFBF9] border border-[#DCE8E0] text-xs text-[#6B7B73]">
              No activity data in current clinic window.
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${dims.width} ${dims.height}`}
              style={{ height: `${dims.height}px` }}
              className="w-full block select-none overflow-visible"
              role="img"
              aria-label="Smooth curved area chart comparing scheduled visits and confirmed or completed outcomes"
            >
              <defs>
                <linearGradient id="cd-area-forest" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0F3D2E" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#0F3D2E" stopOpacity="0.01" />
                </linearGradient>
                <linearGradient id="cd-area-emerald" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34C38F" stopOpacity="0.34" />
                  <stop offset="100%" stopColor="#34C38F" stopOpacity="0.03" />
                </linearGradient>
              </defs>

              {yTicks.ticks.map((tick) => {
                const y = dims.padTop + dims.plotH - (tick / yTicks.top) * dims.plotH;
                return (
                  <g key={tick}>
                    <line
                      x1={dims.padLeft}
                      y1={y}
                      x2={dims.width - dims.padRight}
                      y2={y}
                      stroke={tick === 0 ? '#DCE8E0' : '#EEF3EF'}
                      strokeDasharray={tick === 0 ? undefined : '4 4'}
                      strokeWidth={1}
                    />
                    <text
                      x={dims.padLeft - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      className="fill-[#6B7B73] text-[10px] font-mono tabular-nums"
                    >
                      {tick}
                    </text>
                  </g>
                );
              })}

              {primaryArea && (
                <path d={primaryArea} fill="url(#cd-area-forest)" className="pointer-events-none" />
              )}
              {secondaryArea && (
                <path d={secondaryArea} fill="url(#cd-area-emerald)" className="pointer-events-none" />
              )}
              {primaryLine && (
                <path
                  d={primaryLine}
                  fill="none"
                  stroke="#0F3D2E"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  className="pointer-events-none"
                />
              )}
              {secondaryLine && (
                <path
                  d={secondaryLine}
                  fill="none"
                  stroke="#34C38F"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  className="pointer-events-none"
                />
              )}

              {pointsData.map((pt, idx) => {
                const c1 = primaryCoords[idx];
                const c2 = secondaryCoords[idx];
                const isSelected = pt.date === activeDate;
                const isToday = pt.date === todayDate;
                const isHovered = hoveredIndex === idx;
                const label = formatAxisDateLabel(pt.date, dims.compactLabels, dims.width);

                return (
                  <g
                    key={pt.date}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select ${pt.date}: ${pt.primary} total, ${pt.secondary} confirmed or completed`}
                    aria-pressed={isSelected}
                    className="cursor-pointer focus:outline-none"
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onFocus={() => setHoveredIndex(idx)}
                    onBlur={() => setHoveredIndex(null)}
                    onClick={() => onSelectDate(pt.date)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectDate(pt.date);
                      }
                    }}
                  >
                    {(isHovered || isSelected) && (
                      <line
                        x1={c1.x}
                        y1={dims.padTop}
                        x2={c1.x}
                        y2={dims.padTop + dims.plotH}
                        stroke={isSelected ? '#34C38F' : '#8CA398'}
                        strokeWidth={1.3}
                        strokeDasharray="4 4"
                      />
                    )}
                    <rect
                      x={c1.x - dims.slotW / 2}
                      y={dims.padTop}
                      width={dims.slotW}
                      height={dims.plotH}
                      fill="transparent"
                    />
                    <circle
                      cx={c1.x}
                      cy={c1.y}
                      r={isHovered || isSelected ? 5 : 3}
                      fill="#FFFFFF"
                      stroke="#0F3D2E"
                      strokeWidth={2.2}
                    />
                    <circle
                      cx={c2.x}
                      cy={c2.y}
                      r={isHovered || isSelected ? 5 : 3}
                      fill="#FFFFFF"
                      stroke="#34C38F"
                      strokeWidth={2.2}
                    />
                    <text
                      x={c1.x}
                      y={dims.height - 12}
                      textAnchor="middle"
                      className={`text-[10px] font-mono tabular-nums ${
                        isSelected || isToday
                          ? 'fill-[#0F3D2E] font-semibold'
                          : 'fill-[#6B7B73]'
                      }`}
                    >
                      {label}
                    </text>
                    {isToday && (
                      <circle cx={c1.x} cy={dims.height - 4} r={2} fill="#34C38F" />
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

export function MiniWeekAreaChart({
  dailyTrend,
}: {
  dailyTrend: OverviewReport['dailyTrend'];
}) {
  const slice = useMemo(() => dailyTrend.slice(-7), [dailyTrend]);
  const total = useMemo(() => slice.reduce((sum, d) => sum + d.total, 0), [slice]);
  const width = 240;
  const height = 72;
  const max = Math.max(3, ...slice.map((d) => d.total));

  const pts = useMemo(
    () =>
      slice.map((d, idx) => {
        const x = slice.length > 1 ? 10 + (idx / (slice.length - 1)) * (width - 20) : width / 2;
        const y = height - 12 - (d.total / max) * (height - 26);
        return { x, y };
      }),
    [slice, max]
  );

  const line = useMemo(() => buildSmoothBezierPath(pts), [pts]);
  const area = useMemo(() => buildSmoothAreaPath(pts, height - 8), [pts]);

  return (
    <div className="rounded-[22px] bg-gradient-to-br from-[#0F3D2E] via-[#134D3A] to-[#1D6B50] text-white p-4 space-y-2 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-emerald-100/80">Appointments this week</div>
          <div className="text-2xl font-bold font-mono tabular-nums leading-tight mt-0.5">
            {total}
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-semibold text-[#A7F3D0]">
          7d pace
        </span>
      </div>
      {slice.length > 1 ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-16 overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id="cd-mini-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34C38F" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#34C38F" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {area && <path d={area} fill="url(#cd-mini-grad)" />}
          {line && (
            <path
              d={line}
              fill="none"
              stroke="#6EE7B7"
              strokeWidth={2.2}
              strokeLinecap="round"
            />
          )}
          {pts.map((pt, i) => (
            <circle key={i} cx={pt.x} cy={pt.y} r={2.4} fill="#FFFFFF" stroke="#0F3D2E" strokeWidth={1.2} />
          ))}
        </svg>
      ) : (
        <p className="text-[11px] text-emerald-100/75 py-2">Awaiting weekly activity.</p>
      )}
    </div>
  );
}

interface AppointmentActivityChartProps {
  dailyTrend: OverviewReport['dailyTrend'];
  todayDate: string;
  activeDate: string;
  onSelectDate: (date: string) => void;
}

export function AppointmentActivityChart({
  dailyTrend,
  todayDate,
  activeDate,
  onSelectDate,
}: AppointmentActivityChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerWidth = useContainerWidth(containerRef, 620);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [chartView, setChartView] = useState<'breakdown' | 'trend'>('trend');

  const hasAnyVisits = useMemo(() => dailyTrend.some((d) => d.total > 0), [dailyTrend]);

  const dataKey = useMemo(
    () => dailyTrend.map((d) => `${d.date}:${d.total}:${d.confirmed + d.completed}`).join('|'),
    [dailyTrend]
  );
  const reveal = useAnimationProgress(`activity:${chartView}:${dataKey}`, 420);

  const dims = useMemo(
    () => computeChartDimensions(containerWidth, dailyTrend.length),
    [containerWidth, dailyTrend.length]
  );

  const maxTotal = useMemo(() => Math.max(4, ...dailyTrend.map((d) => d.total)), [dailyTrend]);
  const yTicks = useMemo(() => computeYAxisScale(maxTotal, 4), [maxTotal]);

  const totalTargets = useMemo(() => dailyTrend.map((d) => d.total), [dailyTrend]);
  const confirmedTargets = useMemo(
    () => dailyTrend.map((d) => d.confirmed + d.completed),
    [dailyTrend]
  );

  const animatedTotal = useTweenedNumbers(totalTargets, 320);
  const animatedConfirmed = useTweenedNumbers(confirmedTargets, 320);

  const totalPoints = useMemo(
    () =>
      dailyTrend.map((day, i) => {
        const x = dims.padLeft + dims.slotW * i + dims.slotW / 2;
        const val = (animatedTotal[i] ?? day.total) * reveal;
        const y = dims.padTop + dims.plotH - (val / yTicks.top) * dims.plotH;
        return { x, y, day, metric: day.total };
      }),
    [dailyTrend, dims, animatedTotal, reveal, yTicks.top]
  );

  const confirmedPoints = useMemo(
    () =>
      dailyTrend.map((day, i) => {
        const x = dims.padLeft + dims.slotW * i + dims.slotW / 2;
        const target = day.confirmed + day.completed;
        const val = (animatedConfirmed[i] ?? target) * reveal;
        const y = dims.padTop + dims.plotH - (val / yTicks.top) * dims.plotH;
        return { x, y, day, metric: target };
      }),
    [dailyTrend, dims, animatedConfirmed, reveal, yTicks.top]
  );

  const totalLinePath = useMemo(() => buildSmoothBezierPath(totalPoints), [totalPoints]);
  const totalAreaPath = useMemo(
    () => buildSmoothAreaPath(totalPoints, dims.padTop + dims.plotH),
    [totalPoints, dims.padTop, dims.plotH]
  );
  const confirmedLinePath = useMemo(
    () => buildSmoothBezierPath(confirmedPoints),
    [confirmedPoints]
  );

  if (dailyTrend.length === 0 || !hasAnyVisits) {
    return (
      <div className="h-[220px] flex flex-col items-center justify-center text-center px-4 rounded-2xl bg-[#FAFBF9] border border-[#DCE8E0]">
        <p className="text-sm font-medium text-[#1C2B25]">No appointment activity in this window</p>
        <p className="text-xs text-[#6B7B73] mt-1 max-w-sm">
          Schedule appointments within the current clinic window to populate volume analytics.
        </p>
      </div>
    );
  }

  const hoveredDay = hoveredIndex !== null ? dailyTrend[hoveredIndex] : null;
  const hoveredConfirmationRate = hoveredDay
    ? hoveredDay.total > 0
      ? Math.round(((hoveredDay.confirmed + hoveredDay.completed) / hoveredDay.total) * 100)
      : 0
    : 0;
  const tooltipX =
    hoveredIndex !== null && totalPoints[hoveredIndex]
      ? totalPoints[hoveredIndex].x > dims.width * 0.62
        ? Math.max(8, totalPoints[hoveredIndex].x - 216)
        : Math.min(dims.width - 216, Math.max(8, totalPoints[hoveredIndex].x + 14))
      : 8;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#6B7B73]">
          {chartView === 'breakdown' ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0F3D2E]" aria-hidden="true" />
                Confirmed / Done
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" aria-hidden="true" />
                Scheduled
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" aria-hidden="true" />
                Missed
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3.5 h-0.5 bg-[#0F3D2E] rounded-full" aria-hidden="true" />
                Total Appointments
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3.5 h-0.5 bg-[#34C38F] rounded-full" aria-hidden="true" />
                Confirmed / Completed
              </span>
            </>
          )}
        </div>

        <div
          className="inline-flex items-center gap-1 p-1 bg-[#EEF3EF] border border-[#DCE8E0] rounded-full"
          role="group"
          aria-label="Appointment chart visualization type"
        >
          <button
            type="button"
            onClick={() => setChartView('trend')}
            aria-pressed={chartView === 'trend'}
            className={`btn-press px-3 py-1 text-[11px] font-semibold rounded-full transition-colors whitespace-nowrap ${
              chartView === 'trend'
                ? 'bg-[#0F3D2E] text-white'
                : 'text-[#6B7B73] hover:text-[#1C2B25]'
            }`}
          >
            Smooth Curve
          </button>
          <button
            type="button"
            onClick={() => setChartView('breakdown')}
            aria-pressed={chartView === 'breakdown'}
            className={`btn-press px-3 py-1 text-[11px] font-semibold rounded-full transition-colors whitespace-nowrap ${
              chartView === 'breakdown'
                ? 'bg-[#0F3D2E] text-white'
                : 'text-[#6B7B73] hover:text-[#1C2B25]'
            }`}
          >
            Stacked Bars
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative w-full">
        <div
          aria-hidden={!hoveredDay}
          className={`pointer-events-none absolute top-1 z-10 w-[208px] max-w-[calc(100%-16px)] bg-[#0F3D2E] text-white text-[11px] rounded-2xl px-3.5 py-2.5 shadow-lg transition-all duration-150 ${
            hoveredDay ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
          }`}
          style={{ left: `${tooltipX}px` }}
        >
          {hoveredDay && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 border-b border-white/15 pb-1">
                <span className="font-mono font-semibold text-[#A7F3D0]">
                  {hoveredDay.date}
                  {hoveredDay.date === todayDate ? ' · Today' : ''}
                </span>
                <span className="font-mono tabular-nums text-white font-semibold">
                  {hoveredDay.total} total
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono tabular-nums text-[10.5px]">
                <span className="text-[#34C38F]">
                  Conf/Done: {hoveredDay.confirmed + hoveredDay.completed}
                </span>
                <span className="text-amber-200">Sched: {hoveredDay.scheduled}</span>
                <span className="text-rose-300">Missed: {hoveredDay.missed}</span>
                <span className="text-emerald-100/75">Rate: {hoveredConfirmationRate}%</span>
              </div>
            </div>
          )}
        </div>

        <svg
          viewBox={`0 0 ${dims.width} ${dims.height}`}
          style={{ height: `${dims.height}px` }}
          className="w-full block select-none overflow-visible"
          role="img"
          aria-label="Appointment trend visualization"
        >
          {yTicks.ticks.map((tick) => {
            const y = dims.padTop + dims.plotH - (tick / yTicks.top) * dims.plotH;
            return (
              <g key={tick}>
                <line
                  x1={dims.padLeft}
                  y1={y}
                  x2={dims.width - dims.padRight}
                  y2={y}
                  stroke={tick === 0 ? '#DCE8E0' : '#EEF3EF'}
                  strokeDasharray={tick === 0 ? undefined : '4 4'}
                  strokeWidth={1}
                />
                <text
                  x={dims.padLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-[#6B7B73] text-[10px] font-mono tabular-nums"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {chartView === 'breakdown' ? (
            dailyTrend.map((day, idx) => {
              const cx = dims.padLeft + dims.slotW * idx + dims.slotW / 2;
              const bx = cx - dims.barW / 2;
              const isSelected = day.date === activeDate;
              const isToday = day.date === todayDate;
              const isHovered = hoveredIndex === idx;

              const positive = day.completed + day.confirmed;
              const posH = ((positive * reveal) / yTicks.top) * dims.plotH;
              const schedH = ((day.scheduled * reveal) / yTicks.top) * dims.plotH;
              const missedH = ((day.missed * reveal) / yTicks.top) * dims.plotH;
              const cancelH = ((day.cancelled * reveal) / yTicks.top) * dims.plotH;

              let cursorY = dims.padTop + dims.plotH;
              const yPos = cursorY - posH;
              cursorY = yPos;
              const ySched = cursorY - schedH;
              cursorY = ySched;
              const yMissed = cursorY - missedH;
              cursorY = yMissed;
              const yCancel = cursorY - cancelH;

              const dateLabel = formatAxisDateLabel(day.date, dims.compactLabels, dims.width);

              return (
                <g
                  key={day.date}
                  role="button"
                  tabIndex={0}
                  aria-label={`Filter to ${day.date} (${day.total} appointments)`}
                  aria-pressed={isSelected}
                  className="cursor-pointer focus:outline-none"
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => onSelectDate(day.date)}
                >
                  <rect
                    x={cx - dims.slotW / 2 + 2}
                    y={dims.padTop}
                    width={Math.max(10, dims.slotW - 4)}
                    height={dims.plotH}
                    rx={8}
                    fill={isSelected ? '#E9F4EE' : isHovered ? '#F4F8F5' : 'transparent'}
                  />
                  {posH > 0 && <rect x={bx} y={yPos} width={dims.barW} height={posH} rx={3} fill="#0F3D2E" />}
                  {schedH > 0 && <rect x={bx} y={ySched} width={dims.barW} height={schedH} rx={2} fill="#F59E0B" />}
                  {missedH > 0 && <rect x={bx} y={yMissed} width={dims.barW} height={missedH} rx={2} fill="#F43F5E" />}
                  {cancelH > 0 && <rect x={bx} y={yCancel} width={dims.barW} height={cancelH} rx={2} fill="#CBD5E1" />}
                  <text
                    x={cx}
                    y={dims.height - 12}
                    textAnchor="middle"
                    className={`text-[10px] font-mono tabular-nums ${
                      isSelected || isToday ? 'fill-[#0F3D2E] font-semibold' : 'fill-[#6B7B73]'
                    }`}
                  >
                    {dateLabel}
                  </text>
                </g>
              );
            })
          ) : (
            <>
              {totalAreaPath && (
                <path d={totalAreaPath} fill="#0F3D2E" opacity={0.08 * reveal} className="pointer-events-none" />
              )}
              {totalLinePath && (
                <path
                  d={totalLinePath}
                  fill="none"
                  stroke="#0F3D2E"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  className="pointer-events-none"
                />
              )}
              {confirmedLinePath && (
                <path
                  d={confirmedLinePath}
                  fill="none"
                  stroke="#34C38F"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  className="pointer-events-none"
                />
              )}
              {dailyTrend.map((day, idx) => {
                const cx = dims.padLeft + dims.slotW * idx + dims.slotW / 2;
                const totalPt = totalPoints[idx];
                const confPt = confirmedPoints[idx];
                const isSelected = day.date === activeDate;
                const isToday = day.date === todayDate;
                const isHovered = hoveredIndex === idx;
                const dateLabel = formatAxisDateLabel(day.date, dims.compactLabels, dims.width);

                return (
                  <g
                    key={day.date}
                    role="button"
                    tabIndex={0}
                    aria-label={`Focus ${day.date}`}
                    aria-pressed={isSelected}
                    className="cursor-pointer focus:outline-none"
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onClick={() => onSelectDate(day.date)}
                  >
                    {(isHovered || isSelected) && (
                      <line
                        x1={cx}
                        y1={dims.padTop}
                        x2={cx}
                        y2={dims.padTop + dims.plotH}
                        stroke={isSelected ? '#34C38F' : '#8CA398'}
                        strokeWidth={1.2}
                        strokeDasharray="4 4"
                      />
                    )}
                    <rect
                      x={cx - dims.slotW / 2}
                      y={dims.padTop}
                      width={dims.slotW}
                      height={dims.plotH}
                      fill="transparent"
                    />
                    <circle cx={totalPt.x} cy={totalPt.y} r={isHovered ? 4.5 : 3} fill="#FFFFFF" stroke="#0F3D2E" strokeWidth={2} />
                    <circle cx={confPt.x} cy={confPt.y} r={isHovered ? 4.5 : 3} fill="#FFFFFF" stroke="#34C38F" strokeWidth={2} />
                    <text
                      x={cx}
                      y={dims.height - 12}
                      textAnchor="middle"
                      className={`text-[10px] font-mono tabular-nums ${
                        isSelected || isToday ? 'fill-[#0F3D2E] font-semibold' : 'fill-[#6B7B73]'
                      }`}
                    >
                      {dateLabel}
                    </text>
                  </g>
                );
              })}
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

interface StatusDonutChartProps {
  statusBreakdown: Record<AppointmentStatus, number>;
  totalInWindow: number;
  onSelectStatus?: (status: AppointmentStatus) => void;
}

const DONUT_SEGMENTS: Array<{
  key: AppointmentStatus;
  label: string;
  color: string;
}> = [
  { key: 'Confirmed', label: 'Confirmed', color: '#34C38F' },
  { key: 'Completed', label: 'Completed', color: '#0EA5E9' },
  { key: 'Scheduled', label: 'Pending', color: '#F59E0B' },
  { key: 'Missed', label: 'Missed', color: '#F43F5E' },
  { key: 'Cancelled', label: 'Cancelled', color: '#CBD5E1' },
];

export function StatusDonutChart({
  statusBreakdown,
  totalInWindow,
  onSelectStatus,
}: StatusDonutChartProps) {
  const [hoveredKey, setHoveredKey] = useState<AppointmentStatus | null>(null);
  const radius = 52;
  const stroke = 14;
  const circumference = 2 * Math.PI * radius;

  const dataSig = useMemo(
    () => `${totalInWindow}:${DONUT_SEGMENTS.map((s) => statusBreakdown[s.key] ?? 0).join(',')}`,
    [statusBreakdown, totalInWindow]
  );
  const reveal = useAnimationProgress(`donut:${dataSig}`, 440);

  const slices = useMemo(
    () =>
      computeDonutSlices(DONUT_SEGMENTS, statusBreakdown, totalInWindow, circumference, reveal),
    [statusBreakdown, totalInWindow, circumference, reveal]
  );

  if (totalInWindow <= 0) {
    return (
      <div className="py-6 px-4 rounded-2xl bg-[#FAFBF9] border border-[#DCE8E0] text-center">
        <p className="text-sm font-medium text-[#1C2B25]">No appointments in current window</p>
      </div>
    );
  }

  const activeSlice = slices.find((s) => s.key === hoveredKey);

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="relative w-32 h-32 sm:w-36 sm:h-36 shrink-0 flex items-center justify-center">
        <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90" role="img" aria-label="Appointment status distribution ring">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="#EEF3EF" strokeWidth={stroke} />
          {slices.map((s) => {
            if (s.value <= 0) return null;
            const isActive = hoveredKey === s.key;
            const dashLength = Math.max(2.5, s.length - 1.5);
            return (
              <circle
                key={s.key}
                role="button"
                tabIndex={0}
                aria-label={`${s.label}: ${s.value} visits (${s.pct}%)`}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={isActive ? stroke + 3 : stroke}
                strokeDasharray={`${dashLength} ${circumference}`}
                strokeDashoffset={-s.offset}
                className="cursor-pointer transition-[stroke-width,opacity] duration-150 focus:outline-none"
                opacity={hoveredKey && !isActive ? 0.55 : 1}
                onMouseEnter={() => setHoveredKey(s.key)}
                onMouseLeave={() => setHoveredKey(null)}
                onClick={() => onSelectStatus?.(s.key)}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-3">
          <span className="text-xl font-bold font-mono tabular-nums text-[#0F3D2E] leading-none">
            {activeSlice ? activeSlice.value : totalInWindow}
          </span>
          <span className="text-[10px] font-medium text-[#6B7B73] mt-1 leading-tight">
            {activeSlice ? `${activeSlice.label} · ${activeSlice.pct}%` : 'Window Visits'}
          </span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-1 min-w-0">
        {slices.map((s) => {
          const isActive = hoveredKey === s.key;
          const isZero = s.value === 0;
          return (
            <button
              key={s.key}
              type="button"
              disabled={isZero}
              onMouseEnter={() => !isZero && setHoveredKey(s.key)}
              onMouseLeave={() => setHoveredKey(null)}
              onClick={() => !isZero && onSelectStatus?.(s.key)}
              className={`btn-press w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                isZero ? 'opacity-50 cursor-default' : isActive ? 'bg-[#EEF3EF]' : 'hover:bg-[#FAFBF9]'
              }`}
            >
              <span className="inline-flex items-center gap-2 text-[#1C2B25] truncate">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} aria-hidden="true" />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="font-mono tabular-nums text-[#1C2B25] font-semibold whitespace-nowrap shrink-0">
                {s.value} <span className="text-[#6B7B73] text-[11px] font-normal">({s.pct}%)</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DepartmentLoadChart({ appointments }: { appointments: Appointment[] }) {
  const [hoveredDept, setHoveredDept] = useState<string | null>(null);
  const rows = useMemo(() => computeDepartmentStats(appointments), [appointments]);
  const sig = useMemo(
    () => rows.map((r) => `${r.department}:${r.total}:${r.confirmedDone}`).join('|'),
    [rows]
  );
  const reveal = useAnimationProgress(`dept:${sig}`, 420);
  const maxTotal = Math.max(1, ...rows.map((r) => r.total));

  if (rows.length === 0) {
    return (
      <div className="py-6 px-4 rounded-2xl bg-[#FAFBF9] border border-[#DCE8E0] text-center">
        <p className="text-sm font-medium text-[#1C2B25]">No department appointment history</p>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#6B7B73]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#34C38F]" aria-hidden="true" />
          Confirmed / Done
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#DCE8E0]" aria-hidden="true" />
          Other Visits
        </span>
      </div>

      <div className="space-y-2.5">
        {rows.map((row) => {
          const totalRatio = (row.total / maxTotal) * reveal;
          const confirmedRatio = (row.confirmedDone / maxTotal) * reveal;
          const isHovered = hoveredDept === row.department;

          return (
            <div
              key={row.department}
              onMouseEnter={() => setHoveredDept(row.department)}
              onMouseLeave={() => setHoveredDept(null)}
              className={`space-y-1.5 px-3 py-2 rounded-2xl transition-colors ${
                isHovered ? 'bg-[#F2F7F3]' : ''
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                <span className="font-semibold text-[#1C2B25]">{row.department}</span>
                <span className="font-mono tabular-nums text-[#6B7B73] whitespace-nowrap">
                  {row.total} visits ·{' '}
                  <span className="text-[#137A55] font-semibold">{row.confirmedPct}% conf/done</span>
                  {row.missed > 0 && <span className="text-rose-700"> · {row.missed} missed</span>}
                </span>
              </div>
              <div className="relative h-2.5 w-full rounded-full bg-[#EEF3EF] overflow-hidden">
                <div
                  style={{ transform: `scaleX(${Math.max(0.02, totalRatio)})` }}
                  className="absolute inset-0 origin-left rounded-full bg-[#DCE8E0]"
                />
                {row.confirmedDone > 0 && (
                  <div
                    style={{ transform: `scaleX(${Math.max(0.02, confirmedRatio)})` }}
                    className={`absolute inset-0 origin-left rounded-full transition-colors ${
                      isHovered ? 'bg-[#0F3D2E]' : 'bg-[#34C38F]'
                    }`}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
