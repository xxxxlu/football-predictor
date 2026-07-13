import type { MatchView } from "@/features/matchday/types";
import { StatusBanner } from "./status-banner";

export function MatchCard({ match, action }: { match: MatchView; action?: React.ReactNode }) {
  const kickoff = new Date(match.kickoffAt);
  return <article className="surface overflow-hidden"><header className="flex items-center justify-between gap-3 border-b rule px-4 py-3"><time dateTime={match.kickoffAt} className="tabular text-xs font-bold">{kickoff.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><span className={`text-xs font-bold ${match.state === "OPEN" ? "text-[var(--field)]" : "text-[var(--muted)]"}`}>{stateLabel(match.state)}</span></header><div className="p-4"><h2 className="display text-xl font-bold"><span>{match.homeTeam}</span><span className="mx-2 text-sm font-normal text-[var(--muted)]">对</span><span>{match.awayTeam}</span></h2>{match.stale && <div className="mt-4"><StatusBanner kind="stale" timestamp={match.dataAsOf}/></div>}{match.state === "CLOSED" && <div className="mt-4"><StatusBanner kind="closed"/></div>}{["PAUSED", "DATA_UNAVAILABLE"].includes(match.state) && <div className="mt-4"><StatusBanner kind="unavailable"/></div>}{action && <div className="mt-5">{action}</div>}</div></article>;
}
function stateLabel(state: MatchView["state"]) { return ({ OPEN: "● 开放", PAUSED: "暂停", CLOSED: "已封盘", DATA_UNAVAILABLE: "数据不可用", FINISHED: "已结束" })[state]; }
