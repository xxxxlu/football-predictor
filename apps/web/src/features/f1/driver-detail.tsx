"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { driverPhotoPath, teamCarPath, teamLogoPath } from "./media";
import type { F1DriverSeasonEntry, F1DriverSeasonTotals } from "./stats";
import { CLASSIFICATION_STATUS_LABELS, SESSION_KIND_LABELS, type F1ClassificationStatusView, type F1SessionKind } from "./types";

interface DriverDetailData {
  driver: { code: string; number: number; name: string; constructorKey: string; constructorName: string; color: string; seasonPoints: number };
  season: number;
  standing: { position: number; of: number };
  teammate: { code: string; name: string; seasonPoints: number } | null;
  totals: F1DriverSeasonTotals;
  entries: F1DriverSeasonEntry[];
}

function normalize(value: unknown): DriverDetailData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const driver = data.driver as DriverDetailData["driver"] | undefined;
  if (!driver || typeof driver.code !== "string" || typeof driver.name !== "string") return null;
  return {
    driver,
    season: typeof data.season === "number" ? data.season : 0,
    standing: (data.standing as DriverDetailData["standing"]) ?? { position: 0, of: 0 },
    teammate: (data.teammate as DriverDetailData["teammate"]) ?? null,
    totals: (data.totals as F1DriverSeasonTotals) ?? { wins: 0, podiums: 0, poles: 0, sprintWins: 0, fastestLaps: 0, dnfs: 0 },
    entries: Array.isArray(data.entries) ? (data.entries as F1DriverSeasonEntry[]) : [],
  };
}

export function F1DriverDetail({ code }: { code: string }) {
  const [data, setData] = useState<DriverDetailData | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/f1/drivers/${encodeURIComponent(code)}`, { credentials: "same-origin", signal: controller.signal, cache: "no-store" });
        const result = await response.json().catch(() => ({})) as ApiEnvelope<unknown> & ApiFailure;
        if (response.status === 404) { setNotFound(true); return; }
        if (!response.ok) throw new Error(result.error?.message || "车手数据暂不可用");
        const normalized = normalize(result.data);
        if (!normalized) throw new Error("车手数据格式异常");
        setData(normalized);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "车手数据暂不可用");
      }
    })();
    return () => controller.abort();
  }, [code]);

  if (notFound) return <DataStatePanel state="empty" title="没有找到这位车手" description="请回到 F1 赛程，从车手榜重新选择。" />;
  if (error) return <DataStatePanel state="error" title="车手数据暂不可用" description={error} />;
  if (!data) return <DataStatePanel state="loading" title="正在加载车手档案" description="正在读取赛季成绩与积分。" />;

  const { driver, standing, teammate, totals, entries } = data;
  const photo = driverPhotoPath(driver.code);
  const logo = teamLogoPath(driver.constructorKey);
  const car = teamCarPath(driver.constructorKey);

  return (
    <div className="grid gap-8">
      <header className="pulse-session-hero" style={{ "--pulse-team-color": driver.color } as React.CSSProperties}>
        <div className="pulse-session-hero__grid">
          <div className="pulse-session-hero__copy">
            <p className="pd-eyebrow pd-enter"><span>DRIVER PROFILE · {data.season}</span></p>
            <div className="pd-enter pd-enter--1 mt-2 flex flex-wrap items-center gap-4">
              <span className="kinetic tabular text-[clamp(2.5rem,6vw,4rem)]" style={{ color: driver.color }}>{String(driver.number).padStart(2, "0")}</span>
              <h2 className="kinetic text-[clamp(2.5rem,7vw,5rem)]">{driver.name}</h2>
            </div>
            <div className="pd-enter pd-enter--2 mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="pd-tag"><span>{driver.code}</span></span>
              <Link href={`/matches/f1/teams/${driver.constructorKey}`} className="inline-flex items-center gap-2 font-bold hover:underline">
                <i aria-hidden className="h-4 w-1 rounded-sm" style={{ background: driver.color }} />
                {driver.constructorName}
              </Link>
              {teammate && <span className="text-white/70">队友 <Link href={`/matches/f1/drivers/${teammate.code}`} className="font-bold text-white hover:underline">{teammate.name}</Link></span>}
            </div>
            <dl className="pd-enter pd-enter--3 mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {([
                ["车手积分榜", standing.position > 0 ? `P${standing.position}` : "—"],
                ["赛季积分", String(driver.seasonPoints)],
                ["分站冠军", String(totals.wins)],
                ["登领奖台", String(totals.podiums)],
                ["杆位", String(totals.poles)],
                ["冲刺冠军", String(totals.sprintWins)],
                ["最快圈", String(totals.fastestLaps)],
                ["退赛", String(totals.dnfs)],
              ] as const).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-white/60">{label}</dt>
                  <dd className="tabular mt-1 text-2xl font-black text-white">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="pulse-session-hero__track pd-enter pd-enter--2">
            {photo
              ? <Image src={photo} alt={`${driver.name} 官方照片`} width={480} height={480} unoptimized priority className="mx-auto max-h-80 w-auto object-contain" />
              : car && <Image src={car} alt={`${driver.constructorName} 赛车`} width={560} height={200} unoptimized className="mx-auto w-full max-w-md object-contain" />}
            <div className="pulse-session-hero__track-meta">
              <span>{driver.constructorName.toUpperCase()}</span>
              {logo && <Image src={logo} alt="" width={90} height={24} unoptimized className="h-6 w-auto opacity-90" />}
            </div>
          </div>
        </div>
        <p className="pulse-session-hero__note pd-enter pd-enter--4">赛季统计只统计已确认的官方结果；未完成的分站不计入。</p>
      </header>

      {!entries.length
        ? <DataStatePanel state="empty" title="本赛季还没有已确认的官方成绩" description="官方结果导入并确认后，逐场成绩会出现在这里。" />
        : <section aria-label="逐场成绩" className="pulse-market-panel min-w-0" data-pulse-reveal>
            <header>
              <p className="pd-eyebrow">SEASON LOG</p>
              <h3 className="kinetic text-3xl">逐场成绩</h3>
            </header>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--line)] text-left text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                    <th scope="col" className="py-2 pr-2">分站</th>
                    <th scope="col" className="py-2 pr-2">场次</th>
                    <th scope="col" className="py-2 pr-2 text-right">名次</th>
                    <th scope="col" className="py-2 pr-2">状态</th>
                    <th scope="col" className="py-2 text-right">积分</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.sessionId} className="border-b rule last:border-0">
                      <td className="py-2 pr-2">
                        <Link href={`/matches/f1/${entry.sessionId}`} className="font-bold hover:underline">
                          <span className="tabular text-[var(--muted)]">R{String(entry.round).padStart(2, "0")}</span> {entry.weekendName}
                        </Link>
                      </td>
                      <td className="py-2 pr-2">{SESSION_KIND_LABELS[entry.kind as F1SessionKind] ?? entry.kind}</td>
                      <td className="tabular py-2 pr-2 text-right font-black">
                        {entry.position !== null ? `P${entry.position}` : "—"}
                        {entry.fastestLap && <span title="全场最快圈" className="ml-1 rounded-full bg-[var(--pulse-carbon)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--pulse-ivory)]">FL</span>}
                      </td>
                      <td className="py-2 pr-2">
                        <span className={entry.status === "FINISHED" ? "" : "font-bold text-[var(--pulse-red-deep)]"}>
                          {CLASSIFICATION_STATUS_LABELS[entry.status as F1ClassificationStatusView] ?? entry.status}
                        </span>
                      </td>
                      <td className="tabular py-2 text-right">{entry.points ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>}
    </div>
  );
}
