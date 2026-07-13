import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { RoomDashboard } from "@/features/matchday/room-dashboard";
export const metadata: Metadata = { title: "房间比赛日" };
export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) { const { roomId } = await params; return <PrivateShell title="房间比赛日" description="提交前会复核赔率、数据新鲜度和实际封盘状态。"><RoomDashboard currentRoomId={roomId}/></PrivateShell>; }
