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
          className="w-10 h-10 rounded-full object-cover shrink-0 border border-[#C6DFD1]"
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

  const cellPad = compactDensity ? 'py-2.5 px-4' : 'py-3.5 px-4';

  return (
    <div className="space-y-5">
      {/* Workforce Summary Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0B261C] text-white rounded-xl p-4">
          <div className="text-xs font-medium text-emerald-200/85">Staff Roster</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1.5">
            {staffList.length}
          </div>
          <div className="text-[11px] text-emerald-100/75 mt-0.5">
            Matching active roster filters
          </div>
        </div>

        <div className="card-surface rounded-xl p-4">
          <div className="text-xs font-medium text-[#526259]">Active Clinicians</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#047857] mt-1.5">
            {activeCliniciansCount}
          </div>
          <div className="text-[11px] text-[#526259] mt-0.5">
            Available for outpatient bookings
          </div>
        </div>

        <div className="card-surface rounded-xl p-4">
          <div className="text-xs font-medium text-[#526259]">Operations &amp; Admin</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#111C17] mt-1.5">
            {operationalStaffCount}
          </div>
          <div className="text-[11px] text-[#526259] mt-0.5">
            Coordinators, admin &amp; oversight
          </div>
        </div>

        <div className="card-surface rounded-xl p-4">
          <div className="text-xs font-medium text-[#526259]">Assigned Upcoming Visits</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#0B261C] mt-1.5">
            {totalUpcomingVisits}
          </div>
          <div className="text-[11px] text-[#526259] mt-0.5">
            Scheduled or confirmed across roster
          </div>
        </div>
      </section>

      {/* Filter Toolbar */}
      <div className="card-surface rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search
                className="w-4 h-4 text-[#526259] absolute left-3 top-1/2 -translate-y-1/2"
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
                className="w-full pl-9 pr-3 py-2 text-sm border border-[#D4DAD4] rounded-lg focus:outline-none focus:border-[#059669]"
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
                className="px-3 py-2 text-xs sm:text-sm border border-[#D4DAD4] rounded-lg bg-white"
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
                className="px-3 py-2 text-xs sm:text-sm border border-[#D4DAD4] rounded-lg bg-white"
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
            className="flex items-center gap-1 p-1 bg-[#F1F5F2] rounded-lg overflow-x-auto w-fit max-w-full"
            role="group"
            aria-label="Filter staff by role"
          >
            {STAFF_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setRoleFilter(role)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  roleFilter === role
                    ? 'bg-white text-[#0B261C] shadow-xs'
                    : 'text-[#526259] hover:text-[#111C17]'
                }`}
              >
                {role}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Staff Roster Table */}
      <section className="card-surface rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E3E8E4] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-[#047857]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[#111C17]">
              Clinic Workforce &amp; Clinician Directory
            </h2>
          </div>
          <span className="text-xs font-mono tabular-nums text-[#526259]">
            {staffList.length} staff member{staffList.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className="p-5 space-y-3" aria-busy="true" aria-label="Loading staff roster">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-[#F6F8F6] animate-pulse">
                <div className="w-10 h-10 rounded-full bg-[#E3E8E4] shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-44 bg-[#E3E8E4] rounded" />
                  <div className="h-2.5 w-32 bg-[#EEF2EF] rounded" />
                </div>
                <div className="h-3.5 w-24 bg-[#E3E8E4] rounded" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="p-8 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-red-700 mx-auto" aria-hidden="true" />
            <p className="text-sm font-medium text-[#111C17]">Unable to load staff roster</p>
            <p className="text-xs text-[#526259] max-w-md mx-auto">{loadError}</p>
            <button
              type="button"
              onClick={loadStaff}
              className="px-4 py-2 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg btn-press"
            >
              Retry
            </button>
          </div>
        ) : staffList.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <ClinicEmptyIllustration variant="search" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-[#111C17]">
                No staff members match the active filters
              </p>
              <p className="text-xs text-[#526259]">
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
                className="px-3.5 py-1.5 text-xs font-medium text-[#111C17] bg-white hover:bg-[#F6F8F6] border border-[#D4DAD4] rounded-lg"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E3E8E4] bg-[#F6F8F6] text-xs font-medium text-[#526259]">
                  <th className="py-2.5 px-4">Staff Member</th>
                  <th className="py-2.5 px-4">Role</th>
                  <th className="py-2.5 px-4">Department &amp; Specialty</th>
                  <th className="py-2.5 px-4">Contact</th>
                  <th className="py-2.5 px-4">Caseload</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2EF] text-sm">
                {staffList.map((member) => (
                  <tr
                    key={member.id}
                    className="hover:bg-[#F6F8F6] transition-colors"
                  >
                    <td className={cellPad}>
                      <div className="flex items-center gap-3">
                        {renderStaffAvatar(member)}
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onOpenStaff(member.id)}
                            className="font-semibold text-[#0B261C] hover:text-[#047857] hover:underline text-left"
                          >
                            {member.fullName}
                          </button>
                          <div className="text-[11px] font-mono text-[#526259]">{member.id}</div>
                          {member.qualifications && (
                            <div className="text-[11px] text-[#526259] truncate max-w-[220px]">
                              {member.qualifications}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={`${cellPad} text-xs font-medium text-[#111C17] whitespace-nowrap`}>
                      <span className="inline-flex items-center gap-1.5">
                        {member.role === 'Clinician' ? (
                          <Stethoscope className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                        ) : (
                          <Users className="w-3.5 h-3.5 text-[#526259]" aria-hidden="true" />
                        )}
                        {member.role}
                      </span>
                      {member.licenseNumber && (
                        <div className="text-[11px] font-mono text-[#526259] mt-0.5">
                          {member.licenseNumber}
                        </div>
                      )}
                    </td>
                    <td className={`${cellPad} text-xs`}>
                      <div className="inline-flex items-center gap-1.5 font-medium text-[#111C17]">
                        <Building2 className="w-3.5 h-3.5 text-[#526259] shrink-0" aria-hidden="true" />
                        {member.department}
                      </div>
                      {member.specialty && (
                        <div className="text-[11px] text-[#526259] mt-0.5">{member.specialty}</div>
                      )}
                    </td>
                    <td className={`${cellPad} text-xs text-[#526259]`}>
                      {member.email || member.contactNumber ? (
                        <div className="space-y-0.5">
                          {member.email && (
                            <div className="inline-flex items-center gap-1 text-[#111C17]">
                              <Mail className="w-3 h-3 text-[#047857]" aria-hidden="true" />
                              {member.email}
                            </div>
                          )}
                          {member.contactNumber && (
                            <div className="inline-flex items-center gap-1 font-mono text-[11px] block">
                              <Phone className="w-3 h-3 text-[#526259]" aria-hidden="true" />
                              {member.contactNumber}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] italic text-[#64746B]">Not recorded</span>
                      )}
                    </td>
                    <td className={`${cellPad} text-xs font-mono tabular-nums text-[#111C17] whitespace-nowrap`}>
                      {member.role === 'Clinician' ? (
                        <div className="space-y-0.5">
                          <div className="inline-flex items-center gap-1 font-semibold text-[#0B261C]">
                            <Calendar className="w-3 h-3 text-[#047857]" aria-hidden="true" />
                            {member.upcomingAppointmentsCount ?? 0} upcoming
                          </div>
                          <div className="text-[11px] text-[#526259]">
                            {member.assignedAppointmentsCount ?? 0} total visits
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#526259]">Operations role</span>
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
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#047857] hover:text-[#0B261C]"
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
        )}
      </section>
    </div>
  );
}
