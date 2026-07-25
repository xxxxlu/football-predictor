import type { Metadata } from "next";
import Link from "next/link";
import { LegalBoundary } from "@/components/legal-boundary";
import { F1DriverDetail } from "@/features/f1/driver-detail";
import { PrivateShell } from "@/features/matchday/private-shell";

export const metadata: Metadata = { title: "F1 车手档案" };

export default async function F1DriverPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <PrivateShell title="F1 车手档案" description="赛季成绩全部来自已确认的官方结果；照片与队标素材见站内许可登记。">
      <div className="grid gap-8">
        <Link href="/matches/f1" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--field)] hover:underline">← 返回 F1 赛程</Link>
        <F1DriverDetail code={code.toUpperCase()} />
        <LegalBoundary />
      </div>
    </PrivateShell>
  );
}
