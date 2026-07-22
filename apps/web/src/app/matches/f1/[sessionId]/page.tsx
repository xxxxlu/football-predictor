import type { Metadata } from "next";
import Link from "next/link";
import { LegalBoundary } from "@/components/legal-boundary";
import { F1SessionDetail } from "@/features/f1/session-detail";
import { PrivateShell } from "@/features/matchday/private-shell";

export const metadata: Metadata = { title: "F1 场次详情" };

export default async function F1SessionPage({ params, searchParams }: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ roomId?: string }>;
}) {
  const { sessionId } = await params;
  const { roomId } = await searchParams;
  const backHref = roomId ? `/matches/f1?roomId=${encodeURIComponent(roomId)}` : "/matches/f1";
  return (
    <PrivateShell title="F1 场次详情" description="车手榜与积分倍率均来自平台发布的数据；封盘后不再接受判断。">
      <div className="grid gap-8">
        <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-bold text-[var(--field)] hover:underline">← 返回 F1 赛程</Link>
        <F1SessionDetail sessionId={sessionId} roomId={roomId} />
        <LegalBoundary />
      </div>
    </PrivateShell>
  );
}
