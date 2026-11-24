import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createExpressApp } from '../../server';
import { createDatabase } from './db/database';
import { seedDatabaseIfEmpty } from './db/seed';
import { getClinicTodayDate } from './domain/rules';

async function withTestServer(
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const db = createDatabase(':memory:');
  seedDatabaseIfEmpty(db);
  const app = createExpressApp(db);

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
        await run(baseUrl);
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

async function getAdminToken(baseUrl: string, role: 'administrator' | 'viewer' = 'administrator'): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, actor: 'Test Runner' }),
  });
  assert.equal(res.status, 201);
  const json = (await res.json()) as { data: { token: string } };
  return json.data.token;
}

test('GET endpoints return seeded synthetic patients, appointments, followups, and reports', async () => {
  await withTestServer(async (baseUrl) => {
    const patientsRes = await fetch(`${baseUrl}/api/patients`);
    assert.equal(patientsRes.status, 200);
    const patientsJson = (await patientsRes.json()) as { data: Array<{ id: string }> };
    assert.ok(patientsJson.data.length >= 20);

    const p1042Res = await fetch(`${baseUrl}/api/patients/P-1042`);
    assert.equal(p1042Res.status, 200);
    const p1042Json = (await p1042Res.json()) as { data: { id: string; fullName: string } };
    assert.equal(p1042Json.data.id, 'P-1042');
    assert.equal(p1042Json.data.fullName, 'Julian Mercer');

    const dailyRes = await fetch(`${baseUrl}/api/reports/daily`);
    assert.equal(dailyRes.status, 200);
    const dailyJson = (await dailyRes.json()) as { data: { totalAppointments: number } };
    assert.ok(dailyJson.data.totalAppointments >= 6);

    const missedRes = await fetch(`${baseUrl}/api/appointments/missed?days=7`);
    assert.equal(missedRes.status, 200);
    const missedJson = (await missedRes.json()) as { data: Array<{ status: string }> };
    assert.ok(missedJson.data.length >= 4);
    assert.ok(missedJson.data.every((a) => a.status === 'Missed'));

    const overviewRes = await fetch(`${baseUrl}/api/reports/overview`);
    assert.equal(overviewRes.status, 200);
    const overviewJson = (await overviewRes.json()) as {
      data: {
        todayDate: string;
        todayTotalAppointments: number;
        yesterdayTotalAppointments: number;
        patientRegistrationTrend: Array<{ month: string; count: number }>;
        calendarSummary: Array<{ date: string; total: number }>;
        overdueFollowUps: Array<{ id: string; dueDate: string }>;
      };
    };
    assert.ok(overviewJson.data.todayDate);
    assert.ok(overviewJson.data.todayTotalAppointments >= 6);
    assert.ok(typeof overviewJson.data.yesterdayTotalAppointments === 'number');
    assert.ok(overviewJson.data.patientRegistrationTrend.length > 0);
    assert.ok(overviewJson.data.calendarSummary.length > 0);
    assert.ok(Array.isArray(overviewJson.data.overdueFollowUps));

    const docsRes = await fetch(`${baseUrl}/api/docs`);
    assert.equal(docsRes.status, 200);
    const docsJson = (await docsRes.json()) as { openapi: string; paths: Record<string, unknown> };
    assert.equal(docsJson.openapi, '3.0.3');
    assert.ok(docsJson.paths['/patients']);
  });
});

