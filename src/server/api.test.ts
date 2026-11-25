import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { createExpressApp } from '../../server';
import {
  createDemoSessionToken,
  isDemoAuthEnabled,
  type TokenVerifier,
  type VerifiedFirebaseIdentity,
  verifyDemoSessionToken,
  verifySessionToken,
} from './auth/session';
import { createDatabase, DEFAULT_DEMO_CLINIC_ID } from './db/database';
import { seedDatabaseIfEmpty } from './db/seed';
import { getClinicTodayDate } from './domain/rules';

const TEST_IDENTITIES: Record<string, VerifiedFirebaseIdentity> = {
  'token-demo-admin': {
    uid: 'fb-demo-admin',
    email: 'demo.admin@caredesk.example.org',
    name: 'Demo Clinic Admin',
    provider: 'google.com',
    emailVerified: true,
  },
  'token-admin-a': {
    uid: 'fb-admin-a',
    email: 'admin.a@alphahealth.org',
    name: 'Dr. Elena Brooks',
    provider: 'password',
    emailVerified: true,
  },
  'token-admin-b': {
    uid: 'fb-admin-b',
    email: 'admin.b@betaoutpatient.org',
    name: 'Marcus Sterling',
    provider: 'google.com',
    emailVerified: true,
  },
  'token-doctor-a': {
    uid: 'fb-doctor-a',
    email: 'doctor@alphahealth.org',
    name: 'Dr. Priya Patel',
    provider: 'password',
    emailVerified: true,
  },
  'token-reception-a': {
    uid: 'fb-reception-a',
    email: 'reception@alphahealth.org',
    name: 'Jordan Rivera',
    provider: 'password',
    emailVerified: true,
  },
  'token-staff-a': {
    uid: 'fb-staff-a',
    email: 'staff@alphahealth.org',
    name: 'Samira Haddad',
    provider: 'password',
    emailVerified: true,
  },
  'token-candidate-doc': {
    uid: 'fb-candidate-doc',
    email: 'dr.nadia@alphahealth.org',
    name: 'Dr. Nadia Lin',
    provider: 'password',
    emailVerified: true,
  },
  'token-patient-one': {
    uid: 'fb-patient-one',
    email: 'patient.one@example.org',
    name: 'Alpha Patient One',
    provider: 'password',
    emailVerified: true,
  },
  'token-patient-unlinked': {
    uid: 'fb-patient-unlinked',
    email: 'sora.takahashi@example.org',
    name: 'Sora Takahashi',
    provider: 'password',
    emailVerified: true,
  },
};

const testTokenVerifier: TokenVerifier = async (token: string) => {
  return TEST_IDENTITIES[token] ?? null;
};

async function withTestServer(
  run: (baseUrl: string, db: DatabaseSync) => Promise<void>
): Promise<void> {
  const db = createDatabase(':memory:');
  seedDatabaseIfEmpty(db);
  const app = createExpressApp(db, { verifyToken: testTokenVerifier });

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', async () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        db.close();
        reject(new Error('Failed to bind ephemeral port'));
        return;
      }
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      try {
        await run(baseUrl, db);
        server.close();
        db.close();
        resolve();
      } catch (err) {
        server.close();
        db.close();
        reject(err);
      }
    });
  });
}

function attachUserToDemoClinic(db: DatabaseSync, identity: VerifiedFirebaseIdentity) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, firebase_uid, email, full_name, phone_number, avatar_url, auth_provider, created_at, updated_at)
    VALUES ('USR-DEMO-1', ?, ?, ?, '+1-555-0101', '', ?, ?, ?)
  `).run(
    identity.uid,
    identity.email,
    identity.name ?? 'Demo Admin',
    identity.provider ?? 'google.com',
    now,
    now
  );
  db.prepare(`
    INSERT INTO clinic_memberships (id, clinic_id, user_id, role, status, created_at, updated_at)
    VALUES ('MBR-DEMO-1', ?, 'USR-DEMO-1', 'Clinic Administrator', 'Active', ?, ?)
  `).run(DEFAULT_DEMO_CLINIC_ID, now, now);
}

async function syncUser(
  baseUrl: string,
  token: string,
  extra?: { fullName?: string; phoneNumber?: string; clinicId?: string }
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (extra?.clinicId) headers['X-Clinic-Id'] = extra.clinicId;
  const res = await fetch(`${baseUrl}/api/auth/sync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fullName: extra?.fullName,
      phoneNumber: extra?.phoneNumber,
    }),
  });
  return res;
}

test('Unauthenticated requests are blocked while public health/docs/auth config endpoints respond cleanly', async () => {
  await withTestServer(async (baseUrl) => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);

    const docsRes = await fetch(`${baseUrl}/api/docs`);
    assert.equal(docsRes.status, 200);
    const docsJson = (await docsRes.json()) as { openapi: string; paths: Record<string, unknown> };
    assert.equal(docsJson.openapi, '3.0.3');
    assert.ok(docsJson.paths['/patients']);
    assert.ok(docsJson.paths['/clinics/onboard']);

    const configRes = await fetch(`${baseUrl}/api/auth/config`);
    assert.equal(configRes.status, 200);

    for (const protectedPath of [
      '/api/patients',
      '/api/appointments',
      '/api/staff',
      '/api/followups',
      '/api/reports/overview',
      '/api/audit-logs',
    ]) {
      const r = await fetch(`${baseUrl}${protectedPath}`);
      assert.equal(r.status, 401, `${protectedPath} must return 401 without Bearer token`);
    }

    const assistantUnauth = await fetch(`${baseUrl}/api/assistant/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: "Give me today's clinic briefing." }),
    });
    assert.equal(assistantUnauth.status, 401);

    const invalidTokenRes = await fetch(`${baseUrl}/api/patients`, {
      headers: { Authorization: 'Bearer forged-token' },
    });
    assert.equal(invalidTokenRes.status, 401);
  });
});

test('Administrator registration, clinic onboarding, and strict cross-clinic data isolation', async () => {
  await withTestServer(async (baseUrl) => {
    // 1. User A registers -> needsOnboarding = true, blocked from /api/patients until onboarded
    const syncARes = await syncUser(baseUrl, 'token-admin-a', {
      fullName: 'Dr. Elena Brooks',
      phoneNumber: '+1-555-0111',
    });
    assert.equal(syncARes.status, 200);
    const syncA = (await syncARes.json()) as {
      data: { needsOnboarding: boolean; activeClinic: unknown; user: { phoneNumber: string } };
    };
    assert.equal(syncA.data.needsOnboarding, true);
    assert.equal(syncA.data.activeClinic, null);
    assert.equal(syncA.data.user.phoneNumber, '+1-555-0111');

    const preOnboardPatients = await fetch(`${baseUrl}/api/patients`, {
      headers: { Authorization: 'Bearer token-admin-a' },
    });
    assert.equal(preOnboardPatients.status, 403);

    // 2. Admin A onboards Clinic A (clean empty workspace by default)
    const onboardARes = await fetch(`${baseUrl}/api/clinics/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
      },
      body: JSON.stringify({
        clinicName: 'Alpha Health Outpatient Center',
        clinicType: 'Primary Care & Family Medicine',
        contactPhone: '+1-555-0190',
        contactEmail: 'ops@alphahealth.org',
        location: 'Seattle, WA',
        organizationNotes: 'Mon-Fri 08:30-16:30',
        seedSampleData: false,
      }),
    });
    assert.equal(onboardARes.status, 201);
    const onboardA = (await onboardARes.json()) as {
      data: {
        needsOnboarding: boolean;
        activeClinic: { id: string; name: string };
        activeMembership: { role: string };
      };
    };
    assert.equal(onboardA.data.needsOnboarding, false);
    assert.equal(onboardA.data.activeMembership.role, 'Clinic Administrator');
    const clinicAId = onboardA.data.activeClinic.id;

    // Clinic A starts isolated (0 patients; demo CLN-1001 patients are NOT visible)
    const listARes = await fetch(`${baseUrl}/api/patients`, {
      headers: { Authorization: 'Bearer token-admin-a', 'X-Clinic-Id': clinicAId },
    });
    assert.equal(listARes.status, 200);
    const listA = (await listARes.json()) as { data: unknown[] };
    assert.equal(listA.data.length, 0);

    // Admin A registers a patient in Clinic A
    const createPtARes = await fetch(`${baseUrl}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
        'X-Clinic-Id': clinicAId,
      },
      body: JSON.stringify({
        fullName: 'Alpha Patient One',
        dateOfBirth: '1988-03-10',
        contactNumber: '+1-555-0201',
        email: 'alpha.one@example.org',
        administrativeStatus: 'Active',
      }),
    });
    assert.equal(createPtARes.status, 201);
    const ptA = (await createPtARes.json()) as { data: { id: string } };

    // 3. Admin B onboards Clinic B
    await syncUser(baseUrl, 'token-admin-b');
    const onboardBRes = await fetch(`${baseUrl}/api/clinics/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-b',
      },
      body: JSON.stringify({
        clinicName: 'Beta Outpatient Practice',
        clinicType: 'Cardiology & Vascular Practice',
        contactPhone: '+1-555-0299',
        contactEmail: 'ops@betaoutpatient.org',
        location: 'Denver, CO',
      }),
    });
    assert.equal(onboardBRes.status, 201);
    const onboardB = (await onboardBRes.json()) as {
      data: { activeClinic: { id: string } };
    };
    const clinicBId = onboardB.data.activeClinic.id;
    assert.notEqual(clinicAId, clinicBId);

    // 4. Cross-clinic isolation checks: Admin B CANNOT read Clinic A via header or ID
    const crossHeaderRes = await fetch(`${baseUrl}/api/patients`, {
      headers: { Authorization: 'Bearer token-admin-b', 'X-Clinic-Id': clinicAId },
    });
    assert.equal(crossHeaderRes.status, 403);

    const crossPatientLookup = await fetch(`${baseUrl}/api/patients/${ptA.data.id}`, {
      headers: { Authorization: 'Bearer token-admin-b', 'X-Clinic-Id': clinicBId },
    });
    assert.equal(crossPatientLookup.status, 404);

    const crossPatientPatch = await fetch(`${baseUrl}/api/patients/${ptA.data.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-b',
        'X-Clinic-Id': clinicBId,
      },
      body: JSON.stringify({ fullName: 'Hijacked Name' }),
    });
    assert.equal(crossPatientPatch.status, 404);

    // Admin B personal profile and clinic settings updates work cleanly
    const patchProfileRes = await fetch(`${baseUrl}/api/account/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-b',
        'X-Clinic-Id': clinicBId,
      },
      body: JSON.stringify({ fullName: 'Marcus Sterling Jr.', phoneNumber: '+1-555-0333' }),
    });
    assert.equal(patchProfileRes.status, 200);
    const patchedProfile = (await patchProfileRes.json()) as {
      data: { fullName: string; phoneNumber: string };
    };
    assert.equal(patchedProfile.data.fullName, 'Marcus Sterling Jr.');
    assert.equal(patchedProfile.data.phoneNumber, '+1-555-0333');

    const patchClinicRes = await fetch(`${baseUrl}/api/clinic`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-b',
        'X-Clinic-Id': clinicBId,
      },
      body: JSON.stringify({ location: 'Boulder, CO' }),
    });
    assert.equal(patchClinicRes.status, 200);
  });
});

