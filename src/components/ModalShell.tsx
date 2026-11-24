import React, { useEffect } from 'react';

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export function ModalShell({
  open,
  onClose,
  labelledBy,
  maxWidthClass = 'max-w-lg',
  children,
}: ModalShellProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0F3D2E]/40 backdrop-blur-[2px] flex items-center justify-center p-4 animate-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`bg-[#FAFBF9] border border-[#DCE8E0] rounded-[24px] w-full ${maxWidthClass} p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto animate-modal-panel`}
      >
        {children}
      </div>
    </div>
  );
}
