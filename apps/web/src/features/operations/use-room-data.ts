"use client";
import { useEffect, useState } from "react";
import type { ApiEnvelope, ApiFailure, RoomSummary } from "@/features/matchday/types";

export function useRoomData() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]); const [roomId, setRoomId] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  useEffect(() => { const controller = new AbortController(); void (async () => { try { const response = await fetch("/api/v1/rooms", { credentials: "same-origin", signal: controller.signal }); const result = await response.json().catch(() => ({})) as ApiEnvelope<RoomSummary[]> & ApiFailure; if (!response.ok) throw new Error(result.error?.message || "无法加载房间"); const nextRooms = Array.isArray(result.data) ? result.data : []; setRooms(nextRooms); setRoomId(current => current || nextRooms[0]?.id || ""); } catch (reason) { if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载房间"); } finally { setLoading(false); } })(); return () => controller.abort(); }, [retry]);
  return { rooms, roomId, setRoomId, loading, error, retry: () => { setLoading(true); setError(""); setRetry(value => value + 1); } };
}
