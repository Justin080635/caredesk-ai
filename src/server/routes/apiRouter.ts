import { Router, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AppointmentType } from '../../shared/types';
import {
  type AuthenticatedRequest,
  createAuthGuards,
  getFirebasePublicConfig,
  type TokenVerifier,
} from '../auth/session';
import { seedClinicStarterData } from '../db/seed';
import {
  inviteClinicMember,
  listClinicsDirectory,
  listClinicTeam,
  onboardClinicWorkspace,
  syncAuthenticatedUser,
  updateClinicMembership,
  updateClinicWorkspace,
  updatePersonalProfile,
} from '../services/accountService';
import {
  checkAppointmentAvailability,
  createAppointment,
  deleteAppointment,
  getAppointmentById,
  getMissedAppointments,
  getTodaysAppointments,
  getUnconfirmedAppointments,
  listAppointments,
  listAppointmentsPaginated,
  updateAppointment,
} from '../services/appointmentService';
import {
  createAiConversation,
  deleteAiConversation,
  getAiConversationDetail,
  listAiConversations,
} from '../services/assistantStoreService';
import {
  listAuditLogs,
  listAuditLogsForPatient,
  recordAuditEvent,
} from '../services/auditService';
import {
  addDoctorUnavailability,
  approveDoctorApplication,
  createConsultation,
  deleteDoctorUnavailability,
  getClinicDoctorAvailabilitySummary,
  getDoctorActivity,
  getDoctorDashboard,
  getDoctorPatients,
  getDoctorSchedule,
  listConsultationsByDoctor,
  listConsultationsForPatient,
  listDoctorApplications,
  listDoctorUnavailability,
  rejectDoctorApplication,
  submitDoctorApplication,
  updateDoctorDutyStatus,
  updateDoctorOwnProfile,
  upsertDoctorSchedule,
} from '../services/doctorService';
import {
  createFollowup,
  getPendingFollowups,
  listFollowups,
  updateFollowupStatus,
} from '../services/followupService';
import {
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationService';
import {
  approvePatientLinkRequest,
  bookPatientAppointment,
  claimPatientRecord,
  generatePatientClaimCode,
  getPatientHomeData,
  getPatientOwnHealthData,
  listPatientLinkRequests,
  listPatientOwnAppointments,
  rejectPatientLinkRequest,
  requestPatientCancellation,
  requestPatientReschedule,
  submitPatientLinkRequest,
  updatePatientOwnProfile,
} from '../services/patientPortalService';
import {
  getPatientById,
  listPatients,
  registerPatient,
  ServiceError,
  updatePatient,
} from '../services/patientService';
import {
  getDailyOperationalReport,
  getExplainableOperationalReport,
  getOverviewReport,
} from '../services/reportService';
import { getStaffDetail, listStaff, updateStaffMember } from '../services/staffService';
import { buildOpenApiSpec } from './openapi';

function handleRouteError(res: Response, err: unknown) {
  if (err instanceof ServiceError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
    },
  });
}

