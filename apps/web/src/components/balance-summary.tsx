import type { BalanceView } from "@/features/matchday/types";

export function BalanceSummary({ balance }: { balance?: BalanceView }) {
  const items = [{ label: "可用积分", value: balance?.availablePoints }, { label: "冻结积分", value: balance?.frozenPoints }, { label: "更正债务", value: balance?.correctionDebt || "0.00" }];
  return <section aria-label="房间积分" className="grid grid-cols-3 divide-x divide-white/15 bg-[var(--ink)] text-white">{items.map(({ label, value }) => <div key={label} className="min-w-0 p-3 sm:p-4"><p className="truncate text-[10px] text-white/65 sm:text-xs">{label}</p><p className="tabular mt-1 truncate text-sm font-bold sm:text-lg">{value ?? "—"}</p></div>)}</section>;
}
