export function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'CareDesk AI Operations API',
      version: '1.0.0',
      description:
        'REST API for healthcare clinic administration: patients, appointment scheduling & conflict checking, administrative follow-ups, and operational reporting. Structured for Synapse CLI scanning and future MCP tool generation.',
    },
    servers: [{ url: '/api', description: 'CareDesk REST API Base' }],
    paths: {
      '/patients': {
        get: {
          summary: 'List or search synthetic patient records',
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Array of patient records' } },
        },
        post: {
          summary: 'Register a new synthetic patient (Requires Administrator session)',
          responses: {
            '201': { description: 'Created patient record' },
            '400': { description: 'Validation error' },
            '401': { description: 'Authentication required' },
          },
        },
      },
      '/patients/{id}': {
        get: {
          summary: 'Get individual patient details, appointments, and follow-ups',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Patient record and linked operational history' },
            '404': { description: 'Patient not found' },
          },
        },
        patch: {
          summary: 'Edit synthetic patient contact or administrative details (Requires Administrator)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Updated patient record' },
            '400': { description: 'Validation error' },
            '404': { description: 'Patient not found' },
          },
        },
      },
      '/appointments': {
        get: {
          summary: 'List appointments with optional date, status, department, or patient filters',
          responses: { '200': { description: 'Array of appointments' } },
        },
        post: {
          summary: 'Schedule a new appointment with server-side conflict detection (Requires Administrator)',
          responses: {
            '201': { description: 'Created appointment' },
            '409': { description: 'Scheduling conflict detected' },
          },
        },
      },
      '/appointments/today': {
        get: {
          summary: 'List appointments scheduled for today',
          responses: { '200': { description: 'Today appointment list' } },
        },
      },
      '/appointments/missed': {
        get: {
          summary: 'List missed appointments within the lookback window (default 7 days)',
          parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 7 } }],
          responses: { '200': { description: 'Missed appointments' } },
        },
      },
      '/appointments/unconfirmed': {
        get: {
          summary: 'List upcoming appointments still in Scheduled (unconfirmed) status',
          responses: { '200': { description: 'Unconfirmed appointments' } },
        },
      },
      '/appointments/availability': {
        get: {
          summary: 'Find open conflict-free appointment slots by date, department, or clinician',
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
          summary: 'Get details for a single appointment',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Appointment details' } },
        },
        patch: {
          summary: 'Update appointment date, time, clinician, or status with conflict checking (Requires Administrator)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Updated appointment' },
            '409': { description: 'Scheduling conflict detected' },
          },
        },
      },
      '/followups': {
        get: {
          summary: 'List administrative follow-up tasks',
          responses: { '200': { description: 'Array of follow-up tasks' } },
        },
        post: {
          summary: 'Create an administrative follow-up task (Requires Administrator)',
          responses: { '201': { description: 'Created follow-up task' } },
        },
      },
      '/followups/pending': {
        get: {
          summary: 'List pending and in-progress follow-up tasks ordered by priority and due date',
          responses: { '200': { description: 'Pending follow-up tasks' } },
        },
      },
      '/followups/{id}': {
        patch: {
          summary: 'Update follow-up task status, priority, or due date (Requires Administrator)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Updated follow-up task' } },
        },
      },
      '/reports/daily': {
        get: {
          summary: 'Generate live daily operational report from clinic records',
          parameters: [{ name: 'date', in: 'query', schema: { type: 'string' } }],
          responses: { '200': { description: 'Daily operational metrics and lists' } },
        },
      },
      '/reports/overview': {
        get: {
          summary: 'Generate 7-day operational trends, missed appointment summary, and recent activity',
          responses: { '200': { description: 'Operational overview report' } },
        },
      },
    },
  };
}
