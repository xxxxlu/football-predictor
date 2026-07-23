import type { Metadata } from "next";
import { WeekendList } from "@/features/f1/weekend-list";
import { SportTabs } from "@/features/f1/sport-tabs";
import { PrivateShell } from "@/features/matchday/private-shell";

export const metadata: Metadata = { title: "F1 赛程" };

export default async function F1SchedulePage({ searchParams }: { searchParams: Promise<{ roomId?: string }> }) {
  const { roomId } = await searchParams;
  return (
    <PrivateShell title="F1 赛程" description="按 Race Weekend 浏览场次；预测在每个场次开始时封盘，结果由官方成绩录入后自动结算。">
      <div className="grid gap-6">
        <SportTabs active="FORMULA_1" />
        <WeekendList roomId={roomId} />
      </div>
    </PrivateShell>
  );
}
