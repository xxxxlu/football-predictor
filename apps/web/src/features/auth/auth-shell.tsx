import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { PulseLogo, PulseLine } from "@/components/pulse";

export function AuthShell({ eyebrow, title, description, children, footer }: { eyebrow: string; title: string; description: string; children: React.ReactNode; footer: React.ReactNode }) {
  return <main id="main-content" className="grid min-h-screen lg:grid-cols-[minmax(20rem,.72fr)_1.28fr]">
    <aside className="night line-art relative hidden overflow-hidden border-r border-[var(--night-line)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <PulseLogo size={420} className="pointer-events-none absolute -bottom-24 -right-24 opacity-[.06]" />
      <BrandMark tone="light" />
      <blockquote className="relative">
        <p className="pd-eyebrow">PULSE SPORTS CLUB</p>
        <p className="kinetic mt-5 text-5xl leading-[.92] text-white">CALL THE<br /><span className="text-[var(--pulse-red)]">MOMENT.</span></p>
        <p className="mt-5 max-w-xs text-sm leading-6 text-white/60">每一次判断，都应该留下记录。足球、F1，和朋友一起预测，用虚拟积分留下每一次判断。</p>
        <PulseLine state="upcoming" className="mt-8 h-7 w-full max-w-xs" />
      </blockquote>
      <p className="relative text-xs leading-5 text-white/55">无充值 · 无提现 · 无兑换 · 仅限 18+</p>
    </aside>
    <section className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b rule px-4 py-4 sm:px-8">
        <div className="lg:hidden"><BrandMark /></div>
        <Link href="/" className="ml-auto text-sm font-bold underline-offset-4 hover:underline">返回首页</Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="display mt-3 text-4xl font-bold">{title}</h1>
          <p className="mt-3 leading-7 text-[var(--muted)]">{description}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-8 border-t rule pt-6 text-sm text-[var(--muted)]">{footer}</div>
        </div>
      </div>
    </section>
  </main>;
}
