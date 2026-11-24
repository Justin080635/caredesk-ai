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
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <div className="lg:col-span-6 space-y-5">
        <section className="card-surface rounded-[24px] p-6 space-y-5">
          <div className="flex items-center gap-3 border-b border-[#EEF3EF] pb-4">
            <div className="w-10 h-10 rounded-2xl bg-[#E3F7EF] text-[#137A55] flex items-center justify-center shrink-0">
              <Sliders className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1C2B25]">
                Workspace &amp; Display Settings
              </h2>
              <p className="text-xs text-[#6B7B73]">
                Facility workspace identity, scheduling rules, and layout density
              </p>
            </div>
          </div>

          <dl className="divide-y divide-[#EEF3EF] text-sm">
            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <dt className="text-xs text-[#6B7B73]">Active Clinic Workspace</dt>
              <dd className="font-semibold text-[#1C2B25] sm:text-right">
                {activeClinic?.name ?? 'Clinic Workspace'}
              </dd>
            </div>
            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <dt className="text-xs text-[#6B7B73]">Clinic Type &amp; ID</dt>
              <dd className="font-mono text-xs font-semibold text-[#137A55] sm:text-right">
                {activeClinic?.clinicType ?? 'Outpatient Clinic'} · {activeClinic?.id ?? '—'}
              </dd>
            </div>
            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <dt className="text-xs text-[#6B7B73]">Clinic Scheduling Hours</dt>
              <dd className="font-mono text-xs font-semibold text-[#1C2B25]">
                08:30 – 16:30 · 30-min standard slots
              </dd>
            </div>
          </dl>

          <div className="pt-4 flex items-center justify-between gap-4 border-t border-[#EEF3EF]">
            <div>
              <h3 className="text-sm font-semibold text-[#1C2B25]">Compact Table Density</h3>
              <p className="text-xs text-[#6B7B73] mt-0.5">
                Tighten row spacing across Patients, Staff, and Appointment lists.
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
                  next ? 'Enabled compact table density.' : 'Switched to comfortable spacing.'
                );
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                compactDensity ? 'bg-[#34C38F]' : 'bg-[#CBD8D0]'
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

          <div className="pt-4 flex items-center justify-between gap-4 border-t border-[#EEF3EF]">
            <div>
              <h3 className="text-sm font-semibold text-[#1C2B25]">
                Icon-Only Floating Sidebar
              </h3>
              <p className="text-xs text-[#6B7B73] mt-0.5">
                Keep the floating left rail compact with icons + tooltips, or expand with labels.
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
                  next
                    ? 'Switched sidebar to icon-only floating rail.'
                    : 'Expanded sidebar rail with text labels.'
                );
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                sidebarCollapsed ? 'bg-[#34C38F]' : 'bg-[#CBD8D0]'
              }`}
              aria-label="Toggle icon-only floating sidebar"
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  sidebarCollapsed ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </section>

        <section className="card-surface rounded-[24px] p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 border-b border-[#EEF3EF] pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#E3F7EF] text-[#137A55] flex items-center justify-center shrink-0">
                <UserCheck className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#1C2B25]">
                  Authenticated Account &amp; RBAC
                </h2>
                <p className="text-xs text-[#6B7B73]">
                  Verified Firebase JWT &amp; clinic isolation boundary
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenProfile}
              className="btn-press inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0F3D2E] bg-[#E3F7EF] hover:bg-[#D0EFE3] rounded-full transition-colors shrink-0"
            >
              Manage Profile
              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between py-1">
              <span className="text-[#6B7B73]">Signed-in User</span>
              <span className="font-semibold text-[#1C2B25]">{user.fullName}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-[#6B7B73]">Account Email</span>
              <span className="font-mono text-[#1C2B25]">{user.email}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-[#6B7B73]">Authorized Role</span>
              <span className="px-2.5 py-0.5 rounded-full bg-[#E3F7EF] font-mono font-semibold text-[#137A55]">
                {activeMembership?.role ?? 'Clinic Administrator'}
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-[#6B7B73]">Clinic Boundary</span>
              <span className="inline-flex items-center gap-1 font-mono text-[#0F3D2E]">
                <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                {activeClinic?.id ?? '—'}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div className="lg:col-span-6 space-y-5">
        <section className="card-surface rounded-[24px] p-6 space-y-5">
          <div className="flex items-center gap-3 border-b border-[#EEF3EF] pb-4">
            <div className="w-10 h-10 rounded-2xl bg-[#EEF3EF] text-[#0F3D2E] flex items-center justify-center shrink-0">
              <Info className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1C2B25]">
                Synapse CLI &amp; MCP Integration Status
              </h2>
              <p className="text-xs text-[#6B7B73]">
                Architectural readiness overview for CareDesk AI&apos;s clinic-isolated backend
              </p>
            </div>
          </div>

          <div className="p-4 bg-[#E3F7EF]/60 border border-[#C6E8D8] rounded-2xl space-y-2 text-xs text-[#1C2B25]">
            <div className="flex items-center gap-2 font-semibold text-[#0F3D2E]">
              <ShieldCheck className="w-4 h-4 text-[#137A55]" aria-hidden="true" />
              Clinic-Isolated REST Preview Active
            </div>
            <p className="text-[#43564D] leading-relaxed">
              REST API endpoints (<code className="font-mono">/api/patients</code>,{' '}
              <code className="font-mono">/api/appointments</code>,{' '}
              <code className="font-mono">/api/followups</code>,{' '}
              <code className="font-mono">/api/reports</code>) and OpenAPI 3.0.3 schema (
              <code className="font-mono">/api/docs</code>) are authenticated via Firebase Bearer
              tokens and scoped to the active clinic boundary.
            </p>
          </div>

          <div className="divide-y divide-[#EEF3EF] text-xs">
            <div className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-[#1C2B25] font-medium">
                <CheckCircle2 className="w-4 h-4 text-[#34C38F] shrink-0" aria-hidden="true" />
                <span>Firebase Auth &amp; Server RBAC Enforcement</span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-[#E3F7EF] font-mono text-[#137A55]">
                Active
              </span>
            </div>
            <div className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-[#1C2B25] font-medium">
                <CheckCircle2 className="w-4 h-4 text-[#34C38F] shrink-0" aria-hidden="true" />
                <span>SQLite Multi-Clinic Isolation &amp; Conflict Rules</span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-[#E3F7EF] font-mono text-[#137A55]">
                Active
              </span>
            </div>
            <div className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-[#1C2B25] font-medium">
                <CheckCircle2 className="w-4 h-4 text-[#34C38F] shrink-0" aria-hidden="true" />
                <span>OpenAPI 3.0.3 Schema Exposed</span>
              </div>
              <span className="font-mono text-[#137A55]">/api/docs</span>
            </div>
            <div className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-[#1C2B25] font-medium">
                <Info className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                <span>Synapse CLI MCP Server Adapter</span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-50 font-mono text-amber-800">
                Ready
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
