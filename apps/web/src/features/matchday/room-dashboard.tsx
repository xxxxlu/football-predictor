"use client";
import { useEffect, useState } from "react";
import { BalanceSummary } from "@/components/balance-summary";
import { RoomSwitcher } from "@/components/room-switcher";
import { StatusMessage } from "@/components/status-message";
import { MatchList } from "./match-list";
import type { ApiEnvelope, ApiFailure, BalanceView, RoomSummary } from "./types";

export function RoomDashboard({ currentRoomId }: { currentRoomId?: string }) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]); const [balance, setBalance] = useState<BalanceView>(); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); (async () => { try { const response = await fetch("/api/v1/rooms", { credentials: "same-origin", signal: controller.signal }); const result = await response.json().catch(() => ({})) as ApiEnvelope<RoomSummary[]> & ApiFailure; if (!response.ok) throw new Error(result.error?.message || "无法加载房间"); setRooms(Array.isArray(result.data) ? result.data : []); if (currentRoomId) { const balanceResponse = await fetch(`/api/v1/rooms/${encodeURIComponent(currentRoomId)}/balance`, { credentials: "same-origin", signal: controller.signal }); if (balanceResponse.ok) { const balanceResult = await balanceResponse.json() as ApiEnvelope<BalanceView>; setBalance(balanceResult.data); } } } catch (reason) { if ((reason as Error).name !== "AbortError") setError((reason as Error).message); } finally { setLoading(false); } })(); return () => controller.abort(); }, [currentRoomId]);
  if (loading) return <div aria-busy="true" className="surface h-28 animate-pulse" aria-label="正在加载房间"/>;
  if (error) return <StatusMessage tone="error" title="房间加载失败">{error}</StatusMessage>;
  if (!rooms.length) return <section className="surface p-8 text-center"><h2 className="display text-2xl font-bold">还没有加入房间</h2><p className="mt-2 text-sm text-[var(--muted)]">通过朋友发送的有效邀请链接加入私人房间。</p></section>;
  if (!currentRoomId) return <section className="surface p-6"><RoomSwitcher rooms={rooms}/><p className="mt-5 text-sm text-[var(--muted)]">选择一个房间，查看该房间的独立积分与比赛。</p></section>;
  const room = rooms.find(item => item.id === currentRoomId);
  return <><div className="surface"><div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-end"><RoomSwitcher rooms={rooms} currentRoomId={currentRoomId}/><p className="text-xs text-[var(--muted)]">{room?.memberCount === undefined ? "私人房间" : `${room.memberCount} 位成员`}</p></div><BalanceSummary balance={balance}/></div><div className="mt-6"><MatchList roomId={currentRoomId} interactive/></div></>;
}
