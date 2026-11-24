import type {
  AccountRole,
  AccountSessionState,
  AdministrativeStatus,
  AiConversationDetail,
  AiConversationSummary,
  Appointment,
  AppointmentSortField,
  AppointmentStatus,
  AppointmentType,
  AssistantResponse,
  AssistantStreamEvent,
  AuditLogEntry,
  AuthUserProfile,
  AvailableSlot,
  ClinicDirectoryEntry,
  ClinicInvitation,
  ClinicMembership,
  ClinicTeamMember,
  ClinicWorkspace,
  ConsultationRecord,
  DailyReport,
  DoctorApplication,
  DoctorAvailabilitySummary,
  DoctorDashboardData,
  DoctorDutyStatus,
  DoctorScheduleDay,
  DoctorUnavailability,
  ExplainableOperationalReport,
  FollowUpPriority,
  FollowUpStatus,
  FollowUpTask,
  FollowUpType,
  MembershipStatus,
  NotificationItem,
  OverviewReport,
  PaginatedAppointmentsResponse,
  Patient,
  PatientDetail,
  PatientHomeData,
  PatientLinkRequest,
  PatientPortalHealthData,
  PrescriptionItem,
  SortDirection,
  StaffDetail,
  StaffMember,
  StaffRole,
  StaffStatus,
  TestResultItem,
} from '../shared/types';

export class ApiClientError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let inMemoryToken: string | null = null;
let tokenProvider: (() => Promise<string | null>) | null = null;
let activeClinicId: string | null = null;

export function setSessionToken(token: string | null): void {
  inMemoryToken = token;
}

export function getSessionToken(): string | null {
  return inMemoryToken;
}

export function setTokenProvider(provider: (() => Promise<string | null>) | null): void {
  tokenProvider = provider;
}

export function setActiveClinicId(clinicId: string | null): void {
  activeClinicId = clinicId;
}

export function getActiveClinicId(): string | null {
  return activeClinicId;
}

async function resolveBearerToken(): Promise<string | null> {
  if (tokenProvider) {
    try {
      const provided = await tokenProvider();
      if (provided) return provided;
    } catch {
      // Fall back to cached token
    }
  }
  return inMemoryToken;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = await resolveBearerToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (activeClinicId && !headers.has('X-Clinic-Id')) {
    headers.set('X-Clinic-Id', activeClinicId);
  }

  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }

  if (!response.ok) {
    const errObj = parsed?.error as { code?: string; message?: string } | undefined;
    const code = errObj?.code ?? 'REQUEST_FAILED';
    const message = errObj?.message ?? `Request failed with status ${response.status}`;
    throw new ApiClientError(response.status, code, message);
  }

  return parsed as T;
}

export interface AuthConfigInfo {
  firebaseConfigured: boolean;
  projectId: string | null;
  providers: {
    google: boolean;
    emailPassword: boolean;
  };
}

export async function fetchAuthConfig(): Promise<AuthConfigInfo> {
  const res = await requestJson<{ data: AuthConfigInfo }>('/api/auth/config');
  return res.data;
}

export async function fetchClinicsDirectory(): Promise<ClinicDirectoryEntry[]> {
  const res = await requestJson<{ data: ClinicDirectoryEntry[] }>('/api/clinics/directory');
  return res.data;
}

export async function syncAuthSession(params?: {
  fullName?: string;
  phoneNumber?: string;
  requestedClinicId?: string;
}): Promise<AccountSessionState> {
  const res = await requestJson<{ data: AccountSessionState }>('/api/auth/sync', {
    method: 'POST',
    body: JSON.stringify(params ?? {}),
  });
  return res.data;
}

