import type { Appointment, AppointmentStatus, OverviewReport } from '../shared/types';

export interface ChartDimensions {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  plotW: number;
  plotH: number;
  slotW: number;
  barW: number;
  compactLabels: boolean;
}

export interface YAxisScale {
  top: number;
  step: number;
  ticks: number[];
}

export interface Point2D {
  x: number;
  y: number;
}

export function computeChartDimensions(
  containerWidth: number,
  pointCount: number
): ChartDimensions {
  const safeWidth = Math.max(260, Math.round(containerWidth));
  const compactLabels = safeWidth < 460;
  const height = compactLabels ? 204 : 236;
  const padLeft = compactLabels ? 30 : 36;
  const padRight = compactLabels ? 14 : 20;
  const padTop = 24;
  const padBottom = compactLabels ? 32 : 36;
  const plotW = Math.max(120, safeWidth - padLeft - padRight);
  const plotH = Math.max(84, height - padTop - padBottom);
  const count = Math.max(1, pointCount);
  const slotW = plotW / count;
  const barW = Math.min(34, Math.max(12, slotW * (compactLabels ? 0.54 : 0.46)));

  return {
    width: safeWidth,
    height,
    padLeft,
    padRight,
    padTop,
    padBottom,
    plotW,
    plotH,
    slotW,
    barW,
    compactLabels,
  };
}

export function computeYAxisScale(maxValue: number, minMax = 4): YAxisScale {
  const ceiling = Math.max(minMax, maxValue);
  const step = Math.max(1, Math.ceil(ceiling / 4));
  const top = step * 4;
  return {
    top,
    step,
    ticks: [0, step, step * 2, step * 3, top],
  };
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatAxisDateLabel(isoDate: string, compact: boolean, containerWidth = 600): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const monthIdx = Number(parts[1]) - 1;
  const dayNum = Number(parts[2]);
  if (!Number.isFinite(monthIdx) || !Number.isFinite(dayNum)) return isoDate;

  if (compact) {
    return containerWidth < 350 ? String(dayNum) : `${Number(parts[1])}/${dayNum}`;
  }
  const monthName = SHORT_MONTHS[monthIdx] ?? parts[1];
  return `${monthName} ${dayNum}`;
}

export function buildSmoothBezierPath(points: Point2D[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = (p0.x + p1.x) / 2;
    d += ` C ${cx.toFixed(2)} ${p0.y.toFixed(2)}, ${cx.toFixed(2)} ${p1.y.toFixed(2)}, ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
  }
  return d;
}

export function buildSmoothAreaPath(points: Point2D[], baselineY: number): string {
  if (points.length < 2) return '';
  const line = buildSmoothBezierPath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x.toFixed(2)} ${baselineY.toFixed(2)} L ${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

export function computeTrendPoints(
  dailyTrend: OverviewReport['dailyTrend'],
  chartMode: 'volume' | 'outcomes',
  dims: ChartDimensions,
  yTop: number,
  progress = 1
): Array<Point2D & { day: OverviewReport['dailyTrend'][number]; metric: number }> {
  const safeTop = Math.max(1, yTop);
  const clamped = Math.max(0, Math.min(1, progress));
  return dailyTrend.map((day, i) => {
    const x = dims.padLeft + dims.slotW * i + dims.slotW / 2;
    const metric =
      chartMode === 'volume' ? day.total : day.confirmed + day.completed;
    const y = dims.padTop + dims.plotH - ((metric * clamped) / safeTop) * dims.plotH;
    return { x, y, day, metric };
  });
}

export interface DonutSliceSpec {
  key: AppointmentStatus;
  label: string;
  color: string;
  value: number;
  pct: number;
  length: number;
  offset: number;
}

export function computeDonutSlices(
  segments: Array<{ key: AppointmentStatus; label: string; color: string }>,
  statusBreakdown: Record<AppointmentStatus, number>,
  totalInWindow: number,
  circumference: number,
  revealProgress = 1
): DonutSliceSpec[] {
  if (totalInWindow <= 0) {
    return segments.map((seg) => ({
      ...seg,
      value: statusBreakdown[seg.key] ?? 0,
      pct: 0,
      length: 0,
      offset: 0,
    }));
  }
  const clamped = Math.max(0, Math.min(1, revealProgress));
  let offset = 0;
  return segments.map((seg) => {
    const value = statusBreakdown[seg.key] ?? 0;
    const pct = value / totalInWindow;
    const length = pct * circumference * clamped;
    const currentOffset = offset;
    offset += length;
    return {
      ...seg,
      value,
      pct: Math.round(pct * 100),
      length,
      offset: currentOffset,
    };
  });
}

export interface DepartmentStatRow {
  department: string;
  total: number;
  confirmedDone: number;
  scheduled: number;
  missed: number;
  cancelled: number;
  confirmedPct: number;
}

export function computeDepartmentStats(appointments: Appointment[]): DepartmentStatRow[] {
  const counts = new Map<
    string,
    { total: number; confirmedDone: number; scheduled: number; missed: number; cancelled: number }
  >();
  for (const apt of appointments) {
    const curr = counts.get(apt.department) ?? {
      total: 0,
      confirmedDone: 0,
      scheduled: 0,
      missed: 0,
      cancelled: 0,
    };
    curr.total += 1;
    if (apt.status === 'Confirmed' || apt.status === 'Completed') curr.confirmedDone += 1;
    else if (apt.status === 'Scheduled') curr.scheduled += 1;
    else if (apt.status === 'Missed') curr.missed += 1;
    else if (apt.status === 'Cancelled') curr.cancelled += 1;
    counts.set(apt.department, curr);
  }
  return Array.from(counts.entries())
    .map(([department, stat]) => ({
      department,
      ...stat,
      confirmedPct: stat.total > 0 ? Math.round((stat.confirmedDone / stat.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total || a.department.localeCompare(b.department));
}

export function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}
