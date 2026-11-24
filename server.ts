import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createServer as createViteServer } from 'vite';
import { CareDeskAgent, type CareDeskToolAdapter } from './src/agent/copilot';
import { requireAdministrator, type AuthenticatedRequest } from './src/server/auth/session';
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
import { createFollowup, getPendingFollowups, listFollowups } from './src/server/services/followupService';
import { getPatientById, ServiceError } from './src/server/services/patientService';
import { getDailyOperationalReport, getOverviewReport } from './src/server/services/reportService';

function createLocalRestPreviewAdapter(db: DatabaseSync, actor: string): CareDeskToolAdapter {
  return {
    async getDailyReport(date?: string) {
      return getDailyOperationalReport(db, date);
    },
    async getOverviewReport() {
      return getOverviewReport(db);
    },
    async getUnconfirmedAppointments() {
      return getUnconfirmedAppointments(db);
    },
    async getMissedAppointments(days = 7) {
      return getMissedAppointments(db, { days });
    },
    async getPendingFollowups() {
      return getPendingFollowups(db);
    },
    async checkAvailability(params) {
      return checkAppointmentAvailability(db, params);
    },
    async getPatientWithHistory(patientId: string) {
      const patient = getPatientById(db, patientId);
      const appointments = listAppointments(db, { patientId });
      const followups = listFollowups(db, { patientId });
      return { patient, appointments, followups };
    },
    async getAppointmentById(appointmentId: string) {
      return getAppointmentById(db, appointmentId);
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
        actor
      );
    },
    async createFollowup(input) {
      return createFollowup(db, input, actor);
    },
  };
}

export function createExpressApp(db: DatabaseSync) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Core clinic REST API (Synapse CLI target)
  app.use('/api', createClinicApiRouter(db));

  // Decoupled Assistant preview routes (isolated from core REST resources)
  app.post('/api/assistant/query', async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!prompt) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Please enter an operational question or request.' },
        });
        return;
      }
      const agent = new CareDeskAgent(createLocalRestPreviewAdapter(db, 'CareDesk Assistant'));
      const reply = await agent.handlePrompt(prompt);
      res.json({ data: reply });
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
  });

  app.post('/api/assistant/confirm', requireAdministrator, async (req: AuthenticatedRequest, res) => {
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

      const actor = `${req.sessionClaims?.actor ?? 'Administrator'} via CareDesk Assistant`;
      const agent = new CareDeskAgent(createLocalRestPreviewAdapter(db, actor));
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
  });

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
