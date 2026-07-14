import type { MatchView } from "../features/matchday/types";
import { matchAvailability } from "../features/matchday/match-filters";
import { StatusBanner } from "./status-banner";
import { SoccerBall, TeamCrest } from "./football";

export function MatchCard({ match, action }: { match: MatchView; action?: React.ReactNode }) {
  const kickoff = new Date(match.kickoffAt);
  const availability = matchAvailability(match);
  const odds = match.market
    ? [{ label: "主胜", value: match.market.home }, { label: "平局", value: match.market.draw }, { label: "客胜", value: match.market.away }]
    : [];
  const statusTone = availability.predictable ? "text-[var(--field)]" : match.stale ? "text-[var(--amber)]" : "text-[var(--muted)]";

  return (
    <article className="surface field-accent overflow-hidden rounded-xl">
      <header className="flex items-center justify-between gap-3 border-b rule px-4 py-3">
        <span className="league-pill min-w-0">
          <SoccerBall className="size-3.5 shrink-0" />
          <span className="truncate">{match.competitionName}</span>
        </span>
        <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-bold ${statusTone}`}>
          {availability.predictable && <span className="pulse-dot" aria-hidden="true" />}
          {availability.label}
        </span>
      </header>
      <div className="p-4 md:p-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
          <div className="flex flex-col items-center gap-2 text-center">
            <TeamCrest name={match.homeTeam} className="size-12 text-base md:size-14 md:text-lg" />
            <span className="display text-sm font-bold leading-tight md:text-base">{match.homeTeam}</span>
          </div>
          <div className="flex flex-col items-center gap-2 pt-1.5">
            <span className="vs-badge">VS</span>
            <time dateTime={match.kickoffAt} className="tabular block max-w-[6.5rem] text-center text-[11px] font-bold leading-tight text-[var(--muted)]">
              {kickoff.toLocaleString("zh-CN", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })}
            </time>
          </div>
          <div className="flex flex-col items-center gap-2 text-center">
            <TeamCrest name={match.awayTeam} className="size-12 text-base md:size-14 md:text-lg" />
            <span className="display text-sm font-bold leading-tight md:text-base">{match.awayTeam}</span>
          </div>
        </div>
        {odds.length > 0 && (
          <dl className="mt-5 grid grid-cols-3 gap-2" aria-label="虚拟积分倍率">
            {odds.map((odd) => (
              <div key={odd.label} className="scoreboard-cell px-2 py-2 text-center">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">{odd.label}</dt>
                <dd className="tabular mt-0.5 text-lg font-black">{odd.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {match.stale && <div className="mt-4"><StatusBanner kind="stale" timestamp={match.dataAsOf} /></div>}
        {!match.stale && match.state === "CLOSED" && <div className="mt-4"><StatusBanner kind="closed" /></div>}
        {!match.stale && ["PAUSED", "DATA_UNAVAILABLE"].includes(match.state) && <div className="mt-4"><StatusBanner kind="unavailable" /></div>}
        {action && (
          <details className="mt-5 border-t rule pt-4">
            <summary className="flex cursor-pointer items-center gap-2 font-bold text-[var(--field)]">
              <SoccerBall className="size-4" />填写本场判断
            </summary>
            <div className="mt-5">{action}</div>
          </details>
        )}
      </div>
    </article>
  );
}
