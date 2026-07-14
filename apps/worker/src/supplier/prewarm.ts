import type { SupplierJob, SupplierJobResult } from "./handler.js";

export type CompetitionTarget = { leagueId: number; season: number };

export class PrewarmConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "PrewarmConfigurationError"; }
}

export function validatePrewarmEnvironment(environment: Record<string, string | undefined>) {
  const missing = ["DATABASE_URL", "API_FOOTBALL_KEY"].filter((key) => !environment[key]?.trim());
  if (missing.length) throw new PrewarmConfigurationError(`Missing required environment variables: ${missing.join(", ")}. Copy .env.example to .env and set the server-only values.`);
}

export function validatePrewarmCompetitions(targets: CompetitionTarget[]) {
  if (!targets.length) throw new PrewarmConfigurationError("At least one supplier competition is required for prewarm.");
  if (targets.length > 30) throw new PrewarmConfigurationError("Supplier prewarm supports at most 30 competitions per run under the daily static-request allocation.");
}

type FixtureTarget = { id: string; supplierFixtureId: number; competitionId: number; season: number; kickoffAt: string; status: "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED"; oddsDataAsOf?: string };
type Dependencies = {
  competitions: CompetitionTarget[]; bookmakerId: number; pastDays: number; futureDays: number;
  referenceDate?: Date;
  clock: { now(): Date };
  supplier: { run(job: SupplierJob): Promise<SupplierJobResult>; close(): Promise<void> };
  fixtures: { listFixtures(): Promise<FixtureTarget[]> };
  budget: { snapshot(at: Date): Promise<{ remaining: number; protectedRemaining: number }> };
};

const DAY_MS = 86_400_000;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

export async function runSupplierPrewarm(dependencies: Dependencies) {
  validatePrewarmCompetitions(dependencies.competitions);
  const now = dependencies.clock.now(); const windowReference = dependencies.referenceDate ?? now; const from = dateOnly(new Date(windowReference.getTime() - dependencies.pastDays * DAY_MS)); const to = dateOnly(new Date(windowReference.getTime() + dependencies.futureDays * DAY_MS));
  let fixturesSynced = 0; let oddsSynced = 0; let oddsSkipped = 0;
  try {
    const calibration = await dependencies.supplier.run({ type: "STATUS_CALIBRATE", attempt: 0, payload: {} });
    if (calibration.outcome !== "SUCCESS") throw new Error(`Supplier prewarm job STATUS_CALIBRATE did not succeed (${calibration.outcome}).`);
    for (const competition of dependencies.competitions) {
      const result = await dependencies.supplier.run({ type: "FIXTURES", attempt: 0, payload: { ...competition, from, to } });
      if (result.outcome !== "SUCCESS") throw new Error(`Supplier prewarm job FIXTURES did not succeed for league ${competition.leagueId} (${result.outcome}).`);
      fixturesSynced += result.synced;
    }
    const selected = new Set(dependencies.competitions.map(({ leagueId, season }) => `${leagueId}:${season}`));
    const nowMs = now.getTime(); const maxMs = nowMs + dependencies.futureDays * DAY_MS;
    const candidates = (await dependencies.fixtures.listFixtures()).filter((fixture) => { const kickoff = new Date(fixture.kickoffAt).getTime(); return fixture.status === "SCHEDULED" && selected.has(`${fixture.competitionId}:${fixture.season}`) && Number.isFinite(kickoff) && kickoff > nowMs && kickoff <= maxMs; }).sort((left, right) => new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime() || left.id.localeCompare(right.id));
    const targets = candidates.filter((fixture) => { if (!fixture.oddsDataAsOf) return true; const age = nowMs - new Date(fixture.oddsDataAsOf).getTime(); return !Number.isFinite(age) || age < 0 || age > 10 * 60_000; });
    oddsSkipped = candidates.length - targets.length;
    const groups = new Map<string, { leagueId: number; season: number; date: string; fixtureCount: number; kickoffAt: string }>();
    for (const fixture of targets) {
      const date = dateOnly(new Date(fixture.kickoffAt)); const key = `${fixture.competitionId}:${fixture.season}:${date}`;
      const current = groups.get(key);
      if (current) { current.fixtureCount += 1; if (fixture.kickoffAt < current.kickoffAt) current.kickoffAt = fixture.kickoffAt; }
      else groups.set(key, { leagueId: fixture.competitionId, season: fixture.season, date, fixtureCount: 1, kickoffAt: fixture.kickoffAt });
    }
    const orderedGroups = [...groups.values()].sort((left, right) => left.kickoffAt.localeCompare(right.kickoffAt) || left.leagueId - right.leagueId);
    for (const [groupIndex, group] of orderedGroups.entries()) {
      let page = 1; let groupSynced = 0; let completed = false;
      while (true) {
        const result = await dependencies.supplier.run({ type: "PREMATCH_ODDS_BATCH", attempt: 0, payload: { leagueId: group.leagueId, season: group.season, date: group.date, bookmakerId: dependencies.bookmakerId, page } });
        if (result.outcome !== "SUCCESS") {
          oddsSkipped += group.fixtureCount + orderedGroups.slice(groupIndex + 1).reduce((sum, item) => sum + item.fixtureCount, 0);
          completed = false;
          break;
        }
        groupSynced += result.synced;
        if (result.nextPage === undefined) { completed = true; break; }
        page = result.nextPage;
      }
      oddsSynced += groupSynced;
      if (completed) oddsSkipped += Math.max(0, group.fixtureCount - groupSynced);
      else break;
    }
    const budget = await dependencies.budget.snapshot(dependencies.clock.now());
    return { competitionsSynced: dependencies.competitions.length, fixturesSynced, oddsSynced, oddsSkipped, budgetRemaining: budget.remaining, settlementProtected: budget.protectedRemaining };
  } finally { await dependencies.supplier.close(); }
}
