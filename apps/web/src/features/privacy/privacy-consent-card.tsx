"use client";

import type { DataType } from "./privacy-consent-flow";
import { DATA_TYPE_LABELS, DATA_TYPE_DESCRIPTIONS, DATA_TYPE_ICONS } from "./privacy-consent-flow";

interface PrivacyConsentCardProps {
  dataType: DataType;
  consented: boolean;
  disabled?: boolean;
  onRevoke: (dataType: DataType) => void;
}

export function PrivacyConsentCard({ dataType, consented, disabled, onRevoke }: PrivacyConsentCardProps) {
  return (
    <div className="surface rounded-xl border border-[var(--line)] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 text-2xl">{DATA_TYPE_ICONS[dataType]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-lg font-bold">{DATA_TYPE_LABELS[dataType]}</h3>
            <span className={`text-xs font-bold ${consented ? "text-[var(--field)]" : "text-[var(--muted)]"}`}>
              {consented ? "已授权" : "未授权"}
            </span>
          </div>
          <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{DATA_TYPE_DESCRIPTIONS[dataType]}</p>
          {consented && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRevoke(dataType)}
              className="mt-2 inline-flex min-h-11 items-center text-xs text-[var(--muted)] underline decoration-transparent underline-offset-4 transition hover:text-[var(--coral)] hover:decoration-current disabled:opacity-45"
            >
              撤销此项后续收集
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
