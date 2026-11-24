import { CheckCircle2, Info, ShieldCheck, Sliders, UserCheck } from 'lucide-react';
import type { UserRole } from '../shared/types';

interface SettingsViewProps {
  sessionRole: UserRole;
  sessionActor: string;
  passcodeRequired: boolean;
  onRoleSwitch: (role: UserRole) => void;
  compactDensity: boolean;
  onToggleCompactDensity: (compact: boolean) => void;
  onSuccessNotice: (msg: string) => void;
}

export function SettingsView({
  sessionRole,
  sessionActor,
  passcodeRequired,
  onRoleSwitch,
  compactDensity,
  onToggleCompactDensity,
  onSuccessNotice,
}: SettingsViewProps) {
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Clinic & Workspace Identity */}
      <section className="bg-white border border-[#E4E7E2] rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2.5 border-b border-[#E4E7E2] pb-4">
          <Sliders className="w-5 h-5 text-[#047857]" aria-hidden="true" />
          <div>
            <h2 className="text-base font-semibold text-[#16211C]">
              Clinic Administration Settings
            </h2>
            <p className="text-xs text-[#526058]">
              Configure operational display preferences, role access, and integration readiness.
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="p-3.5 bg-[#F7F8F6] border border-[#E4E7E2] rounded-lg">
            <dt className="text-xs text-[#526058]">Facility Profile</dt>
            <dd className="font-medium text-[#16211C] mt-0.5">
              CareDesk Outpatient Operations Center (Synthetic Demo)
            </dd>
          </div>
          <div className="p-3.5 bg-[#F7F8F6] border border-[#E4E7E2] rounded-lg">
            <dt className="text-xs text-[#526058]">Clinic Scheduling Hours</dt>
            <dd className="font-mono text-xs font-medium text-[#16211C] mt-1">
              08:30 – 16:30 · 30-minute standard slots
            </dd>
          </div>
        </dl>

        <div className="pt-2 flex items-center justify-between gap-4 border-t border-[#E4E7E2]">
          <div>
            <h3 className="text-sm font-medium text-[#16211C]">Compact Table Density</h3>
            <p className="text-xs text-[#526058]">
              Reduce vertical row padding across Patient, Appointment, and Follow-up directories.
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
      </section>

      {/* Access Control & Session Role */}
      <section className="bg-white border border-[#E4E7E2] rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2.5 border-b border-[#E4E7E2] pb-4">
          <UserCheck className="w-5 h-5 text-[#047857]" aria-hidden="true" />
          <div>
            <h2 className="text-base font-semibold text-[#16211C]">
              Active Staff Session &amp; Permissions
            </h2>
            <p className="text-xs text-[#526058]">
              Server-enforced HMAC Bearer token protecting administrative record mutations.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-[#16211C]">{sessionActor}</div>
            <div className="text-xs text-[#526058] mt-0.5">
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onRoleSwitch('administrator')}
              className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors ${
                sessionRole === 'administrator'
                  ? 'bg-[#0C291E] text-white border-[#0C291E]'
                  : 'bg-white text-[#16211C] border-[#E4E7E2] hover:bg-[#F7F8F6]'
              }`}
            >
              Use Administrator
            </button>
            <button
              type="button"
              onClick={() => onRoleSwitch('viewer')}
              className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors ${
                sessionRole === 'viewer'
                  ? 'bg-[#0C291E] text-white border-[#0C291E]'
                  : 'bg-white text-[#16211C] border-[#E4E7E2] hover:bg-[#F7F8F6]'
              }`}
            >
              Use Read-Only Viewer
            </button>
          </div>
        </div>
      </section>

      {/* Synapse CLI & MCP Readiness */}
      <section className="bg-white border border-[#E4E7E2] rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2.5 border-b border-[#E4E7E2] pb-4">
          <Info className="w-5 h-5 text-[#047857]" aria-hidden="true" />
          <div>
            <h2 className="text-base font-semibold text-[#16211C]">
              Synapse CLI &amp; MCP Integration Status
            </h2>
            <p className="text-xs text-[#526058]">
              Honest architectural readiness overview for CareDesk AI&apos;s backend.
            </p>
          </div>
        </div>

        <div className="p-4 bg-[#EDF4F0] border border-[#C6DFD1] rounded-lg space-y-2 text-xs text-[#16211C]">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="w-4 h-4 text-[#047857]" aria-hidden="true" />
            Status: Development Preview (Synapse MCP Server Not Yet Connected)
          </div>
          <p className="text-[#34463D] leading-relaxed">
            CareDesk&apos;s core REST API endpoints (<code className="font-mono">/api/patients</code>,{' '}
            <code className="font-mono">/api/appointments</code>,{' '}
            <code className="font-mono">/api/followups</code>,{' '}
            <code className="font-mono">/api/reports</code>) and OpenAPI schema (<code className="font-mono">/api/docs</code>) are live and backed by SQLite. CareDesk Assistant currently runs through a decoupled Local REST Adapter until Synapse CLI generates and connects the MCP server.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#16211C]">
            <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" aria-hidden="true" />
            SQLite Relational Backend &amp; Conflict Rules Active
          </div>
          <div className="flex items-center gap-2 text-[#16211C]">
            <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" aria-hidden="true" />
            OpenAPI 3.0.3 Schema Exposed at /api/docs
          </div>
        </div>
      </section>
    </div>
  );
}