test('Protected mutations require administrator Bearer token and block viewer sessions', async () => {
  await withTestServer(async (baseUrl) => {
    const unauthRes = await fetch(`${baseUrl}/api/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Unauthorized Patient',
        dateOfBirth: '1990-01-01',
        contactNumber: '+1-555-0199',
        email: 'unauth@example.org',
      }),
    });
    assert.equal(unauthRes.status, 401);

    const viewerToken = await getAdminToken(baseUrl, 'viewer');
    const forbiddenRes = await fetch(`${baseUrl}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewerToken}`,
      },
      body: JSON.stringify({
        fullName: 'Viewer Attempt',
        dateOfBirth: '1990-01-01',
        contactNumber: '+1-555-0199',
        email: 'viewer@example.org',
      }),
    });
    assert.equal(forbiddenRes.status, 403);
  });
});

test('Patient registration, conflict-checked booking, follow-up updates, and P-1042 confirmation flow work end-to-end', async () => {
  await withTestServer(async (baseUrl) => {
    const token = await getAdminToken(baseUrl, 'administrator');
    const today = getClinicTodayDate();

    // Register patient
    const createPatientRes = await fetch(`${baseUrl}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
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

    // Attempt conflicting booking (Dr. Priya Patel already has today 08:30 APT-2025)
    const conflictRes = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        patientId: createdPatient.data.id,
        appointmentDate: today,
        appointmentTime: '08:30',
        department: 'General Medicine',
        clinician: 'Dr. Priya Patel',
      }),
    });
    assert.equal(conflictRes.status, 409);

    // Check availability and book valid slot
    const availRes = await fetch(
      `${baseUrl}/api/appointments/availability?department=General%20Medicine&limit=2`
    );
    const availJson = (await availRes.json()) as {
      data: Array<{ date: string; time: string; clinician: string; department: string }>;
    };
    assert.ok(availJson.data.length > 0);
    const slot = availJson.data[0];

    const bookRes = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        patientId: createdPatient.data.id,
        appointmentDate: slot.date,
        appointmentTime: slot.time,
        department: slot.department,
        clinician: slot.clinician,
      }),
    });
    assert.equal(bookRes.status, 201);

    // Assistant query for P-1042 returns confirmation gate without mutating DB yet
    const queryRes = await fetch(`${baseUrl}/api/assistant/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Reschedule patient P-1042 to an available appointment slot.',
      }),
    });
    assert.equal(queryRes.status, 200);
    const queryJson = (await queryRes.json()) as {
      data: {
        mode: string;
        pendingConfirmation?: {
          actionType: 'reschedule_appointment';
          payload: { appointmentId: string; appointmentDate: string; appointmentTime: string };
        };
      };
    };
    assert.equal(queryJson.data.mode, 'development-local-rest-preview');
    assert.ok(queryJson.data.pendingConfirmation);

    // Confirm reschedule
    const confirmRes = await fetch(`${baseUrl}/api/assistant/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        actionType: queryJson.data.pendingConfirmation.actionType,
        payload: queryJson.data.pendingConfirmation.payload,
      }),
    });
    assert.equal(confirmRes.status, 200);

    const updatedAptRes = await fetch(
      `${baseUrl}/api/appointments/${queryJson.data.pendingConfirmation.payload.appointmentId}`
    );
    const updatedApt = (await updatedAptRes.json()) as {
      data: { status: string; appointmentDate: string; appointmentTime: string };
    };
    assert.equal(updatedApt.data.status, 'Scheduled');
    assert.equal(
      updatedApt.data.appointmentDate,
      queryJson.data.pendingConfirmation.payload.appointmentDate
    );

    // Edit patient record (PATCH /api/patients/:id) and verify persisted
    const editPatientRes = await fetch(`${baseUrl}/api/patients/${createdPatient.data.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fullName: 'Sora Takahashi-Updated',
        contactNumber: '+1-555-0192',
        administrativeStatus: 'Pending Verification',
      }),
    });
    assert.equal(editPatientRes.status, 200);
    const verifiedPatientRes = await fetch(`${baseUrl}/api/patients/${createdPatient.data.id}`);
    const verifiedPatient = (await verifiedPatientRes.json()) as {
      data: { fullName: string; contactNumber: string; administrativeStatus: string };
    };
    assert.equal(verifiedPatient.data.fullName, 'Sora Takahashi-Updated');
    assert.equal(verifiedPatient.data.contactNumber, '+1-555-0192');
    assert.equal(verifiedPatient.data.administrativeStatus, 'Pending Verification');

    // Create, edit priority/description/dueDate, and complete follow-up task
    const createFuRes = await fetch(`${baseUrl}/api/followups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        patientId: createdPatient.data.id,
        description: 'Confirm intake paperwork before follow-up visit.',
        priority: 'Medium',
        dueDate: today,
      }),
    });
    assert.equal(createFuRes.status, 201);
    const createdFu = (await createFuRes.json()) as { data: { id: string } };

    const editFuRes = await fetch(`${baseUrl}/api/followups/${createdFu.data.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        priority: 'High',
        description: 'Urgent insurance verification before visit.',
        status: 'Completed',
      }),
    });
    assert.equal(editFuRes.status, 200);
    const completedFuRes = await fetch(`${baseUrl}/api/followups?status=Completed`);
    const completedFuJson = (await completedFuRes.json()) as {
      data: Array<{ id: string; priority: string; description: string; status: string }>;
    };
    const matchedFu = completedFuJson.data.find((t) => t.id === createdFu.data.id);
    assert.ok(matchedFu);
    assert.equal(matchedFu.priority, 'High');
    assert.equal(matchedFu.description, 'Urgent insurance verification before visit.');
    assert.equal(matchedFu.status, 'Completed');
  });
});
