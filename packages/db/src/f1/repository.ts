import { and, asc, eq } from "drizzle-orm";
import {
  F1_SUPPLIER,
  F1_SUPPLIER_MARKET_IDS,
  parseF1MarketId,
  parseF1Selection,
  f1FixtureId,
  type F1ClassificationEntry,
  type F1ClassificationStatus,
  type F1Constructor,
  type F1Driver,
  type F1MarketKind,
  type F1RaceWeekend,
  type F1Session,
  type F1SessionKind,
  type F1SessionState,
  type MarketForSubmission,
  type PredictionSelection,
} from "@football-predictor/domain";
import type { IdentityDatabase } from "../identity/repository.js";
import type { MarketSnapshotPort } from "../predictions/repository.js";
import { f1Constructors, f1Drivers, f1MarketOdds, f1Markets, f1RaceWeekends, f1SessionResults, f1Sessions } from "./schema.js";

export interface F1WeekendUpsert {
  id: string;
  season: number;
  round: number;
  name: string;
  circuitKey: string;
  isSprintWeekend: boolean;
  sessions: Array<{ id: string; kind: F1SessionKind; startsAt: string }>;
}

export interface F1OddsPublish {
  sessionId: string;
  kind: F1MarketKind;
  version: string;
  dataAsOf: string;
  outcomes: Array<{ selection: string; decimalOdds: string }>;
  now: Date;
}

export class DrizzleF1Repository {
  constructor(private readonly db: IdentityDatabase) {}

