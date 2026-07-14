import Link from "next/link";
import { SoccerBall } from "./football";

export function BrandMark() {
  return (
    <Link href="/" className="group inline-flex items-center gap-3 no-underline" aria-label="看球账本首页">
      <span
        aria-hidden="true"
        className="pitch-stripes relative grid size-10 place-items-center rounded-full text-white transition-transform group-hover:-translate-y-0.5"
        style={{ boxShadow: "inset 0 0 0 2px rgb(244 240 230 / 55%), 0 5px 14px rgb(16 29 51 / 28%)" }}
      >
        <span className="display text-lg font-black leading-none">判</span>
        <SoccerBall className="absolute -bottom-1.5 size-4" />
      </span>
      <span>
        <strong className="display block text-xl leading-none">看球账本</strong>
        <span className="mt-1 block text-[10px] font-bold tracking-[.16em] text-[var(--muted)]">MATCHDAY LEDGER</span>
      </span>
    </Link>
  );
}
