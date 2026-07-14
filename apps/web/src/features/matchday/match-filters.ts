import type { MatchView } from "./types.js";

export type MatchFilter = { competition?: string; date?: string; timeZone?: string };

export function matchDateKey(match: MatchView, timeZone?: string) {
  const date = new Date(match.kickoffAt);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function filterMatches(matches: MatchView[], filter: MatchFilter) {
  return matches.filter((match) => (!filter.competition || match.competitionName === filter.competition) && (!filter.date || matchDateKey(match, filter.timeZone) === filter.date));
}

export function matchAvailability(match: MatchView) {
  if (match.state === "FINISHED") return { label: "已结束", predictable: false };
  if (match.stale) return { label: "赔率已过期", predictable: false };
  if (match.state === "OPEN" && match.market) return { label: "开放预测", predictable: true };
  const labels: Record<MatchView["state"], string> = { OPEN: "等待赔率", PAUSED: "数据同步暂停", CLOSED: "已封盘", DATA_UNAVAILABLE: "数据不可用", FINISHED: "已结束" };
  return { label: labels[match.state], predictable: false };
}

export function summarizeMatches(matches: MatchView[]) {
  return { total: matches.length, open: matches.filter((match) => match.state === "OPEN" && !match.stale).length, finished: matches.filter((match) => match.state === "FINISHED").length, stale: matches.filter((match) => match.stale).length };
}
