"use client";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { DataStatePanel } from "@/components/data-state-panel";
import { RoomFilter } from "@/components/room-filter";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { formatPoints, formatPointsDelta } from "@/lib/points";
import { useRoomData } from "./use-room-data";

/* Story 12.6: avatarUrl/avatarVersion are the only fields the projection gained;
   the leaderboard has no PULSE ID, so the fallback seeds off displayName. */
type LeaderboardRow = { rank: number; userId: string; displayName: string; netPoints: string; availablePoints: string; frozenPoints: string; settledTickets: number; movement?: number | null; avatarUrl?: string | null; avatarVersion?: number | null };

export function LeaderboardView() {
  const room = useRoomData(); const [rows, setRows] = useState<LeaderboardRow[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (!room.roomId) return; const controller = new AbortController(); void (async () => { setLoading(true); setError(""); try { const response = await fetch(`/api/v1/rooms/${encodeURIComponent(room.roomId)}/leaderboard`, { credentials: "same-origin", signal: controller.signal }); const result = await response.json().catch(() => ({})) as ApiEnvelope<LeaderboardRow[]> & ApiFailure; if (!response.ok) throw new Error(result.error?.message || "无法加载排行榜"); setRows(Array.isArray(result.data) ? result.data : []); } catch (reason) { if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载排行榜"); } finally { setLoading(false); } })(); return () => controller.abort(); }, [room.roomId]);
  if (room.loading) return <DataStatePanel state="loading" title="正在加载房间" description=""/>;
  if (room.error) return <DataStatePanel state="error" title="房间加载失败" description={room.error} action={<button onClick={room.retry} className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-5 font-bold transition hover:bg-[var(--ink)] hover:text-white">重试</button>}/>;
  if (!room.rooms.length) return <DataStatePanel state="empty" title="还没有房间排行榜" description="加入私人房间后，房间内的排名会显示在这里。"/>;
  return <div><RoomFilter rooms={room.rooms} value={room.roomId} onChange={room.setRoomId}/><p className="mt-4 text-xs leading-5 text-[var(--muted)]">净积分 = 可用积分 − 更正债务 − 初始 10,000 分；尚未结算的冻结积分不参与排名。</p><div className="mt-6">{loading ? <DataStatePanel state="loading" title="正在加载排行" description=""/> : error ? <DataStatePanel state="error" title="排行榜暂不可用" description={error}/> : !rows.length ? <DataStatePanel state="empty" title="尚无可排名记录" description="完成结算后，成员的净积分与排名会出现在这里。"/> : <Standings rows={rows}/>}</div></div>;
}

/* §15.2：前三名走海报式大卡，第四名以后才进高密度列表。此前所有名次共用
   同一行表格，房间冠军和第九名在视觉上完全等重，排行榜读起来像一张对账单。 */
function Standings({ rows }: { rows: LeaderboardRow[] }) {
  const podium = rows.slice(0, 3), rest = rows.slice(3);
  return <div className="space-y-6">
    <section className="pulse-podium" aria-label="前三名">{podium.map(row => <PodiumSeat key={row.userId} row={row}/>)}</section>
    {rest.length > 0 && <LeaderboardTable rows={rest}/>}
  </div>;
}

const PLACE: Record<number, string> = { 1: "P1 · 冠军", 2: "P2 · 亚军", 3: "P3 · 季军" };

function PodiumSeat({ row }: { row: LeaderboardRow }) {
  return <article className={`pulse-podium__seat pulse-podium__seat--${row.rank}`}>
    <span aria-hidden="true" className="pulse-podium__ghost">{String(row.rank).padStart(2, "0")}</span>
    <div className="pulse-podium__head">
      <p className="pulse-podium__place">{PLACE[row.rank] ?? `P${row.rank}`}</p>
      <Move movement={row.movement}/>
    </div>
    <div>
      <h3 className="pulse-podium__name flex items-center gap-2"><Avatar src={row.avatarUrl} version={row.avatarVersion} nickname={row.displayName} size={40}/>{row.displayName}</h3>
      <strong className="pulse-podium__net">{formatPointsDelta(row.netPoints)}</strong>
      <p className="pulse-podium__meta">可用 {formatPoints(row.availablePoints)} · 冻结 {formatPoints(row.frozenPoints)} · 已结算 {row.settledTickets}</p>
    </div>
  </article>;
}

/* §15.2 明确要求 ▲2 / ▼1 / —，不能只靠绿红区分。箭头对读屏没有意义，
   所以字形 aria-hidden，语义交给同级的 sr-only 文本。
   ⚠️ 服务端 projectLeaderboard() 目前把 movement 硬编码成 null（没有存名次历史），
   所以这个组件现在永远不渲染。要让它出现，需要先落一张名次快照表。 */
function Move({ movement, className = "" }: { movement?: number | null; className?: string }) {
  if (movement == null) return null;
  if (movement === 0) return <span className={`pulse-move pulse-move--flat ${className}`}><span aria-hidden="true">—</span><span className="sr-only">名次与上轮持平</span></span>;
  const step = Math.abs(movement);
  return <span className={`pulse-move ${className}`}><span aria-hidden="true">{movement > 0 ? "▲" : "▼"}{step}</span><span className="sr-only">较上轮{movement > 0 ? "上升" : "下降"} {step} 名</span></span>;
}

function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) { return <div className="surface overflow-hidden"><div className="hidden grid-cols-[4rem_1fr_repeat(4,minmax(6rem,.65fr))] gap-3 border-b rule px-4 py-3 text-xs font-bold text-[var(--muted)] md:grid"><span>排名</span><span>成员</span><span className="text-right">净积分</span><span className="text-right">可用</span><span className="text-right">冻结</span><span className="text-right">已结算</span></div><ol>{rows.map(row => <li key={row.userId} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 border-b rule p-4 last:border-0 md:grid-cols-[4rem_1fr_repeat(4,minmax(6rem,.65fr))]"><span aria-label={`第 ${row.rank} 名`} className="tabular grid size-9 shrink-0 place-items-center rounded-full bg-[var(--wash-neutral)] text-sm font-black text-[var(--ink)]">{row.rank}</span><div className="flex min-w-0 items-center gap-2"><Avatar src={row.avatarUrl} version={row.avatarVersion} nickname={row.displayName} size={32}/><div className="min-w-0"><p className="truncate font-bold">{row.displayName}</p><Move movement={row.movement} className="mt-1 text-[var(--muted)]"/></div></div><Metric mobile label="净积分" value={formatPointsDelta(row.netPoints)}/><Metric label="可用" value={formatPoints(row.availablePoints)}/><Metric label="冻结" value={formatPoints(row.frozenPoints)}/><Metric label="已结算" value={String(row.settledTickets)}/></li>)}</ol></div>; }

/* 手机上标签与数字上下堆叠，数字按 §7.3 取标签的 1.8 倍（10px → 18px）；
   桌面标签在表头，数字回到正文字号。 */
function Metric({ label, value, mobile = false }: { label: string; value: string; mobile?: boolean }) { return <div className={`${mobile ? "" : "hidden md:block"} text-right`}><span className="block text-[10px] text-[var(--muted)] md:hidden">{label}</span><strong className="tabular text-lg md:text-sm">{value}</strong></div>; }
