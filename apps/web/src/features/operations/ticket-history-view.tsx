"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { formatEventTitle, formatSelectionLabel } from "../matchday/selection-label";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { formatPoints, formatPointsDelta } from "@/lib/points";
import { VictoryShareModal } from "@/components/victory-card/victory-share-modal";
import type { VictoryCardData } from "@/components/victory-card/types";
import { competitionFilterOptions, filterHistoryRecords, seasonCover, type CrossCompetitionRecord, type SettlementOutcome } from "./history-presentation";

type HistoryArchive = {
  scope: { performance: "USER_CROSS_COMPETITION"; balances: "PER_ROOM" };
  summary: { settledTickets: number; wins: number; losses: number; voids: number };
  competitions: Array<{ competitionId: string; competitionName: string; season: number; settledTickets: number; wins: number; losses: number; voids: number }>;
  records: CrossCompetitionRecord[];
};

const outcomeLabel: Record<SettlementOutcome, string> = { WIN: "命中", LOSS: "未命中", PUSH: "走盘", CANCEL: "取消退款" };

export function TicketHistoryView() {
  const [archive, setArchive] = useState<HistoryArchive | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [shareData, setShareData] = useState<VictoryCardData | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
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

  function handleShareSeason(cover: ReturnType<typeof seasonCover>) {
    if (!archive) return;
    setShareData({
      kind: "SEASON",
      seasonLabel: cover.seasonLabel || "2026/27",
      netPoints: `${formatPointsDelta(cover.net)} PTS`,
      hitRate: cover.hitRate === null ? "—" : `${Math.round(cover.hitRate * 100)}%`,
      settledTickets: archive.summary.settledTickets,
      wins: archive.summary.wins,
      voids: archive.summary.voids,
      coveredTickets: cover.covered,
    });
    setShareOpen(true);
  }

  function handleShareRecord(record: CrossCompetitionRecord) {
    const net = Number(record.settlement.grossReturnPoints) - Number(record.stakePoints);
    const netLabel = net > 0 ? `+${formatPoints(net)} PTS` : `${formatPoints(net)} PTS`;
    const stakeNum = Number(record.stakePoints);
    const returnNum = Number(record.settlement.grossReturnPoints);
    const oddsLabel = stakeNum > 0 && returnNum > 0 ? (returnNum / stakeNum).toFixed(2) : "—";

    setShareData({
      kind: "MATCH",
      competition: `${record.competition.name} · ${record.competition.season}`,
      homeTeam: record.fixture.homeTeam,
      awayTeam: record.fixture.awayTeam,
      kickoffAt: record.fixture.kickoffAt || record.settlement.settledAt,
      settledAt: record.settlement.settledAt,
      selection: formatSelectionLabel(record.selection),
      odds: oddsLabel,
      stakePoints: `${formatPoints(record.stakePoints)} PTS`,
      grossReturnPoints: `${formatPoints(record.settlement.grossReturnPoints)} PTS`,
      netPoints: netLabel,
      outcome: record.settlement.outcome === "WIN" ? "WIN" : record.settlement.outcome === "PUSH" ? "PUSH" : "LOSS",
      ticketId: record.ticketId,
      roomName: record.room.name,
      auditId: record.settlement.auditId,
    });
    setShareOpen(true);
  }

  if (loading) return <DataStatePanel state="loading" title="正在加载长期档案" description="正在汇总已结算判断。"/>;
  if (error) return <DataStatePanel state="error" title="长期档案暂不可用" description={error}/>;
  if (!archive?.records.length) return <DataStatePanel state="empty" title="还没有已结算记录" description="这里只汇总已经结算的判断。刚提交、还没开赛的判断请到对应房间页面的「我的判断记录」查看；比赛结算后会自动出现在这里。"/>;

  return <div>
    <SeasonCover archive={archive} onShare={handleShareSeason}/>
    <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
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
    <ol className="mt-6 space-y-4">{records.map((record) => <HistoryRecord key={record.ticketId} record={record} onShare={() => handleShareRecord(record)}/>)}</ol>
    <VictoryShareModal data={shareData} isOpen={shareOpen} onClose={() => setShareOpen(false)} />
  </div>;
}

/* §15.1 的年度赛季卡。此前这里是四个等宽小方块（已结算 / 命中 / 未命中 / 走盘），
   四个数字同样大小、没有主次，读者要自己算命中率。改成一张封面：净积分做主角，
   字号是标签的 10 倍以上，命中率用真实数据画成红条，其余降级为脚注。 */
