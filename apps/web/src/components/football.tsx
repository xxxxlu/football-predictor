/**
 * Football visual primitives — inline SVG + pure CSS motifs (CSP- and offline-safe).
 * Presentational only; safe to use from server or client components.
 */

/** Classic minimalist soccer ball (white ball, ink panels). Caller sizes via className. */
export function SoccerBall({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <circle cx="32" cy="32" r="27" fill="#fbfaf6" stroke="#101d33" strokeWidth="2.6" />
      <path d="M32 20.5 43 28.5 38.8 41.5 25.2 41.5 21 28.5Z" fill="#101d33" />
      <g stroke="#101d33" strokeWidth="2.4" strokeLinecap="round">
        <path d="M32 20.5V8.6" />
        <path d="m43 28.5 10.4-4.2" />
        <path d="m38.8 41.5 7.9 10.4" />
        <path d="m25.2 41.5-7.9 10.4" />
        <path d="M21 28.5 10.6 24.3" />
      </g>
      <g fill="#101d33">
        <circle cx="32" cy="7.4" r="2.2" />
        <circle cx="55.4" cy="23.6" r="2.2" />
        <circle cx="47.4" cy="53" r="2.2" />
        <circle cx="16.6" cy="53" r="2.2" />
        <circle cx="8.6" cy="23.6" r="2.2" />
      </g>
    </svg>
  );
}

/** Referee whistle — used for foul/error states. */
export function Whistle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M2.5 9.2c0 2.7 2.2 4.9 4.9 4.9h3.9a5.2 5.2 0 1 0 .3-3H7.4A1.9 1.9 0 0 1 5.5 9.2V7.1a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1v2.1Zm14.3 5.6a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2Z" />
      <path d="M6.2 3.6h4.3a1 1 0 0 1 0 2H6.2a1 1 0 1 1 0-2Z" opacity=".55" />
    </svg>
  );
}

/** Shield with a keyhole — used for forbidden/locked states. */
export function ShieldLock({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2 4 5v6c0 4.6 3.2 8.4 8 11 4.8-2.6 8-6.4 8-11V5l-8-3Zm0 7.2a2 2 0 0 1 1 3.7V15a1 1 0 1 1-2 0v-2.1a2 2 0 0 1 1-3.7Z" />
    </svg>
  );
}

/** Trophy — used for leaderboard / standings. */
export function Trophy({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M6 3h12v2h3v3a4 4 0 0 1-4 4h-.4A6 6 0 0 1 13 15.9V18h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.1A6 6 0 0 1 7.4 12H7a4 4 0 0 1-4-4V5h3V3Zm12 4v3a2 2 0 0 0 1-1.7V7h-1ZM5 7v.3A2 2 0 0 0 6 9V7H5Z" />
    </svg>
  );
}

function crestColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  // Deterministic hue per team (consistent across matches, near-zero collisions).
  // Lightness 30%: the wheel's brightest hue (yellow, ~60°) still gives white
  // initials ≥4.5:1 (axe color-contrast); at 40% the yellow-green band failed.
  const hue = hash % 360;
  return `hsl(${hue} 52% 30%)`;
}

function crestInitials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const words = trimmed.split(/\s+/);
  if (words.length >= 2 && /[a-z]/i.test(trimmed)) return (words[0][0] + words[1][0]).toUpperCase();
  // CJK or single word: first (up to two) glyphs
  return Array.from(trimmed).slice(0, /[a-z]/i.test(trimmed) ? 2 : 1).join("").toUpperCase();
}

/** Team crest roundel — deterministic color + initials from the team name. */
export function TeamCrest({ name, className = "size-9 text-sm" }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`crest ${className}`} style={{ backgroundColor: crestColor(name) }}>
      {crestInitials(name)}
    </span>
  );
}

/** Loading indicator — delegates to the brand-neutral PULSE line loader (§17.1:
    写实足球图标不再作为 Loading 的默认答案). Name kept for existing call sites. */
export { PulseLoader as PitchLoader } from "./pulse";
