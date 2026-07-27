"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { formatEventTitle } from "@/features/matchday/selection-label";
import { toTicketHistoryView, type TicketHistoryRecord, type TicketStatus } from "./room-ticket-history";

const statusLabels: Record<TicketStatus, string> = { FROZEN: "待结算", WON: "命中", LOST: "未命中", VOID: "取消 / 走盘" };

export function RoomTicketHistoryView({ roomId, isOwner, initialPostMatchTicketVisible }: { roomId: string; isOwner: boolean; initialPostMatchTicketVisible: boolean }) {
  const [records, setRecords] = useState<TicketHistoryRecord[] | null>(null);
  const [filter, setFilter] = useState<"ALL" | "MINE">("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [postMatchVisible, setPostMatchVisible] = useState(initialPostMatchTicketVisible);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/tickets/history`, { credentials: "same-origin", signal });
      const result = await response.json().catch(() => ({})) as ApiEnvelope<TicketHistoryRecord[]> & ApiFailure;
      if (!response.ok || !Array.isArray(result.data)) throw new Error(result.error?.message || "无法加载投入记录");
      setRecords(result.data);
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载投入记录");
    } finally { setLoading(false); }
  }, [roomId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => { await load(controller.signal); })();
    return () => controller.abort();
  }, [load]);

  const visibleRecords = useMemo(() => (records ?? []).filter((record) => filter === "ALL" || record.owner.isCurrentUser), [records, filter]);

  async function updatePostMatchVisibility(visible: boolean) {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/settings`, { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postMatchTicketVisible: visible }) });
      const result = await response.json().catch(() => ({})) as ApiFailure;
      if (!response.ok) throw new Error(result.error?.message || "无法保存记录可见性");
      setPostMatchVisible(visible);
      await load();
    } catch (reason) { setError((reason as Error).message || "无法保存记录可见性"); }
    finally { setSaving(false); }
  }

  return <section aria-labelledby="room-ticket-history-title" className="surface p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="room-ticket-history-title" className="display text-2xl font-bold">成员投入记录</h2><p className="mt-1 text-sm text-[var(--muted)]">你的记录始终完整可见；其他成员的详情按平台和房间可见性规则展示。</p></div>
      <div className="flex gap-2">{(["ALL", "MINE"] as const).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={`min-h-10 rounded-full border px-4 text-sm font-bold ${filter === value ? "border-[var(--field)] bg-[var(--field)] text-white" : "border-[var(--line)]"}`}>{value === "ALL" ? "全部记录" : "我的记录"}</button>)}</div>
    </div>
    {isOwner && <div className="mt-5 rounded-xl border-2 border-[var(--field)] bg-[var(--wash-brand-soft)] p-4"><p className="text-xs font-black tracking-wide text-[var(--field-dark)]">房主设置</p><label className="mt-2 flex cursor-pointer items-start justify-between gap-4"><span><strong className="block">开赛后公开完整记录</strong><span className="mt-1 block text-xs leading-5 text-[var(--muted)]">关闭后，其他成员只能看到已提交状态；每个人仍能查看自己的完整记录。</span></span><input type="checkbox" checked={postMatchVisible} disabled={saving} onChange={(event) => void updatePostMatchVisibility(event.target.checked)} className="mt-1 size-6 shrink-0 accent-[var(--field)]" aria-label="开赛后公开完整记录"/></label></div>}
    {error && <p role="alert" className="mt-4 text-sm font-bold text-[var(--coral)]">{error}</p>}
    {loading && !records ? <div className="mt-5"><DataStatePanel state="loading" title="正在加载投入记录" description=""/></div> : !visibleRecords.length ? <div className="mt-5"><DataStatePanel state="empty" title="还没有投入记录" description="成员提交预测后，积分投入和允许公开的详情会显示在这里。"/></div> : <ol className="mt-5 space-y-3">{visibleRecords.map((record) => <TicketRow key={record.ticketId} record={record}/>)}</ol>}
  </section>;
}

function TicketRow({ record }: { record: TicketHistoryRecord }) {
  const view = toTicketHistoryView(record);
  return <li className="rounded-xl border border-[var(--line)] p-4">
    <div className="flex flex-wrap justify-between gap-3"><div><p className="font-black">{view.ownerLabel}</p><h3 className="mt-1 text-lg font-bold">{record.matchId.startsWith("f1:") ? formatEventTitle(record) : <>{record.homeTeam} <span className="text-sm font-normal text-[var(--muted)]">对</span> {record.awayTeam}</>}</h3><p className="mt-1 text-xs text-[var(--muted)]">开赛 {new Date(record.kickoffAt).toLocaleString("zh-CN")}{view.submittedAt ? ` · 提交 ${new Date(view.submittedAt).toLocaleString("zh-CN")}` : ""}</p></div><div className="text-right"><span className="rounded-full bg-[var(--wash-brand)] px-3 py-1 text-xs font-bold text-[var(--field-dark)]">{statusLabels[record.status]}</span><p className="mt-2 text-xs text-[var(--muted)]">{view.disclosure}</p></div></div>
    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-4"><Fact label="判断" value={view.selection ?? "未公开"}/><Fact label="投入积分" value={view.stake ?? "未公开"}/><Fact label="确认倍率" value={view.odds ?? "未公开"}/><Fact label={record.status === "FROZEN" ? "状态" : "净积分"} value={record.status === "FROZEN" ? "等待比赛结果" : view.netPoints ?? "未公开"}/></dl>
  </li>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-[10px] text-[var(--muted)]">{label}</dt><dd className="tabular mt-1 text-lg font-bold">{value}</dd></div>; }
