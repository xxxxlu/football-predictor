import type { OddsSelection } from "@/features/matchday/types";

export function OddsButton({ selection, label, odds, selected, disabled, onSelect }: { selection: OddsSelection; label: string; odds: string; selected: boolean; disabled?: boolean; onSelect(selection: OddsSelection): void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      data-selected={selected}
      onClick={() => onSelect(selection)}
      className="scoreboard-cell min-h-16 px-2 py-2.5 text-center disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="block text-[11px] font-bold uppercase tracking-wide opacity-70">{label}</span>
      <strong className="tabular mt-1 block text-xl font-black leading-none">{odds}</strong>
    </button>
  );
}
