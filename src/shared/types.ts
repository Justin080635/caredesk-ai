export type AdministrativeStatus = 'Active' | 'Pending Verification' | 'Inactive';

export type AppointmentStatus =
  | 'Scheduled'
  | 'Confirmed'
  | 'Completed'
  | 'Cancelled'
  | 'Missed';

export type AppointmentType =
  | 'Consultation'
  | 'New Patient'
  | 'Follow-Up'
  | 'Procedure'
  | 'Urgent';

export type AppointmentRequestStatus =
  | 'None'
  | 'Booking Requested'
  | 'Reschedule Requested'
  | 'Cancellation Requested';

export type FollowUpPriority = 'High' | 'Medium' | 'Low';

export type FollowUpStatus =
  | 'Pending'
  | 'Scheduled'
  | 'Due'
  | 'Overdue'
  | 'Completed'
  | 'Cancelled';

export type FollowUpType = 'Clinical Recommendation' | 'Administrative Contact';

export type UserRole = 'administrator' | 'viewer';

export type AccountRole =
  | 'Clinic Administrator'
  | 'Doctor'
  | 'Receptionist'
  | 'Clinic Staff'
  | 'Patient';

export type MembershipStatus = 'Active' | 'Invited' | 'Suspended';

export type DoctorDutyStatus =
  | 'On Duty'
  | 'Checked In'
  | 'Available'
  | 'In Consultation'
  | 'On Break'
  | 'Off Duty'
  | 'On Leave';

export type DoctorVerificationStatus = 'Pending Verification' | 'Approved' | 'Rejected';

export interface RolePermissions {
  canViewRecords: boolean;
  canViewClinicReports: boolean;
  canManagePatients: boolean;
  canManageAppointments: boolean;
  canDeleteAppointments: boolean;
  canManageFollowups: boolean;
  canManageStaff: boolean;
  canViewAuditHistory: boolean;
  canManageClinicSettings: boolean;
  canManageTeamRoles: boolean;
  canConfirmAssistantActions: boolean;
  canAuthorConsultations: boolean;
  canManageOwnSchedule: boolean;
  isPatientPortalOnly: boolean;
}

export interface DoctorScope {
  staffId: string;
  doctorName: string;
}

