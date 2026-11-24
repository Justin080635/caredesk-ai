import type { DatabaseSync } from 'node:sqlite';
import { ACCOUNT_ROLES, CLINIC_DEPARTMENTS } from '../../shared/constants';
import type {
  AccountRole,
  AccountSessionState,
  AuthUserProfile,
  ClinicDirectoryEntry,
  ClinicInvitation,
  ClinicMembership,
  ClinicMembershipWithClinic,
  ClinicTeamMember,
  ClinicWorkspace,
  DoctorApplication,
  MembershipStatus,
  Patient,
  PatientLinkRequest,
  StaffMember,
} from '../../shared/types';
import { getPermissionsForRole } from '../auth/session';
import { seedClinicStarterData, seedDefaultDoctorSchedule } from '../db/seed';
import { isValidEmail } from '../domain/rules';
import { recordAuditEvent } from './auditService';
import { ServiceError } from './patientService';

interface UserRow {
  id: string;
  firebase_uid: string;
  email: string;
  full_name: string;
  phone_number: string;
  avatar_url: string;
  auth_provider: string;
  created_at: string;
  updated_at: string;
}

interface ClinicRow {
  id: string;
  name: string;
  clinic_type: string;
  contact_phone: string;
  contact_email: string;
  location: string;
  organization_notes: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
}

interface MembershipRow {
  id: string;
  clinic_id: string;
  user_id: string;
  role: AccountRole;
  status: MembershipStatus;
  created_at: string;
  updated_at: string;
}

interface InvitationRow {
  id: string;
  clinic_id: string;
  email: string;
  full_name: string;
  role: AccountRole;
  status: 'Pending' | 'Accepted' | 'Revoked';
  invited_by_user_id: string;
  created_at: string;
  updated_at: string;
}

const VALID_ACCOUNT_ROLES: ReadonlySet<AccountRole> = new Set(ACCOUNT_ROLES);

