import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

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

export function subscribeToAuthState(callback: (user: User | null) => void): () => void {
  if (!authInstance) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(authInstance, callback);
}

export async function getCurrentIdToken(forceRefresh = false): Promise<string | null> {
  if (!authInstance?.currentUser) return null;
  return authInstance.currentUser.getIdToken(forceRefresh);
}

export async function signInWithGooglePopup(): Promise<User> {
  if (!authInstance) {
    throw new Error('Firebase authentication is not configured.');
  }
  const result = await signInWithPopup(authInstance, googleProvider);
  return result.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  if (!authInstance) {
    throw new Error('Firebase authentication is not configured.');
  }
  const result = await signInWithEmailAndPassword(authInstance, email.trim(), password);
  return result.user;
}

export async function registerWithEmail(params: {
  fullName: string;
  email: string;
  password: string;
}): Promise<User> {
  if (!authInstance) {
    throw new Error('Firebase authentication is not configured.');
  }
  const result = await createUserWithEmailAndPassword(
    authInstance,
    params.email.trim(),
    params.password
  );
  if (params.fullName.trim()) {
    await updateProfile(result.user, { displayName: params.fullName.trim() });
    await result.user.getIdToken(true);
  }
  return result.user;
}

export async function requestPasswordReset(email: string): Promise<void> {
  if (!authInstance) {
    throw new Error('Firebase authentication is not configured.');
  }
  await sendPasswordResetEmail(authInstance, email.trim());
}

export async function changeUserPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
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
  if (!authInstance?.currentUser) return;
  const trimmed = fullName.trim();
  if (!trimmed || authInstance.currentUser.displayName === trimmed) return;
  await updateProfile(authInstance.currentUser, { displayName: trimmed });
}

export async function signOutFirebase(): Promise<void> {
  if (!authInstance) return;
  await signOut(authInstance);
}

export function formatFirebaseAuthError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code?: unknown }).code);
    switch (code) {
      case 'auth/operation-not-allowed':
        return 'Email/password sign-in is not yet enabled in Firebase Console (Authentication -> Sign-in method -> Email/Password). You can use Continue with Google immediately or enable Email/Password in Firebase Console.';
      case 'auth/popup-closed-by-user':
        return 'Google sign-in popup was closed before completing authentication.';
      case 'auth/popup-blocked':
        return 'Sign-in popup was blocked by your browser. Allow popups for this site and try again.';
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
