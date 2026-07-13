"use client";
import { useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { RoomFilter } from "@/components/room-filter";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { useRoomData } from "./use-room-data";

type LeaderboardRow = { rank: number; userId: string; displayName: string; netPoints: string; availablePoints: string; frozenPoints: string; settledTickets: number; movement?: number | null };

export function LeaderboardView() {
  const room = useRoomData(); const [rows, setRows] = useState<LeaderboardRow[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (!room.roomId) return; const controller = new AbortController(); void (async () => { setLoading(true); setError(""); try { const response = await fetch(`/api/v1/rooms/${encodeURIComponent(room.roomId)}/leaderboard`, { credentials: "same-origin", signal: controller.signal }); const result = await response.json().catch(() => ({})) as ApiEnvelope<LeaderboardRow[]> & ApiFailure; if (!response.ok) throw new Error(result.error?.message || "无法加载排行榜"); setRows(Array.isArray(result.data) ? result.data : []); } catch (reason) { if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载排行榜"); } finally { setLoading(false); } })(); return () => controller.abort(); }, [room.roomId]);
  if (room.loading) return <DataStatePanel state="loading" title="正在加载房间" description=""/>;
  if (room.error) return <DataStatePanel state="error" title="房间加载失败" description={room.error} action={<button onClick={room.retry} className="border border-[var(--ink)] px-4 py-2 font-bold">重试</button>}/>;
  if (!room.rooms.length) return <DataStatePanel state="empty" title="还没有房间排行榜" description="加入私人房间后，房间内的排名会显示在这里。"/>;
  return <div><RoomFilter rooms={room.rooms} value={room.roomId} onChange={room.setRoomId}/><p className="mt-4 text-xs leading-5 text-[var(--muted)]">净积分 = 可用积分 − 更正债务 − 初始 10,000 分；尚未结算的冻结积分不参与排名。</p><div className="mt-6">{loading ? <DataStatePanel state="loading" title="正在加载排行" description=""/> : error ? <DataStatePanel state="error" title="排行榜暂不可用" description={error}/> : !rows.length ? <DataStatePanel state="empty" title="尚无可排名记录" description="完成结算后，成员的净积分与排名会出现在这里。"/> : <LeaderboardTable rows={rows}/>}</div></div>;
}

function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) { return <div className="surface overflow-hidden"><div className="hidden grid-cols-[4rem_1fr_repeat(4,minmax(6rem,.65fr))] gap-3 border-b rule px-4 py-3 text-xs font-bold text-[var(--muted)] md:grid"><span>排名</span><span>成员</span><span className="text-right">净积分</span><span className="text-right">可用</span><span className="text-right">冻结</span><span className="text-right">已结算</span></div><ol>{rows.map(row => <li key={row.userId} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 border-b rule p-4 last:border-0 md:grid-cols-[4rem_1fr_repeat(4,minmax(6rem,.65fr))]"><strong className="tabular text-xl">{row.rank}</strong><div className="min-w-0"><p className="truncate font-bold">{row.displayName}</p>{row.movement != null && row.movement !== 0 && <p className="mt-1 text-xs text-[var(--muted)]">较上轮 {row.movement > 0 ? `上升 ${row.movement}` : `下降 ${Math.abs(row.movement)}`}</p>}</div><Metric mobile label="净积分" value={row.netPoints}/><Metric label="可用" value={row.availablePoints}/><Metric label="冻结" value={row.frozenPoints}/><Metric label="已结算" value={String(row.settledTickets)}/></li>)}</ol></div>; }
function Metric({ label, value, mobile = false }: { label: string; value: string; mobile?: boolean }) { return <div className={`${mobile ? "" : "hidden md:block"} text-right`}><span className="block text-[10px] text-[var(--muted)] md:hidden">{label}</span><strong className="tabular text-sm">{value}</strong></div>; }
