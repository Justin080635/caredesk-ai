import type { DatabaseSync } from 'node:sqlite';
import type { Appointment, DoctorScope, FollowUpTask } from '../../shared/types';
import type { AuthenticatedClinicContext } from '../auth/session';
import { ServiceError } from './patientService';

interface StaffLinkRow {
  id: string;
  clinic_id: string;
  user_id: string | null;
  full_name: string;
  role: string;
  status: string;
  verification_status: string;
}

/**
 * Resolves and validates the authenticated Doctor's clinician scope in the active clinic.
 * Fails closed with 403 DOCTOR_PROFILE_NOT_LINKED when no verified, active clinician staff row
 * is linked to the user account.
 */
export function requireDoctorScope(
  db: DatabaseSync,
  ctx: AuthenticatedClinicContext
): DoctorScope {
  if (!ctx.linkedStaffId) {
    throw new ServiceError(
      403,
      'DOCTOR_PROFILE_NOT_LINKED',
      'No verified clinician staff profile is linked to this account in the active clinic.'
    );
  }

  const staffRow = db
    .prepare(
      `SELECT id, clinic_id, user_id, full_name, role, status, verification_status
       FROM staff
       WHERE id = ? AND clinic_id = ?`
    )
    .get(ctx.linkedStaffId, ctx.clinic.id) as StaffLinkRow | undefined;

  if (
    !staffRow ||
    staffRow.role !== 'Clinician' ||
    staffRow.status === 'Inactive' ||
    staffRow.verification_status !== 'Approved' ||
    (staffRow.user_id && staffRow.user_id !== ctx.user.id)
  ) {
    throw new ServiceError(
      403,
      'DOCTOR_PROFILE_NOT_LINKED',
      'No verified clinician staff profile is linked to this account in the active clinic.'
    );
  }

  return {
    staffId: staffRow.id,
    doctorName: staffRow.full_name,
  };
}

export function resolveDoctorScopeForStaffId(
  db: DatabaseSync,
  clinicId: string,
  staffId: string
): DoctorScope {
  const staffRow = db
    .prepare(
      `SELECT id, full_name
       FROM staff
       WHERE id = ? AND clinic_id = ?`
    )
    .get(staffId, clinicId) as { id: string; full_name: string } | undefined;

  if (!staffRow) {
    throw new ServiceError(
      404,
      'STAFF_NOT_FOUND',
      `Staff member ${staffId} was not found in this clinic.`
    );
  }

  return {
    staffId: staffRow.id,
    doctorName: staffRow.full_name,
  };
}

function normalizeClinicianName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

function buildUniqueLegacyEligibilitySql(
  scope: DoctorScope,
  clinicExpr: string
): { sql: string; params: string[] } {
  const normalizedName = normalizeClinicianName(scope.doctorName);
  const sql = `(
    NOT EXISTS (
      SELECT 1
      FROM staff su_other
      WHERE su_other.clinic_id = ${clinicExpr}
        AND su_other.id != ?
        AND su_other.user_id IS NOT NULL
        AND LOWER(TRIM(su_other.full_name)) = ?
    )
    AND (
      SELECT COUNT(*)
      FROM staff su_unlinked
      WHERE su_unlinked.clinic_id = ${clinicExpr}
        AND su_unlinked.user_id IS NULL
        AND LOWER(TRIM(su_unlinked.full_name)) = ?
    ) <= 1
  )`;
  return {
    sql,
    params: [scope.staffId, normalizedName, normalizedName],
  };
}

export function hasUniqueClinicianNameInClinic(
  db: DatabaseSync,
  clinicId: string,
  staffId: string,
  fullName: string
): boolean {
  const normalizedName = normalizeClinicianName(fullName);
  if (!normalizedName) return false;
  const duplicate = db
    .prepare(
      `SELECT 1 AS found
       FROM staff
       WHERE clinic_id = ?
         AND id != ?
         AND LOWER(TRIM(full_name)) = ?
       LIMIT 1`
    )
    .get(clinicId, staffId, normalizedName);
  return !duplicate;
}

