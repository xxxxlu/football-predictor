export type SettlementOutcome = "WIN" | "LOSS" | "PUSH" | "CANCEL";

export type CrossCompetitionRecord = {
  ticketId: string;
  room: { id: string; name: string };
  competition: { id: string; name: string; season: number };
  fixture: { id: string; homeTeam: string; awayTeam: string; kickoffAt: string };
  selection: string;
  stakePoints: string;
  settlement: { outcome: SettlementOutcome; grossReturnPoints: string; version: string; settledAt: string; ledgerId: string; auditId: string };
};

export function competitionFilterOptions(records: CrossCompetitionRecord[]) {
  const choices = new Map<string, string>();
  for (const record of records) {
    const key = competitionKey(record);
    choices.set(key, `${record.competition.name} · ${record.competition.season}`);
  }
  return [...choices].map(([key, label]) => ({ key, label })).sort((left, right) => left.key.localeCompare(right.key, "en", { numeric: true }));
}

export function filterHistoryRecords(records: CrossCompetitionRecord[], filter: string) {
  return filter ? records.filter((record) => competitionKey(record) === filter) : records;
}

function competitionKey(record: CrossCompetitionRecord) {
  return `${record.competition.id}:${record.competition.season}`;
}

/**
 * 战绩封面卡的数字（§15.1）。
 *
 * 净积分只能从 `records` 逐条累加，而档案接口是 `LIMIT 500` 的。所以这里一并
 * 返回 `covered` 和 `truncated`：命中率和结算笔数用服务端 summary（永远准确），
 * 净积分标明它覆盖的是最近多少笔，不把一个可能不完整的合计当成生涯总分。
 */
export function seasonCover(
  summary: { settledTickets: number; wins: number; losses: number; voids: number },
  records: CrossCompetitionRecord[],
) {
  let net = 0;
  for (const record of records) net += Number(record.settlement.grossReturnPoints) - Number(record.stakePoints);
  const decided = summary.wins + summary.losses;
  const seasons = [...new Set(records.map((record) => record.competition.season))].sort((left, right) => left - right);
  return {
    net: Number.isFinite(net) ? net : 0,
    covered: records.length,
    truncated: records.length < summary.settledTickets,
    /** 命中率分母排除走盘/取消——它们不是判断错，只是没有结果。 */
    hitRate: decided > 0 ? summary.wins / decided : null,
    decided,
    seasonLabel: seasons.length === 0 ? "" : seasons.length === 1 ? String(seasons[0]) : `${seasons[0]}–${seasons[seasons.length - 1]}`,
  };
}
