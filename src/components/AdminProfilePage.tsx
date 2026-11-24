import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Database,
  HeartPulse,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Stethoscope,
  User,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import {
  approveDoctorApplication,
  approvePatientLinkRequest,
  fetchClinicMembers,
  fetchDoctorApplications,
  fetchPatientLinkRequests,
  fetchPatients,
  inviteClinicTeamMember,
  rejectDoctorApplication,
  rejectPatientLinkRequest,
  seedSampleClinicData,
  updateAccountProfile,
  updateClinicSettings,
  updateClinicTeamMember,
} from '../client/api';
import {
  changeUserPassword,
  formatFirebaseAuthError,
  requestPasswordReset,
  updateFirebaseDisplayName,
} from '../client/firebase';
import { ACCOUNT_ROLES, CLINIC_TYPES } from '../shared/constants';
import type {
  AccountRole,
  AccountSessionState,
  ClinicInvitation,
  ClinicTeamMember,
  DoctorApplication,
  MembershipStatus,
  Patient,
  PatientLinkRequest,
} from '../shared/types';
import { EditorialAvatar } from './ClinicIllustrations';
import { VerificationStatusText } from './StatusText';

type ProfileSection = 'account' | 'clinic' | 'security' | 'team' | 'verifications';

interface AdminProfilePageProps {
  session: AccountSessionState;
  onSessionRefresh: () => Promise<void>;
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  onSignOut: () => void;
}

