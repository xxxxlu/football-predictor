"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StatusMessage } from "@/components/status-message";
import { PitchLoader, SoccerBall, Whistle, Trophy } from "@/components/football";
import { loadSession, type SessionState } from "./session-client";

export function HomeExperience() {
  const [session, setSession] = useState<SessionState>();
  useEffect(() => { void loadSession().then(setSession); }, []);

  if (!session) return <AppShell sessionPending><main className="mx-auto max-w-7xl px-4 py-16 md:px-8"><PitchLoader label="正在确认会话" /></main></AppShell>;
  if (session.kind === "unavailable") return <AppShell sessionPending><main className="mx-auto max-w-3xl px-4 py-20 md:px-8"><StatusMessage tone="error" title="暂时无法确认登录状态">请检查本地服务与数据库连接，然后刷新页面。</StatusMessage><button type="button" onClick={() => window.location.reload()} className="mt-5 min-h-12 border border-[var(--ink)] px-5 font-bold">重新加载</button></main></AppShell>;
  if (session.kind === "authenticated") return (
    <AppShell username={session.user.username}>
      <main id="main-content" className="relative overflow-hidden">
        <PitchDecor />
        <div className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24">
          <p className="eyebrow flex items-center gap-2"><span className="pulse-dot text-[var(--field)]" aria-hidden="true" />欢迎回来</p>
          <h1 className="display mt-4 max-w-4xl text-[clamp(2.65rem,7vw,5.6rem)] font-bold leading-[.93]">{session.user.username}，<br /><em className="font-normal text-[var(--field)]">继续你的比赛日。</em></h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-[var(--muted)]">会话已生效。进入私人房间查看独立积分、比赛、预测与账本。</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/rooms" className="inline-flex items-center justify-center gap-2 bg-[var(--field)] px-6 py-3.5 text-center font-bold text-white no-underline hover:bg-[var(--field-dark)]"><SoccerBall className="size-5" />进入我的房间</Link>
            <Link href="/account" className="border border-[var(--ink)] px-6 py-3.5 text-center font-bold no-underline hover:bg-white/60">账户与退出</Link>
          </div>
        </div>
      </main>
    </AppShell>
  );
  return <AppShell><GuestHome /></AppShell>;
}

function PitchDecor() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -right-28 -top-28 hidden size-[26rem] rounded-full border-[3px] md:block" style={{ borderColor: "rgb(23 107 77 / 10%)" }} />
      <div className="absolute -right-10 top-24 hidden size-24 rounded-full border-[3px] md:block" style={{ borderColor: "rgb(23 107 77 / 12%)" }} />
      <SoccerBall className="absolute right-16 top-16 hidden size-44 opacity-[.05] md:block" />
    </div>
  );
}

function GuestHome() {
  return (
    <main id="main-content">
      <section className="relative overflow-hidden">
        <PitchDecor />
        <div className="mx-auto max-w-7xl px-4 py-12 md:px-8 md:py-20">
          <p className="eyebrow flex items-center gap-2"><span className="pulse-dot text-[var(--field)]" aria-hidden="true" />朋友间的比赛日记录</p>
          <h1 className="display mt-4 max-w-4xl text-[clamp(2.65rem,7vw,5.6rem)] font-bold leading-[.93]">判断留在账本，<br /><em className="font-normal text-[var(--field)]">输赢交给球场。</em></h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-[var(--muted)]">创建私人房间，用每房间独立的 10,000 虚拟积分表达判断强度。真实赛程、平台虚拟积分倍率、自动封盘与结算，每一笔变化都有记录。</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/register" className="inline-flex items-center justify-center gap-2 bg-[var(--field)] px-6 py-3.5 text-center font-bold text-white no-underline hover:bg-[var(--field-dark)]"><SoccerBall className="size-5" />免费创建账户</Link>
            <Link href="/login" className="border border-[var(--ink)] px-6 py-3.5 text-center font-bold no-underline hover:bg-white/60">我已有账户</Link>
          </div>
          <p className="mt-4 text-xs text-[var(--muted)]">无需手机号或邮箱 · 不涉及现金 · 18+</p>
        </div>
      </section>
      <section className="pitch-panel border-y rule">
        <div className="mx-auto grid max-w-7xl md:grid-cols-3">
          <Feature icon={<SoccerBall className="size-6" />} number="01" title="每房独立" text="加入每个房间都从 10,000 分开始，互不影响。" />
          <Feature icon={<Whistle className="size-6 text-white" />} number="02" title="服务端封盘" text="提交前复核积分倍率和开球状态，失败不扣分。" />
          <Feature icon={<Trophy className="size-6 text-white" />} number="03" title="可审计结算" text="冻结、结算、更正与冲正形成完整时间线。" />
        </div>
      </section>
    </main>
  );
}

function Feature({ icon, number, title, text }: { icon: React.ReactNode; number: string; title: string; text: string }) {
  return (
    <article className="border-t border-white/10 p-8 first:border-t-0 md:border-l md:border-t-0 md:p-10 md:first:border-l-0">
      <div className="flex items-center justify-between">
        <span className="grid size-11 place-items-center rounded-full border border-white/25">{icon}</span>
        <span className="tabular text-xs text-white/55">{number}</span>
      </div>
      <h2 className="display mt-6 text-2xl font-bold text-white">{title}</h2>
      <p className="mt-3 leading-7 text-white/70">{text}</p>
    </article>
  );
}
