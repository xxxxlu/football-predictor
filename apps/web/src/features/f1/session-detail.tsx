"use client";

import { useCallback, useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { PulseLine } from "@/components/pulse";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { F1PredictionSlip } from "./prediction-slip";
import {
  MARKET_KIND_LABELS,
  normalizeSessionDetail,
  SESSION_KIND_LABELS,
  SESSION_STATE_LABELS,
  sessionPredictable,
  type F1DriverView,
  type F1SessionDetailView,
} from "./types";

export function F1SessionDetail({ sessionId, roomId }: { sessionId: string; roomId?: string }) {
  const [detail, setDetail] = useState<F1SessionDetailView | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [roomTier, setRoomTier] = useState<"STANDARD" | "ADVANCED">("STANDARD");
  const [roomActive, setRoomActive] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/v1/f1/sessions/${encodeURIComponent(sessionId)}`, { credentials: "same-origin", signal, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as ApiEnvelope<unknown> & ApiFailure;
    if (response.status === 404) { setNotFound(true); return null; }
    if (!response.ok) throw new Error(result.error?.message || "F1 场次数据暂不可用");
    const normalized = normalizeSessionDetail(result.data);
    if (!normalized) throw new Error("F1 场次数据格式异常");
    setDetail(normalized);
    setError("");
    return normalized;
  }, [sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        await load(controller.signal);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "F1 场次数据暂不可用");
      }
    })();
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}`, { credentials: "same-origin", signal: controller.signal });
        const result = await response.json().catch(() => ({})) as ApiEnvelope<{ tier?: string; status?: string }> & ApiFailure;
        if (!response.ok) return;
        setRoomTier(result.data?.tier === "ADVANCED" ? "ADVANCED" : "STANDARD");
        setRoomActive(result.data?.status === undefined || result.data.status === "ACTIVE");
      } catch { /* 房间信息拉不到时按标准房处理，服务端仍会复核 */ }
    })();
    return () => controller.abort();
  }, [roomId]);

  if (notFound) return <DataStatePanel state="empty" title="没有找到这个 F1 场次" description="它可能已被移除，请回到 F1 赛程重新选择。" />;
  if (error) return <DataStatePanel state="error" title="F1 场次暂不可用" description={error} />;
  if (!detail) return <DataStatePanel state="loading" title="正在加载 F1 场次" description="正在读取场次、车手与积分倍率。" />;

  const { session, weekend, drivers, markets } = detail;
  const predictable = sessionPredictable(session);
  const driverIndex = new Map(drivers.map((driver) => [driver.code, driver]));

  return (
    <div className="grid gap-8">
      <header className="surface overflow-hidden">
        <div className="bg-[var(--pulse-carbon)] p-5 text-[var(--pulse-ivory)] sm:p-6">
          <p className="pd-eyebrow text-[var(--pulse-ivory)]">ROUND {String(weekend.round).padStart(2, "0")} · {weekend.season}{weekend.isSprintWeekend ? " · SPRINT 周末" : ""}</p>
          <h2 className="display mt-2 text-3xl font-black uppercase sm:text-4xl">{weekend.name}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="pd-tag"><span>{SESSION_KIND_LABELS[session.kind]}</span></span>
            <time dateTime={session.startsAt} className="tabular">{new Date(session.startsAt).toLocaleString("zh-CN")}</time>
            <span className={`rounded-full px-3 py-1 text-xs font-black ${predictable ? "bg-[var(--pulse-red-deep)] text-white" : "bg-[rgb(244_241_232/14%)] text-[var(--pulse-ivory)]"}`}>
              {session.state === "UPCOMING" && !predictable ? "待封盘" : SESSION_STATE_LABELS[session.state]}
            </span>
          </div>
          <div className="mt-4"><PulseLine state={session.state === "FINISHED" ? "settled" : session.state === "LOCKED" ? "locked" : predictable ? "upcoming" : "ambient"} /></div>
        </div>
        <p className="p-4 text-xs leading-5 text-[var(--muted)]">预测在场次开始（排位 Q1 / 正赛熄灯）时封盘；结果由管理员依据官方成绩录入并确认后自动结算。</p>
      </header>

      {roomId
        ? <F1PredictionSlip roomId={roomId} detail={detail} advanced={roomTier === "ADVANCED"} interactive={roomActive} onRefresh={() => load().catch(() => {})} />
        : <ReadOnlyMarkets detail={detail} driverIndex={driverIndex} />}

      <TimingTower drivers={drivers} />

      {!roomId && markets.length > 0 && (
        <p className="text-xs leading-5 text-[var(--muted)]">想提交判断？进入你的房间，从房间里的 F1 赛程打开本场次即可投入该房间的积分。</p>
      )}
    </div>
  );
}

