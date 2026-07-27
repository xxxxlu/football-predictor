"use client";

import Image from "next/image";
import Link from "next/link";
import { driverPhotoPath } from "./media";
import {
  CLASSIFICATION_STATUS_LABELS,
  type F1DriverView,
  type F1SessionKind,
  type F1SessionResultView,
} from "./types";

/** Official classification of a finished session. Rows come verbatim from the
 *  confirmed result version — no derived or padded placement. */
export function F1ResultsTable({ kind, result, driverIndex }: {
  kind: F1SessionKind;
  result: F1SessionResultView;
  driverIndex: Map<string, F1DriverView>;
}) {
  const isRace = kind === "GRAND_PRIX" || kind === "SPRINT";
  const hasPoints = isRace && result.classification.some((entry) => (entry.points ?? 0) > 0);
  return (
    <section aria-label="官方完赛结果" className="pulse-market-panel min-w-0" data-pulse-reveal>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pd-eyebrow">OFFICIAL CLASSIFICATION</p>
          <h3 className="kinetic text-3xl">官方结果</h3>
        </div>
        <p className="text-xs text-[var(--muted)]">
          结果版本 v{result.version}
          {result.confirmedAt && <> · 确认于 <time dateTime={result.confirmedAt}>{new Date(result.confirmedAt).toLocaleString("zh-CN")}</time></>}
        </p>
      </header>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-[var(--line)] text-left text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
              <th scope="col" className="py-2 pr-2">名次</th>
              <th scope="col" className="py-2 pr-2">车手</th>
              {isRace && <th scope="col" className="py-2 pr-2 text-right">发车</th>}
              {isRace && <th scope="col" className="py-2 pr-2 text-right">圈数</th>}
              <th scope="col" className="py-2 pr-2 text-right">{isRace ? "用时 / 差距" : "最佳圈速"}</th>
              <th scope="col" className="py-2 pr-2">状态</th>
              {hasPoints && <th scope="col" className="py-2 text-right">积分</th>}
            </tr>
          </thead>
          <tbody>
            {result.classification.map((entry) => {
              const driver = driverIndex.get(entry.driverCode);
              const photo = driverPhotoPath(entry.driverCode);
              return (
                <tr key={entry.driverCode} className="border-b rule last:border-0">
                  <td className="tabular py-2 pr-2 font-black">
                    {entry.position !== null ? String(entry.position).padStart(2, "0") : "—"}
                  </td>
                  <td className="py-2 pr-2">
                    <Link href={`/matches/f1/drivers/${entry.driverCode}`} className="group flex min-w-0 items-center gap-2">
                      <i aria-hidden className="h-5 w-1 shrink-0 rounded-sm" style={{ background: driver?.color ?? "var(--muted)" }} />
                      {photo && (
                        <Image src={photo} alt="" width={28} height={28} unoptimized
                          className="size-7 shrink-0 rounded-full bg-[var(--wash-neutral-soft)] object-cover object-top" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-bold group-hover:underline">{driver?.name ?? entry.driverCode}</span>
                        <span className="block truncate text-[10px] uppercase text-[var(--muted)]">{entry.driverCode}{driver?.constructorName ? ` · ${driver.constructorName}` : ""}</span>
                      </span>
                      {entry.fastestLap && <span title="全场最快圈" aria-label="全场最快圈" className="ml-1 shrink-0 rounded-full bg-[var(--pulse-carbon)] px-2 py-0.5 text-[10px] font-bold text-[var(--pulse-ivory)]">FL</span>}
                    </Link>
                  </td>
                  {isRace && <td className="tabular py-2 pr-2 text-right text-[var(--muted)]">{entry.grid ?? "—"}</td>}
                  {isRace && <td className="tabular py-2 pr-2 text-right">{entry.lapsCompleted}</td>}
                  <td className="tabular py-2 pr-2 text-right">{entry.timeText ?? "—"}</td>
                  <td className="py-2 pr-2">
                    <span className={entry.status === "FINISHED" ? "text-[var(--ink)]" : "font-bold text-[var(--pulse-red-deep)]"}>
                      {CLASSIFICATION_STATUS_LABELS[entry.status]}
                    </span>
                  </td>
                  {hasPoints && <td className="tabular py-2 text-right font-black">{entry.points ?? 0}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
