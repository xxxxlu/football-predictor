import type { OddsSelection } from "@/features/matchday/types";
import { useOddsFormat } from "./odds-format-provider";

export function OddsButton({
  selection,
  label,
  odds,
  selected,
  disabled,
  trend,
  onSelect,
}: {
  selection: OddsSelection;
  label: string;
  odds: string;
  selected: boolean;
  disabled?: boolean;
  trend?: "UP" | "DOWN" | "FLAT";
  onSelect(selection: OddsSelection): void;
}) {
  const { displayOdds } = useOddsFormat();
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      data-selected={selected}
      onClick={() => onSelect(selection)}
      className="scoreboard-cell pressable-btn cursor-pointer min-h-16 px-2 py-2.5 text-center disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="block text-[11px] font-bold uppercase tracking-wide opacity-70">{label}</span>
      <div className="mt-1 flex items-center justify-center gap-1">
        <strong className="tabular block text-xl font-black leading-none">{displayOdds(odds)}</strong>
        {trend === "UP" && (
          <span className="text-[10px] font-black text-emerald-400" title="赔率上升" aria-label="赔率上升">
            ▲
          </span>
        )}
        {trend === "DOWN" && (
          <span className="text-[10px] font-black text-[var(--pulse-red)]" title="赔率下降" aria-label="赔率下降">
            ▼
          </span>
        )}
      </div>
    </button>
  );
}

