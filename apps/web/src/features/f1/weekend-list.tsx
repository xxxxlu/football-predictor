"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { PulseLine } from "@/components/pulse";
import { PulseCircuit } from "@/components/pulse-circuit";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { normalizeWeekend, SESSION_KIND_LABELS, SESSION_STATE_LABELS, sessionPredictable, weekendPhase, type F1SessionView, type F1WeekendView, type WeekendPhaseFilter } from "./types";

function sessionHref(sessionId: string, roomId?: string): string {
  return roomId ? `/matches/f1/${sessionId}?roomId=${encodeURIComponent(roomId)}` : `/matches/f1/${sessionId}`;
}

function stateChipClass(session: F1SessionView): string {
  if (session.state === "CANCELLED") return "bg-[var(--wash-neutral)] text-[var(--muted)] line-through";
  if (session.state === "FINISHED") return "bg-[var(--pulse-carbon)] text-[var(--pulse-ivory)]";
  // red-deep, not pulse-red: white on #ff3b20 fails WCAG contrast (axe color-contrast, serious)
  if (sessionPredictable(session)) return "bg-[var(--pulse-red-deep)] text-white";
  return "bg-[var(--wash-neutral)] text-[var(--muted)]";
}

function stateChipLabel(session: F1SessionView): string {
  if (session.state === "UPCOMING" && !sessionPredictable(session)) return "待封盘";
  return SESSION_STATE_LABELS[session.state];
}

export function WeekendList({ roomId }: { roomId?: string }) {
  const [weekends, setWeekends] = useState<F1WeekendView[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [phase, setPhase] = useState<WeekendPhaseFilter>("UPCOMING");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/f1/weekends", { credentials: "same-origin", signal: controller.signal, cache: "no-store" });
        const result = await response.json().catch(() => ({})) as ApiEnvelope<unknown[]> & ApiFailure;
        if (!response.ok) throw new Error(result.error?.message || "F1 赛程暂不可用");
        const normalized = Array.isArray(result.data)
          ? result.data.map(normalizeWeekend).filter((weekend): weekend is F1WeekendView => weekend !== null)
          : [];
        setWeekends(normalized);
        setError("");
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "F1 赛程暂不可用");
      }
    })();
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    // Result sync runs in the worker; refresh the read model while this screen is open
    // so a confirmed result moves from locked to finished without a manual reload.
    const interval = window.setInterval(() => setRetry((value) => value + 1), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  if (error) {
    return <DataStatePanel state="error" title="暂时无法取得 F1 赛程" description={error} action={
      <button type="button" onClick={() => { setError(""); setWeekends(null); setRetry((value) => value + 1); }} className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--field)] px-5 text-sm font-bold text-[var(--field)] transition hover:bg-[var(--field)] hover:text-white">重试</button>
    } />;
  }
  if (weekends === null) {
    return <div aria-live="polite" aria-busy="true" className="grid gap-4 lg:grid-cols-2">
      {[1, 2, 3].map((number) => <div key={number} className="pitch-skeleton h-56 rounded-xl" />)}
      <span className="sr-only">正在加载 F1 赛程</span>
    </div>;
  }
  if (!weekends.length) return <DataStatePanel state="empty" title="目前没有 F1 分站" description="赛程发布后，Race Weekend 会出现在这里。" />;

  const upcoming = weekends.filter((weekend) => weekendPhase(weekend) === "UPCOMING");
  const history = weekends.filter((weekend) => weekendPhase(weekend) === "HISTORY").reverse();
  const shown = phase === "UPCOMING" ? upcoming : history;

  return <div>
    <div role="group" aria-label="按赛段筛选分站" className="mb-6 inline-grid grid-cols-2 gap-2">
      {([["UPCOMING", `即将到来 ${upcoming.length}`], ["HISTORY", `历史 ${history.length}`]] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={phase === value}
          onClick={() => setPhase(value)}
          className={`min-h-10 rounded-full border-2 px-5 text-sm font-bold transition ${phase === value ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--ink)]"}`}
        >{label}</button>
      ))}
    </div>
    {!shown.length
      ? <DataStatePanel state="empty" title={phase === "UPCOMING" ? "暂无即将到来的分站" : "还没有已完成的分站"} description={phase === "UPCOMING" ? "本赛季剩余分站发布后会出现在这里。" : "分站结束并确认官方结果后会进入历史。"} />
      : <div className="grid gap-6 xl:grid-cols-2">
          {shown.map((weekend, index) => <WeekendCard key={weekend.id} weekend={weekend} roomId={roomId} index={index} />)}
        </div>}
  </div>;
}

function WeekendCard({ weekend, roomId, index }: { weekend: F1WeekendView; roomId?: string; index: number }) {
  const live = weekend.sessions.some((session) => sessionPredictable(session));
  return (
    <article className="pulse-weekend-card" data-pulse-reveal style={{ "--pulse-card-delay": `${Math.min(index, 5) * 80}ms` } as React.CSSProperties}>
      <header className="pulse-weekend-card__head">
        <div className="pulse-weekend-card__media"><PulseCircuit circuitKey={weekend.circuitKey} /></div>
        <div className="pulse-weekend-card__head-copy">
          <p className="pd-eyebrow"><span>ROUND {String(weekend.round).padStart(2, "0")} · {weekend.season}</span></p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h3 className="kinetic text-3xl">{weekend.name}</h3>
            {weekend.isSprintWeekend && <span className="pd-tag pd-tag--lime"><span>SPRINT 周末</span></span>}
          </div>
          <p className="pulse-weekend-card__circuit">{weekend.circuitKey.replaceAll("-", " ").toUpperCase()} / RACE CONTROL</p>
          <div className="mt-4"><PulseLine state={live ? "upcoming" : "ambient"} /></div>
        </div>
      </header>
      <ol className="pulse-weekend-card__sessions">
        {weekend.sessions.map((session, sessionIndex) => (
          <li key={session.id}>
            <Link href={sessionHref(session.id, roomId)} className="pulse-weekend-session" style={{ "--pulse-session-delay": `${sessionIndex * 55}ms` } as React.CSSProperties}>
              <span className={`pulse-weekend-session__marker ${sessionPredictable(session) ? "is-open" : ""}`} aria-hidden="true">{String(sessionIndex + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <p className="font-bold">{SESSION_KIND_LABELS[session.kind]}</p>
                <time dateTime={session.startsAt} className="tabular mt-0.5 block text-xs text-[var(--muted)]">
                  {new Date(session.startsAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </time>
                {session.podium && session.podium.length > 0 && (
                  <p className="tabular mt-0.5 truncate text-xs font-bold text-[var(--ink)]">
                    🏆 {session.podium.map((entry) => entry.driverCode).join(" · ")}
                  </p>
                )}
              </div>
              <span className={`pulse-weekend-session__state ${stateChipClass(session)}`}>{stateChipLabel(session)}</span>
              <span className="pulse-weekend-session__arrow" aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ol>
    </article>
  );
}
