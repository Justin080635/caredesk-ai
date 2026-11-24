import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '../../shared/types';

export interface SessionClaims {
  role: UserRole;
  actor: string;
  exp: number;
}

const RUNTIME_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  return process.env.CAREDESK_SESSION_SECRET?.trim() || RUNTIME_FALLBACK_SECRET;
}

export function isAdminPasscodeConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
}

export function verifyAdminPasscode(inputPasscode: string): boolean {
  const configured = process.env.ADMIN_PASSCODE?.trim();
  if (!configured) {
    return true;
  }
  const expectedBuf = Buffer.from(configured, 'utf8');
  const providedBuf = Buffer.from(inputPasscode || '', 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function issueSessionToken(role: UserRole, actor: string): { token: string; claims: SessionClaims } {
  const claims: SessionClaims = {
    role,
    actor: actor.trim() || (role === 'administrator' ? 'Clinic Administrator' : 'Operations Viewer'),
    exp: Date.now() + 1000 * 60 * 60 * 12,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');
  return { token: `${payload}.${signature}`, claims };
}

export function verifySessionToken(token: string): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');

  const sigBufA = Buffer.from(providedSig, 'utf8');
  const sigBufB = Buffer.from(expectedSig, 'utf8');
  if (sigBufA.length !== sigBufB.length || !crypto.timingSafeEqual(sigBufA, sigBufB)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
    if (!parsed || (parsed.role !== 'administrator' && parsed.role !== 'viewer')) {
      return null;
    }
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  sessionClaims?: SessionClaims;
}

export function requireAdministrator(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Administrator sign-in is required to perform administrative updates.',
      },
    });
    return;
  }

  const claims = verifySessionToken(match[1]);
  if (!claims) {
    res.status(401).json({
      error: {
        code: 'INVALID_SESSION',
        message: 'Your administrative session token is invalid or expired. Please sign in again.',
      },
    });
    return;
  }

  if (claims.role !== 'administrator') {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Read-only staff sessions cannot modify clinic records. Switch to an Administrator session.',
      },
    });
    return;
  }

  req.sessionClaims = claims;
  next();
}