export function hasUniqueLegacyClinicianIdentity(
  db: DatabaseSync,
  clinicId: string,
  scope: DoctorScope
): boolean {
  const normalizedName = normalizeClinicianName(scope.doctorName);
  if (!normalizedName) return false;

  const otherLinked = db
    .prepare(
      `SELECT 1 AS found
       FROM staff
       WHERE clinic_id = ?
         AND id != ?
         AND user_id IS NOT NULL
         AND LOWER(TRIM(full_name)) = ?
       LIMIT 1`
    )
    .get(clinicId, scope.staffId, normalizedName);
  if (otherLinked) return false;

  const unlinkedCount = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM staff
       WHERE clinic_id = ?
         AND user_id IS NULL
         AND LOWER(TRIM(full_name)) = ?`
    )
    .get(clinicId, normalizedName) as { count: number };

  return unlinkedCount.count <= 1;
}

export function buildDoctorAppointmentSql(
  scope: DoctorScope,
  alias = 'a'
): { sql: string; params: string[] } {
  const normalizedName = normalizeClinicianName(scope.doctorName);
  if (!normalizedName) {
    return {
      sql: `${alias}.staff_id = ?`,
      params: [scope.staffId],
    };
  }
  const uniqueLegacy = buildUniqueLegacyEligibilitySql(scope, `${alias}.clinic_id`);
  const sql = `(
    ${alias}.staff_id = ?
    OR (
      LOWER(TRIM(${alias}.clinician)) = ?
      AND ${uniqueLegacy.sql}
      AND (
        ${alias}.staff_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM staff sa
          WHERE sa.id = ${alias}.staff_id
            AND sa.clinic_id = ${alias}.clinic_id
            AND sa.user_id IS NULL
            AND sa.role = 'Clinician'
            AND sa.status != 'Inactive'
            AND sa.verification_status = 'Approved'
            AND LOWER(TRIM(sa.full_name)) = ?
        )
      )
    )
  )`;
  return {
    sql,
    params: [scope.staffId, normalizedName, ...uniqueLegacy.params, normalizedName],
  };
}

export function buildDoctorConsultationSql(
  scope: DoctorScope,
  alias = 'c'
): { sql: string; params: string[] } {
  const normalizedName = normalizeClinicianName(scope.doctorName);
  if (!normalizedName) {
    return {
      sql: `${alias}.staff_id = ?`,
      params: [scope.staffId],
    };
  }
  const uniqueLegacy = buildUniqueLegacyEligibilitySql(scope, `${alias}.clinic_id`);
  const sql = `(
    ${alias}.staff_id = ?
    OR (
      LOWER(TRIM(${alias}.doctor_name)) = ?
      AND ${uniqueLegacy.sql}
      AND (
        ${alias}.staff_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM staff sc
          WHERE sc.id = ${alias}.staff_id
            AND sc.clinic_id = ${alias}.clinic_id
            AND sc.user_id IS NULL
            AND sc.role = 'Clinician'
            AND sc.status != 'Inactive'
            AND sc.verification_status = 'Approved'
            AND LOWER(TRIM(sc.full_name)) = ?
        )
      )
    )
  )`;
  return {
    sql,
    params: [scope.staffId, normalizedName, ...uniqueLegacy.params, normalizedName],
  };
}

export function buildDoctorFollowupSql(
  scope: DoctorScope,
  alias = 'f'
): { sql: string; params: string[] } {
  const aptPred = buildDoctorAppointmentSql(scope, 'fa');
  const normalizedName = normalizeClinicianName(scope.doctorName);
  if (!normalizedName) {
    const sql = `(
      ${alias}.assigned_staff_id = ?
      OR (${alias}.appointment_id IS NOT NULL AND ${alias}.assigned_staff_id IS NULL AND TRIM(${alias}.assigned_to_name) = '' AND EXISTS (SELECT 1 FROM appointments fa WHERE fa.id = ${alias}.appointment_id AND fa.clinic_id = ${alias}.clinic_id AND ${aptPred.sql}))
    )`;
    return {
      sql,
      params: [scope.staffId, ...aptPred.params],
    };
  }
  const uniqueLegacy = buildUniqueLegacyEligibilitySql(scope, `${alias}.clinic_id`);
  const sql = `(
    ${alias}.assigned_staff_id = ?
    OR (
      LOWER(TRIM(${alias}.assigned_to_name)) = ?
      AND ${uniqueLegacy.sql}
      AND (
        ${alias}.assigned_staff_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM staff sf
          WHERE sf.id = ${alias}.assigned_staff_id
            AND sf.clinic_id = ${alias}.clinic_id
            AND sf.user_id IS NULL
            AND sf.role = 'Clinician'
            AND sf.status != 'Inactive'
            AND sf.verification_status = 'Approved'
            AND LOWER(TRIM(sf.full_name)) = ?
        )
      )
    )
    OR (${alias}.appointment_id IS NOT NULL AND ${alias}.assigned_staff_id IS NULL AND TRIM(${alias}.assigned_to_name) = '' AND EXISTS (SELECT 1 FROM appointments fa WHERE fa.id = ${alias}.appointment_id AND fa.clinic_id = ${alias}.clinic_id AND ${aptPred.sql}))
  )`;
  return {
    sql,
    params: [scope.staffId, normalizedName, ...uniqueLegacy.params, normalizedName, ...aptPred.params],
  };
}

export function buildDoctorPatientAssignmentSql(
  scope: DoctorScope,
  patientAlias = 'p'
): { sql: string; params: string[] } {
  const aptPred = buildDoctorAppointmentSql(scope, 'da');
  const conPred = buildDoctorConsultationSql(scope, 'dc');
  const fuPred = buildDoctorFollowupSql(scope, 'df');
  const sql = `(
    EXISTS (SELECT 1 FROM appointments da WHERE da.clinic_id = ${patientAlias}.clinic_id AND da.patient_id = ${patientAlias}.id AND ${aptPred.sql})
    OR EXISTS (SELECT 1 FROM consultations dc WHERE dc.clinic_id = ${patientAlias}.clinic_id AND dc.patient_id = ${patientAlias}.id AND ${conPred.sql})
    OR EXISTS (SELECT 1 FROM followups df WHERE df.clinic_id = ${patientAlias}.clinic_id AND df.patient_id = ${patientAlias}.id AND ${fuPred.sql})
  )`;
  return {
    sql,
    params: [...aptPred.params, ...conPred.params, ...fuPred.params],
  };
}

export function isStaffAliasForDoctorScope(
  db: DatabaseSync,
  clinicId: string,
  targetStaffId: string,
  scope: DoctorScope
): boolean {
  if (targetStaffId === scope.staffId) return true;
  const normalizedName = normalizeClinicianName(scope.doctorName);
  if (!normalizedName) return false;
  if (!hasUniqueLegacyClinicianIdentity(db, clinicId, scope)) {
    return false;
  }

  const row = db
    .prepare(
      `SELECT id, user_id, full_name, role, status, verification_status
       FROM staff
       WHERE id = ? AND clinic_id = ?`
    )
    .get(targetStaffId, clinicId) as
    | {
        id: string;
        user_id: string | null;
        full_name: string;
        role: string;
        status: string;
        verification_status: string;
      }
    | undefined;
  if (!row) return false;
  return (
    row.user_id === null &&
    row.role === 'Clinician' &&
    row.status !== 'Inactive' &&
    row.verification_status === 'Approved' &&
    normalizeClinicianName(row.full_name) === normalizedName
  );
}

export function isAppointmentOwnedByDoctor(
  db: DatabaseSync,
  clinicId: string,
  appointment: Pick<Appointment, 'staffId' | 'clinician'>,
  scope: DoctorScope
): boolean {
  if (appointment.staffId === scope.staffId) {
    return true;
  }
  const normalizedName = normalizeClinicianName(scope.doctorName);
  if (!normalizedName || normalizeClinicianName(appointment.clinician) !== normalizedName) {
    return false;
  }
  if (!appointment.staffId) {
    return hasUniqueLegacyClinicianIdentity(db, clinicId, scope);
  }
  return isStaffAliasForDoctorScope(db, clinicId, appointment.staffId, scope);
}

export function isFollowupOwnedByDoctor(
  db: DatabaseSync,
  clinicId: string,
  followup: Pick<FollowUpTask, 'assignedStaffId' | 'assignedToName' | 'appointmentId'>,
  scope: DoctorScope
): boolean {
  if (followup.assignedStaffId === scope.staffId) {
    return true;
  }
  const normalizedName = normalizeClinicianName(scope.doctorName);
  const assignedName = normalizeClinicianName(followup.assignedToName);
  if (normalizedName && assignedName === normalizedName) {
    if (!followup.assignedStaffId) {
      return hasUniqueLegacyClinicianIdentity(db, clinicId, scope);
    }
    return isStaffAliasForDoctorScope(db, clinicId, followup.assignedStaffId, scope);
  }
  if (!followup.assignedStaffId && !assignedName && followup.appointmentId) {
    const aptRow = db
      .prepare('SELECT staff_id, clinician FROM appointments WHERE id = ? AND clinic_id = ?')
      .get(followup.appointmentId, clinicId) as
      | { staff_id: string | null; clinician: string }
      | undefined;
    if (!aptRow) return false;
    return isAppointmentOwnedByDoctor(
      db,
      clinicId,
      { staffId: aptRow.staff_id, clinician: aptRow.clinician },
      scope
    );
  }
  return false;
}

export function isPatientAssignedToDoctor(
  db: DatabaseSync,
  clinicId: string,
  patientId: string,
  scope: DoctorScope
): boolean {
  const { sql, params } = buildDoctorPatientAssignmentSql(scope, 'p');
  const row = db
    .prepare(
      `SELECT 1 AS assigned
       FROM patients p
       WHERE p.id = ? AND p.clinic_id = ? AND ${sql}
       LIMIT 1`
    )
    .get(patientId, clinicId, ...params) as { assigned: number } | undefined;
  return Boolean(row);
}

export function hasAnyClinicianAssignmentForPatient(
  db: DatabaseSync,
  clinicId: string,
  patientId: string
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS has_assignment
       WHERE EXISTS (SELECT 1 FROM appointments a WHERE a.clinic_id = ? AND a.patient_id = ?)
          OR EXISTS (SELECT 1 FROM consultations c WHERE c.clinic_id = ? AND c.patient_id = ?)
          OR EXISTS (
            SELECT 1 FROM followups f
            LEFT JOIN staff s ON s.id = f.assigned_staff_id AND s.clinic_id = f.clinic_id
            WHERE f.clinic_id = ? AND f.patient_id = ?
              AND (s.role = 'Clinician' OR LOWER(f.assigned_to_name) LIKE 'dr.%')
          )
       LIMIT 1`
    )
    .get(clinicId, patientId, clinicId, patientId, clinicId, patientId) as
    | { has_assignment: number }
    | undefined;
  return Boolean(row);
}

