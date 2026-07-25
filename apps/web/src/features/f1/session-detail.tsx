"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { PulseLine } from "@/components/pulse";
import { PulseCircuit } from "@/components/pulse-circuit";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { F1PredictionSlip } from "./prediction-slip";
import { F1ResultsTable } from "./results-table";
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
  const [roomActive, setRoomActive] = useState(true);
  const [roomSportOk, setRoomSportOk] = useState(true);

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
        const result = await response.json().catch(() => ({})) as ApiEnvelope<{ tier?: string; status?: string; sport?: string }> & ApiFailure;
        if (!response.ok) return;
        setRoomActive(result.data?.status === undefined || result.data.status === "ACTIVE");
        setRoomSportOk(result.data?.sport === undefined || result.data.sport === "FORMULA_1");
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
      <header className="pulse-session-hero">
        <div className="pulse-session-hero__grid">
          <div className="pulse-session-hero__copy">
            <p className="pd-eyebrow pd-enter"><span>ROUND {String(weekend.round).padStart(2, "0")} · {weekend.season}</span></p>
            <p className="pulse-session-hero__index pd-enter pd-enter--1">RACE CONTROL / SESSION {session.kind}</p>
            <h2 className="kinetic pd-enter pd-enter--1 mt-3 text-[clamp(3rem,8vw,6rem)]">{weekend.name}</h2>
            <div className="pd-enter pd-enter--2 mt-5 flex flex-wrap items-center gap-3 text-sm">
              <span className="pd-tag"><span>{SESSION_KIND_LABELS[session.kind]}</span></span>
              <time dateTime={session.startsAt} className="tabular">{new Date(session.startsAt).toLocaleString("zh-CN")}</time>
              <span className={`pulse-session-hero__state ${predictable ? "is-open" : ""}`}><i />{session.state === "UPCOMING" && !predictable ? "待封盘" : SESSION_STATE_LABELS[session.state]}</span>
            </div>
            <div className="pd-enter pd-enter--3 mt-6"><PulseLine state={session.state === "FINISHED" ? "settled" : session.state === "LOCKED" ? "locked" : predictable ? "upcoming" : "ambient"} /></div>
          </div>
          <div className="pulse-session-hero__track pd-enter pd-enter--2"><PulseCircuit circuitKey={weekend.circuitKey} /><div className="pulse-session-hero__track-meta"><span>{weekend.circuitKey.replaceAll("-", " ").toUpperCase()}</span><span className="pd-num">{markets.length} MARKET{markets.length === 1 ? "" : "S"}</span></div></div>
        </div>
        <p className="pulse-session-hero__note pd-enter pd-enter--4">预测在场次开始（排位 Q1 / 正赛熄灯）时封盘；结果由管理员依据官方成绩录入并确认后自动结算。</p>
      </header>

      {detail.result
        ? <F1ResultsTable kind={session.kind} result={detail.result} driverIndex={driverIndex} />
        : session.state === "FINISHED" || session.state === "CANCELLED"
          ? <DataStatePanel state="empty" title={session.state === "CANCELLED" ? "本场次已取消" : "官方结果待录入"}
              description={session.state === "CANCELLED"
                ? "该场次已取消，相关判断按规则退还积分。"
                : session.kind === "SPRINT_QUALIFYING"
                  ? "冲刺排位的完整分类不在当前官方数据源（Ergast/Jolpica）覆盖范围内，我们不会用推算数据顶替官方结果。"
                  : "场次已结束，官方结果确认后会在这里展示完整完赛名次。"} />
          : roomId && !roomSportOk
            ? <div className="grid gap-4"><DataStatePanel state="empty" title="当前房间是足球竞猜房" description="该房间只围绕足球竞猜，不能在这里提交 F1 判断；请切换到 F1 房间后再打开本场次。" /><ReadOnlyMarkets detail={detail} driverIndex={driverIndex} /></div>
          : roomId
            ? <F1PredictionSlip roomId={roomId} detail={detail} interactive={roomActive} onRefresh={() => load().catch(() => {})} />
            : <ReadOnlyMarkets detail={detail} driverIndex={driverIndex} />}

      <TimingTower drivers={drivers} />

      {!roomId && !detail.result && session.state !== "FINISHED" && session.state !== "CANCELLED" && markets.length > 0 && (
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
    <section aria-label="市场与倍率" className="pulse-market-stack">
      {primary && (
        <article className="pulse-market-panel pulse-market-panel--primary" data-pulse-reveal>
          <header><div><p className="pd-eyebrow">SECTOR 01 / MARKET SNAPSHOT</p><h3 className="kinetic text-3xl">{MARKET_KIND_LABELS[primary.kind]}</h3></div><p className="pulse-market-version">VERSION <span className="tabular">{primary.version}</span></p></header>
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {primary.outcomes.map((outcome) => {
              const code = /^DRV:(.+)$/.exec(outcome.selection)?.[1] ?? outcome.selection;
              const driver = driverIndex.get(code);
              return <li key={outcome.selection} className="pulse-market-outcome">
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
      {others.map((market, marketIndex) => (
        <details key={market.id} className="pulse-market-panel" data-pulse-reveal style={{ "--pulse-reveal-delay": `${Math.min(marketIndex, 4) * 90}ms` } as React.CSSProperties}>
          <summary className="kinetic cursor-pointer text-2xl">{MARKET_KIND_LABELS[market.kind]} <span className="pulse-market-count">{market.outcomes.length} 个选项</span></summary>
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
    <section aria-label="车手榜" className="pulse-timing-tower" data-pulse-reveal>
      <header className="pulse-timing-tower__head">
        <div><p className="pd-eyebrow">SECTOR 02 / TIMING TOWER</p><h3 className="kinetic text-3xl">车手榜</h3></div>
        <p className="text-xs text-[var(--muted)]">按赛季积分排序 · 车队对决倍率由积分公式生成</p>
      </header>
      <ol>
        {drivers.map((driver, index) => (
          <li key={driver.code} className="pulse-timing-row" style={{ "--pulse-row-delay": `${Math.min(index, 14) * 45}ms` } as React.CSSProperties}>
            <span className="pulse-timing-row__pos tabular">{String(index + 1).padStart(2, "0")}</span>
            <i aria-hidden className="pulse-timing-row__stripe" style={{ background: driver.color }} />
            <span className="pulse-timing-row__number tabular">{driver.number}</span>
            <span className="pulse-timing-row__driver">
              <Link href={`/matches/f1/drivers/${driver.code}`} className="block truncate font-bold hover:underline">{driver.name}</Link>
              <Link href={`/matches/f1/teams/${driver.constructorKey}`} className="block truncate text-[10px] uppercase text-[var(--muted)] hover:underline">{driver.constructorName}</Link>
            </span>
            <span className="pulse-timing-row__points tabular">{driver.seasonPoints}<small>PTS</small></span>
          </li>
        ))}
      </ol>
    </section>
  );
}
