import Link from "next/link";

/** 赛事中心的运动切换：足球 / F1。篮球延期，未上线前不展示入口。 */
export function SportTabs({ active }: { active: "FOOTBALL" | "FORMULA_1" }) {
  const base = "inline-flex min-h-10 items-center rounded-full border-2 px-5 text-sm font-bold transition";
  const on = "border-[var(--pulse-carbon)] bg-[var(--pulse-carbon)] text-[var(--pulse-ivory)]";
  const off = "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--pulse-carbon)]";
  return (
    <nav aria-label="切换运动" className="flex flex-wrap gap-2">
      <Link href="/matches" aria-current={active === "FOOTBALL" ? "page" : undefined} className={`${base} ${active === "FOOTBALL" ? on : off}`}>足球</Link>
      <Link href="/matches/f1" aria-current={active === "FORMULA_1" ? "page" : undefined} className={`${base} ${active === "FORMULA_1" ? on : off}`}>F1 赛车</Link>
    </nav>
  );
}
