"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { KickoffLoader } from "@/components/kickoff-loader";
import { Marquee } from "@/components/marquee";
import { PulseCircuit } from "@/components/pulse-circuit";
import { PulseLine, SportGlyph } from "@/components/pulse";
import { PulseMotion } from "@/components/pulse-motion";
import { StatusMessage } from "@/components/status-message";
import type { ApiEnvelope, ApiFailure, MatchView } from "@/features/matchday/types";
import { normalizeMatch } from "@/features/matchday/types";
import { loadSession, type SessionState } from "./session-client";
import { normalizeWeekend, SESSION_KIND_LABELS, SESSION_STATE_LABELS, sessionPredictable, type F1WeekendView } from "@/features/f1/types";

type HomeData = { matches: MatchView[]; weekends: F1WeekendView[]; errors: string[] };

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

function GuestHome() {
  return (
    <main id="main-content" className="pulse-home pulse-home--guest">
      <section className="pulse-home__hero night line-art">
        <div className="pulse-home__hero-grid">
          <div className="pulse-home__copy">
            <p className="pd-eyebrow pd-enter pd-enter--1"><span>01 / PULSE SPORTS CLUB</span></p>
            <h1 className="pulse-home__title">
              <span className="pd-enter pd-enter--2">CALL</span>
              <span className="pulse-home__the">THE</span>
              <span className="pulse-home__moment pd-enter pd-enter--3">MOMENT.</span>
            </h1>
            <p className="pulse-home__sub pd-enter pd-enter--4">真实赛程、私人房间、虚拟积分。把每次判断变成下一次见面时可以翻出来的记录。</p>
            <div className="pulse-home__cta pd-enter pd-enter--5"><Link href="/register" className="btn-volt link-arrow">创建账户 <span className="arrow">→</span></Link><Link href="/login" className="btn-outline text-white"><span>登录继续</span></Link></div>
            <p className="pulse-home__legal pd-enter pd-enter--5">无需手机号或邮箱 · 不涉及现金 · 18+</p>
          </div>
          <div className="pulse-home__guest-art pd-enter pd-enter--4" aria-label="PULSE 运动俱乐部">
            <div className="pulse-home__art-copy"><span className="pd-num">02 SPORTS / ONE CLUB</span><strong>FOOTBALL<br /><em>+</em> FORMULA 1</strong></div>
            <PulseLine state="upcoming" />
            <span className="pulse-home__art-mark">P</span>
          </div>
        </div>
        <div className="pulse-home__hero-line"><PulseLine state="ambient" /></div>
      </section>
      <div className="pulse-home__ticker night"><Marquee items={["PULSE", "FOOTBALL", "FORMULA 1", "CALL THE MOMENT", "私人房间", "虚拟积分"]} /></div>
      <section className="pulse-home__guest-rail section-pad" data-pulse-reveal>
        <div className="mx-auto max-w-7xl px-4 md:px-8"><p className="eyebrow">LIVE DATA / 登录后可见</p><div className="pulse-home__locked-rail"><span className="pd-num">赛事脉搏</span><strong>登录后查看真实赛事与封盘状态</strong><Link href="/login" className="link-arrow text-[var(--field)]">进入赛事中心 <span className="arrow">→</span></Link></div></div>
      </section>
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
      <section className="pulse-home__hero night line-art">
        <div className="pulse-home__hero-grid">
          <div className="pulse-home__copy">
            <p className="pd-eyebrow pd-enter pd-enter--1"><span>01 / WELCOME BACK · {username}</span></p>
            <h1 className="pulse-home__title"><span className="pd-enter pd-enter--2">CALL</span><span className="pulse-home__the">THE</span><span className="pulse-home__moment pd-enter pd-enter--3">MOMENT.</span></h1>
            <p className="pulse-home__sub pd-enter pd-enter--4">你的赛事脉搏已经接通。挑一场真实比赛，进入房间，留下今天的判断。</p>
            <div className="pulse-home__cta pd-enter pd-enter--5"><Link href="/matches" className="btn-volt link-arrow">浏览赛事 <span className="arrow">→</span></Link><Link href="/rooms" className="btn-outline text-white"><span>进入我的房间</span></Link></div>
          </div>
          <div className="pulse-home__telemetry pd-enter pd-enter--4">
            <div className="pulse-home__telemetry-head"><span className="pd-num">NEXT EVENT</span><b>{next ? formatDateTime(next.startsAt) : loading ? "SYNCING…" : "暂无未来场次"}</b></div>
            <div className="pulse-home__circuit-media">{featuredWeekend ? <PulseCircuit circuitKey={featuredWeekend.circuitKey} /> : <PulseLine state="ambient" />}</div>
            <div className="pulse-home__telemetry-foot"><span>{featuredWeekend?.name || "PULSE EVENT CONTROL"}</span><span className="pd-num">{next?.sport || "DATA"}</span></div>
          </div>
        </div>
        <div className="pulse-home__hero-line"><PulseLine state={next?.status === "OPEN" ? "upcoming" : "ambient"} /></div>
      </section>

      <div className="pulse-home__ticker night"><Marquee items={["PULSE LINE", `${data.matches.length} FOOTBALL EVENTS`, `${data.weekends.length} F1 WEEKENDS`, "NO CASH · VIRTUAL POINTS", "CALL THE MOMENT"]} /></div>

      <section className="pulse-home__live-rail night" aria-label="真实赛事脉搏" data-pulse-reveal>
        <div className="pulse-home__section-intro"><p className="pd-eyebrow"><span>02 / LIVE RAIL</span></p><h2>现在发生什么</h2><span className="pd-num">DATA / {loading ? "SYNCING" : "LIVE READ"}</span></div>
        {data.errors.length > 0 && <div className="pulse-home__data-error"><span>DATA PARTIAL</span><span>{data.errors.join(" · ")}</span></div>}
        {loading ? <div className="pulse-home__rail-loading" aria-busy="true"><span /><span /><span /></div> : <LiveRail data={data} />}
      </section>

      <section className="pulse-home__arenas section-pad" data-pulse-reveal>
        <div className="mx-auto max-w-7xl px-4 md:px-8"><p className="eyebrow">03 / TWO ARENAS</p><h2 className="kinetic mt-3 text-[clamp(3rem,8vw,7rem)]">选择你的<span className="text-stroke">赛场</span></h2>
          <div className="pulse-home__arena-grid">
            <Link href="/matches" className="pulse-home__arena pulse-home__arena--football"><SportGlyph sport="FOOTBALL" className="pulse-home__arena-glyph" /><span className="pulse-home__arena-index">01 / MATCHDAY</span><strong>FOOTBALL</strong><span>{data.matches.length} 场真实比赛 · 开赛前可预测</span><i aria-hidden>↗</i></Link>
            <Link href="/matches/f1" className="pulse-home__arena pulse-home__arena--f1"><span className="pulse-home__arena-index">02 / PADDOCK</span><strong>FORMULA 1</strong><span>{data.weekends.length} 个 Race Weekend · 四类场次</span><i aria-hidden>↗</i></Link>
          </div>
        </div>
      </section>

      <MechanismSection />
      <FinalCallToAction authenticated />
    </main>
  );
}

