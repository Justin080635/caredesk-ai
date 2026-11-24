import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Calendar,
  Mail,
  Phone,
  Search,
  Stethoscope,
  Users,
} from 'lucide-react';
import adminAvatarUrl from '../assets/images/avatar_clinic_admin_1795511733855.jpg';
import { fetchStaff } from '../client/api';
import { CLINIC_DEPARTMENTS } from '../shared/constants';
import type { StaffMember } from '../shared/types';
import { ClinicEmptyIllustration, EditorialAvatar } from './ClinicIllustrations';
import { TableSkeleton } from './Skeletons';
import { DoctorDutyStatusText, StaffStatusText } from './StatusText';

interface StaffViewProps {
  onOpenStaff: (staffId: string) => void;
  onErrorNotice: (msg: string) => void;
  refreshSignal: number;
  compactDensity?: boolean;
}

const STAFF_ROLES = ['All', 'Clinician', 'Administrator', 'Coordinator', 'Viewer'] as const;
const STAFF_STATUSES = ['All', 'Active', 'On Leave', 'Inactive'] as const;

export function StaffView({
  onOpenStaff,
  onErrorNotice,
  refreshSignal,
  compactDensity = false,
}: StaffViewProps) {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [deptFilter, setDeptFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [avatarError, setAvatarError] = useState(false);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchStaff({
        search: search || undefined,
        role: roleFilter,
        department: deptFilter,
        status: statusFilter,
      });
      setStaffList(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load clinic staff roster.';
      setLoadError(message);
      onErrorNotice(message);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, deptFilter, statusFilter, onErrorNotice]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff, refreshSignal]);

  const activeCliniciansCount = useMemo(
    () => staffList.filter((s) => s.role === 'Clinician' && s.status === 'Active').length,
    [staffList]
  );

  const operationalStaffCount = useMemo(
    () => staffList.filter((s) => s.role !== 'Clinician').length,
    [staffList]
  );

  const totalUpcomingVisits = useMemo(
    () => staffList.reduce((sum, s) => sum + (s.upcomingAppointmentsCount ?? 0), 0),
    [staffList]
  );

  const departmentOptions = useMemo(() => {
    const extras = new Set<string>(CLINIC_DEPARTMENTS);
    extras.add('Clinic Operations');
    extras.add('Front Desk & Intake');
    return Array.from(extras);
  }, []);

  const renderStaffAvatar = (member: StaffMember) => {
    if (member.id === 'STF-1007' && !avatarError) {
      return (
        <img
          src={adminAvatarUrl}
          alt={member.fullName}
          referrerPolicy="no-referrer"
          onError={() => setAvatarError(true)}
          className="w-10 h-10 rounded-full object-cover shrink-0 border border-[#DCE8E0]"
        />
      );
    }
    return (
      <EditorialAvatar
        name={member.fullName}
        role={member.role === 'Clinician' ? 'clinician' : 'patient'}
        size="md"
      />
    );
  };

  const cellPad = compactDensity ? 'py-2.5 px-4' : 'py-3.5 px-5';

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-[22px] bg-gradient-to-br from-[#0F3D2E] to-[#165A42] text-white p-5 shadow-xs">
          <div className="text-xs font-medium text-emerald-100/80">Staff Roster</div>
          <div className="text-3xl font-bold font-mono tabular-nums mt-1.5">
            {staffList.length}
          </div>
          <div className="text-[11px] text-emerald-100/75 mt-1">
            Matching active filters
          </div>
        </div>

        <div className="card-surface rounded-[22px] p-5">
          <div className="text-xs font-medium text-[#6B7B73]">Active Clinicians</div>
          <div className="text-3xl font-bold font-mono tabular-nums text-[#137A55] mt-1.5">
            {activeCliniciansCount}
          </div>
          <div className="text-[11px] text-[#6B7B73] mt-1">
            Available for bookings
          </div>
        </div>

        <div className="card-surface rounded-[22px] p-5">
          <div className="text-xs font-medium text-[#6B7B73]">Operations &amp; Admin</div>
          <div className="text-3xl font-bold font-mono tabular-nums text-[#1C2B25] mt-1.5">
            {operationalStaffCount}
          </div>
          <div className="text-[11px] text-[#6B7B73] mt-1">
            Coordinators &amp; admin
          </div>
        </div>

        <div className="card-surface rounded-[22px] p-5">
          <div className="text-xs font-medium text-[#6B7B73]">Upcoming Visits</div>
          <div className="text-3xl font-bold font-mono tabular-nums text-[#0F3D2E] mt-1.5">
            {totalUpcomingVisits}
          </div>
          <div className="text-[11px] text-[#6B7B73] mt-1">
            Assigned across roster
          </div>
        </div>
      </section>

      <div className="card-surface rounded-[24px] p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
            <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[200px] sm:max-w-sm">
              <Search
                className="w-4 h-4 text-[#6B7B73] absolute left-3.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <label htmlFor="staff-search-input" className="sr-only">
                Search staff directory
              </label>
              <input
                id="staff-search-input"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by ID, name, specialty, or role..."
                className="w-full min-h-[44px] sm:min-h-0 pl-10 pr-4 py-2 text-sm border border-[#DCE8E0] rounded-full bg-[#FAFBF9] focus:bg-white focus:outline-none focus:border-[#34C38F]"
              />
            </div>

            <div>
              <label htmlFor="staff-dept-filter" className="sr-only">
                Filter by department
              </label>
              <select
                id="staff-dept-filter"
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="px-3.5 py-2 text-xs sm:text-sm border border-[#DCE8E0] rounded-full bg-[#FAFBF9]"
              >
                <option value="All">All Departments</option>
                {departmentOptions.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="staff-status-filter" className="sr-only">
                Filter by employment status
              </label>
              <select
                id="staff-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3.5 py-2 text-xs sm:text-sm border border-[#DCE8E0] rounded-full bg-[#FAFBF9]"
              >
                {STAFF_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st === 'All' ? 'All Statuses' : st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className="flex items-center gap-1 p-1 bg-[#EEF3EF] rounded-full overflow-x-auto w-fit max-w-full"
            role="group"
            aria-label="Filter staff by role"
          >
            {STAFF_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setRoleFilter(role)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap shrink-0 ${
                  roleFilter === role
                    ? 'bg-[#0F3D2E] text-white shadow-xs'
                    : 'text-[#6B7B73] hover:text-[#1C2B25]'
                }`}
              >
                {role}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="card-surface rounded-[24px] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#EEF3EF] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Stethoscope className="w-4 h-4 text-[#137A55]" aria-hidden="true" />
            <h2 className="text-sm font-bold text-[#1C2B25]">
              Clinic Workforce &amp; Clinician Directory
            </h2>
          </div>
          <span className="text-xs font-mono tabular-nums text-[#6B7B73]">
            {staffList.length} staff member{staffList.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={5} label="Loading staff roster" />
        ) : loadError ? (
          <div className="p-8 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" aria-hidden="true" />
            <p className="text-sm font-semibold text-[#1C2B25]">Unable to load staff roster</p>
            <p className="text-xs text-[#6B7B73] max-w-md mx-auto">{loadError}</p>
            <button
              type="button"
              onClick={loadStaff}
              className="btn-press px-5 py-2 text-xs font-semibold text-white bg-[#34C38F] hover:bg-[#24B07D] rounded-full"
            >
              Retry
            </button>
          </div>
        ) : staffList.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <ClinicEmptyIllustration variant="search" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#1C2B25]">
                No staff members match the active filters
              </p>
              <p className="text-xs text-[#6B7B73]">
                Clear search or role filters to view the full CareDesk staff directory.
              </p>
            </div>
            {(search || roleFilter !== 'All' || deptFilter !== 'All' || statusFilter !== 'All') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setRoleFilter('All');
                  setDeptFilter('All');
                  setStatusFilter('All');
                }}
                className="px-4 py-2 text-xs font-semibold text-[#1C2B25] bg-white hover:bg-[#FAFBF9] border border-[#DCE8E0] rounded-full"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile Stacked Cards */}
            <div className="md:hidden divide-y divide-[#EEF3EF]">
              {staffList.map((member) => (
                <article key={member.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      {renderStaffAvatar(member)}
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onOpenStaff(member.id)}
                          className="text-sm font-bold text-[#0F3D2E] hover:underline text-left truncate block"
                        >
                          {member.fullName}
                        </button>
                        <div className="text-[11px] font-mono text-[#6B7B73]">
                          {member.id} · {member.role}
                        </div>
                      </div>
                    </div>
                    <StaffStatusText status={member.status} />
                  </div>

                  <div className="rounded-2xl bg-[#FAFBF9] border border-[#EEF3EF] p-3 space-y-1 text-xs text-[#6B7B73]">
                    <div className="font-medium text-[#1C2B25]">
                      {member.department}
                      {member.specialty ? ` · ${member.specialty}` : ''}
                    </div>
                    {member.email && <div className="truncate">{member.email}</div>}
                    {member.role === 'Clinician' && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <span className="font-mono text-[#0F3D2E] font-semibold">
                          {member.upcomingAppointmentsCount ?? 0} upcoming · {member.assignedAppointmentsCount ?? 0} total
                        </span>
                        <DoctorDutyStatusText
                          status={member.effectiveOperationalState ?? member.attendanceStatus}
                        />
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenStaff(member.id)}
                    className="btn-press w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-[#EEF3EF] hover:bg-[#DCE8E0] text-xs font-semibold text-[#0F3D2E]"
                  >
                    <span>Open Profile</span>
                    <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#DCE8E0] bg-[#FAFBF9] text-xs font-semibold text-[#6B7B73]">
                    <th className="py-3 px-5">Staff Member</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Department &amp; Specialty</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">Caseload</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-5 text-right">Profile</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF3EF] text-sm">
                  {staffList.map((member) => (
                    <tr
                      key={member.id}
                      className="hover:bg-[#FAFBF9] transition-colors"
                    >
                      <td className={cellPad}>
                        <div className="flex items-center gap-3">
                          {renderStaffAvatar(member)}
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onOpenStaff(member.id)}
                              className="font-semibold text-[#0F3D2E] hover:text-[#137A55] hover:underline text-left"
                            >
                              {member.fullName}
                            </button>
                            <div className="text-[11px] font-mono text-[#6B7B73]">{member.id}</div>
                            {member.qualifications && (
                              <div className="text-[11px] text-[#6B7B73] truncate max-w-[220px]">
                                {member.qualifications}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className={`${cellPad} text-xs font-medium text-[#1C2B25] whitespace-nowrap`}>
                        <span className="inline-flex items-center gap-1.5">
                          {member.role === 'Clinician' ? (
                            <Stethoscope className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
                          ) : (
                            <Users className="w-3.5 h-3.5 text-[#6B7B73]" aria-hidden="true" />
                          )}
                          {member.role}
                        </span>
                        {member.licenseNumber && (
                          <div className="text-[11px] font-mono text-[#6B7B73] mt-0.5">
                            {member.licenseNumber}
                          </div>
                        )}
                      </td>
                      <td className={`${cellPad} text-xs`}>
                        <div className="inline-flex items-center gap-1.5 font-medium text-[#1C2B25]">
                          <Building2 className="w-3.5 h-3.5 text-[#6B7B73] shrink-0" aria-hidden="true" />
                          {member.department}
                        </div>
                        {member.specialty && (
                          <div className="text-[11px] text-[#6B7B73] mt-0.5">{member.specialty}</div>
                        )}
                      </td>
                      <td className={`${cellPad} text-xs text-[#6B7B73]`}>
                        {member.email || member.contactNumber ? (
                          <div className="space-y-0.5">
                            {member.email && (
                              <div className="inline-flex items-center gap-1 text-[#1C2B25]">
                                <Mail className="w-3 h-3 text-[#137A55]" aria-hidden="true" />
                                {member.email}
                              </div>
                            )}
                            {member.contactNumber && (
                              <div className="inline-flex items-center gap-1 font-mono text-[11px] block">
                                <Phone className="w-3 h-3 text-[#6B7B73]" aria-hidden="true" />
                                {member.contactNumber}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] italic text-[#6B7B73]">Not recorded</span>
                        )}
                      </td>
                      <td className={`${cellPad} text-xs font-mono tabular-nums text-[#1C2B25] whitespace-nowrap`}>
                        {member.role === 'Clinician' ? (
                          <div className="space-y-0.5">
                            <div className="inline-flex items-center gap-1 font-semibold text-[#0F3D2E]">
                              <Calendar className="w-3 h-3 text-[#137A55]" aria-hidden="true" />
                              {member.upcomingAppointmentsCount ?? 0} upcoming
                            </div>
                            <div className="text-[11px] text-[#6B7B73]">
                              {member.assignedAppointmentsCount ?? 0} total visits
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[#6B7B73]">Operations role</span>
                        )}
                      </td>
                      <td className={cellPad}>
                        <div className="space-y-1">
                          <StaffStatusText status={member.status} />
                          {member.role === 'Clinician' && (
                            <div>
                              <DoctorDutyStatusText
                                status={member.effectiveOperationalState ?? member.attendanceStatus}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className={`${cellPad} text-right whitespace-nowrap`}>
                        <button
                          type="button"
                          onClick={() => onOpenStaff(member.id)}
                          className="btn-press inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#EEF3EF] hover:bg-[#DCE8E0] text-xs font-semibold text-[#0F3D2E]"
                          aria-label={`Open staff profile for ${member.fullName}`}
                        >
                          <span>Open Profile</span>
                          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
