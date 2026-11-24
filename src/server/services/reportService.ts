import type { DatabaseSync } from 'node:sqlite';
import type {
  AppointmentStatus,
  DailyReport,
  ExplainableOperationalReport,
  ExplainableSectionInsight,
  OverviewReport,
} from '../../shared/types';
import { DEFAULT_DEMO_CLINIC_ID } from '../db/database';
import { addDaysToDateString, getClinicTodayDate, isValidDateString } from '../domain/rules';
import {
  getMissedAppointments,
  listAppointments,
} from './appointmentService';
import { listAuditLogs } from './auditService';
import { getPendingFollowups, listFollowups } from './followupService';
import { listPatients } from './patientService';
import { listStaff } from './staffService';

function createEmptyBreakdown(): Record<AppointmentStatus, number> {
  return {
    Scheduled: 0,
    Confirmed: 0,
    Completed: 0,
    Cancelled: 0,
    Missed: 0,
  };
}

export function getDailyOperationalReport(
  db: DatabaseSync,
  date?: string,
  clinicId = DEFAULT_DEMO_CLINIC_ID
): DailyReport {
  const targetDate = date && isValidDateString(date) ? date : getClinicTodayDate();
  const dayAppointments = listAppointments(db, { clinicId, date: targetDate });
  const pendingFollowUps = getPendingFollowups(db, clinicId);

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

export function getOverviewReport(
  db: DatabaseSync,
  referenceToday?: string,
  clinicId = DEFAULT_DEMO_CLINIC_ID
): OverviewReport {
  const today = referenceToday ?? getClinicTodayDate();
  const windowStart = addDaysToDateString(today, -6);
  const windowEnd = addDaysToDateString(today, 3);

  const patientStats = db
    .prepare(
      `SELECT
         COUNT(*) AS total_patients,
         SUM(CASE WHEN administrative_status = 'Active' THEN 1 ELSE 0 END) AS active_patients
       FROM patients
       WHERE clinic_id = ?`
    )
    .get(clinicId) as { total_patients: number; active_patients: number };

  const allAppointments = listAppointments(db, { clinicId });
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

  const missedLastSevenDays = getMissedAppointments(db, {
    clinicId,
    days: 7,
    referenceToday: today,
  });
  const pendingFollowUps = getPendingFollowups(db, clinicId);
  const overdueFollowUps = pendingFollowUps.filter((f) => f.dueDate < today);
  const highPriorityFollowUpsCount = pendingFollowUps.filter((f) => f.priority === 'High').length;
  const recentActivity = listAuditLogs(db, clinicId, 15);

  const yesterday = addDaysToDateString(today, -1);
  const todayTotalAppointments = allAppointments.filter((a) => a.appointmentDate === today).length;
  const yesterdayTotalAppointments = allAppointments.filter(
    (a) => a.appointmentDate === yesterday
  ).length;

  const regRows = db
    .prepare(
      `SELECT substr(registration_date, 1, 7) AS period, COUNT(*) AS count
       FROM patients
       WHERE clinic_id = ?
       GROUP BY substr(registration_date, 1, 7)
       ORDER BY period ASC`
    )
    .all(clinicId) as Array<{ period: string; count: number }>;

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

function formatDeltaLabel(current: number, previous: number, unit = ''): string {
  const diff = current - previous;
  if (diff === 0) return `No change vs prior period`;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff}${unit} vs prior period`;
}

export function getExplainableOperationalReport(
  db: DatabaseSync,
  clinicId = DEFAULT_DEMO_CLINIC_ID,
  options?: {
    periodStart?: string;
    periodEnd?: string;
    compareStart?: string;
    compareEnd?: string;
  }
): ExplainableOperationalReport {
  const today = getClinicTodayDate();
  const periodEnd =
    options?.periodEnd && isValidDateString(options.periodEnd) ? options.periodEnd : addDaysToDateString(today, 7);
  const periodStart =
    options?.periodStart && isValidDateString(options.periodStart)
      ? options.periodStart
      : addDaysToDateString(today, -14);

  const periodDays = Math.max(
    1,
    Math.round((Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) / 86400000) + 1
  );

  const compareEnd =
    options?.compareEnd && isValidDateString(options.compareEnd)
      ? options.compareEnd
      : addDaysToDateString(periodStart, -1);
  const compareStart =
    options?.compareStart && isValidDateString(options.compareStart)
      ? options.compareStart
      : addDaysToDateString(compareEnd, -(periodDays - 1));

  const allAppointments = listAppointments(db, { clinicId });
  const allPatients = listPatients(db, { clinicId });
  const allFollowups = listFollowups(db, { clinicId });
  const doctors = listStaff(db, { clinicId, role: 'Clinician' });

  const inPeriod = allAppointments.filter(
    (a) => a.appointmentDate >= periodStart && a.appointmentDate <= periodEnd
  );
  const inCompare = allAppointments.filter(
    (a) => a.appointmentDate >= compareStart && a.appointmentDate <= compareEnd
  );

  const totalAppointments = inPeriod.length;
  const completedAppointments = inPeriod.filter((a) => a.status === 'Completed').length;
  const confirmedAppointments = inPeriod.filter((a) => a.status === 'Confirmed').length;
  const scheduledUnconfirmed = inPeriod.filter((a) => a.status === 'Scheduled').length;
  const missedAppointments = inPeriod.filter((a) => a.status === 'Missed').length;
  const cancelledAppointments = inPeriod.filter((a) => a.status === 'Cancelled').length;

  const confirmedOrCompletedRate =
    totalAppointments > 0
      ? Math.round(((confirmedAppointments + completedAppointments) / totalAppointments) * 100)
      : 0;
  const prevConfirmedOrCompletedRate =
    inCompare.length > 0
      ? Math.round(
          (inCompare.filter((a) => a.status === 'Confirmed' || a.status === 'Completed').length /
            inCompare.length) *
            100
        )
      : 0;

  const noShowRate =
    totalAppointments > 0 ? Math.round((missedAppointments / totalAppointments) * 100) : 0;
  const prevNoShowRate =
    inCompare.length > 0
      ? Math.round((inCompare.filter((a) => a.status === 'Missed').length / inCompare.length) * 100)
      : 0;

  const activePatients = allPatients.filter((p) => p.administrativeStatus === 'Active').length;
  const newRegistrationsInPeriod = allPatients.filter(
    (p) => p.registrationDate >= periodStart && p.registrationDate <= periodEnd
  ).length;
  const prevRegistrations = allPatients.filter(
    (p) => p.registrationDate >= compareStart && p.registrationDate <= compareEnd
  ).length;

  const followupsCompletedInPeriod = allFollowups.filter((f) => f.status === 'Completed').length;
  const followupsOverdueCount = allFollowups.filter((f) => f.status === 'Overdue').length;
  const followupsOpenCount = allFollowups.filter(
    (f) => f.status !== 'Completed' && f.status !== 'Cancelled'
  ).length;
  const highPriorityOpen = allFollowups.filter(
    (f) => f.priority === 'High' && f.status !== 'Completed' && f.status !== 'Cancelled'
  ).length;

  const workingDaysApprox = Math.max(1, Math.round((periodDays * 5) / 7));
  const doctorUtilization = doctors.map((doc) => {
    const docApts = inPeriod.filter(
      (a) => a.staffId === doc.id || a.clinician.toLowerCase() === doc.fullName.toLowerCase()
    );
    const activeSlots = docApts.filter((a) => a.status !== 'Cancelled').length;
    const capacitySlotsInPeriod = Math.max(1, (doc.maxDailyCapacity ?? 16) * workingDaysApprox);
    const utilizationRate = Math.min(100, Math.round((activeSlots / capacitySlotsInPeriod) * 100));
    return {
      staffId: doc.id,
      doctorName: doc.fullName,
      department: doc.department,
      scheduledAppointments: docApts.length,
      completedAppointments: docApts.filter((a) => a.status === 'Completed').length,
      missedAppointments: docApts.filter((a) => a.status === 'Missed').length,
      capacitySlotsInPeriod,
      utilizationRate,
    };
  });

  const avgUtilization =
    doctorUtilization.length > 0
      ? Math.round(
          doctorUtilization.reduce((sum, d) => sum + d.utilizationRate, 0) / doctorUtilization.length
        )
      : 0;

  const patientRequestsPending = inPeriod.filter(
    (a) => a.requestStatus && a.requestStatus !== 'None'
  ).length;

  const sections: ExplainableSectionInsight[] = [
    {
      id: 'appointment-performance',
      title: 'Appointment Performance',
      headlineMetricLabel: 'Confirmation & Completion Rate',
      headlineMetricValue: `${confirmedOrCompletedRate}%`,
      comparisonDeltaLabel: formatDeltaLabel(confirmedOrCompletedRate, prevConfirmedOrCompletedRate, ' pts'),
      metrics: [
        { label: 'Total Visits in Window', value: totalAppointments },
        { label: 'Confirmed / Completed', value: confirmedAppointments + completedAppointments },
        { label: 'Unconfirmed Scheduled', value: scheduledUnconfirmed },
        { label: 'No-Show Rate', value: `${noShowRate}%` },
      ],
      explanation: {
        whatHappened: `${totalAppointments} appointments were scheduled between ${periodStart} and ${periodEnd}, with ${confirmedAppointments + completedAppointments} confirmed or completed and ${missedAppointments} missed (${noShowRate}% no-show rate vs ${prevNoShowRate}% in the comparison window).`,
        whatItMeans:
          scheduledUnconfirmed > 0
            ? `${scheduledUnconfirmed} scheduled visits are still awaiting patient confirmation, leaving front-desk certainty lower than target.`
            : 'All active scheduled visits in the selected window have confirmed attendance commitments.',
        whyItMatters:
          'Unconfirmed slots and elevated no-show rates create idle clinician blocks while delaying care access for patients waiting on open slots.',
        appropriateAction:
          scheduledUnconfirmed > 0 || missedAppointments > 0
            ? `Prioritize confirmation outreach for the ${scheduledUnconfirmed} Scheduled visits and trigger rebooking follow-ups for the ${missedAppointments} missed appointments.`
            : 'Maintain current reminder cadence and monitor upcoming morning check-ins.',
      },
    },
    {
      id: 'patient-activity',
      title: 'Patient Activity & Portal Adoption',
      headlineMetricLabel: 'Active Patient Roster',
      headlineMetricValue: `${activePatients}`,
      comparisonDeltaLabel: formatDeltaLabel(newRegistrationsInPeriod, prevRegistrations, ' new'),
      metrics: [
        { label: 'Total Registered Patients', value: allPatients.length },
        { label: 'Active Roster', value: activePatients },
        { label: 'New Registrations', value: newRegistrationsInPeriod },
        { label: 'Portal-Linked Accounts', value: allPatients.filter((p) => p.portalLinked).length },
      ],
      explanation: {
        whatHappened: `The clinic currently maintains ${activePatients} active patient records (${allPatients.length} total), with ${newRegistrationsInPeriod} new patient registrations recorded during the selected period.`,
        whatItMeans: `${allPatients.filter((p) => p.portalLinked).length} patient profiles are verified and linked to self-service Patient Portal accounts.`,
        whyItMatters:
          'Verified patient portal linking lowers front-desk scheduling friction and ensures patients promptly receive published consultation summaries and follow-up notices.',
        appropriateAction:
          'Issue claim codes during intake for active patients who are not yet portal-linked so they can confirm and reschedule visits directly.',
      },
    },
    {
      id: 'doctor-utilization',
      title: 'Doctor Utilization & Capacity Balance',
      headlineMetricLabel: 'Mean Clinician Capacity Utilization',
      headlineMetricValue: `${avgUtilization}%`,
      comparisonDeltaLabel: `${doctorUtilization.length} active clinician${doctorUtilization.length === 1 ? '' : 's'} tracked`,
      metrics: [
        { label: 'Active Clinicians', value: doctorUtilization.length },
        { label: 'Mean Utilization', value: `${avgUtilization}%` },
        { label: 'Peak Doctor Load', value: doctorUtilization.length > 0 ? `${Math.max(...doctorUtilization.map((d) => d.utilizationRate))}%` : '0%' },
        { label: 'Completed Visits', value: completedAppointments },
      ],
      explanation: {
        whatHappened: `Across ${doctorUtilization.length} active clinicians, average capacity utilization is ${avgUtilization}% against configured daily slot ceilings.`,
        whatItMeans:
          avgUtilization > 85
            ? 'Clinician schedules are nearing saturation, increasing wait times for urgent or new-patient bookings.'
            : 'Clinicians retain open buffer capacity to absorb same-week consultations and rescheduled missed visits.',
        whyItMatters:
          'Balanced clinician utilization protects visit quality and prevents burnout while ensuring urgent specialties remain bookable.',
        appropriateAction:
          'Inspect the per-doctor utilization breakdown below and redistribute new-patient allocations toward clinicians under 70% utilization.',
      },
    },
    {
      id: 'scheduling-efficiency',
      title: 'Scheduling Efficiency & Request Queue',
      headlineMetricLabel: 'Pending Portal Change Requests',
      headlineMetricValue: `${patientRequestsPending}`,
      comparisonDeltaLabel: `${cancelledAppointments} cancellation${cancelledAppointments === 1 ? '' : 's'} in window`,
      metrics: [
        { label: 'Portal Change Requests', value: patientRequestsPending },
        { label: 'Cancelled Appointments', value: cancelledAppointments },
        { label: 'Staff-Booked Visits', value: inPeriod.filter((a) => a.requestedBy !== 'patient').length },
        { label: 'Patient-Booked Visits', value: inPeriod.filter((a) => a.requestedBy === 'patient').length },
      ],
      explanation: {
        whatHappened: `${patientRequestsPending} appointments carry pending patient reschedule or cancellation requests alongside ${cancelledAppointments} cancelled slots.`,
        whatItMeans:
          patientRequestsPending > 0
            ? 'Patients have initiated schedule adjustments that require coordinator or administrator review to release or reassign slots.'
            : 'Zero patient change requests are currently backlogged in the scheduling queue.',
        whyItMatters:
          'Fast triage of cancellation and reschedule requests frees slots early enough for other waiting patients to book.',
        appropriateAction:
          patientRequestsPending > 0
            ? 'Review pending reschedule and cancellation requests in the Appointments view and approve verified slot transfers.'
            : 'Keep automated slot availability rules active across departments.',
      },
    },
    {
      id: 'followup-performance',
      title: 'Follow-Up Governance & Outreach',
      headlineMetricLabel: 'Open / Overdue Tasks',
      headlineMetricValue: `${followupsOpenCount} (${followupsOverdueCount} overdue)`,
      comparisonDeltaLabel: `${followupsCompletedInPeriod} completed overall`,
      metrics: [
        { label: 'Open Follow-Ups', value: followupsOpenCount },
        { label: 'Overdue Tasks', value: followupsOverdueCount },
        { label: 'High Priority Open', value: highPriorityOpen },
        { label: 'Completed Tasks', value: followupsCompletedInPeriod },
      ],
      explanation: {
        whatHappened: `There are currently ${followupsOpenCount} active follow-up tasks (${highPriorityOpen} high priority), of which ${followupsOverdueCount} have passed their target due date.`,
        whatItMeans:
          followupsOverdueCount > 0
            ? 'Overdue clinical or administrative follow-ups indicate patient outreach bottlenecks.'
            : 'All active follow-up commitments remain on schedule.',
        whyItMatters:
          'Timely follow-up closure is critical for continuity of care after missed appointments or diagnostic test reviews.',
        appropriateAction:
          followupsOverdueCount > 0
            ? 'Assign owners to unowned overdue tasks and clear High-priority outreach items first.'
            : 'Continue daily follow-up review across Clinical Recommendation and Administrative Contact queues.',
      },
    },
    {
      id: 'operational-workload',
      title: 'Operational Workload Distribution',
      headlineMetricLabel: 'Appointments vs Prior Window',
      headlineMetricValue: `${totalAppointments}`,
      comparisonDeltaLabel: formatDeltaLabel(totalAppointments, inCompare.length, ' visits'),
      metrics: [
        { label: 'Current Period Visits', value: totalAppointments },
        { label: 'Comparison Period Visits', value: inCompare.length },
        { label: 'Average Visits / Day', value: (totalAppointments / periodDays).toFixed(1) },
        { label: 'Audit Events Recorded', value: listAuditLogs(db, clinicId, 100).length },
      ],
      explanation: {
        whatHappened: `Clinic volume totaled ${totalAppointments} appointments (${(totalAppointments / periodDays).toFixed(1)}/day) compared to ${inCompare.length} in the preceding ${periodDays}-day window (${compareStart} to ${compareEnd}).`,
        whatItMeans:
          totalAppointments > inCompare.length
            ? 'Front-desk and clinician intake volume has increased relative to the baseline window.'
            : 'Operational visit throughput is steady or lighter than the baseline period.',
        whyItMatters:
          'Tracking period-over-period workload shifts helps clinic administrators align receptionist staffing and clinician shift hours before bottlenecks emerge.',
        appropriateAction:
          'Use daily capacity metrics and department trends to adjust shift break coverage and next-week booking thresholds.',
      },
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    periodStart,
    periodEnd,
    compareStart,
    compareEnd,
    rawSummary: {
      totalAppointments,
      completedAppointments,
      missedAppointments,
      cancelledAppointments,
      confirmedOrCompletedRate,
      noShowRate,
      activePatients,
      newRegistrationsInPeriod,
      followupsCompletedInPeriod,
      followupsOverdueCount,
    },
    doctorUtilization,
    sections,
  };
}

