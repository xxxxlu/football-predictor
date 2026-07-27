import { formatPoints } from "@/lib/points";
import type { BalanceView } from "@/features/matchday/types";

export function BalanceSummary({ balance }: { balance?: BalanceView }) {
  const items = [{ label: "可用积分", value: balance?.availablePoints }, { label: "冻结积分", value: balance?.frozenPoints }, { label: "更正债务", value: balance?.correctionDebt ?? "0" }];
  // 数字对标签的字号比按 §7.3 取 1.8 倍下限：手机 10px → 18px，桌面 12px → 22px。
  // 手机上三列各只有 89px，六位数带小数（"999,999.99"）会被截断，所以挂 title 兜底。
  return <section aria-label="房间积分" className="grid grid-cols-3 divide-x divide-white/15 bg-[var(--ink)] text-white">{items.map(({ label, value }) => { const shown = formatPoints(value); return <div key={label} className="min-w-0 p-3 sm:p-4"><p className="truncate text-[10px] text-white/65 sm:text-xs">{label}</p><p title={shown} className="tabular mt-1 truncate text-lg font-bold leading-tight sm:text-[1.375rem]">{shown}</p></div>; })}</section>;
}