function mapUserRow(row: UserRow): AuthUserProfile {
  return {
    id: row.id,
    firebaseUid: row.firebase_uid,
    email: row.email,
    fullName: row.full_name,
    phoneNumber: row.phone_number,
    avatarUrl: row.avatar_url,
    authProvider: row.auth_provider,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClinicRow(row: ClinicRow): ClinicWorkspace {
  return {
    id: row.id,
    name: row.name,
    clinicType: row.clinic_type,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    location: row.location,
    organizationNotes: row.organization_notes,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMembershipRow(row: MembershipRow): ClinicMembership {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInvitationRow(row: InvitationRow): ClinicInvitation {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
}

function generateNextId(db: DatabaseSync, table: string, prefix: string, base: number): string {
  const rows = db.prepare(`SELECT id FROM ${table}`).all() as Array<{ id: string }>;
  let maxNum = base;
  const regex = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of rows) {
    const match = regex.exec(r.id);
    if (match) {
      const n = Number(match[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `${prefix}-${maxNum + 1}`;
}

export function getUserById(db: DatabaseSync, userId: string): AuthUserProfile {
  const row = db
    .prepare(
      `SELECT id, firebase_uid, email, full_name, phone_number, avatar_url, auth_provider, created_at, updated_at
       FROM users
       WHERE id = ?`
    )
    .get(userId) as UserRow | undefined;

  if (!row) {
    throw new ServiceError(404, 'USER_NOT_FOUND', 'User account not found.');
  }
  return mapUserRow(row);
}

export function listClinicsDirectory(db: DatabaseSync): ClinicDirectoryEntry[] {
  const clinics = db
    .prepare(
      `SELECT id, name, clinic_type, contact_phone, location
       FROM clinics
       ORDER BY name ASC`
    )
    .all() as Array<{
      id: string;
      name: string;
      clinic_type: string;
      contact_phone: string;
      location: string;
    }>;

  const deptRows = db
    .prepare(
      `SELECT DISTINCT clinic_id, department
       FROM staff
       WHERE role = 'Clinician' AND status = 'Active'`
    )
    .all() as Array<{ clinic_id: string; department: string }>;

  const deptsByClinic = new Map<string, string[]>();
  for (const r of deptRows) {
    const list = deptsByClinic.get(r.clinic_id) ?? [];
    if (!list.includes(r.department)) list.push(r.department);
    deptsByClinic.set(r.clinic_id, list);
  }

  return clinics.map((c) => ({
    id: c.id,
    name: c.name,
    clinicType: c.clinic_type,
    location: c.location,
    contactPhone: c.contact_phone,
    departments: deptsByClinic.get(c.id) ?? [...CLINIC_DEPARTMENTS],
  }));
}

export function listUserClinics(
  db: DatabaseSync,
  userId: string
): ClinicMembershipWithClinic[] {
  const rows = db
    .prepare(
      `SELECT
         m.id AS m_id, m.clinic_id AS m_clinic_id, m.user_id AS m_user_id,
         m.role AS m_role, m.status AS m_status, m.created_at AS m_created_at, m.updated_at AS m_updated_at,
         c.id AS c_id, c.name AS c_name, c.clinic_type AS c_clinic_type,
         c.contact_phone AS c_contact_phone, c.contact_email AS c_contact_email,
         c.location AS c_location, c.organization_notes AS c_organization_notes,
         c.owner_user_id AS c_owner_user_id, c.created_at AS c_created_at, c.updated_at AS c_updated_at
       FROM clinic_memberships m
       INNER JOIN clinics c ON c.id = m.clinic_id
       WHERE m.user_id = ? AND m.status = 'Active'
       ORDER BY m.created_at ASC`
    )
    .all(userId) as Array<Record<string, string>>;

  return rows.map((r) => ({
    membership: {
      id: r.m_id,
      clinicId: r.m_clinic_id,
      userId: r.m_user_id,
      role: r.m_role as AccountRole,
      status: r.m_status as MembershipStatus,
      createdAt: r.m_created_at,
      updatedAt: r.m_updated_at,
    },
    clinic: {
      id: r.c_id,
      name: r.c_name,
      clinicType: r.c_clinic_type,
      contactPhone: r.c_contact_phone,
      contactEmail: r.c_contact_email,
      location: r.c_location,
      organizationNotes: r.c_organization_notes,
      ownerUserId: r.c_owner_user_id,
      createdAt: r.c_created_at,
      updatedAt: r.c_updated_at,
    },
  }));
}

export function resolveLinkedStaffIdForUser(
  db: DatabaseSync,
  clinicId: string,
  user: AuthUserProfile
): string | null {
  const byUserId = db
    .prepare(`SELECT id FROM staff WHERE clinic_id = ? AND user_id = ? LIMIT 1`)
    .get(clinicId, user.id) as { id: string } | undefined;
  if (byUserId) return byUserId.id;

  if (user.email) {
    const byEmail = db
      .prepare(`SELECT id FROM staff WHERE clinic_id = ? AND LOWER(email) = ? LIMIT 1`)
      .get(clinicId, user.email.trim().toLowerCase()) as { id: string } | undefined;
    if (byEmail) {
      db.prepare(`UPDATE staff SET user_id = ? WHERE id = ?`).run(user.id, byEmail.id);
      return byEmail.id;
    }
  }
  return null;
}

export function resolveLinkedPatientIdForUser(
  db: DatabaseSync,
  clinicId: string,
  userId: string
): string | null {
  // SECURITY INVARIANT: Never auto-link by email or name; strictly check explicit verified linked_user_id!
  const row = db
    .prepare(`SELECT id FROM patients WHERE clinic_id = ? AND linked_user_id = ? LIMIT 1`)
    .get(clinicId, userId) as { id: string } | undefined;
  return row?.id ?? null;
}

function getLinkedStaffForSession(
  db: DatabaseSync,
  clinicId: string,
  user: AuthUserProfile,
  role: AccountRole
): StaffMember | null {
  if (role === 'Patient') return null;
  const staffId = resolveLinkedStaffIdForUser(db, clinicId, user);
  if (!staffId) return null;
  const row = db
    .prepare(
      `SELECT id, user_id, full_name, role, department, specialty, qualifications, license_number,
              bio, avatar_url, email, contact_number, status, attendance_status,
              default_appointment_duration, max_daily_capacity, verification_status, created_at, updated_at
       FROM staff WHERE id = ? AND clinic_id = ?`
    )
    .get(staffId, clinicId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    userId: (row.user_id as string | null) ?? null,
    fullName: String(row.full_name),
    role: row.role as StaffMember['role'],
    department: String(row.department),
    specialty: String(row.specialty ?? ''),
    qualifications: String(row.qualifications ?? ''),
    licenseNumber: String(row.license_number ?? ''),
    bio: String(row.bio ?? ''),
    avatarUrl: String(row.avatar_url ?? ''),
    email: String(row.email ?? ''),
    contactNumber: String(row.contact_number ?? ''),
    status: row.status as StaffMember['status'],
    attendanceStatus: (row.attendance_status as StaffMember['attendanceStatus']) ?? 'On Duty',
    defaultAppointmentDuration: Number(row.default_appointment_duration ?? 30),
    maxDailyCapacity: Number(row.max_daily_capacity ?? 16),
    verificationStatus: (row.verification_status as StaffMember['verificationStatus']) ?? 'Approved',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function getLinkedPatientForSession(
  db: DatabaseSync,
  clinicId: string,
  userId: string,
  role: AccountRole
): Patient | null {
  if (role !== 'Patient') return null;
  const row = db
    .prepare(
      `SELECT id, full_name, date_of_birth, contact_number, email, registration_date,
              administrative_status, emergency_contact_name, emergency_contact_phone, portal_linked_at, created_at
       FROM patients WHERE clinic_id = ? AND linked_user_id = ? LIMIT 1`
    )
    .get(clinicId, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    dateOfBirth: String(row.date_of_birth),
    contactNumber: String(row.contact_number),
    email: String(row.email),
    registrationDate: String(row.registration_date),
    administrativeStatus: row.administrative_status as Patient['administrativeStatus'],
    emergencyContactName: String(row.emergency_contact_name ?? ''),
    emergencyContactPhone: String(row.emergency_contact_phone ?? ''),
    portalLinked: true,
    portalLinkedAt: String(row.portal_linked_at ?? ''),
    createdAt: String(row.created_at),
  };
}

function listPendingDoctorApplicationsForUser(
  db: DatabaseSync,
  userId: string
): DoctorApplication[] {
  const rows = db
    .prepare(
      `SELECT a.*, c.name AS clinic_name
       FROM doctor_applications a
       LEFT JOIN clinics c ON c.id = a.clinic_id
       WHERE a.user_id = ? AND a.status IN ('Pending Verification', 'Rejected')
       ORDER BY a.created_at DESC`
    )
    .all(userId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    clinicId: String(r.clinic_id),
    clinicName: r.clinic_name ? String(r.clinic_name) : undefined,
    userId: String(r.user_id),
    fullName: String(r.full_name),
    email: String(r.email),
    phoneNumber: String(r.phone_number ?? ''),
    specialty: String(r.specialty),
    department: String(r.department),
    qualifications: String(r.qualifications),
    licenseNumber: String(r.license_number),
    bio: String(r.bio ?? ''),
    status: r.status as DoctorApplication['status'],
    reviewNotes: String(r.review_notes ?? ''),
    reviewedByUserId: (r.reviewed_by_user_id as string | null) ?? null,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

function listPendingPatientLinkRequestsForUser(
  db: DatabaseSync,
  userId: string
): PatientLinkRequest[] {
  const rows = db
    .prepare(
      `SELECT r.*, c.name AS clinic_name
       FROM patient_link_requests r
       LEFT JOIN clinics c ON c.id = r.clinic_id
       WHERE r.user_id = ? AND r.status IN ('Pending', 'Rejected')
       ORDER BY r.created_at DESC`
    )
    .all(userId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    clinicId: String(r.clinic_id),
    clinicName: r.clinic_name ? String(r.clinic_name) : undefined,
    userId: String(r.user_id),
    fullName: String(r.full_name),
    email: String(r.email),
    phoneNumber: String(r.phone_number ?? ''),
    dateOfBirth: String(r.date_of_birth),
    notes: String(r.notes ?? ''),
    status: r.status as PatientLinkRequest['status'],
    linkedPatientId: (r.linked_patient_id as string | null) ?? null,
    reviewedByUserId: (r.reviewed_by_user_id as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export function resolveUserClinicMembership(
  db: DatabaseSync,
  userId: string,
  requestedClinicId?: string
): {
  status: 'authorized' | 'needs_onboarding' | 'forbidden_clinic';
  clinics: ClinicMembershipWithClinic[];
  clinic: ClinicWorkspace | null;
  membership: ClinicMembership | null;
} {
  const clinics = listUserClinics(db, userId);

  if (requestedClinicId) {
    const matched = clinics.find((c) => c.clinic.id === requestedClinicId);
    if (!matched) {
      return {
        status: 'forbidden_clinic',
        clinics,
        clinic: null,
        membership: null,
      };
    }
    return {
      status: 'authorized',
      clinics,
      clinic: matched.clinic,
      membership: matched.membership,
    };
  }

  if (clinics.length === 0) {
    return {
      status: 'needs_onboarding',
      clinics: [],
      clinic: null,
      membership: null,
    };
  }

  return {
    status: 'authorized',
    clinics,
    clinic: clinics[0].clinic,
    membership: clinics[0].membership,
  };
}

export function acceptPendingInvitationsForUser(
  db: DatabaseSync,
  user: AuthUserProfile
): void {
  if (!user.email) return;
  const normalizedEmail = user.email.trim().toLowerCase();
  const pending = db
    .prepare(
      `SELECT id, clinic_id, email, full_name, role, status, invited_by_user_id, created_at, updated_at
       FROM clinic_invitations
       WHERE LOWER(email) = ? AND status = 'Pending'`
    )
    .all(normalizedEmail) as unknown as InvitationRow[];

  if (pending.length === 0) return;

  const nowIso = new Date().toISOString();
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const inv of pending) {
      const existingMember = db
        .prepare('SELECT id FROM clinic_memberships WHERE clinic_id = ? AND user_id = ?')
        .get(inv.clinic_id, user.id) as { id: string } | undefined;

      if (!existingMember) {
        const membershipId = generateNextId(db, 'clinic_memberships', 'MBR', 1000);
        db.prepare(`
          INSERT INTO clinic_memberships (id, clinic_id, user_id, role, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'Active', ?, ?)
        `).run(membershipId, inv.clinic_id, user.id, inv.role, nowIso, nowIso);
      }

      if (inv.role === 'Doctor') {
        const existingStaff = db
          .prepare(`SELECT id FROM staff WHERE clinic_id = ? AND (user_id = ? OR LOWER(email) = ?) LIMIT 1`)
          .get(inv.clinic_id, user.id, normalizedEmail) as { id: string } | undefined;
        if (existingStaff) {
          db.prepare(`UPDATE staff SET user_id = ?, verification_status = 'Approved', updated_at = ? WHERE id = ?`)
            .run(user.id, nowIso, existingStaff.id);
        } else {
          const staffId = generateNextId(db, 'staff', 'STF', 1000);
          db.prepare(`
            INSERT INTO staff (
              id, clinic_id, user_id, full_name, role, department, specialty, email, contact_number,
              status, attendance_status, default_appointment_duration, max_daily_capacity, verification_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'Clinician', 'General Medicine', 'General Medicine', ?, ?, 'Active', 'On Duty', 30, 16, 'Approved', ?, ?)
          `).run(staffId, inv.clinic_id, user.id, inv.full_name || user.fullName, user.email, user.phoneNumber, nowIso, nowIso);
          seedDefaultDoctorSchedule(db, inv.clinic_id, staffId);
        }
      }

      db.prepare(`UPDATE clinic_invitations SET status = 'Accepted', updated_at = ? WHERE id = ?`).run(
        nowIso,
        inv.id
      );

      recordAuditEvent(db, {
        clinicId: inv.clinic_id,
        actor: user.fullName,
        action: 'ACCEPT_CLINIC_INVITATION',
        resourceType: 'membership',
        resourceId: inv.id,
        summary: `${user.email} accepted clinic invitation as ${inv.role}.`,
      });
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export function syncAuthenticatedUser(
  db: DatabaseSync,
  input: {
    firebaseUid: string;
    email: string;
    fullName?: string;
    phoneNumber?: string;
    avatarUrl?: string;
    authProvider?: string;
    requestedClinicId?: string;
  }
): AccountSessionState {
  const nowIso = new Date().toISOString();
  const normalizedEmail = (input.email ?? '').trim().toLowerCase();

  const existing = db
    .prepare(
      `SELECT id, firebase_uid, email, full_name, phone_number, avatar_url, auth_provider, created_at, updated_at
       FROM users
       WHERE firebase_uid = ?`
    )
    .get(input.firebaseUid) as UserRow | undefined;

  let user: AuthUserProfile;

  if (!existing) {
    const id = generateNextId(db, 'users', 'USR', 1000);
    const derivedName =
      (input.fullName ?? '').trim() ||
      (normalizedEmail ? normalizedEmail.split('@')[0] : 'Clinic User');
    const phone = (input.phoneNumber ?? '').trim();
    const avatar = (input.avatarUrl ?? '').trim();
    const provider = (input.authProvider ?? 'password').trim() || 'password';

    db.prepare(`
      INSERT INTO users (
        id, firebase_uid, email, full_name, phone_number, avatar_url, auth_provider, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.firebaseUid, normalizedEmail, derivedName, phone, avatar, provider, nowIso, nowIso);

    user = getUserById(db, id);
  } else {
    const nextName =
      input.fullName && input.fullName.trim().length >= 2
        ? input.fullName.trim()
        : existing.full_name;
    const nextPhone =
      input.phoneNumber !== undefined && input.phoneNumber.trim().length > 0
        ? input.phoneNumber.trim()
        : existing.phone_number;
    const nextAvatar =
      input.avatarUrl !== undefined && input.avatarUrl.trim().length > 0
        ? input.avatarUrl.trim()
        : existing.avatar_url;
    const nextEmail = normalizedEmail || existing.email;
    const nextProvider =
      input.authProvider && input.authProvider.trim()
        ? input.authProvider.trim()
        : existing.auth_provider;

    if (
      nextName !== existing.full_name ||
      nextPhone !== existing.phone_number ||
      nextAvatar !== existing.avatar_url ||
      nextEmail !== existing.email ||
      nextProvider !== existing.auth_provider
    ) {
      db.prepare(`
        UPDATE users
        SET full_name = ?, phone_number = ?, avatar_url = ?, email = ?, auth_provider = ?, updated_at = ?
        WHERE id = ?
      `).run(nextName, nextPhone, nextAvatar, nextEmail, nextProvider, nowIso, existing.id);
    }

    user = getUserById(db, existing.id);
  }

  // Activate any pending team invitations addressed to this verified email
  acceptPendingInvitationsForUser(db, user);

  const resolution = resolveUserClinicMembership(db, user.id, input.requestedClinicId);
  const activeRole = resolution.membership?.role ?? 'Clinic Staff';

  const linkedStaff =
    resolution.clinic && resolution.membership
      ? getLinkedStaffForSession(db, resolution.clinic.id, user, activeRole)
      : null;
  const linkedPatient =
    resolution.clinic && resolution.membership
      ? getLinkedPatientForSession(db, resolution.clinic.id, user.id, activeRole)
      : null;

  return {
    user,
    clinics: resolution.clinics,
    activeClinic: resolution.clinic,
    activeMembership: resolution.membership,
    needsOnboarding: resolution.clinics.length === 0,
    permissions: getPermissionsForRole(activeRole),
    linkedStaff,
    linkedPatient,
    pendingDoctorApplications: listPendingDoctorApplicationsForUser(db, user.id),
    pendingPatientLinkRequests: listPendingPatientLinkRequestsForUser(db, user.id),
  };
}

export interface OnboardClinicInput {
  clinicName: string;
  clinicType: string;
  contactPhone: string;
  contactEmail: string;
  location: string;
  organizationNotes?: string;
  seedSampleData?: boolean;
}

export function onboardClinicWorkspace(
  db: DatabaseSync,
  user: AuthUserProfile,
  input: OnboardClinicInput
): AccountSessionState {
  const clinicName = (input.clinicName ?? '').trim();
  const clinicType = (input.clinicType ?? '').trim();
  const contactPhone = (input.contactPhone ?? '').trim();
  const contactEmail = (input.contactEmail ?? '').trim();
  const location = (input.location ?? '').trim();
  const organizationNotes = (input.organizationNotes ?? '').trim();

  if (clinicName.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Clinic name must be at least 2 characters.');
  }
  if (clinicType.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please select or enter a clinic type.');
  }
  if (contactPhone.length < 7) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Clinic contact phone must be at least 7 characters.');
  }
  if (!isValidEmail(contactEmail)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please provide a valid clinic contact email.');
  }
  if (location.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Clinic location is required.');
  }

  const nowIso = new Date().toISOString();
  const clinicId = generateNextId(db, 'clinics', 'CLN', 1001);
  const membershipId = generateNextId(db, 'clinic_memberships', 'MBR', 1000);
  const adminStaffId = generateNextId(db, 'staff', 'STF', 1000);

  db.exec('BEGIN TRANSACTION;');
  try {
    db.prepare(`
      INSERT INTO clinics (
        id, name, clinic_type, contact_phone, contact_email, location, organization_notes,
        owner_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clinicId,
      clinicName,
      clinicType,
      contactPhone,
      contactEmail,
      location,
      organizationNotes,
      user.id,
      nowIso,
      nowIso
    );

    db.prepare(`
      INSERT INTO clinic_memberships (
        id, clinic_id, user_id, role, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'Clinic Administrator', 'Active', ?, ?)
    `).run(membershipId, clinicId, user.id, nowIso, nowIso);

    db.prepare(`
      INSERT INTO staff (
        id, clinic_id, user_id, full_name, role, department, specialty, email, contact_number, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Administrator', 'Clinic Operations', ?, ?, ?, 'Active', ?, ?)
    `).run(
      adminStaffId,
      clinicId,
      user.id,
      user.fullName,
      `${clinicType} Administration`,
      user.email,
      user.phoneNumber || contactPhone,
      nowIso,
      nowIso
    );

    recordAuditEvent(db, {
      clinicId,
      actor: `${user.fullName} (Clinic Administrator)`,
      action: 'CREATE_CLINIC_WORKSPACE',
      resourceType: 'clinic',
      resourceId: clinicId,
      summary: `Created clinic workspace "${clinicName}" (${clinicType}, ${location}) assigned to ${user.email}.`,
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  if (input.seedSampleData) {
    seedClinicStarterData(db, clinicId, {
      includePatientsAndAppointments: true,
      useFixedDemoIds: false,
    });
  }

  const clinics = listUserClinics(db, user.id);
  const created = clinics.find((c) => c.clinic.id === clinicId)!;

  return {
    user,
    clinics,
    activeClinic: created.clinic,
    activeMembership: created.membership,
    needsOnboarding: false,
    permissions: getPermissionsForRole('Clinic Administrator'),
    linkedStaff: getLinkedStaffForSession(db, clinicId, user, 'Clinic Administrator'),
    linkedPatient: null,
    pendingDoctorApplications: listPendingDoctorApplicationsForUser(db, user.id),
    pendingPatientLinkRequests: listPendingPatientLinkRequestsForUser(db, user.id),
  };
}

export function updatePersonalProfile(
  db: DatabaseSync,
  user: AuthUserProfile,
  patch: {
    fullName?: string;
    phoneNumber?: string;
    avatarUrl?: string;
  },
  activeClinicId?: string
): AuthUserProfile {
  const nextName = patch.fullName !== undefined ? patch.fullName.trim() : user.fullName;
  const nextPhone = patch.phoneNumber !== undefined ? patch.phoneNumber.trim() : user.phoneNumber;
  const nextAvatar = patch.avatarUrl !== undefined ? patch.avatarUrl.trim() : user.avatarUrl;

  if (nextName.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Full name must be at least 2 characters.');
  }
  if (nextPhone && nextPhone.length < 7) {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      'Phone number must be at least 7 characters when provided.'
    );
  }

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE users
    SET full_name = ?, phone_number = ?, avatar_url = ?, updated_at = ?
    WHERE id = ?
  `).run(nextName, nextPhone, nextAvatar, nowIso, user.id);

  if (activeClinicId && user.email) {
    db.prepare(`
      UPDATE staff
      SET full_name = ?, contact_number = ?, avatar_url = ?, updated_at = ?
      WHERE clinic_id = ? AND (user_id = ? OR LOWER(email) = ?)
    `).run(nextName, nextPhone, nextAvatar, nowIso, activeClinicId, user.id, user.email.toLowerCase());

    recordAuditEvent(db, {
      clinicId: activeClinicId,
      actor: nextName,
      action: 'UPDATE_ACCOUNT_PROFILE',
      resourceType: 'account',
      resourceId: user.id,
      summary: `Updated account profile for ${nextName} (${user.email}).`,
    });
  }

  return getUserById(db, user.id);
}

export function updateClinicWorkspace(
  db: DatabaseSync,
  clinicId: string,
  patch: {
    name?: string;
    clinicType?: string;
    contactPhone?: string;
    contactEmail?: string;
    location?: string;
    organizationNotes?: string;
  },
  actor: string
): ClinicWorkspace {
  const existingRow = db
    .prepare(
      `SELECT id, name, clinic_type, contact_phone, contact_email, location, organization_notes, owner_user_id, created_at, updated_at
       FROM clinics WHERE id = ?`
    )
    .get(clinicId) as ClinicRow | undefined;

  if (!existingRow) {
    throw new ServiceError(404, 'CLINIC_NOT_FOUND', `Clinic ${clinicId} was not found.`);
  }

  const nextName = patch.name !== undefined ? patch.name.trim() : existingRow.name;
  const nextType = patch.clinicType !== undefined ? patch.clinicType.trim() : existingRow.clinic_type;
  const nextPhone =
    patch.contactPhone !== undefined ? patch.contactPhone.trim() : existingRow.contact_phone;
  const nextEmail =
    patch.contactEmail !== undefined ? patch.contactEmail.trim() : existingRow.contact_email;
  const nextLocation =
    patch.location !== undefined ? patch.location.trim() : existingRow.location;
  const nextNotes =
    patch.organizationNotes !== undefined
      ? patch.organizationNotes.trim()
      : existingRow.organization_notes;

  if (nextName.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Clinic name must be at least 2 characters.');
  }
  if (nextType.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Clinic type is required.');
  }
  if (nextPhone.length < 7) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Clinic contact phone must be at least 7 characters.');
  }
  if (!isValidEmail(nextEmail)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please provide a valid clinic contact email.');
  }
  if (nextLocation.length < 2) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Clinic location is required.');
  }

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE clinics
    SET name = ?, clinic_type = ?, contact_phone = ?, contact_email = ?, location = ?, organization_notes = ?, updated_at = ?
    WHERE id = ?
  `).run(nextName, nextType, nextPhone, nextEmail, nextLocation, nextNotes, nowIso, clinicId);

  recordAuditEvent(db, {
    clinicId,
    actor,
    action: 'UPDATE_CLINIC_SETTINGS',
    resourceType: 'clinic',
    resourceId: clinicId,
    summary: `Updated clinic workspace details for "${nextName}" (${nextType}, ${nextLocation}).`,
  });

  const updated = db
    .prepare(
      `SELECT id, name, clinic_type, contact_phone, contact_email, location, organization_notes, owner_user_id, created_at, updated_at
       FROM clinics WHERE id = ?`
    )
    .get(clinicId) as unknown as ClinicRow;
  return mapClinicRow(updated);
}

export function listClinicTeam(
  db: DatabaseSync,
  clinicId: string
): { members: ClinicTeamMember[]; invitations: ClinicInvitation[] } {
  const memberRows = db
    .prepare(
      `SELECT
         m.id AS membership_id,
         u.id AS user_id,
         u.full_name,
         u.email,
         u.phone_number,
         u.avatar_url,
         m.role,
         m.status,
         m.created_at
       FROM clinic_memberships m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.clinic_id = ?
       ORDER BY m.created_at ASC`
    )
    .all(clinicId) as Array<{
      membership_id: string;
      user_id: string;
      full_name: string;
      email: string;
      phone_number: string;
      avatar_url: string;
      role: AccountRole;
      status: MembershipStatus;
      created_at: string;
    }>;

  const invitationRows = db
    .prepare(
      `SELECT id, clinic_id, email, full_name, role, status, invited_by_user_id, created_at, updated_at
       FROM clinic_invitations
       WHERE clinic_id = ? AND status = 'Pending'
       ORDER BY created_at DESC`
    )
    .all(clinicId) as unknown as InvitationRow[];

  return {
    members: memberRows.map((m) => ({
      membershipId: m.membership_id,
      userId: m.user_id,
      fullName: m.full_name,
      email: m.email,
      phoneNumber: m.phone_number,
      avatarUrl: m.avatar_url,
      role: m.role,
      status: m.status,
      createdAt: m.created_at,
    })),
    invitations: invitationRows.map(mapInvitationRow),
  };
}

export function inviteClinicMember(
  db: DatabaseSync,
  clinicId: string,
  invitedBy: AuthUserProfile,
  input: {
    email: string;
    fullName?: string;
    role: AccountRole;
  }
): { invitation?: ClinicInvitation; member?: ClinicTeamMember } {
  const email = (input.email ?? '').trim().toLowerCase();
  const fullName = (input.fullName ?? '').trim();
  const role = input.role;

  if (!isValidEmail(email)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Please enter a valid staff email address.');
  }
  if (!VALID_ACCOUNT_ROLES.has(role)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid staff role selected.');
  }

  const nowIso = new Date().toISOString();

  const existingUser = db
    .prepare(
      `SELECT id, firebase_uid, email, full_name, phone_number, avatar_url, auth_provider, created_at, updated_at
       FROM users WHERE LOWER(email) = ?`
    )
    .get(email) as UserRow | undefined;

  if (existingUser) {
    const existingMember = db
      .prepare('SELECT id FROM clinic_memberships WHERE clinic_id = ? AND user_id = ?')
      .get(clinicId, existingUser.id) as { id: string } | undefined;

    if (existingMember) {
      throw new ServiceError(
        409,
        'MEMBER_ALREADY_EXISTS',
        `${email} already belongs to this clinic workspace.`
      );
    }

    const membershipId = generateNextId(db, 'clinic_memberships', 'MBR', 1000);
    db.prepare(`
      INSERT INTO clinic_memberships (id, clinic_id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Active', ?, ?)
    `).run(membershipId, clinicId, existingUser.id, role, nowIso, nowIso);

    if (role === 'Doctor') {
      const existingStaff = db
        .prepare(`SELECT id FROM staff WHERE clinic_id = ? AND (user_id = ? OR LOWER(email) = ?) LIMIT 1`)
        .get(clinicId, existingUser.id, email) as { id: string } | undefined;
      if (existingStaff) {
        db.prepare(`UPDATE staff SET user_id = ?, verification_status = 'Approved', updated_at = ? WHERE id = ?`)
          .run(existingUser.id, nowIso, existingStaff.id);
      } else {
        const staffId = generateNextId(db, 'staff', 'STF', 1000);
        db.prepare(`
          INSERT INTO staff (
            id, clinic_id, user_id, full_name, role, department, specialty, email, contact_number,
            status, attendance_status, default_appointment_duration, max_daily_capacity, verification_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'Clinician', 'General Medicine', 'General Medicine', ?, ?, 'Active', 'On Duty', 30, 16, 'Approved', ?, ?)
        `).run(staffId, clinicId, existingUser.id, fullName || existingUser.full_name, existingUser.email, existingUser.phone_number, nowIso, nowIso);
        seedDefaultDoctorSchedule(db, clinicId, staffId);
      }
    }

    recordAuditEvent(db, {
      clinicId,
      actor: `${invitedBy.fullName} (Clinic Administrator)`,
      action: 'ADD_CLINIC_MEMBER',
      resourceType: 'membership',
      resourceId: membershipId,
      summary: `Added ${existingUser.full_name} (${email}) to clinic with role ${role}.`,
    });

    return {
      member: {
        membershipId,
        userId: existingUser.id,
        fullName: existingUser.full_name,
        email: existingUser.email,
        phoneNumber: existingUser.phone_number,
        avatarUrl: existingUser.avatar_url,
        role,
        status: 'Active',
        createdAt: nowIso,
      },
    };
  }

  const existingInvite = db
    .prepare(`SELECT id, status FROM clinic_invitations WHERE clinic_id = ? AND LOWER(email) = ?`)
    .get(clinicId, email) as { id: string; status: string } | undefined;

  if (existingInvite && existingInvite.status === 'Pending') {
    throw new ServiceError(
      409,
      'INVITATION_EXISTS',
      `A pending invitation already exists for ${email}.`
    );
  }

  const invitationId = generateNextId(db, 'clinic_invitations', 'INV', 1000);
  if (existingInvite) {
    db.prepare(`
      UPDATE clinic_invitations
      SET full_name = ?, role = ?, status = 'Pending', invited_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).run(fullName, role, invitedBy.id, nowIso, existingInvite.id);
  } else {
    db.prepare(`
      INSERT INTO clinic_invitations (
        id, clinic_id, email, full_name, role, status, invited_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?, ?)
    `).run(invitationId, clinicId, email, fullName, role, invitedBy.id, nowIso, nowIso);
  }

  const targetId = existingInvite?.id ?? invitationId;
  recordAuditEvent(db, {
    clinicId,
    actor: `${invitedBy.fullName} (Clinic Administrator)`,
    action: 'INVITE_CLINIC_MEMBER',
    resourceType: 'membership',
    resourceId: targetId,
    summary: `Invited ${email} to join clinic as ${role}.`,
  });

  const saved = db
    .prepare(
      `SELECT id, clinic_id, email, full_name, role, status, invited_by_user_id, created_at, updated_at
       FROM clinic_invitations WHERE id = ?`
    )
    .get(targetId) as unknown as InvitationRow;

  return { invitation: mapInvitationRow(saved) };
}

export function updateClinicMembership(
  db: DatabaseSync,
  clinicId: string,
  membershipId: string,
  actingUser: AuthUserProfile,
  patch: {
    role?: AccountRole;
    status?: MembershipStatus;
  }
): ClinicMembership {
  const existing = db
    .prepare(
      `SELECT id, clinic_id, user_id, role, status, created_at, updated_at
       FROM clinic_memberships
       WHERE id = ? AND clinic_id = ?`
    )
    .get(membershipId, clinicId) as MembershipRow | undefined;

  if (!existing) {
    throw new ServiceError(404, 'MEMBERSHIP_NOT_FOUND', 'Clinic membership not found.');
  }

  const nextRole = patch.role ?? existing.role;
  const nextStatus = patch.status ?? existing.status;

  if (!VALID_ACCOUNT_ROLES.has(nextRole)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid clinic role.');
  }
  if (!['Active', 'Invited', 'Suspended'].includes(nextStatus)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid membership status.');
  }

  if (
    existing.role === 'Clinic Administrator' &&
    existing.status === 'Active' &&
    (nextRole !== 'Clinic Administrator' || nextStatus !== 'Active')
  ) {
    const adminCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM clinic_memberships
           WHERE clinic_id = ? AND role = 'Clinic Administrator' AND status = 'Active'`
        )
        .get(clinicId) as { count: number }
    ).count;
    if (adminCount <= 1) {
      throw new ServiceError(
        409,
        'LAST_ADMINISTRATOR',
        'At least one active Clinic Administrator must remain assigned to the clinic.'
      );
    }
  }

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE clinic_memberships
    SET role = ?, status = ?, updated_at = ?
    WHERE id = ? AND clinic_id = ?
  `).run(nextRole, nextStatus, nowIso, membershipId, clinicId);

  recordAuditEvent(db, {
    clinicId,
    actor: `${actingUser.fullName} (Clinic Administrator)`,
    action: 'UPDATE_MEMBER_ROLE',
    resourceType: 'membership',
    resourceId: membershipId,
    summary: `Updated membership ${membershipId} to role ${nextRole} (${nextStatus}).`,
  });

  const updated = db
    .prepare(
      `SELECT id, clinic_id, user_id, role, status, created_at, updated_at
       FROM clinic_memberships WHERE id = ?`
    )
    .get(membershipId) as unknown as MembershipRow;
  return mapMembershipRow(updated);
}
