"use client";
import { useRouter } from "next/navigation";
import type { RoomSummary } from "@/features/matchday/types";

export function RoomSwitcher({ rooms, currentRoomId }: { rooms: RoomSummary[]; currentRoomId?: string }) {
  const router = useRouter();
  return <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--muted)]">当前房间</span><select aria-label="切换房间" value={currentRoomId || ""} onChange={(event) => event.target.value && router.push(`/rooms/${event.target.value}`)} className="min-h-11 w-full border border-[var(--line)] bg-[var(--paper-raised)] px-3 font-bold"><option value="" disabled>选择一个房间</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}{room.role === "room_owner" ? " · 房主" : ""}</option>)}</select></label>;
}
