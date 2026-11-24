import {
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Stethoscope,
  Trash2,
  UserCircle,
  X,
} from 'lucide-react';
import type {
  Appointment,
  AuthUserProfile,
  ClinicMembershipWithClinic,
  ClinicWorkspace,
  OverviewReport,
} from '../shared/types';
import { addDaysIso, getCalendarBlockLabel, getWeekStripDays } from '../utils/workspaceMath';
import { MiniWeekAreaChart } from './AnalyticsCharts';
import { EditorialAvatar } from './ClinicIllustrations';
import { AppointmentStatusText, RequestStatusText } from './StatusText';

interface RightRailProps {
  mode: 'dashboard' | 'appointments';
  user: AuthUserProfile;
  roleLabel: string;
  activeClinic: ClinicWorkspace;
  clinics: ClinicMembershipWithClinic[];
  avatarLoadError: boolean;
  onAvatarError: () => void;
  onSwitchClinic: (clinicId: string) => void;
  onOpenProfile: () => void;
  onOpenStaffRoster: () => void;
  focusDate: string;
  todayDate: string;
  onSelectDate: (date: string) => void;
  // Dashboard props
  dayAppointments: Appointment[];
  overview: OverviewReport | null;
  onOpenAppointmentDetail: (apt: Appointment) => void;
  // Appointments props
  selectedAppointment: Appointment | null;
  canWrite: boolean;
  submitting?: boolean;
  onSelectAppointment: (apt: Appointment | null) => void;
  onEditAppointment?: (apt: Appointment) => void;
  onCancelAppointment?: (apt: Appointment) => void;
  onDeleteAppointment?: (apt: Appointment) => void;
  onTriageRequest?: (apt: Appointment, action: 'approve_cancel' | 'clear_request') => void;
  onOpenPatient?: (patientId: string) => void;
  onOpenStaffByName?: (clinicianName: string) => void;
  onQuickBookDate?: (date: string) => void;
}

