"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import { TeamCrest } from "@/components/football";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { publicRoomJoinRequest, ROOM_SPORT_LABELS, type PublicRoomSummaryRecord } from "./room-flow";

/**
 * The public-room discovery block, extracted from RoomListView (Story 12.4) so
 * the PULSE CLUB lobby reuses the exact same section instead of rewriting it.
 * Self-contained: it fetches `GET /api/v1/rooms/public` and runs the join flow
 * itself, so a host page adds discovery with one element.
 */
export function PublicRoomsSection({ headingId = "public-rooms-title" }: { headingId?: string }) {
  const router = useRouter();
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [joiningRoomId, setJoiningRoomId] = useState("");
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/rooms/public", { credentials: "same-origin", signal: controller.signal });
        const lobby = await response.json().catch(() => ({})) as ApiEnvelope<PublicRoomSummaryRecord[]> & ApiFailure;
        if (!response.ok) throw new Error(lobby.error?.message || "无法加载公开大厅");
        setPublicRooms(Array.isArray(lobby.data) ? lobby.data : []);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setLoadError((reason as Error).message || "无法加载公开大厅");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function joinPublic(roomId: string) {
    if (!window.confirm("加入前请确认：积分不可购买、转让或兑换。确认加入这个公开房间吗？")) return;
    setJoiningRoomId(roomId); setJoinError("");
    const request = publicRoomJoinRequest(roomId);
    try {
      const response = await fetch(request.url, request.init);
      const result = await response.json().catch(() => ({})) as ApiEnvelope<{ roomId: string }> & ApiFailure;
      if (!response.ok) throw new Error(result.error?.message || "暂时无法加入公开房间");
      router.push(`/rooms/${encodeURIComponent(result.data.roomId)}`);
    } catch (reason) {
      setJoinError((reason as Error).message || "暂时无法加入公开房间");
    } finally {
      setJoiningRoomId("");
    }
  }

  return <section aria-labelledby={headingId}>
    <div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">公开大厅</p><h2 id={headingId} className="kinetic mt-1 text-3xl">发现公开房间</h2></div><span className="league-pill shrink-0">{publicRooms.length} 个</span></div>
    {joinError && <div className="mb-4"><StatusMessage tone="error" title="未能加入">{joinError}</StatusMessage></div>}
    {loading
      ? <DataStatePanel state="loading" title="正在加载公开大厅" description=""/>
      : loadError
        ? <DataStatePanel state="error" title="公开大厅加载失败" description={loadError}/>
        : publicRooms.length
          ? <ul className="grid gap-4 sm:grid-cols-2">{publicRooms.map((room) => <li key={room.id} className="surface rounded-xl p-5"><div className="flex items-start justify-between gap-3"><TeamCrest name={room.name} className="size-12 text-base"/><span className="league-pill">{ROOM_SPORT_LABELS[room.sport ?? "FOOTBALL"]} · 公开</span></div><strong className="mt-4 block text-lg font-black">{room.name}</strong><p className="mt-1 text-xs text-[var(--muted)]">房主 {room.ownerName} · {room.memberCount} 人</p>{room.joined ? <Link href={`/rooms/${encodeURIComponent(room.id)}`} className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-full bg-[var(--field)] px-4 text-sm font-bold text-white no-underline">进入房间</Link> : <button type="button" disabled={joiningRoomId === room.id} onClick={() => joinPublic(room.id)} className="mt-4 min-h-10 w-full rounded-full bg-[var(--ink)] px-4 text-sm font-bold text-white transition hover:bg-[var(--field)] disabled:opacity-55">{joiningRoomId === room.id ? "正在加入…" : "确认规则并加入"}</button>}</li>)}</ul>
          : <DataStatePanel state="empty" title="还没有公开房间" description="创建第一个公开房间，其他注册用户就能在这里加入。"/>}
  </section>;
}
