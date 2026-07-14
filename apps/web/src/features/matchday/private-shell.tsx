import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { SoccerBall } from "@/components/football";
import { SessionGuard } from "@/features/auth/session-guard";

export function PrivateShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <SessionGuard>
    <div className="min-h-screen">
      <header className="field-accent sticky top-0 z-40 border-b rule bg-[rgb(244_240_230/85%)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 md:px-8">
          <BrandMark/>
          <nav aria-label="主要导航" className="flex gap-3 text-sm font-bold sm:gap-5">
            <Link href="/matches" className="hover:underline">比赛</Link>
            <Link href="/rooms" className="hover:underline">房间</Link>
            <Link href="/history" className="hidden hover:underline sm:inline">历史</Link>
            <Link href="/account" aria-label="账户设置" className="hover:underline">账户</Link>
          </nav>
        </div>
      </header>
      <section className="night line-art">
        <div className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--volt)]"><SoccerBall className="size-3.5"/>Matchday Ledger</p>
          <h1 className="kinetic mt-3 text-[clamp(2.5rem,6vw,4.5rem)]">{title}</h1>
          <p className="mt-4 max-w-2xl leading-7 text-white/65">{description}</p>
        </div>
      </section>
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-14">{children}</main>
      <footer className="night border-t border-[var(--night-line)] px-4 py-8 text-center text-[11px] leading-5 text-white/50">虚拟积分不可充值、提现或兑换 · 仅限 18+</footer>
    </div>
  </SessionGuard>;
}