function SeasonCover({ archive, onShare }: { archive: HistoryArchive; onShare: (cover: ReturnType<typeof seasonCover>) => void }) {
  const cover = seasonCover(archive.summary, archive.records);
  const hitRate = cover.hitRate === null ? "—" : `${Math.round(cover.hitRate * 100)}%`;
  return <section className="pulse-season" aria-label="长期表现摘要">
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="pd-page-lead__index">{cover.seasonLabel ? `${cover.seasonLabel} SEASON` : "SEASON"}</p>
        <button
          type="button"
          onClick={() => onShare(cover)}
          className="pressable-btn inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white transition hover:bg-white/25"
        >
          <span>🏆</span>
          <span>生成战绩海报</span>
        </button>
      </div>
      <strong className="pulse-season__net mt-3">{formatPointsDelta(cover.net)}<span className="pulse-season__unit">PTS</span></strong>
      <p className="mt-3 text-xs leading-5 text-[color:rgb(244_241_232_/_60%)]">
        {cover.truncated ? `净积分覆盖最近 ${cover.covered} 笔结算，共 ${archive.summary.settledTickets} 笔` : `覆盖全部 ${cover.covered} 笔已结算判断`}
      </p>
    </div>
    <div>
      <dl className="pulse-season__facts">
        <div className="pulse-season__fact"><dt>已结算</dt><dd>{archive.summary.settledTickets}</dd></div>
        <div className="pulse-season__fact"><dt>命中率</dt><dd>{hitRate}</dd></div>
        <div className="pulse-season__fact"><dt>走盘 / 取消</dt><dd>{archive.summary.voids}</dd></div>
      </dl>
      <div className="pulse-season__meter" style={{ "--pulse-hit-rate": cover.hitRate ?? 0 } as CSSProperties} aria-hidden="true"><i/></div>
      <p className="mt-2 text-[0.68rem] leading-5 text-[color:rgb(244_241_232_/_55%)]">
        {cover.decided > 0 ? `${archive.summary.wins} 命中 / ${cover.decided} 有结果` : "还没有分出结果的判断"}
      </p>
    </div>
  </section>;
}

function HistoryRecord({ record, onShare }: { record: CrossCompetitionRecord; onShare: () => void }) {
  return <li className="surface p-4 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold text-[var(--field)]">{record.competition.name} · {record.competition.season}</p>
        <h2 className="display mt-1 text-xl font-bold">{record.fixture.id.startsWith("f1:") ? formatEventTitle({ matchId: record.fixture.id, homeTeam: record.fixture.homeTeam, awayTeam: record.fixture.awayTeam }) : <>{record.fixture.homeTeam} <span className="text-sm font-normal text-[var(--muted)]">对</span> {record.fixture.awayTeam}</>}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">房间：{record.room.name} · 结算于 <time dateTime={record.settlement.settledAt}>{new Date(record.settlement.settledAt).toLocaleString("zh-CN")}</time></p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${record.settlement.outcome === "WIN" ? "bg-[var(--field)] text-white" : record.settlement.outcome === "LOSS" ? "bg-[var(--coral)] text-white" : "bg-[var(--wash-neutral)] text-[var(--muted)]"}`}>{outcomeLabel[record.settlement.outcome]}</span>
        <button
          type="button"
          onClick={onShare}
          aria-label="生成战报海报"
          className="pressable-btn inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--wash-neutral-soft)] px-2.5 py-1 text-xs font-bold text-[var(--ink)] hover:border-[var(--field)]"
        >
          <span>↗</span>
          <span className="hidden sm:inline">战报海报</span>
        </button>
      </div>
    </header>
    <dl className="mt-4 grid grid-cols-2 gap-3 border-t rule pt-4 sm:grid-cols-4">
      <Fact label="选择" value={formatSelectionLabel(record.selection)}/>
      <Fact label="投入" value={formatPoints(record.stakePoints)}/>
      <Fact label="最终返还" value={formatPoints(record.settlement.grossReturnPoints)}/>
      <div className="min-w-0">
        <dt className="text-[10px] text-[var(--muted)]">结算版本</dt>
        <dd className="tabular mt-1 truncate font-bold" title={record.settlement.version}>{record.settlement.version}</dd>
      </div>
    </dl>
    <details className="mt-4 text-xs text-[var(--muted)]"><summary className="cursor-pointer font-bold">审计追溯</summary><p className="tabular mt-2 break-all">结算版本 {record.settlement.version}</p><p className="tabular mt-1 break-all">票号 {record.ticketId}</p><p className="tabular mt-1 break-all">账本 {record.settlement.ledgerId}</p><p className="tabular mt-1 break-all">审计 {record.settlement.auditId}</p></details>
  </li>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-[10px] text-[var(--muted)]">{label}</dt><dd className="tabular mt-1 text-lg font-bold">{value}</dd></div>; }
