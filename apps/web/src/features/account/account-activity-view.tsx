"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { RoomFilter } from "@/components/room-filter";
import type { ApiEnvelope, ApiFailure, BalanceView, OddsSelection } from "@/features/matchday/types";
import { useRoomData } from "@/features/operations/use-room-data";
import { accountTicketSummary, ownTickets, signedPoints, type AccountTicket } from "./account-activity";

type LedgerEntry = {
  id: string; type: "FREEZE" | "SETTLE" | "VOID" | "REVERSAL" | "RE_SETTLE" | "DEBT_OFFSET" | "GRANT";
  createdAt: string; availableDelta: string; frozenDelta: string; debtDelta?: string; explanation: string;
};

const selectionLabel: Record<OddsSelection, string> = { HOME: "主胜", DRAW: "平局", AWAY: "客胜" };
const ticketLabel: Record<AccountTicket["status"], string> = { FROZEN: "待结算", WON: "已命中", LOST: "未命中", VOID: "已退回" };
const ledgerLabel: Record<LedgerEntry["type"], string> = { FREEZE: "预测投入", SETTLE: "赛果结算", VOID: "退回积分", REVERSAL: "结算冲正", RE_SETTLE: "重新结算", DEBT_OFFSET: "债务抵扣", GRANT: "积分发放" };

export function AccountActivityView() {
  const room = useRoomData();
  const [balance, setBalance] = useState<BalanceView>();
  const [tickets, setTickets] = useState<AccountTicket[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const summary = useMemo(() => accountTicketSummary(tickets), [tickets]);

  useEffect(() => {
    if (!room.roomId) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true); setError("");
      try {
        const base = `/api/v1/rooms/${encodeURIComponent(room.roomId)}`;
        const [balanceResponse, ticketsResponse, ledgerResponse] = await Promise.all([
          fetch(`${base}/balance`, { credentials: "same-origin", signal: controller.signal }),
          fetch(`${base}/tickets/history`, { credentials: "same-origin", signal: controller.signal }),
          fetch(`${base}/ledger`, { credentials: "same-origin", signal: controller.signal }),
        ]);
        const [balanceResult, ticketsResult, ledgerResult] = await Promise.all([
          balanceResponse.json().catch(() => ({})), ticketsResponse.json().catch(() => ({})), ledgerResponse.json().catch(() => ({})),
        ]) as [ApiEnvelope<BalanceView> & ApiFailure, ApiEnvelope<AccountTicket[]> & ApiFailure, ApiEnvelope<{ entries?: LedgerEntry[] }> & ApiFailure];
        const failed = [[balanceResponse, balanceResult], [ticketsResponse, ticketsResult], [ledgerResponse, ledgerResult]]
          .find(([response]) => !(response as Response).ok);
        if (failed) throw new Error((failed[1] as ApiFailure).error?.message || "无法加载账户明细");
        setBalance(balanceResult.data);
        setTickets(ownTickets(Array.isArray(ticketsResult.data) ? ticketsResult.data : []));
        setEntries(Array.isArray(ledgerResult.data?.entries) ? ledgerResult.data.entries : []);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载账户明细");
      } finally { setLoading(false); }
    })();
    return () => controller.abort();
  }, [room.roomId]);

  if (room.loading) return <DataStatePanel state="loading" title="正在核对积分账户" description=""/>;
  if (room.error) return <DataStatePanel state="error" title="积分账户加载失败" description={room.error} action={<button onClick={room.retry} className="rounded-full border-2 border-[var(--ink)] px-5 py-2 font-bold">重试</button>}/>;
  if (!room.rooms.length) return <DataStatePanel state="empty" title="还没有房间积分" description="创建或加入房间后，这里会显示独立的余额、判断和流水。"/>;

  return <section aria-labelledby="account-assets-title" className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4 border-b rule pb-5">
      <div><p className="eyebrow">ROOM ACCOUNT</p><h2 id="account-assets-title" className="display mt-1 text-3xl font-bold">积分与判断</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">每个房间独立记账。投入后立即进入冻结积分，待结算后写入可追溯流水。</p></div>
      <RoomFilter rooms={room.rooms} value={room.roomId} onChange={room.setRoomId}/>
    </div>

    {loading ? <DataStatePanel state="loading" title="正在读取房间账户" description="正在同步余额、判断和积分流水。"/> : error ? <DataStatePanel state="error" title="账户明细暂不可用" description={error}/> : <>
      <div className="account-balance-strip surface overflow-hidden">
        <BalanceMetric label="可用积分" value={balance?.availablePoints || "0.00"} emphasis/>
        <BalanceMetric label="已投入 / 冻结" value={balance?.frozenPoints || "0.00"}/>
        <BalanceMetric label="更正债务" value={balance?.correctionDebt || "0.00"}/>
        <BalanceMetric label="我的判断" value={`${summary.total} 笔`} note={`${summary.pending} 笔待结算`}/>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_.92fr]">
        <section className="surface p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3"><div><p className="eyebrow">PREDICTIONS</p><h3 className="display mt-1 text-2xl font-bold">最近判断</h3></div><Link href="/history" className="text-sm font-bold text-[var(--field)] hover:underline">查看长期结算档案</Link></div>
          {!tickets.length ? <EmptyCopy title="还没有提交记录" body="在比赛页提交判断后，待结算和已结算记录都会先出现在这里。"/> : <ol className="mt-5 divide-y divide-[var(--line)]">{tickets.slice(0, 8).map((ticket) => <TicketRow key={ticket.ticketId} ticket={ticket}/>)}</ol>}
        </section>

        <section className="surface p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3"><div><p className="eyebrow">POINT FLOW</p><h3 className="display mt-1 text-2xl font-bold">积分收支</h3></div><Link href="/ledger" className="text-sm font-bold text-[var(--field)] hover:underline">查看完整账本</Link></div>
          {!entries.length ? <EmptyCopy title="还没有积分流水" body="初始积分、预测投入、结算返还和冲正都会按时间记录。"/> : <ol className="mt-5 space-y-1">{entries.slice(0, 8).map((entry) => <LedgerRow key={entry.id} entry={entry}/>)}</ol>}
        </section>
      </div>
    </>}
  </section>;
}

