import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { LeaderboardView } from "@/features/operations/leaderboard-view";
export const metadata: Metadata = { title: "房间排行榜" };
export default function LeaderboardPage() { return <PrivateShell title="房间排行榜" description="排名只在当前私人房间内计算，不与其他房间的积分混合。"><LeaderboardView/></PrivateShell>; }
