import React from 'react';

interface EditorialAvatarProps {
  name: string;
  role?: 'patient' | 'clinician' | 'administrator';
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const AVATAR_TONES = [
  { bg: '#ECF4EF', ring: '#B7DFCA', ink: '#0B261C', accent: '#059669' },
  { bg: '#EFF6F2', ring: '#C2DEC9', ink: '#12382A', accent: '#10B981' },
  { bg: '#F2F5F1', ring: '#D3DDD2', ink: '#243B31', accent: '#2D6A4F' },
  { bg: '#FAF5EC', ring: '#EBD9B7', ink: '#4A3411', accent: '#B45309' },
  { bg: '#EEF4F6', ring: '#C7DCE2', ink: '#143642', accent: '#0F766E' },
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
        ? 'w-8 h-8 text-[11px]'
        : size === 'md'
          ? 'w-10 h-10 text-xs'
          : 'w-12 h-12 text-sm';

  return (
    <div
      aria-hidden="true"
      className={`${sizeClass} rounded-full shrink-0 flex items-center justify-center font-semibold tracking-tight select-none relative`}
      style={{
        backgroundColor: isStaffDark ? '#0B261C' : tone.bg,
        color: isStaffDark ? '#D1FAE5' : tone.ink,
        boxShadow: `inset 0 0 0 1px ${isStaffDark ? '#1A4D3A' : tone.ring}`,
      }}
    >
      <span>{initials}</span>
      {role === 'clinician' && (
        <span
          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#059669] ring-2 ring-white"
        />
      )}
    </div>
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
      <rect x="8" y="14" width="104" height="62" rx="10" fill="#ECF4EF" />
      <rect x="18" y="22" width="46" height="44" rx="7" fill="#FFFFFF" stroke="#C6DFD1" />
      <path d="M26 34h26M26 42h18M26 50h22" stroke="#0B261C" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="84" cy="36" r="11" fill="#0B261C" />
      <path
        d="M78 36.5l4 4 7-8"
        stroke="#6EE7B7"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M68 62c2.5-7 8.5-10 16-10s13.5 3 16 10"
        stroke="#047857"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="#D4E4DA"
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
        <rect x="18" y="18" width="144" height="84" rx="14" fill="#F4F8F5" stroke="#D4E4DA" />
        <rect x="30" y="30" width="70" height="58" rx="8" fill="#FFFFFF" stroke="#DCE7E0" />
        <path d="M40 44h44M40 54h34M40 64h26" stroke="#0B261C" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="46" cy="76" r="4" fill="#059669" />
        <path d="M55 76h28" stroke="#526259" strokeWidth="2" strokeLinecap="round" />
        <circle cx="130" cy="48" r="14" fill="#0B261C" />
        <path
          d="M124 48.5l4 4 8-9"
          stroke="#6EE7B7"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="110" y="70" width="40" height="16" rx="8" fill="#ECF4EF" stroke="#B7DFCA" />
        <path d="M120 78h20" stroke="#047857" strokeWidth="2" strokeLinecap="round" />
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
        <rect x="22" y="18" width="116" height="76" rx="12" fill="#F4F8F5" stroke="#D4E4DA" />
        <rect x="36" y="30" width="88" height="52" rx="8" fill="#FFFFFF" stroke="#DCE7E0" />
        <path d="M36 44h88" stroke="#E3E8E4" strokeWidth="1.5" />
        <path d="M56 24v10M104 24v10" stroke="#0B261C" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="60" cy="60" r="8" fill="#ECF4EF" stroke="#059669" strokeWidth="1.8" />
        <path d="M60 56v4l3 2" stroke="#0B261C" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M76 57h34M76 65h24" stroke="#526259" strokeWidth="2" strokeLinecap="round" />
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
        <rect x="24" y="16" width="112" height="78" rx="12" fill="#F4F8F5" stroke="#D4E4DA" />
        <rect x="42" y="26" width="76" height="58" rx="8" fill="#FFFFFF" stroke="#DCE7E0" />
        <circle cx="56" cy="44" r="6" fill="#ECF4EF" stroke="#059669" strokeWidth="1.8" />
        <path d="M53.5 44l2 2 3.5-4" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M68 44h36" stroke="#0B261C" strokeWidth="2" strokeLinecap="round" />
        <circle cx="56" cy="64" r="6" fill="#ECF4EF" stroke="#059669" strokeWidth="1.8" />
        <path d="M53.5 64l2 2 3.5-4" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M68 64h28" stroke="#526259" strokeWidth="2" strokeLinecap="round" />
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
        <rect x="24" y="18" width="112" height="74" rx="12" fill="#F4F8F5" stroke="#D4E4DA" />
        <rect x="38" y="30" width="60" height="50" rx="7" fill="#FFFFFF" stroke="#DCE7E0" />
        <path d="M48 44h34M48 54h26M48 64h18" stroke="#9EB0A6" strokeWidth="2" strokeLinecap="round" />
        <circle cx="102" cy="54" r="14" fill="#FFFFFF" stroke="#0B261C" strokeWidth="2.4" />
        <path d="M112 64l10 10" stroke="#059669" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  // patients
  return (
    <svg
      viewBox="0 0 160 110"
      className="w-36 h-24 mx-auto"
      fill="none"
      aria-hidden="true"
    >
      <rect x="22" y="18" width="116" height="74" rx="12" fill="#F4F8F5" stroke="#D4E4DA" />
      <rect x="36" y="28" width="88" height="54" rx="8" fill="#FFFFFF" stroke="#DCE7E0" />
      <circle cx="60" cy="48" r="9" fill="#ECF4EF" stroke="#0B261C" strokeWidth="1.8" />
      <path d="M47 69c2-6 7-9 13-9s11 3 13 9" stroke="#0B261C" strokeWidth="1.8" strokeLinecap="round" fill="#ECF4EF" />
      <path d="M82 46h28M82 55h22M82 64h16" stroke="#526259" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
