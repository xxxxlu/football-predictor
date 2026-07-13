import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { RoomDashboard } from "@/features/matchday/room-dashboard";
export const metadata: Metadata = { title: "我的房间" };
export default function RoomsPage() { return <PrivateShell title="我的房间" description="每个房间都有独立的积分、判断和账本。"><RoomDashboard/></PrivateShell>; }
