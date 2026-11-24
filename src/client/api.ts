import type {
  AdministrativeStatus,
  Appointment,
  AppointmentStatus,
  AssistantResponse,
  AuditLogEntry,
  AvailableSlot,
  DailyReport,
  FollowUpPriority,
  FollowUpStatus,
  FollowUpTask,
  OverviewReport,
  Patient,
  UserRole,
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

export function setSessionToken(token: string | null): void {
  inMemoryToken = token;
}

export function getSessionToken(): string | null {
  return inMemoryToken;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (inMemoryToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const code = parsed?.error?.code ?? 'REQUEST_FAILED';
    const message = parsed?.error?.message ?? `Request failed with status ${response.status}`;
    throw new ApiClientError(response.status, code, message);
  }

  return parsed as T;
}

export interface SessionInfo {
  token: string;
  role: UserRole;
  actor: string;
  expiresAt: string;
}

export async function fetchAuthConfig(): Promise<{ passcodeRequired: boolean }> {
  const res = await requestJson<{ data: { passcodeRequired: boolean } }>('/api/auth/config');
  return res.data;
}

export async function startAuthSession(params: {
  role: UserRole;
  actor?: string;
  passcode?: string;
}): Promise<SessionInfo> {
  const res = await requestJson<{ data: SessionInfo }>('/api/auth/session', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  setSessionToken(res.data.token);
  return res.data;
}

export async function fetchPatients(params?: { search?: string; status?: string }): Promise<Patient[]> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status && params.status !== 'All') qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{ data: Patient[] }>(`/api/patients${suffix}`);
  return res.data;
}

export async function fetchPatientDetail(patientId: string): Promise<
  Patient & { appointments: Appointment[]; followups: FollowUpTask[] }
> {
  const res = await requestJson<{
    data: Patient & { appointments: Appointment[]; followups: FollowUpTask[] };
  }>(`/api/patients/${encodeURIComponent(patientId)}`);
  return res.data;
}

export async function createPatientRecord(input: {
  fullName: string;
  dateOfBirth: string;
  contactNumber: string;
  email: string;
  administrativeStatus: AdministrativeStatus;
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
  search?: string;
}): Promise<Appointment[]> {
  const qs = new URLSearchParams();
  if (params?.date) qs.set('date', params.date);
  if (params?.status && params.status !== 'All') qs.set('status', params.status);
  if (params?.department && params.department !== 'All') qs.set('department', params.department);
  if (params?.search) qs.set('search', params.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{ data: Appointment[] }>(`/api/appointments${suffix}`);
  return res.data;
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
  clinician?: string;
  patientId?: string;
  limit?: number;
}): Promise<AvailableSlot[]> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.department && params.department !== 'All') qs.set('department', params.department);
  if (params?.clinician && params.clinician !== 'All') qs.set('clinician', params.clinician);
  if (params?.patientId) qs.set('patientId', params.patientId);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{ data: AvailableSlot[] }>(`/api/appointments/availability${suffix}`);
  return res.data;
}

export async function createAppointmentRecord(input: {
  patientId: string;
  appointmentDate: string;
  appointmentTime: string;
  durationMinutes?: number;
  department: string;
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
    clinician?: string;
    status?: AppointmentStatus;
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

export async function fetchFollowups(params?: {
  status?: string;
  priority?: string;
  pendingOnly?: boolean;
}): Promise<FollowUpTask[]> {
  if (params?.pendingOnly) {
    const res = await requestJson<{ data: FollowUpTask[] }>('/api/followups/pending');
    return res.data;
  }
  const qs = new URLSearchParams();
  if (params?.status && params.status !== 'All') qs.set('status', params.status);
  if (params?.priority && params.priority !== 'All') qs.set('priority', params.priority);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await requestJson<{ data: FollowUpTask[] }>(`/api/followups${suffix}`);
  return res.data;
}

export async function createFollowupRecord(input: {
  patientId: string;
  appointmentId?: string | null;
  description: string;
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
  patch: { status?: FollowUpStatus; priority?: FollowUpPriority; dueDate?: string; description?: string }
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

export async function fetchDailyReport(date?: string): Promise<DailyReport> {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await requestJson<{ data: DailyReport }>(`/api/reports/daily${suffix}`);
  return res.data;
}

export async function fetchOverviewReport(): Promise<OverviewReport> {
  const res = await requestJson<{ data: OverviewReport }>('/api/reports/overview');
  return res.data;
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

export async function sendAssistantQuery(prompt: string): Promise<AssistantResponse> {
  const res = await requestJson<{ data: AssistantResponse }>('/api/assistant/query', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
  return res.data;
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
