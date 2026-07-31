import type { Metadata } from "next";
import { ClubDailyView } from "@/features/club/club-daily-view";
import { PrivateShell } from "@/features/matchday/private-shell";
export const metadata: Metadata = { title: "每日挑战" };
export default function ClubDailyPage() {
  return <PrivateShell title="每日挑战" description="每天一道轻量体育题，附赠你的今日运势卡。XP、连胜与徽章只是俱乐部荣誉，不会影响任何房间积分、赔率或结算。">
    <ClubDailyView />
  </PrivateShell>;
}
