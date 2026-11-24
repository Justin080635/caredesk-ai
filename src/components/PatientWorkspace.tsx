import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Bot,
  Building2,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Clock,
  HeartPulse,
  Home,
  LogOut,
  Menu,
  RefreshCw,
  Stethoscope,
  UserCircle,
  X,
} from 'lucide-react';
import {
  bookPatientPortalAppointment,
  fetchNotifications,
  fetchPatientPortalAppointments,
  fetchPatientPortalAvailability,
  fetchPatientPortalHealth,
  fetchPatientPortalHome,
  markAllNotificationsRead,
  markNotificationRead,
  requestPatientCancellation,
  requestPatientReschedule,
  updatePatientPortalProfile,
} from '../client/api';
import { APPOINTMENT_TYPES } from '../shared/constants';
import type {
  AccountSessionState,
  Appointment,
  AppointmentType,
  AvailableSlot,
  DoctorAvailabilitySummary,
  NotificationItem,
  PatientHomeData,
  PatientPortalHealthData,
} from '../shared/types';
import { AssistantView } from './AssistantView';
import { EditorialAvatar } from './ClinicIllustrations';
import { ModalShell } from './ModalShell';
import {
  AppointmentStatusText,
  DoctorDutyStatusText,
  FollowUpStatusText,
  RequestStatusText,
} from './StatusText';

type PatientTab = 'home' | 'appointments' | 'health' | 'profile' | 'notifications' | 'assistant';

interface PatientWorkspaceProps {
  session: AccountSessionState;
  onSessionRefresh: () => Promise<void>;
  onSwitchClinic: (clinicId: string) => Promise<void>;
  onSignOut: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
}

const PATIENT_NAV: Array<{
  id: PatientTab;
  label: string;
  icon: typeof Home;
}> = [
  { id: 'home', label: 'My Home', icon: Home },
  { id: 'appointments', label: 'My Appointments', icon: Calendar },
  { id: 'health', label: 'My Health', icon: HeartPulse },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'profile', label: 'My Profile', icon: UserCircle },
  { id: 'assistant', label: 'AI Assistant', icon: Bot },
];

