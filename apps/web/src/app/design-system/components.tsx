/* PULSE 样板页共享组件：Logo 草案 / PULSE LINE / Header / Sport Switcher / 移动底栏。
   仅用于 /design-system 原型，不接入业务数据。 */

import { CIRCUITS, type CircuitKey } from "./circuits";

export function LogoA1({ size = 96, fg = "var(--pulse-red)" }: { size?: number; fg?: string }) {
  // A1 基准型：前倾 P + 内部弯道负空间 + 右下双速度切口
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="PULSE Logo 草案 A1">
      <g transform="skewX(-11) translate(10 0)">
        <path
          d="M22 92 L22 8 L58 8 C78 8 88 20 88 36 C88 52 78 64 58 64 L40 64 L40 92 Z
             M40 26 L56 26 C64 26 70 28 70 36 C70 44 64 46 54 46 L40 46 Z"
          fill={fg}
          fillRule="evenodd"
        />
        <rect x="60" y="70" width="34" height="8" fill="var(--pd-logo-bg, var(--pulse-carbon))" transform="skewX(-24)" />
        <rect x="66" y="84" width="34" height="8" fill="var(--pd-logo-bg, var(--pulse-carbon))" transform="skewX(-24)" />
      </g>
    </svg>
  );
}

export function LogoA2({ size = 96, fg = "var(--pulse-red)" }: { size?: number; fg?: string }) {
  // A2 鬃毛切线型：顶部加一条向后飞扬的切线，暗示“冲锋”而不画马
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="PULSE Logo 草案 A2">
      <g transform="skewX(-11) translate(10 0)">
        <path d="M8 14 L86 2 L88 10 L14 22 Z" fill={fg} opacity="0.85" />
        <path
          d="M22 92 L22 20 L58 20 C78 20 88 32 88 46 C88 60 78 70 58 70 L40 70 L40 92 Z
             M40 36 L56 36 C64 36 70 38 70 46 C70 52 64 54 54 54 L40 54 Z"
          fill={fg}
          fillRule="evenodd"
        />
      </g>
    </svg>
  );
}

export function LogoA3({ size = 96 }: { size?: number }) {
  // A3 PWA 图标型：红底碳黑 P（§5.4）
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="PULSE Logo 草案 A3">
      <rect width="100" height="100" rx="22" fill="var(--pulse-red)" />
      <g transform="skewX(-11) translate(16 0)">
        <path
          d="M24 82 L24 18 L52 18 C68 18 76 27 76 39 C76 51 68 60 52 60 L38 60 L38 82 Z
             M38 32 L50 32 C57 32 62 33 62 39 C62 45 57 46 49 46 L38 46 Z"
          fill="var(--pulse-carbon)"
          fillRule="evenodd"
        />
      </g>
    </svg>
  );
}

/* ---------- PULSE LINE 五状态（§8.4） ---------- */

const TRACK = "M0,14 L120,14 C160,14 160,4 200,4 L320,4 C360,4 360,22 400,22 L560,22";

export function PulseLine({ state }: { state: "ambient" | "upcoming" | "live" | "locked" | "settled" }) {
  const red = "var(--pulse-red)";
  const deep = "var(--pulse-red-deep)";
  const lime = "var(--pulse-lime)";
  const muted = "var(--pulse-muted)";
  return (
    <svg viewBox="0 0 560 28" preserveAspectRatio="none" aria-hidden="true">
      {state === "ambient" && <path d={TRACK} fill="none" stroke={deep} strokeWidth="1" />}
      {state === "upcoming" && (
        <>
          <path d={TRACK} fill="none" stroke={deep} strokeWidth="1" opacity="0.5" />
          <path d="M0,14 L120,14 C160,14 160,4 200,4 L260,4" fill="none" stroke={red} strokeWidth="2.5" />
          {[80, 160, 240, 320, 400, 480].map((x) => (
            <line key={x} x1={x} y1={x < 280 ? 1 : 19} x2={x} y2={x < 280 ? 8 : 26} stroke={muted} strokeWidth="1" />
          ))}
        </>
      )}
      {state === "live" && (
        <>
          <path d={TRACK} fill="none" stroke={red} strokeWidth="2" />
          <circle className="pd-live-dot" r="4.5" fill={lime} />
        </>
      )}
      {state === "locked" && (
        <>
          <path d="M0,14 L200,14" fill="none" stroke={muted} strokeWidth="2" />
          <path d="M200,14 L214,7 L214,21 Z" fill={muted} />
        </>
      )}
      {state === "settled" && (
        <>
          <path d="M0,14 L500,14" fill="none" stroke={muted} strokeWidth="1" />
          <circle cx="522" cy="14" r="11" fill="none" stroke={red} strokeWidth="2.5" />
          <path d="M516 14 L521 19 L529 9" fill="none" stroke={red} strokeWidth="2.5" />
        </>
      )}
    </svg>
  );
}