function BalanceMetric({ label, value, note, emphasis = false }: { label: string; value: string; note?: string; emphasis?: boolean }) {
  return <div className={`account-balance-cell ${emphasis ? "bg-[var(--ink)] text-[var(--paper)]" : ""}`}><p className={`text-xs ${emphasis ? "text-[color:rgba(247,243,232,.68)]" : "text-[var(--muted)]"}`}>{label}</p><p className="tabular mt-2 text-2xl font-black sm:text-3xl">{value}</p>{note && <p className="mt-1 text-xs text-[var(--muted)]">{note}</p>}</div>;
}

function TicketRow({ ticket }: { ticket: AccountTicket }) {
  const pending = ticket.status === "FROZEN";
  return <li className="grid gap-3 py-4 first:pt-0 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><strong>{ticket.homeTeam} 对 {ticket.awayTeam}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${pending ? "bg-[var(--floodlight)] text-[var(--ink)]" : ticket.status === "WON" ? "bg-[var(--field)] text-white" : "bg-[rgb(23_35_59/8%)] text-[var(--muted)]"}`}>{ticketLabel[ticket.status]}</span></div><p className="mt-1 text-xs text-[var(--muted)]">{ticket.selection ? selectionLabel[ticket.selection] : "封盘前保密"} · 投入 {ticket.stakePoints || "—"} · 倍率 {ticket.confirmedOdds || "—"}</p></div><div className="sm:text-right"><p className="tabular text-sm font-bold">{pending ? `冻结 ${ticket.stakePoints || "—"}` : `净变化 ${signedPoints(ticket.netPoints)}`}</p><time dateTime={ticket.submittedAt} className="mt-1 block text-[10px] text-[var(--muted)]">{new Date(ticket.submittedAt).toLocaleString("zh-CN")}</time></div></li>;
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const delta = Number(entry.availableDelta) !== 0 ? entry.availableDelta : entry.frozenDelta;
  return <li className="grid grid-cols-[auto_1fr_auto] items-start gap-3 border-b border-[var(--line)] py-3 last:border-0"><span className={`mt-1 size-2 ${Number(delta) < 0 ? "bg-[var(--coral)]" : "bg-[var(--field)]"}`}/><div><p className="text-sm font-bold">{ledgerLabel[entry.type] || entry.type}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{entry.explanation}</p></div><div className="text-right"><p className={`tabular text-sm font-black ${Number(delta) < 0 ? "text-[var(--coral)]" : "text-[var(--field)]"}`}>{signedPoints(delta)}</p><time dateTime={entry.createdAt} className="mt-1 block text-[10px] text-[var(--muted)]">{new Date(entry.createdAt).toLocaleDateString("zh-CN")}</time></div></li>;
}

function EmptyCopy({ title, body }: { title: string; body: string }) { return <div className="mt-5 border-y rule py-8"><p className="font-bold">{title}</p><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p></div>; }
