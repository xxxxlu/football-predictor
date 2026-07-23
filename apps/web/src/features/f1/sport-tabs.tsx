import Link from "next/link";

/** 赛事中心的运动切换：足球 / F1。篮球延期，未上线前不展示入口。 */
export function SportTabs({ active }: { active: "FOOTBALL" | "FORMULA_1" }) {
  const base = "pd-sport-pill";
  return (
    <nav aria-label="切换运动" className="pd-sport-switch">
      <Link href="/matches" aria-current={active === "FOOTBALL" ? "page" : undefined} className={active === "FOOTBALL" ? `${base} is-active` : base}><span>足球</span><small>FOOTBALL / MATCHDAY</small></Link>
      <Link href="/matches/f1" aria-current={active === "FORMULA_1" ? "page" : undefined} className={active === "FORMULA_1" ? `${base} is-active` : base}><span>F1 赛车</span><small>FORMULA 1 / PADDOCK</small></Link>
    </nav>
  );
}
