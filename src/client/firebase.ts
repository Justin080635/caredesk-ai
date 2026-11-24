import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export interface AuthSessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  providerId?: string;
  isProxySession?: boolean;
  isDemoSession?: boolean;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

export type DemoPersona = 'administrator' | 'doctor' | 'patient';

interface CustomInMemorySession {
  kind: 'proxy' | 'demo';
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
  user: AuthSessionUser;
}

class ClientFirebaseAuthError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FirebaseError';
    this.code = code;
  }
}

function isConfigReady(): boolean {
  return Boolean(
    firebaseConfig &&
      firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firebaseConfig.projectId !== 'remixed-project-id'
  );
}

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;

if (isConfigReady()) {
  appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  authInstance = getAuth(appInstance);
}

export const isFirebaseClientConfigured = isConfigReady();
export const firebaseAuth = authInstance;

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Held strictly in JS memory (never stored in localStorage or sessionStorage)
let activeCustomSession: CustomInMemorySession | null = null;
let lastNativeFirebaseUser: User | null = null;
const authListeners = new Set<(user: AuthSessionUser | null) => void>();

function notifyAuthListeners(): void {
  const effectiveUser: AuthSessionUser | null = activeCustomSession
    ? activeCustomSession.user
    : lastNativeFirebaseUser;
  for (const listener of authListeners) {
    listener(effectiveUser);
  }
}

function createCustomSessionUser(params: {
  uid: string;
  email: string;
  displayName: string;
  providerId: string;
  isProxySession: boolean;
  isDemoSession: boolean;
}): AuthSessionUser {
  return {
    uid: params.uid,
    email: params.email || null,
    displayName: params.displayName || null,
    photoURL: null,
    providerId: params.providerId,
    isProxySession: params.isProxySession,
    isDemoSession: params.isDemoSession,
    getIdToken: async (forceRefresh = false) => {
      const token = await getCurrentIdToken(forceRefresh);
      if (!token) {
        throw new Error('Authentication session expired. Please sign in again.');
      }
      return token;
    },
  };
}

async function callProxyAuthEndpoint<T>(
  path: string,
  payload: Record<string, unknown>,
  bearerToken?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  const response = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const parsed = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (!response.ok || !parsed.data) {
    const code = parsed.error?.code ?? 'auth/internal-error';
    const message = parsed.error?.message ?? 'Authentication request failed.';
    throw new ClientFirebaseAuthError(code, message);
  }
  return parsed.data;
}

export function subscribeToAuthState(callback: (user: AuthSessionUser | null) => void): () => void {
  authListeners.add(callback);

  let firebaseReady = !authInstance;
  let unsubscribeNative = () => {};

  if (authInstance) {
    unsubscribeNative = onAuthStateChanged(authInstance, (fbUser) => {
      firebaseReady = true;
      lastNativeFirebaseUser = fbUser;
      if (fbUser && activeCustomSession) {
        activeCustomSession = null;
      }
      callback(activeCustomSession ? activeCustomSession.user : fbUser);
    });
  } else {
    callback(activeCustomSession ? activeCustomSession.user : null);
  }

  if (firebaseReady && authInstance) {
    callback(activeCustomSession ? activeCustomSession.user : lastNativeFirebaseUser);
  }

  return () => {
    authListeners.delete(callback);
    unsubscribeNative();
  };
}

export async function getCurrentIdToken(forceRefresh = false): Promise<string | null> {
  if (activeCustomSession) {
    if (
      activeCustomSession.kind === 'proxy' &&
      activeCustomSession.refreshToken &&
      (forceRefresh || Date.now() >= activeCustomSession.expiresAt - 120_000)
    ) {
      try {
        const refreshed = await callProxyAuthEndpoint<{
          idToken: string;
          refreshToken: string;
          expiresIn: number;
        }>('/api/auth/email-refresh', {
          refreshToken: activeCustomSession.refreshToken,
        });
        activeCustomSession.idToken = refreshed.idToken;
        activeCustomSession.refreshToken = refreshed.refreshToken;
        activeCustomSession.expiresAt = Date.now() + (refreshed.expiresIn || 3600) * 1000;
      } catch {
        // Fall through to current token if still valid, or fail cleanly on expired
      }
    }
    return activeCustomSession.idToken;
  }

  if (!authInstance?.currentUser) return null;
  return authInstance.currentUser.getIdToken(forceRefresh);
}

export async function signInWithGooglePopup(): Promise<AuthSessionUser> {
  if (!authInstance) {
    throw new Error('Firebase authentication is not configured.');
  }
  const result = await signInWithPopup(authInstance, googleProvider);
  activeCustomSession = null;
  lastNativeFirebaseUser = result.user;
  notifyAuthListeners();
  return result.user;
}

export async function signInWithEmail(email: string, password: string): Promise<AuthSessionUser> {
  const data = await callProxyAuthEndpoint<{
    idToken: string;
    refreshToken: string;
    expiresIn: number;
    uid: string;
    email: string;
    displayName: string;
  }>('/api/auth/email-signin', {
    email: email.trim(),
    password,
  });

  if (authInstance?.currentUser) {
    await signOut(authInstance).catch(() => {});
  }

  const user = createCustomSessionUser({
    uid: data.uid,
    email: data.email,
    displayName: data.displayName,
    providerId: 'password',
    isProxySession: true,
    isDemoSession: false,
  });

  activeCustomSession = {
    kind: 'proxy',
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + (data.expiresIn || 3600) * 1000,
    user,
  };
  notifyAuthListeners();
  return user;
}

