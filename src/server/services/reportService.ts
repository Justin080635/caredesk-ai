import type { DatabaseSync } from 'node:sqlite';
import type { AppointmentStatus, DailyReport, OverviewReport } from '../../shared/types';
import { addDaysToDateString, getClinicTodayDate, isValidDateString } from '../domain/rules';
import {
  getMissedAppointments,
  listAppointments,
} from './appointmentService';
import { listAuditLogs } from './auditService';
import { getPendingFollowups } from './followupService';

function createEmptyBreakdown(): Record<AppointmentStatus, number> {
  return {
    Scheduled: 0,
    Confirmed: 0,
    Completed: 0,
    Cancelled: 0,
    Missed: 0,
  };
}

export function getDailyOperationalReport(db: DatabaseSync, date?: string): DailyReport {
  const targetDate = date && isValidDateString(date) ? date : getClinicTodayDate();
  const dayAppointments = listAppointments(db, { date: targetDate });
  const pendingFollowUps = getPendingFollowups(db);

  const statusBreakdown = createEmptyBreakdown();
  const departmentMap = new Map<string, number>();

  for (const apt of dayAppointments) {
    statusBreakdown[apt.status] += 1;
    departmentMap.set(apt.department, (departmentMap.get(apt.department) ?? 0) + 1);
  }

  const departmentBreakdown = Array.from(departmentMap.entries())
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count);

  const upcomingAppointments = dayAppointments.filter(
    (a) => a.status === 'Scheduled' || a.status === 'Confirmed'
  );
  const unconfirmedList = dayAppointments.filter((a) => a.status === 'Scheduled');
  const missedTodayList = dayAppointments.filter((a) => a.status === 'Missed');

  return {
    date: targetDate,
    totalAppointments: dayAppointments.length,
    confirmedAppointments: statusBreakdown.Confirmed,
    unconfirmedAppointments: statusBreakdown.Scheduled,
    completedAppointments: statusBreakdown.Completed,
    cancelledAppointments: statusBreakdown.Cancelled,
    missedAppointments: statusBreakdown.Missed,
    pendingFollowUps: pendingFollowUps.length,
    statusBreakdown,
    departmentBreakdown,
    upcomingAppointments,
    unconfirmedList,
    missedTodayList,
  };
}

export function getOverviewReport(db: DatabaseSync, referenceToday?: string): OverviewReport {
  const today = referenceToday ?? getClinicTodayDate();
  const windowStart = addDaysToDateString(today, -6);
  const windowEnd = addDaysToDateString(today, 3);

  const patientStats = db
    .prepare(
      `SELECT
         COUNT(*) AS total_patients,
         SUM(CASE WHEN administrative_status = 'Active' THEN 1 ELSE 0 END) AS active_patients
       FROM patients`
    )
    .get() as { total_patients: number; active_patients: number };

  const allAppointments = listAppointments(db);
  const windowAppointments = allAppointments.filter(
    (a) => a.appointmentDate >= windowStart && a.appointmentDate <= windowEnd
  );

  const statusBreakdown = createEmptyBreakdown();
  for (const apt of windowAppointments) {
    statusBreakdown[apt.status] += 1;
  }

  const dailyTrend: OverviewReport['dailyTrend'] = [];
  for (let offset = -6; offset <= 1; offset++) {
    const d = addDaysToDateString(today, offset);
    const items = allAppointments.filter((a) => a.appointmentDate === d);
    dailyTrend.push({
      date: d,
      total: items.length,
      confirmed: items.filter((a) => a.status === 'Confirmed').length,
      scheduled: items.filter((a) => a.status === 'Scheduled').length,
      completed: items.filter((a) => a.status === 'Completed').length,
      missed: items.filter((a) => a.status === 'Missed').length,
      cancelled: items.filter((a) => a.status === 'Cancelled').length,
    });
  }

  const missedLastSevenDays = getMissedAppointments(db, { days: 7, referenceToday: today });
  const pendingFollowUps = getPendingFollowups(db);
  const overdueFollowUps = pendingFollowUps.filter((f) => f.dueDate < today);
  const highPriorityFollowUpsCount = pendingFollowUps.filter((f) => f.priority === 'High').length;
  const recentActivity = listAuditLogs(db, 15);

  const yesterday = addDaysToDateString(today, -1);
  const todayTotalAppointments = allAppointments.filter((a) => a.appointmentDate === today).length;
  const yesterdayTotalAppointments = allAppointments.filter(
    (a) => a.appointmentDate === yesterday
  ).length;

  const regRows = db
    .prepare(
      `SELECT substr(registration_date, 1, 7) AS period, COUNT(*) AS count
       FROM patients
       GROUP BY substr(registration_date, 1, 7)
       ORDER BY period ASC`
    )
    .all() as Array<{ period: string; count: number }>;

  const calendarMap = new Map<
    string,
    {
      date: string;
      total: number;
      confirmed: number;
      scheduled: number;
      missed: number;
      completed: number;
    }
  >();

  for (const apt of allAppointments) {
    const entry = calendarMap.get(apt.appointmentDate) ?? {
      date: apt.appointmentDate,
      total: 0,
      confirmed: 0,
      scheduled: 0,
      missed: 0,
      completed: 0,
    };
    entry.total += 1;
    if (apt.status === 'Confirmed') entry.confirmed += 1;
    if (apt.status === 'Scheduled') entry.scheduled += 1;
    if (apt.status === 'Missed') entry.missed += 1;
    if (apt.status === 'Completed') entry.completed += 1;
    calendarMap.set(apt.appointmentDate, entry);
  }

  return {
    generatedAt: new Date().toISOString(),
    windowStart,
    windowEnd,
    todayDate: today,
    totalPatients: patientStats.total_patients,
    activePatients: patientStats.active_patients ?? 0,
    totalAppointmentsInWindow: windowAppointments.length,
    todayTotalAppointments,
    yesterdayTotalAppointments,
    missedLastSevenDaysCount: missedLastSevenDays.length,
    pendingFollowUpsCount: pendingFollowUps.length,
    overdueFollowUpsCount: overdueFollowUps.length,
    highPriorityFollowUpsCount,
    statusBreakdown,
    dailyTrend,
    patientRegistrationTrend: regRows.slice(-8),
    calendarSummary: Array.from(calendarMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    ),
    missedLastSevenDays,
    overdueFollowUps,
    recentActivity,
  };
}
