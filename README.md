# CareDesk AI — Healthcare Operations Copilot

> **"Less time managing healthcare administration. More time delivering healthcare."**

CareDesk AI is a full-stack healthcare operations and administrative intelligence platform built with **React**, **TypeScript**, **Express**, and a persistent **SQLite (`node:sqlite`)** relational database. It is architected so its core REST API and backend services can be scanned by **2nd Brain Labs' Synapse CLI** to generate an MCP server.

---

## Architecture Overview

- **Frontend (`src/App.tsx`, `src/components/`, `src/client/api.ts`)**: Responsive React + Tailwind CSS dashboard with Operations Dashboard, CareDesk Assistant, Patient Management, Appointment Management, Administrative Follow-ups, and Operational Reports & API Reference.
- **Core Backend (`src/server/`)**:
  - `src/server/db/database.ts` & `seed.ts`: Persistent SQLite schema (`patients`, `appointments`, `followups`, `audit_logs`) seeded with 24 synthetic patients, 38 appointments, and 12 follow-up tasks.
  - `src/server/domain/rules.ts`: Pure scheduling conflict detection, available slot computation, date/time validation, and non-clinical scope checks.
  - `src/server/services/`: Business-logic layer separated from HTTP controllers (`patientService.ts`, `appointmentService.ts`, `followupService.ts`, `reportService.ts`, `auditService.ts`).
  - `src/server/routes/apiRouter.ts` & `openapi.ts`: Synapse-scannable REST endpoints and OpenAPI 3.0.3 spec (`/api/docs`).
  - `src/server/auth/session.ts`: HMAC-SHA256 Bearer token session management enforcing Administrator authorization on record mutations.
- **Decoupled Agent Module (`src/agent/copilot.ts`)**: Isolated from the frontend and core clinic CRUD routes. Currently runs via a **Development Preview Direct Local REST Adapter** (explicitly labeled in the UI; Synapse MCP integration is not yet connected).

---

## Setup & Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Optional environment configuration
# Copy .env.example if customizing ADMIN_PASSCODE, CAREDESK_DB_PATH, or GEMINI_API_KEY

# 3. Start full-stack dev server (Express + Vite on port 3000)
npm run dev

# 4. Run backend & agent unit/integration tests
npx --yes tsx --test src/server/domain/rules.test.ts src/server/api.test.ts src/agent/copilot.test.ts

# 5. Typecheck & production build
npm run lint
npm run build
npm start
```

---

## Core REST Endpoints (`/api`)

- **Patients**: `GET /api/patients`, `GET /api/patients/:id`, `POST /api/patients`
- **Appointments**: `GET /api/appointments`, `GET /api/appointments/today`, `GET /api/appointments/missed`, `GET /api/appointments/unconfirmed`, `GET /api/appointments/availability`, `GET /api/appointments/:id`, `POST /api/appointments`, `PATCH /api/appointments/:id`
- **Follow-ups**: `GET /api/followups`, `GET /api/followups/pending`, `POST /api/followups`, `PATCH /api/followups/:id`
- **Reports & Docs**: `GET /api/reports/daily`, `GET /api/reports/overview`, `GET /api/docs`

---

## Safety & Scope Notice

- Uses **synthetic demonstration data exclusively**.
- Strictly **non-clinical and administrative**: rejects medical diagnosis or treatment requests.
- Enforces scheduling conflict detection, server-side input validation, audit logging, and explicit administrator confirmation prior to modifying records.
