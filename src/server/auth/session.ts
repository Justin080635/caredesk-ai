import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AccountRole,
  AuthUserProfile,
  ClinicMembership,
  ClinicWorkspace,
  RolePermissions,
} from '../../shared/types';
import {
  resolveLinkedPatientIdForUser,
  resolveLinkedStaffIdForUser,
  resolveUserClinicMembership,
  syncAuthenticatedUser,
} from '../services/accountService';

export interface VerifiedFirebaseIdentity {
  uid: string;
  email: string;
  name?: string;
  picture?: string;
  provider?: string;
  emailVerified?: boolean;
}

export type TokenVerifier = (idToken: string) => Promise<VerifiedFirebaseIdentity | null>;

export interface FirebasePublicConfig {
  projectId: string | null;
  configured: boolean;
}

let cachedAdminApp: App | null = null;
let cachedFirebaseConfig: { projectId: string | null; apiKey: string | null } | undefined;

function readFirebaseConfigFile(): { projectId: string | null; apiKey: string | null } {
  if (cachedFirebaseConfig !== undefined) {
    return cachedFirebaseConfig;
  }

  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        projectId?: string;
        apiKey?: string;
      };
      const pid = parsed.projectId?.trim();
      const apiKey = parsed.apiKey?.trim();
      if (pid && pid !== 'remixed-project-id') {
        cachedFirebaseConfig = {
          projectId: pid,
          apiKey: apiKey || null,
        };
        return cachedFirebaseConfig;
      }
    }
  } catch {
    // Ignore malformed config file and fall back cleanly
  }

  cachedFirebaseConfig = { projectId: null, apiKey: null };
  return cachedFirebaseConfig;
}

export function getFirebasePublicConfig(): FirebasePublicConfig {
  const { projectId } = readFirebaseConfigFile();
  return {
    projectId,
    configured: Boolean(projectId),
  };
}

export function getFirebaseWebApiKey(): string | null {
  return readFirebaseConfigFile().apiKey;
}

function getFirebaseAdminApp(): App | null {
  if (cachedAdminApp) return cachedAdminApp;
  const { projectId } = getFirebasePublicConfig();
  if (!projectId) return null;

  cachedAdminApp = getApps().length > 0 ? getApp() : initializeApp({ projectId });
  return cachedAdminApp;
}

