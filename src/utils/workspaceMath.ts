import type { Appointment, AppointmentType, FollowUpPriority, FollowUpTask, OverviewReport } from '../shared/types';

export interface WeekStripDay {
  dateKey: string;
  shortDay: string;
  dayNum: number;
  monthShort: string;
  isToday: boolean;
  isSelected: boolean;
}

export interface DualSeriesPoint {
  date: string;
  primary: number; // Total / All scheduled visits
  secondary: number; // Confirmed + Completed visits
}

export interface DualSeriesActivitySummary {
  points: DualSeriesPoint[];
  totalPrimary: number;
  totalSecondary: number;
  primaryDeltaPct: number;
  secondaryDeltaPct: number;
  confirmationRatePct: number;
}

export interface CalendarWeekColumn {
  dateKey: string;
  shortDay: string;
  dayNum: number;
  monthShort: string;
  isToday: boolean;
  isSelected: boolean;
  appointments: Appointment[];
}

export interface PriorityFollowUpGroups {
  High: FollowUpTask[];
  Medium: FollowUpTask[];
  Low: FollowUpTask[];
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseIsoDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  return new Date(y, m - 1, d);
}

export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(dateKey: string, offsetDays: number): string {
  const d = parseIsoDate(dateKey);
  d.setDate(d.getDate() + offsetDays);
  return formatIsoDate(d);
}

export function formatReadableHeaderDate(dateKey: string): string {
  const d = parseIsoDate(dateKey);
  return `${WEEKDAY_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Returns the Monday-through-Sunday week strip containing `focusDate`.
 */
export function getWeekStripDays(focusDate: string, todayDate?: string): WeekStripDay[] {
  const base = parseIsoDate(focusDate);
  const dow = base.getDay(); // 0=Sun..6=Sat
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetToMonday);

  const resolvedToday = todayDate || formatIsoDate(new Date());
  const days: WeekStripDay[] = [];

  for (let i = 0; i < 7; i += 1) {
    const current = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const key = formatIsoDate(current);
    days.push({
      dateKey: key,
      shortDay: WEEKDAY_SHORT[current.getDay()],
      dayNum: current.getDate(),
      monthShort: MONTH_SHORT[current.getMonth()],
      isToday: key === resolvedToday,
      isSelected: key === focusDate,
    });
  }

  return days;
}

function computeHalfSplitDeltaPct(values: number[]): number {
  if (values.length < 2) return 0;
  const mid = Math.floor(values.length / 2);
  const prevSum = values.slice(0, mid).reduce((acc, v) => acc + v, 0);
  const currSum = values.slice(mid).reduce((acc, v) => acc + v, 0);
  if (prevSum === 0) {
    return currSum > 0 ? 100 : 0;
  }
  return Math.round(((currSum - prevSum) / prevSum) * 100);
}

/**
 * Computes smooth dual-series chart data and left-rail summary KPIs from OverviewReport dailyTrend
 * and live clinic appointments filtered by segment ('All' | 'New' | 'Follow-up').
 */
export function computeDualSeriesActivity(
  dailyTrend: OverviewReport['dailyTrend'],
  appointments: Appointment[],
  filter: 'All' | 'New' | 'Follow-up'
): DualSeriesActivitySummary {
  if (dailyTrend.length === 0) {
    return {
      points: [],
      totalPrimary: 0,
      totalSecondary: 0,
      primaryDeltaPct: 0,
      secondaryDeltaPct: 0,
      confirmationRatePct: 0,
    };
  }

  let points: DualSeriesPoint[];

  if (filter === 'All') {
    points = dailyTrend.map((d) => ({
      date: d.date,
      primary: d.total,
      secondary: d.confirmed + d.completed,
    }));
  } else {
    const targetType: AppointmentType = filter === 'New' ? 'New Patient' : 'Follow-Up';
    const byDate = new Map<string, { primary: number; secondary: number }>();
    for (const d of dailyTrend) {
      byDate.set(d.date, { primary: 0, secondary: 0 });
    }
    for (const apt of appointments) {
      const resolvedType = apt.appointmentType ?? 'Consultation';
      if (resolvedType !== targetType) continue;
      const bucket = byDate.get(apt.appointmentDate);
      if (!bucket) continue;
      bucket.primary += 1;
      if (apt.status === 'Confirmed' || apt.status === 'Completed') {
        bucket.secondary += 1;
      }
    }
    points = dailyTrend.map((d) => {
      const bucket = byDate.get(d.date) ?? { primary: 0, secondary: 0 };
      return {
        date: d.date,
        primary: bucket.primary,
        secondary: bucket.secondary,
      };
    });
  }

  const totalPrimary = points.reduce((s, p) => s + p.primary, 0);
  const totalSecondary = points.reduce((s, p) => s + p.secondary, 0);
  const primaryDeltaPct = computeHalfSplitDeltaPct(points.map((p) => p.primary));
  const secondaryDeltaPct = computeHalfSplitDeltaPct(points.map((p) => p.secondary));
  const confirmationRatePct =
    totalPrimary > 0 ? Math.round((totalSecondary / totalPrimary) * 100) : 0;

  return {
    points,
    totalPrimary,
    totalSecondary,
    primaryDeltaPct,
    secondaryDeltaPct,
    confirmationRatePct,
  };
}

/**
 * Organizes appointments into Week (Mon-Sun) or single Day columns sorted chronologically.
 */
export function buildWeekCalendarColumns(
  appointments: Appointment[],
  focusDate: string,
  mode: 'week' | 'day',
  todayDate?: string
): CalendarWeekColumn[] {
  const days =
    mode === 'day'
      ? getWeekStripDays(focusDate, todayDate).filter((d) => d.dateKey === focusDate)
      : getWeekStripDays(focusDate, todayDate);

  const grouped = new Map<string, Appointment[]>();
  for (const d of days) {
    grouped.set(d.dateKey, []);
  }
  for (const apt of appointments) {
    const list = grouped.get(apt.appointmentDate);
    if (list) {
      list.push(apt);
    }
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));
  }

  return days.map((d) => ({
    ...d,
    appointments: grouped.get(d.dateKey) ?? [],
  }));
}

/**
 * Groups follow-up tasks by High / Medium / Low priority, keeping overdue & earliest due dates first.
 */
export function groupFollowUpsByPriority(
  tasks: FollowUpTask[],
  todayKey: string
): PriorityFollowUpGroups {
  const groups: PriorityFollowUpGroups = {
    High: [],
    Medium: [],
    Low: [],
  };

  const sorted = [...tasks].sort((a, b) => {
    const aOverdue = a.status === 'Overdue' || (a.dueDate < todayKey && a.status !== 'Completed' && a.status !== 'Cancelled');
    const bOverdue = b.status === 'Overdue' || (b.dueDate < todayKey && b.status !== 'Completed' && b.status !== 'Cancelled');
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  for (const task of sorted) {
    const p: FollowUpPriority = task.priority in groups ? task.priority : 'Medium';
    groups[p].push(task);
  }

  return groups;
}

export function getCalendarBlockLabel(type?: AppointmentType): string {
  if (!type || type === 'Consultation') return 'Check-up';
  return type;
}

export function formatGreetingName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'there';
  if (parts.length === 1) return parts[0];
  if (/^(dr|mr|mrs|ms|mx|prof)\.?$/i.test(parts[0])) {
    const title = parts[0].endsWith('.') ? parts[0] : `${parts[0]}.`;
    return `${title} ${parts[parts.length - 1]}`;
  }
  return parts[0];
}
