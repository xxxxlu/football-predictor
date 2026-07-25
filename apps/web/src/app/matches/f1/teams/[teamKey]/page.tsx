import type { Metadata } from "next";
import Link from "next/link";
import { LegalBoundary } from "@/components/legal-boundary";
import { F1TeamDetail } from "@/features/f1/team-detail";
import { PrivateShell } from "@/features/matchday/private-shell";

export const metadata: Metadata = { title: "F1 车队档案" };

export default async function F1TeamPage({ params }: { params: Promise<{ teamKey: string }> }) {
  const { teamKey } = await params;
  return (
    <PrivateShell title="F1 车队档案" description="车队积分与成绩全部来自已确认的官方结果；照片与队标素材见站内许可登记。">
      <div className="grid gap-8">
        <Link href="/matches/f1" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--field)] hover:underline">← 返回 F1 赛程</Link>
        <F1TeamDetail teamKey={teamKey.toLowerCase()} />
        <LegalBoundary />
      </div>
    </PrivateShell>
  );
}
