export type SettlementOutcome = "WIN" | "LOSS" | "PUSH" | "CANCEL";

export type CrossCompetitionRecord = {
  ticketId: string;
  room: { id: string; name: string };
  competition: { id: string; name: string; season: number };
  fixture: { id: string; homeTeam: string; awayTeam: string; kickoffAt: string };
  selection: "HOME" | "DRAW" | "AWAY";
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
