import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { RoomListView } from "@/features/rooms/room-list-view";
export const metadata: Metadata = { title: "我的房间" };
export default function RoomsPage() { return <PrivateShell title="我的房间" description="创建或加入私人房间；每个房间都有独立的积分、判断和账本。"><RoomListView/></PrivateShell>; }