export function createClinicApiRouter(
  db: DatabaseSync,
  options?: { verifyToken?: TokenVerifier }
): Router {
  const router = Router();
  const {
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission,
    requireRole,
  } = createAuthGuards(db, options?.verifyToken);

  function assertDoctorScheduleAccess(req: AuthenticatedRequest, targetStaffId: string) {
    const ctx = req.clinicContext!;
    if (ctx.permissions.canManageStaff) return;
    if (ctx.permissions.canManageOwnSchedule && ctx.linkedStaffId === targetStaffId) return;
    throw new ServiceError(
      403,
      'FORBIDDEN',
      'You are only authorized to modify your own clinician schedule.'
    );
  }

  function resolveDoctorStaffId(req: AuthenticatedRequest): string {
    const ctx = req.clinicContext!;
    const explicit =
      typeof req.query.staffId === 'string'
        ? req.query.staffId.trim()
        : typeof req.body?.staffId === 'string'
          ? req.body.staffId.trim()
          : '';
    if (ctx.membership.role === 'Clinic Administrator' && explicit) {
      return explicit;
    }
    if (ctx.linkedStaffId) return ctx.linkedStaffId;
    if (explicit && ctx.permissions.canManageStaff) return explicit;
    throw new ServiceError(
      403,
      'DOCTOR_PROFILE_NOT_LINKED',
      'No verified clinician staff profile is linked to this account in the active clinic.'
    );
  }

  function resolveVerifiedPatientId(req: AuthenticatedRequest): string {
    const ctx = req.clinicContext!;
    if (!ctx.linkedPatientId) {
      throw new ServiceError(
        403,
        'PATIENT_LINK_REQUIRED',
        'Your portal account is not yet linked to a verified patient record in this clinic.'
      );
    }
    return ctx.linkedPatientId;
  }

  // Public Health, OpenAPI & Firebase Configuration Info
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'caredesk-api', timestamp: new Date().toISOString() });
  });

  router.get('/docs', (_req, res) => {
    res.json(buildOpenApiSpec());
  });

  router.get('/auth/config', (_req, res) => {
    const firebase = getFirebasePublicConfig();
    res.json({
      data: {
        firebaseConfigured: firebase.configured,
        projectId: firebase.projectId,
        providers: {
          google: firebase.configured,
          emailPassword: firebase.configured,
        },
      },
    });
  });

  // Public/Auth Directory for Doctor & Patient Onboarding Clinic Selection
  router.get('/clinics/directory', requireAuthenticatedUser, (_req, res) => {
    try {
      const directory = listClinicsDirectory(db);
      res.json({ data: directory });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // Authenticated User Session Sync & Onboarding Routes
  router.post('/auth/sync', requireAuthenticatedUser, (req: AuthenticatedRequest, res) => {
    try {
      const identity = req.authIdentity!;
      const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName : identity.name;
      const phoneNumber =
        typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber : undefined;
      const requestedClinicId =
        req.header('x-clinic-id')?.trim() ||
        (typeof req.body?.requestedClinicId === 'string'
          ? req.body.requestedClinicId.trim()
          : undefined);

      const sessionState = syncAuthenticatedUser(db, {
        firebaseUid: identity.uid,
        email: identity.email,
        fullName,
        phoneNumber,
        avatarUrl: identity.picture,
        authProvider: identity.provider,
        requestedClinicId,
      });

      res.json({ data: sessionState });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/clinics/onboard', requireAuthenticatedUser, (req: AuthenticatedRequest, res) => {
    try {
      const sessionState = onboardClinicWorkspace(db, req.authUser!, {
        clinicName: req.body?.clinicName,
        clinicType: req.body?.clinicType,
        contactPhone: req.body?.contactPhone,
        contactEmail: req.body?.contactEmail,
        location: req.body?.location,
        organizationNotes: req.body?.organizationNotes,
        seedSampleData: Boolean(req.body?.seedSampleData),
      });

      res.status(201).json({ data: sessionState });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // Doctor Self-Registration Application (Pending Verification until Admin Approval)
  router.post(
    '/doctor-applications',
    requireAuthenticatedUser,
    (req: AuthenticatedRequest, res) => {
      try {
        const created = submitDoctorApplication(db, req.authUser!, {
          clinicId: req.body?.clinicId,
          fullName: req.body?.fullName,
          phoneNumber: req.body?.phoneNumber,
          specialty: req.body?.specialty,
          department: req.body?.department,
          qualifications: req.body?.qualifications,
          licenseNumber: req.body?.licenseNumber,
          bio: req.body?.bio,
        });
        res.status(201).json({ data: created });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Patient Portal Verified Claim Code Redemption & Link Requests (Pre-Membership Allowed)
  router.post(
    '/patient-portal/claim',
    requireAuthenticatedUser,
    (req: AuthenticatedRequest, res) => {
      try {
        const sessionState = claimPatientRecord(db, req.authUser!, {
          clinicId: req.body?.clinicId,
          claimCode: req.body?.claimCode,
          dateOfBirth: req.body?.dateOfBirth,
        });
        res.status(200).json({ data: sessionState });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/patient-portal/link-request',
    requireAuthenticatedUser,
    (req: AuthenticatedRequest, res) => {
      try {
        const created = submitPatientLinkRequest(db, req.authUser!, {
          clinicId: req.body?.clinicId,
          fullName: req.body?.fullName,
          phoneNumber: req.body?.phoneNumber,
          dateOfBirth: req.body?.dateOfBirth,
          notes: req.body?.notes,
        });
        res.status(201).json({ data: created });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get('/account/profile', requireAuthenticatedUser, (req: AuthenticatedRequest, res) => {
    try {
      const identity = req.authIdentity!;
      const requestedClinicId = req.header('x-clinic-id')?.trim() || undefined;
      const sessionState = syncAuthenticatedUser(db, {
        firebaseUid: identity.uid,
        email: identity.email,
        requestedClinicId,
      });
      res.json({ data: sessionState });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch('/account/profile', requireAuthenticatedUser, (req: AuthenticatedRequest, res) => {
    try {
      const requestedClinicId = req.header('x-clinic-id')?.trim() || undefined;
      const updatedUser = updatePersonalProfile(
        db,
        req.authUser!,
        {
          fullName: req.body?.fullName,
          phoneNumber: req.body?.phoneNumber,
          avatarUrl: req.body?.avatarUrl,
        },
        requestedClinicId
      );
      res.json({ data: updatedUser });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // Clinic-Scoped Security Audit for Logout
  router.post(
    '/auth/logout-audit',
    requireAuthenticatedUser,
    requireClinicAccess,
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        recordAuditEvent(db, {
          clinicId: ctx.clinic.id,
          actor: ctx.actorLabel,
          action: 'USER_LOGOUT',
          resourceType: 'session',
          resourceId: ctx.user.id,
          summary: `${ctx.user.email} signed out of ${ctx.clinic.name}.`,
        });
        res.json({ data: { recorded: true } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Notifications (All Clinic Roles Scoped to Active User + Clinic)
  router.get(
    '/notifications',
    requireAuthenticatedUser,
    requireClinicAccess,
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 40;
        const items = listNotificationsForUser(db, ctx.clinic.id, ctx.user.id, limit);
        res.json({
          data: items,
          meta: {
            count: items.length,
            unreadCount: items.filter((n) => !n.isRead).length,
          },
        });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/notifications/:id/read',
    requireAuthenticatedUser,
    requireClinicAccess,
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const ok = markNotificationRead(db, ctx.clinic.id, ctx.user.id, String(req.params.id));
        res.json({ data: { marked: ok } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/notifications/read-all',
    requireAuthenticatedUser,
    requireClinicAccess,
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const updated = markAllNotificationsRead(db, ctx.clinic.id, ctx.user.id);
        res.json({ data: { updated } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Persistent Per-User AI Conversations
  router.get(
    '/assistant/conversations',
    requireAuthenticatedUser,
    requireClinicAccess,
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const list = listAiConversations(db, ctx.clinic.id, ctx.user.id);
        res.json({ data: list });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/assistant/conversations',
    requireAuthenticatedUser,
    requireClinicAccess,
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const created = createAiConversation(
          db,
          ctx.clinic.id,
          ctx.user.id,
          ctx.membership.role,
          typeof req.body?.title === 'string' ? req.body.title : 'New Conversation'
        );
        res.status(201).json({ data: created });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/assistant/conversations/:id',
    requireAuthenticatedUser,
    requireClinicAccess,
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const detail = getAiConversationDetail(
          db,
          ctx.clinic.id,
          ctx.user.id,
          String(req.params.id)
        );
        res.json({ data: detail });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.delete(
    '/assistant/conversations/:id',
    requireAuthenticatedUser,
    requireClinicAccess,
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const result = deleteAiConversation(
          db,
          ctx.clinic.id,
          ctx.user.id,
          String(req.params.id)
        );
        res.json({ data: result });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Clinic Workspace, Team RBAC & Verification Queues (Admin Governance)
  router.patch(
    '/clinic',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageClinicSettings'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const updated = updateClinicWorkspace(
          db,
          ctx.clinic.id,
          {
            name: req.body?.name,
            clinicType: req.body?.clinicType,
            contactPhone: req.body?.contactPhone,
            contactEmail: req.body?.contactEmail,
            location: req.body?.location,
            organizationNotes: req.body?.organizationNotes,
          },
          ctx.actorLabel
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/clinic/seed-sample',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageClinicSettings'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const patientCount = (
          db
            .prepare('SELECT COUNT(*) AS count FROM patients WHERE clinic_id = ?')
            .get(ctx.clinic.id) as { count: number }
        ).count;

        if (patientCount > 0) {
          throw new ServiceError(
            409,
            'CLINIC_ALREADY_HAS_DATA',
            'Sample dataset can only be loaded into a clinic workspace that has no patient records yet.'
          );
        }

        seedClinicStarterData(db, ctx.clinic.id, {
          includePatientsAndAppointments: true,
          useFixedDemoIds: false,
        });

        recordAuditEvent(db, {
          clinicId: ctx.clinic.id,
          actor: ctx.actorLabel,
          action: 'LOAD_SAMPLE_CLINIC_DATA',
          resourceType: 'clinic',
          resourceId: ctx.clinic.id,
          summary: `Loaded isolated synthetic starter dataset into ${ctx.clinic.name}.`,
        });

        res.status(201).json({ data: { seeded: true } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/clinic/members',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const team = listClinicTeam(db, ctx.clinic.id);
        res.json({
          data: {
            members: team.members,
            invitations: ctx.permissions.canManageTeamRoles ? team.invitations : [],
          },
        });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/clinic/members/invite',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageTeamRoles'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const result = inviteClinicMember(db, ctx.clinic.id, ctx.user, {
          email: req.body?.email,
          fullName: req.body?.fullName,
          role: req.body?.role,
        });
        res.status(201).json({ data: result });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.patch(
    '/clinic/members/:membershipId',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageTeamRoles'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const updated = updateClinicMembership(
          db,
          ctx.clinic.id,
          String(req.params.membershipId),
          ctx.user,
          {
            role: req.body?.role,
            status: req.body?.status,
          }
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Admin Verification Queues: Doctor Applications & Patient Link Requests
  router.get(
    '/doctor-applications',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageTeamRoles'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const list = listDoctorApplications(db, ctx.clinic.id, status);
        res.json({ data: list });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/doctor-applications/:id/approve',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageTeamRoles'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const result = approveDoctorApplication(
          db,
          ctx.clinic.id,
          String(req.params.id),
          ctx.user,
          typeof req.body?.reviewNotes === 'string' ? req.body.reviewNotes : ''
        );
        res.json({ data: result });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/doctor-applications/:id/reject',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageTeamRoles'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const updated = rejectDoctorApplication(
          db,
          ctx.clinic.id,
          String(req.params.id),
          ctx.user,
          typeof req.body?.reviewNotes === 'string' ? req.body.reviewNotes : ''
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/patient-link-requests',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManagePatients'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const list = listPatientLinkRequests(db, ctx.clinic.id, status);
        res.json({ data: list });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/patient-link-requests/:id/approve',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManagePatients'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const result = approvePatientLinkRequest(
          db,
          ctx.clinic.id,
          String(req.params.id),
          ctx.user,
          { existingPatientId: req.body?.existingPatientId }
        );
        res.json({ data: result });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/patient-link-requests/:id/reject',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManagePatients'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const updated = rejectPatientLinkRequest(
          db,
          ctx.clinic.id,
          String(req.params.id),
          ctx.user,
          typeof req.body?.reason === 'string' ? req.body.reason : undefined
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Clinic-Isolated Patients (Staff/Admin Only; Patients get 403)
  router.get(
    '/patients',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const patients = listPatients(db, { clinicId, search, status });
        res.json({ data: patients, meta: { count: patients.length } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/patients/:id',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const clinicId = ctx.clinic.id;
        const patient = getPatientById(db, String(req.params.id), clinicId);
        const appointments = listAppointments(db, { clinicId, patientId: patient.id });
        const followups = listFollowups(db, { clinicId, patientId: patient.id });
        const consultations = listConsultationsForPatient(db, clinicId, patient.id);
        const activity = ctx.permissions.canViewAuditHistory
          ? listAuditLogsForPatient(
              db,
              clinicId,
              patient.id,
              appointments.map((a) => a.id),
              followups.map((f) => f.id),
              50
            )
          : [];

        res.json({
          data: {
            ...patient,
            appointments,
            followups,
            consultations,
            activity,
            permissions: {
              canEdit: ctx.permissions.canManagePatients,
              canViewAuditHistory: ctx.permissions.canViewAuditHistory,
              canAuthorConsultations: ctx.permissions.canAuthorConsultations,
              canManagePortalLink: ctx.permissions.canManagePatients,
            },
          },
        });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/patients',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManagePatients'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const created = registerPatient(db, req.body, ctx.actorLabel, ctx.clinic.id);
        res.status(201).json({ data: created });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.patch(
    '/patients/:id',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManagePatients'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const updated = updatePatient(
          db,
          String(req.params.id),
          req.body,
          ctx.actorLabel,
          ctx.clinic.id
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/patients/:id/portal-invite',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManagePatients'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const result = generatePatientClaimCode(
          db,
          ctx.clinic.id,
          String(req.params.id),
          ctx.actorLabel
        );
        res.status(201).json({ data: result });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Clinic-Isolated Appointments (specific routes before :id)
  router.get(
    '/appointments',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const filters = {
          clinicId,
          date: typeof req.query.date === 'string' ? req.query.date : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          department: typeof req.query.department === 'string' ? req.query.department : undefined,
          patientId: typeof req.query.patientId === 'string' ? req.query.patientId : undefined,
          clinician: typeof req.query.clinician === 'string' ? req.query.clinician : undefined,
          staffId: typeof req.query.staffId === 'string' ? req.query.staffId : undefined,
          requestStatus:
            typeof req.query.requestStatus === 'string' ? req.query.requestStatus : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
        };
        const hasPagination =
          req.query.page !== undefined || req.query.pageSize !== undefined;
        if (hasPagination) {
          const result = listAppointmentsPaginated(db, {
            ...filters,
            page: typeof req.query.page === 'string' ? Number(req.query.page) : 1,
            pageSize: typeof req.query.pageSize === 'string' ? Number(req.query.pageSize) : 10,
            sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
            sortDir: typeof req.query.sortDir === 'string' ? req.query.sortDir : undefined,
          });
          res.json(result);
          return;
        }
        const appointments = listAppointments(db, filters);
        res.json({ data: appointments, meta: { count: appointments.length } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/appointments/today',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const appointments = getTodaysAppointments(db, undefined, clinicId);
        res.json({ data: appointments, meta: { count: appointments.length } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/appointments/missed',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const days = typeof req.query.days === 'string' ? Number(req.query.days) : 7;
        const appointments = getMissedAppointments(db, { clinicId, days });
        res.json({
          data: appointments,
          meta: { count: appointments.length, lookbackDays: days || 7 },
        });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/appointments/unconfirmed',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const appointments = getUnconfirmedAppointments(db, undefined, clinicId);
        res.json({ data: appointments, meta: { count: appointments.length } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/appointments/availability',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const slots = checkAppointmentAvailability(db, {
          clinicId,
          startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
          daysCount: typeof req.query.days === 'string' ? Number(req.query.days) : 5,
          department: typeof req.query.department === 'string' ? req.query.department : undefined,
          specialty: typeof req.query.specialty === 'string' ? req.query.specialty : undefined,
          clinician: typeof req.query.clinician === 'string' ? req.query.clinician : undefined,
          staffId: typeof req.query.staffId === 'string' ? req.query.staffId : undefined,
          patientId: typeof req.query.patientId === 'string' ? req.query.patientId : undefined,
          appointmentType:
            typeof req.query.appointmentType === 'string'
              ? (req.query.appointmentType as AppointmentType)
              : undefined,
          timeOfDay:
            typeof req.query.timeOfDay === 'string'
              ? (req.query.timeOfDay as 'morning' | 'afternoon' | 'any')
              : undefined,
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : 12,
        });
        res.json({ data: slots, meta: { count: slots.length } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/appointments/:id',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const appointment = getAppointmentById(db, String(req.params.id), clinicId);
        res.json({ data: appointment });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/appointments',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageAppointments'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const created = createAppointment(db, req.body, ctx.actorLabel, ctx.clinic.id);
        res.status(201).json({ data: created });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.patch(
    '/appointments/:id',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageAppointments'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const updated = updateAppointment(
          db,
          String(req.params.id),
          req.body,
          ctx.actorLabel,
          ctx.clinic.id
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.delete(
    '/appointments/:id',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canDeleteAppointments'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const result = deleteAppointment(
          db,
          String(req.params.id),
          ctx.actorLabel,
          ctx.clinic.id
        );
        res.json({ data: result });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Doctor Availability, Schedules, Unavailability & Duty Status
  router.get(
    '/doctors/availability',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const list = getClinicDoctorAvailabilitySummary(db, clinicId, {
          date: typeof req.query.date === 'string' ? req.query.date : undefined,
          department: typeof req.query.department === 'string' ? req.query.department : undefined,
          specialty: typeof req.query.specialty === 'string' ? req.query.specialty : undefined,
          appointmentType:
            typeof req.query.appointmentType === 'string'
              ? (req.query.appointmentType as AppointmentType)
              : undefined,
          timeOfDay:
            typeof req.query.timeOfDay === 'string'
              ? (req.query.timeOfDay as 'morning' | 'afternoon' | 'any')
              : undefined,
        });
        res.json({ data: list });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/doctors/:staffId/schedule',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const schedule = getDoctorSchedule(db, clinicId, String(req.params.staffId));
        res.json({ data: schedule });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.put(
    '/doctors/:staffId/schedule',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageOwnSchedule'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const staffId = String(req.params.staffId);
        assertDoctorScheduleAccess(req, staffId);
        const updated = upsertDoctorSchedule(
          db,
          ctx.clinic.id,
          staffId,
          req.body?.days,
          ctx.actorLabel
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/doctors/:staffId/unavailability',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const list = listDoctorUnavailability(db, clinicId, String(req.params.staffId));
        res.json({ data: list });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/doctors/:staffId/unavailability',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageOwnSchedule'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const staffId = String(req.params.staffId);
        assertDoctorScheduleAccess(req, staffId);
        const created = addDoctorUnavailability(
          db,
          ctx.clinic.id,
          staffId,
          {
            startDate: req.body?.startDate,
            endDate: req.body?.endDate,
            startTime: req.body?.startTime,
            endTime: req.body?.endTime,
            kind: req.body?.kind,
            reason: req.body?.reason,
          },
          ctx.actorLabel
        );
        res.status(201).json({ data: created });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.delete(
    '/doctors/:staffId/unavailability/:unavailId',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageOwnSchedule'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const staffId = String(req.params.staffId);
        assertDoctorScheduleAccess(req, staffId);
        const result = deleteDoctorUnavailability(
          db,
          ctx.clinic.id,
          staffId,
          String(req.params.unavailId),
          ctx.actorLabel
        );
        res.json({ data: result });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.patch(
    '/doctors/:staffId/duty-status',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageOwnSchedule'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const staffId = String(req.params.staffId);
        assertDoctorScheduleAccess(req, staffId);
        const updated = updateDoctorDutyStatus(
          db,
          ctx.clinic.id,
          staffId,
          req.body?.attendanceStatus,
          ctx.actorLabel
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Doctor Portal Scoped Routes
  router.get(
    '/doctor/dashboard',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Doctor', 'Clinic Administrator'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const staffId = resolveDoctorStaffId(req);
        const data = getDoctorDashboard(db, ctx.clinic.id, staffId);
        res.json({ data });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/doctor/patients',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Doctor', 'Clinic Administrator'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const staffId = resolveDoctorStaffId(req);
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const patients = getDoctorPatients(db, ctx.clinic.id, staffId, search);
        res.json({ data: patients });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/doctor/activity',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Doctor', 'Clinic Administrator'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const staffId = resolveDoctorStaffId(req);
        const logs = getDoctorActivity(db, ctx.clinic.id, staffId);
        res.json({ data: logs });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.patch(
    '/doctor/profile',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Doctor', 'Clinic Administrator'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const staffId = resolveDoctorStaffId(req);
        const updated = updateDoctorOwnProfile(db, ctx.clinic.id, ctx.user, staffId, req.body ?? {});
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/doctor/consultations',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Doctor', 'Clinic Administrator'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const staffId = resolveDoctorStaffId(req);
        const list = listConsultationsByDoctor(db, ctx.clinic.id, staffId);
        res.json({ data: list });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/consultations',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Doctor'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const staffId = resolveDoctorStaffId(req);
        const created = createConsultation(
          db,
          ctx.clinic.id,
          staffId,
          req.body ?? {},
          ctx.actorLabel
        );
        res.status(201).json({ data: created });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Patient Portal Scoped Routes (Strictly Isolated to Verified Linked Patient)
  router.get(
    '/patient-portal/home',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Patient'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const patientId = resolveVerifiedPatientId(req);
        const data = getPatientHomeData(db, ctx.clinic.id, ctx.clinic, patientId, ctx.user.id);
        res.json({ data });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/patient-portal/appointments',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Patient'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const patientId = resolveVerifiedPatientId(req);
        const list = listPatientOwnAppointments(db, ctx.clinic.id, patientId);
        res.json({ data: list });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/patient-portal/availability',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Patient'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const patientId = resolveVerifiedPatientId(req);
        const date = typeof req.query.date === 'string' ? req.query.date : undefined;
        const department = typeof req.query.department === 'string' ? req.query.department : undefined;
        const specialty = typeof req.query.specialty === 'string' ? req.query.specialty : undefined;
        const appointmentType =
          typeof req.query.appointmentType === 'string'
            ? (req.query.appointmentType as AppointmentType)
            : undefined;

        const doctors = getClinicDoctorAvailabilitySummary(db, ctx.clinic.id, {
          date,
          department,
          specialty,
          appointmentType,
        });
        const slots = checkAppointmentAvailability(db, {
          clinicId: ctx.clinic.id,
          startDate: date,
          daysCount: typeof req.query.days === 'string' ? Number(req.query.days) : 7,
          department,
          specialty,
          staffId: typeof req.query.staffId === 'string' ? req.query.staffId : undefined,
          patientId,
          appointmentType,
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : 24,
        });
        res.json({ data: { doctors, slots } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/patient-portal/appointments',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Patient'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const patientId = resolveVerifiedPatientId(req);
        const created = bookPatientAppointment(
          db,
          ctx.clinic.id,
          patientId,
          req.body ?? {},
          ctx.actorLabel
        );
        res.status(201).json({ data: created });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/patient-portal/appointments/:id/reschedule-request',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Patient'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const patientId = resolveVerifiedPatientId(req);
        const updated = requestPatientReschedule(
          db,
          ctx.clinic.id,
          patientId,
          String(req.params.id),
          {
            requestedDate: req.body?.requestedDate,
            requestedTime: req.body?.requestedTime,
            notes: req.body?.notes,
          },
          ctx.actorLabel
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/patient-portal/appointments/:id/cancel-request',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Patient'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const patientId = resolveVerifiedPatientId(req);
        const updated = requestPatientCancellation(
          db,
          ctx.clinic.id,
          patientId,
          String(req.params.id),
          typeof req.body?.notes === 'string' ? req.body.notes : '',
          ctx.actorLabel
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/patient-portal/health',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Patient'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const patientId = resolveVerifiedPatientId(req);
        const data = getPatientOwnHealthData(db, ctx.clinic.id, patientId);
        res.json({ data });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.patch(
    '/patient-portal/profile',
    requireAuthenticatedUser,
    requireClinicAccess,
    requireRole('Patient'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const patientId = resolveVerifiedPatientId(req);
        const updated = updatePatientOwnProfile(
          db,
          ctx.clinic.id,
          patientId,
          ctx.user,
          req.body ?? {}
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Clinic-Isolated Staff Directory & Profiles
  router.get(
    '/staff',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const staff = listStaff(db, {
          clinicId,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          role: typeof req.query.role === 'string' ? req.query.role : undefined,
          department: typeof req.query.department === 'string' ? req.query.department : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
        });
        res.json({ data: staff, meta: { count: staff.length } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/staff/:id',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const detail = getStaffDetail(db, String(req.params.id), {
          clinicId: ctx.clinic.id,
          isAdministrator: ctx.permissions.canManageStaff,
          canViewAuditHistory: ctx.permissions.canViewAuditHistory,
        });
        res.json({ data: detail });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.patch(
    '/staff/:id',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageStaff'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const updated = updateStaffMember(
          db,
          String(req.params.id),
          req.body,
          ctx.actorLabel,
          ctx.clinic.id
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Clinic-Isolated Follow-ups
  router.get(
    '/followups',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const followups = listFollowups(db, {
          clinicId,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          priority: typeof req.query.priority === 'string' ? req.query.priority : undefined,
          patientId: typeof req.query.patientId === 'string' ? req.query.patientId : undefined,
          assignedStaffId:
            typeof req.query.assignedStaffId === 'string' ? req.query.assignedStaffId : undefined,
          followupType:
            typeof req.query.followupType === 'string' ? req.query.followupType : undefined,
        });
        res.json({ data: followups, meta: { count: followups.length } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/followups/pending',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const followups = getPendingFollowups(db, clinicId);
        res.json({ data: followups, meta: { count: followups.length } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/followups',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageFollowups'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const created = createFollowup(db, req.body, ctx.actorLabel, ctx.clinic.id);
        res.status(201).json({ data: created });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.patch(
    '/followups/:id',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canManageFollowups'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ctx = req.clinicContext!;
        const updated = updateFollowupStatus(
          db,
          String(req.params.id),
          req.body,
          ctx.actorLabel,
          ctx.clinic.id
        );
        res.json({ data: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Clinic-Isolated Reports
  router.get(
    '/reports/daily',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const date = typeof req.query.date === 'string' ? req.query.date : undefined;
        const report = getDailyOperationalReport(db, date, clinicId);
        res.json({ data: report });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/reports/overview',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const report = getOverviewReport(db, undefined, clinicId);
        res.json({ data: report });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/reports/explainable',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewRecords'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const report = getExplainableOperationalReport(db, clinicId, {
          periodStart:
            typeof req.query.periodStart === 'string' ? req.query.periodStart : undefined,
          periodEnd: typeof req.query.periodEnd === 'string' ? req.query.periodEnd : undefined,
          compareStart:
            typeof req.query.compareStart === 'string' ? req.query.compareStart : undefined,
          compareEnd: typeof req.query.compareEnd === 'string' ? req.query.compareEnd : undefined,
        });
        res.json({ data: report });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // Clinic-Isolated Audit Log (Protected by RBAC)
  router.get(
    '/audit-logs',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canViewAuditHistory'),
    (req: AuthenticatedRequest, res) => {
      try {
        const clinicId = req.clinicContext!.clinic.id;
        const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 25;
        const logs = listAuditLogs(db, clinicId, limit);
        res.json({ data: logs, meta: { count: logs.length } });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  return router;
}
