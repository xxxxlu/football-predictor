import Link from "next/link";
import { AppShell } from "@/components/app-shell";

const fixtures = [
  { time: "20:30", home: "曼彻斯特蓝", away: "伦敦红", state: "今晚" },
  { time: "23:00", home: "马德里白", away: "巴塞罗那蓝", state: "周六" },
  { time: "02:45", home: "米兰红黑", away: "都灵黑白", state: "周日" },
];

export default function Home() {
  return <AppShell><main id="main-content">
    <section className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-[1.1fr_.9fr] md:px-8 md:py-20">
      <div className="self-center"><p className="eyebrow">朋友间的比赛日记录</p><h1 className="display mt-4 max-w-3xl text-[clamp(2.65rem,7vw,5.6rem)] font-bold leading-[.93]">判断留在账本，<br/><em className="font-normal text-[var(--field)]">输赢交给球场。</em></h1><p className="mt-7 max-w-xl text-lg leading-8 text-[var(--muted)]">创建私人房间，用每房间独立的 10,000 虚拟积分表达判断强度。真实赔率、自动封盘、自动结算，每一笔变化都有记录。</p><div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link href="/register" className="bg-[var(--field)] px-6 py-3.5 text-center font-bold text-white no-underline hover:bg-[var(--field-dark)]">免费创建账户</Link><Link href="/login" className="border border-[var(--ink)] px-6 py-3.5 text-center font-bold no-underline hover:bg-white/60">我已有账户</Link></div><p className="mt-4 text-xs text-[var(--muted)]">无需手机号或邮箱 · 不涉及现金 · 18+</p></div>
      <div aria-label="比赛预览" className="surface shadow-[var(--shadow)]"><div className="flex items-end justify-between border-b rule p-5"><div><p className="eyebrow">本轮焦点</p><h2 className="display mt-1 text-2xl font-bold">朋友房 · 比赛日 01</h2></div><span className="text-xs font-bold text-[var(--field)]">● 数据正常</span></div><div>{fixtures.map((fixture, index) => <article key={fixture.home} className={`grid grid-cols-[3.2rem_1fr_auto] items-center gap-3 p-5 ${index ? "border-t rule" : ""}`}><time className="tabular text-sm font-bold">{fixture.time}</time><div><p className="font-bold">{fixture.home}</p><p className="mt-1 text-sm text-[var(--muted)]">对 {fixture.away}</p></div><span className="border border-[var(--line)] px-2 py-1 text-xs">{fixture.state}</span></article>)}</div><div className="grid grid-cols-2 border-t rule bg-[var(--ink)] p-5 text-white"><div><p className="text-xs text-white/65">可用积分</p><p className="tabular mt-1 text-xl font-bold">10,000.00</p></div><div><p className="text-xs text-white/65">已提交成员</p><p className="tabular mt-1 text-xl font-bold">4 / 7</p></div></div></div>
    </section>
    <section className="border-y rule bg-[var(--ink)] text-white"><div className="mx-auto grid max-w-7xl gap-px bg-white/20 md:grid-cols-3"><Feature number="01" title="每房独立" text="加入每个房间都从 10,000 分开始，互不影响。"/><Feature number="02" title="服务端封盘" text="提交前复核赔率和开球状态，失败不扣分。"/><Feature number="03" title="可审计结算" text="冻结、结算、更正与冲正形成完整时间线。"/></div></section>
  </main></AppShell>;
}

function Feature({ number, title, text }: { number: string; title: string; text: string }) { return <article className="bg-[var(--ink)] p-8 md:p-10"><span className="tabular text-xs text-white/55">{number}</span><h2 className="display mt-8 text-2xl font-bold">{title}</h2><p className="mt-3 leading-7 text-white/70">{text}</p></article>; }
