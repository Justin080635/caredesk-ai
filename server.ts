import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createServer as createViteServer } from 'vite';
import { CareDeskAgent, type CareDeskToolAdapter } from './src/agent/copilot';
import {
  type AuthenticatedClinicContext,
  type AuthenticatedRequest,
  createAuthGuards,
  type TokenVerifier,
} from './src/server/auth/session';
import { getDatabase } from './src/server/db/database';
import { seedDatabaseIfEmpty } from './src/server/db/seed';
import { createClinicApiRouter } from './src/server/routes/apiRouter';
import {
  checkAppointmentAvailability,
  getAppointmentById,
  getMissedAppointments,
  getUnconfirmedAppointments,
  listAppointments,
  updateAppointment,
} from './src/server/services/appointmentService';
import { appendAiMessage } from './src/server/services/assistantStoreService';
import {
  getClinicDoctorAvailabilitySummary,
  getDoctorDashboard,
} from './src/server/services/doctorService';
import {
  createFollowup,
  getPendingFollowups,
  listFollowups,
} from './src/server/services/followupService';
import { listNotificationsForUser } from './src/server/services/notificationService';
import {
  getPatientHomeData,
  getPatientOwnHealthData,
} from './src/server/services/patientPortalService';
import { getPatientById, ServiceError } from './src/server/services/patientService';
import { getDailyOperationalReport, getOverviewReport } from './src/server/services/reportService';
import type { AssistantResponse } from './src/shared/types';

function createRoleScopedAdapter(
  db: DatabaseSync,
  ctx: AuthenticatedClinicContext,
  actor: string
): CareDeskToolAdapter {
  const clinicId = ctx.clinic.id;
  const role = ctx.membership.role;

  // Strictly Patient-isolated adapter — never exposes clinic-wide reports, other patients, or staff tools.
  if (role === 'Patient') {
    const patientId = ctx.linkedPatientId;
    if (!patientId) {
      throw new ServiceError(
        403,
        'PATIENT_LINK_REQUIRED',
        'Verify and link your patient record before querying the Patient Assistant.'
      );
    }
    const denied = () => {
      throw new ServiceError(
        403,
        'FORBIDDEN',
        'Patient Portal accounts cannot access clinic-wide operations or other patient records.'
      );
    };

    return {
      role,
      linkedPatientId: patientId,
      async getDailyReport() {
        return denied();
      },
      async getOverviewReport() {
        return denied();
      },
      async getUnconfirmedAppointments() {
        return denied();
      },
      async getMissedAppointments() {
        return denied();
      },
      async getPendingFollowups() {
        return denied();
      },
      async checkAvailability(params) {
        return checkAppointmentAvailability(db, { clinicId, ...params, patientId });
      },
      async getPatientWithHistory(requestedPatientId: string) {
        if (requestedPatientId !== patientId) return denied();
        const patient = getPatientById(db, patientId, clinicId);
        const appointments = listAppointments(db, { clinicId, patientId });
        const followups = listFollowups(db, { clinicId, patientId });
        return { patient, appointments, followups };
      },
      async getAppointmentById(appointmentId: string) {
        const apt = getAppointmentById(db, appointmentId, clinicId);
        if (apt.patientId !== patientId) return denied();
        return apt;
      },
      async rescheduleAppointment() {
        return denied();
      },
      async createFollowup() {
        return denied();
      },
      async getPatientHomeData() {
        return getPatientHomeData(db, clinicId, ctx.clinic, patientId, ctx.user.id);
      },
      async getPatientHealthData() {
        return getPatientOwnHealthData(db, clinicId, patientId);
      },
      async getPatientNotifications() {
        return listNotificationsForUser(db, clinicId, ctx.user.id, 30);
      },
    };
  }

  // Staff / Doctor / Clinic Administrator adapter
  return {
    role,
    linkedStaffId: ctx.linkedStaffId,
    async getDailyReport(date?: string) {
      return getDailyOperationalReport(db, date, clinicId);
    },
    async getOverviewReport() {
      return getOverviewReport(db, undefined, clinicId);
    },
    async getUnconfirmedAppointments() {
      return getUnconfirmedAppointments(db, undefined, clinicId);
    },
    async getMissedAppointments(days = 7) {
      return getMissedAppointments(db, { clinicId, days });
    },
    async getPendingFollowups() {
      return getPendingFollowups(
        db,
        clinicId,
        role === 'Doctor' && ctx.linkedStaffId ? ctx.linkedStaffId : undefined
      );
    },
    async checkAvailability(params) {
      return checkAppointmentAvailability(db, { clinicId, ...params });
    },
    async getPatientWithHistory(patientId: string) {
      const patient = getPatientById(db, patientId, clinicId);
      const appointments = listAppointments(db, { clinicId, patientId });
      const followups = listFollowups(db, { clinicId, patientId });
      return { patient, appointments, followups };
    },
    async getAppointmentById(appointmentId: string) {
      return getAppointmentById(db, appointmentId, clinicId);
    },
    async rescheduleAppointment(appointmentId, patch) {
      return updateAppointment(
        db,
        appointmentId,
        {
          appointmentDate: patch.appointmentDate,
          appointmentTime: patch.appointmentTime,
          status: 'Scheduled',
          notes: patch.notes,
        },
        actor,
        clinicId
      );
    },
    async createFollowup(input) {
      return createFollowup(db, input, actor, clinicId);
    },
    async getDoctorAvailabilitySummary(params) {
      return getClinicDoctorAvailabilitySummary(db, clinicId, params);
    },
    async getDoctorDashboard() {
      if (!ctx.linkedStaffId) {
        throw new ServiceError(404, 'STAFF_NOT_FOUND', 'No linked doctor profile found.');
      }
      return getDoctorDashboard(db, clinicId, ctx.linkedStaffId);
    },
  };
}