function LiveRail({ data }: { data: HomeData }) {
  const rows = eventRows(data);
  if (!rows.length) return <div className="pulse-home__rail-empty"><span className="pd-num">NO EVENT SIGNAL</span><strong>当前没有可展示的未来赛事</strong><Link href="/matches" className="link-arrow">进入赛事中心 <span className="arrow">→</span></Link></div>;
  return <div>{rows.map((row) => <Link key={row.id} href={row.href} className="pulse-home__rail-row"><span className={`pulse-home__rail-kind pulse-home__rail-kind--${row.status === "OPEN" ? "open" : "quiet"}`}>{row.status === "OPEN" && <i />} {row.statusLabel}</span><span><b>{row.title}</b><small>{row.subtitle}</small></span><time dateTime={row.startsAt}>{formatDateTime(row.startsAt)}</time><span className="pulse-home__rail-arrow" aria-hidden>→</span></Link>)}</div>;
}

function MechanismSection() {
  return <section className="section-pad" data-pulse-reveal><div className="mx-auto max-w-7xl px-4 md:px-8"><div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:gap-20"><div><p className="eyebrow">04 / HOW IT WORKS</p><h2 className="kinetic mt-3 text-[clamp(3rem,8vw,6rem)]">四步<span className="text-stroke">开局</span></h2><p className="mt-6 max-w-sm leading-7 text-[var(--muted)]">所有数据都指向同一件事：在封盘之前做出你愿意留下的判断。</p></div><ol className="pd-mech list-none border-t border-b-0 p-0">{MECHANISM.map((item) => <MechRow key={item.n} {...item} light />)}</ol></div></div></section>;
}

function FinalCallToAction({ authenticated = false }: { authenticated?: boolean }) {
  return <section className="pulse-home__final night line-art section-pad" data-pulse-reveal><div className="mx-auto max-w-5xl px-4 text-center md:px-8"><p className="pd-eyebrow justify-center">PULSE / THE NEXT CALL</p><h2 className="kinetic mt-5 text-[clamp(3rem,9vw,7rem)]">{authenticated ? <>下一场，<span className="text-[var(--pulse-red)]">见。</span></> : <>准备好<span className="text-[var(--pulse-red)]">开局</span>了吗</>}</h2><p className="mx-auto mt-6 max-w-xl text-lg text-white/70">{authenticated ? "进入房间，选择真实赛事，在封盘之前提交你的判断。" : "建一个房间，把朋友拉进来，让这一季的每次判断都留下证据。"}</p><div className="mt-9 flex justify-center"><Link href={authenticated ? "/rooms" : "/register"} className="btn-volt link-arrow">{authenticated ? "进入我的房间" : "免费创建账户"}<span className="arrow">→</span></Link></div></div></section>;
}

const MECHANISM = [
  { n: "01", t: "选择赛事", d: "足球对阵或 F1 大奖赛周末，真实赛程，明确的开赛与封盘时间。" },
  { n: "02", t: "提交判断", d: "选定结果、投入积分，提交前在服务端复核倍率与封盘状态，失败不扣分。" },
  { n: "03", t: "自动封盘与结算", d: "开赛自动封盘，赛果确认后自动结算，冻结、结算、更正与冲正全程可审计。" },
  { n: "04", t: "和朋友长期排名", d: "每个房间独立积分与账本，命中率、战绩与排行长期留档。" },
];

function MechRow({ n, t, d, light = false }: { n: string; t: string; d: string; light?: boolean }) {
  return <li className="pd-mech-row" style={{ borderColor: light ? "var(--pulse-line-light)" : "var(--pulse-line-dark)" }}><code>{n}</code><span><b>{t}</b><p style={light ? { color: "var(--pulse-muted)" } : undefined}>{d}</p></span></li>;
}

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
