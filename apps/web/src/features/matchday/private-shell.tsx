import { BrandMark } from "@/components/brand-mark";
import { PulseHeaderNav, MobileBottomNav } from "@/components/pulse-nav";
import { PulseLine } from "@/components/pulse";
import { SessionGuard } from "@/features/auth/session-guard";

export function PrivateShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <SessionGuard>
    <div className="pd-has-bottom-nav min-h-screen">
      <header className="pd-header">
        <div className="pd-header-inner">
          <BrandMark tone="light" />
          <PulseHeaderNav />
        </div>
      </header>
      <section className="night relative overflow-hidden">
        <PulseLine state="ambient" className="pointer-events-none absolute inset-x-0 bottom-6 hidden h-7 w-full opacity-60 md:block" />
        <div className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-14">
          <p className="pd-eyebrow">PULSE SPORTS CLUB</p>
          <h1 className="kinetic mt-3 text-[clamp(2.5rem,6vw,4.5rem)]">{title}</h1>
          <p className="mt-4 max-w-2xl leading-7 text-white/65">{description}</p>
        </div>
      </section>
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-14">{children}</main>
      <footer className="night border-t border-[var(--night-line)] px-4 py-8 text-center text-[11px] leading-5 text-white/50">虚拟积分不可充值、提现或兑换 · 仅限 18+</footer>
      <MobileBottomNav />
    </div>
  </SessionGuard>;
}
