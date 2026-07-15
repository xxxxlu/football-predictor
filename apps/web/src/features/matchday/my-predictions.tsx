"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import type { ApiEnvelope, ApiFailure, OddsSelection } from "./types";

type TicketStatus = "FROZEN" | "WON" | "LOST" | "VOID";
type SettlementOutcome = "WIN" | "LOSS" | "PUSH" | "CANCEL";

type TicketRecord = {
  ticketId: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  submittedAt: string;
  owner: { userId: string; displayName: string; isCurrentUser: boolean };
  visibility: "REVEALED" | "PRIVATE";
  selection?: OddsSelection;
  stakePoints?: string;
  confirmedOdds?: string;
  status: TicketStatus;
  outcome: SettlementOutcome | null;
  returnPoints: string | null;
  netPoints: string | null;
  settlementVersion: string | null;
};

const selectionLabel: Record<OddsSelection, string> = { HOME: "主胜", DRAW: "平局", AWAY: "客胜" };
const statusLabel: Record<TicketStatus, string> = { FROZEN: "待结算", WON: "命中", LOST: "未命中", VOID: "走盘 / 取消" };

function statusChipClass(status: TicketStatus): string {
  if (status === "WON") return "bg-[var(--field)] text-white";
  if (status === "LOST") return "bg-[var(--coral)] text-white";
  if (status === "VOID") return "bg-[rgb(23_35_59/8%)] text-[var(--muted)]";
  return "bg-[rgb(23_107_77/10%)] text-[var(--field-dark)]"; // FROZEN / 待结算
}

function projectedReturn(stakePoints?: string, confirmedOdds?: string): string | null {
  const stake = Number(stakePoints), odds = Number(confirmedOdds);
  if (!Number.isFinite(stake) || !Number.isFinite(odds) || !stake || !odds) return null;
  return (stake * odds).toFixed(2);
}

export function MyPredictions({ roomId }: { roomId: string }) {
  const [records, setRecords] = useState<TicketRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    return fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/tickets/history`, { credentials: "same-origin", signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as ApiEnvelope<TicketRecord[]> & ApiFailure;
        if (!response.ok || !Array.isArray(result.data)) throw new Error(result.error?.message || "无法加载判断记录");
        setRecords(result.data.filter((record) => record.owner.isCurrentUser));
      })
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message || "无法加载判断记录"); })
      .finally(() => setLoading(false));
  }, [roomId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => { await load(controller.signal); })();
    return () => controller.abort();
  }, [load]);

  const summary = useMemo(() => {
    const list = records ?? [];
    return { total: list.length, pending: list.filter((r) => r.status === "FROZEN").length, settled: list.filter((r) => r.status !== "FROZEN").length };
  }, [records]);

  return (
    <section aria-label="我的判断记录">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display text-xl font-bold">我的判断记录</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">本房间你提交的全部判断，包含未开赛的待结算判断。</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-bold transition hover:border-[var(--field)] hover:text-[var(--field)] disabled:opacity-45"
        >{loading ? "刷新中…" : "刷新"}</button>
      </div>

      {loading && !records ? (
        <DataStatePanel state="loading" title="正在加载判断记录" description="正在汇总本房间你提交的判断。" />
      ) : error ? (
        <DataStatePanel state="error" title="判断记录暂不可用" description={error} />
      ) : !records?.length ? (
        <DataStatePanel state="empty" title="还没有判断记录" description="在上方比赛列表选择主/平/客并投入积分后，你的判断会立即出现在这里（开赛前也可查看）。" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Metric label="全部" value={String(summary.total)} />
            <Metric label="待结算" value={String(summary.pending)} />
            <Metric label="已结算" value={String(summary.settled)} />
          </div>
          <ol className="space-y-4">{records.map((record) => <PredictionRow key={record.ticketId} record={record} />)}</ol>
        </>
      )}
    </section>
  );
}

function PredictionRow({ record }: { record: TicketRecord }) {
  const projected = record.status === "FROZEN" ? projectedReturn(record.stakePoints, record.confirmedOdds) : null;
  return (
    <li className="surface p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="display text-lg font-bold">{record.homeTeam} <span className="text-sm font-normal text-[var(--muted)]">对</span> {record.awayTeam}</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">开赛 <time dateTime={record.kickoffAt}>{new Date(record.kickoffAt).toLocaleString("zh-CN")}</time> · 提交于 <time dateTime={record.submittedAt}>{new Date(record.submittedAt).toLocaleString("zh-CN")}</time></p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${statusChipClass(record.status)}`}>{statusLabel[record.status]}</span>
      </header>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t rule pt-4 sm:grid-cols-4">
        <Fact label="选择" value={record.selection ? selectionLabel[record.selection] : "—"} />
        <Fact label="投入" value={record.stakePoints ?? "—"} />
        <Fact label="确认倍率" value={record.confirmedOdds ?? "—"} />
        {record.status === "FROZEN"
          ? <Fact label="预计返还" value={projected ?? "—"} />
          : <Fact label="最终返还" value={record.returnPoints ?? "—"} />}
      </dl>
      {record.status !== "FROZEN" && (record.netPoints !== null || record.settlementVersion) && (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
          {record.netPoints !== null && <span>净积分 <strong className="tabular text-[var(--ink)]">{record.netPoints}</strong></span>}
          {record.settlementVersion && <span className="tabular">结算版本 {record.settlementVersion}</span>}
        </p>
      )}
      <details className="mt-3 text-xs text-[var(--muted)]"><summary className="cursor-pointer font-bold">审计追溯</summary><p className="tabular mt-2 break-all">票号 {record.ticketId}</p></details>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="surface p-3 text-center"><p className="text-xs text-[var(--muted)]">{label}</p><p className="tabular mt-1 text-xl font-bold">{value}</p></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-[10px] text-[var(--muted)]">{label}</dt><dd className="tabular mt-1 font-bold">{value}</dd></div>; }
