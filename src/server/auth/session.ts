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
let cachedFirebaseProjectId: string | null | undefined;

export function getFirebasePublicConfig(): FirebasePublicConfig {
  if (cachedFirebaseProjectId !== undefined) {
    return {
      projectId: cachedFirebaseProjectId,
      configured: Boolean(cachedFirebaseProjectId),
    };
  }

  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
      const pid = parsed.projectId?.trim();
      if (pid && pid !== 'remixed-project-id') {
        cachedFirebaseProjectId = pid;
        return { projectId: pid, configured: true };
      }
    }
  } catch {
    // Ignore malformed config file and fall back cleanly
  }

  cachedFirebaseProjectId = null;
  return { projectId: null, configured: false };
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

export function getPermissionsForRole(role: AccountRole): RolePermissions {
  switch (role) {
    case 'Clinic Administrator':
      return {
        canViewRecords: true,
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
  const verifier = customVerifier ?? verifyFirebaseIdToken;

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