export async function verifyFirebaseIdToken(
  token: string
): Promise<VerifiedFirebaseIdentity | null> {
  const adminApp = getFirebaseAdminApp();
  if (!adminApp || !token) return null;

  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token);
    if (!decoded.uid) return null;
    const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
    return {
      uid: decoded.uid,
      email,
      name: typeof decoded.name === 'string' ? decoded.name : undefined,
      picture: typeof decoded.picture === 'string' ? decoded.picture : undefined,
      provider:
        typeof decoded.firebase?.sign_in_provider === 'string'
          ? decoded.firebase.sign_in_provider
          : undefined,
      emailVerified: Boolean(decoded.email_verified),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Option 3: Signed Sandbox Demo Auth (Strictly Non-Production / Opt-In)
// ---------------------------------------------------------------------------

export type DemoPersonaKey = 'administrator' | 'doctor' | 'patient';

export interface DemoPersonaSpec {
  key: DemoPersonaKey;
  uid: string;
  email: string;
  name: string;
  role: AccountRole;
  linkedPatientId?: string;
}

export const DEMO_PERSONAS: Record<DemoPersonaKey, DemoPersonaSpec> = {
  administrator: {
    key: 'administrator',
    uid: 'demo-sandbox-admin',
    email: 'demo.admin@caredesk.example.org',
    name: 'Dr. Maya Lin',
    role: 'Clinic Administrator',
  },
  doctor: {
    key: 'doctor',
    uid: 'demo-sandbox-doctor',
    email: 'samuel.okafor@caredesk.example.org',
    name: 'Dr. Samuel Okafor',
    role: 'Doctor',
  },
  patient: {
    key: 'patient',
    uid: 'demo-sandbox-patient',
    email: 'eleanor.vance@example.org',
    name: 'Eleanor Vance',
    role: 'Patient',
    linkedPatientId: 'P-1025',
  },
};

const DEMO_SIGNING_SECRET =
  process.env.CAREDESK_DEMO_SIGNING_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

export function isDemoAuthEnabled(): boolean {
  const flag = process.env.CAREDESK_ENABLE_DEMO_AUTH?.trim().toLowerCase();
  if (flag === 'false' || flag === '0') return false;
  if (flag === 'true' || flag === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

export function createDemoSessionToken(persona: DemoPersonaKey): {
  token: string;
  expiresIn: number;
  identity: VerifiedFirebaseIdentity;
} {
  const spec = DEMO_PERSONAS[persona];
  const expiresIn = 8 * 60 * 60; // 8 hours
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const payloadObj = {
    persona: spec.key,
    uid: spec.uid,
    email: spec.email,
    name: spec.name,
    exp,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sigB64 = crypto
    .createHmac('sha256', DEMO_SIGNING_SECRET)
    .update(payloadB64)
    .digest('base64url');

  return {
    token: `cd_demo.${payloadB64}.${sigB64}`,
    expiresIn,
    identity: {
      uid: spec.uid,
      email: spec.email,
      name: spec.name,
      provider: 'demo-sandbox',
      emailVerified: true,
    },
  };
}

export function verifyDemoSessionToken(token: string): VerifiedFirebaseIdentity | null {
  if (!isDemoAuthEnabled() || !token.startsWith('cd_demo.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSigB64 = crypto
    .createHmac('sha256', DEMO_SIGNING_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const actualBuf = Buffer.from(sigB64, 'utf8');
  const expectedBuf = Buffer.from(expectedSigB64, 'utf8');
  if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      persona?: DemoPersonaKey;
      uid?: string;
      email?: string;
      name?: string;
      exp?: number;
    };
    if (!parsed.persona || !(parsed.persona in DEMO_PERSONAS)) return null;
    if (typeof parsed.exp !== 'number' || parsed.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    const spec = DEMO_PERSONAS[parsed.persona];
    return {
      uid: spec.uid,
      email: spec.email,
      name: spec.name,
      provider: 'demo-sandbox',
      emailVerified: true,
    };
  } catch {
    return null;
  }
}

export async function verifySessionToken(
  token: string
): Promise<VerifiedFirebaseIdentity | null> {
  if (!token) return null;
  if (token.startsWith('cd_demo.')) {
    return verifyDemoSessionToken(token);
  }
  return verifyFirebaseIdToken(token);
}

// ---------------------------------------------------------------------------
// Option 1: Same-Origin Firebase Identity Toolkit Proxy Helpers
// ---------------------------------------------------------------------------

export class FirebaseProxyError extends Error {
  statusCode: number;
  firebaseCode: string;

  constructor(statusCode: number, firebaseCode: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.firebaseCode = firebaseCode;
  }
}

const IDENTITY_REST_ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  INVALID_LOGIN_CREDENTIALS: {
    status: 401,
    code: 'auth/invalid-credential',
    message: 'Incorrect email address or password.',
  },
  INVALID_PASSWORD: {
    status: 401,
    code: 'auth/invalid-credential',
    message: 'Incorrect email address or password.',
  },
  EMAIL_NOT_FOUND: {
    status: 401,
    code: 'auth/user-not-found',
    message: 'No account matches this email address.',
  },
  EMAIL_EXISTS: {
    status: 409,
    code: 'auth/email-already-in-use',
    message: 'An account with this email address already exists.',
  },
  INVALID_EMAIL: {
    status: 400,
    code: 'auth/invalid-email',
    message: 'Please enter a valid email address.',
  },
  WEAK_PASSWORD: {
    status: 400,
    code: 'auth/weak-password',
    message: 'Password must be at least 6 characters.',
  },
  OPERATION_NOT_ALLOWED: {
    status: 403,
    code: 'auth/operation-not-allowed',
    message: 'Email/password sign-in is not enabled in Firebase Authentication.',
  },
  TOO_MANY_ATTEMPTS_TRY_LATER: {
    status: 429,
    code: 'auth/too-many-requests',
    message: 'Too many authentication attempts. Please wait a few minutes and try again.',
  },
  USER_DISABLED: {
    status: 403,
    code: 'auth/user-disabled',
    message: 'This account has been disabled.',
  },
  TOKEN_EXPIRED: {
    status: 401,
    code: 'auth/id-token-expired',
    message: 'Session token expired. Please sign in again.',
  },
  INVALID_ID_TOKEN: {
    status: 401,
    code: 'auth/invalid-user-token',
    message: 'Session token is invalid. Please sign in again.',
  },
};

export async function callFirebaseIdentityEndpoint<T extends Record<string, unknown>>(
  endpoint:
    | 'accounts:signInWithPassword'
    | 'accounts:signUp'
    | 'accounts:update'
    | 'accounts:sendOobCode',
  payload: Record<string, unknown>
): Promise<T> {
  const apiKey = getFirebaseWebApiKey();
  if (!apiKey) {
    throw new FirebaseProxyError(
      503,
      'auth/configuration-not-found',
      'Firebase authentication configuration is missing on the server.'
    );
  }

  const url = `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(apiKey)}`;
  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FirebaseProxyError(
      502,
      'auth/network-request-failed',
      'Could not reach Firebase Authentication service from the server. Please try again.'
    );
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { message?: string };
  };

  if (!response.ok) {
    const rawMsg = String(data.error?.message ?? 'UNKNOWN_ERROR');
    const baseCode = rawMsg.split(':')[0].trim().split(' ')[0].trim();
    const mapped = IDENTITY_REST_ERROR_MAP[baseCode];
    if (mapped) {
      throw new FirebaseProxyError(mapped.status, mapped.code, mapped.message);
    }
    throw new FirebaseProxyError(400, `auth/${baseCode.toLowerCase().replace(/_/g, '-')}`, rawMsg);
  }

  return data as T;
}

export async function callFirebaseSecureTokenRefresh(refreshToken: string): Promise<{
  idToken: string;
  refreshToken: string;
  expiresIn: number;
  uid: string;
}> {
  const apiKey = getFirebaseWebApiKey();
  if (!apiKey) {
    throw new FirebaseProxyError(
      503,
      'auth/configuration-not-found',
      'Firebase authentication configuration is missing on the server.'
    );
  }

  const url = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FirebaseProxyError(
      502,
      'auth/network-request-failed',
      'Could not refresh Firebase session cleanly. Please sign in again.'
    );
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { message?: string };
  };

  if (!response.ok || typeof data.id_token !== 'string') {
    const rawMsg = String(data.error?.message ?? 'INVALID_REFRESH_TOKEN');
    throw new FirebaseProxyError(401, 'auth/invalid-user-token', rawMsg);
  }

  return {
    idToken: data.id_token,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken,
    expiresIn: Number(data.expires_in ?? 3600) || 3600,
    uid: String(data.user_id ?? ''),
  };
}

export function getPermissionsForRole(role: AccountRole): RolePermissions {
  switch (role) {
    case 'Clinic Administrator':
      return {
        canViewRecords: true,
        canViewClinicReports: true,
        canManagePatients: true,
        canManageAppointments: true,
        canDeleteAppointments: true,
        canManageFollowups: true,
        canManageStaff: true,
        canViewAuditHistory: true,
        canManageClinicSettings: true,
        canManageTeamRoles: true,
        canConfirmAssistantActions: true,
        canAuthorConsultations: false,
        canManageOwnSchedule: true,
        isPatientPortalOnly: false,
      };
    case 'Doctor':
      return {
        canViewRecords: true,
        canViewClinicReports: false,
        canManagePatients: false,
        canManageAppointments: true,
        canDeleteAppointments: false,
        canManageFollowups: true,
        canManageStaff: false,
        canViewAuditHistory: false,
        canManageClinicSettings: false,
        canManageTeamRoles: false,
        canConfirmAssistantActions: true,
        canAuthorConsultations: true,
        canManageOwnSchedule: true,
        isPatientPortalOnly: false,
      };
    case 'Receptionist':
      return {
        canViewRecords: true,
        canViewClinicReports: true,
        canManagePatients: true,
        canManageAppointments: true,
        canDeleteAppointments: false,
        canManageFollowups: true,
        canManageStaff: false,
        canViewAuditHistory: false,
        canManageClinicSettings: false,
        canManageTeamRoles: false,
        canConfirmAssistantActions: true,
        canAuthorConsultations: false,
        canManageOwnSchedule: false,
        isPatientPortalOnly: false,
      };
    case 'Patient':
      return {
        canViewRecords: false,
        canViewClinicReports: false,
        canManagePatients: false,
        canManageAppointments: false,
        canDeleteAppointments: false,
        canManageFollowups: false,
        canManageStaff: false,
        canViewAuditHistory: false,
        canManageClinicSettings: false,
        canManageTeamRoles: false,
        canConfirmAssistantActions: false,
        canAuthorConsultations: false,
        canManageOwnSchedule: false,
        isPatientPortalOnly: true,
      };
    case 'Clinic Staff':
    default:
      return {
        canViewRecords: true,
        canViewClinicReports: true,
        canManagePatients: false,
        canManageAppointments: false,
        canDeleteAppointments: false,
        canManageFollowups: false,
        canManageStaff: false,
        canViewAuditHistory: false,
        canManageClinicSettings: false,
        canManageTeamRoles: false,
        canConfirmAssistantActions: false,
        canAuthorConsultations: false,
        canManageOwnSchedule: false,
        isPatientPortalOnly: false,
      };
  }
}

export interface AuthenticatedClinicContext {
  user: AuthUserProfile;
  clinic: ClinicWorkspace;
  membership: ClinicMembership;
  permissions: RolePermissions;
  actorLabel: string;
  linkedStaffId: string | null;
  linkedPatientId: string | null;
}

export interface AuthenticatedRequest extends Request {
  authIdentity?: VerifiedFirebaseIdentity;
  authUser?: AuthUserProfile;
  clinicContext?: AuthenticatedClinicContext;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : null;
}

export function createAuthGuards(db: DatabaseSync, customVerifier?: TokenVerifier) {
  const verifier = customVerifier ?? verifySessionToken;

  const requireAuthenticatedUser = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Sign-in required. Please sign in to access CareDesk AI.',
        },
      });
      return;
    }

    const identity = await verifier(token);
    if (!identity) {
      res.status(401).json({
        error: {
          code: 'INVALID_SESSION',
          message: 'Your authentication session is invalid or expired. Please sign in again.',
        },
      });
      return;
    }

    req.authIdentity = identity;
    req.authUser = syncAuthenticatedUser(db, {
      firebaseUid: identity.uid,
      email: identity.email,
      fullName: identity.name,
      avatarUrl: identity.picture,
      authProvider: identity.provider,
    }).user;

    next();
  };

  const requireClinicAccess = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.authUser) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required before selecting a clinic workspace.',
        },
      });
      return;
    }

    const requestedClinicId = req.header('x-clinic-id')?.trim() || undefined;
    const resolution = resolveUserClinicMembership(db, req.authUser.id, requestedClinicId);

    if (resolution.status === 'forbidden_clinic') {
      res.status(403).json({
        error: {
          code: 'CLINIC_ACCESS_DENIED',
          message: 'You are not authorized to access records for this clinic workspace.',
        },
      });
      return;
    }

    if (resolution.status === 'needs_onboarding' || !resolution.clinic || !resolution.membership) {
      res.status(403).json({
        error: {
          code: 'CLINIC_ONBOARDING_REQUIRED',
          message: 'Complete clinic workspace onboarding or account verification before accessing operational records.',
        },
      });
      return;
    }

    const permissions = getPermissionsForRole(resolution.membership.role);
    const linkedStaffId =
      resolution.membership.role === 'Patient'
        ? null
        : resolveLinkedStaffIdForUser(db, resolution.clinic.id, req.authUser);
    const linkedPatientId =
      resolution.membership.role === 'Patient'
        ? resolveLinkedPatientIdForUser(db, resolution.clinic.id, req.authUser.id)
        : null;

    req.clinicContext = {
      user: req.authUser,
      clinic: resolution.clinic,
      membership: resolution.membership,
      permissions,
      actorLabel: `${req.authUser.fullName} (${resolution.membership.role})`,
      linkedStaffId,
      linkedPatientId,
    };

    next();
  };

  const requirePermission = (permissionKey: keyof RolePermissions) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
      const ctx = req.clinicContext;
      if (!ctx) {
        res.status(403).json({
          error: {
            code: 'CLINIC_ACCESS_DENIED',
            message: 'Clinic authorization context is missing.',
          },
        });
        return;
      }

      if (!ctx.permissions[permissionKey]) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: `Your role (${ctx.membership.role}) does not have permission for this action.`,
          },
        });
        return;
      }

      next();
    };
  };

  const requireRole = (...allowedRoles: AccountRole[]) => {
    const allowedSet = new Set(allowedRoles);
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
      const ctx = req.clinicContext;
      if (!ctx) {
        res.status(403).json({
          error: {
            code: 'CLINIC_ACCESS_DENIED',
            message: 'Clinic authorization context is missing.',
          },
        });
        return;
      }
      if (!allowedSet.has(ctx.membership.role)) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: `Access restricted to: ${allowedRoles.join(', ')}.`,
          },
        });
        return;
      }
      next();
    };
  };

  return {
    requireAuthenticatedUser,
    requireClinicAccess,
    requirePermission,
    requireRole,
  };
}
