import type { MatchView } from "../features/matchday/types";
import { matchAvailability } from "../features/matchday/match-filters";
import { StatusBanner } from "./status-banner";

export function MatchCard({ match, action }: { match: MatchView; action?: React.ReactNode }) {
  const kickoff = new Date(match.kickoffAt);
  const availability = matchAvailability(match);
  const odds = match.market
    ? [{ label: "主胜", value: match.market.home }, { label: "平局", value: match.market.draw }, { label: "客胜", value: match.market.away }]
    : [];
  return <article className="surface overflow-hidden"><header className="flex items-center justify-between gap-3 border-b rule px-4 py-3"><div className="min-w-0"><p className="truncate text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">{match.competitionName}</p><time dateTime={match.kickoffAt} className="tabular mt-1 block text-xs font-bold">{kickoff.toLocaleString("zh-CN", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })}</time></div><span className={`shrink-0 text-xs font-bold ${availability.predictable ? "text-[var(--field)]" : match.stale ? "text-[var(--amber)]" : "text-[var(--muted)]"}`}>{availability.predictable ? "● " : ""}{availability.label}</span></header><div className="p-4"><h2 className="display text-xl font-bold"><span>{match.homeTeam}</span><span className="mx-2 text-sm font-normal text-[var(--muted)]">对</span><span>{match.awayTeam}</span></h2>{odds.length > 0 && <dl className="mt-4 grid grid-cols-3 divide-x divide-[var(--line)] border-y rule py-2" aria-label="虚拟积分倍率">{odds.map((odd) => <div key={odd.label} className="px-2 text-center first:pl-0 last:pr-0"><dt className="text-[10px] font-bold text-[var(--muted)]">{odd.label}</dt><dd className="tabular mt-0.5 text-sm font-black">{odd.value}</dd></div>)}</dl>}{match.stale && <div className="mt-4"><StatusBanner kind="stale" timestamp={match.dataAsOf}/></div>}{!match.stale && match.state === "CLOSED" && <div className="mt-4"><StatusBanner kind="closed"/></div>}{!match.stale && ["PAUSED", "DATA_UNAVAILABLE"].includes(match.state) && <div className="mt-4"><StatusBanner kind="unavailable"/></div>}{action && <details className="mt-5 border-t rule pt-4"><summary className="cursor-pointer font-bold text-[var(--field)]">填写本场判断</summary><div className="mt-5">{action}</div></details>}</div></article>;
}