  async upsertEntryList(input: { constructors: readonly F1Constructor[]; drivers: readonly F1Driver[]; now: Date }): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const constructor of input.constructors) {
        await tx.insert(f1Constructors)
          .values({ key: constructor.key, name: constructor.name, color: constructor.color, updatedAt: input.now })
          .onConflictDoUpdate({ target: f1Constructors.key, set: { name: constructor.name, color: constructor.color, updatedAt: input.now } });
      }
      for (const driver of input.drivers) {
        await tx.insert(f1Drivers)
          .values({ code: driver.code, number: driver.number, name: driver.name, constructorKey: driver.constructorKey, active: driver.active, updatedAt: input.now })
          .onConflictDoUpdate({
            target: f1Drivers.code,
            set: { number: driver.number, name: driver.name, constructorKey: driver.constructorKey, active: driver.active, updatedAt: input.now },
          });
      }
    });
  }

  async upsertWeekend(input: F1WeekendUpsert, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [weekend] = await tx.insert(f1RaceWeekends)
        .values({ id: input.id, season: input.season, round: input.round, name: input.name, circuitKey: input.circuitKey, isSprintWeekend: input.isSprintWeekend, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [f1RaceWeekends.season, f1RaceWeekends.round],
          set: { name: input.name, circuitKey: input.circuitKey, isSprintWeekend: input.isSprintWeekend, updatedAt: now },
        })
        .returning({ id: f1RaceWeekends.id });
      if (!weekend) throw new Error("F1 weekend upsert returned no row");
      for (const session of input.sessions) {
        await tx.insert(f1Sessions)
          .values({ id: session.id, weekendId: weekend.id, kind: session.kind, startsAt: new Date(session.startsAt), createdAt: now, updatedAt: now })
          .onConflictDoUpdate({
            target: [f1Sessions.weekendId, f1Sessions.kind],
            set: { startsAt: new Date(session.startsAt), updatedAt: now },
          });
      }
    });
  }

  async listWeekends(season: number): Promise<F1RaceWeekend[]> {
    const rows = await this.db.select().from(f1RaceWeekends)
      .where(eq(f1RaceWeekends.season, season)).orderBy(asc(f1RaceWeekends.round));
    if (rows.length === 0) return [];
    const sessions = await this.db.select().from(f1Sessions)
      .innerJoin(f1RaceWeekends, eq(f1RaceWeekends.id, f1Sessions.weekendId))
      .where(eq(f1RaceWeekends.season, season)).orderBy(asc(f1Sessions.startsAt));
    return rows.map((weekend) => ({
      id: weekend.id,
      season: weekend.season,
      round: weekend.round,
      name: weekend.name,
      circuitKey: weekend.circuitKey,
      isSprintWeekend: weekend.isSprintWeekend,
      sessions: sessions.filter((row) => row.sessions.weekendId === weekend.id).map((row) => mapSession(row.sessions)),
    }));
  }

  async getSession(sessionId: string): Promise<F1Session | null> {
    const [row] = await this.db.select().from(f1Sessions).where(eq(f1Sessions.id, sessionId)).limit(1);
    return row ? mapSession(row) : null;
  }

  async setSessionState(sessionId: string, state: F1SessionState, now: Date): Promise<void> {
    await this.db.update(f1Sessions).set({ state, updatedAt: now }).where(eq(f1Sessions.id, sessionId));
  }

  /** Publishes a new immutable odds version for one session market and points the
   *  market at it. The market row is created on first publish. */
  async publishMarketOdds(input: F1OddsPublish): Promise<void> {
    const marketId = `f1:${input.sessionId}:${input.kind}`;
    await this.db.transaction(async (tx) => {
      await tx.insert(f1Markets)
        .values({ id: marketId, sessionId: input.sessionId, kind: input.kind, status: "OPEN", currentVersion: null, updatedAt: input.now })
        .onConflictDoNothing({ target: f1Markets.id });
      await tx.insert(f1MarketOdds)
        .values({ marketId, version: input.version, dataAsOf: new Date(input.dataAsOf), outcomes: input.outcomes, createdAt: input.now });
      await tx.update(f1Markets).set({ currentVersion: input.version, updatedAt: input.now }).where(eq(f1Markets.id, marketId));
    });
  }

  async setMarketStatus(sessionId: string, status: "OPEN" | "CLOSED" | "SETTLED" | "CANCELLED", now: Date): Promise<void> {
    await this.db.update(f1Markets).set({ status, updatedAt: now }).where(eq(f1Markets.sessionId, sessionId));
  }

  /** Read model for the session page: session + weekend, the active entry list with
   *  team identity, and every market with its current immutable odds version. */
  async getSessionDetail(sessionId: string): Promise<F1SessionDetail | null> {
    const [row] = await this.db.select({ session: f1Sessions, weekend: f1RaceWeekends }).from(f1Sessions)
      .innerJoin(f1RaceWeekends, eq(f1RaceWeekends.id, f1Sessions.weekendId))
      .where(eq(f1Sessions.id, sessionId)).limit(1);
    if (!row) return null;
    const drivers = await this.db.select({
      code: f1Drivers.code,
      number: f1Drivers.number,
      name: f1Drivers.name,
      constructorKey: f1Drivers.constructorKey,
      constructorName: f1Constructors.name,
      color: f1Constructors.color,
      seasonPoints: f1Drivers.seasonPoints,
    }).from(f1Drivers)
      .innerJoin(f1Constructors, eq(f1Constructors.key, f1Drivers.constructorKey))
      .where(eq(f1Drivers.active, true));
    const markets = await this.db.select({
      id: f1Markets.id,
      kind: f1Markets.kind,
      status: f1Markets.status,
      version: f1MarketOdds.version,
      dataAsOf: f1MarketOdds.dataAsOf,
      outcomes: f1MarketOdds.outcomes,
    }).from(f1Markets)
      .innerJoin(f1MarketOdds, and(eq(f1MarketOdds.marketId, f1Markets.id), eq(f1MarketOdds.version, f1Markets.currentVersion)))
      .where(eq(f1Markets.sessionId, sessionId));
    const session = mapSession(row.session);
    let result: F1SessionDetail["result"] = null;
    // State guard: a confirmed classification is only presentable once the session
    // itself is FINISHED — inconsistent rows (e.g. crossed seeds) must not leak a
    // "result" onto a predictable session.
    if (session.resultVersion !== null && session.resultConfirmed && session.state === "FINISHED") {
      const [resultRow] = await this.db.select({
        version: f1SessionResults.version,
        confirmedAt: f1SessionResults.confirmedAt,
        classification: f1SessionResults.classification,
      }).from(f1SessionResults)
        .where(and(eq(f1SessionResults.sessionId, sessionId), eq(f1SessionResults.version, session.resultVersion)))
        .limit(1);
      if (resultRow) {
        result = {
          version: resultRow.version,
          confirmedAt: resultRow.confirmedAt ? resultRow.confirmedAt.toISOString() : null,
          classification: parseClassificationEntries(resultRow.classification),
        };
      }
    }
    return {
      session,
      weekend: {
        id: row.weekend.id,
        season: row.weekend.season,
        round: row.weekend.round,
        name: row.weekend.name,
        circuitKey: row.weekend.circuitKey,
        isSprintWeekend: row.weekend.isSprintWeekend,
      },
      drivers: drivers.sort((a, b) => b.seasonPoints - a.seasonPoints || a.number - b.number),
      markets: markets.map((market) => ({
        id: market.id,
        kind: market.kind as F1MarketKind,
        status: market.status,
        version: market.version,
        dataAsOf: market.dataAsOf.toISOString(),
        outcomes: decodeRawOutcomes(market.kind as F1MarketKind, market.outcomes),
      })),
      result,
    };
  }

  /** Entry list with team identity, sorted like the timing tower. */
  async listDrivers(): Promise<F1DriverWithTeam[]> {
    const drivers = await this.db.select({
      code: f1Drivers.code,
      number: f1Drivers.number,
      name: f1Drivers.name,
      constructorKey: f1Drivers.constructorKey,
      constructorName: f1Constructors.name,
      color: f1Constructors.color,
      seasonPoints: f1Drivers.seasonPoints,
    }).from(f1Drivers)
      .innerJoin(f1Constructors, eq(f1Constructors.key, f1Drivers.constructorKey))
      .where(eq(f1Drivers.active, true));
    return drivers.sort((a, b) => b.seasonPoints - a.seasonPoints || a.number - b.number);
  }

  /** Confirmed session results for one season, oldest first — the read model behind
   *  weekend podium chips and driver/team season pages. */
  async listConfirmedSessionResults(season: number): Promise<F1ConfirmedSessionResult[]> {
    const rows = await this.db.select({
      sessionId: f1Sessions.id,
      kind: f1Sessions.kind,
      startsAt: f1Sessions.startsAt,
      round: f1RaceWeekends.round,
      weekendId: f1RaceWeekends.id,
      weekendName: f1RaceWeekends.name,
      circuitKey: f1RaceWeekends.circuitKey,
      classification: f1SessionResults.classification,
    }).from(f1SessionResults)
      .innerJoin(f1Sessions, and(eq(f1Sessions.id, f1SessionResults.sessionId), eq(f1Sessions.resultVersion, f1SessionResults.version)))
      .innerJoin(f1RaceWeekends, eq(f1RaceWeekends.id, f1Sessions.weekendId))
      .where(and(eq(f1RaceWeekends.season, season), eq(f1Sessions.resultConfirmed, true)))
      .orderBy(asc(f1RaceWeekends.round), asc(f1Sessions.startsAt));
    return rows.map((row) => ({
      sessionId: row.sessionId,
      kind: row.kind as F1SessionKind,
      startsAt: row.startsAt.toISOString(),
      round: row.round,
      weekendId: row.weekendId,
      weekendName: row.weekendName,
      circuitKey: row.circuitKey,
      classification: parseClassificationEntries(row.classification),
    }));
  }
}

