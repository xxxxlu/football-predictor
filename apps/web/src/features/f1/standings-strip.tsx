"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { driverPhotoPath, teamLogoPath } from "./media";

interface DriverRow {
  code: string;
  number: number;
  name: string;
  constructorKey: string;
  constructorName: string;
  color: string;
  seasonPoints: number;
}

function normalizeRows(value: unknown): DriverRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): DriverRow[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    if (typeof row.code !== "string" || typeof row.name !== "string" || typeof row.constructorKey !== "string") return [];
    return [{
      code: row.code,
      number: typeof row.number === "number" ? row.number : 0,
      name: row.name,
      constructorKey: row.constructorKey,
      constructorName: typeof row.constructorName === "string" ? row.constructorName : "",
      color: typeof row.color === "string" ? row.color : "#5f635e",
      seasonPoints: typeof row.seasonPoints === "number" ? row.seasonPoints : 0,
    }];
  });
}

/** Entry points into driver/team profiles: current top drivers + all team logos.
 *  Data is the same season standings the timing tower uses; quietly renders
 *  nothing if the entry list is unavailable (the schedule stays primary). */
export function F1StandingsStrip() {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/f1/drivers", { credentials: "same-origin", signal: controller.signal, cache: "no-store" });
        const result = await response.json().catch(() => ({})) as ApiEnvelope<unknown[]> & ApiFailure;
        if (!response.ok) return;
        setDrivers(normalizeRows(result.data));
      } catch { /* strip is auxiliary; schedule list handles errors */ }
    })();
    return () => controller.abort();
  }, []);

  if (!drivers.length) return null;

  const teams = new Map<string, { key: string; name: string; color: string }>();
  for (const driver of drivers) {
    if (!teams.has(driver.constructorKey)) teams.set(driver.constructorKey, { key: driver.constructorKey, name: driver.constructorName, color: driver.color });
  }

  // min-w-0: as a grid item the section must not inherit the card rail's
  // intrinsic width — the rail scrolls (overflow-x-auto) instead.
  return (
    <section aria-label="车手与车队档案" className="night min-w-0 rounded-xl p-5" data-pulse-reveal>
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="pd-eyebrow"><span>DRIVERS &amp; TEAMS</span></p>
          <h3 className="kinetic mt-1 text-2xl text-white">车手榜 · 点开看档案</h3>
        </div>
        <p className="text-xs text-white/60">积分为已确认官方结果的赛季积分</p>
      </header>
      <ol className="mt-4 flex snap-x gap-3 overflow-x-auto pb-2">
        {drivers.slice(0, 10).map((driver, index) => {
          const photo = driverPhotoPath(driver.code);
          return (
            <li key={driver.code} className="snap-start">
              <Link href={`/matches/f1/drivers/${driver.code}`}
                className="group flex w-36 shrink-0 flex-col gap-2 rounded-xl bg-white/5 p-3 transition hover:bg-white/10">
                <span className="flex items-center justify-between">
                  <span className="tabular text-xs font-black text-white/60">P{index + 1}</span>
                  <i aria-hidden className="h-3 w-6 rounded-sm" style={{ background: driver.color }} />
                </span>
                {photo && <Image src={photo} alt="" width={96} height={96} unoptimized className="mx-auto size-20 rounded-full bg-white/10 object-cover object-top" />}
                <span className="min-w-0 text-center">
                  <span className="block truncate text-sm font-bold text-white group-hover:underline">{driver.name}</span>
                  <span className="tabular block text-xs text-white/60">{driver.code} · {driver.seasonPoints} PTS</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <ul className="mt-3 flex flex-wrap gap-2">
        {[...teams.values()].map((team) => {
          const logo = teamLogoPath(team.key);
          return (
            <li key={team.key}>
              <Link href={`/matches/f1/teams/${team.key}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/5 px-4 py-1.5 transition hover:bg-white/10"
                aria-label={`${team.name} 车队档案`}>
                {logo
                  ? <Image src={logo} alt="" width={72} height={20} unoptimized className="h-5 w-auto" />
                  : <span className="text-sm font-bold text-white">{team.name}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
