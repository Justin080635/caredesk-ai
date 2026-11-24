import type {
  Appointment,
  AssistantPlannedTool,
  AssistantResponse,
  AvailableSlot,
  FollowUpTask,
} from '../shared/types';

export interface FriendlyToolMeta {
  label: string;
  activeStep: string;
  completedStep: string;
  defaultDescription: string;
}

const TOOL_LABEL_MAP: Record<string, FriendlyToolMeta> = {
  get_daily_report: {
    label: "Today's Clinic Report",
    activeStep: "Checking today's appointments",
    completedStep: "Checked today's appointments",
    defaultDescription: "Reviewed today's visit counts and confirmation totals.",
  },
  get_overview_report: {
    label: 'Clinic Overview',
    activeStep: 'Reviewing clinic workload',
    completedStep: 'Reviewed clinic workload',
    defaultDescription: 'Checked overall patient volume, missed visits, and open tasks.',
  },
  get_appointments_today: {
    label: "Today's Appointments",
    activeStep: "Checking today's appointments",
    completedStep: "Checked today's appointments",
    defaultDescription: "Loaded today's scheduled visits.",
  },
  get_unconfirmed_appointments: {
    label: 'Unconfirmed Visits',
    activeStep: 'Checking unconfirmed visits',
    completedStep: 'Checked unconfirmed visits',
    defaultDescription: 'Looked up scheduled appointments awaiting confirmation.',
  },
  get_missed_appointments: {
    label: 'Missed Visits',
    activeStep: 'Checking missed appointments',
    completedStep: 'Checked missed appointments',
    defaultDescription: 'Reviewed recent missed appointments.',
  },
  get_pending_followups: {
    label: 'Follow-up Queue',
    activeStep: 'Checking follow-up tasks',
    completedStep: 'Checked follow-up tasks',
    defaultDescription: 'Checked open and overdue follow-up items.',
  },
  check_appointment_availability: {
    label: 'Open Slot Search',
    activeStep: 'Looking for open slots',
    completedStep: 'Found open slots',
    defaultDescription: 'Searched conflict-free 30-minute appointment slots.',
  },
  get_patient_by_id: {
    label: 'Patient Lookup',
    activeStep: 'Looking up patient details',
    completedStep: 'Loaded patient details',
    defaultDescription: 'Retrieved patient profile, visit history, and follow-ups.',
  },
  update_appointment: {
    label: 'Schedule Update',
    activeStep: 'Updating appointment time',
    completedStep: 'Updated appointment',
    defaultDescription: 'Saved the new appointment date and time.',
  },
  get_appointment_by_id: {
    label: 'Saved Record Check',
    activeStep: 'Confirming saved appointment',
    completedStep: 'Confirmed saved appointment',
    defaultDescription: 'Read back the saved appointment to verify changes.',
  },
  create_followup_task: {
    label: 'Follow-up Creation',
    activeStep: 'Creating follow-up tasks',
    completedStep: 'Created follow-up tasks',
    defaultDescription: 'Added follow-up outreach tasks to the clinic queue.',
  },
  get_doctor_dashboard: {
    label: 'Clinician Schedule',
    activeStep: 'Checking clinician schedule',
    completedStep: 'Checked clinician schedule',
    defaultDescription: 'Reviewed clinician appointments and duty status.',
  },
  get_doctor_availability: {
    label: 'Doctor Availability',
    activeStep: 'Checking available doctors',
    completedStep: 'Checked available doctors',
    defaultDescription: 'Checked clinician capacity and open slots.',
  },
  get_patient_portal_home: {
    label: 'Patient Portal Summary',
    activeStep: 'Checking your clinic records',
    completedStep: 'Checked your clinic records',
    defaultDescription: 'Loaded upcoming visits and follow-up instructions.',
  },
};

export function getFriendlyToolMeta(toolName: string): FriendlyToolMeta {
  const known = TOOL_LABEL_MAP[toolName];
  if (known) return known;
  const spaced = toolName
    .replace(/^get_/, 'check_')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    label: spaced,
    activeStep: `Running ${spaced.toLowerCase()}`,
    completedStep: `Completed ${spaced.toLowerCase()}`,
    defaultDescription: 'Checked live clinic records.',
  };
}

