"use client";

import { useEffect, useState } from "react";
import { SoccerBall, TeamCrest } from "@/components/football";
import { StatusMessage } from "@/components/status-message";
import {
  describeLineupStatus,
  lineupViewFromPayload,
  positionRows,
  POSITION_LABEL,
  type LineupPlayerView,
  type LineupView,
  type TeamLineupView,
} from "./lineup-types";

const TONE_MAP = { ok: "success", info: "info", warn: "info", error: "error" } as const;
const SIDE_DEFAULT_COLOR = { home: "#1f6feb", away: "#e5484d" } as const;

function discColor(team: TeamLineupView, side: "home" | "away"): string {
  return team.primaryColor ?? SIDE_DEFAULT_COLOR[side];
}

function playerLabel(player: LineupPlayerView): string {
  const parts = [player.number != null ? `${player.number}号` : null, player.name, player.positionRaw ?? POSITION_LABEL[player.position]];
  return parts.filter(Boolean).join(" · ");
}

function PlayerMarker({ player, color }: { player: LineupPlayerView; color: string }) {
  const [photoBroken, setPhotoBroken] = useState(false);
  const showPhoto = Boolean(player.photoUrl) && !photoBroken;
  return (
    <figure className="lineup-marker" aria-label={playerLabel(player)}>
      <span className="lineup-disc" style={{ backgroundColor: color }} data-photo={showPhoto ? "true" : "false"} aria-hidden="true">
        {showPhoto ? (
          // Player photos come from the external supplier CDN (not a bundled asset) and may be blocked
          // by CSP or missing; onError falls back to the jersey number so the pitch never breaks.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={player.photoUrl ?? ""} alt="" loading="lazy" className="lineup-photo" onError={() => setPhotoBroken(true)} />
        ) : null}
        <span className="lineup-number">{player.number ?? "—"}</span>
      </span>
      <figcaption className="lineup-name" title={player.name}>{player.name}</figcaption>
    </figure>
  );
}

function TeamHalf({ team, side }: { team: TeamLineupView; side: "home" | "away" }) {
  const rows = positionRows(team.starters);
  const color = discColor(team, side);
  return (
    <div className={`lineup-half lineup-half-${side}`} aria-label={`${team.name} 首发`}>
      {rows.map((row) => (
        <div key={row.position} className="lineup-row" role="group" aria-label={`${team.name} ${row.label}`}>
          <span className="lineup-row-label" aria-hidden="true">{row.label}</span>
          <div className="lineup-row-players">
            {row.players.map((player) => <PlayerMarker key={player.id} player={player} color={color} />)}
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="lineup-half-empty">未提供首发位置</p>}
    </div>
  );
}

function TeamHeader({ team, side }: { team: TeamLineupView; side: "home" | "away" }) {
  const accent = discColor(team, side);
  return (
    <div className="flex items-center gap-3">
      {team.logoUrl ? (
        // Team logo is an external supplier asset; fall back to the colour-hashed crest on any load failure.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logoUrl} alt="" width={40} height={40} className="size-10 rounded-full bg-white/10 object-contain p-1" onError={(event) => { event.currentTarget.style.display = "none"; }} />
      ) : <TeamCrest name={team.name} className="size-10 text-sm" />}
      <div>
        <p className="flex items-center gap-2 font-bold">
          <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: accent }} aria-hidden="true" />
          {team.name}
        </p>
        <p className="text-xs text-[var(--muted)]">
          {side === "home" ? "主队" : "客队"}
          {team.formation ? ` · 阵型 ${team.formation}` : ""}
          {team.coach ? ` · 主帅 ${team.coach}` : ""}
        </p>
      </div>
    </div>
  );
}

function Bench({ team }: { team: TeamLineupView }) {
  if (team.bench.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--muted)]">{team.name} · 替补 {team.bench.length}</h4>
      <ul className="grid gap-1.5">
        {team.bench.map((player) => (
          <li key={player.id} className="flex items-center gap-2.5 text-sm">
            <span className="tabular inline-grid size-6 shrink-0 place-items-center rounded-md bg-[var(--line)] text-xs font-bold text-[var(--ink)]">{player.number ?? "—"}</span>
            <span className="min-w-0 truncate">{player.name}</span>
            <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">{POSITION_LABEL[player.position]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LineupMap({ matchId }: { matchId: string }) {
  const [view, setView] = useState<LineupView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/matches/${encodeURIComponent(matchId)}/lineup`, {
          credentials: "same-origin",
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error((payload as { error?: { message?: string } } | null)?.error?.message || "阵容数据暂不可用");
        const parsed = lineupViewFromPayload(payload);
        if (!parsed) throw new Error("阵容数据格式异常");
        setView(parsed);
        setError("");
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "阵容数据暂不可用");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [matchId, retry]);

  if (loading) {
    return (
      <section aria-label="比赛阵容" aria-busy="true">
        <div className="pitch-skeleton lineup-pitch rounded-2xl" />
        <span className="sr-only">正在加载阵容</span>
      </section>
    );
  }

  if (error) {
    return (
      <section aria-label="比赛阵容">
        <StatusMessage tone="error" title="暂时无法取得阵容">{error}</StatusMessage>
        <div className="mt-4">
          <button type="button" onClick={() => { setError(""); setLoading(true); setRetry((value) => value + 1); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border-2 border-[var(--ink)] px-5 font-bold transition hover:bg-[var(--ink)] hover:text-white">
            <SoccerBall className="size-4" />重试
          </button>
        </div>
      </section>
    );
  }

  if (!view) return null;

  const status = describeLineupStatus(view);
  const hasTeams = Boolean(view.home && view.away);
  const asOf = view.dataAsOf ? new Date(view.dataAsOf).toLocaleString("zh-CN") : null;

  return (
    <section aria-label="比赛阵容" className="grid gap-6">
      <StatusMessage tone={TONE_MAP[status.tone]} title={status.label}>
        {status.detail}
        {asOf && hasTeams && <span className="mt-1 block text-xs">数据截至 {asOf}</span>}
      </StatusMessage>

      {hasTeams && view.home && view.away ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TeamHeader team={view.home} side="home" />
            <TeamHeader team={view.away} side="away" />
          </div>

          <div className="lineup-pitch pitch-panel rounded-2xl" role="group" aria-label="首发阵型示意图">
            <TeamHalf team={view.away} side="away" />
            <div className="lineup-halfway" aria-hidden="true">
              <SoccerBall className="size-5 text-white/70" />
            </div>
            <TeamHalf team={view.home} side="home" />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <Bench team={view.home} />
            <Bench team={view.away} />
          </div>
        </>
      ) : (
        <div className="lineup-pitch lineup-pitch-empty pitch-panel grid place-items-center rounded-2xl text-center">
          <div className="max-w-xs px-6">
            <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-white/10"><SoccerBall className="size-6 text-white/80" /></span>
            <p className="font-bold text-white">{status.label}</p>
            <p className="mt-2 text-sm leading-6 text-white/70">{status.detail}</p>
          </div>
        </div>
      )}
    </section>
  );
}
