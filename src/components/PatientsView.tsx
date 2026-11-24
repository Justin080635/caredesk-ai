import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  ArrowUpRight,
  CalendarPlus,
  Pencil,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  createPatientRecord,
  fetchPatientDetail,
  fetchPatients,
  updatePatientRecord,
} from '../client/api';
import type {
  AdministrativeStatus,
  Appointment,
  FollowUpTask,
  Patient,
  UserRole,
} from '../shared/types';
import { ClinicEmptyIllustration, EditorialAvatar } from './ClinicIllustrations';
import { ModalShell } from './ModalShell';
import { TableSkeleton } from './Skeletons';
import { AdminStatusText, AppointmentStatusText, FollowUpStatusText } from './StatusText';

type SortField = 'id' | 'fullName' | 'dateOfBirth' | 'registrationDate' | 'administrativeStatus';

interface PatientsViewProps {
  onDataMutated: () => void;
  onErrorNotice: (msg: string) => void;
  onSuccessNotice: (msg: string) => void;
  onQuickScheduleForPatient: (patientId: string) => void;
  openCreateSignal: number;
  initialSelectedPatientId?: string | null;
  initialStatusFilter?: string;
  onOpenPatient?: (patientId: string) => void;
  sessionRole?: UserRole;
  compactDensity?: boolean;
}

