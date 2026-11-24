export type AdministrativeStatus = 'Active' | 'Pending Verification' | 'Inactive';

export type AppointmentStatus =
  | 'Scheduled'
  | 'Confirmed'
  | 'Completed'
  | 'Cancelled'
  | 'Missed';

export type FollowUpPriority = 'High' | 'Medium' | 'Low';

export type FollowUpStatus = 'Pending' | 'In Progress' | 'Completed' | 'Dismissed';

export type UserRole = 'administrator' | 'viewer';

export interface Patient {
  id: string;
  fullName: string;
  dateOfBirth: string;
  contactNumber: string;
  email: string;
  registrationDate: string;
  administrativeStatus: AdministrativeStatus;
  createdAt: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName?: string;
  appointmentDate: string;
  appointmentTime: string;
  durationMinutes: number;
  department: string;
  clinician: string;
  status: AppointmentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpTask {
  id: string;
  patientId: string;
  patientName?: string;
  appointmentId: string | null;
  description: string;
  priority: FollowUpPriority;
  createdDate: string;
  dueDate: string;
  status: FollowUpStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: number;
  actor: string;
  action: string;
  resourceType: 'patient' | 'appointment' | 'followup' | 'session';
  resourceId: string;
  summary: string;
  createdAt: string;
}

export interface AvailableSlot {
  date: string;
  time: string;
  department: string;
  clinician: string;
  durationMinutes: number;
}

export interface DailyReport {
  date: string;
  totalAppointments: number;
  confirmedAppointments: number;
  unconfirmedAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  missedAppointments: number;
  pendingFollowUps: number;
  statusBreakdown: Record<AppointmentStatus, number>;
  departmentBreakdown: Array<{ department: string; count: number }>;
  upcomingAppointments: Appointment[];
  unconfirmedList: Appointment[];
  missedTodayList: Appointment[];
}

export interface CalendarDaySummary {
  date: string;
  total: number;
  confirmed: number;
  scheduled: number;
  missed: number;
  completed: number;
}

export interface OverviewReport {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  todayDate: string;
  totalPatients: number;
  activePatients: number;
  totalAppointmentsInWindow: number;
  todayTotalAppointments: number;
  yesterdayTotalAppointments: number;
  missedLastSevenDaysCount: number;
  pendingFollowUpsCount: number;
  overdueFollowUpsCount: number;
  highPriorityFollowUpsCount: number;
  statusBreakdown: Record<AppointmentStatus, number>;
  dailyTrend: Array<{
    date: string;
    total: number;
    confirmed: number;
    scheduled: number;
    completed: number;
    missed: number;
    cancelled: number;
  }>;
  patientRegistrationTrend: Array<{
    period: string;
    count: number;
  }>;
  calendarSummary: CalendarDaySummary[];
  missedLastSevenDays: Appointment[];
  overdueFollowUps: FollowUpTask[];
  recentActivity: AuditLogEntry[];
}

export interface AssistantPlannedTool {
  toolName: string;
  endpoint: string;
  status: 'local-rest-preview' | 'awaiting-confirmation' | 'executed-via-local-rest' | 'mcp-not-connected';
  description: string;
}

export interface PendingConfirmationAction {
  confirmationId: string;
  actionType: 'reschedule_appointment' | 'create_missed_followups';
  title: string;
  summary: string;
  details: Record<string, string | number | null>;
  payload: unknown;
}

export interface AssistantResponse {
  replyId: string;
  intent: string;
  headline: string;
  summary: string;
  integrationNotice: string;
  mode: 'development-local-rest-preview';
  plannedTools: AssistantPlannedTool[];
  structuredData?: {
    type:
      | 'daily_briefing'
      | 'unconfirmed_appointments'
      | 'missed_appointments'
      | 'followup_plan'
      | 'available_slots'
      | 'reschedule_proposal'
      | 'action_completed'
      | 'non_clinical_notice';
    items?: unknown[];
    metrics?: Record<string, number | string>;
  };
  pendingConfirmation?: PendingConfirmationAction;
}
