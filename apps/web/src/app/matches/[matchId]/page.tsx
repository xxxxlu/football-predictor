import type { Metadata } from "next";
import Link from "next/link";
import { LegalBoundary } from "@/components/legal-boundary";
import { MatchDetail } from "@/features/matchday/match-detail";
import { PrivateShell } from "@/features/matchday/private-shell";

export const metadata: Metadata = { title: "比赛详情" };

export default async function MatchDetailPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return (
    <PrivateShell title="比赛详情" description="以下阵容与赛事信息均来自产品缓存；阵容未公布或数据过期时会明确标注，不展示虚构球员。">
      <div className="grid gap-8">
        <Link href="/matches" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--field)] hover:underline">← 返回比赛</Link>
        <MatchDetail matchId={matchId} />
        <LegalBoundary />
      </div>
    </PrivateShell>
  );
}
