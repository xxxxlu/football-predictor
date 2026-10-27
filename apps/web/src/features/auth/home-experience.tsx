"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { SessionVerificationOverlay } from "@/components/session-verification-overlay";
import { Marquee } from "@/components/marquee";
import { PulseCircuit } from "@/components/pulse-circuit";
import { PulseDrive } from "@/components/pulse-drive";
import { PulseLine, SportGlyph } from "@/components/pulse";
import { PulseMotion } from "@/components/pulse-motion";
import { StatusMessage } from "@/components/status-message";
import { TeamCrest } from "@/components/football";
import { RollText } from "@/components/roll-text";
import type { ApiEnvelope, ApiFailure, MatchView } from "@/features/matchday/types";
import { normalizeMatch } from "@/features/matchday/types";
import { getCachedSession, loadSession, type SessionState } from "./session-client";
import { normalizeWeekend, SESSION_KIND_LABELS, SESSION_STATE_LABELS, sessionPredictable, type F1WeekendView } from "@/features/f1/types";

type HomeData = { matches: MatchView[]; weekends: F1WeekendView[]; errors: string[] };

export function HomeExperience() {
  const [session, setSession] = useState<SessionState | undefined>(getCachedSession);
  useEffect(() => { void loadSession().then(setSession); }, []);

  if (!session) return <SessionVerificationOverlay />;
  if (session.kind === "unavailable") return (
    <AppShell sessionPending>
      <main className="mx-auto max-w-3xl px-4 py-20 md:px-8">
        <StatusMessage tone="error" title="暂时无法确认登录状态">请检查本地服务与数据库连接，然后刷新页面。</StatusMessage>
        <button type="button" onClick={() => window.location.reload()} className="btn-solid mt-6">重新加载</button>
      </main>
    </AppShell>
  );

  return <AppShell username={session.kind === "authenticated" ? session.user.username : undefined}>
    <PulseMotion />
    {session.kind === "authenticated" ? <AuthenticatedHome username={session.user.username} /> : <GuestHome />}
  </AppShell>;
}

