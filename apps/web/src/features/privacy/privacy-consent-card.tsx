"use client";

import type { DataType } from "./privacy-consent-flow";
import { DATA_TYPE_LABELS, DATA_TYPE_DESCRIPTIONS, DATA_TYPE_ICONS } from "./privacy-consent-flow";

interface PrivacyConsentCardProps {
  dataType: DataType;
  consented: boolean;
  disabled?: boolean;
  onToggle: (dataType: DataType, consented: boolean) => void;
  children?: React.ReactNode;
}

export function PrivacyConsentCard({ dataType, consented, disabled, onToggle, children }: PrivacyConsentCardProps) {
  const titleId = `privacy-${dataType.toLowerCase()}-title`;
  return (
    <div className={`surface overflow-hidden rounded-xl border transition ${consented ? "border-[var(--field)]" : "border-[var(--line)]"}`}>
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-0.5 text-2xl">{DATA_TYPE_ICONS[dataType]}</span>
            <div>
              <h3 id={titleId} className="text-lg font-bold">{DATA_TYPE_LABELS[dataType]}</h3>
              <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{DATA_TYPE_DESCRIPTIONS[dataType]}</p>
            </div>
          </div>
          <label className="relative inline-flex min-h-11 min-w-12 shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              aria-labelledby={titleId}
              checked={consented}
              disabled={disabled}
              onChange={(e) => onToggle(dataType, e.target.checked)}
              className="peer sr-only"
            />
            <span className="h-7 w-12 rounded-full border-2 border-[var(--line)] bg-[var(--wash)] transition-colors peer-checked:border-[var(--field)] peer-checked:bg-[var(--field)] peer-disabled:opacity-45" />
            <span className="absolute left-1 top-1/2 size-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
          </label>
        </div>
        {children && <div className="mt-4 border-t border-[var(--line)] pt-4">{children}</div>}
      </div>
    </div>
  );
}
