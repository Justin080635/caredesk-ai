import {
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Info,
  ShieldCheck,
  Sliders,
  UserCheck,
} from 'lucide-react';
import type { AccountSessionState } from '../shared/types';

interface SettingsViewProps {
  session: AccountSessionState;
  onOpenProfile: () => void;
  compactDensity: boolean;
  onToggleCompactDensity: (compact: boolean) => void;
  sidebarCollapsed: boolean;
  onToggleSidebarCollapsed: (collapsed: boolean) => void;
  onSuccessNotice: (msg: string) => void;
}

export function SettingsView({
  session,
  onOpenProfile,
  compactDensity,
  onToggleCompactDensity,
  sidebarCollapsed,
  onToggleSidebarCollapsed,
  onSuccessNotice,
}: SettingsViewProps) {
  const { user, activeClinic, activeMembership } = session;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Clinic & Workspace Preferences */}
      <div className="lg:col-span-6 space-y-6">
        <section className="card-surface rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2.5 border-b border-[#E3E8E4] pb-4">
            <Sliders className="w-5 h-5 text-[#047857]" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-[#111C17]">
                Workspace &amp; Display Settings
              </h2>
              <p className="text-xs text-[#526259]">
                Facility workspace identity, scheduling rules, and table density preferences
              </p>
            </div>
          </div>

          <dl className="divide-y divide-[#EEF2EF] text-sm">
            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <dt className="text-xs text-[#526259]">Active Clinic Workspace</dt>
              <dd className="font-medium text-[#111C17] text-right">
                {activeClinic?.name ?? 'Clinic Workspace'}
              </dd>
            </div>
            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <dt className="text-xs text-[#526259]">Clinic Type &amp; ID</dt>
              <dd className="font-mono text-xs font-medium text-[#047857] text-right">
                {activeClinic?.clinicType ?? 'Outpatient Clinic'} · {activeClinic?.id ?? '—'}
              </dd>
            </div>
            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <dt className="text-xs text-[#526259]">Clinic Scheduling Hours</dt>
              <dd className="font-mono text-xs font-medium text-[#111C17]">
                08:30 – 16:30 · 30-min standard slots
              </dd>
            </div>
          </dl>

          <div className="pt-4 flex items-center justify-between gap-4 border-t border-[#E3E8E4]">
            <div>
              <h3 className="text-sm font-medium text-[#111C17]">Compact Table Density</h3>
              <p className="text-xs text-[#526259] mt-0.5">
                Reduce vertical row padding across Patient, Appointment, and Follow-up tables.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={compactDensity}
              onClick={() => {
                const next = !compactDensity;
                onToggleCompactDensity(next);
                onSuccessNotice(
                  next ? 'Enabled compact table density.' : 'Switched to standard table density.'
                );
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                compactDensity ? 'bg-[#059669]' : 'bg-slate-300'
              }`}
              aria-label="Toggle compact table density"
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  compactDensity ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="pt-4 flex items-center justify-between gap-4 border-t border-[#E3E8E4]">
            <div>
              <h3 className="text-sm font-medium text-[#111C17]">Collapsed Navigation Rail</h3>
              <p className="text-xs text-[#526259] mt-0.5">
                Keep the desktop sidebar minimized to icon rail width for wider data tables.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={sidebarCollapsed}
              onClick={() => {
                const next = !sidebarCollapsed;
                onToggleSidebarCollapsed(next);
                onSuccessNotice(
                  next ? 'Collapsed desktop sidebar rail.' : 'Expanded desktop sidebar navigation.'
                );
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                sidebarCollapsed ? 'bg-[#059669]' : 'bg-slate-300'
              }`}
              aria-label="Toggle collapsed navigation rail"
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  sidebarCollapsed ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </section>

        <section className="card-surface rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 border-b border-[#E3E8E4] pb-4">
            <div className="flex items-center gap-2.5">
              <UserCheck className="w-5 h-5 text-[#047857]" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold text-[#111C17]">
                  Authenticated Account &amp; RBAC
                </h2>
                <p className="text-xs text-[#526259]">
                  Server-verified Firebase JWT &amp; clinic isolation boundary
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenProfile}
              className="btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0B261C] bg-[#ECF4EF] hover:bg-[#DCECE2] border border-[#C6DFD1] rounded-lg transition-colors shrink-0"
            >
              Manage Profile
              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between py-1">
              <span className="text-[#526259]">Signed-in User</span>
              <span className="font-semibold text-[#111C17]">{user.fullName}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-[#526259]">Account Email</span>
              <span className="font-mono text-[#111C17]">{user.email}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-[#526259]">Authorized Role</span>
              <span className="font-mono font-semibold text-[#047857]">
                {activeMembership?.role ?? 'Clinic Administrator'}
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-[#526259]">Clinic Boundary</span>
              <span className="inline-flex items-center gap-1 font-mono text-[#047857]">
                <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                {activeClinic?.id ?? '—'}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Right Column: Synapse CLI & MCP Readiness */}
      <div className="lg:col-span-6 space-y-6">
        <section className="card-surface rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2.5 border-b border-[#E3E8E4] pb-4">
            <Info className="w-5 h-5 text-[#047857]" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-[#111C17]">
                Synapse CLI &amp; MCP Integration Status
              </h2>
              <p className="text-xs text-[#526259]">
                Architectural readiness overview for CareDesk AI&apos;s multi-tenant backend
              </p>
            </div>
          </div>

          <div className="p-4 bg-[#ECF4EF] rounded-lg space-y-2 text-xs text-[#111C17]">
            <div className="flex items-center gap-2 font-semibold text-[#0B261C]">
              <ShieldCheck className="w-4 h-4 text-[#047857]" aria-hidden="true" />
              Status: Clinic-Isolated REST Preview Active
            </div>
            <p className="text-[#34433B] leading-relaxed">
              CareDesk&apos;s REST API endpoints (<code className="font-mono">/api/patients</code>,{' '}
              <code className="font-mono">/api/appointments</code>,{' '}
              <code className="font-mono">/api/followups</code>,{' '}
              <code className="font-mono">/api/reports</code>) and OpenAPI 3.0.3 schema (
              <code className="font-mono">/api/docs</code>) are authenticated via Firebase Bearer
              tokens and scoped to the active clinic boundary. CareDesk Assistant runs through a
              clinic-isolated Local REST Adapter ready for Synapse CLI MCP connection.
            </p>
          </div>

          <div className="divide-y divide-[#EEF2EF] text-xs">
            <div className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[#111C17] font-medium">
                <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" aria-hidden="true" />
                <span>Firebase Auth &amp; Server RBAC Enforcement</span>
              </div>
              <span className="font-mono text-[#047857]">Active</span>
            </div>
            <div className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[#111C17] font-medium">
                <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" aria-hidden="true" />
                <span>SQLite Multi-Clinic Isolation &amp; Conflict Rules</span>
              </div>
              <span className="font-mono text-[#047857]">Active</span>
            </div>
            <div className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[#111C17] font-medium">
                <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" aria-hidden="true" />
                <span>OpenAPI 3.0.3 Schema Exposed</span>
              </div>
              <span className="font-mono text-[#047857]">/api/docs</span>
            </div>
            <div className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[#111C17] font-medium">
                <Info className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                <span>Synapse CLI MCP Server Connection</span>
              </div>
              <span className="font-mono text-amber-700">Ready</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