export async function registerWithEmail(params: {
  fullName: string;
  email: string;
  password: string;
}): Promise<AuthSessionUser> {
  const data = await callProxyAuthEndpoint<{
    idToken: string;
    refreshToken: string;
    expiresIn: number;
    uid: string;
    email: string;
    displayName: string;
  }>('/api/auth/email-register', {
    fullName: params.fullName.trim(),
    email: params.email.trim(),
    password: params.password,
  });

  if (authInstance?.currentUser) {
    await signOut(authInstance).catch(() => {});
  }

  const user = createCustomSessionUser({
    uid: data.uid,
    email: data.email,
    displayName: data.displayName || params.fullName.trim(),
    providerId: 'password',
    isProxySession: true,
    isDemoSession: false,
  });

  activeCustomSession = {
    kind: 'proxy',
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + (data.expiresIn || 3600) * 1000,
    user,
  };
  notifyAuthListeners();
  return user;
}

export async function signInWithDemoPersona(persona: DemoPersona): Promise<AuthSessionUser> {
  const data = await callProxyAuthEndpoint<{
    token: string;
    expiresIn: number;
    persona: DemoPersona;
    user: {
      uid: string;
      email: string;
      displayName: string;
      providerId: string;
    };
  }>('/api/auth/demo-signin', { persona });

  if (authInstance?.currentUser) {
    await signOut(authInstance).catch(() => {});
  }

  const user = createCustomSessionUser({
    uid: data.user.uid,
    email: data.user.email,
    displayName: data.user.displayName,
    providerId: 'demo-sandbox',
    isProxySession: false,
    isDemoSession: true,
  });

  activeCustomSession = {
    kind: 'demo',
    idToken: data.token,
    expiresAt: Date.now() + (data.expiresIn || 28800) * 1000,
    user,
  };
  notifyAuthListeners();
  return user;
}

export async function requestPasswordReset(email: string): Promise<void> {
  await callProxyAuthEndpoint('/api/auth/email-reset', {
    email: email.trim(),
  });
}

export async function changeUserPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (activeCustomSession) {
    if (activeCustomSession.kind === 'demo') {
      throw new Error('Preview demo accounts do not use a personal password.');
    }
    const token = await getCurrentIdToken();
    if (!token) {
      throw new Error('No active authenticated user session.');
    }
    const updated = await callProxyAuthEndpoint<{
      idToken: string;
      refreshToken: string;
      expiresIn: number;
    }>('/api/auth/email-password', { currentPassword, newPassword }, token);
    if (updated.idToken) {
      activeCustomSession.idToken = updated.idToken;
      activeCustomSession.refreshToken = updated.refreshToken || activeCustomSession.refreshToken;
      activeCustomSession.expiresAt = Date.now() + (updated.expiresIn || 3600) * 1000;
    }
    return;
  }

  if (!authInstance?.currentUser) {
    throw new Error('No active authenticated user session.');
  }
  const user = authInstance.currentUser;
  if (!user.email) {
    throw new Error('Email address is unavailable for password reauthentication.');
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

export async function updateFirebaseDisplayName(fullName: string): Promise<void> {
  const trimmed = fullName.trim();
  if (!trimmed) return;

  if (activeCustomSession) {
    if (activeCustomSession.kind === 'proxy') {
      const token = await getCurrentIdToken();
      if (token) {
        const updated = await callProxyAuthEndpoint<{
          idToken?: string;
          refreshToken?: string;
          expiresIn?: number;
        }>('/api/auth/email-profile', { fullName: trimmed }, token);
        if (updated.idToken) {
          activeCustomSession.idToken = updated.idToken;
          activeCustomSession.refreshToken =
            updated.refreshToken || activeCustomSession.refreshToken;
          activeCustomSession.expiresAt = Date.now() + (updated.expiresIn || 3600) * 1000;
        }
      }
    }
    activeCustomSession.user = {
      ...activeCustomSession.user,
      displayName: trimmed,
    };
    notifyAuthListeners();
    return;
  }

  if (!authInstance?.currentUser) return;
  if (authInstance.currentUser.displayName === trimmed) return;
  await updateProfile(authInstance.currentUser, { displayName: trimmed });
}

export async function signOutFirebase(): Promise<void> {
  activeCustomSession = null;
  lastNativeFirebaseUser = null;
  if (authInstance) {
    await signOut(authInstance).catch(() => {});
  }
  notifyAuthListeners();
}

export function formatFirebaseAuthError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code?: unknown }).code);
    switch (code) {
      case 'auth/network-request-failed':
        return 'Browser could not reach Google Sign-In directly (often blocked inside preview iframes or by privacy shields). Use Email & Password sign-in above or Preview Demo Access below.';
      case 'auth/operation-not-allowed':
        return 'Email/password sign-in is not yet enabled in Firebase Console (Authentication -> Sign-in method -> Email/Password). Use Preview Demo Access or enable Email/Password.';
      case 'auth/popup-closed-by-user':
        return 'Google sign-in popup was closed before completing authentication.';
      case 'auth/popup-blocked':
        return 'Sign-in popup was blocked by your browser. Allow popups for this site or use Email & Password sign-in.';
      case 'auth/unauthorized-domain':
        return 'This preview domain is not listed under Firebase Authentication -> Settings -> Authorized domains.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email address or password. Please verify your credentials or reset your password.';
      case 'auth/email-already-in-use':
        return 'An account with this email address already exists. Sign in or reset your password instead.';
      case 'auth/weak-password':
        return 'Password is too weak. Use at least 6 characters with a mix of letters and numbers.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts. Please wait a few minutes or reset your password.';
      case 'auth/requires-recent-login':
        return 'For your security, please sign out and sign back in before changing your password.';
      default:
        break;
    }
  }
  return err instanceof Error ? err.message : 'Authentication failed. Please try again.';
}