function persistAssistantTurn(
  db: DatabaseSync,
  ctx: AuthenticatedClinicContext,
  prompt: string,
  reply: AssistantResponse,
  requestedConversationId?: string
): AssistantResponse {
  const userTurn = appendAiMessage(db, ctx.clinic.id, ctx.user.id, ctx.membership.role, {
    conversationId: requestedConversationId,
    messageRole: 'user',
    content: prompt,
    titleHint: prompt,
  });

  appendAiMessage(db, ctx.clinic.id, ctx.user.id, ctx.membership.role, {
    conversationId: userTurn.conversationId,
    messageRole: 'assistant',
    content: reply.summary,
    intent: reply.intent,
    response: { ...reply, conversationId: userTurn.conversationId },
  });

  return {
    ...reply,
    conversationId: userTurn.conversationId,
  };
}

export function createExpressApp(
  db: DatabaseSync,
  options?: { verifyToken?: TokenVerifier }
) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const { requireAuthenticatedUser, requireClinicAccess, requirePermission } = createAuthGuards(
    db,
    options?.verifyToken
  );

  // Core clinic REST API
  app.use('/api', createClinicApiRouter(db, options));

  // Authenticated, clinic-isolated, role-scoped Assistant preview routes (All roles incl. Patient)
  app.post(
    '/api/assistant/query',
    requireAuthenticatedUser,
    requireClinicAccess,
    async (req: AuthenticatedRequest, res) => {
      try {
        const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
        const conversationId =
          typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : undefined;
        if (!prompt) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Please enter an operational question or request.',
            },
          });
          return;
        }
        const ctx = req.clinicContext!;
        const agent = new CareDeskAgent(
          createRoleScopedAdapter(db, ctx, `${ctx.actorLabel} via CareDesk Assistant`)
        );
        const reply = await agent.handlePrompt(prompt);
        const persisted = persistAssistantTurn(db, ctx, prompt, reply, conversationId);
        res.json({ data: persisted });
      } catch (err) {
        if (err instanceof ServiceError) {
          res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
          return;
        }
        res.status(500).json({
          error: {
            code: 'ASSISTANT_ERROR',
            message: err instanceof Error ? err.message : 'Unable to process assistant request.',
          },
        });
      }
    }
  );

  app.post(
    '/api/assistant/stream',
    requireAuthenticatedUser,
    requireClinicAccess,
    async (req: AuthenticatedRequest, res) => {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      const conversationId =
        typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : undefined;
      if (!prompt) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Please enter an operational question or request.',
          },
        });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const abortController = new AbortController();
      let closed = false;
      res.on('close', () => {
        if (!res.writableEnded) {
          closed = true;
          abortController.abort();
        }
      });

      const writeEvent = (event: unknown) => {
        if (closed || res.writableEnded) return;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      try {
        const ctx = req.clinicContext!;
        const agent = new CareDeskAgent(
          createRoleScopedAdapter(db, ctx, `${ctx.actorLabel} via CareDesk Assistant`)
        );
        await agent.handlePrompt(prompt, {
          signal: abortController.signal,
          onEvent: (event) => {
            if (event.type === 'complete') {
              const persisted = persistAssistantTurn(
                db,
                ctx,
                prompt,
                event.response,
                conversationId
              );
              writeEvent({ type: 'complete', response: persisted });
              return;
            }
            writeEvent(event);
          },
        });
        if (!closed && !res.writableEnded) {
          res.end();
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          if (!res.writableEnded) res.end();
          return;
        }
        const code = err instanceof ServiceError ? err.code : 'ASSISTANT_ERROR';
        const message =
          err instanceof Error ? err.message : 'Unable to process assistant request.';
        writeEvent({ type: 'error', code, message });
        if (!res.writableEnded) {
          res.end();
        }
      }
    }
  );

  app.post(
    '/api/assistant/confirm',
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission('canConfirmAssistantActions'),
    async (req: AuthenticatedRequest, res) => {
      try {
        const actionType = req.body?.actionType;
        const payload = req.body?.payload;
        if (
          (actionType !== 'reschedule_appointment' && actionType !== 'create_missed_followups') ||
          !payload ||
          typeof payload !== 'object'
        ) {
          res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid confirmation payload.' },
          });
          return;
        }

        const ctx = req.clinicContext!;
        const actor = `${ctx.actorLabel} via CareDesk Assistant`;
        const agent = new CareDeskAgent(createRoleScopedAdapter(db, ctx, actor));
        const reply = await agent.confirmPendingAction({ actionType, payload });
        res.json({ data: reply });
      } catch (err) {
        if (err instanceof ServiceError) {
          res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
          return;
        }
        res.status(500).json({
          error: {
            code: 'CONFIRMATION_ERROR',
            message: err instanceof Error ? err.message : 'Unable to execute confirmed action.',
          },
        });
      }
    }
  );

  return app;
}

async function startServer() {
  const db = getDatabase();
  seedDatabaseIfEmpty(db);

  const app = createExpressApp(db);
  const port = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`CareDesk AI server listening on http://localhost:${port}`);
  });
}

// Start HTTP server only when executed directly (allows tests to import createExpressApp cleanly)
const isDirectExecution =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('server.ts');

if (isDirectExecution) {
  startServer().catch((err) => {
    console.error('Failed to start CareDesk AI server:', err);
    process.exit(1);
  });
}
