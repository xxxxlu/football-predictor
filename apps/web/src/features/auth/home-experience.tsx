"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StatusMessage } from "@/components/status-message";
import { KickoffLoader } from "@/components/kickoff-loader";
import { Marquee } from "@/components/marquee";
import { Reveal } from "@/components/reveal";
import { SoccerBall, Whistle, Trophy } from "@/components/football";
import { loadSession, type SessionState } from "./session-client";

export function HomeExperience() {
  const [session, setSession] = useState<SessionState>();
  useEffect(() => { void loadSession().then(setSession); }, []);

  if (!session) return <KickoffLoader />;
  if (session.kind === "unavailable") return (
    <AppShell sessionPending>
      <main className="mx-auto max-w-3xl px-4 py-20 md:px-8">
        <StatusMessage tone="error" title="暂时无法确认登录状态">请检查本地服务与数据库连接，然后刷新页面。</StatusMessage>
        <button type="button" onClick={() => window.location.reload()} className="btn-solid mt-6">重新加载</button>
      </main>
    </AppShell>
  );
  if (session.kind === "authenticated") return <AppShell username={session.user.username}><AuthedHero username={session.user.username} /></AppShell>;
  return <AppShell><GuestHome /></AppShell>;
}

function AuthedHero({ username }: { username: string }) {
  return (
    <main id="main-content" className="night line-art relative overflow-hidden">
      <SoccerBall className="pointer-events-none absolute -bottom-28 -right-16 hidden size-[34rem] opacity-[.05] md:block" />
      <div className="mx-auto max-w-7xl px-4 py-20 md:px-8 md:py-28">
        <p className="rise flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--volt)]"><span className="pulse-dot" aria-hidden="true" />欢迎回来</p>
        <h1 className="rise kinetic mt-6 break-words text-[clamp(2.75rem,9vw,7rem)]" style={{ animationDelay: "80ms" }}>{username}<span className="text-[var(--volt)]">.</span></h1>
        <p className="rise mt-6 max-w-xl text-lg leading-8 text-white/70" style={{ animationDelay: "160ms" }}>会话已生效。进入私人房间查看独立积分、比赛、预测与账本。继续你的比赛日。</p>
        <div className="rise mt-9 flex flex-col gap-4 sm:flex-row" style={{ animationDelay: "240ms" }}>
          <Link href="/rooms" className="btn-volt"><SoccerBall className="size-5" />进入我的房间</Link>
          <Link href="/account" className="btn-outline text-white"><span>账户与退出</span></Link>
        </div>
      </div>
    </main>
  );
}

function GuestHome() {
  return (
    <main id="main-content">
      <section className="night line-art relative overflow-hidden">
        <SoccerBall className="pointer-events-none absolute -bottom-32 -right-20 hidden size-[38rem] opacity-[.055] md:block" />
        <div className="mx-auto max-w-7xl px-4 pb-20 pt-14 md:px-8 md:pb-28 md:pt-20">
          <p className="rise flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--volt)]"><span className="pulse-dot" aria-hidden="true" />朋友间的比赛日记录</p>
          <h1 className="rise kinetic mt-6 text-[clamp(3.75rem,17vw,13rem)]" style={{ animationDelay: "80ms" }}>FOOT<span className="text-stroke text-[var(--volt)]">BALL</span></h1>
          <p className="rise mt-8 max-w-2xl text-lg leading-8 text-white/70 md:text-xl" style={{ animationDelay: "160ms" }}>判断留在账本，输赢交给球场。创建私人房间，用每房间独立的 10,000 虚拟积分表达判断强度——真实赛程、平台虚拟积分倍率、自动封盘与结算。</p>
          <div className="rise mt-10 flex flex-col gap-4 sm:flex-row" style={{ animationDelay: "240ms" }}>
            <Link href="/register" className="btn-volt"><SoccerBall className="size-5" />免费创建账户</Link>
            <Link href="/login" className="btn-outline text-white"><span>我已有账户</span></Link>
          </div>
          <p className="rise mt-6 text-xs text-white/45" style={{ animationDelay: "300ms" }}>无需手机号或邮箱 · 不涉及现金 · 18+</p>
        </div>
        <div className="absolute right-6 top-8 hidden rounded-2xl border border-[var(--night-line)] px-5 py-4 text-right md:block">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--volt)]">Since matchday</p>
          <p className="mt-1 text-sm font-bold text-white">虚拟积分 · 无现金</p>
          <p className="text-xs text-white/55">不可充值 / 提现 / 兑换 · 18+</p>
        </div>
      </section>

      <div className="night border-y border-[var(--night-line)] py-4 text-3xl text-white/90 md:py-5 md:text-5xl">
        <Marquee className="kinetic" items={["FOOTBALL", "判断留在账本", "MATCHDAY LEDGER", "输赢交给球场", "10,000 积分", "18+"]} />
      </div>

      <section className="section-pad">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <Reveal>
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">怎么玩</p>
            <h2 className="kinetic mt-3 text-[clamp(2.25rem,6vw,4.5rem)]">三步<span className="text-stroke"> 开局</span></h2>
          </Reveal>
          <div className="mt-14 space-y-16 md:mt-20 md:space-y-24">
            <FeatureRow index="01" en="OWN YOUR ROOM" title="每房独立" text="加入每个房间都从 10,000 虚拟积分开始，房间之间互不影响，各记各的账。" icon={<SoccerBall className="size-10" />} />
            <FeatureRow index="02" en="SERVER WHISTLE" title="服务端封盘" text="提交前在服务端复核积分倍率与开球状态，过期或已封盘会明确拦截，失败不扣分。" icon={<Whistle className="size-10 text-white" />} reverse />
            <FeatureRow index="03" en="FULL LEDGER" title="可审计结算" text="冻结、结算、更正与冲正形成完整时间线，每一笔积分变化都查得到。" icon={<Trophy className="size-10 text-white" />} />
          </div>
        </div>
      </section>

      <section className="night line-art section-pad">
        <div className="mx-auto max-w-5xl px-4 text-center md:px-8">
          <Reveal>
            <h2 className="kinetic text-[clamp(2.75rem,9vw,6.5rem)] text-white">准备好<span className="text-[var(--volt)]">开球</span>了吗</h2>
            <p className="mx-auto mt-6 max-w-xl text-lg text-white/70">建一个房间，把朋友拉进来，让这一季的每次判断都留下证据。</p>
            <div className="mt-9 flex justify-center">
              <Link href="/register" className="btn-volt link-arrow"><SoccerBall className="size-5" />免费创建账户<span className="arrow">→</span></Link>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  );
}

function FeatureRow({ index, en, title, text, icon, reverse = false }: { index: string; en: string; title: string; text: string; icon: React.ReactNode; reverse?: boolean }) {
  return (
    <Reveal className="grid items-center gap-8 md:grid-cols-2 md:gap-16">
      <div className={`flex items-center gap-6 ${reverse ? "md:order-2" : ""}`}>
        <span className="kinetic text-stroke text-[clamp(4rem,12vw,9rem)] leading-none text-[var(--field)]">{index}</span>
        <span className="grid size-16 shrink-0 place-items-center rounded-full bg-[var(--field)] text-white shadow-[0_10px_30px_rgb(15_80_57/28%)]">{icon}</span>
      </div>
      <div className={reverse ? "md:order-1" : ""}>
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--muted)]">{en}</p>
        <h3 className="kinetic mt-2 text-[clamp(2rem,5vw,3.25rem)]">{title}</h3>
        <p className="mt-4 max-w-md text-lg leading-8 text-[var(--muted)]">{text}</p>
      </div>
    </Reveal>
  );
}
