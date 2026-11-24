import { useEffect, useState } from 'react';
import { CareDeskLogoMark } from './ClinicIllustrations';

const STATUS_MESSAGES = [
  "Preparing today's clinic…",
  'Syncing appointments…',
  'Almost ready',
] as const;

interface SignatureLoaderProps {
  active: boolean;
  variant?: 'boot' | 'route';
}

export function SignatureLoader({ active, variant = 'boot' }: SignatureLoaderProps) {
  const [rendered, setRendered] = useState(active);
  const [exiting, setExiting] = useState(false);
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (active) {
      setRendered(true);
      setExiting(false);
      setMsgIndex(variant === 'route' ? 1 : 0);
      return;
    }

    if (!rendered) return;
    setExiting(true);
    const timer = window.setTimeout(() => {
      setRendered(false);
      setExiting(false);
    }, 330);
    return () => window.clearTimeout(timer);
  }, [active, rendered, variant]);

  useEffect(() => {
    if (!rendered || exiting) return;
    const interval = window.setInterval(() => {
      setMsgIndex((prev) => (prev < STATUS_MESSAGES.length - 1 ? prev + 1 : prev));
    }, 520);
    return () => window.clearInterval(interval);
  }, [rendered, exiting]);

  if (!rendered) return null;

  return (
    <div
      data-testid="signature-loader"
      data-variant={variant}
      role="status"
      aria-live="polite"
      aria-label="Loading CareDesk clinic workspace"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0F3D2E] text-emerald-50 px-6 overflow-hidden select-none signature-loader-shell ${
        exiting ? 'signature-loader-exit' : ''
      }`}
    >
      {/* Subtle radial glow behind logo */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute w-[360px] h-[360px] rounded-full bg-[#34C38F]/12 blur-3xl"
      />

      {/* Full-width thin ECG heartbeat line drawing across the screen into the centered logo */}
      <div
        aria-hidden="true"
        className="relative w-full max-w-2xl flex items-center justify-center mb-5"
      >
        <svg
          viewBox="0 0 640 84"
          className="w-full h-20 overflow-visible"
          fill="none"
        >
          <line
            x1="0"
            y1="42"
            x2="640"
            y2="42"
            stroke="#34C38F"
            strokeOpacity="0.16"
            strokeWidth="1"
          />
          <path
            d="M 10 42 L 195 42 L 214 42 L 228 24 L 242 62 L 258 14 L 274 56 L 288 36 L 302 42 L 320 42 L 338 42 L 352 36 L 366 56 L 382 14 L 398 62 L 412 24 L 426 42 L 630 42"
            stroke="#6EE7B7"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="signature-ecg-path"
          />
        </svg>

        {/* Centered Logo Mark with Soft Emerald Pulse Ring */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative flex items-center justify-center">
            <span
              aria-hidden="true"
              className="signature-ring-pulse absolute inset-[-12px] rounded-[26px] border-2 border-[#34C38F]/65"
            />
            <span
              aria-hidden="true"
              className="absolute inset-[-6px] rounded-[22px] bg-[#0F3D2E] ring-1 ring-[#34C38F]/35"
            />
            <CareDeskLogoMark size="lg" className="relative z-10 w-13 h-13 shadow-lg" />
          </div>
        </div>
      </div>

      <div className="relative z-10 text-center space-y-1.5">
        <div className="text-base font-bold tracking-tight text-white">CareDesk AI</div>
        <p className="text-xs font-medium text-emerald-100/85 min-h-[1.25rem]">
          {STATUS_MESSAGES[msgIndex]}
        </p>
      </div>
    </div>
  );
}
