"use client";

import { useEffect, useRef } from "react";

export function BottomSheet({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    // Prevent body background scroll while the sheet is active
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 overflow-hidden"
    >
      {/* Dimmed backdrop with blur */}
      <div
        className="bottom-sheet-overlay"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Bottom Sheet on Mobile / Slide-Over Drawer on Desktop */}
      <div
        ref={panelRef}
        className="bottom-sheet-panel surface border-t border-[var(--line)] md:border-t-0 md:border-l"
      >
        {/* Mobile drag handle indicator */}
        <div className="flex md:hidden justify-center pt-3 pb-1" aria-hidden="true">
          <div className="h-1.5 w-12 rounded-full bg-[var(--muted)]/40" />
        </div>

        {/* Sheet Header */}
        <header className="flex items-center justify-between border-b rule px-5 py-3.5">
          <div className="min-w-0 pr-3">
            {title && <div className="text-sm font-bold text-[var(--ink)] truncate">{title}</div>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--muted)] truncate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="pressable-btn flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--wash-neutral)] text-sm font-bold text-[var(--ink)] transition hover:bg-[var(--wash-neutral)]/80"
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        {/* Sheet Content Body with mobile safe area bottom padding */}
        <div className="flex-1 overflow-y-auto px-5 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
