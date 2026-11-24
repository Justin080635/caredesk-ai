import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCopyableReplyText,
  formatApprovalPreviewText,
  formatAssistantGreeting,
  formatFriendlyToolDescription,
  formatFriendlyToolStatus,
  getFriendlyToolMeta,
  humanizeAssistantError,
  sanitizeTechnicalText,
} from './assistantUi.ts';

test('formatAssistantGreeting formats plain name and doctor title naturally', () => {
  assert.equal(
    formatAssistantGreeting('Sarah Jenkins'),
    "Hi Sarah, I'm your CareDesk assistant. What would you like to sort out today?"
  );
  assert.equal(
    formatAssistantGreeting('Dr. Elena Vance'),
    "Hi Dr. Vance, I'm your CareDesk assistant. What would you like to sort out today?"
  );
  assert.equal(
    formatAssistantGreeting(''),
    "Hi there, I'm your CareDesk assistant. What would you like to sort out today?"
  );
});

test('getFriendlyToolMeta and formatFriendlyToolStatus remove developer jargon', () => {
  const meta = getFriendlyToolMeta('get_appointments_today');
  assert.equal(meta.activeStep, "Checking today's appointments");
  assert.equal(meta.completedStep, "Checked today's appointments");
  assert.equal(formatFriendlyToolStatus('executed-via-local-rest'), 'Done');
  assert.equal(formatFriendlyToolStatus('awaiting-confirmation'), 'Needs approval');
  assert.equal(formatFriendlyToolStatus('running'), 'Checking…');
});

test('formatFriendlyToolDescription avoids raw HTTP paths and technical strings', () => {
  const desc = formatFriendlyToolDescription({
    toolName: 'get_daily_report',
    description: 'GET /api/reports/daily returned 200',
    resultSummary: 'status=200',
  });
  assert.equal(desc, "Reviewed today's visit counts and confirmation totals.");

  const plainSummary = formatFriendlyToolDescription({
    toolName: 'get_missed_appointments',
    description: 'Fetching missed appointments',
    resultSummary: '3 missed appointments found over the last 7 days',
  });
  assert.equal(plainSummary, '3 missed appointments found over the last 7 days');
});

test('formatApprovalPreviewText produces plain-English reschedule sentence with optional slot override', () => {
  const preview = formatApprovalPreviewText({
    confirmationId: 'conf-1',
    actionType: 'reschedule_appointment',
    title: 'Confirm Reschedule for Sarah Hosten (P-1042)',
    summary: 'Move APT-2001...',
    details: {
      Patient: 'Sarah Hosten (P-1042)',
      Appointment: 'APT-2001',
      'Previous Slot': '2026-11-24 10:00 (Missed)',
      'Proposed Slot': '2026-11-26 11:30',
      Department: 'Cardiology',
      Clinician: 'Dr. Elena Vance',
    },
    payload: {
      appointmentId: 'APT-2001',
      appointmentDate: '2026-11-26',
      appointmentTime: '11:30',
      department: 'Cardiology',
      clinician: 'Dr. Elena Vance',
    },
  });
  assert.match(preview, /^Move Sarah Hosten from /);
  assert.match(preview, /Cardiology$/);

  const overridden = formatApprovalPreviewText(
    {
      confirmationId: 'conf-1',
      actionType: 'reschedule_appointment',
      title: 'Confirm Reschedule',
      summary: 'Move APT-2001...',
      details: {
        Patient: 'Sarah Hosten (P-1042)',
        'Previous Slot': '2026-11-24 10:00 (Missed)',
        Department: 'Cardiology',
      },
      payload: {
        appointmentId: 'APT-2001',
      },
    },
    {
      date: '2026-11-27',
      time: '14:00',
      department: 'Neurology',
      clinician: 'Dr. Marcus Cho',
      durationMinutes: 30,
    }
  );
  assert.match(overridden, /14:00, Neurology$/);
});

test('humanizeAssistantError turns 404 and network errors into friendly copy', () => {
  assert.equal(
    humanizeAssistantError('Patient P-9999 not found (404)'),
    "I couldn't find that patient. Want to try another ID?"
  );
  assert.equal(
    humanizeAssistantError('Failed to fetch /api/assistant/query'),
    "I couldn't reach the clinic server right now. Check your connection and try again."
  );
});

test('sanitizeTechnicalText and buildCopyableReplyText strip preview jargon', () => {
  assert.equal(
    sanitizeTechnicalText('Rescheduled via CareDesk Assistant (Local REST Preview) in SQLite.'),
    'Rescheduled via CareDesk Assistant in clinic records.'
  );
  const copied = buildCopyableReplyText('Summary text', {
    replyId: 'r-1',
    intent: 'daily_briefing',
    headline: "Today's Briefing",
    summary: 'Administrator confirmed. Checked 6 visits in SQLite.',
    followUpSuggestions: [],
    engine: 'local-nlu-rest',
    integrationNotice: '',
    mode: 'development-local-rest-preview',
    plannedTools: [],
  });
  assert.match(copied, /Today's Briefing/);
  assert.match(copied, /Checked 6 visits in clinic records\./);
});