test('Multi-user RBAC enforces permissions per role and auto-accepts invitations', async () => {
  await withTestServer(async (baseUrl) => {
    const today = getClinicTodayDate();

    // Admin A creates Clinic A with sample patients
    await syncUser(baseUrl, 'token-admin-a');
    const onboardRes = await fetch(`${baseUrl}/api/clinics/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
      },
      body: JSON.stringify({
        clinicName: 'Alpha Multi-Role Clinic',
        clinicType: 'Multi-Specialty Outpatient Clinic',
        contactPhone: '+1-555-0195',
        contactEmail: 'ops@alphahealth.org',
        location: 'Austin, TX',
        seedSampleData: true,
      }),
    });
    assert.equal(onboardRes.status, 201);
    const onboard = (await onboardRes.json()) as { data: { activeClinic: { id: string } } };
    const clinicAId = onboard.data.activeClinic.id;

    // Invite Doctor, Receptionist, and Clinic Staff
    for (const invite of [
      { email: 'doctor@alphahealth.org', fullName: 'Dr. Priya Patel', role: 'Doctor' },
      { email: 'reception@alphahealth.org', fullName: 'Jordan Rivera', role: 'Receptionist' },
      { email: 'staff@alphahealth.org', fullName: 'Samira Haddad', role: 'Clinic Staff' },
    ]) {
      const invRes = await fetch(`${baseUrl}/api/clinic/members/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-admin-a',
          'X-Clinic-Id': clinicAId,
        },
        body: JSON.stringify(invite),
      });
      assert.equal(invRes.status, 201);
    }

    // Fetch a patient ID inside Clinic A
    const ptsRes = await fetch(`${baseUrl}/api/patients`, {
      headers: { Authorization: 'Bearer token-admin-a', 'X-Clinic-Id': clinicAId },
    });
    const pts = (await ptsRes.json()) as { data: Array<{ id: string }> };
    const samplePatientId = pts.data[0].id;

    // Clinic Staff (read-only) joins via invite -> allowed GET, blocked POST/audit-logs
    const staffSync = await syncUser(baseUrl, 'token-staff-a');
    assert.equal(staffSync.status, 200);
    const staffReadPt = await fetch(`${baseUrl}/api/patients/${samplePatientId}`, {
      headers: { Authorization: 'Bearer token-staff-a', 'X-Clinic-Id': clinicAId },
    });
    assert.equal(staffReadPt.status, 200);
    const staffPtDetail = (await staffReadPt.json()) as {
      data: { activity: unknown[]; permissions: { canEdit: boolean; canViewAuditHistory: boolean } };
    };
    assert.equal(staffPtDetail.data.permissions.canEdit, false);
    assert.equal(staffPtDetail.data.permissions.canViewAuditHistory, false);
    assert.equal(staffPtDetail.data.activity.length, 0);

    const staffWriteBlocked = await fetch(`${baseUrl}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-staff-a',
        'X-Clinic-Id': clinicAId,
      },
      body: JSON.stringify({
        fullName: 'Blocked Staff Attempt',
        dateOfBirth: '1990-01-01',
        contactNumber: '+1-555-0999',
        email: 'blocked@example.org',
      }),
    });
    assert.equal(staffWriteBlocked.status, 403);

    const staffAuditBlocked = await fetch(`${baseUrl}/api/audit-logs`, {
      headers: { Authorization: 'Bearer token-staff-a', 'X-Clinic-Id': clinicAId },
    });
    assert.equal(staffAuditBlocked.status, 403);

    // Receptionist can register patients & schedule appointments, but cannot delete appointments or invite team
    await syncUser(baseUrl, 'token-reception-a');
    const recPtRes = await fetch(`${baseUrl}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-reception-a',
        'X-Clinic-Id': clinicAId,
      },
      body: JSON.stringify({
        fullName: 'Reception Created Patient',
        dateOfBirth: '1994-07-12',
        contactNumber: '+1-555-0444',
        email: 'reception.pt@example.org',
      }),
    });
    assert.equal(recPtRes.status, 201);

    const recInviteBlocked = await fetch(`${baseUrl}/api/clinic/members/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-reception-a',
        'X-Clinic-Id': clinicAId,
      },
      body: JSON.stringify({ email: 'other@alphahealth.org', role: 'Clinic Staff' }),
    });
    assert.equal(recInviteBlocked.status, 403);

    // Doctor can create followups & manage appointments, but cannot manage clinic settings
    await syncUser(baseUrl, 'token-doctor-a');
    const docFuRes = await fetch(`${baseUrl}/api/followups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-doctor-a',
        'X-Clinic-Id': clinicAId,
      },
      body: JSON.stringify({
        patientId: samplePatientId,
        description: 'Follow up with lab intake forms.',
        priority: 'Medium',
        dueDate: today,
      }),
    });
    assert.equal(docFuRes.status, 201);

    const docClinicBlocked = await fetch(`${baseUrl}/api/clinic`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-doctor-a',
        'X-Clinic-Id': clinicAId,
      },
      body: JSON.stringify({ name: 'Unauthorized Rename' }),
    });
    assert.equal(docClinicBlocked.status, 403);

    // Cannot demote the last active Clinic Administrator
    const membersRes = await fetch(`${baseUrl}/api/clinic/members`, {
      headers: { Authorization: 'Bearer token-admin-a', 'X-Clinic-Id': clinicAId },
    });
    const membersJson = (await membersRes.json()) as {
      data: { members: Array<{ membershipId: string; role: string }> };
    };
    const soleAdmin = membersJson.data.members.find((m) => m.role === 'Clinic Administrator')!;
    const demoteRes = await fetch(`${baseUrl}/api/clinic/members/${soleAdmin.membershipId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
        'X-Clinic-Id': clinicAId,
      },
      body: JSON.stringify({ role: 'Doctor' }),
    });
    assert.equal(demoteRes.status, 409);
  });
});

test('Clinic-scoped CRUD, conflict checking, assistant SSE + P-1042 confirmation, 10/page pagination, and staff profiles work cleanly', async () => {
  await withTestServer(async (baseUrl, db) => {
    attachUserToDemoClinic(db, TEST_IDENTITIES['token-demo-admin']);
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-demo-admin',
      'X-Clinic-Id': DEFAULT_DEMO_CLINIC_ID,
    };
    const today = getClinicTodayDate();

    // Daily & Overview reports
    const dailyRes = await fetch(`${baseUrl}/api/reports/daily`, { headers: authHeaders });
    assert.equal(dailyRes.status, 200);
    const dailyJson = (await dailyRes.json()) as { data: { totalAppointments: number } };
    assert.ok(dailyJson.data.totalAppointments >= 6);

    const overviewRes = await fetch(`${baseUrl}/api/reports/overview`, { headers: authHeaders });
    assert.equal(overviewRes.status, 200);

    // Register patient + conflict check + valid booking
    const createPatientRes = await fetch(`${baseUrl}/api/patients`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        fullName: 'Sora Takahashi',
        dateOfBirth: '1992-05-14',
        contactNumber: '+1-555-0188',
        email: 'sora.takahashi@example.org',
        administrativeStatus: 'Active',
      }),
    });
    assert.equal(createPatientRes.status, 201);
    const createdPatient = (await createPatientRes.json()) as { data: { id: string } };

    const conflictRes = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        patientId: createdPatient.data.id,
        appointmentDate: today,
        appointmentTime: '08:30',
        department: 'General Medicine',
        clinician: 'Dr. Priya Patel',
      }),
    });
    assert.equal(conflictRes.status, 409);

    const availRes = await fetch(
      `${baseUrl}/api/appointments/availability?department=General%20Medicine&limit=2`,
      { headers: authHeaders }
    );
    const availJson = (await availRes.json()) as {
      data: Array<{ date: string; time: string; clinician: string; department: string }>;
    };
    assert.ok(availJson.data.length > 0);
    const slot = availJson.data[0];

    const bookRes = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        patientId: createdPatient.data.id,
        appointmentDate: slot.date,
        appointmentTime: slot.time,
        department: slot.department,
        clinician: slot.clinician,
      }),
    });
    assert.equal(bookRes.status, 201);

    // Assistant P-1042 confirmation flow
    const queryRes = await fetch(`${baseUrl}/api/assistant/query`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        prompt: 'Reschedule patient P-1042 to an available appointment slot.',
      }),
    });
    assert.equal(queryRes.status, 200);
    const queryJson = (await queryRes.json()) as {
      data: {
        pendingConfirmation?: {
          actionType: 'reschedule_appointment';
          payload: { appointmentId: string; appointmentDate: string; appointmentTime: string };
        };
      };
    };
    assert.ok(queryJson.data.pendingConfirmation);

    const confirmRes = await fetch(`${baseUrl}/api/assistant/confirm`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        actionType: queryJson.data.pendingConfirmation.actionType,
        payload: queryJson.data.pendingConfirmation.payload,
      }),
    });
    assert.equal(confirmRes.status, 200);

    // Assistant SSE stream
    const streamRes = await fetch(`${baseUrl}/api/assistant/stream`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Give me today's clinic briefing." }),
    });
    assert.equal(streamRes.status, 200);
    const rawSse = await streamRes.text();
    const events = rawSse
      .split('\n\n')
      .map((block) => block.trim())
      .filter(Boolean)
      .map(
        (block) =>
          JSON.parse(block.replace(/^data:\s*/, '')) as {
            type: string;
            response?: { intent: string; sections?: unknown[] };
          }
      );
    assert.ok(events.some((e) => e.type === 'tool_start'));
    assert.ok(events.some((e) => e.type === 'tool_done'));
    const complete = events.find((e) => e.type === 'complete');
    assert.equal(complete?.response?.intent, 'daily_briefing');

    // Appointment 10-per-page pagination, clamping, and delete
    const page1Res = await fetch(
      `${baseUrl}/api/appointments?page=1&pageSize=10&sortBy=id&sortDir=asc`,
      { headers: authHeaders }
    );
    assert.equal(page1Res.status, 200);
    const page1 = (await page1Res.json()) as {
      data: Array<{ id: string }>;
      meta: { count: number; total: number; page: number; pageSize: number; totalPages: number };
    };
    assert.equal(page1.data.length, 10);
    assert.equal(page1.meta.pageSize, 10);
    assert.ok(page1.meta.total >= 30);

    const clampRes = await fetch(`${baseUrl}/api/appointments?page=99&pageSize=10`, {
      headers: authHeaders,
    });
    const clamped = (await clampRes.json()) as typeof page1;
    assert.equal(clamped.meta.page, clamped.meta.totalPages);

    const delRes = await fetch(`${baseUrl}/api/appointments/${page1.data[0].id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    assert.equal(delRes.status, 200);

    // Staff directory & profile update
    const staffRes = await fetch(`${baseUrl}/api/staff`, { headers: authHeaders });
    assert.equal(staffRes.status, 200);
    const staffJson = (await staffRes.json()) as {
      data: Array<{ id: string; fullName: string }>;
    };
    const priya = staffJson.data.find((s) => s.fullName === 'Dr. Priya Patel')!;
    assert.ok(priya);

    const patchStaffRes = await fetch(`${baseUrl}/api/staff/${priya.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ email: 'priya.patel@caredesk.example.org', status: 'On Leave' }),
    });
    assert.equal(patchStaffRes.status, 200);
  });
});

test('Doctor verification approval, doctor workspace consultations, explainable reports, AI conversations, and notifications', async () => {
  await withTestServer(async (baseUrl) => {
    const today = getClinicTodayDate();

    // 1. Admin onboards a fresh clinic workspace
    await syncUser(baseUrl, 'token-admin-a');
    const onboardRes = await fetch(`${baseUrl}/api/clinics/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
      },
      body: JSON.stringify({
        clinicName: 'Northwind Specialty Clinic',
        clinicType: 'Multi-Specialty Outpatient Clinic',
        contactPhone: '+1-555-0400',
        contactEmail: 'admin@northwind.org',
        location: 'Portland, OR',
        seedSampleData: false,
      }),
    });
    assert.equal(onboardRes.status, 201);
    const clinicId = ((await onboardRes.json()) as { data: { activeClinic: { id: string } } }).data
      .activeClinic.id;

    // 2. Candidate doctor sees clinic directory & submits verification application (NOT yet active)
    await syncUser(baseUrl, 'token-candidate-doc');
    const dirRes = await fetch(`${baseUrl}/api/clinics/directory`, {
      headers: { Authorization: 'Bearer token-candidate-doc' },
    });
    assert.equal(dirRes.status, 200);
    const dirJson = (await dirRes.json()) as { data: Array<{ id: string; name: string }> };
    assert.ok(dirJson.data.some((c) => c.id === clinicId));

    const applyRes = await fetch(`${baseUrl}/api/doctor-applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-candidate-doc',
      },
      body: JSON.stringify({
        clinicId,
        fullName: 'Dr. Nadia Lin',
        phoneNumber: '+1-555-0412',
        specialty: 'Cardiology',
        department: 'Cardiology',
        qualifications: 'MD, FACC',
        licenseNumber: 'OR-MED-88921',
      }),
    });
    assert.equal(applyRes.status, 201);
    const appJson = (await applyRes.json()) as { data: { id: string; status: string } };
    assert.equal(appJson.data.status, 'Pending Verification');

    // Candidate doctor MUST be blocked from /api/doctor/dashboard before admin approval
    const preApproveDoc = await fetch(`${baseUrl}/api/doctor/dashboard`, {
      headers: { Authorization: 'Bearer token-candidate-doc', 'X-Clinic-Id': clinicId },
    });
    assert.equal(preApproveDoc.status, 403);

    // 3. Admin sees notification & approves doctor application
    const adminNotifRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: 'Bearer token-admin-a', 'X-Clinic-Id': clinicId },
    });
    assert.equal(adminNotifRes.status, 200);
    const adminNotifs = (await adminNotifRes.json()) as {
      data: Array<{ title: string }>;
      meta: { unreadCount: number };
    };
    assert.ok(adminNotifs.meta.unreadCount >= 1);
    assert.ok(adminNotifs.data.some((n) => n.title.includes('Doctor Verification')));

    const approveRes = await fetch(`${baseUrl}/api/doctor-applications/${appJson.data.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
        'X-Clinic-Id': clinicId,
      },
      body: JSON.stringify({ reviewNotes: 'License verified.' }),
    });
    assert.equal(approveRes.status, 200);
    const approvedData = (await approveRes.json()) as { data: { staff: { id: string } } };
    const doctorStaffId = approvedData.data.staff.id;

    // 4. Approved doctor accesses Doctor Workspace, configures schedule + duty status
    const docDashRes = await fetch(`${baseUrl}/api/doctor/dashboard`, {
      headers: { Authorization: 'Bearer token-candidate-doc', 'X-Clinic-Id': clinicId },
    });
    assert.equal(docDashRes.status, 200);
    const docDash = (await docDashRes.json()) as { data: { doctor: { id: string } } };
    assert.equal(docDash.data.doctor.id, doctorStaffId);

    const schedulePutRes = await fetch(`${baseUrl}/api/doctors/${doctorStaffId}/schedule`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-candidate-doc',
        'X-Clinic-Id': clinicId,
      },
      body: JSON.stringify({
        days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          isWorking: dayOfWeek >= 1 && dayOfWeek <= 5,
          startTime: '08:30',
          endTime: '17:00',
          breakStart: '12:00',
          breakEnd: '13:00',
          slotDurationMinutes: 30,
        })),
      }),
    });
    assert.equal(schedulePutRes.status, 200);

    const dutyRes = await fetch(`${baseUrl}/api/doctors/${doctorStaffId}/duty-status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-candidate-doc',
        'X-Clinic-Id': clinicId,
      },
      body: JSON.stringify({ attendanceStatus: 'Available' }),
    });
    assert.equal(dutyRes.status, 200);

    // 5. Register patient and author both a patient-visible and a doctor-private consultation
    const ptRes = await fetch(`${baseUrl}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
        'X-Clinic-Id': clinicId,
      },
      body: JSON.stringify({
        fullName: 'Alpha Patient One',
        dateOfBirth: '1988-03-10',
        contactNumber: '+1-555-0201',
        email: 'patient.one@example.org',
      }),
    });
    assert.equal(ptRes.status, 201);
    const patientId = ((await ptRes.json()) as { data: { id: string } }).data.id;

    const conVisibleRes = await fetch(`${baseUrl}/api/consultations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-candidate-doc',
        'X-Clinic-Id': clinicId,
      },
      body: JSON.stringify({
        patientId,
        consultationDate: today,
        summary: 'Normal cardiac auscultation and steady resting ECG.',
        diagnosisNotes: 'Benign sinus rhythm',
        recommendations: 'Repeat lipid panel in 6 months.',
        prescriptions: [
          { medication: 'Atorvastatin', dosage: '10 mg', frequency: 'Nightly', duration: '90 days' },
        ],
        testResults: [{ testName: '12-Lead ECG', resultValue: 'Normal sinus rhythm', status: 'Normal' }],
        patientVisible: true,
        createFollowUp: {
          description: '6-month preventive cardiology lipid check',
          dueDate: today,
          priority: 'Medium',
        },
      }),
    });
    assert.equal(conVisibleRes.status, 201);

    const conHiddenRes = await fetch(`${baseUrl}/api/consultations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-candidate-doc',
        'X-Clinic-Id': clinicId,
      },
      body: JSON.stringify({
        patientId,
        consultationDate: today,
        summary: 'Internal clinician differential note only.',
        patientVisible: false,
      }),
    });
    assert.equal(conHiddenRes.status, 201);

    // 6. Explainable reports, AI conversation persistence, and notification read-all
    const explainRes = await fetch(`${baseUrl}/api/reports/explainable`, {
      headers: { Authorization: 'Bearer token-admin-a', 'X-Clinic-Id': clinicId },
    });
    assert.equal(explainRes.status, 200);
    const explainJson = (await explainRes.json()) as {
      data: {
        sections: Array<{
          explanation: {
            whatHappened: string;
            whatItMeans: string;
            whyItMatters: string;
            appropriateAction: string;
          };
        }>;
        doctorUtilization: Array<{ staffId: string }>;
      };
    };
    assert.equal(explainJson.data.sections.length, 6);
    for (const sec of explainJson.data.sections) {
      assert.ok(sec.explanation.whatHappened);
      assert.ok(sec.explanation.whatItMeans);
      assert.ok(sec.explanation.whyItMatters);
      assert.ok(sec.explanation.appropriateAction);
    }
    assert.ok(explainJson.data.doctorUtilization.some((d) => d.staffId === doctorStaffId));

    const convCreate = await fetch(`${baseUrl}/api/assistant/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
        'X-Clinic-Id': clinicId,
      },
      body: JSON.stringify({ title: 'Morning Ops Check' }),
    });
    assert.equal(convCreate.status, 201);
    const convId = ((await convCreate.json()) as { data: { id: string } }).data.id;

    const convQuery = await fetch(`${baseUrl}/api/assistant/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
        'X-Clinic-Id': clinicId,
      },
      body: JSON.stringify({ prompt: "Give me today's clinic briefing.", conversationId: convId }),
    });
    assert.equal(convQuery.status, 200);

    const convDetail = await fetch(`${baseUrl}/api/assistant/conversations/${convId}`, {
      headers: { Authorization: 'Bearer token-admin-a', 'X-Clinic-Id': clinicId },
    });
    assert.equal(convDetail.status, 200);
    const detailJson = (await convDetail.json()) as { data: { messages: unknown[] } };
    assert.equal(detailJson.data.messages.length, 2);

    const convDel = await fetch(`${baseUrl}/api/assistant/conversations/${convId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token-admin-a', 'X-Clinic-Id': clinicId },
    });
    assert.equal(convDel.status, 200);

    const readAllRes = await fetch(`${baseUrl}/api/notifications/read-all`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-admin-a', 'X-Clinic-Id': clinicId },
    });
    assert.equal(readAllRes.status, 200);
  });
});

test('Patient portal verified claim-code flow prevents email auto-linking and enforces strict portal isolation', async () => {
  await withTestServer(async (baseUrl, db) => {
    attachUserToDemoClinic(db, TEST_IDENTITIES['token-demo-admin']);
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-demo-admin',
      'X-Clinic-Id': DEFAULT_DEMO_CLINIC_ID,
    };

    // 1. Register a patient matching token-patient-unlinked's EXACT email & name (Sora Takahashi)
    const soraRes = await fetch(`${baseUrl}/api/patients`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        fullName: 'Sora Takahashi',
        dateOfBirth: '1992-05-14',
        contactNumber: '+1-555-0188',
        email: 'sora.takahashi@example.org',
      }),
    });
    assert.equal(soraRes.status, 201);
    const soraId = ((await soraRes.json()) as { data: { id: string } }).data.id;

    // Sign in with matching email/name -> MUST NOT auto-link; needsOnboarding must remain true
    const unlinkedSync = await syncUser(baseUrl, 'token-patient-unlinked');
    assert.equal(unlinkedSync.status, 200);
    const unlinkedJson = (await unlinkedSync.json()) as {
      data: { needsOnboarding: boolean; activeClinic: unknown; linkedPatient: { id: string } | null };
    };
    assert.equal(unlinkedJson.data.needsOnboarding, true);
    assert.equal(unlinkedJson.data.linkedPatient, null);

    // 2. Generate Claim Code for Sora & test wrong DOB rejection vs valid claim redemption
    const inviteRes = await fetch(`${baseUrl}/api/patients/${soraId}/portal-invite`, {
      method: 'POST',
      headers: adminHeaders,
    });
    assert.equal(inviteRes.status, 201);
    const claimCode = ((await inviteRes.json()) as { data: { claimCode: string } }).data.claimCode;

    const wrongDobClaim = await fetch(`${baseUrl}/api/patient-portal/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-patient-unlinked',
      },
      body: JSON.stringify({
        clinicId: DEFAULT_DEMO_CLINIC_ID,
        claimCode,
        dateOfBirth: '1990-01-01',
      }),
    });
    assert.equal(wrongDobClaim.status, 403);

    const validClaim = await fetch(`${baseUrl}/api/patient-portal/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-patient-unlinked',
      },
      body: JSON.stringify({
        clinicId: DEFAULT_DEMO_CLINIC_ID,
        claimCode,
        dateOfBirth: '1992-05-14',
      }),
    });
    assert.equal(validClaim.status, 200);
    const claimedSession = (await validClaim.json()) as {
      data: { linkedPatient: { id: string } | null; activeMembership: { role: string } };
    };
    assert.equal(claimedSession.data.linkedPatient?.id, soraId);
    assert.equal(claimedSession.data.activeMembership.role, 'Patient');

    const patientHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-patient-unlinked',
      'X-Clinic-Id': DEFAULT_DEMO_CLINIC_ID,
    };

    // 3. Patient Portal strictly blocks clinic-wide admin/staff routes with 403
    for (const forbiddenRoute of [
      '/api/patients',
      '/api/patients/P-1001',
      '/api/reports/overview',
      '/api/reports/explainable',
      '/api/audit-logs',
    ]) {
      const r = await fetch(`${baseUrl}${forbiddenRoute}`, { headers: patientHeaders });
      assert.equal(r.status, 403, `Patient must get 403 on ${forbiddenRoute}`);
    }

    // 4. Insert one visible & one hidden consultation for Sora directly via DB or Doctor -> verify only visible shows
    const docUserNow = new Date().toISOString();
    db.prepare(`
      INSERT INTO consultations (
        id, clinic_id, appointment_id, patient_id, staff_id, doctor_name,
        consultation_date, summary, diagnosis_notes, recommendations,
        prescriptions_json, test_results_json, patient_visible, created_at, updated_at
      ) VALUES
      ('CON-VIS', ?, NULL, ?, 'STF-1001', 'Dr. Priya Patel', '2026-11-22', 'Visible patient care plan', '', 'Hydrate well', '[]', '[]', 1, ?, ?),
      ('CON-HID', ?, NULL, ?, 'STF-1001', 'Dr. Priya Patel', '2026-11-22', 'Hidden internal note', '', '', '[]', '[]', 0, ?, ?)
    `).run(
      DEFAULT_DEMO_CLINIC_ID,
      soraId,
      docUserNow,
      docUserNow,
      DEFAULT_DEMO_CLINIC_ID,
      soraId,
      docUserNow,
      docUserNow
    );

    const healthRes = await fetch(`${baseUrl}/api/patient-portal/health`, { headers: patientHeaders });
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as {
      data: { consultations: Array<{ id: string }> };
    };
    assert.equal(healthJson.data.consultations.length, 1);
    assert.equal(healthJson.data.consultations[0].id, 'CON-VIS');

    // 5. Patient checks availability, books an appointment, gets 409 on double-booking, and submits reschedule request
    const availRes = await fetch(
      `${baseUrl}/api/patient-portal/availability?department=General%20Medicine&days=7`,
      { headers: patientHeaders }
    );
    assert.equal(availRes.status, 200);
    const availJson = (await availRes.json()) as {
      data: {
        slots: Array<{
          date: string;
          time: string;
          staffId?: string;
          clinician: string;
          department: string;
        }>;
      };
    };
    assert.ok(availJson.data.slots.length >= 2);
    const firstSlot = availJson.data.slots[0];
    const secondSlot = availJson.data.slots[1];

    const bookRes = await fetch(`${baseUrl}/api/patient-portal/appointments`, {
      method: 'POST',
      headers: patientHeaders,
      body: JSON.stringify({
        staffId: firstSlot.staffId,
        clinician: firstSlot.clinician,
        department: firstSlot.department,
        appointmentDate: firstSlot.date,
        appointmentTime: firstSlot.time,
        appointmentType: 'Consultation',
      }),
    });
    assert.equal(bookRes.status, 201);
    const bookedAptId = ((await bookRes.json()) as { data: { id: string } }).data.id;

    // Double-booking the same slot must fail with 409
    const doubleBookRes = await fetch(`${baseUrl}/api/patient-portal/appointments`, {
      method: 'POST',
      headers: patientHeaders,
      body: JSON.stringify({
        staffId: firstSlot.staffId,
        clinician: firstSlot.clinician,
        department: firstSlot.department,
        appointmentDate: firstSlot.date,
        appointmentTime: firstSlot.time,
        appointmentType: 'Consultation',
      }),
    });
    assert.equal(doubleBookRes.status, 409);

    const reschedReqRes = await fetch(
      `${baseUrl}/api/patient-portal/appointments/${bookedAptId}/reschedule-request`,
      {
        method: 'POST',
        headers: patientHeaders,
        body: JSON.stringify({
          requestedDate: secondSlot.date,
          requestedTime: secondSlot.time,
          notes: 'Afternoon works better',
        }),
      }
    );
    assert.equal(reschedReqRes.status, 200);
    const reschedReqJson = (await reschedReqRes.json()) as {
      data: { requestStatus: string };
    };
    assert.equal(reschedReqJson.data.requestStatus, 'Reschedule Requested');
  });
});

test('Option 3 demo tokens verify HMAC signatures cleanly and disable automatically in production', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevDemoFlag = process.env.CAREDESK_ENABLE_DEMO_AUTH;
  try {
    process.env.NODE_ENV = 'development';
    delete process.env.CAREDESK_ENABLE_DEMO_AUTH;
    assert.equal(isDemoAuthEnabled(), true);

    const issued = createDemoSessionToken('doctor');
    assert.ok(issued.token.startsWith('cd_demo.'));

    const verified = verifyDemoSessionToken(issued.token);
    assert.ok(verified);
    assert.equal(verified.uid, 'demo-sandbox-doctor');
    assert.equal(verified.email, 'samuel.okafor@caredesk.example.org');

    const unified = await verifySessionToken(issued.token);
    assert.equal(unified?.uid, 'demo-sandbox-doctor');

    // Reject tampered payload or signature
    const parts = issued.token.split('.');
    const tamperedSig = `cd_demo.${parts[1]}.${parts[2].slice(0, -2)}xx`;
    assert.equal(verifyDemoSessionToken(tamperedSig), null);

    const forgedPayload = Buffer.from(
      JSON.stringify({ persona: 'administrator', exp: Math.floor(Date.now() / 1000) + 3600 }),
      'utf8'
    ).toString('base64url');
    assert.equal(verifyDemoSessionToken(`cd_demo.${forgedPayload}.${parts[2]}`), null);

    // Production disables demo tokens unless explicitly opted in
    process.env.NODE_ENV = 'production';
    assert.equal(isDemoAuthEnabled(), false);
    assert.equal(verifyDemoSessionToken(issued.token), null);

    process.env.CAREDESK_ENABLE_DEMO_AUTH = 'true';
    assert.equal(isDemoAuthEnabled(), true);
    assert.equal(verifyDemoSessionToken(issued.token)?.uid, 'demo-sandbox-doctor');
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevDemoFlag === undefined) delete process.env.CAREDESK_ENABLE_DEMO_AUTH;
    else process.env.CAREDESK_ENABLE_DEMO_AUTH = prevDemoFlag;
  }
});

test('Option 3 /api/auth/demo-signin enforces role isolation and production disablement', async () => {
  const db = createDatabase(':memory:');
  seedDatabaseIfEmpty(db);
  const app = createExpressApp(db);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const prevNodeEnv = process.env.NODE_ENV;
  const prevDemoFlag = process.env.CAREDESK_ENABLE_DEMO_AUTH;

  try {
    process.env.NODE_ENV = 'development';
    delete process.env.CAREDESK_ENABLE_DEMO_AUTH;

    const cfgRes = await fetch(`${baseUrl}/api/auth/config`);
    assert.equal(cfgRes.status, 200);
    const cfgJson = (await cfgRes.json()) as { data: { demoAuthEnabled: boolean } };
    assert.equal(cfgJson.data.demoAuthEnabled, true);

    // Invalid persona rejected cleanly
    const badPersonaRes = await fetch(`${baseUrl}/api/auth/demo-signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: 'superuser' }),
    });
    assert.equal(badPersonaRes.status, 400);

    // 1. Administrator demo sign-in -> full clinic dashboard access
    const adminSigninRes = await fetch(`${baseUrl}/api/auth/demo-signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: 'administrator' }),
    });
    assert.equal(adminSigninRes.status, 200);
    const adminToken = ((await adminSigninRes.json()) as { data: { token: string } }).data.token;
    const adminOverview = await fetch(`${baseUrl}/api/reports/overview`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Clinic-Id': DEFAULT_DEMO_CLINIC_ID },
    });
    assert.equal(adminOverview.status, 200);

    // 2. Doctor demo sign-in -> links Dr. Samuel Okafor, blocked from admin-only endpoints
    const doctorSigninRes = await fetch(`${baseUrl}/api/auth/demo-signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: 'doctor' }),
    });
    assert.equal(doctorSigninRes.status, 200);
    const doctorToken = ((await doctorSigninRes.json()) as { data: { token: string } }).data.token;
    const docDashRes = await fetch(`${baseUrl}/api/doctor/dashboard`, {
      headers: { Authorization: `Bearer ${doctorToken}`, 'X-Clinic-Id': DEFAULT_DEMO_CLINIC_ID },
    });
    assert.equal(docDashRes.status, 200);
    const docDash = (await docDashRes.json()) as { data: { doctor: { fullName: string } } };
    assert.equal(docDash.data.doctor.fullName, 'Dr. Samuel Okafor');

    const docBlockedStaffWrite = await fetch(`${baseUrl}/api/clinic`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${doctorToken}`,
        'X-Clinic-Id': DEFAULT_DEMO_CLINIC_ID,
      },
      body: JSON.stringify({ name: 'Tampered Clinic Name' }),
    });
    assert.equal(docBlockedStaffWrite.status, 403);

    // 3. Patient demo sign-in -> accesses Eleanor Vance portal, blocked from clinic-wide records
    const patientSigninRes = await fetch(`${baseUrl}/api/auth/demo-signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: 'patient' }),
    });
    assert.equal(patientSigninRes.status, 200);
    const patientToken = ((await patientSigninRes.json()) as { data: { token: string } }).data.token;
    const ptHealthRes = await fetch(`${baseUrl}/api/patient-portal/health`, {
      headers: { Authorization: `Bearer ${patientToken}`, 'X-Clinic-Id': DEFAULT_DEMO_CLINIC_ID },
    });
    assert.equal(ptHealthRes.status, 200);

    const ptBlockedPatients = await fetch(`${baseUrl}/api/patients`, {
      headers: { Authorization: `Bearer ${patientToken}`, 'X-Clinic-Id': DEFAULT_DEMO_CLINIC_ID },
    });
    assert.equal(ptBlockedPatients.status, 403);

    // 4. Production environment blocks /api/auth/demo-signin
    process.env.NODE_ENV = 'production';
    delete process.env.CAREDESK_ENABLE_DEMO_AUTH;
    const prodBlockedRes = await fetch(`${baseUrl}/api/auth/demo-signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: 'administrator' }),
    });
    assert.equal(prodBlockedRes.status, 403);
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevDemoFlag === undefined) delete process.env.CAREDESK_ENABLE_DEMO_AUTH;
    else process.env.CAREDESK_ENABLE_DEMO_AUTH = prevDemoFlag;
    server.close();
    db.close();
  }
});

test('Option 1 same-origin Firebase proxy routes validate inputs cleanly', async () => {
  await withTestServer(async (baseUrl) => {
    const badEmailSignin = await fetch(`${baseUrl}/api/auth/email-signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'secret' }),
    });
    assert.equal(badEmailSignin.status, 400);
    const badEmailJson = (await badEmailSignin.json()) as { error: { code: string } };
    assert.equal(badEmailJson.error.code, 'auth/invalid-email');

    const emptyPasswordSignin = await fetch(`${baseUrl}/api/auth/email-signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.org', password: '' }),
    });
    assert.equal(emptyPasswordSignin.status, 400);

    const weakRegister = await fetch(`${baseUrl}/api/auth/email-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Dr. Test User', email: 'test@example.org', password: '123' }),
    });
    assert.equal(weakRegister.status, 400);
    const weakJson = (await weakRegister.json()) as { error: { code: string } };
    assert.equal(weakJson.error.code, 'auth/weak-password');

    const badReset = await fetch(`${baseUrl}/api/auth/email-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bad' }),
    });
    assert.equal(badReset.status, 400);

    const missingRefresh = await fetch(`${baseUrl}/api/auth/email-refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missingRefresh.status, 400);

    const unauthPasswordChange = await fetch(`${baseUrl}/api/auth/email-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'old', newPassword: 'newpassword1' }),
    });
    assert.equal(unauthPasswordChange.status, 401);
  });
});

test('Doctor access isolation enforces caseload-only access across REST endpoints while preserving Admin, Staff, Receptionist, and shared-care workflows', async () => {
  await withTestServer(async (baseUrl, db) => {
    await syncUser(baseUrl, 'token-admin-a');
    const onboardRes = await fetch(`${baseUrl}/api/clinics/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
      },
      body: JSON.stringify({
        clinicName: 'Isolation Test Clinic',
        clinicType: 'Multi-Specialty Outpatient Clinic',
        contactPhone: '+1-555-0197',
        contactEmail: 'ops@isolationclinic.org',
        location: 'Boston, MA',
        seedSampleData: true,
      }),
    });
    assert.equal(onboardRes.status, 201);
    const clinicId = ((await onboardRes.json()) as { data: { activeClinic: { id: string } } }).data.activeClinic.id;

    for (const invite of [
      { email: 'doctor@alphahealth.org', fullName: 'Dr. Priya Patel', role: 'Doctor' },
      { email: 'reception@alphahealth.org', fullName: 'Jordan Rivera', role: 'Receptionist' },
      { email: 'staff@alphahealth.org', fullName: 'Samira Haddad', role: 'Clinic Staff' },
    ]) {
      const invRes = await fetch(`${baseUrl}/api/clinic/members/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-admin-a',
          'X-Clinic-Id': clinicId,
        },
        body: JSON.stringify(invite),
      });
      assert.equal(invRes.status, 201);
    }

    await syncUser(baseUrl, 'token-doctor-a');
    await syncUser(baseUrl, 'token-reception-a');
    await syncUser(baseUrl, 'token-staff-a');

    const adminHeaders = { Authorization: 'Bearer token-admin-a', 'X-Clinic-Id': clinicId };
    const doctorHeaders = { Authorization: 'Bearer token-doctor-a', 'X-Clinic-Id': clinicId };
    const receptionHeaders = { Authorization: 'Bearer token-reception-a', 'X-Clinic-Id': clinicId };
    const staffHeaders = { Authorization: 'Bearer token-staff-a', 'X-Clinic-Id': clinicId };

    // Locate seeded records inside Clinic A via Admin
    const [ptsRes, aptsRes, fusRes, staffListRes] = await Promise.all([
      fetch(`${baseUrl}/api/patients`, { headers: adminHeaders }),
      fetch(`${baseUrl}/api/appointments`, { headers: adminHeaders }),
      fetch(`${baseUrl}/api/followups`, { headers: adminHeaders }),
      fetch(`${baseUrl}/api/staff`, { headers: adminHeaders }),
    ]);
    assert.equal(ptsRes.status, 200);
    assert.equal(aptsRes.status, 200);
    assert.equal(fusRes.status, 200);
    assert.equal(staffListRes.status, 200);

    const allPatients = ((await ptsRes.json()) as { data: Array<{ id: string; fullName: string }> }).data;
    const allApts = ((await aptsRes.json()) as {
      data: Array<{ id: string; patientId: string; staffId?: string; clinician: string; status: string }>;
    }).data;
    const allFollowups = ((await fusRes.json()) as {
      data: Array<{ id: string; patientId: string; assignedToName?: string; status: string }>;
    }).data;
    const allStaff = ((await staffListRes.json()) as {
      data: Array<{ id: string; fullName: string; role: string }>;
    }).data;

    const julian = allPatients.find((p) => p.fullName === 'Julian Mercer');
    const eleanor = allPatients.find((p) => p.fullName === 'Eleanor Vance');
    const arthur = allPatients.find((p) => p.fullName === 'Arthur Pendelton');
    const miriam = allPatients.find((p) => p.fullName === 'Miriam Goldstein');
    assert.ok(julian && eleanor && arthur && miriam);

    const okaforStaff = allStaff.find((s) => s.fullName === 'Dr. Samuel Okafor');
    assert.ok(okaforStaff);

    const okaforArthurApt = allApts.find((a) => a.patientId === arthur.id && a.clinician === 'Dr. Samuel Okafor');
    const patelJulianApt = allApts.find((a) => a.patientId === julian.id && a.clinician === 'Dr. Priya Patel');
    const okaforFollowup = allFollowups.find((f) => f.patientId === miriam.id && f.assignedToName === 'Dr. Samuel Okafor');
    const frontDeskFollowup = allFollowups.find((f) => f.assignedToName === 'Front Desk Coordinator');
    assert.ok(okaforArthurApt && patelJulianApt && okaforFollowup && frontDeskFollowup);

    // 1. GET /api/patients returns only assigned patients (Julian & shared-care Eleanor), never Arthur or Miriam
    const docPtsRes = await fetch(`${baseUrl}/api/patients`, { headers: doctorHeaders });
    assert.equal(docPtsRes.status, 200);
    const docPatients = ((await docPtsRes.json()) as { data: Array<{ id: string }> }).data;
    const docPatientIds = new Set(docPatients.map((p) => p.id));
    assert.ok(docPatientIds.has(julian.id));
    assert.ok(docPatientIds.has(eleanor.id));
    assert.equal(docPatientIds.has(arthur.id), false);
    assert.equal(docPatientIds.has(miriam.id), false);

    // 2. GET /api/patients/:id blocks Arthur (403), allows Julian, and scopes shared-care Eleanor
    const arthurBlockedRes = await fetch(`${baseUrl}/api/patients/${arthur.id}`, { headers: doctorHeaders });
    assert.equal(arthurBlockedRes.status, 403);

    const julianAllowedRes = await fetch(`${baseUrl}/api/patients/${julian.id}`, { headers: doctorHeaders });
    assert.equal(julianAllowedRes.status, 200);

    const eleanorSharedRes = await fetch(`${baseUrl}/api/patients/${eleanor.id}`, { headers: doctorHeaders });
    assert.equal(eleanorSharedRes.status, 200);
    const eleanorDetail = (await eleanorSharedRes.json()) as {
      data: {
        appointments: Array<{ clinician: string }>;
        consultations: Array<{ doctorName: string }>;
        followups: Array<{ assignedToName?: string }>;
      };
    };
    assert.ok(eleanorDetail.data.appointments.length >= 1);
    assert.ok(eleanorDetail.data.appointments.every((a) => a.clinician === 'Dr. Priya Patel'));
    assert.ok(eleanorDetail.data.consultations.every((c) => c.doctorName === 'Dr. Priya Patel'));

    // 3. Appointment endpoints only expose Dr. Priya Patel's appointments and reject cross-doctor filters/IDs
    for (const path of ['/api/appointments', '/api/appointments/today', '/api/appointments/missed', '/api/appointments/unconfirmed']) {
      const r = await fetch(`${baseUrl}${path}`, { headers: doctorHeaders });
      assert.equal(r.status, 200, `Expected 200 for ${path}`);
      const list = ((await r.json()) as { data: Array<{ clinician: string }> }).data;
      assert.ok(list.every((a) => a.clinician === 'Dr. Priya Patel'), `${path} leaked another clinician's appointment`);
    }

    assert.equal(
      (await fetch(`${baseUrl}/api/appointments?staffId=${okaforStaff.id}`, { headers: doctorHeaders })).status,
      403
    );
    assert.equal(
      (await fetch(`${baseUrl}/api/appointments?clinician=${encodeURIComponent('Dr. Samuel Okafor')}`, { headers: doctorHeaders })).status,
      403
    );
    assert.equal(
      (await fetch(`${baseUrl}/api/appointments?patientId=${arthur.id}`, { headers: doctorHeaders })).status,
      403
    );
    assert.equal(
      (await fetch(`${baseUrl}/api/appointments/${okaforArthurApt.id}`, { headers: doctorHeaders })).status,
      403
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/appointments/${okaforArthurApt.id}`, {
          method: 'PATCH',
          headers: { ...doctorHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'Cancelled' }),
        })
      ).status,
      403
    );

    // Doctor cannot book appointments for another clinician or unassigned patient, but can book for own patient
    const blockedBooking = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: { ...doctorHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: arthur.id,
        appointmentDate: getClinicTodayDate(),
        appointmentTime: '17:00',
        department: 'General Medicine',
        clinician: 'Dr. Priya Patel',
      }),
    });
    assert.equal(blockedBooking.status, 403);

    const blockedOtherClinicianBooking = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: { ...doctorHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: julian.id,
        appointmentDate: getClinicTodayDate(),
        appointmentTime: '17:00',
        department: 'Cardiology',
        clinician: 'Dr. Samuel Okafor',
      }),
    });
    assert.equal(blockedOtherClinicianBooking.status, 403);

    // 4. Follow-ups, consultations, staff/schedule lookups & clinic reports isolation
    for (const fuPath of ['/api/followups', '/api/followups/pending']) {
      const r = await fetch(`${baseUrl}${fuPath}`, { headers: doctorHeaders });
      assert.equal(r.status, 200);
      const fus = ((await r.json()) as { data: Array<{ id: string }> }).data;
      const fuIds = new Set(fus.map((f) => f.id));
      assert.equal(fuIds.has(okaforFollowup.id), false);
      assert.equal(fuIds.has(frontDeskFollowup.id), false);
    }

    assert.equal(
      (
        await fetch(`${baseUrl}/api/followups/${okaforFollowup.id}`, {
          method: 'PATCH',
          headers: { ...doctorHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'Completed' }),
        })
      ).status,
      403
    );

    assert.equal(
      (
        await fetch(`${baseUrl}/api/followups`, {
          method: 'POST',
          headers: { ...doctorHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientId: arthur.id,
            description: 'Unauthorized outreach attempt',
            reason: 'Test',
            priority: 'Medium',
          }),
        })
      ).status,
      403
    );

    assert.equal(
      (
        await fetch(`${baseUrl}/api/consultations`, {
          method: 'POST',
          headers: { ...doctorHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointmentId: okaforArthurApt.id,
            patientId: arthur.id,
            summary: 'Unauthorized consultation write attempt',
          }),
        })
      ).status,
      403
    );

    assert.equal((await fetch(`${baseUrl}/api/staff/${okaforStaff.id}`, { headers: doctorHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/doctors/${okaforStaff.id}/schedule`, { headers: doctorHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/doctors/${okaforStaff.id}/unavailability`, { headers: doctorHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/doctors/availability?staffId=${okaforStaff.id}`, { headers: doctorHeaders })).status, 403);

    // Clinic-wide reports denied for Doctor, intact for Admin, Receptionist, Clinic Staff
    for (const reportPath of ['/api/reports/daily', '/api/reports/overview', '/api/reports/explainable']) {
      assert.equal((await fetch(`${baseUrl}${reportPath}`, { headers: doctorHeaders })).status, 403);
      assert.equal((await fetch(`${baseUrl}${reportPath}`, { headers: adminHeaders })).status, 200);
      assert.equal((await fetch(`${baseUrl}${reportPath}`, { headers: receptionHeaders })).status, 200);
      assert.equal((await fetch(`${baseUrl}${reportPath}`, { headers: staffHeaders })).status, 200);
    }

    // 5. Unlinked Doctor fails closed across clinical endpoints & assistant
    await syncUser(baseUrl, 'token-candidate-doc');
    const candUserRow = db
      .prepare('SELECT id FROM users WHERE firebase_uid = ?')
      .get('fb-candidate-doc') as { id: string } | undefined;
    assert.ok(candUserRow);
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO clinic_memberships (id, clinic_id, user_id, role, status, created_at, updated_at)
      VALUES ('MBR-UNLINKED-DOC', ?, ?, 'Doctor', 'Active', ?, ?)
    `).run(clinicId, candUserRow.id, nowIso, nowIso);

    const unlinkedHeaders = { Authorization: 'Bearer token-candidate-doc', 'X-Clinic-Id': clinicId };
    assert.equal((await fetch(`${baseUrl}/api/patients`, { headers: unlinkedHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/appointments`, { headers: unlinkedHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/followups`, { headers: unlinkedHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/doctor/dashboard`, { headers: unlinkedHeaders })).status, 403);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/assistant/query`, {
          method: 'POST',
          headers: { ...unlinkedHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'What is my schedule today?' }),
        })
      ).status,
      403
    );
  });
});

test('Doctor Copilot HTTP endpoints isolate reads, block clinic-wide prompts, and protect cross-clinician writes on confirm', async () => {
  await withTestServer(async (baseUrl) => {
    await syncUser(baseUrl, 'token-admin-a');
    const onboardRes = await fetch(`${baseUrl}/api/clinics/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
      },
      body: JSON.stringify({
        clinicName: 'Copilot Isolation Clinic',
        clinicType: 'Outpatient Clinic',
        contactPhone: '+1-555-0198',
        contactEmail: 'ops@copilotiso.org',
        location: 'Seattle, WA',
        seedSampleData: true,
      }),
    });
    assert.equal(onboardRes.status, 201);
    const clinicId = ((await onboardRes.json()) as { data: { activeClinic: { id: string } } }).data.activeClinic.id;

    const invRes = await fetch(`${baseUrl}/api/clinic/members/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-admin-a',
        'X-Clinic-Id': clinicId,
      },
      body: JSON.stringify({ email: 'doctor@alphahealth.org', fullName: 'Dr. Priya Patel', role: 'Doctor' }),
    });
    assert.equal(invRes.status, 201);
    await syncUser(baseUrl, 'token-doctor-a');

    const adminHeaders = { Authorization: 'Bearer token-admin-a', 'X-Clinic-Id': clinicId };
    const doctorHeaders = {
      Authorization: 'Bearer token-doctor-a',
      'X-Clinic-Id': clinicId,
      'Content-Type': 'application/json',
    };

    const allPatients = ((await (await fetch(`${baseUrl}/api/patients`, { headers: adminHeaders })).json()) as {
      data: Array<{ id: string; fullName: string }>;
    }).data;
    const allApts = ((await (await fetch(`${baseUrl}/api/appointments`, { headers: adminHeaders })).json()) as {
      data: Array<{ id: string; patientId: string; clinician: string; appointmentTime: string }>;
    }).data;

    const arthur = allPatients.find((p) => p.fullName === 'Arthur Pendelton')!;
    const julian = allPatients.find((p) => p.fullName === 'Julian Mercer')!;
    const okaforArthurApt = allApts.find((a) => a.patientId === arthur.id && a.clinician === 'Dr. Samuel Okafor')!;
    const patelJulianApt = allApts.find((a) => a.patientId === julian.id && a.clinician === 'Dr. Priya Patel')!;

    // 1. Clinic-wide prompt without 'my' refuses rather than falling through to Admin daily briefing
    const briefingRes = await fetch(`${baseUrl}/api/assistant/query`, {
      method: 'POST',
      headers: doctorHeaders,
      body: JSON.stringify({ prompt: "Give me today's clinic briefing." }),
    });
    assert.equal(briefingRes.status, 200);
    const briefingJson = (await briefingRes.json()) as { data: { intent: string; headline: string } };
    assert.equal(briefingJson.data.intent, 'non_clinical_refusal');
    assert.equal(briefingJson.data.headline, 'Doctor Scope Only');

    // 2. Streaming endpoint enforces same Doctor refusal
    const streamRes = await fetch(`${baseUrl}/api/assistant/stream`, {
      method: 'POST',
      headers: doctorHeaders,
      body: JSON.stringify({ prompt: 'Which doctors are available today?' }),
    });
    assert.equal(streamRes.status, 200);
    const streamText = await streamRes.text();
    assert.ok(streamText.includes('Doctor Scope Only'));

    // 3. Other doctor's patient lookup & reschedule are blocked without returning data or confirmation
    const otherLookup = await fetch(`${baseUrl}/api/assistant/query`, {
      method: 'POST',
      headers: doctorHeaders,
      body: JSON.stringify({ prompt: `Show patient ${arthur.id}` }),
    });
    assert.equal(otherLookup.status, 200);
    const otherLookupJson = (await otherLookup.json()) as {
      data: { intent: string; headline: string; pendingConfirmation?: unknown };
    };
    assert.equal(otherLookupJson.data.intent, 'non_clinical_refusal');
    assert.equal(otherLookupJson.data.pendingConfirmation, undefined);

    const otherResched = await fetch(`${baseUrl}/api/assistant/query`, {
      method: 'POST',
      headers: doctorHeaders,
      body: JSON.stringify({ prompt: `Reschedule patient ${arthur.id}` }),
    });
    assert.equal(otherResched.status, 200);
    const otherReschedJson = (await otherResched.json()) as {
      data: { intent: string; headline: string; pendingConfirmation?: unknown };
    };
    assert.equal(otherReschedJson.data.intent, 'non_clinical_refusal');
    assert.equal(otherReschedJson.data.pendingConfirmation, undefined);

    // 4. Forged /api/assistant/confirm against another doctor's appointment returns 403 and preserves appointment
    const forgedConfirm = await fetch(`${baseUrl}/api/assistant/confirm`, {
      method: 'POST',
      headers: doctorHeaders,
      body: JSON.stringify({
        actionType: 'reschedule_appointment',
        payload: {
          appointmentId: okaforArthurApt.id,
          appointmentDate: getClinicTodayDate(),
          appointmentTime: '16:00',
        },
      }),
    });
    assert.equal(forgedConfirm.status, 403);

    // 5. Doctor's own assigned patient reschedule proposes & confirms cleanly
    const ownResched = await fetch(`${baseUrl}/api/assistant/query`, {
      method: 'POST',
      headers: doctorHeaders,
      body: JSON.stringify({ prompt: `Reschedule patient ${julian.id}` }),
    });
    assert.equal(ownResched.status, 200);
    const ownReschedJson = (await ownResched.json()) as {
      data: {
        intent: string;
        pendingConfirmation?: {
          actionType: string;
          payload: { appointmentId: string; appointmentDate: string; appointmentTime: string };
        };
      };
    };
    assert.equal(ownReschedJson.data.intent, 'reschedule_patient');
    assert.equal(ownReschedJson.data.pendingConfirmation?.payload.appointmentId, patelJulianApt.id);

    const validConfirm = await fetch(`${baseUrl}/api/assistant/confirm`, {
      method: 'POST',
      headers: doctorHeaders,
      body: JSON.stringify({
        actionType: ownReschedJson.data.pendingConfirmation!.actionType,
        payload: ownReschedJson.data.pendingConfirmation!.payload,
      }),
    });
    assert.equal(validConfirm.status, 200);
  });
});

test('Correction 1A: ambiguous unlinked/legacy clinician names fail closed while unique legacy and linked identities remain intact', async () => {
  await withTestServer(async (baseUrl, db) => {
    const today = getClinicTodayDate();
    const nowIso = new Date().toISOString();

    // 1. Admin onboards Clinic A (no sample seed data) and invites Dr. Priya Patel & a second clinician
    await syncUser(baseUrl, 'token-admin-a');
    const onboardRes = await fetch(`${baseUrl}/api/clinics/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-admin-a' },
      body: JSON.stringify({
        clinicName: 'Legacy Identity Hardening Clinic',
        clinicType: 'Multi-Specialty Outpatient Clinic',
        contactPhone: '+1-555-0210',
        contactEmail: 'ops@legacyclinic.org',
        location: 'Denver, CO',
        seedSampleData: false,
      }),
    });
    assert.equal(onboardRes.status, 201);
    const clinicId = ((await onboardRes.json()) as { data: { activeClinic: { id: string } } }).data.activeClinic.id;

    // Also create Clinic B to confirm cross-clinic tenancy stays isolated
    await syncUser(baseUrl, 'token-admin-b');
    const onboardB = await fetch(`${baseUrl}/api/clinics/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-admin-b' },
      body: JSON.stringify({
        clinicName: 'Tenant B Clinic',
        clinicType: 'Outpatient Clinic',
        contactPhone: '+1-555-0299',
        contactEmail: 'ops@tenantb.org',
        location: 'Miami, FL',
        seedSampleData: false,
      }),
    });
    assert.equal(onboardB.status, 201);
    const clinicBId = ((await onboardB.json()) as { data: { activeClinic: { id: string } } }).data.activeClinic.id;

    for (const invite of [
      { email: 'doctor@alphahealth.org', fullName: 'Dr. Priya Patel', role: 'Doctor' },
      { email: 'dr.nadia@alphahealth.org', fullName: 'Dr. Elena Rostova', role: 'Doctor' },
    ]) {
      const invRes = await fetch(`${baseUrl}/api/clinic/members/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-admin-a',
          'X-Clinic-Id': clinicId,
        },
        body: JSON.stringify(invite),
      });
      assert.equal(invRes.status, 201);
    }

    const patelSync = await syncUser(baseUrl, 'token-doctor-a');
    assert.equal(patelSync.status, 200);
    const patelSession = (await patelSync.json()) as {
      data: { linkedStaff: { id: string; fullName: string } | null };
    };
    const patelLinkedStaffId = patelSession.data.linkedStaff!.id;

    const rostovaSync = await syncUser(baseUrl, 'token-candidate-doc', { fullName: 'Dr. Elena Rostova' });
    assert.equal(rostovaSync.status, 200);
    const rostovaSession = (await rostovaSync.json()) as {
      data: { linkedStaff: { id: string; fullName: string } | null };
    };
    const rostovaLinkedStaffId = rostovaSession.data.linkedStaff!.id;

    // Seed TWO distinct unlinked Clinician rows with identical lowercase name "dr. priya patel"
    db.prepare(`
      INSERT INTO staff (
        id, clinic_id, user_id, full_name, role, department, specialty, email, contact_number,
        status, attendance_status, default_appointment_duration, max_daily_capacity, verification_status, created_at, updated_at
      ) VALUES
        ('STF-AMB-1', ?, NULL, 'Dr. Priya Patel', 'Clinician', 'General Medicine', 'Primary Care', 'priya1@legacy.org', '+1-555-1001', 'Active', 'On Duty', 30, 16, 'Approved', ?, ?),
        ('STF-AMB-2', ?, NULL, 'dr. priya patel', 'Clinician', 'Cardiology', 'Preventive', 'priya2@legacy.org', '+1-555-1002', 'Active', 'On Duty', 30, 16, 'Approved', ?, ?),
        ('STF-LEG-UNIQ', ?, NULL, 'dr. elena rostova', 'Clinician', 'Neurology', 'Neurology', 'elena.legacy@legacy.org', '+1-555-1003', 'Active', 'On Duty', 30, 16, 'Approved', ?, ?)
    `).run(clinicId, nowIso, nowIso, clinicId, nowIso, nowIso, clinicId, nowIso, nowIso);

    // Register 6 patients in Clinic A via Admin
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-admin-a',
      'X-Clinic-Id': clinicId,
    };
    async function createPt(fullName: string, email: string): Promise<string> {
      const r = await fetch(`${baseUrl}/api/patients`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          fullName,
          dateOfBirth: '1986-05-10',
          contactNumber: '+1-555-0300',
          email,
        }),
      });
      assert.equal(r.status, 201);
      return ((await r.json()) as { data: { id: string } }).data.id;
    }

    const ptPatelOwn = await createPt('Patel Linked Patient', 'pt.own@example.org');
    const ptAmb1 = await createPt('Ambiguous Legacy One', 'pt.amb1@example.org');
    const ptAmb2 = await createPt('Ambiguous Legacy Two', 'pt.amb2@example.org');
    const ptAmbNull = await createPt('Ambiguous Null Staff', 'pt.ambnull@example.org');
    const ptRostovaLegacy = await createPt('Rostova Unique Legacy', 'pt.rosleg@example.org');
    const ptRostovaNull = await createPt('Rostova Null Staff', 'pt.rosnull@example.org');

    // Link patient portal account for ptPatelOwn via verified claim code to verify Patient isolation stays intact
    const portalUserSync = await syncUser(baseUrl, 'token-patient-one');
    assert.equal(portalUserSync.status, 200);
    const ptUserRow = db
      .prepare('SELECT id FROM users WHERE firebase_uid = ?')
      .get('fb-patient-one') as { id: string };
    db.prepare('UPDATE patients SET linked_user_id = ?, portal_linked_at = ? WHERE id = ? AND clinic_id = ?')
      .run(ptUserRow.id, nowIso, ptPatelOwn, clinicId);
    db.prepare(`
      INSERT INTO clinic_memberships (id, clinic_id, user_id, role, status, created_at, updated_at)
      VALUES ('MBR-PT-LEG', ?, ?, 'Patient', 'Active', ?, ?)
    `).run(clinicId, ptUserRow.id, nowIso, nowIso);

    // Insert appointments, consultations, follow-ups, and an audit log for each identity
    db.prepare(`
      INSERT INTO appointments (
        id, clinic_id, patient_id, staff_id, appointment_date, appointment_time, duration_minutes,
        department, specialty, appointment_type, clinician, status, requested_by, request_status, request_notes, notes, created_at, updated_at
      ) VALUES
        ('APT-OWN-1', ?, ?, ?, ?, '09:00', 30, 'General Medicine', 'General Medicine', 'Consultation', 'Dr. Priya Patel', 'Confirmed', 'staff', 'None', '', 'Linked own visit', ?, ?),
        ('APT-AMB-1', ?, ?, 'STF-AMB-1', ?, '09:30', 30, 'General Medicine', 'Primary Care', 'Consultation', 'Dr. Priya Patel', 'Scheduled', 'staff', 'None', '', 'Unlinked doctor 1 visit', ?, ?),
        ('APT-AMB-2', ?, ?, 'STF-AMB-2', ?, '10:00', 30, 'Cardiology', 'Preventive', 'Consultation', 'dr. priya patel', 'Confirmed', 'staff', 'None', '', 'Unlinked doctor 2 visit', ?, ?),
        ('APT-AMB-NULL', ?, ?, NULL, ?, '10:30', 30, 'General Medicine', 'General Medicine', 'Consultation', 'Dr. Priya Patel', 'Missed', 'staff', 'None', '', 'Ambiguous null staff_id visit', ?, ?),
        ('APT-LEG-1', ?, ?, 'STF-LEG-UNIQ', ?, '11:00', 30, 'Neurology', 'Neurology', 'Consultation', 'dr. elena rostova', 'Confirmed', 'staff', 'None', '', 'Unique legacy staff visit', ?, ?),
        ('APT-LEG-NULL', ?, ?, NULL, ?, '11:30', 30, 'Neurology', 'Neurology', 'Consultation', 'Dr. Elena Rostova', 'Scheduled', 'staff', 'None', '', 'Unique legacy null staff_id visit', ?, ?)
    `).run(
      clinicId, ptPatelOwn, patelLinkedStaffId, today, nowIso, nowIso,
      clinicId, ptAmb1, today, nowIso, nowIso,
      clinicId, ptAmb2, today, nowIso, nowIso,
      clinicId, ptAmbNull, today, nowIso, nowIso,
      clinicId, ptRostovaLegacy, today, nowIso, nowIso,
      clinicId, ptRostovaNull, today, nowIso, nowIso
    );

    db.prepare(`
      INSERT INTO consultations (
        id, clinic_id, appointment_id, patient_id, staff_id, doctor_name, consultation_date,
        summary, diagnosis_notes, recommendations, prescriptions_json, test_results_json, patient_visible, created_at, updated_at
      ) VALUES
        ('CON-OWN-1', ?, 'APT-OWN-1', ?, ?, 'Dr. Priya Patel', ?, 'Linked own consultation.', '', '', '[]', '[]', 1, ?, ?),
        ('CON-AMB-1', ?, 'APT-AMB-1', ?, 'STF-AMB-1', 'Dr. Priya Patel', ?, 'Ambiguous clinician 1 note.', '', '', '[]', '[]', 1, ?, ?),
        ('CON-AMB-NULL', ?, 'APT-AMB-NULL', ?, NULL, 'Dr. Priya Patel', ?, 'Ambiguous null-staff note.', '', '', '[]', '[]', 1, ?, ?),
        ('CON-LEG-1', ?, 'APT-LEG-1', ?, 'STF-LEG-UNIQ', 'dr. elena rostova', ?, 'Unique legacy consultation.', '', '', '[]', '[]', 1, ?, ?),
        ('CON-LEG-NULL', ?, 'APT-LEG-NULL', ?, NULL, 'Dr. Elena Rostova', ?, 'Unique null-staff consultation.', '', '', '[]', '[]', 1, ?, ?)
    `).run(
      clinicId, ptPatelOwn, patelLinkedStaffId, today, nowIso, nowIso,
      clinicId, ptAmb1, today, nowIso, nowIso,
      clinicId, ptAmbNull, today, nowIso, nowIso,
      clinicId, ptRostovaLegacy, today, nowIso, nowIso,
      clinicId, ptRostovaNull, today, nowIso, nowIso
    );

    db.prepare(`
      INSERT INTO followups (
        id, clinic_id, patient_id, appointment_id, followup_type, assigned_staff_id, assigned_to_name,
        description, reason, priority, created_date, due_date, status,
        completed_at, completed_by, completion_notes, created_at, updated_at
      ) VALUES
        ('FU-OWN-1', ?, ?, 'APT-OWN-1', 'Clinical Recommendation', ?, 'Dr. Priya Patel', 'Linked own follow-up', 'Own check', 'Medium', ?, ?, 'Pending', NULL, '', '', ?, ?),
        ('FU-AMB-1', ?, ?, 'APT-AMB-1', 'Clinical Recommendation', 'STF-AMB-1', 'Dr. Priya Patel', 'Ambiguous 1 follow-up', 'Amb 1', 'High', ?, ?, 'Pending', NULL, '', '', ?, ?),
        ('FU-AMB-2', ?, ?, 'APT-AMB-2', 'Clinical Recommendation', 'STF-AMB-2', 'dr. priya patel', 'Ambiguous 2 follow-up', 'Amb 2', 'High', ?, ?, 'Pending', NULL, '', '', ?, ?),
        ('FU-AMB-NULL', ?, ?, 'APT-AMB-NULL', 'Clinical Recommendation', NULL, 'Dr. Priya Patel', 'Ambiguous null follow-up', 'Amb null', 'High', ?, ?, 'Pending', NULL, '', '', ?, ?),
        ('FU-LEG-1', ?, ?, 'APT-LEG-1', 'Clinical Recommendation', 'STF-LEG-UNIQ', 'dr. elena rostova', 'Unique legacy follow-up', 'Legacy 1', 'Medium', ?, ?, 'Pending', NULL, '', '', ?, ?),
        ('FU-LEG-NULL', ?, ?, 'APT-LEG-NULL', 'Clinical Recommendation', NULL, 'Dr. Elena Rostova', 'Unique legacy null follow-up', 'Legacy null', 'Low', ?, ?, 'Pending', NULL, '', '', ?, ?)
    `).run(
      clinicId, ptPatelOwn, patelLinkedStaffId, today, today, nowIso, nowIso,
      clinicId, ptAmb1, today, today, nowIso, nowIso,
      clinicId, ptAmb2, today, today, nowIso, nowIso,
      clinicId, ptAmbNull, today, today, nowIso, nowIso,
      clinicId, ptRostovaLegacy, today, today, nowIso, nowIso,
      clinicId, ptRostovaNull, today, today, nowIso, nowIso
    );

    // Insert an audit log authored by the ambiguous unlinked clinician name on an unrelated appointment
    db.prepare(`
      INSERT INTO audit_logs (clinic_id, actor, action, resource_type, resource_id, summary, created_at)
      VALUES (?, 'Dr. Priya Patel (Legacy)', 'UPDATE_APPOINTMENT', 'appointment', 'APT-AMB-1', 'Ambiguous clinician audit entry', ?)
    `).run(clinicId, nowIso);

    const patelHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-doctor-a',
      'X-Clinic-Id': clinicId,
    };
    const rostovaHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-candidate-doc',
      'X-Clinic-Id': clinicId,
    };

    // A. Ambiguous identity ("Dr. Priya Patel" with 2 unlinked rows) MUST fail closed while keeping linked access intact
    const patelPts = ((await (await fetch(`${baseUrl}/api/patients`, { headers: patelHeaders })).json()) as {
      data: Array<{ id: string }>;
    }).data.map((p) => p.id);
    assert.deepEqual(patelPts, [ptPatelOwn]);

    assert.equal((await fetch(`${baseUrl}/api/patients/${ptPatelOwn}`, { headers: patelHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/patients/${ptAmb1}`, { headers: patelHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/patients/${ptAmb2}`, { headers: patelHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/patients/${ptAmbNull}`, { headers: patelHeaders })).status, 403);

    const patelApts = ((await (await fetch(`${baseUrl}/api/appointments`, { headers: patelHeaders })).json()) as {
      data: Array<{ id: string }>;
    }).data.map((a) => a.id);
    assert.deepEqual(patelApts, ['APT-OWN-1']);

    assert.equal((await fetch(`${baseUrl}/api/appointments/APT-OWN-1`, { headers: patelHeaders })).status, 200);
    for (const blockedAptId of ['APT-AMB-1', 'APT-AMB-2', 'APT-AMB-NULL']) {
      assert.equal((await fetch(`${baseUrl}/api/appointments/${blockedAptId}`, { headers: patelHeaders })).status, 403);
      assert.equal(
        (
          await fetch(`${baseUrl}/api/appointments/${blockedAptId}`, {
            method: 'PATCH',
            headers: patelHeaders,
            body: JSON.stringify({ status: 'Cancelled' }),
          })
        ).status,
        403
      );
    }

    const patelFus = ((await (await fetch(`${baseUrl}/api/followups`, { headers: patelHeaders })).json()) as {
      data: Array<{ id: string }>;
    }).data.map((f) => f.id);
    assert.deepEqual(patelFus, ['FU-OWN-1']);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/followups/FU-AMB-1`, {
          method: 'PATCH',
          headers: patelHeaders,
          body: JSON.stringify({ status: 'Completed' }),
        })
      ).status,
      403
    );

    const patelCons = ((await (await fetch(`${baseUrl}/api/doctor/consultations`, { headers: patelHeaders })).json()) as {
      data: Array<{ id: string }>;
    }).data.map((c) => c.id);
    assert.deepEqual(patelCons, ['CON-OWN-1']);

    assert.equal(
      (
        await fetch(`${baseUrl}/api/consultations`, {
          method: 'POST',
          headers: patelHeaders,
          body: JSON.stringify({
            appointmentId: 'APT-AMB-1',
            patientId: ptAmb1,
            summary: 'Should not document ambiguous clinician visit.',
          }),
        })
      ).status,
      403
    );

    // GET /api/staff/:ownId, /api/doctor/activity, and /api/doctor/dashboard must NOT leak ambiguous clinicians' appointments or audit logs
    const ownStaffRes = await fetch(`${baseUrl}/api/staff/${patelLinkedStaffId}`, { headers: patelHeaders });
    assert.equal(ownStaffRes.status, 200);
    const ownStaffJson = (await ownStaffRes.json()) as { data: { appointments: Array<{ id: string }> } };
    assert.deepEqual(ownStaffJson.data.appointments.map((a) => a.id), ['APT-OWN-1']);

    const actRes = await fetch(`${baseUrl}/api/doctor/activity`, { headers: patelHeaders });
    assert.equal(actRes.status, 200);
    const actLogs = ((await actRes.json()) as { data: Array<{ resourceId: string; summary: string }> }).data;
    assert.equal(actLogs.some((l) => l.resourceId === 'APT-AMB-1'), false);

    // Direct targeting of ambiguous unlinked staff rows fails closed (403)
    assert.equal((await fetch(`${baseUrl}/api/staff/STF-AMB-1`, { headers: patelHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/staff/STF-AMB-2`, { headers: patelHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/doctors/STF-AMB-1/schedule`, { headers: patelHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/doctors/STF-AMB-2/unavailability`, { headers: patelHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/appointments?staffId=STF-AMB-1`, { headers: patelHeaders })).status, 403);

    // Doctor Copilot refuses ambiguous legacy patient lookup & forged confirm
    const copilotAmbRes = await fetch(`${baseUrl}/api/assistant/query`, {
      method: 'POST',
      headers: patelHeaders,
      body: JSON.stringify({ prompt: `Show patient ${ptAmb1}` }),
    });
    assert.equal(copilotAmbRes.status, 200);
    const copilotAmbJson = (await copilotAmbRes.json()) as { data: { intent: string; headline: string } };
    assert.equal(copilotAmbJson.data.intent, 'non_clinical_refusal');
    assert.equal(copilotAmbJson.data.headline, 'Doctor Scope Only');

    assert.equal(
      (
        await fetch(`${baseUrl}/api/assistant/confirm`, {
          method: 'POST',
          headers: patelHeaders,
          body: JSON.stringify({
            actionType: 'reschedule_appointment',
            payload: { appointmentId: 'APT-AMB-1', appointmentDate: today, appointmentTime: '16:00' },
          }),
        })
      ).status,
      403
    );

    // B. Uniquely identifiable legacy clinician ("Dr. Elena Rostova") preserves valid access safely
    const rostovaPts = ((await (await fetch(`${baseUrl}/api/patients`, { headers: rostovaHeaders })).json()) as {
      data: Array<{ id: string }>;
    }).data.map((p) => p.id);
    assert.ok(rostovaPts.includes(ptRostovaLegacy));
    assert.ok(rostovaPts.includes(ptRostovaNull));
    assert.equal(rostovaPts.includes(ptPatelOwn), false);
    assert.equal(rostovaPts.includes(ptAmb1), false);

    assert.equal((await fetch(`${baseUrl}/api/patients/${ptRostovaLegacy}`, { headers: rostovaHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/patients/${ptRostovaNull}`, { headers: rostovaHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/patients/${ptPatelOwn}`, { headers: rostovaHeaders })).status, 403);

    const rostovaApts = ((await (await fetch(`${baseUrl}/api/appointments`, { headers: rostovaHeaders })).json()) as {
      data: Array<{ id: string }>;
    }).data.map((a) => a.id);
    assert.ok(rostovaApts.includes('APT-LEG-1'));
    assert.ok(rostovaApts.includes('APT-LEG-NULL'));
    assert.equal(rostovaApts.includes('APT-OWN-1'), false);

    const rostovaFus = ((await (await fetch(`${baseUrl}/api/followups`, { headers: rostovaHeaders })).json()) as {
      data: Array<{ id: string }>;
    }).data.map((f) => f.id);
    assert.ok(rostovaFus.includes('FU-LEG-1'));
    assert.ok(rostovaFus.includes('FU-LEG-NULL'));

    const rostovaCons = ((await (await fetch(`${baseUrl}/api/doctor/consultations`, { headers: rostovaHeaders })).json()) as {
      data: Array<{ id: string }>;
    }).data.map((c) => c.id);
    assert.ok(rostovaCons.includes('CON-LEG-1'));
    assert.ok(rostovaCons.includes('CON-LEG-NULL'));

    assert.equal((await fetch(`${baseUrl}/api/staff/STF-LEG-UNIQ`, { headers: rostovaHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/doctors/STF-LEG-UNIQ/schedule`, { headers: rostovaHeaders })).status, 200);

    // If a second linked clinician with the same name appears, legacy resolution immediately fails closed
    db.prepare(`
      INSERT INTO staff (
        id, clinic_id, user_id, full_name, role, department, specialty, email, contact_number,
        status, attendance_status, default_appointment_duration, max_daily_capacity, verification_status, created_at, updated_at
      ) VALUES ('STF-ROS-OTHER', ?, 'USR-OTHER-LINKED', 'Dr. Elena Rostova', 'Clinician', 'Neurology', 'Neurology', 'elena2@clinic.org', '+1-555-1009', 'Active', 'On Duty', 30, 16, 'Approved', ?, ?)
    `).run(clinicId, nowIso, nowIso);
    assert.equal((await fetch(`${baseUrl}/api/patients/${ptRostovaLegacy}`, { headers: rostovaHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/patients/${ptRostovaNull}`, { headers: rostovaHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/staff/STF-LEG-UNIQ`, { headers: rostovaHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/staff/${rostovaLinkedStaffId}`, { headers: rostovaHeaders })).status, 200);

    // C. Admin, Patient, and Clinic Tenancy boundaries remain intact
    const adminPts = ((await (await fetch(`${baseUrl}/api/patients`, { headers: adminHeaders })).json()) as {
      data: Array<{ id: string }>;
    }).data;
    assert.equal(adminPts.length, 6);
    assert.equal((await fetch(`${baseUrl}/api/reports/overview`, { headers: adminHeaders })).status, 200);

    const ptHeaders = { Authorization: 'Bearer token-patient-one', 'X-Clinic-Id': clinicId };
    assert.equal((await fetch(`${baseUrl}/api/patient-portal/health`, { headers: ptHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/patients`, { headers: ptHeaders })).status, 403);

    assert.equal(
      (await fetch(`${baseUrl}/api/patients`, { headers: { Authorization: 'Bearer token-doctor-a', 'X-Clinic-Id': clinicBId } })).status,
      403
    );
  });
});



