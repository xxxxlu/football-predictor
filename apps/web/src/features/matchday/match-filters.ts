import type { MatchView } from "./types.js";

export type MatchStatusFilter = "ALL" | "PREDICTABLE" | "FINISHED";
export type MatchFilter = { competition?: string; date?: string; timeZone?: string; status?: MatchStatusFilter };

export function matchDateKey(match: MatchView, timeZone?: string) {
  const date = new Date(match.kickoffAt);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function filterMatches(matches: MatchView[], filter: MatchFilter) {
  return matches.filter((match) => {
    const statusMatches = !filter.status || filter.status === "ALL"
      || (filter.status === "PREDICTABLE" && matchAvailability(match).predictable)
      || (filter.status === "FINISHED" && match.state === "FINISHED");
    return statusMatches
      && (!filter.competition || match.competitionName === filter.competition)
      && (!filter.date || matchDateKey(match, filter.timeZone) === filter.date);
  });
}

export function sortMatchesForDisplay(matches: MatchView[]) {
  return [...matches].sort((left, right) => {
    const leftFinished = left.state === "FINISHED";
    const rightFinished = right.state === "FINISHED";
    if (leftFinished !== rightFinished) return leftFinished ? 1 : -1;
    const leftKickoff = new Date(left.kickoffAt).getTime();
    const rightKickoff = new Date(right.kickoffAt).getTime();
    return leftFinished ? rightKickoff - leftKickoff : leftKickoff - rightKickoff;
  });
}

export type DateMatchGroup = { date: string; matches: MatchView[] };
export type CompetitionMatchGroup = { name: string; dates: DateMatchGroup[] };

export function groupMatches(matches: MatchView[], timeZone?: string): CompetitionMatchGroup[] {
  const sorted = sortMatchesForDisplay(matches);
  const competitions = new Map<string, Map<string, MatchView[]>>();
  for (const match of sorted) {
    const date = matchDateKey(match, timeZone) || "unknown";
    const dates = competitions.get(match.competitionName) ?? new Map<string, MatchView[]>();
    const dateMatches = dates.get(date) ?? [];
    dateMatches.push(match);
    dates.set(date, dateMatches);
    competitions.set(match.competitionName, dates);
  }
  return [...competitions].map(([name, dates]) => ({
    name,
    dates: [...dates].map(([date, dateMatches]) => ({ date, matches: dateMatches })),
  }));
}

export function paginateMatches(matches: MatchView[], requestedCount: number) {
  const shown = Math.min(matches.length, Math.max(0, requestedCount));
  return {
    items: matches.slice(0, shown),
    shown,
    total: matches.length,
    remaining: matches.length - shown,
    hasMore: shown < matches.length,
  };
}

export function matchAvailability(match: MatchView) {
  if (match.state === "FINISHED") return { label: "已结束", predictable: false };
  if (match.state === "OPEN" && match.market) return { label: match.stale ? "使用最后有效赔率" : "开放预测", predictable: true };
  const labels: Record<MatchView["state"], string> = { OPEN: "等待积分倍率", PAUSED: "数据同步暂停", CLOSED: "已封盘", DATA_UNAVAILABLE: "数据不可用", FINISHED: "已结束" };
  return { label: labels[match.state], predictable: false };
}

export function summarizeMatches(matches: MatchView[]) {
  return { total: matches.length, open: matches.filter((match) => matchAvailability(match).predictable).length, finished: matches.filter((match) => match.state === "FINISHED").length, stale: matches.filter((match) => match.stale).length };
}

export function datasetNotice(matches: MatchView[]) {
  if (matches.length > 0 && matches.every((match) => match.state === "FINISHED")) {
    return {
      tone: "historical" as const,
      title: "历史赛果",
      detail: "当前展示的是已完赛真实历史数据，仅用于浏览和功能验收，不能提交预测。",
    };
  }
  return null;
}