export interface AuthUserProfile {
  id: string;
  firebaseUid: string;
  email: string;
  fullName: string;
  phoneNumber: string;
  avatarUrl: string;
  authProvider: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicWorkspace {
  id: string;
  name: string;
  clinicType: string;
  contactPhone: string;
  contactEmail: string;
  location: string;
  organizationNotes: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicDirectoryEntry {
  id: string;
  name: string;
  clinicType: string;
  location: string;
  contactPhone: string;
  departments: string[];
}

export interface ClinicMembership {
  id: string;
  clinicId: string;
  userId: string;
  role: AccountRole;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicMembershipWithClinic {
  membership: ClinicMembership;
  clinic: ClinicWorkspace;
}

export interface ClinicTeamMember {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  avatarUrl: string;
  role: AccountRole;
  status: MembershipStatus;
  createdAt: string;
}

export interface ClinicInvitation {
  id: string;
  clinicId: string;
  email: string;
  fullName: string;
  role: AccountRole;
  status: 'Pending' | 'Accepted' | 'Revoked';
  createdAt: string;
}

export interface DoctorApplication {
  id: string;
  clinicId: string;
  clinicName?: string;
  userId: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  specialty: string;
  department: string;
  qualifications: string;
  licenseNumber: string;
  bio: string;
  status: DoctorVerificationStatus;
  reviewNotes: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatientLinkRequest {
  id: string;
  clinicId: string;
  clinicName?: string;
  userId: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string;
  notes: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  linkedPatientId: string | null;
  reviewedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountSessionState {
  user: AuthUserProfile;
  clinics: ClinicMembershipWithClinic[];
  activeClinic: ClinicWorkspace | null;
  activeMembership: ClinicMembership | null;
  needsOnboarding: boolean;
  permissions: RolePermissions;
  linkedStaff: StaffMember | null;
  linkedPatient: Patient | null;
  pendingDoctorApplications: DoctorApplication[];
  pendingPatientLinkRequests: PatientLinkRequest[];
}

export interface Patient {
  id: string;
  fullName: string;
  dateOfBirth: string;
  contactNumber: string;
  email: string;
  registrationDate: string;
  administrativeStatus: AdministrativeStatus;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  portalLinked?: boolean;
  portalLinkedAt?: string;
  createdAt: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName?: string;
  staffId?: string | null;
  appointmentDate: string;
  appointmentTime: string;
  durationMinutes: number;
  department: string;
  specialty?: string;
  appointmentType?: AppointmentType;
  clinician: string;
  status: AppointmentStatus;
  requestedBy?: 'staff' | 'patient';
  requestStatus?: AppointmentRequestStatus;
  requestNotes?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpTask {
  id: string;
  patientId: string;
  patientName?: string;
  appointmentId: string | null;
  followupType?: FollowUpType;
  assignedStaffId?: string | null;
  assignedToName?: string;
  description: string;
  reason?: string;
  priority: FollowUpPriority;
  createdDate: string;
  dueDate: string;
  status: FollowUpStatus;
  completedAt?: string | null;
  completedBy?: string;
  completionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type StaffRole = 'Clinician' | 'Administrator' | 'Coordinator' | 'Viewer';

export type StaffStatus = 'Active' | 'On Leave' | 'Inactive';

export type AppointmentSortField =
  | 'id'
  | 'appointmentDate'
  | 'patientName'
  | 'department'
  | 'clinician'
  | 'status';

export type SortDirection = 'asc' | 'desc';

export interface DoctorScheduleDay {
  id: string;
  clinicId: string;
  staffId: string;
  dayOfWeek: number; // 0 (Sunday) - 6 (Saturday)
  isWorking: boolean;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
  slotDurationMinutes: number;
  updatedAt: string;
}

export interface DoctorUnavailability {
  id: string;
  clinicId: string;
  staffId: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  kind: 'Leave' | 'Break' | 'Unavailable';
  reason: string;
  createdAt: string;
}

export interface StaffMember {
  id: string;
  userId?: string | null;
  fullName: string;
  role: StaffRole;
  department: string;
  specialty: string;
  qualifications?: string;
  licenseNumber?: string;
  bio?: string;
  avatarUrl?: string;
  email: string;
  contactNumber: string;
  status: StaffStatus;
  attendanceStatus?: DoctorDutyStatus;
  effectiveOperationalState?: DoctorDutyStatus;
  defaultAppointmentDuration?: number;
  maxDailyCapacity?: number;
  verificationStatus?: DoctorVerificationStatus;
  createdAt: string;
  updatedAt: string;
  assignedAppointmentsCount?: number;
  upcomingAppointmentsCount?: number;
  completedAppointmentsCount?: number;
}

export interface StaffResponsibility {
  id: string;
  title: string;
  scope: string;
  metricLabel?: string;
  metricValue?: string;
}

export interface StaffDetail extends StaffMember {
  appointments: Appointment[];
  schedules: DoctorScheduleDay[];
  unavailability: DoctorUnavailability[];
  responsibilities: StaffResponsibility[];
  activity: AuditLogEntry[];
  permissions: {
    canEditProfile: boolean;
    canViewAuditHistory: boolean;
  };
}

export interface DoctorAvailabilitySummary {
  staffId: string;
  fullName: string;
  department: string;
  specialty: string;
  qualifications: string;
  attendanceStatus: DoctorDutyStatus;
  effectiveOperationalState: DoctorDutyStatus;
  isBookableOnDate: boolean;
  workingHoursLabel: string;
  breakWindowLabel: string;
  bookedCount: number;
  maxDailyCapacity: number;
  nextAvailableSlot: AvailableSlot | null;
  availableSlots: AvailableSlot[];
}

export interface PrescriptionItem {
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface TestResultItem {
  testName: string;
  observedDate: string;
  summary: string;
  statusLabel: 'Normal' | 'Review Required' | 'Pending';
}

export interface ConsultationRecord {
  id: string;
  clinicId: string;
  appointmentId: string | null;
  patientId: string;
  patientName?: string;
  staffId: string | null;
  doctorName: string;
  consultationDate: string;
  summary: string;
  diagnosisNotes: string;
  recommendations: string;
  prescriptions: PrescriptionItem[];
  testResults: TestResultItem[];
  patientVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  clinicId: string;
  userId: string | null;
  patientId: string | null;
  staffId: string | null;
  title: string;
  message: string;
  kind: 'appointment' | 'followup' | 'consultation' | 'verification' | 'system';
  relatedType: string;
  relatedId: string;
  isRead: boolean;
  createdAt: string;
}

export interface DoctorDashboardData {
  doctor: StaffMember;
  todayDate: string;
  effectiveOperationalState: DoctorDutyStatus;
  todayAppointments: Appointment[];
  nextAppointment: Appointment | null;
  assignedPatientsCount: number;
  pendingConsultationsCount: number;
  followupsRequiringAttention: FollowUpTask[];
  upcomingUnavailability: DoctorUnavailability[];
  todaySchedule: DoctorScheduleDay | null;
}

export interface PatientHomeData {
  patient: Patient;
  clinic: ClinicWorkspace;
  upcomingAppointments: Appointment[];
  nextAppointment: Appointment | null;
  recentConsultationsCount: number;
  openFollowups: FollowUpTask[];
  unreadNotificationsCount: number;
  availableSpecialties: string[];
}

export interface PatientPortalHealthData {
  patient: Patient;
  consultations: ConsultationRecord[];
  prescriptions: Array<PrescriptionItem & { consultationId: string; consultationDate: string; doctorName: string }>;
  testResults: Array<TestResultItem & { consultationId: string; doctorName: string }>;
  followups: FollowUpTask[];
}

export interface AppointmentPaginationMeta {
  count: number;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortBy: AppointmentSortField;
  sortDir: SortDirection;
  statusCounts: Record<AppointmentStatus, number>;
}

export interface PaginatedAppointmentsResponse {
  data: Appointment[];
  meta: AppointmentPaginationMeta;
}

export interface PatientDetail extends Patient {
  appointments: Appointment[];
  followups: FollowUpTask[];
  consultations: ConsultationRecord[];
  activity: AuditLogEntry[];
  permissions: {
    canEdit: boolean;
    canViewAuditHistory: boolean;
    canAuthorConsultations: boolean;
    canManagePortalLink: boolean;
  };
}

export interface AuditLogEntry {
  id: number;
  actor: string;
  action: string;
  resourceType:
    | 'patient'
    | 'appointment'
    | 'followup'
    | 'session'
    | 'staff'
    | 'clinic'
    | 'account'
    | 'membership'
    | 'doctor_application'
    | 'consultation'
    | 'schedule'
    | 'notification'
    | 'patient_link';
  resourceId: string;
  summary: string;
  createdAt: string;
}

export interface AvailableSlot {
  date: string;
  time: string;
  department: string;
  specialty?: string;
  clinician: string;
  staffId?: string;
  durationMinutes: number;
  appointmentType?: AppointmentType;
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

export interface ExplainableSectionInsight {
  id: string;
  title: string;
  headlineMetricLabel: string;
  headlineMetricValue: string;
  comparisonDeltaLabel: string;
  metrics: Array<{ label: string; value: string | number }>;
  explanation: {
    whatHappened: string;
    whatItMeans: string;
    whyItMatters: string;
    appropriateAction: string;
  };
}

export interface ExplainableOperationalReport {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  compareStart: string;
  compareEnd: string;
  rawSummary: {
    totalAppointments: number;
    completedAppointments: number;
    missedAppointments: number;
    cancelledAppointments: number;
    confirmedOrCompletedRate: number;
    noShowRate: number;
    activePatients: number;
    newRegistrationsInPeriod: number;
    followupsCompletedInPeriod: number;
    followupsOverdueCount: number;
  };
  doctorUtilization: Array<{
    staffId: string;
    doctorName: string;
    department: string;
    scheduledAppointments: number;
    completedAppointments: number;
    missedAppointments: number;
    capacitySlotsInPeriod: number;
    utilizationRate: number;
  }>;
  sections: ExplainableSectionInsight[];
}

export interface AssistantPlannedTool {
  toolName: string;
  endpoint: string;
  status:
    | 'local-rest-preview'
    | 'awaiting-confirmation'
    | 'executed-via-local-rest'
    | 'mcp-not-connected'
    | 'failed';
  description: string;
  durationMs?: number;
  resultSummary?: string;
  errorMessage?: string;
}

export interface AssistantResponseSection {
  id: string;
  title: string;
  body?: string;
  bullets?: string[];
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
  markdown?: string;
  sections?: AssistantResponseSection[];
  followUpSuggestions?: string[];
  engine?: 'gemini-streaming-rest' | 'local-nlu-rest';
  integrationNotice: string;
  mode: 'development-local-rest-preview';
  plannedTools: AssistantPlannedTool[];
  structuredData?: {
    type:
      | 'daily_briefing'
      | 'unconfirmed_appointments'
      | 'missed_appointments'
      | 'followup_plan'
      | 'followup_queue'
      | 'available_slots'
      | 'reschedule_proposal'
      | 'patient_summary'
      | 'doctor_availability'
      | 'doctor_schedule'
      | 'consultation_summary'
      | 'patient_appointments'
      | 'action_completed'
      | 'non_clinical_notice';
    items?: unknown[];
    patient?: Patient;
    metrics?: Record<string, number | string>;
  };
  pendingConfirmation?: PendingConfirmationAction;
  conversationId?: string;
}

export interface AiConversationSummary {
  id: string;
  clinicId: string;
  userId: string;
  role: AccountRole;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  intent: string;
  response: AssistantResponse | null;
  createdAt: string;
}

export interface AiConversationDetail extends AiConversationSummary {
  messages: AiMessageRecord[];
}

export type AssistantStreamEvent =
  | {
      type: 'status';
      phase: 'analyzing' | 'querying' | 'synthesizing';
      message: string;
    }
  | {
      type: 'tool_start';
      toolCallId: string;
      toolName: string;
      endpoint: string;
      description: string;
    }
  | {
      type: 'tool_done';
      toolCallId: string;
      toolName: string;
      endpoint: string;
      status: 'executed-via-local-rest' | 'awaiting-confirmation' | 'failed';
      durationMs: number;
      resultSummary: string;
      errorMessage?: string;
    }
  | {
      type: 'delta';
      text: string;
    }
  | {
      type: 'complete';
      response: AssistantResponse;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };
