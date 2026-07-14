import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { RoomDetailView } from "@/features/rooms/room-detail-view";
export const metadata: Metadata = { title: "房间比赛日" };
export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) { const { roomId } = await params; return <PrivateShell title="房间比赛日" description="管理成员和邀请；提交前会复核积分倍率、数据新鲜度和实际封盘状态。"><RoomDetailView roomId={roomId}/></PrivateShell>; }