export function RightRail({
  mode,
  user,
  roleLabel,
  activeClinic,
  clinics,
  avatarLoadError,
  onAvatarError,
  onSwitchClinic,
  onOpenProfile,
  onOpenStaffRoster,
  focusDate,
  todayDate,
  onSelectDate,
  dayAppointments,
  overview,
  onOpenAppointmentDetail,
  selectedAppointment,
  canWrite,
  submitting = false,
  onSelectAppointment,
  onEditAppointment,
  onCancelAppointment,
  onDeleteAppointment,
  onTriageRequest,
  onOpenPatient,
  onOpenStaffByName,
  onQuickBookDate,
}: RightRailProps) {
  const weekDays = getWeekStripDays(focusDate, todayDate);
  const activeMonthYear = new Date(
    Number(focusDate.slice(0, 4)),
    Math.max(0, Number(focusDate.slice(5, 7)) - 1),
    1
  ).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const activeUpcoming = [...dayAppointments]
    .filter((a) => a.status === 'Confirmed' || a.status === 'Scheduled')
    .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));
  const fallbackSorted = [...dayAppointments]
    .filter((a) => a.status !== 'Cancelled')
    .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));

  const spotlightApt = activeUpcoming[0] ?? fallbackSorted[0] ?? null;
  const nextApts = (
    activeUpcoming.length > 0
      ? [
          ...activeUpcoming.slice(1),
          ...fallbackSorted.filter((a) => a.status !== 'Confirmed' && a.status !== 'Scheduled'),
        ]
      : fallbackSorted.slice(1)
  ).slice(0, 3);

  return (
    <aside
      aria-label={mode === 'dashboard' ? 'Operations Side Rail' : 'Selected Day Inspector'}
      className="w-full grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-4 items-start"
    >
      {/* 1. Profile Card */}
      <div className="card-surface rounded-[22px] p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onOpenProfile}
            className="flex items-center gap-3 min-w-0 text-left group"
          >
            {user.avatarUrl && !avatarLoadError ? (
              <img
                src={user.avatarUrl}
                alt={user.fullName}
                referrerPolicy="no-referrer"
                onError={onAvatarError}
                className="w-11 h-11 rounded-full object-cover shrink-0 border border-[#DCE8E0]"
              />
            ) : (
              <EditorialAvatar name={user.fullName} role="administrator" size="md" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-bold text-[#1C2B25] truncate group-hover:text-[#0F3D2E]">
                {user.fullName}
              </div>
              <div className="text-xs text-[#6B7B73] truncate">{roleLabel}</div>
            </div>
          </button>
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="Open administrator profile"
            className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-full bg-[#EEF3EF] hover:bg-[#DCE8E0] text-[#0F3D2E] transition-colors shrink-0"
          >
            <UserCircle className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#EEF3EF] text-xs">
          <span className="inline-flex items-center gap-1.5 text-[#6B7B73] truncate">
            <Building2 className="w-3.5 h-3.5 text-[#137A55] shrink-0" aria-hidden="true" />
            <span className="truncate font-medium text-[#1C2B25]">{activeClinic.name}</span>
          </span>
          <button
            type="button"
            onClick={onOpenStaffRoster}
            className="min-h-[44px] md:min-h-0 px-2 md:px-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[#137A55] hover:text-[#0F3D2E] shrink-0"
          >
            <Stethoscope className="w-3 h-3" aria-hidden="true" />
            Staff
          </button>
        </div>

        {clinics.length > 1 && (
          <div>
            <label htmlFor="rail-clinic-switcher" className="sr-only">
              Switch clinic workspace
            </label>
            <select
              id="rail-clinic-switcher"
              value={activeClinic.id}
              onChange={(e) => onSwitchClinic(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-medium bg-[#FAFBF9] text-[#1C2B25] border border-[#DCE8E0] rounded-full focus:outline-none focus:border-[#34C38F]"
            >
              {clinics.map((c) => (
                <option key={c.clinic.id} value={c.clinic.id}>
                  {c.clinic.name} ({c.membership.role})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 2. Interactive Week-Strip Calendar (Mon-Sun) */}
      <div className="card-surface rounded-[22px] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-[#1C2B25]">{activeMonthYear}</span>
          <div className="flex items-center gap-1">
            {focusDate !== todayDate && (
              <button
                type="button"
                onClick={() => onSelectDate(todayDate)}
                className="min-h-[44px] md:min-h-0 px-2.5 md:px-2 py-0.5 rounded-full bg-[#EEF3EF] text-[11px] font-semibold text-[#0F3D2E] hover:bg-[#DCE8E0]"
              >
                Today
              </button>
            )}
            <button
              type="button"
              onClick={() => onSelectDate(addDaysIso(focusDate, -7))}
              aria-label="Previous week"
              className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-full text-[#6B7B73] hover:text-[#1C2B25] hover:bg-[#EEF3EF]"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onSelectDate(addDaysIso(focusDate, 7))}
              aria-label="Next week"
              className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-full text-[#6B7B73] hover:text-[#1C2B25] hover:bg-[#EEF3EF]"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1" role="group" aria-label="Week calendar selector">
          {weekDays.map((day) => (
            <button
              key={day.dateKey}
              type="button"
              onClick={() => onSelectDate(day.dateKey)}
              aria-pressed={day.isSelected}
              aria-label={`${day.shortDay} ${day.monthShort} ${day.dayNum}`}
              className={`btn-press min-h-[44px] flex flex-col items-center justify-center py-2 rounded-2xl transition-colors ${
                day.isSelected
                  ? 'bg-[#34C38F] text-[#0F3D2E] font-bold shadow-xs'
                  : day.isToday
                    ? 'bg-[#EEF3EF] text-[#0F3D2E] font-semibold border border-[#BCE2CD]'
                    : 'text-[#6B7B73] hover:bg-[#FAFBF9] hover:text-[#1C2B25]'
              }`}
            >
              <span className="text-[10px] uppercase tracking-wide">{day.shortDay.slice(0, 3)}</span>
              <span className="text-xs font-mono tabular-nums mt-0.5">{day.dayNum}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Appointments Inspector (when on Appointments tab and a booking is selected) */}
      {mode === 'appointments' && selectedAppointment ? (
        <div className="card-surface rounded-[22px] p-4 space-y-4 animate-view-enter">
          <div className="flex items-start justify-between gap-2 border-b border-[#EEF3EF] pb-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <EditorialAvatar
                name={selectedAppointment.patientName ?? selectedAppointment.patientId}
                role="patient"
                size="sm"
              />
              <div className="min-w-0">
                <div className="text-[11px] font-mono text-[#6B7B73]">{selectedAppointment.id}</div>
                <h3 className="text-sm font-bold text-[#1C2B25] truncate">
                  {onOpenPatient ? (
                    <button
                      type="button"
                      onClick={() => onOpenPatient(selectedAppointment.patientId)}
                      className="text-left text-[#0F3D2E] hover:underline"
                    >
                      {selectedAppointment.patientName ?? selectedAppointment.patientId}
                    </button>
                  ) : (
                    selectedAppointment.patientName ?? selectedAppointment.patientId
                  )}
                </h3>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSelectAppointment(null)}
              aria-label="Clear selected appointment"
              className="p-1 text-[#6B7B73] hover:text-[#1C2B25] rounded-full hover:bg-[#EEF3EF]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <AppointmentStatusText status={selectedAppointment.status} />
            <RequestStatusText status={selectedAppointment.requestStatus} />
          </div>

          <dl className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="p-2.5 rounded-2xl bg-[#FAFBF9] border border-[#EEF3EF]">
              <dt className="text-[11px] text-[#6B7B73]">Date &amp; Time</dt>
              <dd className="font-mono font-semibold text-[#1C2B25] mt-0.5 tabular-nums">
                {selectedAppointment.appointmentDate.slice(5)} · {selectedAppointment.appointmentTime}
              </dd>
            </div>
            <div className="p-2.5 rounded-2xl bg-[#FAFBF9] border border-[#EEF3EF]">
              <dt className="text-[11px] text-[#6B7B73]">Type</dt>
              <dd className="font-semibold text-[#1C2B25] mt-0.5 truncate">
                {getCalendarBlockLabel(selectedAppointment.appointmentType)}
              </dd>
            </div>
            <div className="col-span-2 p-2.5 rounded-2xl bg-[#FAFBF9] border border-[#EEF3EF]">
              <dt className="text-[11px] text-[#6B7B73]">Department &amp; Clinician</dt>
              <dd className="font-medium text-[#1C2B25] mt-0.5">
                {selectedAppointment.department} ·{' '}
                {onOpenStaffByName ? (
                  <button
                    type="button"
                    onClick={() => onOpenStaffByName(selectedAppointment.clinician)}
                    className="text-[#137A55] hover:underline font-semibold"
                  >
                    {selectedAppointment.clinician}
                  </button>
                ) : (
                  selectedAppointment.clinician
                )}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[11px] text-[#6B7B73]">Notes</dt>
              <dd className="text-[#1C2B25] mt-0.5 leading-relaxed">
                {selectedAppointment.notes || 'No administrative notes recorded.'}
              </dd>
            </div>
          </dl>

          {selectedAppointment.requestStatus &&
            selectedAppointment.requestStatus !== 'None' &&
            canWrite &&
            onTriageRequest && (
              <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 space-y-2">
                {selectedAppointment.requestNotes && (
                  <p className="text-xs text-amber-900">{selectedAppointment.requestNotes}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {selectedAppointment.requestStatus === 'Reschedule Requested' && onEditAppointment && (
                    <button
                      type="button"
                      onClick={() => onEditAppointment(selectedAppointment)}
                      className="px-3 py-1 rounded-full text-[11px] font-semibold bg-[#0F3D2E] text-white"
                    >
                      Approve Reschedule
                    </button>
                  )}
                  {selectedAppointment.requestStatus === 'Cancellation Requested' && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => onTriageRequest(selectedAppointment, 'approve_cancel')}
                      className="px-3 py-1 rounded-full text-[11px] font-semibold bg-rose-600 text-white disabled:opacity-50"
                    >
                      Approve Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => onTriageRequest(selectedAppointment, 'clear_request')}
                    className="px-3 py-1 rounded-full text-[11px] font-medium bg-white border border-amber-200 text-[#1C2B25]"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

          {canWrite && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#EEF3EF]">
              {onEditAppointment && (
                <button
                  type="button"
                  onClick={() => onEditAppointment(selectedAppointment)}
                  className="btn-press flex-1 px-3 py-2 text-xs font-semibold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full whitespace-nowrap"
                >
                  Reschedule / Edit
                </button>
              )}
              {onCancelAppointment &&
                selectedAppointment.status !== 'Cancelled' &&
                selectedAppointment.status !== 'Completed' && (
                  <button
                    type="button"
                    onClick={() => onCancelAppointment(selectedAppointment)}
                    className="btn-press px-3 py-2 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-full"
                  >
                    Cancel
                  </button>
                )}
              {onDeleteAppointment && (
                <button
                  type="button"
                  onClick={() => onDeleteAppointment(selectedAppointment)}
                  aria-label={`Delete appointment ${selectedAppointment.id}`}
                  className="btn-press p-2 text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-full"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* 3b. Upcoming Spotlight + Sage Cards */
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#6B7B73]">
              {mode === 'appointments' ? `Selected Day · ${focusDate.slice(5)}` : 'Upcoming'}
            </h3>
            {mode === 'appointments' && canWrite && onQuickBookDate && (
              <button
                type="button"
                onClick={() => onQuickBookDate(focusDate)}
                className="text-xs font-semibold text-[#137A55] hover:underline"
              >
                + Book
              </button>
            )}
          </div>

          {spotlightApt ? (
            <div className="rounded-[22px] bg-[#0F3D2E] text-white p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/15 text-[11px] font-semibold text-[#A7F3D0]">
                  <CalendarClock className="w-3 h-3" aria-hidden="true" />
                  Next Upcoming
                </span>
                <span className="font-mono text-xs font-semibold text-[#34C38F] tabular-nums">
                  {spotlightApt.appointmentTime}
                </span>
              </div>
              <div>
                <div className="text-sm font-bold text-white truncate">
                  {spotlightApt.patientName ?? spotlightApt.patientId}
                </div>
                <div className="text-xs text-emerald-100/80 mt-0.5 truncate">
                  {spotlightApt.department} · {spotlightApt.clinician}
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-white/15">
                <span className="text-[11px] font-mono text-emerald-200/80">
                  {getCalendarBlockLabel(spotlightApt.appointmentType)} · {spotlightApt.status}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    mode === 'appointments'
                      ? onSelectAppointment(spotlightApt)
                      : onOpenAppointmentDetail(spotlightApt)
                  }
                  className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#A7F3D0] hover:text-white"
                >
                  Details <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <div className="card-sage rounded-[22px] p-4 text-center space-y-1.5">
              <Clock className="w-5 h-5 text-[#6B7B73] mx-auto" aria-hidden="true" />
              <p className="text-xs font-semibold text-[#1C2B25]">
                No visits on {focusDate}
              </p>
              <p className="text-[11px] text-[#6B7B73]">
                Pick another weekday chip above or schedule a visit.
              </p>
            </div>
          )}

          {nextApts.map((apt) => (
            <div
              key={apt.id}
              className="card-sage rounded-[20px] px-4 py-3 flex items-center justify-between gap-2 card-interactive"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono font-bold text-[#0F3D2E] tabular-nums">
                    {apt.appointmentTime}
                  </span>
                  <span className="font-semibold text-[#1C2B25] truncate">
                    {apt.patientName ?? apt.patientId}
                  </span>
                </div>
                <div className="text-[11px] text-[#6B7B73] truncate mt-0.5">
                  {apt.department} · {getCalendarBlockLabel(apt.appointmentType)}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  mode === 'appointments'
                    ? onSelectAppointment(apt)
                    : onOpenAppointmentDetail(apt)
                }
                className="min-h-[40px] sm:min-h-0 inline-flex items-center gap-0.5 text-xs font-semibold text-[#137A55] hover:text-[#0F3D2E] whitespace-nowrap shrink-0"
              >
                Details <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 4. Compact "Appointments this week" Green Gradient Card (Dashboard Rail) */}
      {mode === 'dashboard' && overview && (
        <MiniWeekAreaChart dailyTrend={overview.dailyTrend} />
      )}
    </aside>
  );
}
