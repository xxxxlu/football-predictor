"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { normalizeWeekend, upcomingSessionsOf, type F1UpcomingSessionView, type F1WeekendView } from "./types";

/** Compact in-room list of the next predictable F1 sessions, linking straight
 *  into the session page scoped to this room's points. */
export function RoomF1Upcoming({ roomId }: { roomId: string }) {
  const [sessions, setSessions] = useState<F1UpcomingSessionView[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/f1/weekends", { credentials: "same-origin", signal: controller.signal, cache: "no-store" });
        const result = await response.json().catch(() => ({})) as ApiEnvelope<unknown[]> & ApiFailure;
        if (!response.ok) { setSessions([]); return; }
        const weekends = Array.isArray(result.data)
          ? result.data.map(normalizeWeekend).filter((weekend): weekend is F1WeekendView => weekend !== null)
          : [];
        setSessions(upcomingSessionsOf(weekends, 3));
      } catch {
        setSessions([]);
      }
    })();
    return () => controller.abort();
  }, []);

  if (sessions === null) return <p className="tabular w-full text-xs text-[var(--muted)]" aria-live="polite">正在读取最近场次…</p>;
  if (!sessions.length) return <p className="w-full text-xs text-[var(--muted)]">当前没有可预测的 F1 场次；新分站开放后会出现在这里。</p>;

  return (
    <ul className="w-full divide-y divide-[var(--line)]">
      {sessions.map((session) => (
        <li key={session.id}>
          <Link href={`/matches/f1/${session.id}?roomId=${encodeURIComponent(roomId)}`}
            className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2 no-underline hover:underline">
            <span className="min-w-0 font-bold">
              <span className="tabular text-xs text-[var(--muted)]">R{String(session.round).padStart(2, "0")}</span> {session.weekendName} · {session.kindLabel}
            </span>
            <time dateTime={session.startsAt} className="tabular text-xs text-[var(--muted)]">
              {new Date(session.startsAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}