export function assertDoctorCanAccessPatient(
  db: DatabaseSync,
  clinicId: string,
  patientId: string,
  scope: DoctorScope
): void {
  const exists = db
    .prepare('SELECT 1 AS found FROM patients WHERE id = ? AND clinic_id = ?')
    .get(patientId, clinicId);
  if (!exists) {
    throw new ServiceError(
      404,
      'PATIENT_NOT_FOUND',
      `Patient ${patientId} was not found in this clinic.`
    );
  }
  if (!isPatientAssignedToDoctor(db, clinicId, patientId, scope)) {
    throw new ServiceError(
      403,
      'FORBIDDEN',
      'You are only authorized to access patient records assigned to your clinical caseload.'
    );
  }
}

export function assertDoctorOwnsAppointment(
  db: DatabaseSync,
  clinicId: string,
  appointment: Appointment,
  scope: DoctorScope
): void {
  if (!isAppointmentOwnedByDoctor(db, clinicId, appointment, scope)) {
    throw new ServiceError(
      403,
      'FORBIDDEN',
      'You are only authorized to access or modify appointments assigned to you.'
    );
  }
}

export function assertDoctorOwnsFollowup(
  db: DatabaseSync,
  clinicId: string,
  followup: FollowUpTask,
  scope: DoctorScope
): void {
  if (!isFollowupOwnedByDoctor(db, clinicId, followup, scope)) {
    throw new ServiceError(
      403,
      'FORBIDDEN',
      'You are only authorized to access or modify follow-up tasks assigned to your caseload.'
    );
  }
}

export function assertDoctorTargetsSelf(
  db: DatabaseSync,
  clinicId: string,
  scope: DoctorScope,
  targetStaffId?: string | null,
  targetClinician?: string | null
): void {
  const trimmedStaffId = typeof targetStaffId === 'string' ? targetStaffId.trim() : '';
  if (trimmedStaffId && !isStaffAliasForDoctorScope(db, clinicId, trimmedStaffId, scope)) {
    throw new ServiceError(
      403,
      'FORBIDDEN',
      'Doctors cannot target or query another clinician’s clinical schedule or records.'
    );
  }
  const trimmedClinician = typeof targetClinician === 'string' ? targetClinician.trim() : '';
  if (
    trimmedClinician &&
    trimmedClinician !== 'All' &&
    trimmedClinician.toLowerCase() !== scope.doctorName.trim().toLowerCase()
  ) {
    throw new ServiceError(
      403,
      'FORBIDDEN',
      'Doctors cannot target or query another clinician’s clinical schedule or records.'
    );
  }
}
