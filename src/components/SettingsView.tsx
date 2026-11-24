import { CheckCircle2, Info, ShieldCheck, Sliders, UserCheck } from 'lucide-react';
import type { UserRole } from '../shared/types';

interface SettingsViewProps {
  sessionRole: UserRole;
  sessionActor: string;
  passcodeRequired: boolean;
  onRoleSwitch: (role: UserRole) => void;
  compactDensity: boolean;
  onToggleCompactDensity: (compact: boolean) => void;
  sidebarCollapsed: boolean;
  onToggleSidebarCollapsed: (collapsed: boolean) => void;
  onSuccessNotice: (msg: string) => void;
}

export function SettingsView({
  sessionRole,
  sessionActor,
  passcodeRequired,
  onRoleSwitch,
  compactDensity,
  onToggleCompactDensity,
  sidebarCollapsed,
  onToggleSidebarCollapsed,
  onSuccessNotice,
}: SettingsViewProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Clinic & Workspace Identity */}
      <div className="lg:col-span-6 space-y-6">
        <section className="card-surface rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2.5 border-b border-[#E3E8E4] pb-4">
            <Sliders className="w-5 h-5 text-[#047857]" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-[#111C17]">
                Clinic Administration Settings
              </h2>
              <p className="text-xs text-[#526259]">
                Facility profile, scheduling parameters, and workspace density
              </p>
            </div>
          </div>

          <dl className="divide-y divide-[#EEF2EF] text-sm">
            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <dt className="text-xs text-[#526259]">Facility Profile</dt>
              <dd className="font-medium text-[#111C17] text-right">
                CareDesk Outpatient Operations Center
              </dd>
            </div>
            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <dt className="text-xs text-[#526259]">Data Environment</dt>
              <dd className="font-mono text-xs font-medium text-[#047857]">
                Synthetic Demo Records Only
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
          <div className="flex items-center gap-2.5 border-b border-[#E3E8E4] pb-4">
            <UserCheck className="w-5 h-5 text-[#047857]" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-[#111C17]">
                Active Staff Session &amp; Permissions
              </h2>
              <p className="text-xs text-[#526259]">
                Server-enforced HMAC Bearer token protecting administrative mutations
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[#111C17]">{sessionActor}</div>
              <div className="text-xs text-[#526259] mt-0.5">
                Active role:{' '}
                <span className="font-mono font-medium text-[#047857]">
                  {sessionRole === 'administrator' ? 'Administrator (Read + Write)' : 'Viewer (Read-Only)'}
                </span>
                <span aria-hidden="true"> · </span>
                <span>
                  {passcodeRequired ? 'Passcode required for Admin' : 'Demo preview access'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onRoleSwitch('administrator')}
                className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  sessionRole === 'administrator'
                    ? 'bg-[#0B261C] text-white border-[#0B261C]'
                    : 'bg-white text-[#111C17] border-[#E3E8E4] hover:bg-[#F6F8F6]'
                }`}
              >
                Use Administrator
              </button>
              <button
                type="button"
                onClick={() => onRoleSwitch('viewer')}
                className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  sessionRole === 'viewer'
                    ? 'bg-[#0B261C] text-white border-[#0B261C]'
                    : 'bg-white text-[#111C17] border-[#E3E8E4] hover:bg-[#F6F8F6]'
                }`}
              >
                Use Read-Only Viewer
              </button>
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
                Honest architectural readiness overview for CareDesk AI&apos;s backend
              </p>
            </div>
          </div>

          <div className="p-4 bg-[#ECF4EF] rounded-lg space-y-2 text-xs text-[#111C17]">
            <div className="flex items-center gap-2 font-semibold text-[#0B261C]">
              <ShieldCheck className="w-4 h-4 text-[#047857]" aria-hidden="true" />
              Status: Development Preview (Synapse MCP Server Not Yet Connected)
            </div>
            <p className="text-[#34433B] leading-relaxed">
              CareDesk&apos;s core REST API endpoints (<code className="font-mono">/api/patients</code>,{' '}
              <code className="font-mono">/api/appointments</code>,{' '}
              <code className="font-mono">/api/followups</code>,{' '}
              <code className="font-mono">/api/reports</code>) and OpenAPI schema (<code className="font-mono">/api/docs</code>) are live and backed by SQLite. CareDesk Assistant currently runs through a decoupled Local REST Adapter until Synapse CLI scans the backend and connects an MCP server.
            </p>
          </div>

          <div className="divide-y divide-[#EEF2EF] text-xs">
            <div className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[#111C17] font-medium">
                <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" aria-hidden="true" />
                <span>SQLite Relational Backend &amp; Conflict Rules</span>
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
              <span className="font-mono text-amber-700">Pending Integration</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
