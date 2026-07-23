import type { FixtureSnapshot, LineupSnapshot, MatchStatus } from "@football-predictor/domain";

/** Lineups are published close to kickoff; do not spend supplier quota on distant fixtures. */
export const LINEUP_REFRESH_POLICY = {
  scheduledNearKickoffMs: 120 * 60_000,
  scheduledIntervalMs: 15 * 60_000,
  scheduledFarIntervalMs: 6 * 60 * 60_000,
  liveIntervalMs: 5 * 60_000,
} as const;

export type LineupRefreshReason = "NEAR_KICKOFF" | "LIVE" | "RETRY" | "STALE" | "NONE";

export interface LineupGateway {
  fetchLineups(input: { fixtureId: number }): Promise<{ data: LineupSnapshot | null; quota?: { supplierRemaining?: number } }>;
}

export interface LineupRepository {
  getLineup(matchId: string): Promise<LineupSnapshot | null>;
  saveLineup(snapshot: LineupSnapshot): Promise<void>;
}

export interface LineupRefreshInput {
  fixture: Pick<FixtureSnapshot, "id" | "supplierFixtureId" | "status" | "kickoffAt">;
  now: Date;
  lastAttemptAt?: Date | null | undefined;
}

export interface LineupRefreshDecision {
  due: boolean;
  reason: LineupRefreshReason;
  intervalMs: number;
}

function intervalFor(status: MatchStatus, kickoffAt: string, now: Date): number {
  if (status === "LIVE") return LINEUP_REFRESH_POLICY.liveIntervalMs;
  if (status !== "SCHEDULED") return Number.POSITIVE_INFINITY;
  const kickoff = new Date(kickoffAt).getTime();
  const untilKickoff = kickoff - now.getTime();
  return untilKickoff <= LINEUP_REFRESH_POLICY.scheduledNearKickoffMs
    ? LINEUP_REFRESH_POLICY.scheduledIntervalMs
    : LINEUP_REFRESH_POLICY.scheduledFarIntervalMs;
}

export function lineupRefreshDecision(input: LineupRefreshInput): LineupRefreshDecision {
  const intervalMs = intervalFor(input.fixture.status, input.fixture.kickoffAt, input.now);
  if (!Number.isFinite(intervalMs)) return { due: false, reason: "NONE", intervalMs };
  if (!input.lastAttemptAt) return { due: true, reason: input.fixture.status === "LIVE" ? "LIVE" : "NEAR_KICKOFF", intervalMs };
  const age = input.now.getTime() - input.lastAttemptAt.getTime();
  if (!Number.isFinite(age) || age < 0) return { due: true, reason: "RETRY", intervalMs };
  return age >= intervalMs ? { due: true, reason: input.fixture.status === "LIVE" ? "LIVE" : "STALE", intervalMs } : { due: false, reason: "NONE", intervalMs };
}

/** Cache boundary: web reads snapshots; only worker code should call the supplier gateway. */
export class LineupSyncService {
  constructor(private readonly input: { repository: LineupRepository; gateway: LineupGateway; now?: () => Date }) {}

  async refresh(input: { fixture: Pick<FixtureSnapshot, "id" | "supplierFixtureId" | "status" | "kickoffAt">; lastAttemptAt?: Date | null }): Promise<{ snapshot: LineupSnapshot | null; decision: LineupRefreshDecision }> {
    const now = this.input.now?.() ?? new Date();
    const decision = lineupRefreshDecision({ fixture: input.fixture, now, lastAttemptAt: input.lastAttemptAt });
    const cached = await this.input.repository.getLineup(input.fixture.id);
    if (!decision.due) return { snapshot: cached, decision };
    const result = await this.input.gateway.fetchLineups({ fixtureId: input.fixture.supplierFixtureId });
    if (result.data) await this.input.repository.saveLineup(result.data);
    return { snapshot: result.data ?? cached, decision };
  }
}
