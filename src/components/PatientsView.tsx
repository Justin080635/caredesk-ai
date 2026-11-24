import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, CalendarPlus, Pencil, Plus, Search, X } from 'lucide-react';
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
} from '../shared/types';
import { ClinicEmptyIllustration, EditorialAvatar } from './ClinicIllustrations';
import { ModalShell } from './ModalShell';
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
  compactDensity = false,
}: PatientsViewProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
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

  // Edit Patient Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStatus, setEditStatus] = useState<AdministrativeStatus>('Active');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const loadPatients = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPatients({ search, status: statusFilter });
      setPatients(data);
    } catch (err) {
      onErrorNotice(err instanceof Error ? err.message : 'Failed to load patients.');
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

  const handleSelectPatient = useCallback(
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
    if (initialSelectedPatientId) {
      handleSelectPatient(initialSelectedPatientId);
    }
  }, [initialSelectedPatientId, handleSelectPatient]);

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
      await handleSelectPatient(created.id);
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
      await Promise.all([loadPatients(), handleSelectPatient(updated.id)]);
      onDataMutated();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update patient record.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const statusTabs = ['All', 'Active', 'Pending Verification', 'Inactive'];
  const cellPad = compactDensity ? 'py-2 px-4' : 'py-3 px-4';

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
      className="inline-flex items-center gap-1 font-medium text-[#526259] hover:text-[#111C17] transition-colors"
      aria-label={`Sort by ${label} (${sortField === field ? sortDir : 'none'})`}
    >
      <span>{label}</span>
      <ArrowUpDown
        className={`w-3 h-3 ${sortField === field ? 'text-[#059669]' : 'text-slate-400'}`}
        aria-hidden="true"
      />
    </button>
  );

  return (
    <div className="space-y-5">
      {/* Patient Directory Summary Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setStatusFilter('All')}
          className="text-left bg-[#0B261C] hover:bg-[#12382A] text-white rounded-xl p-4 transition-colors btn-press"
        >
          <div className="text-xs font-medium text-emerald-200/85">Directory View</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1.5">
            {patients.length}
          </div>
          <div className="text-[11px] text-emerald-100/75 mt-0.5">
            Synthetic patient records matching filters
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('Active')}
          className="text-left card-surface card-interactive hover:border-[#059669] rounded-xl p-4 transition-colors btn-press"
        >
          <div className="text-xs font-medium text-[#526259]">Active Roster</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#047857] mt-1.5">
            {activeCount}
          </div>
          <div className="text-[11px] text-[#526259] mt-0.5">
            Verified for scheduling &amp; follow-up outreach
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('Pending Verification')}
          className="text-left card-surface card-interactive hover:border-[#059669] rounded-xl p-4 transition-colors btn-press"
        >
          <div className="text-xs font-medium text-[#526259]">Pending Verification</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#111C17] mt-1.5">
            {pendingVerCount}
          </div>
          <div className="text-[11px] text-[#526259] mt-0.5">
            Administrative intake confirmation needed
          </div>
        </button>
      </section>

      {/* Search & Filter Toolbar */}
      <div className="card-surface rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search
              className="w-4 h-4 text-[#526259] absolute left-3 top-1/2 -translate-y-1/2"
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
              className="w-full pl-9 pr-3 py-2 text-sm border border-[#D4DAD4] rounded-lg focus:outline-none focus:border-[#059669]"
            />
          </div>

          <div
            className="flex items-center gap-1 p-1 bg-[#F1F5F2] rounded-lg overflow-x-auto"
            role="group"
            aria-label="Filter patients by administrative status"
          >
            {statusTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab
                    ? 'bg-white text-[#0B261C] shadow-xs'
                    : 'text-[#526259] hover:text-[#111C17]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setShowCreateModal(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors whitespace-nowrap shrink-0 btn-press"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Register Patient
        </button>
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div
          className={`${
            selectedDetail || detailLoading ? 'lg:col-span-7' : 'lg:col-span-12'
          } card-surface rounded-xl overflow-hidden`}
        >
          <div className="px-5 py-3.5 border-b border-[#E3E8E4] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#111C17]">
              Synthetic Patient Directory
            </h2>
            <span className="text-xs font-mono tabular-nums text-[#526259]">
              {sortedPatients.length} record{sortedPatients.length === 1 ? '' : 's'}
            </span>
          </div>

          {loading ? (
            <div className="p-5 space-y-3" aria-label="Loading patients">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-[#F6F8F6]">
                  <div className="w-8 h-8 rounded-full bg-[#E3E8E4] shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-40 bg-[#E3E8E4] rounded" />
                    <div className="h-2.5 w-24 bg-[#EEF2EF] rounded" />
                  </div>
                  <div className="h-3.5 w-20 bg-[#E3E8E4] rounded" />
                </div>
              ))}
            </div>
          ) : sortedPatients.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <ClinicEmptyIllustration variant={search ? 'search' : 'patients'} />
              <div className="space-y-1">
                <p className="text-sm font-medium text-[#111C17]">
                  No patient records match your filter
                </p>
                <p className="text-xs text-[#526259]">
                  Adjust your search query, reset status filters, or register a new synthetic patient.
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
                    className="px-3.5 py-1.5 text-xs font-medium text-[#111C17] bg-white hover:bg-[#F6F8F6] border border-[#D4DAD4] rounded-lg transition-colors btn-press"
                  >
                    Clear Filters
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setShowCreateModal(true);
                  }}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors btn-press"
                >
                  Register Patient
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E3E8E4] bg-[#F6F8F6] text-xs">
                    <th className="py-2.5 px-4">{renderSortHeader('Patient ID', 'id')}</th>
                    <th className="py-2.5 px-4">{renderSortHeader('Full Name', 'fullName')}</th>
                    {!(selectedDetail || detailLoading) && (
                      <>
                        <th className="py-2.5 px-4">{renderSortHeader('Date of Birth', 'dateOfBirth')}</th>
                        <th className="py-2.5 px-4 font-medium text-[#526259]">Contact</th>
                        <th className="py-2.5 px-4">{renderSortHeader('Registered', 'registrationDate')}</th>
                      </>
                    )}
                    <th className="py-2.5 px-4">{renderSortHeader('Status', 'administrativeStatus')}</th>
                    <th className="py-2.5 px-4 text-right font-medium text-[#526259]">Profile</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2EF] text-sm">
                  {sortedPatients.map((patient) => (
                    <tr
                      key={patient.id}
                      className={`hover:bg-[#F6F8F6] transition-colors ${
                        selectedDetail?.id === patient.id ? 'bg-[#ECF4EF]/75' : ''
                      }`}
                    >
                      <td className={`${cellPad} font-mono tabular-nums text-xs font-semibold text-[#0B261C] whitespace-nowrap`}>
                        {patient.id}
                      </td>
                      <td className={`${cellPad} font-medium text-[#111C17]`}>
                        <div className="flex items-center gap-2.5">
                          <EditorialAvatar name={patient.fullName} role="patient" size="sm" />
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => handleSelectPatient(patient.id)}
                              className="text-left hover:text-[#047857] hover:underline"
                            >
                              {patient.fullName}
                            </button>
                            {(selectedDetail || detailLoading) && (
                              <div className="text-[11px] font-mono text-[#526259] mt-0.5">
                                {patient.contactNumber}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {!(selectedDetail || detailLoading) && (
                        <>
                          <td className={`${cellPad} font-mono tabular-nums text-xs text-[#526259] whitespace-nowrap`}>
                            {patient.dateOfBirth}
                          </td>
                          <td className={`${cellPad} text-xs text-[#526259]`}>
                            <div className="font-mono tabular-nums text-[#111C17]">{patient.contactNumber}</div>
                            <div>{patient.email}</div>
                          </td>
                          <td className={`${cellPad} font-mono tabular-nums text-xs text-[#526259] whitespace-nowrap`}>
                            {patient.registrationDate}
                          </td>
                        </>
                      )}
                      <td className={cellPad}>
                        <AdminStatusText status={patient.administrativeStatus} />
                      </td>
                      <td className={`${cellPad} text-right`}>
                        <button
                          type="button"
                          onClick={() => handleSelectPatient(patient.id)}
                          className="text-xs font-medium text-[#047857] hover:text-[#0B261C] whitespace-nowrap"
                          aria-label={`View record for ${patient.fullName} (${patient.id})`}
                        >
                          View Profile
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Individual Patient Profile Panel */}
        {(selectedDetail || detailLoading) && (
          <aside className="lg:col-span-5 lg:sticky lg:top-20 card-surface rounded-xl p-5 space-y-5 animate-view-enter">
            {detailLoading ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 pb-4 border-b border-[#E3E8E4]">
                  <div className="w-10 h-10 rounded-full bg-[#E3E8E4]" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3 w-28 bg-[#EEF2EF] rounded" />
                    <div className="h-4 w-44 bg-[#E3E8E4] rounded" />
                  </div>
                </div>
                <div className="h-32 bg-[#F6F8F6] rounded-lg" />
              </div>
            ) : (
              selectedDetail && (
                <>
                  <div className="flex items-start justify-between gap-3 border-b border-[#E3E8E4] pb-4">
                    <div className="flex items-start gap-3">
                      <EditorialAvatar name={selectedDetail.fullName} role="patient" size="md" />
                      <div>
                        <div className="text-xs font-mono text-[#526259]">
                          {selectedDetail.id} · Registered {selectedDetail.registrationDate}
                        </div>
                        <h3 className="text-lg font-semibold text-[#111C17] mt-0.5">
                          {selectedDetail.fullName}
                        </h3>
                        <div className="mt-1">
                          <AdminStatusText status={selectedDetail.administrativeStatus} />
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDetail(null)}
                      className="p-1.5 text-[#526259] hover:text-[#111C17] rounded-md"
                      aria-label="Close patient details"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>

                  <dl className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-[#526259]">Date of Birth</dt>
                      <dd className="font-mono tabular-nums font-medium text-[#111C17] mt-0.5">
                        {selectedDetail.dateOfBirth}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#526259]">Contact Number</dt>
                      <dd className="font-mono tabular-nums font-medium text-[#111C17] mt-0.5">
                        {selectedDetail.contactNumber}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[#526259]">Email Address</dt>
                      <dd className="font-medium text-[#111C17] mt-0.5">
                        {selectedDetail.email}
                      </dd>
                    </div>
                  </dl>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => openEditPatientModal(selectedDetail)}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111C17] bg-white hover:bg-[#F6F8F6] border border-[#D4DAD4] rounded-lg transition-colors btn-press"
                    >
                      <Pencil className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                      Edit Patient Info
                    </button>
                    <button
                      type="button"
                      onClick={() => onQuickScheduleForPatient(selectedDetail.id)}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#0B261C] bg-[#ECF4EF] hover:bg-[#D7E6DD] rounded-lg transition-colors btn-press"
                    >
                      <CalendarPlus className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                      Schedule Visit
                    </button>
                  </div>

                  <div className="border-t border-[#E3E8E4] pt-4">
                    <h4 className="text-xs font-semibold text-[#111C17] mb-2.5">
                      Appointments ({selectedDetail.appointments.length})
                    </h4>
                    {selectedDetail.appointments.length === 0 ? (
                      <p className="text-xs text-[#526259]">No appointments on file.</p>
                    ) : (
                      <div className="divide-y divide-[#EEF2EF] max-h-48 overflow-y-auto">
                        {selectedDetail.appointments.map((apt) => (
                          <div
                            key={apt.id}
                            className="py-2.5 text-xs flex items-center justify-between gap-2"
                          >
                            <div>
                              <div className="font-mono tabular-nums font-medium text-[#111C17]">
                                {apt.appointmentDate} {apt.appointmentTime} · {apt.id}
                              </div>
                              <div className="text-[#526259] mt-0.5">
                                {apt.department} · {apt.clinician}
                              </div>
                            </div>
                            <AppointmentStatusText status={apt.status} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-[#E3E8E4] pt-4">
                    <h4 className="text-xs font-semibold text-[#111C17] mb-2.5">
                      Administrative Follow-ups ({selectedDetail.followups.length})
                    </h4>
                    {selectedDetail.followups.length === 0 ? (
                      <p className="text-xs text-[#526259]">No follow-up tasks linked.</p>
                    ) : (
                      <div className="divide-y divide-[#EEF2EF] max-h-40 overflow-y-auto">
                        {selectedDetail.followups.map((fu) => (
                          <div
                            key={fu.id}
                            className="py-2.5 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-medium text-[#111C17]">
                                {fu.id} · Due {fu.dueDate}
                              </span>
                              <FollowUpStatusText status={fu.status} />
                            </div>
                            <p className="text-[#526259] mt-1">{fu.description}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )
            )}
          </aside>
        )}
      </div>

      {/* Register New Patient Modal */}
      <ModalShell
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        labelledBy="register-patient-title"
        maxWidthClass="max-w-lg"
      >
            <div className="flex items-center justify-between">
              <div>
                <h3 id="register-patient-title" className="text-base font-semibold text-[#16211C]">
                  Register Synthetic Patient
                </h3>
                <p className="text-xs text-[#526058] mt-0.5">
                  Use fictional demonstration details only. No real patient data.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-[#526058] hover:text-[#16211C]"
                aria-label="Close register patient dialog"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {formError && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {formError}
              </div>
            )}

            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <div>
                <label htmlFor="reg-full-name" className="block text-xs font-medium text-[#16211C] mb-1">
                  Full Name
                </label>
                <input
                  id="reg-full-name"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Lydia Alverez"
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="reg-dob" className="block text-xs font-medium text-[#16211C] mb-1">
                    Date of Birth
                  </label>
                  <input
                    id="reg-dob"
                    type="date"
                    required
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="reg-phone" className="block text-xs font-medium text-[#16211C] mb-1">
                    Contact Number
                  </label>
                  <input
                    id="reg-phone"
                    type="tel"
                    required
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    placeholder="+1-555-0190"
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="reg-email" className="block text-xs font-medium text-[#16211C] mb-1">
                    Email
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="lydia.alverez@example.org"
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="reg-status" className="block text-xs font-medium text-[#16211C] mb-1">
                    Administrative Status
                  </label>
                  <select
                    id="reg-status"
                    value={adminStatus}
                    onChange={(e) => setAdminStatus(e.target.value as AdministrativeStatus)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    <option value="Active">Active</option>
                    <option value="Pending Verification">Pending Verification</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E4E7E2]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-[#526058] hover:text-[#16211C] border border-[#E4E7E2] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 btn-press"
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
                <h3 id="edit-patient-title" className="text-base font-semibold text-[#16211C]">
                  Edit Patient Record · {selectedDetail?.id}
                </h3>
                <p className="text-xs text-[#526058] mt-0.5">
                  Changes persist directly to CareDesk&apos;s relational patient directory.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="p-1 text-[#526058] hover:text-[#16211C]"
                aria-label="Close edit patient dialog"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {editError && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {editError}
              </div>
            )}

            <form onSubmit={handleEditPatientSubmit} className="space-y-4">
              <div>
                <label htmlFor="edit-full-name" className="block text-xs font-medium text-[#16211C] mb-1">
                  Full Name
                </label>
                <input
                  id="edit-full-name"
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-dob" className="block text-xs font-medium text-[#16211C] mb-1">
                    Date of Birth
                  </label>
                  <input
                    id="edit-dob"
                    type="date"
                    required
                    value={editDob}
                    onChange={(e) => setEditDob(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-phone" className="block text-xs font-medium text-[#16211C] mb-1">
                    Contact Number
                  </label>
                  <input
                    id="edit-phone"
                    type="tel"
                    required
                    value={editContact}
                    onChange={(e) => setEditContact(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-email" className="block text-xs font-medium text-[#16211C] mb-1">
                    Email
                  </label>
                  <input
                    id="edit-email"
                    type="email"
                    required
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-status" className="block text-xs font-medium text-[#16211C] mb-1">
                    Administrative Status
                  </label>
                  <select
                    id="edit-status"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as AdministrativeStatus)}
                    className="w-full px-3 py-2 text-sm border border-[#D4DAD4] rounded-lg bg-white"
                  >
                    <option value="Active">Active</option>
                    <option value="Pending Verification">Pending Verification</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E4E7E2]">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-sm font-medium text-[#526058] hover:text-[#16211C] border border-[#E4E7E2] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#059669] hover:bg-[#047857] rounded-lg disabled:opacity-50 btn-press"
                >
                  {editSubmitting ? 'Saving Changes...' : 'Save Patient Info'}
                </button>
              </div>
            </form>
      </ModalShell>
    </div>
  );
}
