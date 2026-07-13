import Link from "next/link";

export function BrandMark() {
  return (
    <Link href="/" className="inline-flex items-center gap-3 no-underline" aria-label="看球账本首页">
      <span aria-hidden="true" className="grid size-9 place-items-center border border-[var(--ink)] bg-[var(--field)] text-sm font-black text-white">判</span>
      <span><strong className="display block text-xl leading-none">看球账本</strong><span className="mt-1 block text-[10px] font-bold tracking-[.16em] text-[var(--muted)]">MATCHDAY LEDGER</span></span>
    </Link>
  );
}