export interface F1DriverWithTeam {
  code: string;
  number: number;
  name: string;
  constructorKey: string;
  constructorName: string;
  color: string;
  seasonPoints: number;
}

export interface F1ConfirmedSessionResult {
  sessionId: string;
  kind: F1SessionKind;
  startsAt: string;
  round: number;
  weekendId: string;
  weekendName: string;
  circuitKey: string;
  classification: F1ClassificationEntry[];
}

const CLASSIFICATION_STATUSES: ReadonlySet<string> = new Set(["FINISHED", "DNF", "DNS", "DSQ"]);

/** Defensive jsonb → classification parse: a malformed entry drops rather than
 *  poisoning the whole result. */
export function parseClassificationEntries(value: unknown): F1ClassificationEntry[] {
  const decoded = typeof value === "string" ? safeParseJson(value) : value;
  if (!Array.isArray(decoded)) return [];
  return decoded.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.driverCode !== "string") return [];
    if (typeof entry.status !== "string" || !CLASSIFICATION_STATUSES.has(entry.status)) return [];
    const position = typeof entry.position === "number" && Number.isInteger(entry.position) ? entry.position : null;
    const mapped: F1ClassificationEntry = {
      driverCode: entry.driverCode,
      position,
      status: entry.status as F1ClassificationStatus,
      lapsCompleted: typeof entry.lapsCompleted === "number" && Number.isInteger(entry.lapsCompleted) ? entry.lapsCompleted : 0,
    };
    if (typeof entry.points === "number" && Number.isFinite(entry.points)) mapped.points = entry.points;
    if (typeof entry.timeText === "string") mapped.timeText = entry.timeText;
    if (entry.fastestLap === true) mapped.fastestLap = true;
    if (typeof entry.grid === "number" && Number.isInteger(entry.grid)) mapped.grid = entry.grid;
    return [mapped];
  });
}

export interface F1SessionDetail {
  session: F1Session;
  weekend: { id: string; season: number; round: number; name: string; circuitKey: string; isSprintWeekend: boolean };
  drivers: Array<{ code: string; number: number; name: string; constructorKey: string; constructorName: string; color: string; seasonPoints: number }>;
  markets: Array<{ id: string; kind: F1MarketKind; status: string; version: string; dataAsOf: string; outcomes: Array<{ selection: string; decimalOdds: string }> }>;
  /** Confirmed official classification, null until a result version is confirmed. */
  result: { version: number; confirmedAt: string | null; classification: F1ClassificationEntry[] } | null;
}

