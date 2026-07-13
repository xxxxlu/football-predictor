"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StatusMessage } from "@/components/status-message";
import { loadSession, type SessionState } from "./session-client";

export function HomeExperience() {
  const [session, setSession] = useState<SessionState>();
  useEffect(() => { void loadSession().then(setSession); }, []);

  if (!session) return <AppShell sessionPending><main className="mx-auto max-w-7xl px-4 py-20 md:px-8"><p className="eyebrow">正在确认会话</p><div className="mt-4 h-24 max-w-2xl animate-pulse bg-black/5"/></main></AppShell>;
  if (session.kind === "unavailable") return <AppShell sessionPending><main className="mx-auto max-w-3xl px-4 py-20 md:px-8"><StatusMessage tone="error" title="暂时无法确认登录状态">请检查本地服务与数据库连接，然后刷新页面。</StatusMessage><button type="button" onClick={() => window.location.reload()} className="mt-5 min-h-12 border border-[var(--ink)] px-5 font-bold">重新加载</button></main></AppShell>;
  if (session.kind === "authenticated") return <AppShell username={session.user.username}><main id="main-content" className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24"><p className="eyebrow">欢迎回来</p><h1 className="display mt-4 max-w-4xl text-[clamp(2.65rem,7vw,5.6rem)] font-bold leading-[.93]">{session.user.username}，<br/><em className="font-normal text-[var(--field)]">继续你的比赛日。</em></h1><p className="mt-7 max-w-xl text-lg leading-8 text-[var(--muted)]">会话已生效。进入私人房间查看独立积分、比赛、预测与账本。</p><div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link href="/rooms" className="bg-[var(--field)] px-6 py-3.5 text-center font-bold text-white no-underline hover:bg-[var(--field-dark)]">进入我的房间</Link><Link href="/account" className="border border-[var(--ink)] px-6 py-3.5 text-center font-bold no-underline hover:bg-white/60">账户与退出</Link></div></main></AppShell>;
  return <AppShell><GuestHome/></AppShell>;
}

function GuestHome() {
  return <main id="main-content"><section className="mx-auto max-w-7xl px-4 py-12 md:px-8 md:py-20"><p className="eyebrow">朋友间的比赛日记录</p><h1 className="display mt-4 max-w-4xl text-[clamp(2.65rem,7vw,5.6rem)] font-bold leading-[.93]">判断留在账本，<br/><em className="font-normal text-[var(--field)]">输赢交给球场。</em></h1><p className="mt-7 max-w-xl text-lg leading-8 text-[var(--muted)]">创建私人房间，用每房间独立的 10,000 虚拟积分表达判断强度。真实赔率、自动封盘、自动结算，每一笔变化都有记录。</p><div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link href="/register" className="bg-[var(--field)] px-6 py-3.5 text-center font-bold text-white no-underline hover:bg-[var(--field-dark)]">免费创建账户</Link><Link href="/login" className="border border-[var(--ink)] px-6 py-3.5 text-center font-bold no-underline hover:bg-white/60">我已有账户</Link></div><p className="mt-4 text-xs text-[var(--muted)]">无需手机号或邮箱 · 不涉及现金 · 18+</p></section><section className="border-y rule bg-[var(--ink)] text-white"><div className="mx-auto grid max-w-7xl gap-px bg-white/20 md:grid-cols-3"><Feature number="01" title="每房独立" text="加入每个房间都从 10,000 分开始，互不影响。"/><Feature number="02" title="服务端封盘" text="提交前复核赔率和开球状态，失败不扣分。"/><Feature number="03" title="可审计结算" text="冻结、结算、更正与冲正形成完整时间线。"/></div></section></main>;
}

function Feature({ number, title, text }: { number: string; title: string; text: string }) { return <article className="bg-[var(--ink)] p-8 md:p-10"><span className="tabular text-xs text-white/55">{number}</span><h2 className="display mt-8 text-2xl font-bold">{title}</h2><p className="mt-3 leading-7 text-white/70">{text}</p></article>; }
