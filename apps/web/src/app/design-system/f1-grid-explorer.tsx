"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import manifest from "../../../public/design-system/f1/assets-manifest.json";

const logoByTeam: Record<string, string> = {
  Alpine: "2026alpinelogowhite.avif", "Aston Martin": "2026astonmartinlogowhite.avif", Audi: "2026audilogowhite.avif",
  Cadillac: "2026cadillaclogowhite.avif", Ferrari: "2026ferrarilogowhite.avif", Haas: "2026haasf1teamlogowhite.avif",
  McLaren: "2026mclarenlogowhite.avif", Mercedes: "2026mercedeslogowhite.avif", "Racing Bulls": "2026racingbullslogowhite.avif",
  "Red Bull Racing": "2026redbullracinglogowhite.avif", Williams: "2026williamslogowhite.avif",
};
const teamLogo = (team: string) => logoByTeam[team] ? `/design-system/f1/motorcade-logo/${logoByTeam[team]}` : undefined;

export function F1GridExplorer() {
  const teams = useMemo(() => ["ALL", ...Array.from(new Set(manifest.drivers.map((driver) => driver.team)))], []);
  const [activeTeam, setActiveTeam] = useState("ALL");
  const drivers = activeTeam === "ALL" ? manifest.drivers : manifest.drivers.filter((driver) => driver.team === activeTeam);
  return <div className="pd-grid-explorer">
    <div className="pd-grid-toolbar" role="group" aria-label="按车队筛选车手">
      {teams.map((team) => <button key={team} type="button" className={activeTeam === team ? "is-active" : ""} onClick={() => setActiveTeam(team)}>{team === "ALL" ? "全部车手" : team}</button>)}
      <span className="pd-grid-count">{drivers.length} / {manifest.drivers.length} DRIVERS</span>
    </div>
    <div className="pd-driver-gallery pd-driver-gallery--interactive">
      {drivers.map((driver) => { const logo = teamLogo(driver.team); return <article className="pd-media-tile pd-media-tile--driver pd-driver-card" key={driver.slug}>
        <div className="pd-driver-photo"><Image src={driver.localPath} alt={driver.name} width={driver.width} height={driver.height} sizes="(max-width: 767px) 50vw, 25vw" /><code>{String(driver.number).padStart(2, "0")}</code>{logo ? <Image className="pd-driver-team-logo" src={logo} alt={`${driver.team} logo`} width={120} height={60} /> : null}</div>
        <div className="pd-media-tile-copy"><span><b>{driver.name}</b><small>{driver.team}</small></span><span className="pd-driver-status">READY · GRID</span></div>
      </article>; })}
    </div>
  </div>;
}