export function AdminProfilePage({
  session,
  onSessionRefresh,
  onDataMutated,
  onErrorNotice,
  onSuccessNotice,
  onSignOut,
}: AdminProfilePageProps) {
  const { user, activeClinic, activeMembership, permissions } = session;

  const [section, setSection] = useState<ProfileSection>('account');
  const [avatarLoadError, setAvatarLoadError] = useState(false);

  // Personal Profile Form State
  const [fullName, setFullName] = useState(user.fullName);
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [savingProfile, setSavingProfile] = useState(false);

  // Clinic Workspace Form State
  const [clinicName, setClinicName] = useState(activeClinic?.name ?? '');
  const [clinicType, setClinicType] = useState(activeClinic?.clinicType ?? CLINIC_TYPES[0]);
  const [clinicPhone, setClinicPhone] = useState(activeClinic?.contactPhone ?? '');
  const [clinicEmail, setClinicEmail] = useState(activeClinic?.contactEmail ?? '');
  const [clinicLocation, setClinicLocation] = useState(activeClinic?.location ?? '');
  const [clinicNotes, setClinicNotes] = useState(activeClinic?.organizationNotes ?? '');
  const [savingClinic, setSavingClinic] = useState(false);
  const [seedingSample, setSeedingSample] = useState(false);

  // Security & Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);

  // Team & RBAC State
  const [teamLoading, setTeamLoading] = useState(false);
  const [members, setMembers] = useState<ClinicTeamMember[]>([]);
  const [invitations, setInvitations] = useState<ClinicInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<AccountRole>('Doctor');
  const [inviting, setInviting] = useState(false);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);

  // Verification Requests State (Doctor registrations & Patient portal link requests)
  const [verifLoading, setVerifLoading] = useState(false);
  const [doctorApps, setDoctorApps] = useState<DoctorApplication[]>([]);
  const [patientLinks, setPatientLinks] = useState<PatientLinkRequest[]>([]);
  const [clinicPatients, setClinicPatients] = useState<Patient[]>([]);
  const [matchPatientByRequest, setMatchPatientByRequest] = useState<Record<string, string>>({});
  const [reviewNotesById, setReviewNotesById] = useState<Record<string, string>>({});
  const [verifBusyId, setVerifBusyId] = useState<string | null>(null);

  useEffect(() => {
    setFullName(user.fullName);
    setPhoneNumber(user.phoneNumber);
    setAvatarUrl(user.avatarUrl);
    setAvatarLoadError(false);
  }, [user]);

  useEffect(() => {
    if (activeClinic) {
      setClinicName(activeClinic.name);
      setClinicType(activeClinic.clinicType);
      setClinicPhone(activeClinic.contactPhone);
      setClinicEmail(activeClinic.contactEmail);
      setClinicLocation(activeClinic.location);
      setClinicNotes(activeClinic.organizationNotes);
    }
  }, [activeClinic]);

  const loadTeam = useCallback(async () => {
    if (!activeClinic) return;
    setTeamLoading(true);
    try {
      const data = await fetchClinicMembers();
      setMembers(data.members);
      setInvitations(data.invitations);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load clinic team roster.');
    } finally {
      setTeamLoading(false);
    }
  }, [activeClinic, onErrorNotice]);

  const loadVerifications = useCallback(async () => {
    if (!activeClinic || (!permissions.canManageStaff && !permissions.canManageTeamRoles)) return;
    setVerifLoading(true);
    try {
      const [docs, links, pts] = await Promise.all([
        fetchDoctorApplications('All'),
        fetchPatientLinkRequests('All'),
        fetchPatients(),
      ]);
      setDoctorApps(docs);
      setPatientLinks(links);
      setClinicPatients(pts);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load verification requests.');
    } finally {
      setVerifLoading(false);
    }
  }, [activeClinic, permissions.canManageStaff, permissions.canManageTeamRoles, onErrorNotice]);

  useEffect(() => {
    if (section === 'team') {
      loadTeam();
    } else if (section === 'verifications') {
      loadVerifications();
    }
  }, [section, loadTeam, loadVerifications]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fullName.trim().length < 2) {
      onErrorNotice('Full name must be at least 2 characters.');
      return;
    }
    setSavingProfile(true);
    try {
      await updateAccountProfile({
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        avatarUrl: avatarUrl.trim(),
      });
      await updateFirebaseDisplayName(fullName.trim());
      await onSessionRefresh();
      onDataMutated();
      onSuccessNotice('Personal administrator profile updated.');
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to save personal profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveClinic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permissions.canManageClinicSettings) return;
    setSavingClinic(true);
    try {
      await updateClinicSettings({
        name: clinicName.trim(),
        clinicType: clinicType.trim(),
        contactPhone: clinicPhone.trim(),
        contactEmail: clinicEmail.trim(),
        location: clinicLocation.trim(),
        organizationNotes: clinicNotes.trim(),
      });
      await onSessionRefresh();
      onDataMutated();
      onSuccessNotice('Associated clinic workspace details saved.');
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to update clinic details.');
    } finally {
      setSavingClinic(false);
    }
  };

  const handleSeedSampleData = async () => {
    setSeedingSample(true);
    try {
      await seedSampleClinicData();
      onDataMutated();
      onSuccessNotice('Isolated synthetic starter dataset added to this clinic workspace.');
    } catch (err) {
      onErrorNotice(
        err instanceof Error ? err.message : 'Unable to load synthetic sample dataset.'
      );
    } finally {
      setSeedingSample(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecurityMessage(null);
    setSecurityError(null);
    if (newPassword.length < 6) {
      setSecurityError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setSecurityError('New passwords do not match.');
      return;
    }
    setUpdatingPassword(true);
    try {
      await changeUserPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setSecurityMessage('Your password has been updated.');
      onSuccessNotice('Account password changed successfully.');
    } catch (err) {
      setSecurityError(formatFirebaseAuthError(err));
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleSendPasswordReset = async () => {
    setSecurityMessage(null);
    setSecurityError(null);
    setSendingReset(true);
    try {
      await requestPasswordReset(user.email);
      setSecurityMessage(`Password reset email dispatched to ${user.email}.`);
    } catch (err) {
      setSecurityError(formatFirebaseAuthError(err));
    } finally {
      setSendingReset(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const result = await inviteClinicTeamMember({
        email: inviteEmail.trim(),
        fullName: inviteName.trim() || undefined,
        role: inviteRole,
      });
      setInviteEmail('');
      setInviteName('');
      onSuccessNotice(
        result.member
          ? `Added ${result.member.fullName} as ${result.member.role}.`
          : `Saved pending invitation for ${result.invitation?.email} (${result.invitation?.role}).`
      );
      await loadTeam();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to invite clinic member.');
    } finally {
      setInviting(false);
    }
  };

  const handleMemberUpdate = async (
    membershipId: string,
    patch: { role?: AccountRole; status?: MembershipStatus }
  ) => {
    setUpdatingMemberId(membershipId);
    try {
      await updateClinicTeamMember(membershipId, patch);
      await loadTeam();
      await onSessionRefresh();
      onSuccessNotice('Team member permissions updated.');
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to update team membership.');
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const handleApproveDoctor = async (app: DoctorApplication) => {
    setVerifBusyId(app.id);
    try {
      const res = await approveDoctorApplication(app.id, reviewNotesById[app.id]);
      onSuccessNotice(
        `Approved ${res.application.fullName} as Doctor (${res.staff.id}) in ${activeClinic?.name}.`
      );
      await loadVerifications();
      await onSessionRefresh();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to approve doctor application.');
    } finally {
      setVerifBusyId(null);
    }
  };

  const handleRejectDoctor = async (app: DoctorApplication) => {
    const reason = (reviewNotesById[app.id] ?? '').trim() || 'Credentials could not be verified.';
    setVerifBusyId(app.id);
    try {
      await rejectDoctorApplication(app.id, reason);
      onSuccessNotice(`Rejected doctor registration request for ${app.fullName}.`);
      await loadVerifications();
      await onSessionRefresh();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to reject doctor application.');
    } finally {
      setVerifBusyId(null);
    }
  };

  const handleApprovePatientLink = async (reqItem: PatientLinkRequest) => {
    setVerifBusyId(reqItem.id);
    try {
      const existingId = matchPatientByRequest[reqItem.id] || undefined;
      const res = await approvePatientLinkRequest(reqItem.id, existingId);
      onSuccessNotice(
        `Linked portal account for ${res.patient.fullName} (${res.patient.id}).`
      );
      await loadVerifications();
      await onSessionRefresh();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to approve patient link request.');
    } finally {
      setVerifBusyId(null);
    }
  };

  const handleRejectPatientLink = async (reqItem: PatientLinkRequest) => {
    const reason = (reviewNotesById[reqItem.id] ?? '').trim() || 'Identity could not be verified.';
    setVerifBusyId(reqItem.id);
    try {
      await rejectPatientLinkRequest(reqItem.id, reason);
      onSuccessNotice(`Rejected patient portal link request from ${reqItem.fullName}.`);
      await loadVerifications();
      await onSessionRefresh();
      onDataMutated();
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to reject patient link request.');
    } finally {
      setVerifBusyId(null);
    }
  };

  const providerLabel =
    user.authProvider === 'google.com' ? 'Google OAuth (Firebase)' : 'Email & Password (Firebase)';

  const canReviewVerifications = permissions.canManageStaff || permissions.canManageTeamRoles;
  const pendingVerificationsCount =
    (session.pendingDoctorApplications?.length ?? 0) +
    (session.pendingPatientLinkRequests?.length ?? 0);

  return (
    <div className="space-y-6">
      {/* Profile Header Card */}
      <section className="card-surface rounded-2xl overflow-hidden">
        <div className="bg-[#0B261C] px-6 py-6 text-white flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-center gap-4 min-w-0">
            {user.avatarUrl && !avatarLoadError ? (
              <img
                src={user.avatarUrl}
                alt={user.fullName}
                referrerPolicy="no-referrer"
                onError={() => setAvatarLoadError(true)}
                className="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-400/40 shrink-0"
              />
            ) : (
              <EditorialAvatar name={user.fullName} role="administrator" size="lg" />
            )}

            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-bold tracking-tight text-white truncate">
                  {user.fullName}
                </h2>
                <span className="font-mono text-xs text-emerald-300">
                  {activeMembership?.role ?? 'Clinic Administrator'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-emerald-100/80">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                  {user.email}
                </span>
                {user.phoneNumber && (
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    <Phone className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                    {user.phoneNumber}
                  </span>
                )}
                {activeClinic && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                    {activeClinic.name} ({activeClinic.id})
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onSignOut}
              className="btn-press inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#12382A] hover:bg-[#194A38] border border-emerald-400/25 rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              Sign Out
            </button>
          </div>
        </div>

        {/* Profile Section Navigation */}
        <div
          className="px-6 bg-white border-b border-[#E3E8E4] flex items-center gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Administrator profile sections"
        >
          {[
            { id: 'account', label: 'Account Details', icon: User },
            { id: 'clinic', label: 'Associated Clinic', icon: Building2 },
            { id: 'security', label: 'Security & Isolation', icon: ShieldCheck },
            { id: 'team', label: 'Team & Roles (RBAC)', icon: Users },
            ...(canReviewVerifications
              ? [
                  {
                    id: 'verifications',
                    label:
                      pendingVerificationsCount > 0
                        ? `Verification Requests (${pendingVerificationsCount})`
                        : 'Verification Requests',
                    icon: ClipboardCheck,
                  },
                ]
              : []),
          ].map((tab) => {
            const Icon = tab.icon;
            const active = section === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSection(tab.id as ProfileSection)}
                className={`inline-flex items-center gap-2 px-4 py-3.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-[#059669] text-[#0B261C]'
                    : 'border-transparent text-[#526259] hover:text-[#111C17]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 1: Account Details & Permissions */}
      {section === 'account' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-7 card-surface rounded-xl p-6 space-y-5">
            <div className="border-b border-[#E3E8E4] pb-3.5">
              <h3 className="text-base font-semibold text-[#111C17]">
                Personal Account Information
              </h3>
              <p className="text-xs text-[#526259] mt-0.5">
                Update your administrator display name, phone number, or avatar image URL.
              </p>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="profile-full-name"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Full Name
                  </label>
                  <input
                    id="profile-full-name"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-phone"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Phone Number
                  </label>
                  <input
                    id="profile-phone"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+1-555-0192"
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="profile-email"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Verified Account Email
                  </label>
                  <input
                    id="profile-email"
                    type="email"
                    disabled
                    value={user.email}
                    className="w-full px-3 py-2 text-sm bg-[#F6F8F6] text-[#526259] border border-[#E3E8E4] rounded-lg"
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-role"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Assigned Clinic Role
                  </label>
                  <input
                    id="profile-role"
                    type="text"
                    disabled
                    value={activeMembership?.role ?? 'Clinic Administrator'}
                    className="w-full px-3 py-2 text-sm bg-[#F6F8F6] text-[#047857] font-medium border border-[#E3E8E4] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="profile-avatar-url"
                  className="block text-xs font-medium text-[#111C17] mb-1"
                >
                  Profile Photograph URL (Optional)
                </label>
                <input
                  id="profile-avatar-url"
                  type="url"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]/25 focus:border-[#059669]"
                />
              </div>

              <div className="pt-2 flex justify-end border-t border-[#E3E8E4]">
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="btn-press px-4 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors disabled:opacity-60"
                >
                  {savingProfile ? 'Saving Profile...' : 'Save Account Changes'}
                </button>
              </div>
            </form>
          </section>

          <section className="lg:col-span-5 card-surface rounded-xl p-6 space-y-4">
            <div className="border-b border-[#E3E8E4] pb-3.5">
              <h3 className="text-base font-semibold text-[#111C17]">Role Permissions Matrix</h3>
              <p className="text-xs text-[#526259] mt-0.5">
                Backend-enforced capabilities for{' '}
                <span className="font-semibold text-[#0B261C]">
                  {activeMembership?.role ?? 'Clinic Administrator'}
                </span>
              </p>
            </div>

            <dl className="divide-y divide-[#EEF2EF] text-xs">
              {[
                ['View Clinic Records & Reports', permissions.canViewRecords],
                ['Register & Edit Patients', permissions.canManagePatients],
                ['Schedule & Update Appointments', permissions.canManageAppointments],
                ['Delete Appointments', permissions.canDeleteAppointments],
                ['Manage Follow-up Queue', permissions.canManageFollowups],
                ['Manage Staff Directory', permissions.canManageStaff],
                ['View Security & Audit History', permissions.canViewAuditHistory],
                ['Manage Clinic Workspace Settings', permissions.canManageClinicSettings],
                ['Invite & Assign Team Roles', permissions.canManageTeamRoles],
              ].map(([label, allowed]) => (
                <div key={String(label)} className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[#34433B]">{label}</dt>
                  <dd
                    className={`font-mono font-semibold ${
                      allowed ? 'text-[#047857]' : 'text-[#6C7B73]'
                    }`}
                  >
                    {allowed ? 'Allowed' : 'Restricted'}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}

      {/* Section 2: Associated Clinic Workspace */}
      {section === 'clinic' && activeClinic && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-8 card-surface rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-[#E3E8E4] pb-3.5">
              <div>
                <h3 className="text-base font-semibold text-[#111C17]">
                  Associated Clinic Workspace
                </h3>
                <p className="text-xs text-[#526259] mt-0.5">
                  Clinic identifier <span className="font-mono">{activeClinic.id}</span> ·{' '}
                  {permissions.canManageClinicSettings
                    ? 'Editable by Clinic Administrator'
                    : 'Read-only for your current role'}
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveClinic} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="clinic-edit-name"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Clinic Name
                  </label>
                  <input
                    id="clinic-edit-name"
                    type="text"
                    required
                    disabled={!permissions.canManageClinicSettings}
                    value={clinicName}
                    onChange={(e) => setClinicName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg disabled:bg-[#F6F8F6] disabled:text-[#526259]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="clinic-edit-type"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Clinic Type
                  </label>
                  <input
                    id="clinic-edit-type"
                    type="text"
                    required
                    disabled={!permissions.canManageClinicSettings}
                    value={clinicType}
                    onChange={(e) => setClinicType(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg disabled:bg-[#F6F8F6] disabled:text-[#526259]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="clinic-edit-phone"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Clinic Contact Phone
                  </label>
                  <input
                    id="clinic-edit-phone"
                    type="tel"
                    required
                    disabled={!permissions.canManageClinicSettings}
                    value={clinicPhone}
                    onChange={(e) => setClinicPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg disabled:bg-[#F6F8F6] disabled:text-[#526259]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="clinic-edit-email"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Clinic Contact Email
                  </label>
                  <input
                    id="clinic-edit-email"
                    type="email"
                    required
                    disabled={!permissions.canManageClinicSettings}
                    value={clinicEmail}
                    onChange={(e) => setClinicEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg disabled:bg-[#F6F8F6] disabled:text-[#526259]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="clinic-edit-location"
                  className="block text-xs font-medium text-[#111C17] mb-1"
                >
                  Location
                </label>
                <div className="relative">
                  <MapPin
                    className="w-4 h-4 text-[#6C7B73] absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    id="clinic-edit-location"
                    type="text"
                    required
                    disabled={!permissions.canManageClinicSettings}
                    value={clinicLocation}
                    onChange={(e) => setClinicLocation(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-[#D4DAD4] rounded-lg disabled:bg-[#F6F8F6] disabled:text-[#526259]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="clinic-edit-notes"
                  className="block text-xs font-medium text-[#111C17] mb-1"
                >
                  Organization Notes
                </label>
                <textarea
                  id="clinic-edit-notes"
                  rows={3}
                  disabled={!permissions.canManageClinicSettings}
                  value={clinicNotes}
                  onChange={(e) => setClinicNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg disabled:bg-[#F6F8F6] disabled:text-[#526259]"
                />
              </div>

              {permissions.canManageClinicSettings && (
                <div className="pt-2 flex justify-end border-t border-[#E3E8E4]">
                  <button
                    type="submit"
                    disabled={savingClinic}
                    className="btn-press px-4 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors disabled:opacity-60"
                  >
                    {savingClinic ? 'Saving Clinic...' : 'Save Clinic Workspace'}
                  </button>
                </div>
              )}
            </form>
          </section>

          <section className="lg:col-span-4 card-surface rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-[#E3E8E4] pb-3.5">
              <Database className="w-4 h-4 text-[#047857]" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-[#111C17]">Workspace Data Boundary</h3>
            </div>
            <p className="text-xs text-[#34433B] leading-relaxed">
              Every patient, staff profile, appointment slot, follow-up task, and operational
              report created inside <span className="font-semibold">{activeClinic.name}</span> is
              isolated under tenant key{' '}
              <code className="font-mono text-[#047857]">{activeClinic.id}</code>.
            </p>
            {permissions.canManageClinicSettings && (
              <div className="pt-3 border-t border-[#E3E8E4] space-y-2.5">
                <div className="text-xs font-medium text-[#111C17]">
                  Empty Workspace Evaluation Data
                </div>
                <p className="text-[11px] text-[#526259] leading-relaxed">
                  If this clinic currently has zero patient records, you can load an isolated
                  synthetic starter dataset scoped solely to {activeClinic.id}.
                </p>
                <button
                  type="button"
                  disabled={seedingSample}
                  onClick={handleSeedSampleData}
                  className="btn-press w-full px-3.5 py-2 text-xs font-medium text-[#0B261C] bg-[#ECF4EF] hover:bg-[#DCECE2] border border-[#C6DFD1] rounded-lg transition-colors disabled:opacity-60"
                >
                  {seedingSample ? 'Loading Sample Dataset...' : 'Load Isolated Sample Data'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Section 3: Security & Clinic Isolation */}
      {section === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-6 card-surface rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-[#E3E8E4] pb-3.5">
              <KeyRound className="w-4 h-4 text-[#047857]" aria-hidden="true" />
              <div>
                <h3 className="text-base font-semibold text-[#111C17]">
                  Authentication &amp; Password Security
                </h3>
                <p className="text-xs text-[#526259]">
                  Provider: <span className="font-medium text-[#111C17]">{providerLabel}</span>
                </p>
              </div>
            </div>

            {securityError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{securityError}</span>
              </div>
            )}

            {securityMessage && (
              <div className="p-3 rounded-lg bg-[#ECF4EF] border border-[#B7DFCA] text-xs text-[#0B261C] flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0 mt-0.5" aria-hidden="true" />
                <span>{securityMessage}</span>
              </div>
            )}

            {user.authProvider === 'password' ? (
              <form onSubmit={handleChangePassword} className="space-y-3.5">
                <div>
                  <label
                    htmlFor="sec-current-pw"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Current Password
                  </label>
                  <input
                    id="sec-current-pw"
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sec-new-pw"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    New Password
                  </label>
                  <input
                    id="sec-new-pw"
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sec-confirm-pw"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Confirm New Password
                  </label>
                  <input
                    id="sec-confirm-pw"
                    type="password"
                    required
                    minLength={6}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    disabled={sendingReset}
                    onClick={handleSendPasswordReset}
                    className="text-xs font-medium text-[#047857] hover:underline disabled:opacity-50"
                  >
                    {sendingReset ? 'Sending reset link...' : 'Email password reset link instead'}
                  </button>
                  <button
                    type="submit"
                    disabled={updatingPassword}
                    className="btn-press px-4 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-60"
                  >
                    {updatingPassword ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-4 rounded-xl bg-[#F6F8F6] border border-[#E3E8E4] space-y-2 text-xs text-[#34433B]">
                <div className="font-semibold text-[#111C17] flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                  Managed by Google Identity
                </div>
                <p className="leading-relaxed">
                  Your session is authenticated through Google OAuth via Firebase Authentication.
                  Password policies and two-factor authentication are managed in your Google
                  Account security settings.
                </p>
              </div>
            )}
          </section>

          <section className="lg:col-span-6 card-surface rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-[#E3E8E4] pb-3.5">
              <ShieldCheck className="w-4 h-4 text-[#047857]" aria-hidden="true" />
              <h3 className="text-base font-semibold text-[#111C17]">
                Session &amp; Clinic Isolation Policy
              </h3>
            </div>
            <dl className="divide-y divide-[#EEF2EF] text-xs">
              <div className="py-2.5 flex items-center justify-between gap-2">
                <dt className="text-[#526259]">Account ID</dt>
                <dd className="font-mono text-[#111C17]">{user.id}</dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-2">
                <dt className="text-[#526259]">Authorized Clinic Boundary</dt>
                <dd className="font-mono text-[#047857]">
                  {activeClinic ? `${activeClinic.name} (${activeClinic.id})` : 'Unassigned'}
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-2">
                <dt className="text-[#526259]">Membership Created</dt>
                <dd className="font-mono text-[#111C17]">
                  {activeMembership ? activeMembership.createdAt.slice(0, 10) : '—'}
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-2">
                <dt className="text-[#526259]">Backend Verification</dt>
                <dd className="font-mono text-[#047857]">Firebase Bearer JWT + X-Clinic-Id</dd>
              </div>
            </dl>
            <div className="pt-2">
              <button
                type="button"
                onClick={onSignOut}
                className="btn-press inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                Sign Out of All CareDesk Sessions
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Section 4: Team & RBAC Management */}
      {section === 'team' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-8 card-surface rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E3E8E4] flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[#111C17]">
                  Clinic Members &amp; Role Assignments
                </h3>
                <p className="text-xs text-[#526259]">
                  Authorized accounts scoped to {activeClinic?.name}
                </p>
              </div>
              <span className="text-xs font-mono text-[#526259]">
                {members.length} active record{members.length === 1 ? '' : 's'}
              </span>
            </div>

            {teamLoading ? (
              <div className="p-6 text-xs text-[#526259]">Loading clinic team...</div>
            ) : (
              <div className="divide-y divide-[#EEF2EF]">
                {members.map((member) => {
                  const busy = updatingMemberId === member.membershipId;
                  return (
                    <div
                      key={member.membershipId}
                      className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <EditorialAvatar
                          name={member.fullName}
                          role={member.role === 'Doctor' ? 'clinician' : 'administrator'}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#111C17] truncate">
                            {member.fullName}
                            {member.userId === user.id && (
                              <span className="ml-2 text-[11px] font-mono text-[#047857]">
                                (You)
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#526259] truncate">{member.email}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {permissions.canManageTeamRoles ? (
                          <>
                            <select
                              aria-label={`Role for ${member.fullName}`}
                              disabled={busy}
                              value={member.role}
                              onChange={(e) =>
                                handleMemberUpdate(member.membershipId, {
                                  role: e.target.value as AccountRole,
                                })
                              }
                              className="px-2.5 py-1.5 text-xs font-medium border border-[#D4DAD4] rounded-lg bg-white"
                            >
                              {ACCOUNT_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                            <select
                              aria-label={`Status for ${member.fullName}`}
                              disabled={busy}
                              value={member.status}
                              onChange={(e) =>
                                handleMemberUpdate(member.membershipId, {
                                  status: e.target.value as MembershipStatus,
                                })
                              }
                              className="px-2.5 py-1.5 text-xs font-medium border border-[#D4DAD4] rounded-lg bg-white"
                            >
                              <option value="Active">Active</option>
                              <option value="Suspended">Suspended</option>
                            </select>
                          </>
                        ) : (
                          <span className="text-xs font-mono text-[#047857]">
                            {member.role} · {member.status}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {invitations.length > 0 && (
              <div className="border-t border-[#E3E8E4] bg-[#F6F8F6] px-6 py-4 space-y-2.5">
                <div className="text-xs font-semibold text-[#111C17]">Pending Invitations</div>
                <div className="divide-y divide-[#E3E8E4]">
                  {invitations.map((inv) => (
                    <div
                      key={inv.id}
                      className="py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-medium text-[#111C17]">{inv.email}</span>
                        {inv.fullName && (
                          <span className="text-[#526259]"> · {inv.fullName}</span>
                        )}
                      </div>
                      <span className="font-mono text-[#047857]">
                        {inv.role} · {inv.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="lg:col-span-4 card-surface rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-[#E3E8E4] pb-3.5">
              <UserPlus className="w-4 h-4 text-[#047857]" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-[#111C17]">Invite Clinic Team Member</h3>
            </div>

            {permissions.canManageTeamRoles ? (
              <form onSubmit={handleInviteMember} className="space-y-3.5">
                <p className="text-xs text-[#526259] leading-relaxed">
                  Pre-authorize a Doctor, Receptionist, Clinic Staff member, or co-administrator.
                  When they sign in with this email, they automatically join{' '}
                  <span className="font-medium text-[#111C17]">{activeClinic?.name}</span>.
                </p>

                <div>
                  <label
                    htmlFor="invite-email"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Staff Email Address
                  </label>
                  <input
                    id="invite-email"
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="clinician@yourclinic.org"
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>

                <div>
                  <label
                    htmlFor="invite-name"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Full Name (Optional)
                  </label>
                  <input
                    id="invite-name"
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Dr. Elena Brooks"
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>

                <div>
                  <label
                    htmlFor="invite-role"
                    className="block text-xs font-medium text-[#111C17] mb-1"
                  >
                    Assigned Role
                  </label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as AccountRole)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    {ACCOUNT_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={inviting}
                  className="btn-press w-full py-2 px-4 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-60"
                >
                  {inviting ? 'Sending Invitation...' : 'Authorize & Invite Member'}
                </button>
              </form>
            ) : (
              <p className="text-xs text-[#526259] leading-relaxed">
                Only a Clinic Administrator can invite staff members or modify clinic RBAC role
                assignments.
              </p>
            )}
          </section>
        </div>
      )}

      {/* Section 5: Doctor & Patient Verification Requests */}
      {section === 'verifications' && canReviewVerifications && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Doctor Verification Queue */}
          <section className="lg:col-span-6 card-surface rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E3E8E4] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Doctor Registration Requests
                  </h3>
                  <p className="text-xs text-[#526259]">
                    Verify medical credentials before granting Doctor Workspace access
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono text-[#526259]">{doctorApps.length} total</span>
            </div>

            {verifLoading ? (
              <div className="p-6 text-xs text-[#526259]">Loading doctor applications...</div>
            ) : doctorApps.length === 0 ? (
              <div className="p-6 text-xs text-[#526259]">
                No doctor registration requests submitted for {activeClinic?.name}.
              </div>
            ) : (
              <div className="divide-y divide-[#EEF2EF]">
                {doctorApps.map((app) => {
                  const busy = verifBusyId === app.id;
                  return (
                    <div key={app.id} className="p-5 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-[#111C17]">
                            {app.fullName}
                          </div>
                          <div className="text-xs text-[#526259]">
                            {app.department} · {app.specialty}
                          </div>
                          <div className="text-[11px] font-mono text-[#526259] mt-0.5">
                            {app.email} {app.phoneNumber ? `· ${app.phoneNumber}` : ''}
                          </div>
                        </div>
                        <VerificationStatusText status={app.status} />
                      </div>

                      <div className="p-3 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4] text-xs space-y-1">
                        <div>
                          <span className="text-[#526259]">Qualifications: </span>
                          <span className="font-medium text-[#111C17]">{app.qualifications}</span>
                        </div>
                        <div>
                          <span className="text-[#526259]">License #: </span>
                          <span className="font-mono text-[#0B261C]">{app.licenseNumber}</span>
                        </div>
                        {app.bio && <p className="text-[#526259] pt-1">{app.bio}</p>}
                      </div>

                      {app.status === 'Pending Verification' ? (
                        <div className="space-y-2.5">
                          <input
                            type="text"
                            value={reviewNotesById[app.id] ?? ''}
                            onChange={(e) =>
                              setReviewNotesById((prev) => ({
                                ...prev,
                                [app.id]: e.target.value,
                              }))
                            }
                            placeholder="Optional approval or rejection note..."
                            className="w-full px-3 py-1.5 text-xs border border-[#D4DAD4] rounded-lg"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleApproveDoctor(app)}
                              className="btn-press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                              Approve Doctor
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleRejectDoctor(app)}
                              className="btn-press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                              Reject
                            </button>
                          </div>
                        </div>
                      ) : (
                        app.reviewNotes && (
                          <div className="text-[11px] text-[#526259]">
                            Review notes: {app.reviewNotes}
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Patient Portal Link Request Queue */}
          <section className="lg:col-span-6 card-surface rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E3E8E4] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HeartPulse className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-[#111C17]">
                    Patient Portal Link Requests
                  </h3>
                  <p className="text-xs text-[#526259]">
                    Match to an existing chart or create a new verified patient record
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono text-[#526259]">{patientLinks.length} total</span>
            </div>

            {verifLoading ? (
              <div className="p-6 text-xs text-[#526259]">Loading patient link requests...</div>
            ) : patientLinks.length === 0 ? (
              <div className="p-6 text-xs text-[#526259]">
                No patient link requests submitted for {activeClinic?.name}.
              </div>
            ) : (
              <div className="divide-y divide-[#EEF2EF]">
                {patientLinks.map((reqItem) => {
                  const busy = verifBusyId === reqItem.id;
                  return (
                    <div key={reqItem.id} className="p-5 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-[#111C17]">
                            {reqItem.fullName}
                          </div>
                          <div className="text-xs font-mono text-[#526259]">
                            DOB {reqItem.dateOfBirth} · {reqItem.email}
                          </div>
                          {reqItem.phoneNumber && (
                            <div className="text-[11px] font-mono text-[#526259]">
                              Phone: {reqItem.phoneNumber}
                            </div>
                          )}
                        </div>
                        <VerificationStatusText status={reqItem.status} />
                      </div>

                      {reqItem.notes && (
                        <div className="p-2.5 rounded-lg bg-[#F6F8F6] border border-[#E3E8E4] text-xs text-[#34433B]">
                          {reqItem.notes}
                        </div>
                      )}

                      {reqItem.status === 'Pending' ? (
                        <div className="space-y-2.5">
                          <div>
                            <label
                              htmlFor={`match-pt-${reqItem.id}`}
                              className="block text-[11px] font-medium text-[#526259] mb-1"
                            >
                              Link to Existing Patient Chart (or create new chart)
                            </label>
                            <select
                              id={`match-pt-${reqItem.id}`}
                              value={matchPatientByRequest[reqItem.id] ?? ''}
                              onChange={(e) =>
                                setMatchPatientByRequest((prev) => ({
                                  ...prev,
                                  [reqItem.id]: e.target.value,
                                }))
                              }
                              className="w-full px-3 py-1.5 text-xs border border-[#D4DAD4] rounded-lg bg-white"
                            >
                              <option value="">Create New Patient Chart for {reqItem.fullName}</option>
                              {clinicPatients.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.id} — {p.fullName} (DOB {p.dateOfBirth})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleApprovePatientLink(reqItem)}
                              className="btn-press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                              Approve &amp; Link Patient
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleRejectPatientLink(reqItem)}
                              className="btn-press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                              Reject
                            </button>
                          </div>
                        </div>
                      ) : (
                        reqItem.linkedPatientId && (
                          <div className="text-[11px] font-mono text-[#047857]">
                            Linked Patient Chart: {reqItem.linkedPatientId}
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
