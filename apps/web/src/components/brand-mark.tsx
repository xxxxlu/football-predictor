import Link from "next/link";
import { SoccerBall } from "./football";

export function BrandMark({ tone = "ink" }: { tone?: "ink" | "light" }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5 no-underline" aria-label="football 首页">
      <span
        aria-hidden="true"
        className="pitch-stripes relative grid size-9 place-items-center rounded-full text-white transition-transform group-hover:-translate-y-0.5"
        style={{ boxShadow: "inset 0 0 0 2px rgb(244 240 230 / 55%), 0 5px 14px rgb(16 29 51 / 28%)" }}
      >
        <span className="display text-base font-black leading-none">判</span>
        <SoccerBall className="absolute -bottom-1.5 size-3.5" />
      </span>
      <span className="leading-none">
        <strong className={`block text-xl font-black lowercase tracking-tight ${tone === "light" ? "text-white" : ""}`}>football</strong>
        <span className={`mt-0.5 block text-[9px] font-bold tracking-[.18em] ${tone === "light" ? "text-white/55" : "text-[var(--muted)]"}`}>看球账本 · MATCHDAY</span>
      </span>
    </Link>
  );
}