/* ---------- 全局导航（§10.1） ---------- */

const NAV = [
  { label: "赛事", href: "/design-system/home#events" },
  { label: "房间", href: "/design-system/room" },
  { label: "战绩", href: "/design-system/room#performance" },
  { label: "排行榜", href: "/design-system/room#members" },
  { label: "账户", href: "/design-system/room#balance" },
];

export function PulseHeader({ active }: { active?: string }) {
  return (
    <header className="pd-header">
      <a className="pd-header-brand" href="/design-system">
        <LogoA1 size={30} />
        <span className="pd-header-word">PULSE</span>
      </a>
      <nav className="pd-header-nav" aria-label="主导航">
        {NAV.map((item) => (
          <a key={item.label} href={item.href} aria-current={item.label === active ? "page" : undefined}>{item.label}</a>
        ))}
      </nav>
      <div className="pd-header-actions">
        <details className="pd-event-switcher">
          <summary className="pd-btn pd-btn--primary">切换赛事 <span aria-hidden="true">⌄</span></summary>
          <div className="pd-event-menu" role="menu" aria-label="切换赛事">
            <a href="/design-system/football-match" role="menuitem"><b>足球</b><small>Football / Matchday</small></a>
            <a href="/design-system/basketball" role="menuitem"><b>篮球</b><small>Basketball / Court</small></a>
            <a href="/design-system/f1-assets" role="menuitem"><b>F1</b><small>Formula 1 / Paddock</small></a>
          </div>
        </details>
        <a href="/design-system/home#how-it-works" className="pd-btn pd-btn--outline pd-header-login">怎么玩</a>
      </div>
    </header>
  );
}

/* ---------- Sport Switcher（§10.1 赛事页内运动切换） ---------- */

const SPORTS = ["全部", "足球", "篮球", "F1"];

export function SportSwitcher({ active = "全部" }: { active?: string }) {
  return (
    <div className="pd-sport-switch" role="tablist" aria-label="运动切换">
      {SPORTS.map((s) => (
        <button key={s} type="button" role="tab" aria-selected={s === active} className="pd-sport-pill">
          <span>{s}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- 手机底部导航（§10.2） ---------- */

const BOTTOM = [
  { label: "赛事", href: "/design-system/home#events", glyph: "M4 12 A8 8 0 1 0 20 12 A8 8 0 1 0 4 12 M12 4 V20 M4 12 H20" },
  { label: "房间", href: "/design-system/room", glyph: "M4 20 V9 L12 3 L20 9 V20 H14 V13 H10 V20 Z" },
  { label: "战绩", href: "/design-system/room#performance", glyph: "M4 20 L4 12 M10 20 L10 6 M16 20 L16 9 M22 20 L2 20" },
  { label: "排行", href: "/design-system/room#members", glyph: "M3 20 H9 V10 H3 Z M9.5 20 H15.5 V4 H9.5 Z M16 20 H22 V13 H16 Z" },
  { label: "我的", href: "/design-system/room#balance", glyph: "M12 11 A4 4 0 1 0 12 3 A4 4 0 0 0 12 11 M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21" },
];

export function MobileBottomNav({ active = "赛事" }: { active?: string }) {
  return (
    <nav className="pd-bottom-nav" aria-label="移动端导航">
      {BOTTOM.map((item) => (
        <a key={item.label} href={item.href} aria-current={item.label === active ? "page" : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.glyph} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  );
}

/* ---------- 真实赛道图（§12.4：背景使用该分站赛道的抽象路径） ---------- */

export function CircuitMap({
  circuit,
  stroke = "var(--pulse-red-deep)",
  strokeWidth = 2,
  showStart = true,
  className,
}: {
  circuit: CircuitKey;
  stroke?: string;
  strokeWidth?: number;
  showStart?: boolean;
  className?: string;
}) {
  const c = CIRCUITS[circuit];
  const start = c.path.slice(1, c.path.indexOf(" L")).split(",");
  return (
    <svg viewBox="0 0 400 320" className={className} role="img" aria-label={`${c.name} 赛道图`}>
      <path className="pd-circuit-path" d={c.path} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {showStart && <circle className="pd-circuit-start" cx={start[0]} cy={start[1]} r="5" fill="var(--pulse-lime)" />}
    </svg>
  );
}
