import assert from 'node:assert/strict';
import test from 'node:test';
import type { Appointment, FollowUpTask, OverviewReport } from '../shared/types';
import {
  buildWeekCalendarColumns,
  computeDualSeriesActivity,
  formatGreetingName,
  getCalendarBlockLabel,
  getWeekStripDays,
  groupFollowUpsByPriority,
} from './workspaceMath';

function makeApt(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'APT-1',
    patientId: 'P-1001',
    patientName: 'Test Patient',
    appointmentDate: '2026-05-06',
    appointmentTime: '09:00',
    durationMinutes: 30,
    department: 'General Medicine',
    appointmentType: 'Consultation',
    clinician: 'Dr. Rivera',
    status: 'Confirmed',
    notes: '',
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<FollowUpTask>): FollowUpTask {
  return {
    id: 'FU-1',
    patientId: 'P-1001',
    patientName: 'Test Patient',
    appointmentId: null,
    description: 'Check vitals',
    priority: 'Medium',
    createdDate: '2026-05-01',
    dueDate: '2026-05-08',
    status: 'Pending',
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

test('getWeekStripDays produces Mon-Sun week around a mid-week or Sunday date', () => {
  // 2026-05-06 is a Wednesday; Monday is 2026-05-04, Sunday is 2026-05-10
  const strip = getWeekStripDays('2026-05-06', '2026-05-06');
  assert.equal(strip.length, 7);
  assert.equal(strip[0].dateKey, '2026-05-04');
  assert.equal(strip[0].shortDay, 'Mon');
  assert.equal(strip[2].isSelected, true);
  assert.equal(strip[2].isToday, true);
  assert.equal(strip[6].dateKey, '2026-05-10');
  assert.equal(strip[6].shortDay, 'Sun');

  // Sunday edge case: 2026-05-10 should stay in the May 4 - May 10 week
  const sundayStrip = getWeekStripDays('2026-05-10', '2026-05-06');
  assert.equal(sundayStrip[0].dateKey, '2026-05-04');
  assert.equal(sundayStrip[6].isSelected, true);
});

test('computeDualSeriesActivity filters accurately by All / New / Follow-up and computes deltas', () => {
  const dailyTrend: OverviewReport['dailyTrend'] = [
    { date: '2026-05-04', total: 2, confirmed: 1, scheduled: 1, completed: 0, missed: 0, cancelled: 0 },
    { date: '2026-05-05', total: 2, confirmed: 1, scheduled: 0, completed: 1, missed: 0, cancelled: 0 },
    { date: '2026-05-06', total: 4, confirmed: 3, scheduled: 1, completed: 0, missed: 0, cancelled: 0 },
    { date: '2026-05-07', total: 4, confirmed: 2, scheduled: 1, completed: 1, missed: 0, cancelled: 0 },
  ];

  const allSummary = computeDualSeriesActivity(dailyTrend, [], 'All');
  assert.equal(allSummary.totalPrimary, 12);
  assert.equal(allSummary.totalSecondary, 9);
  assert.equal(allSummary.primaryDeltaPct, 100); // 4 prior -> 8 recent
  assert.equal(allSummary.secondaryDeltaPct, 100); // 3 prior -> 6 recent
  assert.equal(allSummary.confirmationRatePct, 75);

  const apts: Appointment[] = [
    makeApt({ id: 'A1', appointmentDate: '2026-05-04', appointmentType: 'New Patient', status: 'Confirmed' }),
    makeApt({ id: 'A2', appointmentDate: '2026-05-06', appointmentType: 'New Patient', status: 'Scheduled' }),
    makeApt({ id: 'A3', appointmentDate: '2026-05-07', appointmentType: 'Follow-Up', status: 'Completed' }),
  ];

  const newSummary = computeDualSeriesActivity(dailyTrend, apts, 'New');
  assert.equal(newSummary.totalPrimary, 2);
  assert.equal(newSummary.totalSecondary, 1);

  const fuSummary = computeDualSeriesActivity(dailyTrend, apts, 'Follow-up');
  assert.equal(fuSummary.totalPrimary, 1);
  assert.equal(fuSummary.totalSecondary, 1);
});

test('buildWeekCalendarColumns groups and chronologically sorts Week and Day views', () => {
  const apts = [
    makeApt({ id: 'A2', appointmentDate: '2026-05-06', appointmentTime: '14:30', appointmentType: 'Follow-Up' }),
    makeApt({ id: 'A1', appointmentDate: '2026-05-06', appointmentTime: '09:15', appointmentType: 'Consultation' }),
    makeApt({ id: 'A3', appointmentDate: '2026-05-08', appointmentTime: '11:00', appointmentType: 'New Patient' }),
  ];

  const weekCols = buildWeekCalendarColumns(apts, '2026-05-06', 'week');
  assert.equal(weekCols.length, 7);
  const wed = weekCols.find((c) => c.dateKey === '2026-05-06');
  assert.ok(wed);
  assert.deepEqual(
    wed.appointments.map((a) => a.id),
    ['A1', 'A2']
  );

  const dayCols = buildWeekCalendarColumns(apts, '2026-05-06', 'day');
  assert.equal(dayCols.length, 1);
  assert.equal(dayCols[0].appointments.length, 2);
  assert.equal(getCalendarBlockLabel(dayCols[0].appointments[0].appointmentType), 'Check-up');
});

test('groupFollowUpsByPriority orders overdue items first within High / Medium / Low buckets', () => {
  const tasks = [
    makeTask({ id: 'FU-L1', priority: 'Low', dueDate: '2026-05-12' }),
    makeTask({ id: 'FU-H2', priority: 'High', dueDate: '2026-05-09', status: 'Pending' }),
    makeTask({ id: 'FU-H1', priority: 'High', dueDate: '2026-05-03', status: 'Overdue' }),
    makeTask({ id: 'FU-M1', priority: 'Medium', dueDate: '2026-05-07' }),
  ];

  const grouped = groupFollowUpsByPriority(tasks, '2026-05-06');
  assert.deepEqual(
    grouped.High.map((t) => t.id),
    ['FU-H1', 'FU-H2']
  );
  assert.equal(grouped.Medium.length, 1);
  assert.equal(grouped.Low.length, 1);
});

test('formatGreetingName keeps honorific paired with last name and falls back to first name', () => {
  assert.equal(formatGreetingName('Dr. Maya Lin'), 'Dr. Lin');
  assert.equal(formatGreetingName('Dr Maya Lin'), 'Dr. Lin');
  assert.equal(formatGreetingName('Jordan Alvarez'), 'Jordan');
  assert.equal(formatGreetingName(''), 'there');
});