export async function onboardClinic(input: {
  clinicName: string;
  clinicType: string;
  contactPhone: string;
  contactEmail: string;
  location: string;
  organizationNotes?: string;
  seedSampleData?: boolean;
}): Promise<AccountSessionState> {
  const res = await requestJson<{ data: AccountSessionState }>('/api/clinics/onboard', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function submitDoctorApplication(input: {
  clinicId: string;
  fullName?: string;
  phoneNumber?: string;
  specialty: string;
  department?: string;
  qualifications: string;
  licenseNumber: string;
  bio?: string;
}): Promise<DoctorApplication> {
  const res = await requestJson<{ data: DoctorApplication }>('/api/doctor-applications', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function fetchDoctorApplications(status?: string): Promise<DoctorApplication[]> {
  const suffix = status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : '';
  const res = await requestJson<{ data: DoctorApplication[] }>(`/api/doctor-applications${suffix}`);
  return res.data;
}

export async function approveDoctorApplication(
  applicationId: string,
  reviewNotes?: string
): Promise<{ application: DoctorApplication; staff: StaffMember }> {
  const res = await requestJson<{ data: { application: DoctorApplication; staff: StaffMember } }>(
    `/api/doctor-applications/${encodeURIComponent(applicationId)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ reviewNotes }),
    }
  );
  return res.data;
}

export async function rejectDoctorApplication(
  applicationId: string,
  reviewNotes: string
): Promise<DoctorApplication> {
  const res = await requestJson<{ data: DoctorApplication }>(
    `/api/doctor-applications/${encodeURIComponent(applicationId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reviewNotes }),
    }
  );
  return res.data;
}

export async function claimPatientPortalRecord(input: {
  clinicId: string;
  claimCode: string;
  dateOfBirth: string;
}): Promise<AccountSessionState> {
  const res = await requestJson<{ data: AccountSessionState }>('/api/patient-portal/claim', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function submitPatientLinkRequest(input: {
  clinicId: string;
  fullName?: string;
  phoneNumber?: string;
  dateOfBirth: string;
  notes?: string;
}): Promise<PatientLinkRequest> {
  const res = await requestJson<{ data: PatientLinkRequest }>('/api/patient-portal/link-request', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function fetchPatientLinkRequests(status?: string): Promise<PatientLinkRequest[]> {
  const suffix = status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : '';
  const res = await requestJson<{ data: PatientLinkRequest[] }>(`/api/patient-link-requests${suffix}`);
  return res.data;
}

export async function approvePatientLinkRequest(
  requestId: string,
  existingPatientId?: string
): Promise<{ request: PatientLinkRequest; patient: Patient }> {
  const res = await requestJson<{ data: { request: PatientLinkRequest; patient: Patient } }>(
    `/api/patient-link-requests/${encodeURIComponent(requestId)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ existingPatientId }),
    }
  );
  return res.data;
}

export async function rejectPatientLinkRequest(
  requestId: string,
  reason?: string
): Promise<PatientLinkRequest> {
  const res = await requestJson<{ data: PatientLinkRequest }>(
    `/api/patient-link-requests/${encodeURIComponent(requestId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
  return res.data;
}

export async function generatePatientClaimCode(
  patientId: string
): Promise<{ patientId: string; claimCode: string; expiresAt: string }> {
  const res = await requestJson<{
    data: { patientId: string; claimCode: string; expiresAt: string };
  }>(`/api/patients/${encodeURIComponent(patientId)}/portal-invite`, {
    method: 'POST',
  });
  return res.data;
}

export async function fetchAccountProfile(): Promise<AccountSessionState> {
  const res = await requestJson<{ data: AccountSessionState }>('/api/account/profile');
  return res.data;
}

export async function updateAccountProfile(patch: {
  fullName?: string;
  phoneNumber?: string;
  avatarUrl?: string;
}): Promise<AuthUserProfile> {
  const res = await requestJson<{ data: AuthUserProfile }>('/api/account/profile', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.data;
}

export async function updateClinicSettings(patch: {
  name?: string;
  clinicType?: string;
  contactPhone?: string;
  contactEmail?: string;
  location?: string;
  organizationNotes?: string;
}): Promise<ClinicWorkspace> {
  const res = await requestJson<{ data: ClinicWorkspace }>('/api/clinic', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.data;
}

export async function seedSampleClinicData(): Promise<{ seeded: boolean }> {
  const res = await requestJson<{ data: { seeded: boolean } }>('/api/clinic/seed-sample', {
    method: 'POST',
  });
  return res.data;
}

export async function fetchClinicMembers(): Promise<{
  members: ClinicTeamMember[];
  invitations: ClinicInvitation[];
}> {
  const res = await requestJson<{
    data: { members: ClinicTeamMember[]; invitations: ClinicInvitation[] };
  }>('/api/clinic/members');
  return res.data;
}

export async function inviteClinicTeamMember(input: {
  email: string;
  fullName?: string;
  role: AccountRole;
}): Promise<{ invitation?: ClinicInvitation; member?: ClinicTeamMember }> {
  const res = await requestJson<{
    data: { invitation?: ClinicInvitation; member?: ClinicTeamMember };
  }>('/api/clinic/members/invite', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateClinicTeamMember(
  membershipId: string,
  patch: { role?: AccountRole; status?: MembershipStatus }
): Promise<ClinicMembership> {
  const res = await requestJson<{ data: ClinicMembership }>(
    `/api/clinic/members/${encodeURIComponent(membershipId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
  return res.data;
}

export async function recordLogoutAudit(): Promise<void> {
  try {
    await requestJson('/api/auth/logout-audit', { method: 'POST' });
  } catch {
    // Best-effort audit record prior to clearing local session
  }
}

export async function fetchPatients(params?: { search?: string; status?: string }): Promise<Patient[]> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status && params.status !== 'All') qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{ data: Patient[] }>(`/api/patients${suffix}`);
  return res.data;
}

export async function fetchPatientDetail(patientId: string): Promise<PatientDetail> {
  const res = await requestJson<{
    data: PatientDetail;
  }>(`/api/patients/${encodeURIComponent(patientId)}`);
  return res.data;
}

export async function createPatientRecord(input: {
  fullName: string;
  dateOfBirth: string;
  contactNumber: string;
  email: string;
  administrativeStatus: AdministrativeStatus;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}): Promise<Patient> {
  const res = await requestJson<{ data: Patient }>('/api/patients', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updatePatientRecord(
  patientId: string,
  patch: {
    fullName?: string;
    dateOfBirth?: string;
    contactNumber?: string;
    email?: string;
    administrativeStatus?: AdministrativeStatus;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
  }
): Promise<Patient> {
  const res = await requestJson<{ data: Patient }>(
    `/api/patients/${encodeURIComponent(patientId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
  return res.data;
}

export async function fetchAppointments(params?: {
  date?: string;
  status?: string;
  department?: string;
  clinician?: string;
  staffId?: string;
  patientId?: string;
  requestStatus?: string;
  search?: string;
}): Promise<Appointment[]> {
  const qs = new URLSearchParams();
  if (params?.date) qs.set('date', params.date);
  if (params?.status && params.status !== 'All') qs.set('status', params.status);
  if (params?.department && params.department !== 'All') qs.set('department', params.department);
  if (params?.clinician && params.clinician !== 'All') qs.set('clinician', params.clinician);
  if (params?.staffId) qs.set('staffId', params.staffId);
  if (params?.patientId) qs.set('patientId', params.patientId);
  if (params?.requestStatus && params.requestStatus !== 'All') qs.set('requestStatus', params.requestStatus);
  if (params?.search) qs.set('search', params.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{ data: Appointment[] }>(`/api/appointments${suffix}`);
  return res.data;
}

export async function fetchAppointmentsPaginated(params: {
  page: number;
  pageSize?: number;
  date?: string;
  status?: string;
  department?: string;
  clinician?: string;
  patientId?: string;
  requestStatus?: string;
  search?: string;
  sortBy?: AppointmentSortField;
  sortDir?: SortDirection;
}): Promise<PaginatedAppointmentsResponse> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page));
  qs.set('pageSize', String(params.pageSize ?? 10));
  if (params.date) qs.set('date', params.date);
  if (params.status && params.status !== 'All') qs.set('status', params.status);
  if (params.department && params.department !== 'All') qs.set('department', params.department);
  if (params.clinician && params.clinician !== 'All') qs.set('clinician', params.clinician);
  if (params.patientId) qs.set('patientId', params.patientId);
  if (params.requestStatus && params.requestStatus !== 'All') qs.set('requestStatus', params.requestStatus);
  if (params.search) qs.set('search', params.search);
  if (params.sortBy) qs.set('sortBy', params.sortBy);
  if (params.sortDir) qs.set('sortDir', params.sortDir);
  return requestJson<PaginatedAppointmentsResponse>(`/api/appointments?${qs.toString()}`);
}

export async function fetchAppointmentById(appointmentId: string): Promise<Appointment> {
  const res = await requestJson<{ data: Appointment }>(
    `/api/appointments/${encodeURIComponent(appointmentId)}`
  );
  return res.data;
}

export async function fetchAvailableSlots(params?: {
  startDate?: string;
  department?: string;
  specialty?: string;
  clinician?: string;
  staffId?: string;
  patientId?: string;
  appointmentType?: AppointmentType;
  timeOfDay?: 'morning' | 'afternoon' | 'any';
  days?: number;
  limit?: number;
}): Promise<AvailableSlot[]> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.department && params.department !== 'All') qs.set('department', params.department);
  if (params?.specialty && params.specialty !== 'All') qs.set('specialty', params.specialty);
  if (params?.clinician && params.clinician !== 'All') qs.set('clinician', params.clinician);
  if (params?.staffId) qs.set('staffId', params.staffId);
  if (params?.patientId) qs.set('patientId', params.patientId);
  if (params?.appointmentType) qs.set('appointmentType', params.appointmentType);
  if (params?.timeOfDay) qs.set('timeOfDay', params.timeOfDay);
  if (params?.days) qs.set('days', String(params.days));
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{ data: AvailableSlot[] }>(`/api/appointments/availability${suffix}`);
  return res.data;
}

export async function createAppointmentRecord(input: {
  patientId: string;
  staffId?: string | null;
  appointmentDate: string;
  appointmentTime: string;
  durationMinutes?: number;
  department: string;
  specialty?: string;
  appointmentType?: AppointmentType;
  clinician: string;
  status?: AppointmentStatus;
  notes?: string;
}): Promise<Appointment> {
  const res = await requestJson<{ data: Appointment }>('/api/appointments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateAppointmentRecord(
  appointmentId: string,
  patch: {
    appointmentDate?: string;
    appointmentTime?: string;
    department?: string;
    specialty?: string;
    appointmentType?: AppointmentType;
    clinician?: string;
    staffId?: string | null;
    status?: AppointmentStatus;
    requestStatus?: Appointment['requestStatus'];
    requestNotes?: string;
    notes?: string;
  }
): Promise<Appointment> {
  const res = await requestJson<{ data: Appointment }>(
    `/api/appointments/${encodeURIComponent(appointmentId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
  return res.data;
}

export async function deleteAppointmentRecord(appointmentId: string): Promise<{ deletedId: string }> {
  const res = await requestJson<{ data: { deletedId: string } }>(
    `/api/appointments/${encodeURIComponent(appointmentId)}`,
    { method: 'DELETE' }
  );
  return res.data;
}

export async function fetchStaff(params?: {
  search?: string;
  role?: string;
  department?: string;
  status?: string;
}): Promise<StaffMember[]> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.role && params.role !== 'All') qs.set('role', params.role);
  if (params?.department && params.department !== 'All') qs.set('department', params.department);
  if (params?.status && params.status !== 'All') qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{ data: StaffMember[] }>(`/api/staff${suffix}`);
  return res.data;
}

export async function fetchStaffDetail(staffId: string): Promise<StaffDetail> {
  const res = await requestJson<{ data: StaffDetail }>(
    `/api/staff/${encodeURIComponent(staffId)}`
  );
  return res.data;
}

export async function updateStaffRecord(
  staffId: string,
  patch: {
    role?: StaffRole;
    department?: string;
    specialty?: string;
    qualifications?: string;
    licenseNumber?: string;
    bio?: string;
    email?: string;
    contactNumber?: string;
    status?: StaffStatus;
    attendanceStatus?: DoctorDutyStatus;
    defaultAppointmentDuration?: number;
    maxDailyCapacity?: number;
  }
): Promise<StaffMember> {
  const res = await requestJson<{ data: StaffMember }>(
    `/api/staff/${encodeURIComponent(staffId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
  return res.data;
}

// Doctor Availability, Schedule, Unavailability & Duty Status
export async function fetchDoctorAvailability(params?: {
  date?: string;
  department?: string;
  specialty?: string;
  appointmentType?: AppointmentType;
  timeOfDay?: 'morning' | 'afternoon' | 'any';
}): Promise<DoctorAvailabilitySummary[]> {
  const qs = new URLSearchParams();
  if (params?.date) qs.set('date', params.date);
  if (params?.department && params.department !== 'All') qs.set('department', params.department);
  if (params?.specialty && params.specialty !== 'All') qs.set('specialty', params.specialty);
  if (params?.appointmentType) qs.set('appointmentType', params.appointmentType);
  if (params?.timeOfDay) qs.set('timeOfDay', params.timeOfDay);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{ data: DoctorAvailabilitySummary[] }>(
    `/api/doctors/availability${suffix}`
  );
  return res.data;
}

export async function fetchDoctorSchedule(staffId: string): Promise<DoctorScheduleDay[]> {
  const res = await requestJson<{ data: DoctorScheduleDay[] }>(
    `/api/doctors/${encodeURIComponent(staffId)}/schedule`
  );
  return res.data;
}

export async function saveDoctorSchedule(
  staffId: string,
  days: Array<{
    dayOfWeek: number;
    isWorking: boolean;
    startTime: string;
    endTime: string;
    breakStart?: string;
    breakEnd?: string;
    slotDurationMinutes?: number;
  }>
): Promise<DoctorScheduleDay[]> {
  const res = await requestJson<{ data: DoctorScheduleDay[] }>(
    `/api/doctors/${encodeURIComponent(staffId)}/schedule`,
    {
      method: 'PUT',
      body: JSON.stringify({ days }),
    }
  );
  return res.data;
}

export async function fetchDoctorUnavailability(staffId: string): Promise<DoctorUnavailability[]> {
  const res = await requestJson<{ data: DoctorUnavailability[] }>(
    `/api/doctors/${encodeURIComponent(staffId)}/unavailability`
  );
  return res.data;
}

export async function addDoctorUnavailability(
  staffId: string,
  input: {
    startDate: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    kind: DoctorUnavailability['kind'];
    reason?: string;
  }
): Promise<DoctorUnavailability> {
  const res = await requestJson<{ data: DoctorUnavailability }>(
    `/api/doctors/${encodeURIComponent(staffId)}/unavailability`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return res.data;
}

export async function deleteDoctorUnavailability(
  staffId: string,
  unavailId: string
): Promise<{ deleted: boolean }> {
  const res = await requestJson<{ data: { deleted: boolean } }>(
    `/api/doctors/${encodeURIComponent(staffId)}/unavailability/${encodeURIComponent(unavailId)}`,
    { method: 'DELETE' }
  );
  return res.data;
}

export async function updateDoctorDutyStatus(
  staffId: string,
  attendanceStatus: DoctorDutyStatus
): Promise<StaffMember> {
  const res = await requestJson<{ data: StaffMember }>(
    `/api/doctors/${encodeURIComponent(staffId)}/duty-status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ attendanceStatus }),
    }
  );
  return res.data;
}

// Doctor Portal Endpoints
export async function fetchDoctorDashboard(staffId?: string): Promise<DoctorDashboardData> {
  const suffix = staffId ? `?staffId=${encodeURIComponent(staffId)}` : '';
  const res = await requestJson<{ data: DoctorDashboardData }>(`/api/doctor/dashboard${suffix}`);
  return res.data;
}

export async function fetchDoctorPatients(
  search?: string,
  staffId?: string
): Promise<
  Array<
    Patient & {
      appointmentsCount: number;
      upcomingCount: number;
      lastAppointmentDate: string | null;
      consultationsCount: number;
    }
  >
> {
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  if (staffId) qs.set('staffId', staffId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{
    data: Array<
      Patient & {
        appointmentsCount: number;
        upcomingCount: number;
        lastAppointmentDate: string | null;
        consultationsCount: number;
      }
    >;
  }>(`/api/doctor/patients${suffix}`);
  return res.data;
}

export async function fetchDoctorActivity(staffId?: string): Promise<AuditLogEntry[]> {
  const suffix = staffId ? `?staffId=${encodeURIComponent(staffId)}` : '';
  const res = await requestJson<{ data: AuditLogEntry[] }>(`/api/doctor/activity${suffix}`);
  return res.data;
}

export async function updateDoctorProfile(patch: {
  specialty?: string;
  qualifications?: string;
  licenseNumber?: string;
  bio?: string;
  contactNumber?: string;
  email?: string;
  avatarUrl?: string;
  defaultAppointmentDuration?: number;
  maxDailyCapacity?: number;
}): Promise<StaffMember> {
  const res = await requestJson<{ data: StaffMember }>('/api/doctor/profile', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.data;
}

export async function fetchDoctorConsultations(staffId?: string): Promise<ConsultationRecord[]> {
  const suffix = staffId ? `?staffId=${encodeURIComponent(staffId)}` : '';
  const res = await requestJson<{ data: ConsultationRecord[] }>(
    `/api/doctor/consultations${suffix}`
  );
  return res.data;
}

export async function createConsultationRecord(input: {
  appointmentId?: string | null;
  patientId: string;
  consultationDate?: string;
  summary: string;
  diagnosisNotes?: string;
  recommendations?: string;
  prescriptions?: PrescriptionItem[];
  testResults?: TestResultItem[];
  patientVisible?: boolean;
  createFollowUp?: {
    description: string;
    reason?: string;
    dueDate: string;
    priority?: FollowUpPriority;
  } | null;
}): Promise<ConsultationRecord> {
  const res = await requestJson<{ data: ConsultationRecord }>('/api/consultations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

// Patient Portal Scoped Endpoints
export async function fetchPatientPortalHome(): Promise<PatientHomeData> {
  const res = await requestJson<{ data: PatientHomeData }>('/api/patient-portal/home');
  return res.data;
}

export async function fetchPatientPortalAppointments(): Promise<Appointment[]> {
  const res = await requestJson<{ data: Appointment[] }>('/api/patient-portal/appointments');
  return res.data;
}

export async function fetchPatientPortalAvailability(params?: {
  date?: string;
  department?: string;
  specialty?: string;
  staffId?: string;
  appointmentType?: AppointmentType;
  days?: number;
  limit?: number;
}): Promise<{ doctors: DoctorAvailabilitySummary[]; slots: AvailableSlot[] }> {
  const qs = new URLSearchParams();
  if (params?.date) qs.set('date', params.date);
  if (params?.department && params.department !== 'All') qs.set('department', params.department);
  if (params?.specialty && params.specialty !== 'All') qs.set('specialty', params.specialty);
  if (params?.staffId) qs.set('staffId', params.staffId);
  if (params?.appointmentType) qs.set('appointmentType', params.appointmentType);
  if (params?.days) qs.set('days', String(params.days));
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{
    data: { doctors: DoctorAvailabilitySummary[]; slots: AvailableSlot[] };
  }>(`/api/patient-portal/availability${suffix}`);
  return res.data;
}

export async function bookPatientPortalAppointment(input: {
  staffId?: string;
  clinician?: string;
  department?: string;
  specialty?: string;
  appointmentType?: AppointmentType;
  appointmentDate: string;
  appointmentTime: string;
  notes?: string;
}): Promise<Appointment> {
  const res = await requestJson<{ data: Appointment }>('/api/patient-portal/appointments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function requestPatientReschedule(
  appointmentId: string,
  input: { requestedDate: string; requestedTime: string; notes?: string }
): Promise<Appointment> {
  const res = await requestJson<{ data: Appointment }>(
    `/api/patient-portal/appointments/${encodeURIComponent(appointmentId)}/reschedule-request`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return res.data;
}

export async function requestPatientCancellation(
  appointmentId: string,
  notes: string
): Promise<Appointment> {
  const res = await requestJson<{ data: Appointment }>(
    `/api/patient-portal/appointments/${encodeURIComponent(appointmentId)}/cancel-request`,
    {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }
  );
  return res.data;
}

export async function fetchPatientPortalHealth(): Promise<PatientPortalHealthData> {
  const res = await requestJson<{ data: PatientPortalHealthData }>('/api/patient-portal/health');
  return res.data;
}

export async function updatePatientPortalProfile(patch: {
  contactNumber?: string;
  email?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}): Promise<Patient> {
  const res = await requestJson<{ data: Patient }>('/api/patient-portal/profile', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.data;
}

// Follow-ups
export async function fetchFollowups(params?: {
  status?: string;
  priority?: string;
  assignedStaffId?: string;
  followupType?: string;
  pendingOnly?: boolean;
}): Promise<FollowUpTask[]> {
  if (params?.pendingOnly) {
    const res = await requestJson<{ data: FollowUpTask[] }>('/api/followups/pending');
    return res.data;
  }
  const qs = new URLSearchParams();
  if (params?.status && params.status !== 'All') qs.set('status', params.status);
  if (params?.priority && params.priority !== 'All') qs.set('priority', params.priority);
  if (params?.assignedStaffId && params.assignedStaffId !== 'All') {
    qs.set('assignedStaffId', params.assignedStaffId);
  }
  if (params?.followupType && params.followupType !== 'All') {
    qs.set('followupType', params.followupType);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{ data: FollowUpTask[] }>(`/api/followups${suffix}`);
  return res.data;
}

export async function createFollowupRecord(input: {
  patientId: string;
  appointmentId?: string | null;
  followupType?: FollowUpType;
  assignedStaffId?: string | null;
  assignedToName?: string;
  description: string;
  reason?: string;
  priority: FollowUpPriority;
  dueDate: string;
}): Promise<FollowUpTask> {
  const res = await requestJson<{ data: FollowUpTask }>('/api/followups', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateFollowupRecord(
  taskId: string,
  patch: {
    status?: FollowUpStatus;
    priority?: FollowUpPriority;
    followupType?: FollowUpType;
    assignedStaffId?: string | null;
    assignedToName?: string;
    dueDate?: string;
    description?: string;
    reason?: string;
    completionNotes?: string;
  }
): Promise<FollowUpTask> {
  const res = await requestJson<{ data: FollowUpTask }>(
    `/api/followups/${encodeURIComponent(taskId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
  return res.data;
}

// Reports & Notifications
export async function fetchDailyReport(date?: string): Promise<DailyReport> {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await requestJson<{ data: DailyReport }>(`/api/reports/daily${suffix}`);
  return res.data;
}

export async function fetchOverviewReport(): Promise<OverviewReport> {
  const res = await requestJson<{ data: OverviewReport }>('/api/reports/overview');
  return res.data;
}

export async function fetchExplainableReport(params?: {
  periodStart?: string;
  periodEnd?: string;
  compareStart?: string;
  compareEnd?: string;
}): Promise<ExplainableOperationalReport> {
  const qs = new URLSearchParams();
  if (params?.periodStart) qs.set('periodStart', params.periodStart);
  if (params?.periodEnd) qs.set('periodEnd', params.periodEnd);
  if (params?.compareStart) qs.set('compareStart', params.compareStart);
  if (params?.compareEnd) qs.set('compareEnd', params.compareEnd);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{ data: ExplainableOperationalReport }>(
    `/api/reports/explainable${suffix}`
  );
  return res.data;
}

export async function fetchNotifications(
  limit = 40
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  const res = await requestJson<{
    data: NotificationItem[];
    meta: { count: number; unreadCount: number };
  }>(`/api/notifications?limit=${limit}`);
  return { items: res.data, unreadCount: res.meta?.unreadCount ?? 0 };
}

export async function markNotificationRead(id: string): Promise<void> {
  await requestJson(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<void> {
  await requestJson('/api/notifications/read-all', { method: 'POST' });
}

export async function fetchAuditLogs(limit = 20): Promise<AuditLogEntry[]> {
  const res = await requestJson<{ data: AuditLogEntry[] }>(`/api/audit-logs?limit=${limit}`);
  return res.data;
}

export async function fetchOpenApiDocs(): Promise<{
  openapi: string;
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, { summary?: string }>>;
}> {
  return requestJson('/api/docs');
}

// Assistant & Conversation Persistence
export async function fetchAiConversations(): Promise<AiConversationSummary[]> {
  const res = await requestJson<{ data: AiConversationSummary[] }>('/api/assistant/conversations');
  return res.data;
}

export async function createAiConversation(title?: string): Promise<AiConversationSummary> {
  const res = await requestJson<{ data: AiConversationSummary }>('/api/assistant/conversations', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return res.data;
}

export async function fetchAiConversationDetail(id: string): Promise<AiConversationDetail> {
  const res = await requestJson<{ data: AiConversationDetail }>(
    `/api/assistant/conversations/${encodeURIComponent(id)}`
  );
  return res.data;
}

export async function deleteAiConversation(id: string): Promise<void> {
  await requestJson(`/api/assistant/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function sendAssistantQuery(
  prompt: string,
  conversationId?: string
): Promise<AssistantResponse> {
  const res = await requestJson<{ data: AssistantResponse }>('/api/assistant/query', {
    method: 'POST',
    body: JSON.stringify({ prompt, conversationId }),
  });
  return res.data;
}

export async function streamAssistantQuery(
  prompt: string,
  options: {
    conversationId?: string;
    signal?: AbortSignal;
    onEvent: (event: AssistantStreamEvent) => void;
  }
): Promise<AssistantResponse> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = await resolveBearerToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (activeClinicId) {
    headers.set('X-Clinic-Id', activeClinicId);
  }

  const response = await fetch('/api/assistant/stream', {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, conversationId: options.conversationId }),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    let parsed: { error?: { code?: string; message?: string } } = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    throw new ApiClientError(
      response.status,
      parsed.error?.code ?? 'ASSISTANT_ERROR',
      parsed.error?.message ?? `Assistant request failed (${response.status}).`
    );
  }

  if (!response.body) {
    throw new ApiClientError(500, 'EMPTY_STREAM', 'Assistant stream returned no readable body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: AssistantResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundaryIdx = buffer.indexOf('\n\n');
    while (boundaryIdx !== -1) {
      const frame = buffer.slice(0, boundaryIdx);
      buffer = buffer.slice(boundaryIdx + 2);
      boundaryIdx = buffer.indexOf('\n\n');

      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        const event = JSON.parse(raw) as AssistantStreamEvent;
        options.onEvent(event);
        if (event.type === 'error') {
          throw new ApiClientError(500, event.code, event.message);
        }
        if (event.type === 'complete') {
          finalResponse = event.response;
        }
      }
    }
  }

  if (!finalResponse) {
    throw new ApiClientError(
      500,
      'EMPTY_RESPONSE',
      'Assistant stream ended before returning a complete response.'
    );
  }

  return finalResponse;
}

export async function confirmAssistantAction(params: {
  actionType: 'reschedule_appointment' | 'create_missed_followups';
  payload: unknown;
}): Promise<AssistantResponse> {
  const res = await requestJson<{ data: AssistantResponse }>('/api/assistant/confirm', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return res.data;
}
