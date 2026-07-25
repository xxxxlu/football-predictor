"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { driverPhotoPath, teamCarPath, teamLogoPath } from "./media";
import type { F1DriverSeasonTotals, F1TeamRoundSummary } from "./stats";
import { CLASSIFICATION_STATUS_LABELS, type F1ClassificationStatusView } from "./types";

interface TeamDetailData {
  team: { key: string; name: string; color: string; seasonPoints: number };
  season: number;
  standing: { position: number; of: number };
  drivers: Array<{ code: string; number: number; name: string; seasonPoints: number }>;
  totals: F1DriverSeasonTotals;
  rounds: F1TeamRoundSummary[];
}

function normalize(value: unknown): TeamDetailData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const team = data.team as TeamDetailData["team"] | undefined;
  if (!team || typeof team.key !== "string" || typeof team.name !== "string") return null;
  return {
    team,
    season: typeof data.season === "number" ? data.season : 0,
    standing: (data.standing as TeamDetailData["standing"]) ?? { position: 0, of: 0 },
    drivers: Array.isArray(data.drivers) ? (data.drivers as TeamDetailData["drivers"]) : [],
    totals: (data.totals as F1DriverSeasonTotals) ?? { wins: 0, podiums: 0, poles: 0, sprintWins: 0, fastestLaps: 0, dnfs: 0 },
    rounds: Array.isArray(data.rounds) ? (data.rounds as F1TeamRoundSummary[]) : [],
  };
}

export function F1TeamDetail({ teamKey }: { teamKey: string }) {
  const [data, setData] = useState<TeamDetailData | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/f1/teams/${encodeURIComponent(teamKey)}`, { credentials: "same-origin", signal: controller.signal, cache: "no-store" });
        const result = await response.json().catch(() => ({})) as ApiEnvelope<unknown> & ApiFailure;
        if (response.status === 404) { setNotFound(true); return; }
        if (!response.ok) throw new Error(result.error?.message || "车队数据暂不可用");
        const normalized = normalize(result.data);
        if (!normalized) throw new Error("车队数据格式异常");
        setData(normalized);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "车队数据暂不可用");
      }
    })();
    return () => controller.abort();
  }, [teamKey]);

  if (notFound) return <DataStatePanel state="empty" title="没有找到这支车队" description="请回到 F1 赛程，从车手榜重新选择。" />;
  if (error) return <DataStatePanel state="error" title="车队数据暂不可用" description={error} />;
  if (!data) return <DataStatePanel state="loading" title="正在加载车队档案" description="正在读取赛季成绩与积分。" />;

  const { team, standing, drivers, totals, rounds } = data;
  const logo = teamLogoPath(team.key);
  const car = teamCarPath(team.key);

  return (
    <div className="grid gap-8">
      <header className="pulse-session-hero">
        <div className="pulse-session-hero__grid">
          <div className="pulse-session-hero__copy">
            <p className="pd-eyebrow pd-enter"><span>CONSTRUCTOR PROFILE · {data.season}</span></p>
            <div className="pd-enter pd-enter--1 mt-2 flex flex-wrap items-center gap-4">
              {logo && <Image src={logo} alt="" width={140} height={36} unoptimized className="h-9 w-auto" />}
              <h2 className="kinetic text-[clamp(2.5rem,7vw,5rem)]">{team.name}</h2>
            </div>
            <dl className="pd-enter pd-enter--3 mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {([
                ["车队积分榜", standing.position > 0 ? `P${standing.position}` : "—"],
                ["赛季积分", String(team.seasonPoints)],
                ["分站冠军", String(totals.wins)],
                ["登领奖台", String(totals.podiums)],
                ["杆位", String(totals.poles)],
                ["冲刺冠军", String(totals.sprintWins)],
              ] as const).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-white/60">{label}</dt>
                  <dd className="tabular mt-1 text-2xl font-black text-white">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="pulse-session-hero__track pd-enter pd-enter--2">
            {car && <Image src={car} alt={`${team.name} 2026 赛车`} width={640} height={220} unoptimized priority className="mx-auto w-full max-w-lg object-contain" />}
            <div className="pulse-session-hero__track-meta">
              <span>{team.name.toUpperCase()}</span>
              <i aria-hidden className="inline-block h-2 w-16 rounded-sm" style={{ background: team.color }} />
            </div>
          </div>
        </div>
        <p className="pulse-session-hero__note pd-enter pd-enter--4">车队积分为两位车手赛季积分之和；统计只计入已确认的官方结果。</p>
      </header>

      <section aria-label="车手阵容" className="grid gap-4 sm:grid-cols-2" data-pulse-reveal>
        {drivers.map((driver) => {
          const photo = driverPhotoPath(driver.code);
          return (
            <Link key={driver.code} href={`/matches/f1/drivers/${driver.code}`} className="pulse-market-panel group flex items-center gap-4">
              {photo && <Image src={photo} alt="" width={72} height={72} unoptimized className="size-18 rounded-full bg-[rgb(23_35_59/6%)] object-cover object-top" />}
              <span className="min-w-0">
                <span className="tabular block text-xs font-black" style={{ color: team.color }}>{String(driver.number).padStart(2, "0")} · {driver.code}</span>
                <span className="block truncate text-lg font-bold group-hover:underline">{driver.name}</span>
                <span className="tabular block text-xs text-[var(--muted)]">{driver.seasonPoints} PTS</span>
              </span>
            </Link>
          );
        })}
      </section>

      {!rounds.length
        ? <DataStatePanel state="empty" title="本赛季还没有已确认的官方成绩" description="官方结果导入并确认后，逐站成绩会出现在这里。" />
        : <section aria-label="逐站成绩" className="pulse-market-panel min-w-0" data-pulse-reveal>
            <header>
              <p className="pd-eyebrow">SEASON LOG</p>
              <h3 className="kinetic text-3xl">逐站成绩</h3>
            </header>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--line)] text-left text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                    <th scope="col" className="py-2 pr-2">分站</th>
                    <th scope="col" className="py-2 pr-2">正赛成绩</th>
                    <th scope="col" className="py-2 text-right">当站积分</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((round) => (
                    <tr key={round.round} className="border-b rule last:border-0">
                      <td className="py-2 pr-2">
                        {round.grandPrixSessionId
                          ? <Link href={`/matches/f1/${round.grandPrixSessionId}`} className="font-bold hover:underline">
                              <span className="tabular text-[var(--muted)]">R{String(round.round).padStart(2, "0")}</span> {round.weekendName}
                            </Link>
                          : <span className="font-bold"><span className="tabular text-[var(--muted)]">R{String(round.round).padStart(2, "0")}</span> {round.weekendName}</span>}
                      </td>
                      <td className="py-2 pr-2">
                        {round.drivers.length
                          ? round.drivers.map((line) => (
                              <span key={line.driverCode} className="tabular mr-3 inline-flex items-center gap-1">
                                <span className="font-bold">{line.driverCode}</span>
                                {line.position !== null
                                  ? <span>P{line.position}</span>
                                  : <span className="font-bold text-[var(--pulse-red-deep)]">{CLASSIFICATION_STATUS_LABELS[line.status as F1ClassificationStatusView] ?? line.status}</span>}
                              </span>
                            ))
                          : <span className="text-[var(--muted)]">—</span>}
                      </td>
                      <td className="tabular py-2 text-right font-black">{round.pointsTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>}
    </div>
  );
}
