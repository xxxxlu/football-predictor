"use client";
import { useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { RoomFilter } from "@/components/room-filter";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { useRoomData } from "./use-room-data";
import { correctionDebtExplanation, ledgerReferenceFacts } from "./ledger-presentation";

type LedgerEntry = { id: string; type: "FREEZE" | "SETTLE" | "VOID" | "REVERSAL" | "RE_SETTLE" | "DEBT_OFFSET" | "GRANT"; roomId: string; ticketId?: string | null; settlementVersion?: string | null; auditId: string; reversesLedgerId?: string | null; createdAt: string; availableDelta: string; frozenDelta: string; debtDelta?: string; availableAfter: string; frozenAfter: string; debtAfter?: string; explanation: string; reference?: { kind: string; id: string } };
type LedgerResult = { entries: LedgerEntry[]; nextCursor?: string | null };
const labels: Record<LedgerEntry["type"], string> = { FREEZE: "预测冻结", SETTLE: "赛果结算", VOID: "比赛作废", REVERSAL: "原结算冲正", RE_SETTLE: "更正后重结", DEBT_OFFSET: "更正债务抵扣", GRANT: "积分发放" };

async function fetchLedgerPage(roomId: string, cursor: string | null, signal?: AbortSignal): Promise<LedgerResult> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/ledger${query}`, { credentials: "same-origin", signal });
  const result = await response.json().catch(() => ({})) as ApiEnvelope<LedgerResult | LedgerEntry[]> & ApiFailure;
  if (!response.ok) throw new Error(result.error?.message || "无法加载账本");
  const data = result.data;
  if (Array.isArray(data)) return { entries: data, nextCursor: null };
  return { entries: Array.isArray(data?.entries) ? data.entries : [], nextCursor: data?.nextCursor ?? null };
}

export function LedgerView() {
  const room = useRoomData(); const [entries, setEntries] = useState<LedgerEntry[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [loadingMore, setLoadingMore] = useState(false); const [error, setError] = useState(""); const [moreError, setMoreError] = useState("");
  useEffect(() => { if (!room.roomId) return; const controller = new AbortController(); void (async () => { setLoading(true); setError(""); setMoreError(""); setEntries([]); setCursor(null); try { const page = await fetchLedgerPage(room.roomId, null, controller.signal); setEntries(page.entries); setCursor(page.nextCursor ?? null); } catch (reason) { if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载账本"); } finally { setLoading(false); } })(); return () => controller.abort(); }, [room.roomId]);

  // A failed "load more" keeps the pages already on screen and reports itself
  // beside the button; only a failed first page replaces the timeline.
  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true); setMoreError("");
    try {
      const page = await fetchLedgerPage(room.roomId, cursor);
      // Entries are append-only, but a settlement committing between two reads
      // shifts the window down; drop anything already shown rather than repeat it.
      setEntries((current) => { const seen = new Set(current.map((entry) => entry.id)); return [...current, ...page.entries.filter((entry) => !seen.has(entry.id))]; });
      setCursor(page.nextCursor ?? null);
    } catch (reason) {
      setMoreError((reason as Error).message || "无法加载更早的记录");
    } finally { setLoadingMore(false); }
  }

  if (room.loading) return <DataStatePanel state="loading" title="正在加载房间" description=""/>;
  if (room.error) return <DataStatePanel state="error" title="房间加载失败" description={room.error} action={<button onClick={room.retry} className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-5 font-bold transition hover:bg-[var(--ink)] hover:text-white">重试</button>}/>;
  if (!room.rooms.length) return <DataStatePanel state="empty" title="还没有积分账本" description="加入房间并获得初始积分后，账本记录会出现在这里。"/>;
  return <div><RoomFilter rooms={room.rooms} value={room.roomId} onChange={room.setRoomId}/><p className="mt-4 text-xs leading-5 text-[var(--muted)]">每条记录均为追加写入。赛果更正不会覆盖历史，而是先冲正再重结；更正债务只代表需由后续虚拟积分收益抵扣的差额。</p><div className="mt-6">{loading ? <DataStatePanel state="loading" title="正在加载账本" description=""/> : error ? <DataStatePanel state="error" title="账本暂不可用" description={error}/> : !entries.length ? <DataStatePanel state="empty" title="账本还是空的" description="初始发放、预测冻结或结算发生后会生成可解释记录。"/> : <><LedgerTimeline entries={entries}/>{cursor && <div className="mt-6 text-center"><button type="button" onClick={() => { void loadMore(); }} disabled={loadingMore} className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-6 font-bold transition hover:bg-[var(--ink)] hover:text-white disabled:opacity-55">{loadingMore ? "正在加载…" : "加载更早的记录"}</button>{moreError && <p role="status" className="mt-3 text-xs text-[var(--coral)]">{moreError}</p>}</div>}</>}</div></div>;
}

function LedgerTimeline({ entries }: { entries: LedgerEntry[] }) { return <ol className="relative ml-3 border-l-2 border-[var(--line)] pl-7">{entries.map(entry => { const references = ledgerReferenceFacts(entry); const hasDebt = Number(entry.debtAfter || 0) > 0; return <li key={entry.id} className="relative pb-8 last:pb-0"><span aria-hidden="true" className={`absolute -left-[2.15rem] top-1 size-3 border-2 border-[var(--paper)] ${entry.type === "REVERSAL" || entry.type === "DEBT_OFFSET" ? "bg-[var(--coral)]" : "bg-[var(--field)]"}`}/><article className="surface p-4"><header className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-bold">{labels[entry.type] || entry.type}</h2><time dateTime={entry.createdAt} className="tabular text-xs text-[var(--muted)]">{new Date(entry.createdAt).toLocaleString("zh-CN")}</time></header><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{entry.explanation}</p><dl className="mt-4 grid grid-cols-3 gap-2 border-t rule pt-3"><Delta label="可用变化" value={entry.availableDelta}/><Delta label="冻结变化" value={entry.frozenDelta}/><Delta label="债务变化" value={entry.debtDelta || "0.00"}/></dl><p className="tabular mt-3 text-xs text-[var(--muted)]">记录后：可用 {entry.availableAfter} · 冻结 {entry.frozenAfter} · 债务 {entry.debtAfter || "0.00"}</p>{hasDebt && <p className="mt-3 border-l-4 border-[var(--coral)] bg-white/45 p-3 text-xs leading-5 text-[var(--muted)]">{correctionDebtExplanation(entry.debtAfter || "0.00")}</p>}<dl className="mt-4 grid gap-1 border-t rule pt-3 text-[10px] text-[var(--muted)]">{references.map(([label, value]) => <div key={label} className="grid grid-cols-[5rem_1fr] gap-2"><dt>{label}</dt><dd className="tabular break-all">{value}</dd></div>)}</dl></article></li>; })}</ol>; }
function Delta({ label, value }: { label: string; value: string }) { const positive = value.startsWith("+"); const zero = Number(value) === 0; return <div><dt className="text-[10px] text-[var(--muted)]">{label}</dt><dd className={`tabular mt-1 text-sm font-bold ${zero ? "" : positive ? "text-[var(--field)]" : "text-[var(--coral)]"}`}>{value}</dd></div>; }
