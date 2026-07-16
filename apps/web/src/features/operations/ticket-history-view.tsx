"use client";

import { useEffect, useMemo, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import type { ApiEnvelope, ApiFailure, OddsSelection } from "@/features/matchday/types";
import { competitionFilterOptions, filterHistoryRecords, type CrossCompetitionRecord, type SettlementOutcome } from "./history-presentation";

type HistoryArchive = {
  scope: { performance: "USER_CROSS_COMPETITION"; balances: "PER_ROOM" };
  summary: { settledTickets: number; wins: number; losses: number; voids: number };
  competitions: Array<{ competitionId: string; competitionName: string; season: number; settledTickets: number; wins: number; losses: number; voids: number }>;
  records: CrossCompetitionRecord[];
};

const selectionLabel: Record<OddsSelection, string> = { HOME: "主胜", DRAW: "平局", AWAY: "客胜" };
const outcomeLabel: Record<SettlementOutcome, string> = { WIN: "命中", LOSS: "未命中", PUSH: "走盘", CANCEL: "取消退款" };

export function TicketHistoryView() {
  const [archive, setArchive] = useState<HistoryArchive | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const options = useMemo(() => competitionFilterOptions(archive?.records ?? []), [archive]);
  const records = useMemo(() => filterHistoryRecords(archive?.records ?? [], filter), [archive, filter]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/v1/account/history", { credentials: "same-origin", signal: controller.signal });
        const result = await response.json().catch(() => ({})) as ApiEnvelope<HistoryArchive> & ApiFailure;
        if (!response.ok || !result.data) throw new Error(result.error?.message || "无法加载长期档案");
        setArchive(result.data);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载长期档案");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  if (loading) return <DataStatePanel state="loading" title="正在加载长期档案" description="正在汇总已结算判断。"/>;
  if (error) return <DataStatePanel state="error" title="长期档案暂不可用" description={error}/>;
  if (!archive?.records.length) return <DataStatePanel state="empty" title="还没有已结算记录" description="这里只汇总已经结算的判断。刚提交、还没开赛的判断请到对应房间页面的「我的判断记录」查看；比赛结算后会自动出现在这里。"/>;

  return <div>
    <section aria-label="长期表现摘要" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Metric label="已结算" value={String(archive.summary.settledTickets)}/>
      <Metric label="命中" value={String(archive.summary.wins)}/>
      <Metric label="未命中" value={String(archive.summary.losses)}/>
      <Metric label="走盘 / 取消" value={String(archive.summary.voids)}/>
    </section>
    <p className="mt-4 rounded-xl border-l-4 border-[var(--field)] bg-white/45 p-4 text-sm text-[var(--muted)]">
      长期档案跨房间汇总的只有已结算判断次数。每个房间的可用、冻结和更正债务始终独立核算，不会在这里合并成余额。
    </p>
    <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
      <label className="text-sm font-bold">赛事与赛季
        <select value={filter} onChange={(event) => setFilter(event.target.value)} className="mt-2 block min-w-64 rounded-lg border border-[var(--ink)] bg-[var(--paper-raised)] px-3 py-2 font-normal">
          <option value="">全部赛事</option>
          {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>
      <p className="text-xs text-[var(--muted)]">显示 {records.length} / {archive.records.length} 条</p>
    </div>
    <ol className="mt-6 space-y-4">{records.map((record) => <HistoryRecord key={record.ticketId} record={record}/>)}</ol>
  </div>;
}

function HistoryRecord({ record }: { record: CrossCompetitionRecord }) {
  return <li className="surface p-4 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold text-[var(--field)]">{record.competition.name} · {record.competition.season}</p>
        <h2 className="display mt-1 text-xl font-bold">{record.fixture.homeTeam} <span className="text-sm font-normal text-[var(--muted)]">对</span> {record.fixture.awayTeam}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">房间：{record.room.name} · 结算于 <time dateTime={record.settlement.settledAt}>{new Date(record.settlement.settledAt).toLocaleString("zh-CN")}</time></p>
      </div>
      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${record.settlement.outcome === "WIN" ? "bg-[var(--field)] text-white" : record.settlement.outcome === "LOSS" ? "bg-[var(--coral)] text-white" : "bg-[rgb(23_35_59/8%)] text-[var(--muted)]"}`}>{outcomeLabel[record.settlement.outcome]}</span>
    </header>
    <dl className="mt-4 grid grid-cols-2 gap-3 border-t rule pt-4 sm:grid-cols-4">
      <Fact label="选择" value={selectionLabel[record.selection]}/>
      <Fact label="投入" value={record.stakePoints}/>
      <Fact label="最终返还" value={record.settlement.grossReturnPoints}/>
      <div className="min-w-0">
        <dt className="text-[10px] text-[var(--muted)]">结算版本</dt>
        <dd className="tabular mt-1 truncate font-bold" title={record.settlement.version}>{record.settlement.version}</dd>
      </div>
    </dl>
    <details className="mt-4 text-xs text-[var(--muted)]"><summary className="cursor-pointer font-bold">审计追溯</summary><p className="tabular mt-2 break-all">结算版本 {record.settlement.version}</p><p className="tabular mt-1 break-all">票号 {record.ticketId}</p><p className="tabular mt-1 break-all">账本 {record.settlement.ledgerId}</p><p className="tabular mt-1 break-all">审计 {record.settlement.auditId}</p></details>
  </li>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="surface p-4"><p className="text-xs text-[var(--muted)]">{label}</p><p className="tabular mt-1 text-2xl font-bold">{value}</p></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-[10px] text-[var(--muted)]">{label}</dt><dd className="tabular mt-1 font-bold">{value}</dd></div>; }
