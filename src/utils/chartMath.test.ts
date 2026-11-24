import test from 'node:test';
import assert from 'node:assert/strict';
import type { Appointment } from '../shared/types';
import {
  buildSmoothAreaPath,
  buildSmoothBezierPath,
  computeChartDimensions,
  computeDepartmentStats,
  computeDonutSlices,
  computeTrendPoints,
  computeYAxisScale,
  easeOutCubic,
  formatAxisDateLabel,
} from './chartMath';

test('computeChartDimensions adapts smoothly from narrow mobile to wide desktop', () => {
  const mobile = computeChartDimensions(320, 8);
  assert.equal(mobile.compactLabels, true);
  assert.ok(mobile.width === 320);
  assert.ok(mobile.barW >= 12 && mobile.barW <= 34);
  assert.ok(mobile.plotW > 0 && mobile.plotH > 0);

  const desktop = computeChartDimensions(700, 8);
  assert.equal(desktop.compactLabels, false);
  assert.ok(desktop.slotW > mobile.slotW);
  assert.ok(desktop.height > mobile.height);
});

test('computeYAxisScale generates evenly spaced 4-step ticks', () => {
  const small = computeYAxisScale(3, 4);
  assert.deepEqual(small.ticks, [0, 1, 2, 3, 4]);
  assert.equal(small.top, 4);

  const medium = computeYAxisScale(9, 4);
  assert.deepEqual(medium.ticks, [0, 3, 6, 9, 12]);
  assert.equal(medium.top, 12);
});

test('formatAxisDateLabel uses readable month/day on desktop and compact labels on mobile', () => {
  assert.equal(formatAxisDateLabel('2026-11-24', false, 640), 'Nov 24');
  assert.equal(formatAxisDateLabel('2026-11-24', true, 390), '11/24');
  assert.equal(formatAxisDateLabel('2026-11-24', true, 310), '24');
});

test('buildSmoothBezierPath, buildSmoothAreaPath, and computeTrendPoints handle volume and outcomes modes', () => {
  const dims = computeChartDimensions(600, 2);
  const sample = [
    { date: '2026-11-23', total: 4, confirmed: 2, scheduled: 1, completed: 1, missed: 0, cancelled: 0 },
    { date: '2026-11-24', total: 8, confirmed: 4, scheduled: 2, completed: 1, missed: 1, cancelled: 0 },
  ];

  const volumePts = computeTrendPoints(sample, 'volume', dims, 8, 1);
  assert.equal(volumePts[0].metric, 4);
  assert.equal(volumePts[1].metric, 8);
  assert.ok(volumePts[1].y < volumePts[0].y);

  const outcomesPts = computeTrendPoints(sample, 'outcomes', dims, 8, 1);
  assert.equal(outcomesPts[0].metric, 3);
  assert.equal(outcomesPts[1].metric, 5);

  const path = buildSmoothBezierPath(volumePts);
  assert.ok(path.startsWith('M '));
  assert.ok(path.includes(' C '));

  const area = buildSmoothAreaPath(volumePts, dims.padTop + dims.plotH);
  assert.ok(area.startsWith('M '));
  assert.ok(area.endsWith(' Z'));
});

test('computeDonutSlices calculates proportional lengths and handles empty totals safely', () => {
  const segments = [
    { key: 'Confirmed' as const, label: 'Confirmed', color: '#059669' },
    { key: 'Missed' as const, label: 'Missed', color: '#DC2626' },
  ];
  const breakdown = { Confirmed: 6, Completed: 0, Scheduled: 0, Missed: 2, Cancelled: 0 };
  const circumference = 2 * Math.PI * 52;
  const slices = computeDonutSlices(segments, breakdown, 8, circumference, 1);

  assert.equal(slices[0].pct, 75);
  assert.equal(slices[1].pct, 25);
  assert.equal(slices[0].offset, 0);
  assert.ok(Math.abs(slices[1].offset - circumference * 0.75) < 0.001);

  const emptySlices = computeDonutSlices(
    segments,
    { Confirmed: 0, Completed: 0, Scheduled: 0, Missed: 0, Cancelled: 0 },
    0,
    circumference,
    1
  );
  assert.equal(emptySlices[0].pct, 0);
  assert.equal(emptySlices[0].length, 0);
});

test('computeDepartmentStats sorts departments by total and calculates confirmation rate', () => {
  const sampleApts: Appointment[] = [
    {
      id: 'A1',
      patientId: 'P1',
      appointmentDate: '2026-11-24',
      appointmentTime: '09:00',
      durationMinutes: 30,
      department: 'Cardiology',
      clinician: 'Dr. A',
      status: 'Confirmed',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'A2',
      patientId: 'P2',
      appointmentDate: '2026-11-24',
      appointmentTime: '10:00',
      durationMinutes: 30,
      department: 'Cardiology',
      clinician: 'Dr. A',
      status: 'Missed',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'A3',
      patientId: 'P3',
      appointmentDate: '2026-11-24',
      appointmentTime: '11:00',
      durationMinutes: 30,
      department: 'Pediatrics',
      clinician: 'Dr. B',
      status: 'Completed',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const rows = computeDepartmentStats(sampleApts);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].department, 'Cardiology');
  assert.equal(rows[0].total, 2);
  assert.equal(rows[0].confirmedDone, 1);
  assert.equal(rows[0].missed, 1);
  assert.equal(rows[0].confirmedPct, 50);
  assert.equal(rows[1].department, 'Pediatrics');
  assert.equal(rows[1].confirmedPct, 100);
});

test('easeOutCubic clamps and eases monotonically from 0 to 1', () => {
  assert.equal(easeOutCubic(-0.2), 0);
  assert.equal(easeOutCubic(0), 0);
  assert.ok(easeOutCubic(0.5) > 0.5);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(1.5), 1);
});
