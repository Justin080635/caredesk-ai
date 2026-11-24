import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  type AuthenticatedRequest,
  isAdminPasscodeConfigured,
  issueSessionToken,
  requireAdministrator,
  verifyAdminPasscode,
} from '../auth/session';
import {
  checkAppointmentAvailability,
  createAppointment,
  getAppointmentById,
  getMissedAppointments,
  getTodaysAppointments,
  getUnconfirmedAppointments,
  listAppointments,
  updateAppointment,
} from '../services/appointmentService';
import { listAuditLogs } from '../services/auditService';
import {
  createFollowup,
  getPendingFollowups,
  listFollowups,
  updateFollowupStatus,
} from '../services/followupService';
import {
  getPatientById,
  listPatients,
  registerPatient,
  ServiceError,
  updatePatient,
} from '../services/patientService';
import { getDailyOperationalReport, getOverviewReport } from '../services/reportService';
import { buildOpenApiSpec } from './openapi';

function handleRouteError(res: import('express').Response, err: unknown) {
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

export function createClinicApiRouter(db: DatabaseSync): Router {
  const router = Router();

  // API Reference & Health
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'caredesk-api', timestamp: new Date().toISOString() });
  });

  router.get('/docs', (_req, res) => {
    res.json(buildOpenApiSpec());
  });

  // Session & Access Control
  router.get('/auth/config', (_req, res) => {
    res.json({
      data: {
        passcodeRequired: isAdminPasscodeConfigured(),
      },
    });
  });

  router.post('/auth/session', (req, res) => {
    const requestedRole = req.body?.role === 'viewer' ? 'viewer' : 'administrator';
    const actor = typeof req.body?.actor === 'string' ? req.body.actor.trim() : '';
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';

    if (requestedRole === 'administrator' && isAdminPasscodeConfigured() && !verifyAdminPasscode(passcode)) {
      res.status(401).json({
        error: {
          code: 'INVALID_PASSCODE',
          message: 'Administrator passcode is incorrect.',
        },
      });
      return;
    }

    const { token, claims } = issueSessionToken(
      requestedRole,
      actor || (requestedRole === 'administrator' ? 'Clinic Administrator' : 'Operations Viewer')
    );

    res.status(201).json({
      data: {
        token,
        role: claims.role,
        actor: claims.actor,
        expiresAt: new Date(claims.exp).toISOString(),
      },
    });
  });

  // Patients
  router.get('/patients', (req, res) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const patients = listPatients(db, { search, status });
      res.json({ data: patients, meta: { count: patients.length } });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/patients/:id', (req, res) => {
    try {
      const patient = getPatientById(db, req.params.id);
      const appointments = listAppointments(db, { patientId: patient.id });
      const followups = listFollowups(db, { patientId: patient.id });
      res.json({
        data: {
          ...patient,
          appointments,
          followups,
        },
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/patients', requireAdministrator, (req: AuthenticatedRequest, res) => {
    try {
      const created = registerPatient(db, req.body, req.sessionClaims?.actor);
      res.status(201).json({ data: created });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch('/patients/:id', requireAdministrator, (req: AuthenticatedRequest, res) => {
    try {
      const updated = updatePatient(db, String(req.params.id), req.body, req.sessionClaims?.actor);
      res.json({ data: updated });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // Appointments (specific routes before :id)
  router.get('/appointments', (req, res) => {
    try {
      const appointments = listAppointments(db, {
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        department: typeof req.query.department === 'string' ? req.query.department : undefined,
        patientId: typeof req.query.patientId === 'string' ? req.query.patientId : undefined,
        clinician: typeof req.query.clinician === 'string' ? req.query.clinician : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
      });
      res.json({ data: appointments, meta: { count: appointments.length } });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/appointments/today', (_req, res) => {
    try {
      const appointments = getTodaysAppointments(db);
      res.json({ data: appointments, meta: { count: appointments.length } });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/appointments/missed', (req, res) => {
    try {
      const days = typeof req.query.days === 'string' ? Number(req.query.days) : 7;
      const appointments = getMissedAppointments(db, { days });
      res.json({ data: appointments, meta: { count: appointments.length, lookbackDays: days || 7 } });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/appointments/unconfirmed', (_req, res) => {
    try {
      const appointments = getUnconfirmedAppointments(db);
      res.json({ data: appointments, meta: { count: appointments.length } });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/appointments/availability', (req, res) => {
    try {
      const slots = checkAppointmentAvailability(db, {
        startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
        daysCount: typeof req.query.days === 'string' ? Number(req.query.days) : 5,
        department: typeof req.query.department === 'string' ? req.query.department : undefined,
        clinician: typeof req.query.clinician === 'string' ? req.query.clinician : undefined,
        patientId: typeof req.query.patientId === 'string' ? req.query.patientId : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : 12,
      });
      res.json({ data: slots, meta: { count: slots.length } });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/appointments/:id', (req, res) => {
    try {
      const appointment = getAppointmentById(db, req.params.id);
      res.json({ data: appointment });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/appointments', requireAdministrator, (req: AuthenticatedRequest, res) => {
    try {
      const created = createAppointment(db, req.body, req.sessionClaims?.actor);
      res.status(201).json({ data: created });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch('/appointments/:id', requireAdministrator, (req: AuthenticatedRequest, res) => {
    try {
      const updated = updateAppointment(db, String(req.params.id), req.body, req.sessionClaims?.actor);
      res.json({ data: updated });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // Follow-ups
  router.get('/followups', (req, res) => {
    try {
      const followups = listFollowups(db, {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        priority: typeof req.query.priority === 'string' ? req.query.priority : undefined,
        patientId: typeof req.query.patientId === 'string' ? req.query.patientId : undefined,
      });
      res.json({ data: followups, meta: { count: followups.length } });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/followups/pending', (_req, res) => {
    try {
      const followups = getPendingFollowups(db);
      res.json({ data: followups, meta: { count: followups.length } });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/followups', requireAdministrator, (req: AuthenticatedRequest, res) => {
    try {
      const created = createFollowup(db, req.body, req.sessionClaims?.actor);
      res.status(201).json({ data: created });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch('/followups/:id', requireAdministrator, (req: AuthenticatedRequest, res) => {
    try {
      const updated = updateFollowupStatus(db, String(req.params.id), req.body, req.sessionClaims?.actor);
      res.json({ data: updated });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // Reports
  router.get('/reports/daily', (req, res) => {
    try {
      const date = typeof req.query.date === 'string' ? req.query.date : undefined;
      const report = getDailyOperationalReport(db, date);
      res.json({ data: report });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/reports/overview', (_req, res) => {
    try {
      const report = getOverviewReport(db);
      res.json({ data: report });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // Audit Log (Protected)
  router.get('/audit-logs', requireAdministrator, (req, res) => {
    try {
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 25;
      const logs = listAuditLogs(db, limit);
      res.json({ data: logs, meta: { count: logs.length } });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  return router;
}
