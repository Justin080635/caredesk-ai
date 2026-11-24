interface EditorialAvatarProps {
  name: string;
  role?: 'patient' | 'clinician' | 'administrator';
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const AVATAR_TONES = [
  { bg: '#E6F4EC', ring: '#BCE2CD', ink: '#0F3D2E' },
  { bg: '#EAF2FA', ring: '#C4D9F0', ink: '#163A5F' },
  { bg: '#F7EFE7', ring: '#EAD3BE', ink: '#5C3415' },
  { bg: '#F1ECF9', ring: '#D9CBEF', ink: '#3B2560' },
  { bg: '#EEF3EF', ring: '#DCE8E0', ink: '#1C2B25' },
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getInitials(name: string): string {
  const cleaned = name.replace(/^Dr\.\s+/i, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'CD';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function EditorialAvatar({
  name,
  role = 'patient',
  size = 'sm',
}: EditorialAvatarProps) {
  const tone = AVATAR_TONES[hashName(name) % AVATAR_TONES.length];
  const initials = getInitials(name);
  const isStaffDark = role === 'clinician' || role === 'administrator';

  const sizeClass =
    size === 'xs'
      ? 'w-6 h-6 text-[10px]'
      : size === 'sm'
        ? 'w-9 h-9 text-xs'
        : size === 'md'
          ? 'w-11 h-11 text-sm'
          : 'w-13 h-13 text-base';

  return (
    <div
      aria-hidden="true"
      className={`${sizeClass} rounded-full shrink-0 flex items-center justify-center font-semibold tracking-tight select-none relative`}
      style={{
        backgroundColor: isStaffDark ? '#0F3D2E' : tone.bg,
        color: isStaffDark ? '#DDF8ED' : tone.ink,
        boxShadow: `inset 0 0 0 1px ${isStaffDark ? '#1D5C46' : tone.ring}`,
      }}
    >
      <span>{initials}</span>
      {role === 'clinician' && (
        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#34C38F] ring-2 ring-white" />
      )}
    </div>
  );
}

export function CareDeskLogoMark({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const boxClass =
    size === 'sm'
      ? 'w-8 h-8 rounded-xl'
      : size === 'lg'
        ? 'w-11 h-11 rounded-2xl'
        : 'w-10 h-10 rounded-2xl';
  const iconClass = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';

  return (
    <div
      className={`${boxClass} bg-[#34C38F] text-[#0F3D2E] flex items-center justify-center shrink-0 shadow-sm ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className={iconClass} fill="none">
        <path
          d="M12 4.5v15M4.5 12h15"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <circle cx="17.5" cy="6.5" r="2" fill="#FFFFFF" />
      </svg>
    </div>
  );
}

/**
 * Clean abstract geometric & clinical wave motif for the Dashboard Welcome Banner.
 */
export function WelcomeBannerMotif() {
  return (
    <svg
      viewBox="0 0 260 140"
      className="w-52 sm:w-64 h-[112px] sm:h-[132px] shrink-0 select-none"
      fill="none"
      aria-hidden="true"
    >
      {/* Ambient concentric orbital rings */}
      <circle cx="178" cy="70" r="60" stroke="#FFFFFF" strokeOpacity="0.14" strokeWidth="1.5" />
      <circle cx="178" cy="70" r="42" stroke="#34C38F" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="4 4" />
      <circle cx="178" cy="70" r="26" fill="#FFFFFF" fillOpacity="0.12" />

      {/* Floating stylized clinic pulse card */}
      <rect
        x="24"
        y="30"
        width="126"
        height="78"
        rx="18"
        fill="#FFFFFF"
        fillOpacity="0.14"
        stroke="#FFFFFF"
        strokeOpacity="0.24"
      />
      <path
        d="M38 72h22l10-18 12 30 11-18 8 6h34"
        stroke="#A7F3D0"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="44" cy="46" r="4" fill="#34C38F" />
      <rect x="54" y="43" width="44" height="6" rx="3" fill="#FFFFFF" fillOpacity="0.65" />

      {/* Abstract medical cross badge */}
      <rect x="158" y="50" width="40" height="40" rx="14" fill="#34C38F" />
      <path
        d="M178 61v18M169 70h18"
        stroke="#0F3D2E"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="222" cy="36" r="7" fill="#FFFFFF" fillOpacity="0.22" />
      <circle cx="128" cy="116" r="5" fill="#A7F3D0" fillOpacity="0.45" />
    </svg>
  );
}

export function DashboardOpsSpotIllustration() {
  return (
    <svg
      viewBox="0 0 120 88"
      className="w-24 h-[70px] shrink-0"
      fill="none"
      aria-hidden="true"
    >
      <rect x="8" y="14" width="104" height="62" rx="14" fill="#EAF4EE" />
      <rect x="18" y="22" width="46" height="44" rx="10" fill="#FFFFFF" stroke="#DCE8E0" />
      <path d="M26 34h26M26 42h18M26 50h22" stroke="#0F3D2E" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="84" cy="36" r="11" fill="#0F3D2E" />
      <path
        d="M78 36.5l4 4 7-8"
        stroke="#34C38F"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M68 62c2.5-7 8.5-10 16-10s13.5 3 16 10"
        stroke="#137A55"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="#DCE8E0"
      />
      <circle cx="102" cy="18" r="4" fill="#F59E0B" opacity="0.85" />
    </svg>
  );
}

export function ClinicEmptyIllustration({
  variant,
}: {
  variant: 'patients' | 'appointments' | 'followups' | 'assistant' | 'search';
}) {
  if (variant === 'assistant') {
    return (
      <svg
        viewBox="0 0 180 120"
        className="w-40 h-28 mx-auto"
        fill="none"
        aria-hidden="true"
      >
        <rect x="18" y="18" width="144" height="84" rx="18" fill="#F2F7F3" stroke="#DCE8E0" />
        <rect x="30" y="30" width="70" height="58" rx="12" fill="#FFFFFF" stroke="#DCE8E0" />
        <path d="M40 44h44M40 54h34M40 64h26" stroke="#0F3D2E" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="46" cy="76" r="4" fill="#34C38F" />
        <path d="M55 76h28" stroke="#6B7B73" strokeWidth="2" strokeLinecap="round" />
        <circle cx="130" cy="48" r="14" fill="#0F3D2E" />
        <path
          d="M124 48.5l4 4 8-9"
          stroke="#34C38F"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="110" y="70" width="40" height="16" rx="8" fill="#EAF4EE" stroke="#BCE2CD" />
        <path d="M120 78h20" stroke="#137A55" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === 'appointments') {
    return (
      <svg
        viewBox="0 0 160 110"
        className="w-36 h-24 mx-auto"
        fill="none"
        aria-hidden="true"
      >
        <rect x="22" y="18" width="116" height="76" rx="16" fill="#F2F7F3" stroke="#DCE8E0" />
        <rect x="36" y="30" width="88" height="52" rx="10" fill="#FFFFFF" stroke="#DCE8E0" />
        <path d="M36 44h88" stroke="#DCE8E0" strokeWidth="1.5" />
        <path d="M56 24v10M104 24v10" stroke="#0F3D2E" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="60" cy="60" r="8" fill="#EAF4EE" stroke="#34C38F" strokeWidth="1.8" />
        <path d="M60 56v4l3 2" stroke="#0F3D2E" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M76 57h34M76 65h24" stroke="#6B7B73" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === 'followups') {
    return (
      <svg
        viewBox="0 0 160 110"
        className="w-36 h-24 mx-auto"
        fill="none"
        aria-hidden="true"
      >
        <rect x="24" y="16" width="112" height="78" rx="16" fill="#F2F7F3" stroke="#DCE8E0" />
        <rect x="42" y="26" width="76" height="58" rx="10" fill="#FFFFFF" stroke="#DCE8E0" />
        <circle cx="56" cy="44" r="6" fill="#EAF4EE" stroke="#34C38F" strokeWidth="1.8" />
        <path d="M53.5 44l2 2 3.5-4" stroke="#137A55" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M68 44h36" stroke="#0F3D2E" strokeWidth="2" strokeLinecap="round" />
        <circle cx="56" cy="64" r="6" fill="#EAF4EE" stroke="#34C38F" strokeWidth="1.8" />
        <path d="M53.5 64l2 2 3.5-4" stroke="#137A55" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M68 64h28" stroke="#6B7B73" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === 'search') {
    return (
      <svg
        viewBox="0 0 160 110"
        className="w-36 h-24 mx-auto"
        fill="none"
        aria-hidden="true"
      >
        <rect x="24" y="18" width="112" height="74" rx="16" fill="#F2F7F3" stroke="#DCE8E0" />
        <rect x="38" y="30" width="60" height="50" rx="10" fill="#FFFFFF" stroke="#DCE8E0" />
        <path d="M48 44h34M48 54h26M48 64h18" stroke="#9EB0A6" strokeWidth="2" strokeLinecap="round" />
        <circle cx="102" cy="54" r="14" fill="#FFFFFF" stroke="#0F3D2E" strokeWidth="2.4" />
        <path d="M112 64l10 10" stroke="#34C38F" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 160 110"
      className="w-36 h-24 mx-auto"
      fill="none"
      aria-hidden="true"
    >
      <rect x="22" y="18" width="116" height="74" rx="16" fill="#F2F7F3" stroke="#DCE8E0" />
      <rect x="36" y="28" width="88" height="54" rx="10" fill="#FFFFFF" stroke="#DCE8E0" />
      <circle cx="60" cy="48" r="9" fill="#EAF4EE" stroke="#0F3D2E" strokeWidth="1.8" />
      <path d="M47 69c2-6 7-9 13-9s11 3 13 9" stroke="#0F3D2E" strokeWidth="1.8" strokeLinecap="round" fill="#EAF4EE" />
      <path d="M82 46h28M82 55h22M82 64h16" stroke="#6B7B73" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
