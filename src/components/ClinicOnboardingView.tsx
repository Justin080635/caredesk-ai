import { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  LogOut,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
} from 'lucide-react';
import { onboardClinic } from '../client/api';
import { CLINIC_TYPES } from '../shared/constants';
import type { AccountSessionState, AuthUserProfile } from '../shared/types';

interface ClinicOnboardingViewProps {
  user: AuthUserProfile;
  onOnboarded: (session: AccountSessionState) => void;
  onSignOut: () => void;
}

export function ClinicOnboardingView({
  user,
  onOnboarded,
  onSignOut,
}: ClinicOnboardingViewProps) {
  const [clinicName, setClinicName] = useState('');
  const [clinicType, setClinicType] = useState<string>(CLINIC_TYPES[0]);
  const [customClinicType, setCustomClinicType] = useState('');
  const [contactPhone, setContactPhone] = useState(user.phoneNumber || '');
  const [contactEmail, setContactEmail] = useState(user.email || '');
  const [location, setLocation] = useState('');
  const [organizationNotes, setOrganizationNotes] = useState('');
  const [seedSampleData, setSeedSampleData] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const resolvedType =
      clinicType === '__custom__' ? customClinicType.trim() : clinicType.trim();

    if (clinicName.trim().length < 2) {
      setErrorMessage('Please enter your clinic name (at least 2 characters).');
      return;
    }
    if (resolvedType.length < 2) {
      setErrorMessage('Please specify the clinic type.');
      return;
    }
    if (contactPhone.trim().length < 7) {
      setErrorMessage('Please enter a valid clinic contact phone number.');
      return;
    }
    if (!contactEmail.trim()) {
      setErrorMessage('Please provide a clinic contact email address.');
      return;
    }
    if (location.trim().length < 2) {
      setErrorMessage('Please provide the clinic location (city/region or address).');
      return;
    }

    setSubmitting(true);
    try {
      const nextSession = await onboardClinic({
        clinicName: clinicName.trim(),
        clinicType: resolvedType,
        contactPhone: contactPhone.trim(),
        contactEmail: contactEmail.trim(),
        location: location.trim(),
        organizationNotes: organizationNotes.trim(),
        seedSampleData,
      });
      onOnboarded(nextSession);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to create clinic workspace. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F8F6] text-[#111C17] flex flex-col">
      {/* Top Bar */}
      <header className="h-16 bg-white border-b border-[#E3E8E4] px-4 sm:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#059669] text-white flex items-center justify-center shadow-xs">
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
            <div className="text-[11px] text-[#526259]">Clinic Workspace Setup</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block text-right">
            <div className="text-xs font-semibold text-[#111C17]">{user.fullName}</div>
            <div className="text-[11px] font-mono text-[#526259]">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#526259] hover:text-[#111C17] bg-[#F6F8F6] hover:bg-[#ECF4EF] border border-[#E3E8E4] rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Onboarding Card */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-2xl bg-white border border-[#E3E8E4] rounded-2xl shadow-xs overflow-hidden">
          <div className="bg-[#0B261C] text-white px-6 sm:px-8 py-6 space-y-2">
            <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              Step 2 of 2 · Clinic Administrator Onboarding
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              Set Up Your Clinic Workspace
            </h1>
            <p className="text-xs sm:text-sm text-emerald-100/80 max-w-xl">
              Welcome, {user.fullName}. Configure your clinic&apos;s essential profile to establish
              an isolated operational boundary assigned to you as Clinic Administrator.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5">
            {errorMessage && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2.5"
              >
                <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="onboard-clinic-name"
                  className="block text-xs font-medium text-[#111C17] mb-1"
                >
                  Clinic Name <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <Building2
                    className="w-4 h-4 text-[#6C7B73] absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    id="onboard-clinic-name"
                    type="text"
                    required
                    value={clinicName}
                    onChange={(e) => setClinicName(e.target.value)}
                    placeholder="Harborview Primary Care"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-[#D4DAD4] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="onboard-clinic-type"
                  className="block text-xs font-medium text-[#111C17] mb-1"
                >
                  Clinic Type <span className="text-red-600">*</span>
                </label>
                <select
                  id="onboard-clinic-type"
                  value={clinicType}
                  onChange={(e) => setClinicType(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
                >
                  {CLINIC_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                  <option value="__custom__">Other Specialty / Custom...</option>
                </select>
              </div>
            </div>

            {clinicType === '__custom__' && (
              <div>
                <label
                  htmlFor="onboard-custom-type"
                  className="block text-xs font-medium text-[#111C17] mb-1"
                >
                  Custom Clinic Type <span className="text-red-600">*</span>
                </label>
                <input
                  id="onboard-custom-type"
                  type="text"
                  required
                  value={customClinicType}
                  onChange={(e) => setCustomClinicType(e.target.value)}
                  placeholder="e.g. Women's Health Outpatient Center"
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="onboard-phone"
                  className="block text-xs font-medium text-[#111C17] mb-1"
                >
                  Clinic Contact Phone <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <Phone
                    className="w-4 h-4 text-[#6C7B73] absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    id="onboard-phone"
                    type="tel"
                    required
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+1-555-0140"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-[#D4DAD4] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="onboard-email"
                  className="block text-xs font-medium text-[#111C17] mb-1"
                >
                  Clinic Contact Email <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <Mail
                    className="w-4 h-4 text-[#6C7B73] absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    id="onboard-email"
                    type="email"
                    required
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="frontdesk@harborviewclinic.org"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-[#D4DAD4] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
                  />
                </div>
              </div>
            </div>

            <div>
              <label
                htmlFor="onboard-location"
                className="block text-xs font-medium text-[#111C17] mb-1"
              >
                Clinic Location <span className="text-red-600">*</span>
              </label>
              <div className="relative">
                <MapPin
                  className="w-4 h-4 text-[#6C7B73] absolute left-3 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="onboard-location"
                  type="text"
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Portland, OR · 420 Waterfront Medical Plaza"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-[#D4DAD4] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="onboard-notes"
                className="block text-xs font-medium text-[#111C17] mb-1"
              >
                Basic Organization Information (Optional)
              </label>
              <textarea
                id="onboard-notes"
                rows={2}
                value={organizationNotes}
                onChange={(e) => setOrganizationNotes(e.target.value)}
                placeholder="Operating hours, care coordination notes, or organization summary..."
                className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
              />
            </div>

            <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[#F6F8F6] border border-[#E3E8E4] cursor-pointer">
              <input
                type="checkbox"
                checked={seedSampleData}
                onChange={(e) => setSeedSampleData(e.target.checked)}
                className="mt-0.5 rounded border-[#D4DAD4] text-[#059669] focus:ring-[#059669]"
              />
              <span className="text-xs text-[#34433B] leading-relaxed">
                <span className="font-semibold text-[#111C17]">
                  Include isolated synthetic starter dataset
                </span>{' '}
                — optionally seed sample patients, clinicians, appointments, and follow-ups scoped
                exclusively to this new clinic for quick evaluation. Leave unchecked to start with a
                clean workspace.
              </span>
            </label>

            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[#E3E8E4]">
              <div className="flex items-center gap-2 text-xs text-[#047857] font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Clinic Administrator permissions assigned automatically</span>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="btn-press px-5 py-2.5 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-xl transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                {submitting ? 'Creating Clinic...' : 'Create Clinic & Open Dashboard'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
