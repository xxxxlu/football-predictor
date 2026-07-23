"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StatusMessage } from "@/components/status-message";
import { KickoffLoader } from "@/components/kickoff-loader";
import { Marquee } from "@/components/marquee";
import { Reveal } from "@/components/reveal";
import { PulseLine, SportGlyph } from "@/components/pulse";
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
      <PulseLine state="ambient" className="pointer-events-none absolute inset-x-0 bottom-10 hidden h-8 w-full opacity-70 md:block" />
      <div className="mx-auto max-w-7xl px-4 py-20 md:px-8 md:py-28">
        <p className="rise pd-eyebrow">欢迎回来 / WELCOME BACK</p>
        <h1 className="rise kinetic mt-6 break-words text-[clamp(2.75rem,9vw,7rem)]" style={{ animationDelay: "80ms" }}>{username}<span className="text-[var(--pulse-red)]">.</span></h1>
        <p className="rise mt-6 max-w-xl text-lg leading-8 text-white/70" style={{ animationDelay: "160ms" }}>会话已生效。进入私人房间查看独立积分、赛事、预测与账本。继续记录你的每一次判断。</p>
        <div className="rise mt-9 flex flex-col gap-4 sm:flex-row" style={{ animationDelay: "240ms" }}>
          <Link href="/rooms" className="btn-volt">进入我的房间</Link>
          <Link href="/matches" className="btn-outline text-white"><span>浏览赛事</span></Link>
        </div>
      </div>
    </main>
  );
}

function GuestHome() {
  return (
    <main id="main-content">
      <section className="night line-art relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-12 md:px-8 md:pb-24 md:pt-16">
          <p className="rise pd-eyebrow">01 / PULSE SPORTS CLUB</p>
          <h1 className="rise kinetic mt-6 text-[clamp(3.5rem,13vw,10rem)]" style={{ animationDelay: "80ms" }}>
            CALL
            <span className="block text-[.42em] tracking-[.08em] text-white/45">THE</span>
            <span className="block text-[var(--pulse-red)]">MOMENT.</span>
          </h1>
          <p className="rise mt-8 max-w-2xl text-lg leading-8 text-white/70 md:text-xl" style={{ animationDelay: "160ms" }}>每一刻，都有判断。足球、F1，和朋友一起预测——每房间独立 10,000 虚拟积分表达判断强度，真实赛程、平台虚拟积分倍率、自动封盘与结算。</p>
          <div className="rise mt-10 flex flex-col gap-4 sm:flex-row" style={{ animationDelay: "240ms" }}>
            <Link href="/register" className="btn-volt">免费创建账户</Link>
            <Link href="/login" className="btn-outline text-white"><span>我已有账户</span></Link>
          </div>
          <p className="rise mt-6 text-xs text-white/45" style={{ animationDelay: "300ms" }}>无需手机号或邮箱 · 不涉及现金 · 18+</p>
          <div className="rise mt-10 flex items-center gap-6 text-xs text-white/55" style={{ animationDelay: "340ms" }}>
            <span className="inline-flex items-center gap-2"><SportGlyph sport="FOOTBALL" className="size-5" />足球</span>
            <span className="inline-flex items-center gap-2"><SportGlyph sport="FORMULA_1" className="size-5" />FORMULA 1</span>
            <span className="pd-num text-white/40">02 SPORTS</span>
          </div>
        </div>
        <div className="absolute right-6 top-8 hidden rounded-lg border border-[var(--night-line)] px-5 py-4 text-right md:block">
          <p className="pd-num text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">PULSE / 赛事脉搏</p>
          <p className="mt-1 text-sm font-bold text-white">虚拟积分 · 无现金</p>
          <p className="text-xs text-white/55">不可充值 / 提现 / 兑换 · 18+</p>
        </div>
        <PulseLine state="ambient" className="pointer-events-none absolute inset-x-0 bottom-6 hidden h-8 w-full opacity-60 md:block" />
      </section>

      <div className="night border-y border-[var(--night-line)] py-4 text-3xl text-white/90 md:py-5 md:text-5xl">
        <Marquee className="kinetic" items={["PULSE", "每一刻，都有判断", "CALL THE MOMENT", "FOOTBALL", "FORMULA 1", "10,000 积分", "18+"]} />
      </div>

      <section className="section-pad">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <Reveal>
            <p className="eyebrow">怎么玩 / HOW IT WORKS</p>
            <h2 className="kinetic mt-3 text-[clamp(2.25rem,6vw,4.5rem)]">四步<span className="text-stroke"> 开局</span></h2>
          </Reveal>
          <Reveal className="mt-12 md:mt-16">
            <ol className="pd-mech list-none border-t border-b-0 p-0" style={{ borderColor: "var(--pulse-line-light)" }}>
              <MechRow index="01" title="选择赛事" text="足球对阵或 F1 大奖赛周末，真实赛程，明确的开赛与封盘时间。" light />
              <MechRow index="02" title="提交判断" text="选定结果、投入积分，提交前在服务端复核倍率与封盘状态，失败不扣分。" light />
              <MechRow index="03" title="自动封盘与结算" text="开赛自动封盘，赛果确认后自动结算，冻结、结算、更正与冲正全程可审计。" light />
              <MechRow index="04" title="和朋友长期排名" text="每个房间独立积分与账本，命中率、战绩与排行长期留档。" light />
            </ol>
          </Reveal>
        </div>
      </section>

      <section className="night line-art section-pad">
        <div className="mx-auto max-w-5xl px-4 text-center md:px-8">
          <Reveal>
            <h2 className="kinetic text-[clamp(2.75rem,9vw,6.5rem)] text-white">准备好<span className="text-[var(--pulse-red)]">开局</span>了吗</h2>
            <p className="mx-auto mt-6 max-w-xl text-lg text-white/70">建一个房间，把朋友拉进来，让这一季的每次判断都留下证据。</p>
            <div className="mt-9 flex justify-center">
              <Link href="/register" className="btn-volt link-arrow">免费创建账户<span className="arrow">→</span></Link>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  );
}

function MechRow({ index, title, text, light = false }: { index: string; title: string; text: string; light?: boolean }) {
  return (
    <li className="pd-mech-row" style={{ borderColor: "var(--pulse-line-light)" }}>
      <code>{index}</code>
      <span>
        <b>{title}</b>
        <p style={light ? { color: "var(--pulse-muted)" } : undefined}>{text}</p>
      </span>
    </li>
  );
}
