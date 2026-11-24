import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  HeartPulse,
  KeyRound,
  LogOut,
  RefreshCw,
  Stethoscope,
} from 'lucide-react';
import {
  claimPatientPortalRecord,
  fetchClinicsDirectory,
  submitDoctorApplication,
  submitPatientLinkRequest,
} from '../client/api';
import { CLINIC_DEPARTMENTS } from '../shared/constants';
import type {
  AccountSessionState,
  ClinicDirectoryEntry,
} from '../shared/types';
import { ONBOARDING_INTENT_STORAGE_KEY, type OnboardingIntentRole } from './AuthView';
import { ClinicOnboardingView } from './ClinicOnboardingView';
import { VerificationStatusText } from './StatusText';

interface OnboardingRouterViewProps {
  session: AccountSessionState;
  onSessionUpdated: (nextSession: AccountSessionState) => void;
  onRefreshSession: () => Promise<void>;
  onSignOut: () => void;
}

export function OnboardingRouterView({
  session,
  onSessionUpdated,
  onRefreshSession,
  onSignOut,
}: OnboardingRouterViewProps) {
  const [selectedPath, setSelectedPath] = useState<OnboardingIntentRole>(() => {
    try {
      const saved = sessionStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY);
      if (saved === 'Doctor' || saved === 'Patient' || saved === 'Clinic Administrator') {
        return saved;
      }
    } catch {
      // Ignore storage access errors
    }
    if (session.pendingDoctorApplications.length > 0) return 'Doctor';
    if (session.pendingPatientLinkRequests.length > 0) return 'Patient';
    return 'Clinic Administrator';
  });

  const [clinics, setClinics] = useState<ClinicDirectoryEntry[]>([]);
  const [loadingClinics, setLoadingClinics] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Doctor Application State
  const [docClinicId, setDocClinicId] = useState('');
  const [docDepartment, setDocDepartment] = useState<string>(CLINIC_DEPARTMENTS[0]);
  const [docSpecialty, setDocSpecialty] = useState('');
  const [docQualifications, setDocQualifications] = useState('');
  const [docLicense, setDocLicense] = useState('');
  const [docPhone, setDocPhone] = useState(session.user.phoneNumber || '');
  const [docBio, setDocBio] = useState('');
  const [docSubmitting, setDocSubmitting] = useState(false);

  // Patient Verification State
  const [patMode, setPatMode] = useState<'claim' | 'request'>('claim');
  const [patClinicId, setPatClinicId] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [patDob, setPatDob] = useState('');
  const [patPhone, setPatPhone] = useState(session.user.phoneNumber || '');
  const [patNotes, setPatNotes] = useState('');
  const [patSubmitting, setPatSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingClinics(true);
    fetchClinicsDirectory()
      .then((list) => {
        if (!active) return;
        setClinics(list);
        if (list.length > 0) {
          setDocClinicId((prev) => prev || list[0].id);
          setPatClinicId((prev) => prev || list[0].id);
        }
      })
      .catch(() => {
        if (active) setClinics([]);
      })
      .finally(() => {
        if (active) setLoadingClinics(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleDoctorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setDocSubmitting(true);
    try {
      await submitDoctorApplication({
        clinicId: docClinicId,
        fullName: session.user.fullName,
        phoneNumber: docPhone.trim(),
        department: docDepartment,
        specialty: docSpecialty.trim() || docDepartment,
        qualifications: docQualifications.trim(),
        licenseNumber: docLicense.trim(),
        bio: docBio.trim(),
      });
      await onRefreshSession();
      setInfoMsg(
        'Your doctor verification application has been submitted. A Clinic Administrator must approve your credentials before clinical access is granted.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to submit doctor application.');
    } finally {
      setDocSubmitting(false);
    }
  };

  const handlePatientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setPatSubmitting(true);
    try {
      if (patMode === 'claim') {
        const updatedSession = await claimPatientPortalRecord({
          clinicId: patClinicId,
          claimCode: claimCode.trim(),
          dateOfBirth: patDob.trim(),
        });
        onSessionUpdated(updatedSession);
      } else {
        await submitPatientLinkRequest({
          clinicId: patClinicId,
          fullName: session.user.fullName,
          phoneNumber: patPhone.trim(),
          dateOfBirth: patDob.trim(),
          notes: patNotes.trim(),
        });
        await onRefreshSession();
        setInfoMsg(
          'Your Patient Portal verification request has been sent to the clinic administrator.'
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to verify patient portal access.');
    } finally {
      setPatSubmitting(false);
    }
  };

  if (selectedPath === 'Clinic Administrator') {
    return (
      <div className="min-h-screen bg-[#F6F8F6] flex flex-col">
        <div className="bg-[#ECF4EF] border-b border-[#C6E0D0] px-4 sm:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[#0B261C] font-medium">
            Setting up as <span className="font-semibold">Clinic Administrator</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedPath('Doctor')}
              className="px-2.5 py-1 rounded-lg bg-white border border-[#D4DAD4] text-[#111C17] hover:bg-[#F6F8F6] font-medium whitespace-nowrap"
            >
              Applying as a Doctor?
            </button>
            <button
              type="button"
              onClick={() => setSelectedPath('Patient')}
              className="px-2.5 py-1 rounded-lg bg-white border border-[#D4DAD4] text-[#111C17] hover:bg-[#F6F8F6] font-medium whitespace-nowrap"
            >
              Patient Portal Verification?
            </button>
          </div>
        </div>
        <ClinicOnboardingView
          user={session.user}
          onOnboarded={onSessionUpdated}
          onSignOut={onSignOut}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F8F6] text-[#111C17] flex flex-col">
      <header className="h-16 bg-white border-b border-[#E3E8E4] px-4 sm:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#059669] text-white flex items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold text-[#111C17]">CareDesk AI</div>
            <div className="text-[11px] text-[#526259]">Account Verification &amp; Workspace Linking</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block text-right">
            <div className="text-xs font-semibold text-[#111C17]">{session.user.fullName}</div>
            <div className="text-[11px] font-mono text-[#526259]">{session.user.email}</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#526259] hover:text-[#111C17] bg-[#F6F8F6] hover:bg-[#ECF4EF] border border-[#E3E8E4] rounded-lg whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Role Switcher */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => {
              setSelectedPath('Clinic Administrator');
              setErrorMsg(null);
            }}
            className="p-3.5 rounded-xl border border-[#E3E8E4] bg-white hover:bg-[#F6F8F6] text-left transition-colors"
          >
            <Building2 className="w-4 h-4 text-[#526259] mb-1.5" aria-hidden="true" />
            <div className="text-xs font-semibold text-[#111C17]">Clinic Administrator</div>
            <div className="text-[11px] text-[#526259]">Create a new clinic workspace</div>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedPath('Doctor');
              setErrorMsg(null);
            }}
            className={`p-3.5 rounded-xl border text-left transition-colors ${
              selectedPath === 'Doctor'
                ? 'border-[#059669] bg-[#ECF4EF]'
                : 'border-[#E3E8E4] bg-white hover:bg-[#F6F8F6]'
            }`}
          >
            <Stethoscope
              className={`w-4 h-4 mb-1.5 ${
                selectedPath === 'Doctor' ? 'text-[#059669]' : 'text-[#526259]'
              }`}
              aria-hidden="true"
            />
            <div className="text-xs font-semibold text-[#111C17]">Doctor Verification</div>
            <div className="text-[11px] text-[#526259]">Apply with credentials</div>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedPath('Patient');
              setErrorMsg(null);
            }}
            className={`p-3.5 rounded-xl border text-left transition-colors ${
              selectedPath === 'Patient'
                ? 'border-[#059669] bg-[#ECF4EF]'
                : 'border-[#E3E8E4] bg-white hover:bg-[#F6F8F6]'
            }`}
          >
            <HeartPulse
              className={`w-4 h-4 mb-1.5 ${
                selectedPath === 'Patient' ? 'text-[#059669]' : 'text-[#526259]'
              }`}
              aria-hidden="true"
            />
            <div className="text-xs font-semibold text-[#111C17]">Patient Portal</div>
            <div className="text-[11px] text-[#526259]">Redeem claim code or request link</div>
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-[#ECF4EF] border border-[#B7DFCA] text-xs text-[#0B261C] flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0 mt-0.5" aria-hidden="true" />
            <span>{infoMsg}</span>
          </div>
        )}

        {selectedPath === 'Doctor' && (
          <div className="space-y-5">
            {session.pendingDoctorApplications.length > 0 && (
              <div className="bg-white border border-[#E3E8E4] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-700" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-[#111C17]">
                      Your Submitted Doctor Applications
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onRefreshSession()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#F6F8F6] hover:bg-[#ECF4EF] border border-[#E3E8E4] rounded-lg whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    Check Approval Status
                  </button>
                </div>

                <div className="divide-y divide-[#E3E8E4]">
                  {session.pendingDoctorApplications.map((app) => (
                    <div key={app.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-[#111C17]">
                          {app.clinicName || app.clinicId} · {app.specialty} ({app.department})
                        </div>
                        <div className="text-[11px] font-mono text-[#526259] mt-0.5">
                          License {app.licenseNumber} · {app.qualifications}
                        </div>
                        {app.reviewNotes && (
                          <div className="text-xs text-red-700 mt-1">Note: {app.reviewNotes}</div>
                        )}
                      </div>
                      <VerificationStatusText status={app.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white border border-[#E3E8E4] rounded-xl overflow-hidden">
              <div className="bg-[#0B261C] text-white px-6 py-5 space-y-1">
                <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-300">
                  Doctor Verification Application
                </div>
                <h1 className="text-lg font-bold">Submit Clinical Credentials</h1>
                <p className="text-xs text-emerald-100/80">
                  For patient safety, clinician portal access remains locked until a Clinic
                  Administrator verifies your license and approves your account.
                </p>
              </div>

              <form onSubmit={handleDoctorSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="doc-clinic"
                      className="block text-xs font-medium text-[#111C17] mb-1"
                    >
                      Target Clinic <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="doc-clinic"
                      required
                      disabled={loadingClinics}
                      value={docClinicId}
                      onChange={(e) => setDocClinicId(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl bg-white"
                    >
                      {clinics.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.location})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="doc-department"
                      className="block text-xs font-medium text-[#111C17] mb-1"
                    >
                      Department <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="doc-department"
                      value={docDepartment}
                      onChange={(e) => setDocDepartment(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl bg-white"
                    >
                      {CLINIC_DEPARTMENTS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="doc-specialty"
                      className="block text-xs font-medium text-[#111C17] mb-1"
                    >
                      Specialty <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="doc-specialty"
                      type="text"
                      required
                      value={docSpecialty}
                      onChange={(e) => setDocSpecialty(e.target.value)}
                      placeholder="e.g. Interventional Cardiology"
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="doc-license"
                      className="block text-xs font-medium text-[#111C17] mb-1"
                    >
                      Medical License Number <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="doc-license"
                      type="text"
                      required
                      value={docLicense}
                      onChange={(e) => setDocLicense(e.target.value)}
                      placeholder="MD-OR-90421"
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="doc-qual"
                      className="block text-xs font-medium text-[#111C17] mb-1"
                    >
                      Qualifications <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="doc-qual"
                      type="text"
                      required
                      value={docQualifications}
                      onChange={(e) => setDocQualifications(e.target.value)}
                      placeholder="MD, FACC"
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="doc-phone"
                      className="block text-xs font-medium text-[#111C17] mb-1"
                    >
                      Contact Phone
                    </label>
                    <input
                      id="doc-phone"
                      type="tel"
                      value={docPhone}
                      onChange={(e) => setDocPhone(e.target.value)}
                      placeholder="+1-555-0190"
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="doc-bio"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Professional Bio / Practice Summary (Optional)
                  </label>
                  <textarea
                    id="doc-bio"
                    rows={2}
                    value={docBio}
                    onChange={(e) => setDocBio(e.target.value)}
                    placeholder="Clinical focus areas and outpatient availability notes..."
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={docSubmitting || clinics.length === 0}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-xl disabled:opacity-60 whitespace-nowrap"
                  >
                    {docSubmitting ? 'Submitting...' : 'Submit for Admin Verification'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {selectedPath === 'Patient' && (
          <div className="space-y-5">
            {session.pendingPatientLinkRequests.length > 0 && (
              <div className="bg-white border border-[#E3E8E4] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-700" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-[#111C17]">
                      Your Patient Portal Verification Requests
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onRefreshSession()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#F6F8F6] hover:bg-[#ECF4EF] border border-[#E3E8E4] rounded-lg whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    Refresh Access
                  </button>
                </div>
                <div className="divide-y divide-[#E3E8E4]">
                  {session.pendingPatientLinkRequests.map((req) => (
                    <div key={req.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-[#111C17]">
                          {req.clinicName || req.clinicId} · DOB {req.dateOfBirth}
                        </div>
                        {req.notes && (
                          <div className="text-[11px] text-[#526259] mt-0.5">{req.notes}</div>
                        )}
                      </div>
                      <VerificationStatusText status={req.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white border border-[#E3E8E4] rounded-xl overflow-hidden">
              <div className="bg-[#0B261C] text-white px-6 py-5 space-y-1">
                <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-300">
                  Verified Patient Portal Linking
                </div>
                <h1 className="text-lg font-bold">Connect to Your Clinic Record</h1>
                <p className="text-xs text-emerald-100/80">
                  To protect patient privacy, CareDesk AI never matches records by email alone. Enter
                  a clinic-issued Claim Code + Date of Birth or request administrator verification.
                </p>
              </div>

              <div className="p-6 space-y-5">
                <div className="grid grid-cols-2 gap-2 p-1 bg-[#F1F5F2] rounded-xl">
                  <button
                    type="button"
                    onClick={() => setPatMode('claim')}
                    className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                      patMode === 'claim'
                        ? 'bg-white text-[#0B261C] shadow-xs'
                        : 'text-[#526259]'
                    }`}
                  >
                    Redeem Clinic Claim Code
                  </button>
                  <button
                    type="button"
                    onClick={() => setPatMode('request')}
                    className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                      patMode === 'request'
                        ? 'bg-white text-[#0B261C] shadow-xs'
                        : 'text-[#526259]'
                    }`}
                  >
                    Request Clinic Verification
                  </button>
                </div>

                <form onSubmit={handlePatientSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="pat-clinic"
                      className="block text-xs font-medium text-[#111C17] mb-1"
                    >
                      Clinic <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="pat-clinic"
                      required
                      disabled={loadingClinics}
                      value={patClinicId}
                      onChange={(e) => setPatClinicId(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl bg-white"
                    >
                      {clinics.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.location})
                        </option>
                      ))}
                    </select>
                  </div>

                  {patMode === 'claim' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor="pat-claim-code"
                          className="block text-xs font-medium text-[#111C17] mb-1"
                        >
                          One-Time Claim Code <span className="text-red-600">*</span>
                        </label>
                        <div className="relative">
                          <KeyRound
                            className="w-4 h-4 text-[#6C7B73] absolute left-3 top-1/2 -translate-y-1/2"
                            aria-hidden="true"
                          />
                          <input
                            id="pat-claim-code"
                            type="text"
                            required
                            value={claimCode}
                            onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
                            placeholder="CD-8K4P2M"
                            className="w-full pl-9 pr-3 py-2 text-sm font-mono uppercase border border-[#D4DAD4] rounded-xl"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="pat-dob-claim"
                          className="block text-xs font-medium text-[#111C17] mb-1"
                        >
                          Date of Birth <span className="text-red-600">*</span>
                        </label>
                        <input
                          id="pat-dob-claim"
                          type="date"
                          required
                          value={patDob}
                          onChange={(e) => setPatDob(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label
                            htmlFor="pat-dob-req"
                            className="block text-xs font-medium text-[#111C17] mb-1"
                          >
                            Date of Birth <span className="text-red-600">*</span>
                          </label>
                          <input
                            id="pat-dob-req"
                            type="date"
                            required
                            value={patDob}
                            onChange={(e) => setPatDob(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="pat-phone"
                            className="block text-xs font-medium text-[#111C17] mb-1"
                          >
                            Phone Number
                          </label>
                          <input
                            id="pat-phone"
                            type="tel"
                            value={patPhone}
                            onChange={(e) => setPatPhone(e.target.value)}
                            placeholder="+1-555-0140"
                            className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="pat-notes"
                          className="block text-xs font-medium text-[#111C17] mb-1"
                        >
                          Notes for Clinic Intake (Optional)
                        </label>
                        <input
                          id="pat-notes"
                          type="text"
                          value={patNotes}
                          onChange={(e) => setPatNotes(e.target.value)}
                          placeholder="e.g. Existing patient requesting portal link or new patient registration"
                          className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl"
                        />
                      </div>
                    </>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={patSubmitting || clinics.length === 0}
                      className="px-5 py-2.5 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-xl disabled:opacity-60 whitespace-nowrap"
                    >
                      {patSubmitting
                        ? 'Verifying...'
                        : patMode === 'claim'
                          ? 'Verify & Open Patient Portal'
                          : 'Submit Verification Request'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
