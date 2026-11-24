export function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'CareDesk AI Operations API',
      version: '2.0.0',
      description:
        'Multi-tenant, role-protected REST API for healthcare clinic administration: Firebase-authenticated accounts, clinic onboarding, team RBAC, clinic-isolated patients, appointment scheduling & conflict checking, administrative follow-ups, and operational reporting.',
    },
    servers: [{ url: '/api', description: 'CareDesk REST API Base' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Firebase JWT',
          description: 'Firebase ID token sent via Authorization: Bearer <idToken>',
        },
      },
      parameters: {
        clinicHeader: {
          name: 'X-Clinic-Id',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: 'Target clinic workspace identifier authorized for the authenticated user',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/auth/config': {
        get: {
          summary: 'Inspect Firebase authentication readiness and supported providers (Public)',
          security: [],
          responses: { '200': { description: 'Auth provider configuration summary' } },
        },
      },
      '/auth/sync': {
        post: {
          summary: 'Sync authenticated Firebase user and resolve authorized clinic memberships',
          responses: {
            '200': { description: 'Account session state with clinic memberships and RBAC permissions' },
            '401': { description: 'Missing or invalid Firebase ID token' },
          },
        },
      },
      '/clinics/onboard': {
        post: {
          summary: 'Create an isolated clinic workspace and assign creator as Clinic Administrator',
          responses: {
            '201': { description: 'Created clinic workspace and updated session state' },
            '400': { description: 'Validation error' },
            '401': { description: 'Authentication required' },
          },
        },
      },
      '/account/profile': {
        get: {
          summary: 'Fetch authenticated user account profile, clinics, and active permissions',
          responses: { '200': { description: 'Account session state' } },
        },
        patch: {
          summary: 'Update personal administrator profile fields',
          responses: { '200': { description: 'Updated personal account profile' } },
        },
      },
      '/clinic': {
        patch: {
          summary: 'Update active clinic workspace details (Requires Clinic Administrator)',
          responses: {
            '200': { description: 'Updated clinic workspace' },
            '403': { description: 'Insufficient role permissions or unauthorized clinic' },
          },
        },
      },
      '/clinic/members': {
        get: {
          summary: 'List team memberships and pending invitations for the active clinic',
          responses: { '200': { description: 'Clinic team members and invitations' } },
        },
      },
      '/clinic/members/invite': {
        post: {
          summary: 'Invite or add a staff user to the active clinic with a specific RBAC role (Requires Clinic Administrator)',
          responses: {
            '201': { description: 'Created invitation or active membership' },
            '403': { description: 'Insufficient role permissions' },
          },
        },
      },
      '/clinic/members/{membershipId}': {
        patch: {
          summary: 'Update a clinic member RBAC role or membership status (Requires Clinic Administrator)',
          parameters: [{ name: 'membershipId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Updated clinic membership' },
            '403': { description: 'Insufficient role permissions' },
          },
        },
      },
      '/patients': {
        get: {
          summary: 'List or search clinic-isolated patient records',
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Array of patient records scoped to active clinic' } },
        },
        post: {
          summary: 'Register a new patient in the active clinic (Requires Patient Management permission)',
          responses: {
            '201': { description: 'Created patient record' },
            '400': { description: 'Validation error' },
            '401': { description: 'Authentication required' },
            '403': { description: 'Forbidden for role or clinic boundary' },
          },
        },
      },
      '/patients/{id}': {
        get: {
          summary: 'Get clinic-isolated patient details, appointments, and follow-ups',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Patient record and linked operational history' },
            '404': { description: 'Patient not found in active clinic' },
          },
        },
        patch: {
          summary: 'Edit patient contact or administrative details in active clinic',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Updated patient record' },
            '400': { description: 'Validation error' },
            '404': { description: 'Patient not found in active clinic' },
          },
        },
      },
      '/appointments': {
        get: {
          summary: 'List clinic-isolated appointments with filtering, sorting, and 10-per-page pagination',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 10 } },
            { name: 'sortBy', in: 'query', schema: { type: 'string' } },
            { name: 'sortDir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
          ],
          responses: { '200': { description: 'Clinic appointments (with pagination metadata when page/pageSize provided)' } },
        },
        post: {
          summary: 'Schedule a new appointment in active clinic with server-side conflict detection',
          responses: {
            '201': { description: 'Created appointment' },
            '409': { description: 'Scheduling conflict detected' },
          },
        },
      },
      '/appointments/today': {
        get: {
          summary: 'List appointments scheduled today for the active clinic',
          responses: { '200': { description: 'Today appointment list' } },
        },
      },
      '/appointments/missed': {
        get: {
          summary: 'List missed appointments in active clinic within lookback window',
          parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 7 } }],
          responses: { '200': { description: 'Missed appointments' } },
        },
      },
      '/appointments/unconfirmed': {
        get: {
          summary: 'List upcoming unconfirmed appointments in active clinic',
          responses: { '200': { description: 'Unconfirmed appointments' } },
        },
      },
      '/appointments/availability': {
        get: {
          summary: 'Find open conflict-free slots for the active clinic',
          parameters: [
            { name: 'startDate', in: 'query', schema: { type: 'string' } },
            { name: 'department', in: 'query', schema: { type: 'string' } },
            { name: 'clinician', in: 'query', schema: { type: 'string' } },
            { name: 'patientId', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Available 30-minute clinic slots' } },
        },
      },
      '/appointments/{id}': {
        get: {
          summary: 'Get details for a single clinic-isolated appointment',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Appointment details' } },
        },
        patch: {
          summary: 'Update appointment date, time, clinician, or status in active clinic',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Updated appointment' },
            '409': { description: 'Scheduling conflict detected' },
          },
        },
        delete: {
          summary: 'Delete an appointment record (Requires Clinic Administrator)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Deleted appointment ID' },
            '403': { description: 'Insufficient role permissions' },
            '404': { description: 'Appointment not found in active clinic' },
          },
        },
      },
      '/staff': {
        get: {
          summary: 'List clinic staff and clinicians with assignment counts for active clinic',
          responses: { '200': { description: 'Array of clinic staff members' } },
        },
      },
      '/staff/{id}': {
        get: {
          summary: 'Get dedicated staff profile, assigned appointments, responsibilities, and activity history',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Staff profile detail' } },
        },
        patch: {
          summary: 'Update staff profile fields or status (Requires Clinic Administrator)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Updated staff member' } },
        },
      },
      '/followups': {
        get: {
          summary: 'List clinic-isolated administrative follow-up tasks',
          responses: { '200': { description: 'Array of follow-up tasks' } },
        },
        post: {
          summary: 'Create an administrative follow-up task in active clinic',
          responses: { '201': { description: 'Created follow-up task' } },
        },
      },
      '/followups/pending': {
        get: {
          summary: 'List pending and in-progress follow-up tasks in active clinic',
          responses: { '200': { description: 'Pending follow-up tasks' } },
        },
      },
      '/followups/{id}': {
        patch: {
          summary: 'Update follow-up task status, priority, or due date in active clinic',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Updated follow-up task' } },
        },
      },
      '/reports/daily': {
        get: {
          summary: 'Generate live daily operational report scoped to active clinic',
          parameters: [{ name: 'date', in: 'query', schema: { type: 'string' } }],
          responses: { '200': { description: 'Daily operational metrics and lists' } },
        },
      },
      '/reports/overview': {
        get: {
          summary: 'Generate 7-day operational trends and activity scoped to active clinic',
          responses: { '200': { description: 'Operational overview report' } },
        },
      },
      '/audit-logs': {
        get: {
          summary: 'List clinic-isolated security and administrative audit logs (Requires Clinic Administrator)',
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 25 } }],
          responses: { '200': { description: 'Recent audit log entries' } },
        },
      },
      '/clinics/directory': {
        get: {
          summary: 'List clinics available for Doctor Credential Application or Patient Portal verification',
          responses: { '200': { description: 'Clinic directory entries' } },
        },
      },
      '/doctor-applications': {
        get: {
          summary: 'List doctor verification applications for active clinic (Admin only)',
          responses: { '200': { description: 'Doctor applications' } },
        },
        post: {
          summary: 'Submit doctor registration and credential application (Pending Verification)',
          responses: { '201': { description: 'Submitted pending doctor application' } },
        },
      },
      '/doctors/availability': {
        get: {
          summary: 'Query live doctor duty status, working windows, and open slots for a date',
          responses: { '200': { description: 'Doctor availability summaries' } },
        },
      },
      '/doctor/dashboard': {
        get: {
          summary: 'Doctor Portal workspace overview (Doctor or Clinic Administrator)',
          responses: { '200': { description: 'Doctor dashboard data' } },
        },
      },
      '/consultations': {
        post: {
          summary: 'Document a clinical consultation, prescriptions, test results, and optional follow-up (Doctor only)',
          responses: { '201': { description: 'Created consultation record' } },
        },
      },
      '/patient-portal/claim': {
        post: {
          summary: 'Redeem clinic claim code + date of birth to securely link a Patient Portal account',
          responses: { '200': { description: 'Verified patient portal session' } },
        },
      },
      '/patient-portal/home': {
        get: {
          summary: 'Strictly patient-isolated portal overview (Patient role only)',
          responses: { '200': { description: 'Patient home summary' } },
        },
      },
      '/patient-portal/health': {
        get: {
          summary: 'Doctor-published consultation summaries, prescriptions, and test results for linked patient',
          responses: { '200': { description: 'Patient health records' } },
        },
      },
      '/reports/explainable': {
        get: {
          summary: '4-part explainable operational analytics report with comparison window and doctor utilization',
          responses: { '200': { description: 'Explainable operational report' } },
        },
      },
      '/notifications': {
        get: {
          summary: 'List notifications scoped to active user and clinic',
          responses: { '200': { description: 'Notification items' } },
        },
      },
    },
  };
}