export function sanitizeTechnicalText(text: string): string {
  return text
    .replace(/\(Local REST Preview\)/gi, '')
    .replace(/\bvia local REST\b/gi, '')
    .replace(/\bin SQLite\b/gi, 'in clinic records')
    .replace(/\bclinic SQLite records\b/gi, 'clinic records')
    .replace(/\bSynthetic Patient\b/gi, 'Patient')
    .replace(/\bsynthetic patient\b/gi, 'patient')
    .replace(/\bAdministrator confirmed\.\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function formatFriendlyToolDescription(tool: Pick<AssistantPlannedTool, 'toolName' | 'description' | 'resultSummary'>): string {
  const meta = getFriendlyToolMeta(tool.toolName);
  const rawSummary = tool.resultSummary ? sanitizeTechnicalText(tool.resultSummary) : '';
  const rawDesc = tool.description ? sanitizeTechnicalText(tool.description) : '';

  if (rawSummary && !/status=|returned\s*\d{3}|GET\s+\/|PATCH\s+\/|POST\s+\//i.test(rawSummary)) {
    return rawSummary;
  }
  if (rawDesc && !/GET\s+\/|PATCH\s+\/|POST\s+\/|SQLite|MCP|REST/i.test(rawDesc)) {
    return rawDesc;
  }
  return meta.defaultDescription;
}

export function formatFriendlyToolStatus(status: AssistantPlannedTool['status'] | 'running'): string {
  switch (status) {
    case 'running':
      return 'Checking…';
    case 'executed-via-local-rest':
    case 'local-rest-preview':
      return 'Done';
    case 'awaiting-confirmation':
      return 'Needs approval';
    case 'failed':
    case 'mcp-not-connected':
      return "Couldn't finish";
    default:
      return 'Done';
  }
}

export function humanizeAssistantError(rawMessage: string): string {
  const msg = rawMessage.trim();
  const lower = msg.toLowerCase();

  if (!msg) {
    return 'Something went wrong while checking the clinic records. Want to try again?';
  }
  if (lower.includes('patient') && (lower.includes('not found') || lower.includes('404') || lower.includes('does not exist'))) {
    return "I couldn't find that patient. Want to try another ID?";
  }
  if (lower.includes('appointment') && (lower.includes('not found') || lower.includes('404'))) {
    return "I couldn't find that appointment record. Double-check the ID and try again.";
  }
  if (lower.includes('conflict') || lower.includes('already has') || lower.includes('unavailable')) {
    return 'That time slot is no longer free. Pick another open slot and try again.';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'That check took longer than expected. Want to give it another try?';
  }
  if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('unable to reach')) {
    return "I couldn't reach the clinic server right now. Check your connection and try again.";
  }
  if (lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('permission')) {
    return "Your account doesn't have permission to make that change.";
  }
  return sanitizeTechnicalText(msg);
}

function formatReadableShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return isoDate;
  }
  const dt = new Date(y, m - 1, d);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${weekdays[dt.getDay()]} ${months[dt.getMonth()]} ${dt.getDate()}`;
}

export function formatApprovalPreviewText(
  pending: NonNullable<AssistantResponse['pendingConfirmation']>,
  slotOverride?: AvailableSlot
): string {
  if (pending.actionType === 'reschedule_appointment') {
    const details = pending.details ?? {};
    const payload = (pending.payload ?? {}) as Record<string, string | undefined>;
    const rawPatient = String(details.Patient ?? payload.patientId ?? 'this patient');
    const cleanPatient = rawPatient.replace(/\s*\([A-Z]-\d+\)\s*$/, '').trim() || rawPatient;
    const prevRaw = String(details['Previous Slot'] ?? '');
    const prevParts = prevRaw.replace(/\s*\([^)]+\)\s*$/, '').trim().split(/\s+/);
    const prevFormatted =
      prevParts.length >= 2
        ? `${formatReadableShortDate(prevParts[0])} ${prevParts[1]}`
        : prevRaw || 'previous slot';

    const targetDate = slotOverride?.date ?? payload.appointmentDate ?? '';
    const targetTime = slotOverride?.time ?? payload.appointmentTime ?? '';
    const targetDept = slotOverride?.department ?? String(details.Department ?? payload.department ?? '');
    const nextFormatted = targetDate ? `${formatReadableShortDate(targetDate)} ${targetTime}`.trim() : targetTime;

    return `Move ${cleanPatient} from ${prevFormatted} to ${nextFormatted}${targetDept ? `, ${targetDept}` : ''}`;
  }

  return sanitizeTechnicalText(pending.summary);
}

export function formatAssistantGreeting(fullName?: string): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  let name = 'there';
  if (parts.length === 1) {
    name = parts[0];
  } else if (parts.length > 1) {
    if (/^(dr|mr|mrs|ms|mx|prof)\.?$/i.test(parts[0])) {
      const title = parts[0].endsWith('.') ? parts[0] : `${parts[0]}.`;
      name = `${title} ${parts[parts.length - 1]}`;
    } else {
      name = parts[0];
    }
  }
  return `Hi ${name}, I'm your CareDesk assistant. What would you like to sort out today?`;
}

export function buildCopyableReplyText(text: string, response?: AssistantResponse): string {
  const parts: string[] = [];
  if (response?.headline) {
    parts.push(sanitizeTechnicalText(response.headline));
  }
  const body = response?.markdown
    ? response.markdown
    : sanitizeTechnicalText(response?.summary || text);
  if (body) {
    parts.push(body);
  }
  if (response?.structuredData?.items && response.structuredData.items.length > 0) {
    const first = response.structuredData.items[0] as Partial<Appointment & FollowUpTask & AvailableSlot>;
    if ('appointmentDate' in first && first.appointmentDate) {
      const rows = (response.structuredData.items as Appointment[]).slice(0, 8).map(
        (a) => `- ${a.appointmentDate} ${a.appointmentTime} · ${a.patientName ?? a.patientId} (${a.department}, ${a.status})`
      );
      parts.push(rows.join('\n'));
    } else if ('dueDate' in first && first.dueDate) {
      const rows = (response.structuredData.items as FollowUpTask[]).slice(0, 8).map(
        (f) => `- Due ${f.dueDate} · ${f.patientName ?? f.patientId}: ${f.description} (${f.priority})`
      );
      parts.push(rows.join('\n'));
    } else if ('date' in first && 'time' in first && first.date) {
      const rows = (response.structuredData.items as AvailableSlot[]).slice(0, 6).map(
        (s) => `- ${s.date} ${s.time} · ${s.department} (${s.clinician})`
      );
      parts.push(rows.join('\n'));
    }
  }
  return parts.join('\n\n').trim();
}
