import type { OddsSelection } from "@/features/matchday/types";

export function OddsButton({ selection, label, odds, selected, disabled, onSelect }: { selection: OddsSelection; label: string; odds: string; selected: boolean; disabled?: boolean; onSelect(selection: OddsSelection): void }) {
  return <button type="button" disabled={disabled} aria-pressed={selected} onClick={() => onSelect(selection)} className={`min-h-14 border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "border-[var(--field)] bg-[var(--field)] text-white" : "border-[var(--line)] bg-[var(--paper-raised)] hover:border-[var(--field)]"}`}><span className="block text-xs opacity-70">{label}</span><strong className="tabular mt-0.5 block text-lg">{odds}</strong></button>;
}