function decodeRawOutcomes(kind: F1MarketKind, value: unknown): Array<{ selection: string; decimalOdds: string }> {
  const decoded = typeof value === "string" ? safeParseJson(value) : value;
  if (!Array.isArray(decoded)) return [];
  return decoded.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const outcome = candidate as { selection?: unknown; decimalOdds?: unknown };
    if (typeof outcome.selection !== "string" || typeof outcome.decimalOdds !== "string") return [];
    if (parseF1Selection(kind, outcome.selection) === null) return [];
    return [{ selection: outcome.selection, decimalOdds: outcome.decimalOdds }];
  });
}

/** MarketSnapshotPort over the f1 schema: resolves canonical `f1:<sessionId>:<KIND>`
 *  ids to the platform's current immutable odds version. Mirrors the football
 *  supplier adapter's OPEN/CLOSED/DATA_UNAVAILABLE mapping. */
export class F1MarketSnapshotAdapter implements MarketSnapshotPort {
  constructor(private readonly db: IdentityDatabase) {}

  async getMarket(marketId: string, transaction: IdentityDatabase = this.db): Promise<MarketForSubmission | null> {
    const parsed = parseF1MarketId(marketId);
    if (!parsed) return null;
    const [row] = await transaction.select({
      marketId: f1Markets.id,
      sessionId: f1Markets.sessionId,
      kind: f1Markets.kind,
      marketStatus: f1Markets.status,
      sessionState: f1Sessions.state,
      startsAt: f1Sessions.startsAt,
      version: f1MarketOdds.version,
      dataAsOf: f1MarketOdds.dataAsOf,
      outcomes: f1MarketOdds.outcomes,
    }).from(f1Markets)
      .innerJoin(f1Sessions, eq(f1Sessions.id, f1Markets.sessionId))
      .innerJoin(f1MarketOdds, and(eq(f1MarketOdds.marketId, f1Markets.id), eq(f1MarketOdds.version, f1Markets.currentVersion)))
      .where(eq(f1Markets.id, marketId))
      .limit(1)
      .for("share");
    if (!row) return null;
    const kind = row.kind as F1MarketKind;
    const open = row.marketStatus === "OPEN" && row.sessionState === "UPCOMING";
    return {
      id: row.marketId,
      fixtureId: f1FixtureId(row.sessionId),
      status: open ? "OPEN" : "CLOSED",
      kickoffAt: row.startsAt.toISOString(),
      snapshot: {
        version: row.version,
        dataAsOf: row.dataAsOf.toISOString(),
        supplier: F1_SUPPLIER,
        supplierFixtureId: 0,
        bookmakerId: 0,
        marketId: F1_SUPPLIER_MARKET_IDS[kind],
        outcomes: decodeOutcomes(kind, row.outcomes),
        sourceVerified: true,
      },
    };
  }
}

/** Routes market lookups by id namespace so football and F1 submissions share one
 *  TicketSubmissionService: `f1:*` → the F1 adapter, everything else → football. */
export class SportDispatchingSnapshotAdapter implements MarketSnapshotPort {
  constructor(private readonly football: MarketSnapshotPort, private readonly f1: MarketSnapshotPort) {}
  getMarket(marketId: string, transaction?: IdentityDatabase): Promise<MarketForSubmission | null> {
    return marketId.startsWith("f1:") ? this.f1.getMarket(marketId, transaction) : this.football.getMarket(marketId, transaction);
  }
}

function decodeOutcomes(kind: F1MarketKind, value: unknown): MarketForSubmission["snapshot"]["outcomes"] {
  const decoded = typeof value === "string" ? safeParseJson(value) : value;
  if (!Array.isArray(decoded)) return [];
  return decoded.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const outcome = candidate as { selection?: unknown; decimalOdds?: unknown };
    if (typeof outcome.selection !== "string" || typeof outcome.decimalOdds !== "string") return [];
    if (parseF1Selection(kind, outcome.selection) === null) return [];
    return [{ selection: outcome.selection as PredictionSelection, decimalOdds: outcome.decimalOdds }];
  });
}

function safeParseJson(value: string): unknown {
  try { return JSON.parse(value); }
  catch { return value; }
}

function mapSession(row: typeof f1Sessions.$inferSelect): F1Session {
  return {
    id: row.id,
    weekendId: row.weekendId,
    kind: row.kind as F1SessionKind,
    startsAt: row.startsAt.toISOString(),
    state: row.state as F1SessionState,
    resultVersion: row.resultVersion,
    resultConfirmed: row.resultConfirmed,
  };
}
