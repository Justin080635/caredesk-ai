import { useMemo, useRef, useState } from 'react';
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
  const [chartView, setChartView] = useState<'breakdown' | 'trend'>('breakdown');

  const hasAnyVisits = useMemo(
    () => dailyTrend.some((d) => d.total > 0),
    [dailyTrend]
  );

  const dataKey = useMemo(
    () => dailyTrend.map((d) => `${d.date}:${d.total}:${d.confirmed + d.completed}`).join('|'),
    [dailyTrend]
  );
  const reveal = useAnimationProgress(`activity:${chartView}:${dataKey}`, 420);

  const dims = useMemo(
    () => computeChartDimensions(containerWidth, dailyTrend.length),
    [containerWidth, dailyTrend.length]
  );

  const maxTotal = useMemo(
    () => Math.max(4, ...dailyTrend.map((d) => d.total)),
    [dailyTrend]
  );

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
      <div className="h-[220px] flex flex-col items-center justify-center text-center px-4 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4]">
        <p className="text-sm font-medium text-[#111C17]">No appointment activity in this window</p>
        <p className="text-xs text-[#526259] mt-1 max-w-sm">
          Schedule or import appointments within the current clinic window to populate daily volume and status breakdowns.
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
        {chartView === 'breakdown' ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#526259]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#0B261C]" aria-hidden="true" />
              Confirmed / Done
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#D97706]" aria-hidden="true" />
              Scheduled
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#DC2626]" aria-hidden="true" />
              Missed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#CBD5E1]" aria-hidden="true" />
              Cancelled
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#526259]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 bg-[#0B261C] rounded-full" aria-hidden="true" />
              Total Appointments
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 bg-[#059669] rounded-full" aria-hidden="true" />
              Confirmed / Completed
            </span>
          </div>
        )}

        <div
          className="inline-flex items-center gap-1 p-0.5 bg-[#F1F5F2] rounded-lg"
          role="group"
          aria-label="Appointment chart visualization type"
        >
          <button
            type="button"
            onClick={() => setChartView('breakdown')}
            aria-pressed={chartView === 'breakdown'}
            className={`btn-press px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
              chartView === 'breakdown'
                ? 'bg-white text-[#0B261C] shadow-xs'
                : 'text-[#526259] hover:text-[#111C17]'
            }`}
          >
            Daily Breakdown
          </button>
          <button
            type="button"
            onClick={() => setChartView('trend')}
            aria-pressed={chartView === 'trend'}
            className={`btn-press px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
              chartView === 'trend'
                ? 'bg-white text-[#0B261C] shadow-xs'
                : 'text-[#526259] hover:text-[#111C17]'
            }`}
          >
            Volume Trend
          </button>
        </div>
      </div>

      {/* Responsive Interactive SVG Container */}
      <div ref={containerRef} className="relative w-full">
        <div
          aria-hidden={!hoveredDay}
          className={`pointer-events-none absolute top-1 z-10 w-[208px] max-w-[calc(100%-16px)] bg-[#0B261C] text-white text-[11px] rounded-lg px-3 py-2.5 shadow-md transition-all duration-150 ${
            hoveredDay ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
          }`}
          style={{ left: `${tooltipX}px` }}
        >
          {hoveredDay && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 border-b border-white/15 pb-1">
                <span className="font-mono font-semibold text-emerald-200">
                  {hoveredDay.date}
                  {hoveredDay.date === todayDate ? ' · Today' : ''}
                </span>
                <span className="font-mono tabular-nums text-white font-semibold">
                  {hoveredDay.total} total
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono tabular-nums text-[10.5px]">
                <span className="text-emerald-300">
                  Conf/Done: {hoveredDay.confirmed + hoveredDay.completed}
                </span>
                <span className="text-amber-200">Sched: {hoveredDay.scheduled}</span>
                <span className="text-red-300">Missed: {hoveredDay.missed}</span>
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
          aria-label={
            chartView === 'breakdown'
              ? 'Stacked bar chart of daily appointment composition across clinic dates'
              : 'Line chart comparing total and confirmed appointment trends over time'
          }
        >
          {/* Horizontal Gridlines & Y-Axis Ticks */}
          {yTicks.ticks.map((tick) => {
            const y = dims.padTop + dims.plotH - (tick / yTicks.top) * dims.plotH;
            return (
              <g key={tick}>
                <line
                  x1={dims.padLeft}
                  y1={y}
                  x2={dims.width - dims.padRight}
                  y2={y}
                  stroke={tick === 0 ? '#CBD6CE' : '#EEF2EF'}
                  strokeWidth={1}
                />
                <text
                  x={dims.padLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-[#64746B] text-[10px] font-mono tabular-nums"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {chartView === 'breakdown' ? (
            /* Stacked Bar Chart */
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

              const dateLabel = formatAxisDateLabel(
                day.date,
                dims.compactLabels,
                dims.width
              );

              return (
                <g
                  key={day.date}
                  role="button"
                  tabIndex={0}
                  aria-label={`Filter dashboard to ${day.date} (${day.total} appointments, ${positive} confirmed or completed)`}
                  aria-pressed={isSelected}
                  className="cursor-pointer focus:outline-none"
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onFocus={() => setHoveredIndex(idx)}
                  onBlur={() => setHoveredIndex(null)}
                  onClick={() => onSelectDate(day.date)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectDate(day.date);
                    }
                  }}
                >
                  <rect
                    x={cx - dims.slotW / 2 + 2}
                    y={dims.padTop}
                    width={Math.max(10, dims.slotW - 4)}
                    height={dims.plotH}
                    rx={6}
                    fill={isSelected ? '#ECF4EF' : isHovered ? '#F4F8F5' : 'transparent'}
                    className="transition-colors duration-150"
                  />

                  {posH > 0 && (
                    <rect
                      x={bx}
                      y={yPos}
                      width={dims.barW}
                      height={posH}
                      rx={2}
                      fill="#0B261C"
                      opacity={isHovered || isSelected ? 1 : 0.92}
                      className="transition-opacity duration-150"
                    />
                  )}
                  {schedH > 0 && (
                    <rect
                      x={bx}
                      y={ySched}
                      width={dims.barW}
                      height={schedH}
                      rx={1.5}
                      fill="#D97706"
                      opacity={isHovered || isSelected ? 1 : 0.9}
                      className="transition-opacity duration-150"
                    />
                  )}
                  {missedH > 0 && (
                    <rect
                      x={bx}
                      y={yMissed}
                      width={dims.barW}
                      height={missedH}
                      rx={1.5}
                      fill="#DC2626"
                      opacity={isHovered || isSelected ? 1 : 0.92}
                      className="transition-opacity duration-150"
                    />
                  )}
                  {cancelH > 0 && (
                    <rect
                      x={bx}
                      y={yCancel}
                      width={dims.barW}
                      height={cancelH}
                      rx={1.5}
                      fill="#CBD5E1"
                      className="transition-opacity duration-150"
                    />
                  )}

                  <text
                    x={cx}
                    y={Math.max(13, cursorY - 6)}
                    textAnchor="middle"
                    opacity={reveal > 0.3 ? 1 : 0}
                    className={`text-[10px] font-mono tabular-nums font-medium transition-opacity duration-200 ${
                      isSelected || isHovered ? 'fill-[#0B261C] font-semibold' : 'fill-[#526259]'
                    }`}
                  >
                    {day.total}
                  </text>

                  <text
                    x={cx}
                    y={dims.height - 12}
                    textAnchor="middle"
                    className={`text-[10px] font-mono tabular-nums ${
                      isSelected || isToday
                        ? 'fill-[#0B261C] font-semibold'
                        : 'fill-[#64746B]'
                    }`}
                  >
                    {dateLabel}
                  </text>
                  {isToday && (
                    <rect
                      x={cx - 8}
                      y={dims.height - 6}
                      width={16}
                      height={2}
                      rx={1}
                      fill="#059669"
                    />
                  )}
                </g>
              );
            })
          ) : (
            /* Dual-Series Line + Soft Area Chart */
            <>
              {totalAreaPath && (
                <path
                  d={totalAreaPath}
                  fill="#0B261C"
                  opacity={0.06 * reveal}
                  className="pointer-events-none"
                />
              )}
              {totalLinePath && (
                <path
                  d={totalLinePath}
                  fill="none"
                  stroke="#0B261C"
                  strokeWidth={2.25}
                  strokeLinecap="round"
                  className="pointer-events-none"
                />
              )}
              {confirmedLinePath && (
                <path
                  d={confirmedLinePath}
                  fill="none"
                  stroke="#059669"
                  strokeWidth={2}
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
                const dateLabel = formatAxisDateLabel(
                  day.date,
                  dims.compactLabels,
                  dims.width
                );

                return (
                  <g
                    key={day.date}
                    role="button"
                    tabIndex={0}
                    aria-label={`Focus ${day.date} (${day.total} total, ${day.confirmed + day.completed} confirmed or completed)`}
                    aria-pressed={isSelected}
                    className="cursor-pointer focus:outline-none"
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onFocus={() => setHoveredIndex(idx)}
                    onBlur={() => setHoveredIndex(null)}
                    onClick={() => onSelectDate(day.date)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectDate(day.date);
                      }
                    }}
                  >
                    {/* Vertical hover / selected guide */}
                    {(isHovered || isSelected) && (
                      <line
                        x1={cx}
                        y1={dims.padTop}
                        x2={cx}
                        y2={dims.padTop + dims.plotH}
                        stroke={isSelected ? '#059669' : '#CBD6CE'}
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                    )}
                    {/* Invisible hit slot */}
                    <rect
                      x={cx - dims.slotW / 2}
                      y={dims.padTop}
                      width={dims.slotW}
                      height={dims.plotH}
                      fill="transparent"
                    />

                    <circle
                      cx={totalPt.x}
                      cy={totalPt.y}
                      r={isHovered || isSelected ? 4.5 : 3}
                      fill="#FFFFFF"
                      stroke="#0B261C"
                      strokeWidth={2}
                    />
                    <circle
                      cx={confPt.x}
                      cy={confPt.y}
                      r={isHovered || isSelected ? 4.5 : 3}
                      fill="#FFFFFF"
                      stroke="#059669"
                      strokeWidth={2}
                    />

                    <text
                      x={cx}
                      y={dims.height - 12}
                      textAnchor="middle"
                      className={`text-[10px] font-mono tabular-nums ${
                        isSelected || isToday
                          ? 'fill-[#0B261C] font-semibold'
                          : 'fill-[#64746B]'
                      }`}
                    >
                      {dateLabel}
                    </text>
                    {isToday && (
                      <rect
                        x={cx - 8}
                        y={dims.height - 6}
                        width={16}
                        height={2}
                        rx={1}
                        fill="#059669"
                      />
                    )}
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
  { key: 'Confirmed', label: 'Confirmed', color: '#059669' },
  { key: 'Completed', label: 'Completed', color: '#0B261C' },
  { key: 'Scheduled', label: 'Scheduled', color: '#D97706' },
  { key: 'Missed', label: 'Missed', color: '#DC2626' },
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
    () =>
      `${totalInWindow}:${DONUT_SEGMENTS.map((s) => statusBreakdown[s.key] ?? 0).join(',')}`,
    [statusBreakdown, totalInWindow]
  );
  const reveal = useAnimationProgress(`donut:${dataSig}`, 440);

  const slices = useMemo(
    () =>
      computeDonutSlices(
        DONUT_SEGMENTS,
        statusBreakdown,
        totalInWindow,
        circumference,
        reveal
      ),
    [statusBreakdown, totalInWindow, circumference, reveal]
  );

  if (totalInWindow <= 0) {
    return (
      <div className="py-6 px-4 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4] text-center">
        <p className="text-sm font-medium text-[#111C17]">No appointments in current window</p>
        <p className="text-xs text-[#526259] mt-1">
          Status proportions will appear once appointments are scheduled in this date range.
        </p>
      </div>
    );
  }

  const activeSlice = slices.find((s) => s.key === hoveredKey);

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="relative w-32 h-32 sm:w-36 sm:h-36 shrink-0 flex items-center justify-center">
        <svg
          viewBox="0 0 140 140"
          className="w-full h-full -rotate-90"
          role="img"
          aria-label="Appointment status distribution ring"
        >
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="#EEF2EF"
            strokeWidth={stroke}
          />
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
                onFocus={() => setHoveredKey(s.key)}
                onBlur={() => setHoveredKey(null)}
                onClick={() => onSelectStatus?.(s.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectStatus?.(s.key);
                  }
                }}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-3">
          <span className="text-xl font-bold font-mono tabular-nums text-[#0B261C] leading-none">
            {activeSlice ? activeSlice.value : totalInWindow}
          </span>
          <span className="text-[10px] font-medium text-[#526259] mt-1 leading-tight">
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
              onFocus={() => !isZero && setHoveredKey(s.key)}
              onBlur={() => setHoveredKey(null)}
              onClick={() => !isZero && onSelectStatus?.(s.key)}
              className={`btn-press w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md text-xs transition-colors ${
                isZero
                  ? 'opacity-55 cursor-default'
                  : isActive
                    ? 'bg-[#ECF4EF]'
                    : 'hover:bg-[#F4F8F5]'
              }`}
            >
              <span className="inline-flex items-center gap-2 text-[#34433B] truncate">
                <span
                  className="w-2.5 h-2.5 rounded-xs shrink-0"
                  style={{ backgroundColor: s.color }}
                  aria-hidden="true"
                />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="font-mono tabular-nums text-[#111C17] font-medium whitespace-nowrap shrink-0">
                {s.value}{' '}
                <span className="text-[#64746B] text-[11px]">({s.pct}%)</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface PatientCohortChartProps {
  trend: OverviewReport['patientRegistrationTrend'];
}

export function PatientCohortChart({ trend }: PatientCohortChartProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const sig = useMemo(
    () => trend.map((c) => `${c.period}:${c.count}`).join('|'),
    [trend]
  );
  const reveal = useAnimationProgress(`cohort:${sig}`, 380);
  const maxRegCount = useMemo(
    () => Math.max(4, ...trend.map((c) => c.count)),
    [trend]
  );

  if (trend.length === 0) {
    return (
      <p className="text-xs text-[#526259] py-2">
        No monthly patient registration cohorts recorded yet.
      </p>
    );
  }

  const activeCohort = activeIdx !== null ? trend[activeIdx] : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[#526259]">Monthly Patient Intake</span>
        <span className="font-mono tabular-nums text-[#0B261C] font-medium">
          {activeCohort
            ? `${activeCohort.period}: ${activeCohort.count} registered`
            : `Scale 0–${maxRegCount}`}
        </span>
      </div>
      <div
        className="grid gap-1.5 sm:gap-2 items-end h-16 border-b border-[#DCE5DF] pb-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, trend.length)}, minmax(0, 1fr))` }}
        role="group"
        aria-label="Monthly patient registration cohort trend"
      >
        {trend.map((cohort, idx) => {
          const barH = cohort.count > 0 ? Math.max(6, Math.round((cohort.count / maxRegCount) * 32)) : 2;
          const isActive = activeIdx === idx;
          return (
            <div
              key={cohort.period}
              tabIndex={0}
              aria-label={`${cohort.period}: ${cohort.count} registered`}
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseLeave={() => setActiveIdx(null)}
              onFocus={() => setActiveIdx(idx)}
              onBlur={() => setActiveIdx(null)}
              className="flex flex-col items-center gap-0.5 cursor-default focus:outline-none"
              title={`${cohort.period}: ${cohort.count} registered`}
            >
              <span
                className={`text-[10px] font-mono tabular-nums transition-colors ${
                  isActive ? 'text-[#0B261C] font-semibold' : 'text-[#526259]'
                }`}
              >
                {cohort.count}
              </span>
              <div className="w-full flex justify-center items-end h-8">
                <div
                  style={{
                    height: `${barH}px`,
                    transform: `scaleY(${reveal})`,
                  }}
                  className={`w-full max-w-[20px] origin-bottom rounded-t-xs transition-colors duration-150 ${
                    cohort.count === 0
                      ? 'bg-[#E3E8E4]'
                      : isActive
                        ? 'bg-[#0B261C]'
                        : 'bg-[#059669]/85'
                  }`}
                />
              </div>
              <span className="text-[10px] font-mono text-[#64746B] truncate max-w-full">
                {cohort.period.slice(2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DepartmentLoadChartProps {
  appointments: Appointment[];
}

export function DepartmentLoadChart({ appointments }: DepartmentLoadChartProps) {
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
      <div className="py-6 px-4 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4] text-center">
        <p className="text-sm font-medium text-[#111C17]">No department appointment history</p>
        <p className="text-xs text-[#526259] mt-1">
          Department capacity and confirmation rates will appear once visits are recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#526259]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-[#059669]" aria-hidden="true" />
          Confirmed / Done
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-[#B7DFCA]" aria-hidden="true" />
          Other Visits (Scheduled / Missed)
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
              tabIndex={0}
              onMouseEnter={() => setHoveredDept(row.department)}
              onMouseLeave={() => setHoveredDept(null)}
              onFocus={() => setHoveredDept(row.department)}
              onBlur={() => setHoveredDept(null)}
              aria-label={`${row.department}: ${row.total} visits, ${row.confirmedPct}% confirmed or done, ${row.missed} missed`}
              className={`space-y-1.5 px-2.5 py-1.5 -mx-2.5 rounded-lg transition-colors duration-150 focus:outline-none ${
                isHovered ? 'bg-[#F4F8F5]' : ''
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                <span className="font-medium text-[#111C17]">{row.department}</span>
                <span className="font-mono tabular-nums text-[#526259] whitespace-nowrap">
                  {row.total} visits ·{' '}
                  <span className="text-[#047857] font-medium">
                    {row.confirmedPct}% conf/done
                  </span>
                  {row.missed > 0 && (
                    <span className="text-[#DC2626]"> · {row.missed} missed</span>
                  )}
                </span>
              </div>
              <div className="relative h-2.5 w-full rounded-full bg-[#EEF2EF] overflow-hidden">
                <div
                  style={{ transform: `scaleX(${Math.max(0.02, totalRatio)})` }}
                  className="absolute inset-0 origin-left rounded-full bg-[#B7DFCA]"
                />
                {row.confirmedDone > 0 && (
                  <div
                    style={{ transform: `scaleX(${Math.max(0.02, confirmedRatio)})` }}
                    className={`absolute inset-0 origin-left rounded-full transition-colors duration-150 ${
                      isHovered ? 'bg-[#047857]' : 'bg-[#059669]'
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
