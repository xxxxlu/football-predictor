"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { F1PredictionSlip } from "./prediction-slip";
import {
  normalizeSessionDetail,
  normalizeWeekend,
  upcomingSessionsOf,
  type F1SessionDetailView,
  type F1UpcomingSessionView,
  type F1WeekendView,
} from "./types";

/** In-room F1 arena: the nearest session's full prediction slip is embedded right
 *  here（免跳转）, and the rest of the calendar is listed as 未开始 by start time.
 *  "Nearest" = the soonest session that is still predictable. */
export function RoomF1Arena({ roomId, advanced, interactive }: {
  roomId: string;
  advanced: boolean;
  interactive: boolean;
}) {
  const [sessions, setSessions] = useState<F1UpcomingSessionView[] | null>(null);
  const [detail, setDetail] = useState<F1SessionDetailView | null>(null);
  const [detailError, setDetailError] = useState(false);

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
        setSessions(upcomingSessionsOf(weekends, Number.MAX_SAFE_INTEGER));
      } catch {
        if (!controller.signal.aborted) setSessions([]);
      }
    })();
    return () => controller.abort();
  }, []);

  const nearestId = sessions?.[0]?.id;

  const loadDetail = useCallback(async (signal?: AbortSignal) => {
    if (!nearestId) return;
    const response = await fetch(`/api/v1/f1/sessions/${encodeURIComponent(nearestId)}`, { credentials: "same-origin", signal, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as ApiEnvelope<unknown> & ApiFailure;
    if (!response.ok) { setDetailError(true); return; }
    const normalized = normalizeSessionDetail(result.data);
    if (!normalized) { setDetailError(true); return; }
    setDetail(normalized);
    setDetailError(false);
  }, [nearestId]);

  useEffect(() => {
    if (!nearestId) return;
    const controller = new AbortController();
    void (async () => {
      try { await loadDetail(controller.signal); }
      catch { if (!controller.signal.aborted) setDetailError(true); }
    })();
    return () => controller.abort();
  }, [nearestId, loadDetail]);

  if (sessions === null) return <p className="tabular mt-4 text-xs text-[var(--muted)]" aria-live="polite">正在读取最近场次…</p>;
  if (!sessions.length) return <div className="mt-4"><DataStatePanel state="empty" title="当前没有可预测的 F1 场次" description="新分站开放后，最近一场的竞猜会直接出现在这里。" /></div>;

  const [nearest, ...rest] = sessions;

  return (
    <div className="mt-4 grid gap-5">
      <div>
        <p className="pd-eyebrow"><span>NEXT SESSION · 本周竞猜</span></p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-bold"><span className="tabular text-xs text-[var(--muted)]">R{String(nearest.round).padStart(2, "0")}</span> {nearest.weekendName} · {nearest.kindLabel}</span>
          <time dateTime={nearest.startsAt} className="tabular text-xs text-[var(--muted)]">
            {new Date(nearest.startsAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 开赛封盘
          </time>
        </p>
      </div>

      {detail
        ? <F1PredictionSlip roomId={roomId} detail={detail} advanced={advanced} interactive={interactive} onRefresh={() => loadDetail().catch(() => {})} />
        : detailError
          ? <DataStatePanel state="error" title="最近场次暂不可用" description="场次数据加载失败；稍后刷新，或从下方列表打开具体场次。" />
          : <DataStatePanel state="loading" title="正在加载竞猜面板" description="正在读取场次、车手与积分倍率。" />}

      {rest.length > 0 && (
        <div>
          <p className="text-xs font-bold text-[var(--muted)]">后续场次（按时间未开始）</p>
          <ul className="mt-1 divide-y divide-[var(--line)]">
            {rest.map((session) => (
              <li key={session.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 text-sm">
                  <span className="tabular text-xs text-[var(--muted)]">R{String(session.round).padStart(2, "0")}</span> {session.weekendName} · {session.kindLabel}
                </span>
                <span className="flex items-center gap-3">
                  <time dateTime={session.startsAt} className="tabular text-xs text-[var(--muted)]">
                    {new Date(session.startsAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </time>
                  <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-bold text-[var(--muted)]">未开始</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--muted)]">轮到哪场，哪场的竞猜就会自动出现在上方；无需再跳转。<Link href={`/matches/f1?roomId=${encodeURIComponent(roomId)}`} className="ml-1 font-bold underline">查看完整赛程与历史 →</Link></p>
        </div>
      )}
    </div>
  );
}
