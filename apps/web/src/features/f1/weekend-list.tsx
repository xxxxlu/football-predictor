"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { PulseLine } from "@/components/pulse";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { normalizeWeekend, SESSION_KIND_LABELS, SESSION_STATE_LABELS, sessionPredictable, type F1SessionView, type F1WeekendView } from "./types";

function sessionHref(sessionId: string, roomId?: string): string {
  return roomId ? `/matches/f1/${sessionId}?roomId=${encodeURIComponent(roomId)}` : `/matches/f1/${sessionId}`;
}

function stateChipClass(session: F1SessionView): string {
  if (session.state === "CANCELLED") return "bg-[rgb(23_35_59/8%)] text-[var(--muted)] line-through";
  if (session.state === "FINISHED") return "bg-[var(--pulse-carbon)] text-[var(--pulse-ivory)]";
  if (sessionPredictable(session)) return "bg-[var(--pulse-red)] text-white";
  return "bg-[rgb(23_35_59/8%)] text-[var(--muted)]";
}

function stateChipLabel(session: F1SessionView): string {
  if (session.state === "UPCOMING" && !sessionPredictable(session)) return "待封盘";
  return SESSION_STATE_LABELS[session.state];
}

export function WeekendList({ roomId }: { roomId?: string }) {
  const [weekends, setWeekends] = useState<F1WeekendView[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

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

  return <div className="grid gap-4 lg:grid-cols-2">
    {weekends.map((weekend) => <WeekendCard key={weekend.id} weekend={weekend} roomId={roomId} />)}
  </div>;
}

function WeekendCard({ weekend, roomId }: { weekend: F1WeekendView; roomId?: string }) {
  const live = weekend.sessions.some((session) => sessionPredictable(session));
  return (
    <article className="surface overflow-hidden">
      <header className="bg-[var(--pulse-carbon)] p-4 text-[var(--pulse-ivory)]">
        <p className="pd-eyebrow text-[var(--pulse-ivory)]">ROUND {String(weekend.round).padStart(2, "0")} · {weekend.season}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h3 className="display text-2xl font-black uppercase">{weekend.name}</h3>
          {weekend.isSprintWeekend && <span className="pd-tag pd-tag--lime"><span>SPRINT 周末</span></span>}
        </div>
        <div className="mt-3"><PulseLine state={live ? "upcoming" : "ambient"} /></div>
      </header>
      <ol className="divide-y rule">
        {weekend.sessions.map((session) => (
          <li key={session.id}>
            <Link href={sessionHref(session.id, roomId)} className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:bg-[rgb(255_59_32/5%)]">
              <div>
                <p className="font-bold">{SESSION_KIND_LABELS[session.kind]}</p>
                <time dateTime={session.startsAt} className="tabular mt-0.5 block text-xs text-[var(--muted)]">
                  {new Date(session.startsAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </time>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${stateChipClass(session)}`}>{stateChipLabel(session)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </article>
  );
}