function AuthenticatedHome({ username }: { username: string }) {
  const [data, setData] = useState<HomeData>({ matches: [], weekends: [], errors: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled([
      fetch("/api/v1/matches", { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then(async (response) => {
        const result = await response.json().catch(() => ({})) as ApiEnvelope<unknown[]> & ApiFailure;
        if (!response.ok) throw new Error(result.error?.message || "足球赛事暂不可用");
        return Array.isArray(result.data) ? result.data.map((item) => normalizeMatch(item as Parameters<typeof normalizeMatch>[0])).filter((match): match is MatchView => match !== null) : [];
      }),
      fetch("/api/v1/f1/weekends", { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then(async (response) => {
        const result = await response.json().catch(() => ({})) as ApiEnvelope<unknown[]> & ApiFailure;
        if (!response.ok) throw new Error(result.error?.message || "F1 赛程暂不可用");
        return Array.isArray(result.data) ? result.data.map(normalizeWeekend).filter((weekend): weekend is F1WeekendView => weekend !== null) : [];
      }),
    ]).then((results) => {
      const [football, f1] = results;
      setData({
        matches: football.status === "fulfilled" ? football.value : [],
        weekends: f1.status === "fulfilled" ? f1.value : [],
        errors: [football, f1].flatMap((result) => result.status === "rejected" && (result.reason as Error)?.name !== "AbortError" ? [(result.reason as Error).message] : []),
      });
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  return <EditorialHome username={username} data={data} loading={loading} />;
}

function HeroShowcaseCockpit() {
  const [selected, setSelected] = useState<"HOME" | "DRAW" | "AWAY">("HOME");
  const [stake] = useState(1000);
  const [isLocked, setIsLocked] = useState(false);

  const odds = { HOME: "2.10", DRAW: "3.40", AWAY: "3.65" };
  const currentOdds = parseFloat(odds[selected]);
  const projected = Math.round(stake * currentOdds);

  const handleLock = () => {
    setIsLocked(true);
    setTimeout(() => setIsLocked(false), 2400);
  };

  return (
    <div className="tilt-card relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#121418] p-5 md:p-6 text-white shadow-2xl transition-all hover:border-[rgba(255,42,59,0.4)]">
      {/* Top Telemetry Bar */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-2 rounded-full bg-[#FF2A3B] animate-ping" />
          <span className="text-[11px] font-mono font-bold tracking-wider text-[#FF2A3B]">
            LIVE 74&apos; · PREMIER LEAGUE
          </span>
        </div>
        <span className="font-mono text-[10px] text-zinc-400 tracking-wider">
          PULSE APEX // 01
        </span>
      </div>

      {/* Versus Grid */}
      <div className="my-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamCrest name="Arsenal" className="size-12 md:size-14 text-sm font-bold" />
          <span className="font-bold text-sm md:text-base leading-tight">Arsenal</span>
          <span className="text-[11px] font-mono text-zinc-400">主场</span>
        </div>
        <div className="flex flex-col items-center px-2 text-center">
          <span className="font-mono text-3xl md:text-4xl font-black text-white tracking-tight">
            2 <span className="text-zinc-600">:</span> 1
          </span>
          <span className="mt-1 rounded-full bg-[#FF2A3B]/15 px-2.5 py-0.5 font-mono text-[10px] font-bold text-[#FF2A3B]">
            74&apos; SAKA (G)
          </span>
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamCrest name="Manchester City" className="size-12 md:size-14 text-sm font-bold" />
          <span className="font-bold text-sm md:text-base leading-tight">Man City</span>
          <span className="text-[11px] font-mono text-zinc-400">客场</span>
        </div>
      </div>

      {/* Interactive Odds Selector */}
      <div className="grid grid-cols-3 gap-2">
        {(["HOME", "DRAW", "AWAY"] as const).map((key) => {
          const label = key === "HOME" ? "主胜" : key === "DRAW" ? "平局" : "客胜";
          const isSelected = selected === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              className={`pressable-btn cursor-pointer rounded-xl border p-2.5 text-center transition-all ${
                isSelected
                  ? "border-[#FF2A3B] bg-[#160809] text-white shadow-[0_0_16px_rgba(255,42,59,0.3)]"
                  : "border-white/10 bg-[#0B0D10] text-zinc-300 hover:border-white/30"
              }`}
            >
              <div className="text-[10px] font-bold text-zinc-400">{label}</div>
              <div className="font-mono text-lg font-black">{odds[key]}</div>
            </button>
          );
        })}
      </div>

      {/* Return Projection */}
      <div className="mt-4 flex items-center justify-between rounded-xl border border-white/5 bg-[#0B0D10] px-4 py-2.5">
        <span className="text-xs text-zinc-400">预计返还 (投入 1,000)</span>
        <span className="font-mono text-lg font-black text-[#FF2A3B]">
          {projected.toLocaleString()} PTS
        </span>
      </div>

      {/* Lock Prediction Button */}
      <button
        type="button"
        onClick={handleLock}
        className="btn-super-pill pressable-btn has-roll mt-4 w-full min-h-12 text-sm tracking-wider shadow-[0_8px_24px_rgba(255,42,59,0.4)]"
      >
        <RollText
          top={isLocked ? "✓ PREDICTION LOCKED // 已锁定" : "LOCK PREDICTION // 锁定预测 →"}
          bottom={isLocked ? "SAVED TO CHAIN // 已留档" : "LOCK PREDICTION // 锁定预测 →"}
        />
      </button>
    </div>
  );
}

function GuestHome() {
  return (
    <main id="main-content" className="pulse-home pulse-home--guest">
      <PulseDrive className="pulse-home__hero-wrap">
        <section className="pulse-home__hero night line-art">
          <div className="pulse-home__hero-grid">
            <div className="pulse-home__copy">
              <p className="pd-eyebrow pd-enter pd-enter--1"><span>01 / PULSE APEX SPEED & BROADCAST</span></p>
              <h1 className="pulse-home__title">
                <span className="pd-enter pd-enter--2">FEEL THE SPEED.</span>
                <span className="text-[#FF2A3B] pd-enter pd-enter--3">CALL THE RACE.</span>
              </h1>
              <p className="pulse-home__sub pd-enter pd-enter--4">真实赛程、毫秒级推流、独立积分账本。把每次对胜负的敏锐判断，记录在坚不可摧的竞猜殿堂。</p>
              <div className="pulse-home__cta pd-enter pd-enter--5">
                <Link href="/register" className="btn-super-pill pressable-btn has-roll min-h-12 px-8 text-sm font-black shadow-[0_8px_24px_rgba(255,42,59,0.45)]">
                  <RollText top="JOIN THE CLUB // 立即加入" bottom="CREATE ACCOUNT →" />
                </Link>
                <Link href="/login" className="pressable-btn inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 bg-white/5 px-6 text-sm font-bold text-white transition hover:border-[#FF2A3B] hover:bg-[#FF2A3B]">
                  <span>登录已有账户</span>
                </Link>
                <Link href="/design-v3" className="pressable-btn inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-[#121418] px-5 text-xs font-bold text-zinc-300 transition hover:border-white/30 hover:text-white">
                  <span>⚡ 竞技座舱 (V3 Demo)</span>
                </Link>
              </div>
              <p className="pulse-home__legal pd-enter pd-enter--5">无需手机号或邮箱 · 不涉及真实货币 · 18+ ADULTS ONLY</p>
            </div>
            <div className="pd-enter pd-enter--4 flex justify-center">
              <HeroShowcaseCockpit />
            </div>
          </div>
          <div className="pulse-home__hero-line"><PulseLine state="ambient" /></div>
        </section>
      </PulseDrive>
      <div className="pulse-home__ticker night"><Marquee items={["PULSE APEX", "RACING RED", "FOOTBALL", "FORMULA 1", "CALL THE MOMENT", "INDEPENDENT ROOMS", "ZERO CASH RISK"]} /></div>
      <section className="pulse-home__guest-rail section-pad" data-pulse-reveal>
        <div className="mx-auto max-w-7xl px-4 md:px-8"><p className="eyebrow">LIVE DATA / 登录后可见</p><div className="pulse-home__locked-rail"><span className="pd-num text-[#FF2A3B]">赛事脉搏</span><strong>登录后查看真实赛事与封盘状态</strong><Link href="/login" className="btn-super-pill pressable-btn has-roll min-h-10 px-5 text-xs font-bold"><RollText top="进入赛事中心 →" bottom="SIGN IN →" /></Link></div></div>
      </section>
      <ArenaDeck data={{ matches: [], weekends: [], errors: [] }} guest />
      <MechanismSection />
      <FinalCallToAction />
    </main>
  );
}

function EditorialHome({ username, data, loading }: { username: string; data: HomeData; loading: boolean }) {
  const next = useMemo(() => nextEvent(data), [data]);
  const featuredWeekend = next?.sport === "F1" ? next.weekend : data.weekends[0];
  return (
    <main id="main-content" className="pulse-home">
      <PulseDrive className="pulse-home__hero-wrap">
        <section className="pulse-home__hero night line-art">
          <div className="pulse-home__hero-grid">
            <div className="pulse-home__copy">
              <p className="pd-eyebrow pd-enter pd-enter--1"><span>01 / WELCOME BACK · {username}</span></p>
              <h1 className="pulse-home__title">
                <span className="pd-enter pd-enter--2">CALL</span>
                <span className="pulse-home__the">THE</span>
                <span className="text-[#FF2A3B] pd-enter pd-enter--3">MOMENT.</span>
              </h1>
              <p className="pulse-home__sub pd-enter pd-enter--4">你的赛事脉搏已经接通。挑一场真实比赛，进入房间，留下今天的判断。</p>
              <div className="pulse-home__cta pd-enter pd-enter--5">
                <Link href="/matches" className="btn-super-pill pressable-btn has-roll min-h-12 px-7 text-sm font-black shadow-[0_8px_24px_rgba(255,42,59,0.4)]">
                  <RollText top="BROWSE EVENTS // 浏览赛事 →" bottom="EXPLORE MATCHDAY →" />
                </Link>
                <Link href="/rooms" className="pressable-btn inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 bg-white/5 px-6 text-sm font-bold text-white transition hover:border-[#FF2A3B] hover:bg-[#FF2A3B]">
                  <span>进入我的房间</span>
                </Link>
              </div>
            </div>
            <div className="pulse-home__telemetry pd-enter pd-enter--4">
              <div className="tilt-card p-5 border border-white/10 bg-[#121418] rounded-2xl shadow-2xl">
                <div className="pulse-home__telemetry-head mb-3">
                  <span className="pd-num text-[#FF2A3B]">NEXT EVENT</span>
                  <b className="text-white">{next ? formatDateTime(next.startsAt) : loading ? "SYNCING…" : "暂无未来场次"}</b>
                </div>
                <div className="pulse-home__circuit-media rounded-xl border border-white/10">
                  {featuredWeekend ? <PulseCircuit circuitKey={featuredWeekend.circuitKey} /> : <PulseLine state="ambient" />}
                </div>
                <div className="pulse-home__telemetry-foot mt-3">
                  <span className="text-zinc-300 font-bold">{featuredWeekend?.name || "PULSE EVENT CONTROL"}</span>
                  <span className="pd-num text-[#FF2A3B]">{next?.sport || "DATA"}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="pulse-home__hero-line"><PulseLine state={next?.status === "OPEN" ? "upcoming" : "ambient"} /></div>
        </section>
      </PulseDrive>

      <div className="pulse-home__ticker night"><Marquee items={["PULSE LINE", `${data.matches.length} FOOTBALL EVENTS`, `${data.weekends.length} F1 WEEKENDS`, "ZERO CASH RISK", "CALL THE MOMENT"]} /></div>

      <section className="pulse-home__live-rail night" aria-label="真实赛事脉搏" data-pulse-reveal>
        <div className="pulse-home__section-intro">
          <p className="pd-eyebrow"><span>02 / LIVE RAIL</span></p>
          <h2>现在发生什么</h2>
          <span className="pd-num">DATA / {loading ? "SYNCING" : "LIVE READ"}</span>
        </div>
        {data.errors.length > 0 && <div className="pulse-home__data-error"><span>DATA PARTIAL</span><span>{data.errors.join(" · ")}</span></div>}
        {loading ? <div className="pulse-home__rail-loading" aria-busy="true"><span /><span /><span /></div> : <LiveRail data={data} />}
      </section>

      <ArenaDeck data={data} />

      <MechanismSection />
      <FinalCallToAction authenticated />
    </main>
  );
}

function ArenaDeck({ data, guest = false }: { data: HomeData; guest?: boolean }) {
  const [mode, setMode] = useState<"FIELD" | "TRACK">("FIELD");
  const isField = mode === "FIELD";
  const href = isField ? "/matches" : "/matches/f1";
  const count = isField ? data.matches.length : data.weekends.length;
  const label = isField ? "FOOTBALL / MATCHDAY" : "FORMULA 1 / PADDOCK";
  return (
    <section className={`pulse-home__arena-deck section-pad ${isField ? "is-field" : "is-track"}`} data-pulse-reveal>
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="pulse-home__arena-deck-head">
          <div>
            <p className="eyebrow">03 / CHOOSE YOUR MODE</p>
            <h2 className="kinetic mt-3 text-[clamp(3rem,8vw,7rem)]">进入<span className="text-stroke">赛场</span></h2>
          </div>
          <div className="pulse-home__mode-switch rounded-full p-1 border border-white/10 bg-[#121418]" role="tablist" aria-label="切换赛场模式">
            <button
              type="button"
              role="tab"
              aria-selected={isField}
              className={`pressable-btn cursor-pointer rounded-full px-6 py-2.5 transition-all ${isField ? "bg-[#FF2A3B] text-white shadow-[0_0_16px_rgba(255,42,59,0.4)]" : "text-zinc-400 hover:text-white"}`}
              onClick={() => setMode("FIELD")}
            >
              <span>ON FIELD</span>
              <small className="block text-[10px] opacity-75">足球 · MATCHDAY</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isField}
              className={`pressable-btn cursor-pointer rounded-full px-6 py-2.5 transition-all ${!isField ? "bg-[#FF2A3B] text-white shadow-[0_0_16px_rgba(255,42,59,0.4)]" : "text-zinc-400 hover:text-white"}`}
              onClick={() => setMode("TRACK")}
            >
              <span>ON TRACK</span>
              <small className="block text-[10px] opacity-75">F1 · RACE CONTROL</small>
            </button>
          </div>
        </div>
        <div className="pulse-home__mode-panel">
          <div className="pulse-home__mode-copy">
            <p className="pulse-home__arena-index">{isField ? "01 / MATCHDAY" : "02 / PADDOCK"}</p>
            <strong>{isField ? "FOOTBALL" : "FORMULA 1"}</strong>
            <p>{isField ? "在哨声之前留下你的判断，和房间里的人一起看这场比赛。" : "把一个 Race Weekend 拆成每个可以被准确记录的瞬间。"}</p>
            <div className="pulse-home__mode-meta">
              <span><b>{guest ? "SYNC" : count}</b> {guest ? "登录后同步真实赛事" : isField ? "场真实比赛" : "个 Race Weekend"}</span>
              <span>{label}</span>
            </div>
            <Link href={guest ? "/login" : href} className="btn-super-pill pressable-btn has-roll mt-4 min-h-11 px-7 text-xs font-black shadow-[0_6px_20px_rgba(255,42,59,0.35)]">
              <RollText top={guest ? "LOGIN TO EXPLORE // 登录查看" : `ENTER ${isField ? "MATCHDAY" : "RACE CONTROL"} →`} />
            </Link>
          </div>
          <div className="pulse-home__mode-visual" aria-hidden="true">
            {isField ? <SportGlyph sport="FOOTBALL" className="pulse-home__arena-glyph" /> : data.weekends[0] ? <PulseCircuit circuitKey={data.weekends[0].circuitKey} /> : <PulseLine state="ambient" />}
            <span className="pulse-home__mode-stamp">{isField ? "THE MATCH IS THE MOMENT" : "THE CLOCK NEVER LIES"}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function LiveRail({ data }: { data: HomeData }) {
  const rows = eventRows(data);
  if (!rows.length) return <div className="pulse-home__rail-empty"><span className="pd-num text-[#FF2A3B]">NO EVENT SIGNAL</span><strong className="text-white">当前没有可展示的未来赛事</strong><Link href="/matches" className="btn-super-pill pressable-btn has-roll min-h-10 px-5 text-xs font-bold"><RollText top="进入赛事中心 →" bottom="EXPLORE →" /></Link></div>;
  return <div>{rows.map((row) => <Link key={row.id} href={row.href} className="pulse-home__rail-row hover:border-[#FF2A3B] transition-all"><span className={`pulse-home__rail-kind pulse-home__rail-kind--${row.status === "OPEN" ? "open" : "quiet"}`}>{row.status === "OPEN" && <i />} {row.statusLabel}</span><span><b className="text-white">{row.title}</b><small className="text-zinc-400">{row.subtitle}</small></span><time dateTime={row.startsAt} className="text-zinc-400">{formatDateTime(row.startsAt)}</time><span className="pulse-home__rail-arrow text-[#FF2A3B]" aria-hidden>→</span></Link>)}</div>;
}

function MechanismSection() {
  return (
    <section className="section-pad bg-[#0B0C0E]" data-pulse-reveal>
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
          <div>
            <p className="eyebrow text-[#FF2A3B]">04 / HOW IT WORKS</p>
            <h2 className="kinetic mt-3 text-[clamp(3rem,8vw,6rem)] text-white">四步<span className="text-stroke">开局</span></h2>
            <p className="mt-6 max-w-sm leading-7 text-zinc-400">所有数据都指向同一件事：在封盘之前做出你愿意留下的判断。</p>
          </div>
          <ol className="grid gap-4 list-none p-0">
            {MECHANISM.map((item) => (
              <li key={item.n} className="tilt-card p-5 border border-white/10 bg-[#121418] rounded-2xl flex items-start gap-5">
                <span className="font-mono text-3xl font-black text-[#FF2A3B]">{item.n}</span>
                <div>
                  <b className="text-lg font-bold text-white">{item.t}</b>
                  <p className="mt-1 text-sm leading-6 text-zinc-400">{item.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function FinalCallToAction({ authenticated = false }: { authenticated?: boolean }) {
  return (
    <section className="pulse-home__final night line-art section-pad" data-pulse-reveal>
      <div className="mx-auto max-w-5xl px-4 text-center md:px-8">
        <p className="pd-eyebrow justify-center">PULSE / THE NEXT CALL</p>
        <h2 className="kinetic mt-5 text-[clamp(3rem,9vw,7rem)]">
          {authenticated ? <>下一场，<span className="text-[#FF2A3B]">见。</span></> : <>准备好<span className="text-[#FF2A3B]">开局</span>了吗</>}
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg text-white/70">
          {authenticated ? "进入房间，选择真实赛事，在封盘之前提交你的判断。" : "建一个房间，把朋友拉进来，让这一季的每次判断都留下证据。"}
        </p>
        <div className="mt-9 flex justify-center">
          <Link href={authenticated ? "/rooms" : "/register"} className="btn-super-pill pressable-btn has-roll min-h-14 px-10 text-base font-black tracking-wider shadow-[0_10px_32px_rgba(255,42,59,0.5)]">
            <RollText top={authenticated ? "ENTER MY ROOMS // 进入房间 →" : "CREATE FREE ACCOUNT // 免费创建账户 →"} />
          </Link>
        </div>
      </div>
    </section>
  );
}

const MECHANISM = [
  { n: "01", t: "选择赛事", d: "足球对阵或 F1 大奖赛周末，真实赛程，明确的开赛与封盘时间。" },
  { n: "02", t: "提交判断", d: "选定结果、投入积分，提交前在服务端复核倍率与封盘状态，失败不扣分。" },
  { n: "03", t: "自动封盘与结算", d: "开赛自动封盘，赛果确认后自动结算，冻结、结算、更正与冲正全程可审计。" },
  { n: "04", t: "和朋友长期排名", d: "每个房间独立积分与账本，命中率、战绩与排行长期留档。" },
];

function eventRows(data: HomeData) {
  const rows: Array<{ id: string; href: string; title: string; subtitle: string; startsAt: string; status: string; statusLabel: string }> = [];
  const now = Date.now();
  data.matches.filter((match) => new Date(match.kickoffAt).getTime() > now).sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt)).slice(0, 2).forEach((match) => rows.push({ id: `football:${match.id}`, href: `/matches/${encodeURIComponent(match.id)}`, title: `${match.homeTeam} vs ${match.awayTeam}`, subtitle: `FOOTBALL · ${match.competitionName}`, startsAt: match.kickoffAt, status: match.state === "OPEN" ? "OPEN" : "QUIET", statusLabel: match.state === "OPEN" ? "OPEN" : "NEXT" }));
  data.weekends.flatMap((weekend) => weekend.sessions.map((session) => ({ weekend, session }))).filter(({ session }) => new Date(session.startsAt).getTime() > now).sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt)).slice(0, Math.max(0, 3 - rows.length)).forEach(({ weekend, session }) => rows.push({ id: `f1:${session.id}`, href: `/matches/f1/${encodeURIComponent(session.id)}`, title: `${weekend.name} · ${SESSION_KIND_LABELS[session.kind]}`, subtitle: `F1 · ROUND ${String(weekend.round).padStart(2, "0")}`, startsAt: session.startsAt, status: sessionPredictable(session) ? "OPEN" : "QUIET", statusLabel: sessionPredictable(session) ? "OPEN" : SESSION_STATE_LABELS[session.state] }));
  return rows;
}

function nextEvent(data: HomeData): { startsAt: string; sport: "FOOTBALL" | "F1"; status: string; weekend?: F1WeekendView } | null {
  const football = data.matches.filter((match) => new Date(match.kickoffAt).getTime() > Date.now()).sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))[0];
  const f1 = data.weekends.flatMap((weekend) => weekend.sessions.map((session) => ({ session, weekend }))).filter(({ session }) => new Date(session.startsAt).getTime() > Date.now()).sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt))[0];
  if (!football && !f1) return null;
  if (!f1 || (football && football.kickoffAt < f1.session.startsAt)) return { startsAt: football.kickoffAt, sport: "FOOTBALL", status: football.state };
  return { startsAt: f1.session.startsAt, sport: "F1", status: f1.session.state, weekend: f1.weekend };
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
}