export function PatientsView({
  onDataMutated,
  onErrorNotice,
  onSuccessNotice,
  onQuickScheduleForPatient,
  openCreateSignal,
  initialSelectedPatientId,
  initialStatusFilter,
  onOpenPatient,
  sessionRole = 'administrator',
  compactDensity = false,
}: PatientsViewProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter ?? 'All');
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [selectedDetail, setSelectedDetail] = useState<
    (Patient & { appointments: Appointment[]; followups: FollowUpTask[] }) | null
  >(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [email, setEmail] = useState('');
  const [adminStatus, setAdminStatus] = useState<AdministrativeStatus>('Active');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStatus, setEditStatus] = useState<AdministrativeStatus>('Active');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const canWrite = sessionRole === 'administrator';

  const loadPatients = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchPatients({ search, status: statusFilter });
      setPatients(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load patients.';
      setLoadError(msg);
      onErrorNotice(msg);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, onErrorNotice]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  useEffect(() => {
    if (openCreateSignal > 0) {
      setFormError(null);
      setShowCreateModal(true);
    }
  }, [openCreateSignal]);

  const handleOpenDrawer = useCallback(
    async (patientId: string) => {
      setDetailLoading(true);
      try {
        const detail = await fetchPatientDetail(patientId);
        setSelectedDetail(detail);
      } catch (err) {
        onErrorNotice(err instanceof Error ? err.message : 'Unable to load patient record.');
      } finally {
        setDetailLoading(false);
      }
    },
    [onErrorNotice]
  );

  useEffect(() => {
    if (initialSelectedPatientId && !onOpenPatient) {
      handleOpenDrawer(initialSelectedPatientId);
    }
  }, [initialSelectedPatientId, handleOpenDrawer, onOpenPatient]);

  useEffect(() => {
    if (initialStatusFilter) {
      setStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedPatients = useMemo(() => {
    const copy = [...patients];
    copy.sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      const cmp = String(valA).localeCompare(String(valB));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [patients, sortField, sortDir]);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await createPatientRecord({
        fullName,
        dateOfBirth,
        contactNumber,
        email,
        administrativeStatus: adminStatus,
      });
      setShowCreateModal(false);
      setFullName('');
      setDateOfBirth('');
      setContactNumber('');
      setEmail('');
      setAdminStatus('Active');
      onSuccessNotice(`Registered patient ${created.fullName} (${created.id}).`);
      await loadPatients();
      await handleOpenDrawer(created.id);
      onDataMutated();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to register patient.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditPatientModal = (patient: Patient) => {
    setEditFullName(patient.fullName);
    setEditDob(patient.dateOfBirth);
    setEditContact(patient.contactNumber);
    setEditEmail(patient.email);
    setEditStatus(patient.administrativeStatus);
    setEditError(null);
    setShowEditModal(true);
  };

  const handleEditPatientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDetail) return;
    setEditError(null);
    setEditSubmitting(true);
    try {
      const updated = await updatePatientRecord(selectedDetail.id, {
        fullName: editFullName,
        dateOfBirth: editDob,
        contactNumber: editContact,
        email: editEmail,
        administrativeStatus: editStatus,
      });
      setShowEditModal(false);
      onSuccessNotice(`Updated patient ${updated.fullName} (${updated.id}).`);
      await Promise.all([loadPatients(), handleOpenDrawer(updated.id)]);
      onDataMutated();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update patient record.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const statusTabs = ['All', 'Active', 'Pending Verification', 'Inactive'];
  const cellPad = compactDensity ? 'py-2.5 px-4' : 'py-3.5 px-4';

  const activeCount = useMemo(
    () => patients.filter((p) => p.administrativeStatus === 'Active').length,
    [patients]
  );
  const pendingVerCount = useMemo(
    () => patients.filter((p) => p.administrativeStatus === 'Pending Verification').length,
    [patients]
  );

  const renderSortHeader = (label: string, field: SortField) => (
    <button
      type="button"
      onClick={() => toggleSort(field)}
      className="inline-flex items-center gap-1 font-semibold text-[#6B7B73] hover:text-[#1C2B25] transition-colors"
      aria-label={`Sort by ${label} (${sortField === field ? sortDir : 'none'})`}
    >
      <span>{label}</span>
      <ArrowUpDown
        className={`w-3 h-3 ${sortField === field ? 'text-[#137A55]' : 'text-[#9BA8A1]'}`}
        aria-hidden="true"
      />
    </button>
  );

  return (
    <div className="space-y-5 animate-view-enter">
      {/* Directory Summary Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setStatusFilter('All')}
          className="btn-press text-left rounded-[22px] bg-[#0F3D2E] hover:bg-[#144D3B] text-white p-5 transition-colors"
        >
          <div className="text-xs font-medium text-emerald-100/80">Patient Directory</div>
          <div className="text-[28px] leading-none font-bold font-mono tabular-nums mt-2">
            {patients.length}
          </div>
          <div className="text-[11px] text-emerald-100/75 mt-1.5">
            Total matching patient records
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('Active')}
          className="btn-press text-left card-surface card-interactive rounded-[22px] p-5"
        >
          <div className="text-xs font-medium text-[#6B7B73]">Active Roster</div>
          <div className="text-[28px] leading-none font-bold font-mono tabular-nums text-[#137A55] mt-2">
            {activeCount}
          </div>
          <div className="text-[11px] text-[#6B7B73] mt-1.5">
            Verified for scheduling &amp; outreach
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('Pending Verification')}
          className="btn-press text-left card-surface card-interactive rounded-[22px] p-5"
        >
          <div className="text-xs font-medium text-[#6B7B73]">Pending Verification</div>
          <div className="text-[28px] leading-none font-bold font-mono tabular-nums text-[#1C2B25] mt-2">
            {pendingVerCount}
          </div>
          <div className="text-[11px] text-[#6B7B73] mt-1.5">
            Intake confirmation needed
          </div>
        </button>
      </section>

      {/* Search & Filter Pills Bar */}
      <div className="card-surface rounded-[22px] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0">
          <div className="relative flex-1 sm:max-w-md min-w-0">
            <Search
              className="w-4 h-4 text-[#6B7B73] absolute left-3.5 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <label htmlFor="patient-search-input" className="sr-only">
              Search patients by ID, name, or email
            </label>
            <input
              id="patient-search-input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by ID (e.g. P-1042), name, phone, or email..."
              className="w-full min-h-[44px] sm:min-h-0 pl-10 pr-4 py-2 text-sm bg-[#FAFBF9] border border-[#DCE8E0] rounded-full focus:bg-white focus:outline-none focus:border-[#34C38F]"
            />
          </div>

          <div
            className="flex items-center gap-1 p-1 bg-[#EEF3EF] border border-[#DCE8E0] rounded-full overflow-x-auto max-w-full"
            role="group"
            aria-label="Filter patients by administrative status"
          >
            {statusTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`min-h-[44px] sm:min-h-0 px-3.5 py-1.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab
                    ? 'bg-[#0F3D2E] text-white shadow-xs'
                    : 'text-[#6B7B73] hover:text-[#1C2B25]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={!canWrite}
          title={!canWrite ? 'Administrator session required to register new patients' : undefined}
          onClick={() => {
            setFormError(null);
            setShowCreateModal(true);
          }}
          className="btn-press min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Register Patient
        </button>
      </div>

      {/* Patient Directory Table */}
      <div className="card-surface rounded-[24px] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#EEF3EF] flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[#1C2B25]">Patient Directory</h2>
            <p className="text-xs text-[#6B7B73] mt-0.5">
              Select any patient to slide open their quick chart &amp; appointment history
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-[#6B7B73]">
            {sortedPatients.length} record{sortedPatients.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={5} label="Loading patients" />
        ) : loadError ? (
          <div className="p-10 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-rose-700 mx-auto" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#1C2B25]">Unable to load patient directory</p>
              <p className="text-xs text-[#6B7B73] max-w-md mx-auto">{loadError}</p>
            </div>
            <button
              type="button"
              onClick={loadPatients}
              className="btn-press px-4 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] rounded-full"
            >
              Retry
            </button>
          </div>
        ) : sortedPatients.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <ClinicEmptyIllustration variant={search ? 'search' : 'patients'} />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#1C2B25]">
                No patient records match your filter
              </p>
              <p className="text-xs text-[#6B7B73]">
                Adjust your search query, reset status filters, or register a new patient.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-1">
              {(search || statusFilter !== 'All') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('All');
                  }}
                  className="btn-press px-4 py-2 text-xs font-semibold text-[#1C2B25] bg-[#FAFBF9] hover:bg-[#EEF3EF] border border-[#DCE8E0] rounded-full"
                >
                  Clear Filters
                </button>
              )}
              {canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setShowCreateModal(true);
                  }}
                  className="btn-press px-4 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] rounded-full"
                >
                  Register Patient
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Mobile Stacked Patient Cards */}
            <div className="md:hidden divide-y divide-[#EEF3EF]">
              {sortedPatients.map((patient) => (
                <article
                  key={patient.id}
                  className={`p-4 space-y-3 ${
                    selectedDetail?.id === patient.id ? 'bg-[#E9F5EE]/75' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <EditorialAvatar name={patient.fullName} role="patient" size="sm" />
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => handleOpenDrawer(patient.id)}
                          className="text-sm font-bold text-[#1C2B25] hover:text-[#137A55] text-left truncate block"
                        >
                          {patient.fullName}
                        </button>
                        <div className="text-[11px] font-mono text-[#0F3D2E] tabular-nums">
                          {patient.id} · DOB {patient.dateOfBirth}
                        </div>
                      </div>
                    </div>
                    <AdminStatusText status={patient.administrativeStatus} />
                  </div>

                  <div className="grid grid-cols-1 gap-1 text-xs text-[#6B7B73] bg-[#FAFBF9] rounded-2xl p-3 border border-[#EEF3EF]">
                    <div className="font-mono tabular-nums text-[#1C2B25]">{patient.contactNumber}</div>
                    <div className="truncate">{patient.email}</div>
                    <div className="text-[11px] font-mono">Registered {patient.registrationDate}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenDrawer(patient.id)}
                      className="btn-press flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold text-[#0F3D2E] bg-[#EEF3EF] hover:bg-[#DCE8E0]"
                      aria-label={`Inspect ${patient.fullName} (${patient.id})`}
                    >
                      <span>Inspect Chart</span>
                      <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => onQuickScheduleForPatient(patient.id)}
                        className="btn-press min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482]"
                      >
                        <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
                        Book
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#EEF3EF] bg-[#FAFBF9] text-xs">
                    <th className="py-3 px-4">{renderSortHeader('Patient ID', 'id')}</th>
                    <th className="py-3 px-4">{renderSortHeader('Patient', 'fullName')}</th>
                    <th className="py-3 px-4">{renderSortHeader('Date of Birth', 'dateOfBirth')}</th>
                    <th className="py-3 px-4 font-semibold text-[#6B7B73]">Contact</th>
                    <th className="py-3 px-4">{renderSortHeader('Registered', 'registrationDate')}</th>
                    <th className="py-3 px-4">{renderSortHeader('Status', 'administrativeStatus')}</th>
                    <th className="py-3 px-4 text-right font-semibold text-[#6B7B73]">Profile</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF3EF] text-sm">
                  {sortedPatients.map((patient) => (
                    <tr
                      key={patient.id}
                      className={`hover:bg-[#F5F9F6] transition-colors ${
                        selectedDetail?.id === patient.id ? 'bg-[#E9F5EE]/75' : ''
                      }`}
                    >
                      <td
                        className={`${cellPad} font-mono tabular-nums text-xs font-semibold text-[#0F3D2E] whitespace-nowrap`}
                      >
                        {patient.id}
                      </td>
                      <td className={`${cellPad} font-semibold text-[#1C2B25]`}>
                        <div className="flex items-center gap-3">
                          <EditorialAvatar name={patient.fullName} role="patient" size="sm" />
                          <button
                            type="button"
                            onClick={() => handleOpenDrawer(patient.id)}
                            className="text-left hover:text-[#137A55] hover:underline"
                          >
                            {patient.fullName}
                          </button>
                        </div>
                      </td>
                      <td
                        className={`${cellPad} font-mono tabular-nums text-xs text-[#6B7B73] whitespace-nowrap`}
                      >
                        {patient.dateOfBirth}
                      </td>
                      <td className={`${cellPad} text-xs text-[#6B7B73]`}>
                        <div className="font-mono tabular-nums text-[#1C2B25]">
                          {patient.contactNumber}
                        </div>
                        <div className="truncate max-w-[190px]">{patient.email}</div>
                      </td>
                      <td
                        className={`${cellPad} font-mono tabular-nums text-xs text-[#6B7B73] whitespace-nowrap`}
                      >
                        {patient.registrationDate}
                      </td>
                      <td className={cellPad}>
                        <AdminStatusText status={patient.administrativeStatus} />
                      </td>
                      <td className={`${cellPad} text-right`}>
                        <button
                          type="button"
                          onClick={() => handleOpenDrawer(patient.id)}
                          className="btn-press inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold text-[#0F3D2E] bg-[#EEF3EF] hover:bg-[#DCE8E0] whitespace-nowrap"
                          aria-label={`Inspect ${patient.fullName} (${patient.id})`}
                        >
                          <span>Inspect</span>
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
      </div>

      {/* Slide-in Side Drawer for Profile & Appointment History */}
      {(selectedDetail || detailLoading) && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div
            className="fixed inset-0 bg-[#0F3D2E]/30 backdrop-blur-[1px] animate-modal-overlay"
            onClick={() => setSelectedDetail(null)}
            aria-hidden="true"
          />
          <aside
            aria-label="Patient profile drawer"
            className="relative z-10 w-full max-w-md h-full bg-[#FAFBF9] border-l border-[#DCE8E0] shadow-2xl overflow-y-auto p-6 space-y-5 animate-drawer-right"
          >
            {detailLoading ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 pb-4 border-b border-[#DCE8E0]">
                  <div className="w-11 h-11 rounded-full bg-[#DCE8E0] animate-pulse" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3 w-28 bg-[#EEF3EF] rounded animate-pulse" />
                    <div className="h-4 w-44 bg-[#DCE8E0] rounded animate-pulse" />
                  </div>
                </div>
                <div className="h-32 bg-white rounded-2xl border border-[#DCE8E0] animate-pulse" />
              </div>
            ) : (
              selectedDetail && (
                <>
                  <div className="flex items-start justify-between gap-3 border-b border-[#DCE8E0] pb-4">
                    <div className="flex items-start gap-3">
                      <EditorialAvatar name={selectedDetail.fullName} role="patient" size="md" />
                      <div>
                        <div className="text-xs font-mono text-[#6B7B73]">
                          {selectedDetail.id} · Since {selectedDetail.registrationDate}
                        </div>
                        <h3 className="text-lg font-bold text-[#1C2B25] mt-0.5">
                          {selectedDetail.fullName}
                        </h3>
                        <div className="mt-1.5">
                          <AdminStatusText status={selectedDetail.administrativeStatus} />
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDetail(null)}
                      className="p-2 text-[#6B7B73] hover:text-[#1C2B25] rounded-full hover:bg-[#EEF3EF]"
                      aria-label="Close patient drawer"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>

                  <dl className="grid grid-cols-2 gap-3 text-xs bg-white border border-[#DCE8E0] rounded-[20px] p-4">
                    <div>
                      <dt className="text-[#6B7B73]">Date of Birth</dt>
                      <dd className="font-mono tabular-nums font-semibold text-[#1C2B25] mt-0.5">
                        {selectedDetail.dateOfBirth}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#6B7B73]">Contact Number</dt>
                      <dd className="font-mono tabular-nums font-semibold text-[#1C2B25] mt-0.5">
                        {selectedDetail.contactNumber}
                      </dd>
                    </div>
                    <div className="col-span-2 pt-2 border-t border-[#EEF3EF]">
                      <dt className="text-[#6B7B73]">Email Address</dt>
                      <dd className="font-medium text-[#1C2B25] mt-0.5">
                        {selectedDetail.email}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap gap-2">
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => openEditPatientModal(selectedDetail)}
                        className="btn-press flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1C2B25] bg-white hover:bg-[#EEF3EF] border border-[#DCE8E0] rounded-full"
                      >
                        <Pencil className="w-3.5 h-3.5 text-[#137A55]" aria-hidden="true" />
                        Edit Info
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onQuickScheduleForPatient(selectedDetail.id)}
                      className="btn-press flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full"
                    >
                      <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
                      Schedule Visit
                    </button>
                    {onOpenPatient && (
                      <button
                        type="button"
                        onClick={() => {
                          const pid = selectedDetail.id;
                          setSelectedDetail(null);
                          onOpenPatient(pid);
                        }}
                        className="btn-press w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F3D2E] hover:bg-[#144D3B] rounded-full"
                      >
                        Open Full Patient Chart
                        <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  {/* Appointment History */}
                  <div className="bg-white border border-[#DCE8E0] rounded-[20px] p-4 space-y-2.5">
                    <h4 className="text-xs font-bold text-[#1C2B25]">
                      Appointment History ({selectedDetail.appointments.length})
                    </h4>
                    {selectedDetail.appointments.length === 0 ? (
                      <p className="text-xs text-[#6B7B73]">No appointments on file.</p>
                    ) : (
                      <div className="divide-y divide-[#EEF3EF] max-h-56 overflow-y-auto">
                        {selectedDetail.appointments.map((apt) => (
                          <div
                            key={apt.id}
                            className="py-2.5 text-xs flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-mono tabular-nums font-semibold text-[#1C2B25]">
                                {apt.appointmentDate} · {apt.appointmentTime}
                              </div>
                              <div className="text-[#6B7B73] truncate mt-0.5">
                                {apt.department} · {apt.clinician}
                              </div>
                            </div>
                            <AppointmentStatusText status={apt.status} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Administrative Follow-ups */}
                  <div className="bg-white border border-[#DCE8E0] rounded-[20px] p-4 space-y-2.5">
                    <h4 className="text-xs font-bold text-[#1C2B25]">
                      Follow-up Tasks ({selectedDetail.followups.length})
                    </h4>
                    {selectedDetail.followups.length === 0 ? (
                      <p className="text-xs text-[#6B7B73]">No follow-up tasks linked.</p>
                    ) : (
                      <div className="divide-y divide-[#EEF3EF] max-h-48 overflow-y-auto">
                        {selectedDetail.followups.map((fu) => (
                          <div key={fu.id} className="py-2.5 text-xs space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-semibold text-[#1C2B25]">
                                {fu.id} · Due {fu.dueDate}
                              </span>
                              <FollowUpStatusText status={fu.status} />
                            </div>
                            <p className="text-[#6B7B73]">{fu.description}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )
            )}
          </aside>
        </div>
      )}

      {/* Register New Patient Modal */}
      <ModalShell
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        labelledBy="register-patient-title"
        maxWidthClass="max-w-lg"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 id="register-patient-title" className="text-base font-bold text-[#1C2B25]">
              Register Patient
            </h3>
            <p className="text-xs text-[#6B7B73] mt-0.5">
              Add a new patient profile to this clinic directory.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(false)}
            className="p-1.5 text-[#6B7B73] hover:text-[#1C2B25] rounded-full hover:bg-[#EEF3EF]"
            aria-label="Close register patient dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {formError && (
          <div className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-2xl">
            {formError}
          </div>
        )}

        <form onSubmit={handleRegisterSubmit} className="space-y-4">
          <div>
            <label htmlFor="reg-full-name" className="block text-xs font-semibold text-[#1C2B25] mb-1">
              Full Name
            </label>
            <input
              id="reg-full-name"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Lydia Alverez"
              className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="reg-dob" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Date of Birth
              </label>
              <input
                id="reg-dob"
                type="date"
                required
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="reg-phone" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Contact Number
              </label>
              <input
                id="reg-phone"
                type="tel"
                required
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="+1-555-0190"
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="reg-email" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Email
              </label>
              <input
                id="reg-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="lydia.alverez@example.org"
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="reg-status" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Administrative Status
              </label>
              <select
                id="reg-status"
                value={adminStatus}
                onChange={(e) => setAdminStatus(e.target.value as AdministrativeStatus)}
                className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
              >
                <option value="Active">Active</option>
                <option value="Pending Verification">Pending Verification</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#DCE8E0]">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="btn-press px-4 py-2 text-xs font-semibold text-[#6B7B73] hover:text-[#1C2B25] border border-[#DCE8E0] rounded-full"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-press px-5 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full disabled:opacity-50"
            >
              {submitting ? 'Registering...' : 'Register Patient'}
            </button>
          </div>
        </form>
      </ModalShell>

      {/* Edit Existing Patient Modal */}
      <ModalShell
        open={Boolean(showEditModal && selectedDetail)}
        onClose={() => setShowEditModal(false)}
        labelledBy="edit-patient-title"
        maxWidthClass="max-w-lg"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 id="edit-patient-title" className="text-base font-bold text-[#1C2B25]">
              Edit Patient Record · {selectedDetail?.id}
            </h3>
            <p className="text-xs text-[#6B7B73] mt-0.5">
              Updates save directly to the clinic patient directory.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowEditModal(false)}
            className="p-1.5 text-[#6B7B73] hover:text-[#1C2B25] rounded-full hover:bg-[#EEF3EF]"
            aria-label="Close edit patient dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {editError && (
          <div className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-2xl">
            {editError}
          </div>
        )}

        <form onSubmit={handleEditPatientSubmit} className="space-y-4">
          <div>
            <label htmlFor="edit-full-name" className="block text-xs font-semibold text-[#1C2B25] mb-1">
              Full Name
            </label>
            <input
              id="edit-full-name"
              type="text"
              required
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-dob" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Date of Birth
              </label>
              <input
                id="edit-dob"
                type="date"
                required
                value={editDob}
                onChange={(e) => setEditDob(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="edit-phone" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Contact Number
              </label>
              <input
                id="edit-phone"
                type="tel"
                required
                value={editContact}
                onChange={(e) => setEditContact(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-email" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Email
              </label>
              <input
                id="edit-email"
                type="email"
                required
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#DCE8E0] rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="edit-status" className="block text-xs font-semibold text-[#1C2B25] mb-1">
                Administrative Status
              </label>
              <select
                id="edit-status"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as AdministrativeStatus)}
                className="w-full px-3.5 py-2 text-sm border border-[#DCE8E0] rounded-xl bg-white"
              >
                <option value="Active">Active</option>
                <option value="Pending Verification">Pending Verification</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#DCE8E0]">
            <button
              type="button"
              onClick={() => setShowEditModal(false)}
              className="btn-press px-4 py-2 text-xs font-semibold text-[#6B7B73] hover:text-[#1C2B25] border border-[#DCE8E0] rounded-full"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={editSubmitting}
              className="btn-press px-5 py-2 text-xs font-bold text-[#0F3D2E] bg-[#34C38F] hover:bg-[#2bb482] rounded-full disabled:opacity-50"
            >
              {editSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
