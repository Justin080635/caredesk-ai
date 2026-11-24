import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  HeartPulse,
  KeyRound,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  User,
} from 'lucide-react';
import { fetchAuthConfig } from '../client/api';
import {
  type DemoPersona,
  formatFirebaseAuthError,
  isFirebaseClientConfigured,
  registerWithEmail,
  requestPasswordReset,
  signInWithDemoPersona,
  signInWithEmail,
  signInWithGooglePopup,
} from '../client/firebase';
import { CareDeskLogoMark, WelcomeBannerMotif } from './ClinicIllustrations';

type AuthMode = 'signin' | 'register' | 'reset';
export type OnboardingIntentRole = 'Clinic Administrator' | 'Doctor' | 'Patient';

export const ONBOARDING_INTENT_STORAGE_KEY = 'caredesk_onboarding_intent';

interface AuthViewProps {
  onRegistrationMetadata: (meta: {
    fullName?: string;
    phoneNumber?: string;
    intentRole?: OnboardingIntentRole;
  }) => void;
}

const ROLE_CARDS: Array<{
  id: OnboardingIntentRole;
  label: string;
  subtitle: string;
  icon: typeof Building2;
}> = [
  {
    id: 'Clinic Administrator',
    label: 'Clinic Admin',
    subtitle: 'Run clinic workspace',
    icon: Building2,
  },
  {
    id: 'Doctor',
    label: 'Doctor',
    subtitle: 'Apply with credentials',
    icon: Stethoscope,
  },
  {
    id: 'Patient',
    label: 'Patient',
    subtitle: 'Link via claim code',
    icon: HeartPulse,
  },
];

