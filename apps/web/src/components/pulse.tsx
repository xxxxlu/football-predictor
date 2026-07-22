/**
 * PULSE brand primitives — inline SVG + pure CSS (CSP- and offline-safe).
 * Presentational only; safe from server or client components.
 * SoT: docs/product/pulse-multisport-brand-ui-redesign.md §5 / §8.3 / §8.4 / §17.1
 */

/** Primary logo (A1): forward-leaning P, inner-track counter, twin speed cuts. */
export function PulseLogo({ size = 32, fg = "var(--pulse-red)", cut = "var(--pulse-carbon)", className, title }: { size?: number; fg?: string; cut?: string; className?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <g transform="skewX(-11) translate(10 0)">
        <path
          d="M22 92 L22 8 L58 8 C78 8 88 20 88 36 C88 52 78 64 58 64 L40 64 L40 92 Z
             M40 26 L56 26 C64 26 70 28 70 36 C70 44 64 46 54 46 L40 46 Z"
          fill={fg}
          fillRule="evenodd"
        />
        <rect x="60" y="70" width="34" height="8" fill={cut} transform="skewX(-24)" />
        <rect x="66" y="84" width="34" height="8" fill={cut} transform="skewX(-24)" />
      </g>
    </svg>
  );
}

/** PULSE LINE — the brand's information-bearing trajectory (§8.4). */
export function PulseLine({ state, className }: { state: "ambient" | "upcoming" | "live" | "locked" | "settled"; className?: string }) {
  const TRACK = "M0,14 L120,14 C160,14 160,4 200,4 L320,4 C360,4 360,22 400,22 L560,22";
  const red = "var(--pulse-red)";
  const deep = "var(--pulse-red-deep)";
  const lime = "var(--pulse-lime)";
  const muted = "var(--pulse-muted)";
  return (
    <svg viewBox="0 0 560 28" preserveAspectRatio="none" className={className} aria-hidden="true">
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
          <circle cx="200" cy="4" r="4.5" fill={lime} className="pd-blink-dot" />
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

/** Sport line glyphs — 1.75px stroke, 24px grid (§17.1). No filled/realistic balls. */
export function SportGlyph({ sport, className }: { sport: "FOOTBALL" | "FORMULA_1"; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {sport === "FOOTBALL" ? (
        // Centre circle + halfway line + pass line (§8.3 足球：中圈、传球虚线)
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12 H21" />
          <path d="M8 16 L16 8" strokeDasharray="2.5 2.5" />
        </>
      ) : (
        // Track curve + DRS straight (§8.3 F1：赛道曲线、DRS 直线)
        <>
          <path d="M3 18 H12 C16 18 16 12 12 12 H9 C5.5 12 5.5 6 9.5 6 H21" />
          <circle cx="3" cy="18" r="1.4" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

/** Inline PULSE loader — P segment draw, no spinning logo (§5.5). */
export function PulseLoader({ label = "加载中", className = "" }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-4 py-12 text-center ${className}`}>
      <svg width="72" height="26" viewBox="0 0 144 52" aria-hidden="true">
        <path
          d="M6 46 L36 46 C56 46 56 6 76 6 L108 6 C120 6 120 26 138 26"
          fill="none"
          stroke="var(--pulse-red)"
          strokeWidth="4"
          strokeLinecap="round"
          className="pd-loader-line"
        />
      </svg>
      <span className="eyebrow">{label}</span>
    </div>
  );
}