export function PatientWorkspace({
  session,
  onSessionRefresh,
  onSwitchClinic,
  onSignOut,
  onErrorNotice,
  onSuccessNotice,
}: PatientWorkspaceProps) {
  const { activeClinic, clinics, linkedPatient } = session;

  const [activeTab, setActiveTab] = useState<PatientTab>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);

  // Home & Data
  const [homeData, setHomeData] = useState<PatientHomeData | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [healthData, setHealthData] = useState<PatientPortalHealthData | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Booking Flow State
  const [showBooking, setShowBooking] = useState(false);
  const [bookDepartment, setBookDepartment] = useState('');
  const [bookType, setBookType] = useState<AppointmentType>('Consultation');
  const [availDoctors, setAvailDoctors] = useState<DoctorAvailabilitySummary[]>([]);
  const [availSlots, setAvailSlots] = useState<AvailableSlot[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [bookNotes, setBookNotes] = useState('');
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [submittingBooking, setSubmittingBooking] = useState(false);

  // Reschedule / Cancel Request Modals
  const [reschedApt, setReschedApt] = useState<Appointment | null>(null);
  const [reschedSlots, setReschedSlots] = useState<AvailableSlot[]>([]);
  const [reschedChosen, setReschedChosen] = useState<AvailableSlot | null>(null);
  const [reschedNotes, setReschedNotes] = useState('');
  const [cancelApt, setCancelApt] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);

  // Profile State
  const [profPhone, setProfPhone] = useState(linkedPatient?.contactNumber ?? '');
  const [profEmail, setProfEmail] = useState(linkedPatient?.email ?? '');
  const [profEmergName, setProfEmergName] = useState(linkedPatient?.emergencyContactName ?? '');
  const [profEmergPhone, setProfEmergPhone] = useState(linkedPatient?.emergencyContactPhone ?? '');
  const [savingProfile, setSavingProfile] = useState(false);

  const loadAllPortalData = useCallback(async () => {
    setLoading(true);
    try {
      const [home, apts, health, notifs] = await Promise.all([
        fetchPatientPortalHome(),
        fetchPatientPortalAppointments(),
        fetchPatientPortalHealth(),
        fetchNotifications(30),
      ]);
      setHomeData(home);
      setAppointments(apts);
      setHealthData(health);
      setNotifications(notifs.items);
      setUnreadCount(notifs.unreadCount);
      setProfPhone(home.patient.contactNumber ?? '');
      setProfEmail(home.patient.email ?? '');
      setProfEmergName(home.patient.emergencyContactName ?? '');
      setProfEmergPhone(home.patient.emergencyContactPhone ?? '');
      if (!bookDepartment && home.availableSpecialties.length > 0) {
        setBookDepartment(home.availableSpecialties[0]);
      }
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to load your patient portal.');
    } finally {
      setLoading(false);
    }
  }, [bookDepartment, onErrorNotice]);

  useEffect(() => {
    loadAllPortalData();
  }, [loadAllPortalData, refreshSignal]);

  const loadBookingAvailability = useCallback(
    async (dept: string, type: AppointmentType, staffId?: string) => {
      setLoadingAvail(true);
      try {
        const res = await fetchPatientPortalAvailability({
          department: dept || undefined,
          appointmentType: type,
          staffId: staffId || undefined,
          days: 7,
          limit: 24,
        });
        setAvailDoctors(res.doctors);
        setAvailSlots(res.slots);
      } catch (err) {
        onErrorNotice(err instanceof Error ? err.message : 'Unable to fetch open doctor slots.');
      } finally {
        setLoadingAvail(false);
      }
    },
    [onErrorNotice]
  );

  useEffect(() => {
    if (showBooking) {
      void loadBookingAvailability(bookDepartment, bookType, selectedDoctorId);
    }
  }, [showBooking, bookDepartment, bookType, selectedDoctorId, loadBookingAvailability]);

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot) {
      onErrorNotice('Select an available appointment slot first.');
      return;
    }
    setSubmittingBooking(true);
    try {
      const created = await bookPatientPortalAppointment({
        staffId: selectedSlot.staffId,
        clinician: selectedSlot.clinician,
        department: selectedSlot.department,
        appointmentType: bookType,
        appointmentDate: selectedSlot.date,
        appointmentTime: selectedSlot.time,
        notes: bookNotes.trim(),
      });
      setShowBooking(false);
      setSelectedSlot(null);
      setBookNotes('');
      onSuccessNotice(
        `Appointment ${created.id} booked for ${created.appointmentDate} at ${created.appointmentTime} with ${created.clinician}.`
      );
      setRefreshSignal((s) => s + 1);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to book appointment.');
    } finally {
      setSubmittingBooking(false);
    }
  };

  const openRescheduleModal = async (apt: Appointment) => {
    setReschedApt(apt);
    setReschedChosen(null);
    setReschedNotes('');
    try {
      const avail = await fetchPatientPortalAvailability({
        department: apt.department,
        staffId: apt.staffId ?? undefined,
        days: 7,
        limit: 12,
      });
      setReschedSlots(avail.slots);
    } catch {
      setReschedSlots([]);
    }
  };

  const handleSubmitRescheduleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reschedApt || !reschedChosen) return;
    setRequestBusy(true);
    try {
      await requestPatientReschedule(reschedApt.id, {
        requestedDate: reschedChosen.date,
        requestedTime: reschedChosen.time,
        notes: reschedNotes.trim(),
      });
      setReschedApt(null);
      onSuccessNotice(
        `Reschedule request submitted for ${reschedChosen.date} at ${reschedChosen.time}. Clinic staff will review shortly.`
      );
      setRefreshSignal((s) => s + 1);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to submit reschedule request.');
    } finally {
      setRequestBusy(false);
    }
  };

  const handleSubmitCancelRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelApt) return;
    setRequestBusy(true);
    try {
      await requestPatientCancellation(cancelApt.id, cancelReason.trim());
      setCancelApt(null);
      setCancelReason('');
      onSuccessNotice(`Cancellation request submitted for ${cancelApt.id}.`);
      setRefreshSignal((s) => s + 1);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to submit cancellation request.');
    } finally {
      setRequestBusy(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updatePatientPortalProfile({
        contactNumber: profPhone.trim(),
        email: profEmail.trim(),
        emergencyContactName: profEmergName.trim(),
        emergencyContactPhone: profEmergPhone.trim(),
      });
      await onSessionRefresh();
      setRefreshSignal((s) => s + 1);
      onSuccessNotice('Your contact & emergency details have been updated.');
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Unable to update patient profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const patientRecord = homeData?.patient ?? linkedPatient;

  const renderNav = (isMobile = false) => (
    <nav className="flex-1 px-3 py-4 space-y-1.5" aria-label="Patient Portal Navigation">
      <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200/50">
        Patient Portal
      </div>
      {PATIENT_NAV.map((item) => {
        const Icon = item.icon;
        const active = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setActiveTab(item.id);
              if (isMobile) setMobileMenuOpen(false);
            }}
            aria-current={active ? 'page' : undefined}
            className={`btn-press w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              active
                ? 'bg-[#059669] text-white'
                : 'text-emerald-100/80 hover:bg-[#12382A] hover:text-white'
            }`}
          >
            <span className="inline-flex items-center gap-3">
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
            </span>
            {item.id === 'notifications' && unreadCount > 0 && (
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[#071D15] text-emerald-300">
                {unreadCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-[#F6F8F6] text-[#111C17]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen w-60 shrink-0 bg-[#0B261C] text-emerald-50 border-r border-[#174333]">
        <div className="px-4 py-4 border-b border-[#174333] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#059669] text-white flex items-center justify-center shrink-0">
            <HeartPulse className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold text-white truncate">CareDesk AI</div>
            <div className="text-[11px] text-emerald-200/75 truncate">{activeClinic?.name}</div>
          </div>
        </div>

        {clinics.length > 1 && (
          <div className="px-3 pt-3">
            <select
              aria-label="Switch clinic"
              value={activeClinic?.id ?? ''}
              onChange={(e) => onSwitchClinic(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-[#071D15] text-emerald-100 border border-[#174333] rounded-lg"
            >
              {clinics.map((c) => (
                <option key={c.clinic.id} value={c.clinic.id}>
                  {c.clinic.name} ({c.membership.role})
                </option>
              ))}
            </select>
          </div>
        )}

        {renderNav(false)}

        <div className="p-3.5 border-t border-[#174333] space-y-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-[#071D15] hover:bg-[#12382A] text-left"
          >
            <EditorialAvatar
              name={patientRecord?.fullName ?? session.user.fullName}
              role="patient"
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-white truncate">
                {patientRecord?.fullName ?? session.user.fullName}
              </div>
              <div className="text-[11px] font-mono text-emerald-300 truncate">
                Patient · {patientRecord?.id ?? 'Verified'}
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium text-emerald-100/85 hover:text-white bg-[#071D15] hover:bg-[#12382A] border border-[#174333] rounded-lg"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-64 max-w-[82vw] bg-[#0B261C] text-emerald-50 flex flex-col z-10">
            <div className="px-5 py-4 border-b border-[#174333] flex items-center justify-between">
              <div className="text-base font-bold text-white">Patient Portal</div>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-1 text-emerald-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderNav(true)}
            <div className="p-4 border-t border-[#174333]">
              <button
                type="button"
                onClick={onSignOut}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-[#071D15] border border-[#174333] rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-[#E3E8E4] px-4 sm:px-6 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-[#526259] hover:text-[#111C17] rounded-lg"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#526259]">
                <Building2 className="w-3 h-3 text-[#047857]" aria-hidden="true" />
                <span className="font-medium text-[#111C17]">{activeClinic?.name}</span>
                {patientRecord && (
                  <>
                    <span>·</span>
                    <span className="font-mono text-[#047857]">{patientRecord.id}</span>
                  </>
                )}
              </div>
              <h1 className="text-base sm:text-lg font-semibold text-[#111C17] truncate">
                {PATIENT_NAV.find((n) => n.id === activeTab)?.label ?? 'My Home'}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveTab('appointments');
                setShowBooking(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg whitespace-nowrap shrink-0"
            >
              <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
              Book Appointment
            </button>
            <button
              type="button"
              onClick={() => setRefreshSignal((s) => s + 1)}
              className="p-2 text-[#526259] hover:text-[#111C17] border border-[#E3E8E4] rounded-lg hover:bg-[#F6F8F6]"
              aria-label="Refresh portal"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1320px] w-full mx-auto space-y-6">
          {/* TAB 1: MY HOME */}
          {activeTab === 'home' && (
            <div className="space-y-6 animate-view-enter">
              {loading && !homeData ? (
                <div className="h-44 card-surface rounded-xl animate-pulse" />
              ) : homeData ? (
                <>
                  <section className="bg-[#0B261C] text-white rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-5">
                    <div className="space-y-1.5">
                      <div className="text-xs font-mono text-emerald-300">
                        Verified Patient Record · {homeData.patient.id}
                      </div>
                      <h2 className="text-2xl font-bold">Welcome, {homeData.patient.fullName}</h2>
                      <p className="text-xs text-emerald-100/80">
                        Connected to {homeData.clinic.name} ({homeData.clinic.location}) ·{' '}
                        {homeData.clinic.contactPhone}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('appointments');
                          setShowBooking(true);
                        }}
                        className="px-4 py-2 text-xs font-semibold text-[#0B261C] bg-white hover:bg-[#ECF4EF] rounded-lg whitespace-nowrap"
                      >
                        Schedule a Visit
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('health')}
                        className="px-4 py-2 text-xs font-semibold text-white bg-[#174333] hover:bg-[#1E5440] border border-emerald-400/20 rounded-lg whitespace-nowrap"
                      >
                        View My Health Summary
                      </button>
                    </div>
                  </section>

                  <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="card-surface rounded-xl p-5 space-y-2">
                      <div className="text-xs font-medium text-[#526259]">Next Appointment</div>
                      {homeData.nextAppointment ? (
                        <>
                          <div className="text-base font-bold font-mono text-[#0B261C]">
                            {homeData.nextAppointment.appointmentDate} ·{' '}
                            {homeData.nextAppointment.appointmentTime}
                          </div>
                          <div className="text-xs text-[#34433B]">
                            {homeData.nextAppointment.clinician} ({homeData.nextAppointment.department})
                          </div>
                          <AppointmentStatusText status={homeData.nextAppointment.status} />
                        </>
                      ) : (
                        <div className="text-xs text-[#526259]">
                          No upcoming appointments currently scheduled.
                        </div>
                      )}
                    </div>

                    <div className="card-surface rounded-xl p-5 space-y-2">
                      <div className="text-xs font-medium text-[#526259]">Open Follow-up Reminders</div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-[#111C17]">
                        {homeData.openFollowups.length}
                      </div>
                      <div className="text-xs text-[#526259]">
                        {homeData.recentConsultationsCount} published consultation note
                        {homeData.recentConsultationsCount === 1 ? '' : 's'}
                      </div>
                    </div>

                    <div className="card-surface rounded-xl p-5 space-y-2">
                      <div className="text-xs font-medium text-[#526259]">Unread Notifications</div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-[#047857]">
                        {homeData.unreadNotificationsCount}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('notifications')}
                        className="text-xs font-medium text-[#047857] hover:underline"
                      >
                        Open Inbox →
                      </button>
                    </div>
                  </section>

                  {/* Follow-up Reminders */}
                  {homeData.openFollowups.length > 0 && (
                    <section className="card-surface rounded-xl p-5 space-y-3">
                      <h3 className="text-sm font-semibold text-[#111C17]">
                        Your Care &amp; Follow-up Reminders
                      </h3>
                      <div className="divide-y divide-[#EEF2EF]">
                        {homeData.openFollowups.map((fu) => (
                          <div
                            key={fu.id}
                            className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                          >
                            <div>
                              <div className="font-medium text-[#111C17]">{fu.description}</div>
                              <div className="text-[11px] font-mono text-[#526259] mt-0.5">
                                Due {fu.dueDate} · {fu.followupType ?? 'Administrative Contact'}
                              </div>
                            </div>
                            <FollowUpStatusText status={fu.status} />
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              ) : null}
            </div>
          )}

          {/* TAB 2: MY APPOINTMENTS */}
          {activeTab === 'appointments' && (
            <div className="space-y-6 animate-view-enter">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-[#111C17]">Your Clinic Appointments</h2>
                  <p className="text-xs text-[#526259]">
                    Book open doctor slots or request rescheduling / cancellation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBooking((b) => !b)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg whitespace-nowrap shrink-0"
                >
                  <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  {showBooking ? 'Hide Booking Wizard' : 'Book New Appointment'}
                </button>
              </div>

              {showBooking && (
                <section className="card-surface rounded-xl p-5 space-y-4">
                  <div className="border-b border-[#E3E8E4] pb-3">
                    <h3 className="text-sm font-semibold text-[#111C17]">
                      Book an Appointment with an Available Doctor
                    </h3>
                    <p className="text-xs text-[#526259]">
                      1. Choose specialty &amp; visit type · 2. Pick a qualified doctor &amp; real open slot · 3. Confirm.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block font-medium text-[#111C17] mb-1">
                        Department / Specialty
                      </label>
                      <select
                        value={bookDepartment}
                        onChange={(e) => {
                          setBookDepartment(e.target.value);
                          setSelectedDoctorId('');
                          setSelectedSlot(null);
                        }}
                        className="w-full px-3 py-2 border border-[#D4DAD4] rounded-lg bg-white"
                      >
                        <option value="">All Specialties</option>
                        {(homeData?.availableSpecialties ?? []).map((dept) => (
                          <option key={dept} value={dept}>
                            {dept}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-[#111C17] mb-1">Visit Type</label>
                      <select
                        value={bookType}
                        onChange={(e) => {
                          setBookType(e.target.value as AppointmentType);
                          setSelectedSlot(null);
                        }}
                        className="w-full px-3 py-2 border border-[#D4DAD4] rounded-lg bg-white"
                      >
                        {APPOINTMENT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-[#111C17] mb-1">
                        Doctor (Optional Filter)
                      </label>
                      <select
                        value={selectedDoctorId}
                        onChange={(e) => {
                          setSelectedDoctorId(e.target.value);
                          setSelectedSlot(null);
                        }}
                        className="w-full px-3 py-2 border border-[#D4DAD4] rounded-lg bg-white"
                      >
                        <option value="">Any Available Doctor</option>
                        {availDoctors.map((d) => (
                          <option key={d.staffId} value={d.staffId}>
                            {d.fullName} ({d.effectiveOperationalState})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {loadingAvail ? (
                    <div className="h-24 bg-[#F6F8F6] rounded-lg animate-pulse" />
                  ) : (
                    <>
                      {availDoctors.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {availDoctors.map((doc) => (
                            <div
                              key={doc.staffId}
                              className="p-3 rounded-lg bg-[#F9FBFA] border border-[#E3E8E4] text-xs space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-[#111C17]">{doc.fullName}</span>
                                <DoctorDutyStatusText status={doc.effectiveOperationalState} />
                              </div>
                              <div className="text-[#526259]">
                                {doc.department} · {doc.specialty}
                              </div>
                              <div className="text-[11px] font-mono text-[#047857]">
                                {doc.workingHoursLabel}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {availSlots.length === 0 ? (
                        <p className="text-xs text-[#526259]">
                          No open slots found for this filter. Try selecting another specialty or doctor.
                        </p>
                      ) : (
                        <form onSubmit={handleConfirmBooking} className="space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                            {availSlots.map((slot, idx) => {
                              const active =
                                selectedSlot?.date === slot.date &&
                                selectedSlot?.time === slot.time &&
                                selectedSlot?.clinician === slot.clinician;
                              return (
                                <button
                                  key={`${slot.date}-${slot.time}-${slot.clinician}-${idx}`}
                                  type="button"
                                  onClick={() => setSelectedSlot(slot)}
                                  className={`p-3 rounded-lg border text-left text-xs transition-colors ${
                                    active
                                      ? 'border-[#059669] bg-[#ECF4EF]'
                                      : 'border-[#E3E8E4] bg-white hover:bg-[#F6F8F6]'
                                  }`}
                                >
                                  <div className="font-mono font-semibold text-[#0B261C]">
                                    {slot.date} · {slot.time}
                                  </div>
                                  <div className="text-[#526259] mt-0.5 truncate">
                                    {slot.clinician}
                                  </div>
                                  <div className="text-[11px] text-[#047857] mt-0.5">
                                    {slot.department} · {slot.durationMinutes}m
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          <div className="flex flex-col sm:flex-row gap-3">
                            <input
                              type="text"
                              value={bookNotes}
                              onChange={(e) => setBookNotes(e.target.value)}
                              placeholder="Optional reason for visit or intake note..."
                              className="flex-1 px-3 py-2 text-xs border border-[#D4DAD4] rounded-lg"
                            />
                            <button
                              type="submit"
                              disabled={!selectedSlot || submittingBooking}
                              className="px-5 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0"
                            >
                              {submittingBooking ? 'Booking...' : 'Confirm Appointment'}
                            </button>
                          </div>
                        </form>
                      )}
                    </>
                  )}
                </section>
              )}

              <section className="card-surface rounded-xl overflow-hidden">
                {appointments.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#526259]">
                    You have no appointments on file yet.
                  </div>
                ) : (
                  <div className="divide-y divide-[#EEF2EF]">
                    {appointments.map((apt) => (
                      <div
                        key={apt.id}
                        className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3"
                      >
                        <div className="space-y-1 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-semibold text-[#0B261C]">
                              {apt.appointmentDate} · {apt.appointmentTime}
                            </span>
                            <span className="font-semibold text-[#111C17]">{apt.clinician}</span>
                            <span className="font-mono text-[#526259]">
                              {apt.id} · {apt.department} ({apt.appointmentType ?? 'Consultation'})
                            </span>
                          </div>
                          {apt.notes && <div className="text-[#526259]">{apt.notes}</div>}
                          <RequestStatusText status={apt.requestStatus} />
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                          <AppointmentStatusText status={apt.status} />
                          {(apt.status === 'Scheduled' || apt.status === 'Confirmed') &&
                            (!apt.requestStatus || apt.requestStatus === 'None') && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openRescheduleModal(apt)}
                                  className="px-2.5 py-1 text-xs font-medium text-[#047857] bg-[#ECF4EF] hover:bg-[#D7E6DD] rounded-md whitespace-nowrap"
                                >
                                  Request Reschedule
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCancelApt(apt);
                                    setCancelReason('');
                                  }}
                                  className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md whitespace-nowrap"
                                >
                                  Request Cancellation
                                </button>
                              </>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB 3: MY HEALTH */}
          {activeTab === 'health' && (
            <div className="space-y-6 animate-view-enter">
              {!healthData ? (
                <div className="card-surface rounded-xl p-6 text-xs text-[#526259]">
                  Loading your published clinical records...
                </div>
              ) : (
                <>
                  {/* Consultation Summaries */}
                  <section className="card-surface rounded-xl p-5 space-y-4">
                    <div className="flex items-center gap-2 border-b border-[#E3E8E4] pb-3">
                      <Stethoscope className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                      <h3 className="text-sm font-semibold text-[#111C17]">
                        Published Consultation Summaries ({healthData.consultations.length})
                      </h3>
                    </div>
                    {healthData.consultations.length === 0 ? (
                      <p className="text-xs text-[#526259]">
                        No doctor-authored consultation summaries have been published to your portal yet.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {healthData.consultations.map((c) => (
                          <div
                            key={c.id}
                            className="p-4 rounded-xl bg-[#F9FBFA] border border-[#E3E8E4] space-y-1.5 text-xs"
                          >
                            <div className="flex items-center justify-between font-mono text-[#0B261C] font-semibold">
                              <span>{c.consultationDate} · {c.doctorName}</span>
                              <span>{c.id}</span>
                            </div>
                            <p className="text-[#111C17] font-medium">{c.summary}</p>
                            {c.recommendations && (
                              <p className="text-[#34433B]">
                                <span className="font-semibold">Care Instructions:</span> {c.recommendations}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Prescriptions */}
                    <section className="card-surface rounded-xl p-5 space-y-3">
                      <h3 className="text-sm font-semibold text-[#111C17]">
                        Prescriptions ({healthData.prescriptions.length})
                      </h3>
                      {healthData.prescriptions.length === 0 ? (
                        <p className="text-xs text-[#526259]">No active or past prescriptions on file.</p>
                      ) : (
                        <div className="divide-y divide-[#EEF2EF] text-xs">
                          {healthData.prescriptions.map((rx, idx) => (
                            <div key={idx} className="py-2.5 space-y-0.5">
                              <div className="font-semibold text-[#111C17]">
                                {rx.medication} · {rx.dosage}
                              </div>
                              <div className="text-[#526259]">
                                {rx.frequency} · {rx.duration} · Prescribed by {rx.doctorName} ({rx.consultationDate})
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* Diagnostic Test Results */}
                    <section className="card-surface rounded-xl p-5 space-y-3">
                      <h3 className="text-sm font-semibold text-[#111C17]">
                        Diagnostic Test Results ({healthData.testResults.length})
                      </h3>
                      {healthData.testResults.length === 0 ? (
                        <p className="text-xs text-[#526259]">No published diagnostic test results on file.</p>
                      ) : (
                        <div className="divide-y divide-[#EEF2EF] text-xs">
                          {healthData.testResults.map((tr, idx) => (
                            <div key={idx} className="py-2.5 space-y-0.5">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-[#111C17]">{tr.testName}</span>
                                <span className="font-mono text-[#047857]">{tr.statusLabel}</span>
                              </div>
                              <div className="text-[#34433B]">{tr.summary}</div>
                              <div className="font-mono text-[11px] text-[#526259]">
                                {tr.observedDate} · {tr.doctorName}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 4: NOTIFICATIONS */}
          {activeTab === 'notifications' && (
            <section className="card-surface rounded-xl overflow-hidden animate-view-enter">
              <div className="px-5 py-4 border-b border-[#E3E8E4] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#111C17]">Your Notifications</h3>
                  <p className="text-xs text-[#526259]">
                    Appointment updates, published consultation summaries, and care reminders
                  </p>
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      await markAllNotificationsRead();
                      setRefreshSignal((s) => s + 1);
                    }}
                    className="text-xs font-medium text-[#047857] hover:underline"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#526259]">No notifications yet.</div>
              ) : (
                <div className="divide-y divide-[#EEF2EF]">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-4 flex items-center justify-between gap-3 text-xs ${
                        !n.isRead ? 'bg-[#ECF4EF]/45' : ''
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-[#111C17]">{n.title}</div>
                        <div className="text-[#526259] mt-0.5">{n.message}</div>
                        <div className="font-mono text-[11px] text-[#64746B] mt-1">
                          {n.createdAt.slice(0, 19).replace('T', ' ')}
                        </div>
                      </div>
                      {!n.isRead && (
                        <button
                          type="button"
                          onClick={async () => {
                            await markNotificationRead(n.id);
                            setRefreshSignal((s) => s + 1);
                          }}
                          className="text-xs font-medium text-[#047857] hover:underline shrink-0"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* TAB 5: MY PROFILE */}
          {activeTab === 'profile' && (
            <section className="card-surface rounded-xl p-6 max-w-2xl space-y-5 animate-view-enter">
              <div className="border-b border-[#E3E8E4] pb-3">
                <h3 className="text-base font-semibold text-[#111C17]">
                  Personal &amp; Emergency Contact Information
                </h3>
                <p className="text-xs text-[#526259]">
                  Patient ID <span className="font-mono">{patientRecord?.id}</span> · DOB{' '}
                  <span className="font-mono">{patientRecord?.dateOfBirth}</span>
                </p>
              </div>
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#111C17] mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={profPhone}
                      onChange={(e) => setProfPhone(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#111C17] mb-1">Email</label>
                    <input
                      type="email"
                      required
                      value={profEmail}
                      onChange={(e) => setProfEmail(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#111C17] mb-1">
                      Emergency Contact Name
                    </label>
                    <input
                      type="text"
                      value={profEmergName}
                      onChange={(e) => setProfEmergName(e.target.value)}
                      placeholder="Full name"
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#111C17] mb-1">
                      Emergency Contact Phone
                    </label>
                    <input
                      type="tel"
                      value={profEmergPhone}
                      onChange={(e) => setProfEmergPhone(e.target.value)}
                      placeholder="+1-555-0100"
                      className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-[#E3E8E4]">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-60"
                  >
                    {savingProfile ? 'Saving...' : 'Save Contact Details'}
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* TAB 6: PATIENT AI ASSISTANT */}
          {activeTab === 'assistant' && (
            <AssistantView
              role="Patient"
              onDataMutated={() => setRefreshSignal((s) => s + 1)}
              onErrorNotice={onErrorNotice}
              onSuccessNotice={onSuccessNotice}
            />
          )}
        </main>
      </div>

      {/* Reschedule Request Modal */}
      <ModalShell
        open={Boolean(reschedApt)}
        onClose={() => setReschedApt(null)}
        labelledBy="patient-resched-title"
        maxWidthClass="max-w-lg"
      >
        {reschedApt && (
          <>
            <div className="flex items-center justify-between">
              <h3 id="patient-resched-title" className="text-base font-semibold text-[#111C17]">
                Request Reschedule · {reschedApt.id}
              </h3>
              <button type="button" onClick={() => setReschedApt(null)} className="p-1 text-[#526259]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmitRescheduleRequest} className="space-y-4">
              <div className="text-xs text-[#526259]">
                Select a preferred open slot for {reschedApt.clinician} ({reschedApt.department}):
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                {reschedSlots.map((slot, idx) => {
                  const chosen =
                    reschedChosen?.date === slot.date && reschedChosen?.time === slot.time;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setReschedChosen(slot)}
                      className={`p-2.5 rounded-lg border text-left text-xs ${
                        chosen ? 'border-[#059669] bg-[#ECF4EF]' : 'border-[#E3E8E4]'
                      }`}
                    >
                      <div className="font-mono font-semibold">{slot.date} · {slot.time}</div>
                      <div className="text-[11px] text-[#526259]">{slot.clinician}</div>
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                value={reschedNotes}
                onChange={(e) => setReschedNotes(e.target.value)}
                placeholder="Reason for rescheduling (optional)"
                className="w-full px-3 py-2 text-xs border border-[#D4DAD4] rounded-lg"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReschedApt(null)}
                  className="px-4 py-2 text-xs border border-[#E3E8E4] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!reschedChosen || requestBusy}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#059669] rounded-lg disabled:opacity-50"
                >
                  {requestBusy ? 'Submitting...' : 'Submit Reschedule Request'}
                </button>
              </div>
            </form>
          </>
        )}
      </ModalShell>

      {/* Cancel Request Modal */}
      <ModalShell
        open={Boolean(cancelApt)}
        onClose={() => setCancelApt(null)}
        labelledBy="patient-cancel-title"
        maxWidthClass="max-w-md"
      >
        {cancelApt && (
          <>
            <h3 id="patient-cancel-title" className="text-base font-semibold text-[#111C17]">
              Request Appointment Cancellation
            </h3>
            <form onSubmit={handleSubmitCancelRequest} className="space-y-4">
              <p className="text-xs text-[#526259]">
                Request cancellation for {cancelApt.id} on {cancelApt.appointmentDate} at{' '}
                {cancelApt.appointmentTime} with {cancelApt.clinician}.
              </p>
              <input
                type="text"
                required
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Brief reason for cancellation"
                className="w-full px-3 py-2 text-xs border border-[#D4DAD4] rounded-lg"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCancelApt(null)}
                  className="px-4 py-2 text-xs border border-[#E3E8E4] rounded-lg"
                >
                  Keep Visit
                </button>
                <button
                  type="submit"
                  disabled={requestBusy}
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-700 rounded-lg disabled:opacity-50"
                >
                  {requestBusy ? 'Submitting...' : 'Submit Cancellation'}
                </button>
              </div>
            </form>
          </>
        )}
      </ModalShell>
    </div>
  );
}