function ReadOnlyMarkets({ detail, driverIndex }: { detail: F1SessionDetailView; driverIndex: Map<string, F1DriverView> }) {
  const primary = detail.markets.find((market) => market.kind === "WINNER") ?? detail.markets.find((market) => market.kind === "POLE");
  const others = detail.markets.filter((market) => market !== primary && market.kind !== "EXACT_PODIUM");
  if (!detail.markets.length) {
    return <DataStatePanel state="empty" title="本场次还没有开放市场" description="管理员发布积分倍率后，市场会出现在这里。" />;
  }
  return (
    <section aria-label="市场与倍率" className="grid gap-4">
      {primary && (
        <article className="surface p-4 sm:p-5">
          <h3 className="display text-xl font-bold">{MARKET_KIND_LABELS[primary.kind]}倍率</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">倍率版本 <span className="tabular">{primary.version}</span></p>
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {primary.outcomes.map((outcome) => {
              const code = /^DRV:(.+)$/.exec(outcome.selection)?.[1] ?? outcome.selection;
              const driver = driverIndex.get(code);
              return <li key={outcome.selection} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] px-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <i aria-hidden className="h-4 w-1 shrink-0 rounded-sm" style={{ background: driver?.color ?? "var(--muted)" }} />
                  <span className="truncate text-sm font-bold">{code}</span>
                </span>
                <span className="tabular text-sm font-black">{outcome.decimalOdds}</span>
              </li>;
            })}
          </ul>
        </article>
      )}
      {others.map((market) => (
        <details key={market.id} className="surface p-4 sm:p-5">
          <summary className="display cursor-pointer text-lg font-bold">{MARKET_KIND_LABELS[market.kind]}（{market.outcomes.length} 个选项）</summary>
          <ul className="mt-3 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {market.outcomes.map((outcome) => (
              <li key={outcome.selection} className="flex items-center justify-between gap-2 border-b rule py-1.5 last:border-0">
                <span className="truncate">{outcomeLabel(outcome.selection)}</span>
                <span className="tabular font-bold">{outcome.decimalOdds}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}

function outcomeLabel(selection: string): string {
  const podium = /^PODIUM:(.+):(YES|NO)$/.exec(selection);
  if (podium) return `${podium[1]} ${podium[2] === "YES" ? "登领奖台" : "无缘领奖台"}`;
  const duel = /^H2H:(.+)>(.+)$/.exec(selection);
  if (duel) return `${duel[1]} 先于 ${duel[2]}`;
  const exact = /^POD3:(.+)-(.+)-(.+)$/.exec(selection);
  if (exact) return `${exact[1]} → ${exact[2]} → ${exact[3]}`;
  return selection.replace(/^DRV:/, "");
}

function TimingTower({ drivers }: { drivers: F1DriverView[] }) {
  if (!drivers.length) return null;
  return (
    <section aria-label="车手榜" className="surface overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 border-b rule p-4">
        <h3 className="display text-xl font-bold">车手榜</h3>
        <p className="text-xs text-[var(--muted)]">按赛季积分排序 · 车队对决倍率由积分公式生成</p>
      </header>
      <ol>
        {drivers.map((driver, index) => (
          <li key={driver.code} className="flex items-center gap-3 border-b rule px-4 py-2.5 last:border-0">
            <span className="tabular w-6 shrink-0 text-right text-sm font-black text-[var(--muted)]">{index + 1}</span>
            <i aria-hidden className="h-6 w-1 shrink-0 rounded-sm" style={{ background: driver.color }} />
            <span className="tabular w-8 shrink-0 text-sm font-black">{driver.number}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{driver.name}</span>
              <span className="block truncate text-[10px] uppercase text-[var(--muted)]">{driver.constructorName}</span>
            </span>
            <span className="tabular shrink-0 text-sm font-black">{driver.seasonPoints}<span className="ml-1 text-[10px] font-normal text-[var(--muted)]">分</span></span>
          </li>
        ))}
      </ol>
    </section>
  );
}