export function AuthView({ onRegistrationMetadata }: AuthViewProps) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [intentRole, setIntentRole] = useState<OnboardingIntentRole>(() => {
    try {
      const saved = sessionStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY);
      if (saved === 'Doctor' || saved === 'Patient' || saved === 'Clinic Administrator') {
        return saved;
      }
    } catch {
      // Ignore storage access errors
    }
    return 'Clinic Administrator';
  });
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [demoLoadingPersona, setDemoLoadingPersona] = useState<DemoPersona | null>(null);
  const [demoAuthEnabled, setDemoAuthEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAuthConfig()
      .then((cfg) => {
        if (active) setDemoAuthEnabled(Boolean(cfg.demoAuthEnabled));
      })
      .catch(() => {
        if (active) setDemoAuthEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const resetMessages = () => {
    setErrorMessage(null);
    setInfoMessage(null);
  };

  const handleDemoSignIn = async (persona: DemoPersona) => {
    resetMessages();
    setDemoLoadingPersona(persona);
    try {
      await signInWithDemoPersona(persona);
    } catch (err) {
      setErrorMessage(formatFirebaseAuthError(err));
    } finally {
      setDemoLoadingPersona(null);
    }
  };

  const selectIntentRole = (role: OnboardingIntentRole) => {
    setIntentRole(role);
    try {
      sessionStorage.setItem(ONBOARDING_INTENT_STORAGE_KEY, role);
    } catch {
      // Ignore storage access errors
    }
  };

  const handleModeSwitch = (next: AuthMode) => {
    setMode(next);
    resetMessages();
  };

  const handleGoogleSignIn = async () => {
    resetMessages();
    selectIntentRole(intentRole);
    setGoogleSubmitting(true);
    try {
      await signInWithGooglePopup();
    } catch (err) {
      setErrorMessage(formatFirebaseAuthError(err));
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (!isFirebaseClientConfigured) {
      setErrorMessage('Firebase Authentication configuration is missing.');
      return;
    }

    if (mode === 'reset') {
      if (!email.trim()) {
        setErrorMessage('Enter the email address associated with your account.');
        return;
      }
      setSubmitting(true);
      try {
        await requestPasswordReset(email);
        setInfoMessage(
          `Password recovery instructions have been sent to ${email.trim()}. Check your inbox and return here to sign in.`
        );
      } catch (err) {
        setErrorMessage(formatFirebaseAuthError(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (mode === 'register') {
      if (fullName.trim().length < 2) {
        setErrorMessage('Full name must be at least 2 characters.');
        return;
      }
      if (phoneNumber.trim() && phoneNumber.trim().length < 7) {
        setErrorMessage('Phone number must be at least 7 characters when provided.');
        return;
      }
      if (password.length < 6) {
        setErrorMessage('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage('Passwords do not match.');
        return;
      }

      selectIntentRole(intentRole);
      setSubmitting(true);
      try {
        onRegistrationMetadata({
          fullName: fullName.trim(),
          phoneNumber: phoneNumber.trim(),
          intentRole,
        });
        await registerWithEmail({
          fullName: fullName.trim(),
          email,
          password,
        });
      } catch (err) {
        setErrorMessage(formatFirebaseAuthError(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!email.trim() || !password) {
      setErrorMessage('Enter both your email address and password.');
      return;
    }
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
    } catch (err) {
      setErrorMessage(formatFirebaseAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#EEF3EF] text-[#1C2B25] p-3 sm:p-5 lg:p-6 flex items-center justify-center">
      <div className="shell-frame w-full max-w-[1220px] min-h-[680px] p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Left Forest Brand Panel */}
        <aside className="lg:col-span-5 relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0F3D2E] via-[#134D39] to-[#1D7454] text-emerald-50 p-7 sm:p-9 flex flex-col justify-between">
          <div className="pointer-events-none absolute -top-2 -right-8 w-56 opacity-30">
            <WelcomeBannerMotif />
          </div>

          <div className="relative z-10 space-y-7">
            <div className="flex items-center gap-3">
              <CareDeskLogoMark className="w-11 h-11 shadow-sm" />
              <div>
                <div className="text-lg font-bold tracking-tight text-white">CareDesk AI</div>
                <div className="text-xs text-emerald-100/75">
                  Connected Healthcare Operations
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div className="inline-flex px-3 py-1 rounded-full bg-white/10 text-[11px] font-mono uppercase tracking-wider text-emerald-200">
                Multi-Role Clinical Portal
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white leading-tight">
                Less time managing healthcare administration. More time delivering care.
              </h1>
              <p className="text-sm text-emerald-100/85 leading-relaxed">
                CareDesk AI connects Clinic Administrators, Doctors, and Patients inside one
                verified, clinic-isolated workspace.
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-[#09291E]/60 border border-white/10">
                <ShieldCheck className="w-4 h-4 text-[#34C38F] mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <div className="text-xs font-semibold text-white">
                    Role-Enforced Clinic Isolation
                  </div>
                  <p className="text-xs text-emerald-100/75 mt-0.5 leading-relaxed">
                    Administrators coordinate clinic flow, Doctors access verified patient queues,
                    and Patients view only personal records.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 rounded-2xl bg-[#09291E]/60 border border-white/10">
                <KeyRound className="w-4 h-4 text-[#34C38F] mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <div className="text-xs font-semibold text-white">
                    Verified Onboarding Security
                  </div>
                  <p className="text-xs text-emerald-100/75 mt-0.5 leading-relaxed">
                    Clinicians require administrator review, and Patients verify via a clinic
                    Claim Code + Date of Birth.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 pt-8 text-[11px] text-emerald-200/70">
            Protected by Firebase Authentication · Role-Scoped Express APIs
          </div>
        </aside>

        {/* Right Form Panel */}
        <main className="lg:col-span-7 flex items-center justify-center p-3 sm:p-8">
          <div className="w-full max-w-md bg-white border border-[#DCE8E0] rounded-[24px] shadow-xs p-6 sm:p-8 space-y-5">
            {mode !== 'reset' ? (
              <>
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-[#1C2B25]">
                    {mode === 'signin' ? 'Sign in to CareDesk AI' : 'Create Your Account'}
                  </h2>
                  <p className="text-xs text-[#6B7B73]">
                    {mode === 'signin'
                      ? 'Access your Administrator, Doctor, or Patient portal.'
                      : 'Choose your account role and register with email or Google.'}
                  </p>
                </div>

                <div
                  className="grid grid-cols-2 gap-1 p-1 bg-[#EEF3EF] rounded-full"
                  role="tablist"
                  aria-label="Authentication mode"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'signin'}
                    onClick={() => handleModeSwitch('signin')}
                    className={`py-2 text-xs font-semibold rounded-full transition-colors ${
                      mode === 'signin'
                        ? 'bg-[#0F3D2E] text-white shadow-xs'
                        : 'text-[#6B7B73] hover:text-[#1C2B25]'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'register'}
                    onClick={() => handleModeSwitch('register')}
                    className={`py-2 text-xs font-semibold rounded-full transition-colors ${
                      mode === 'register'
                        ? 'bg-[#0F3D2E] text-white shadow-xs'
                        : 'text-[#6B7B73] hover:text-[#1C2B25]'
                    }`}
                  >
                    Create Account
                  </button>
                </div>

                {mode === 'register' && (
                  <div>
                    <div className="text-xs font-semibold text-[#1C2B25] mb-1.5">Account Type</div>
                    <div className="grid grid-cols-3 gap-2">
                      {ROLE_CARDS.map((card) => {
                        const Icon = card.icon;
                        const active = intentRole === card.id;
                        return (
                          <button
                            key={card.id}
                            type="button"
                            onClick={() => selectIntentRole(card.id)}
                            className={`p-3 rounded-2xl border text-left transition-colors ${
                              active
                                ? 'border-[#34C38F] bg-[#E3F7EF]/60 text-[#0F3D2E]'
                                : 'border-[#DCE8E0] bg-[#FAFBF9] hover:bg-white text-[#43564D]'
                            }`}
                          >
                            <Icon
                              className={`w-4 h-4 mb-1.5 ${
                                active ? 'text-[#137A55]' : 'text-[#6B7B73]'
                              }`}
                              aria-hidden="true"
                            />
                            <div className="text-xs font-semibold leading-tight">{card.label}</div>
                            <div className="text-[10px] text-[#6B7B73] leading-tight mt-0.5">
                              {card.subtitle}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={googleSubmitting || submitting}
                  onClick={handleGoogleSignIn}
                  className="btn-press w-full flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-[#1C2B25] bg-[#FAFBF9] hover:bg-[#EEF3EF] border border-[#DCE8E0] rounded-full transition-colors disabled:opacity-60"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                    />
                  </svg>
                  <span>{googleSubmitting ? 'Connecting to Google...' : 'Continue with Google'}</span>
                </button>

                <div className="relative flex items-center py-0.5">
                  <div className="flex-grow border-t border-[#EEF3EF]" />
                  <span className="shrink mx-3 text-[11px] font-medium text-[#6B7B73]">
                    or use email &amp; password
                  </span>
                  <div className="flex-grow border-t border-[#EEF3EF]" />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => handleModeSwitch('signin')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#137A55] hover:underline"
                >
                  <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  Back to Sign In
                </button>
                <h2 className="text-xl font-bold text-[#1C2B25]">Recover Your Password</h2>
                <p className="text-xs text-[#6B7B73]">
                  Enter your registered email to receive a Firebase password reset link.
                </p>
              </div>
            )}

            {errorMessage && (
              <div
                role="alert"
                className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5"
              >
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="leading-relaxed">{errorMessage}</span>
              </div>
            )}

            {infoMessage && (
              <div
                role="status"
                className="p-3 rounded-2xl bg-[#E3F7EF] border border-[#B5E5D0] text-xs text-[#0F3D2E] flex items-start gap-2.5"
              >
                <CheckCircle2
                  className="w-4 h-4 text-[#137A55] shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span className="leading-relaxed">{infoMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {mode === 'register' && (
                <>
                  <div>
                    <label
                      htmlFor="auth-full-name"
                      className="block text-xs font-semibold text-[#1C2B25] mb-1"
                    >
                      Full Name
                    </label>
                    <div className="relative">
                      <User
                        className="w-4 h-4 text-[#6B7B73] absolute left-3.5 top-1/2 -translate-y-1/2"
                        aria-hidden="true"
                      />
                      <input
                        id="auth-full-name"
                        type="text"
                        required
                        autoComplete="name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder={
                          intentRole === 'Doctor' ? 'Dr. Jordan Alvarez' : 'Jordan Alvarez'
                        }
                        className="w-full pl-10 pr-4 py-2 text-sm border border-[#DCE8E0] rounded-2xl bg-[#FAFBF9] focus:bg-white focus:outline-none focus:border-[#34C38F]"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="auth-phone"
                      className="block text-xs font-semibold text-[#1C2B25] mb-1"
                    >
                      Phone Number
                    </label>
                    <div className="relative">
                      <Phone
                        className="w-4 h-4 text-[#6B7B73] absolute left-3.5 top-1/2 -translate-y-1/2"
                        aria-hidden="true"
                      />
                      <input
                        id="auth-phone"
                        type="tel"
                        autoComplete="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+1-555-0192"
                        className="w-full pl-10 pr-4 py-2 text-sm border border-[#DCE8E0] rounded-2xl bg-[#FAFBF9] focus:bg-white focus:outline-none focus:border-[#34C38F]"
                      />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label htmlFor="auth-email" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail
                    className="w-4 h-4 text-[#6B7B73] absolute left-3.5 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.org"
                    className="w-full pl-10 pr-4 py-2 text-sm border border-[#DCE8E0] rounded-2xl bg-[#FAFBF9] focus:bg-white focus:outline-none focus:border-[#34C38F]"
                  />
                </div>
              </div>

              {mode !== 'reset' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="auth-password"
                      className="block text-xs font-semibold text-[#1C2B25]"
                    >
                      Password
                    </label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => handleModeSwitch('reset')}
                        className="text-[11px] font-semibold text-[#137A55] hover:underline"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock
                      className="w-4 h-4 text-[#6B7B73] absolute left-3.5 top-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-password"
                      type="password"
                      required
                      minLength={6}
                      autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full pl-10 pr-4 py-2 text-sm border border-[#DCE8E0] rounded-2xl bg-[#FAFBF9] focus:bg-white focus:outline-none focus:border-[#34C38F]"
                    />
                  </div>
                </div>
              )}

              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="auth-confirm-password"
                    className="block text-xs font-semibold text-[#1C2B25] mb-1"
                  >
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock
                      className="w-4 h-4 text-[#6B7B73] absolute left-3.5 top-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-confirm-password"
                      type="password"
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full pl-10 pr-4 py-2 text-sm border border-[#DCE8E0] rounded-2xl bg-[#FAFBF9] focus:bg-white focus:outline-none focus:border-[#34C38F]"
                    />
                  </div>
                  <p className="text-[11px] text-[#6B7B73] mt-2 leading-relaxed">
                    {intentRole === 'Clinic Administrator' &&
                      'New administrators set up an isolated clinic workspace next.'}
                    {intentRole === 'Doctor' &&
                      'Doctor accounts submit clinical credentials and wait for Clinic Administrator verification.'}
                    {intentRole === 'Patient' &&
                      'Patients link their record using a clinic-issued Claim Code + Date of Birth or verification request.'}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || googleSubmitting || Boolean(demoLoadingPersona)}
                className="btn-press w-full py-2.5 px-5 text-sm font-semibold text-white bg-[#34C38F] hover:bg-[#24B07D] rounded-full transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 shadow-xs"
              >
                {submitting
                  ? mode === 'signin'
                    ? 'Signing in...'
                    : mode === 'register'
                      ? 'Creating account...'
                      : 'Sending reset link...'
                  : mode === 'signin'
                    ? 'Sign In'
                    : mode === 'register'
                      ? `Create ${intentRole === 'Clinic Administrator' ? 'Administrator' : intentRole} Account`
                      : 'Send Password Reset Email'}
              </button>
            </form>

            {demoAuthEnabled && mode === 'signin' && (
              <div className="pt-4 border-t border-[#EEF3EF] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0F3D2E]">
                    <Sparkles className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
                    Preview Demo Access
                  </span>
                  <span className="text-[10px] font-mono text-[#6B7B73]">Sandbox CLN-1001</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={submitting || googleSubmitting || Boolean(demoLoadingPersona)}
                    onClick={() => handleDemoSignIn('administrator')}
                    className="btn-press px-2.5 py-2 rounded-2xl border border-[#DCE8E0] bg-[#FAFBF9] hover:bg-[#E3F7EF]/60 hover:border-[#34C38F] text-left transition-colors disabled:opacity-60"
                  >
                    <div className="text-xs font-semibold text-[#0F3D2E]">
                      {demoLoadingPersona === 'administrator' ? 'Loading...' : 'Admin'}
                    </div>
                    <div className="text-[10px] text-[#6B7B73] truncate">Dr. Maya Lin</div>
                  </button>
                  <button
                    type="button"
                    disabled={submitting || googleSubmitting || Boolean(demoLoadingPersona)}
                    onClick={() => handleDemoSignIn('doctor')}
                    className="btn-press px-2.5 py-2 rounded-2xl border border-[#DCE8E0] bg-[#FAFBF9] hover:bg-[#E3F7EF]/60 hover:border-[#34C38F] text-left transition-colors disabled:opacity-60"
                  >
                    <div className="text-xs font-semibold text-[#0F3D2E]">
                      {demoLoadingPersona === 'doctor' ? 'Loading...' : 'Doctor'}
                    </div>
                    <div className="text-[10px] text-[#6B7B73] truncate">Dr. Okafor</div>
                  </button>
                  <button
                    type="button"
                    disabled={submitting || googleSubmitting || Boolean(demoLoadingPersona)}
                    onClick={() => handleDemoSignIn('patient')}
                    className="btn-press px-2.5 py-2 rounded-2xl border border-[#DCE8E0] bg-[#FAFBF9] hover:bg-[#E3F7EF]/60 hover:border-[#34C38F] text-left transition-colors disabled:opacity-60"
                  >
                    <div className="text-xs font-semibold text-[#0F3D2E]">
                      {demoLoadingPersona === 'patient' ? 'Loading...' : 'Patient'}
                    </div>
                    <div className="text-[10px] text-[#6B7B73] truncate">Eleanor V.</div>
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
