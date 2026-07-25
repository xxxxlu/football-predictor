import type { RoomSport, RoomTier } from "../rooms/service.js";
import { marketKindFromSupplierMarketId } from "./markets.js";
import { f1MarketKindFromSupplierMarketId } from "../f1/markets.js";
import { parseF1Selection } from "../f1/selections.js";
import { exactPodiumComboOdds } from "../f1/exact-podium-odds.js";

export const MAX_TICKET_STAKE_POINTS = 20_000;

export type TicketSubmissionErrorCode =
  | "MARKET_CLOSED"
  | "ODDS_CHANGED"
  | "DATA_UNAVAILABLE"
  | "INSUFFICIENT_POINTS"
  | "INVALID_STAKE"
  | "ADVANCED_ROOM_REQUIRED"
  | "ROOM_SPORT_MISMATCH"
  | "SCORE_TICKET_EXISTS"
  | "MARKET_TICKET_EXISTS";

export class TicketSubmissionError extends Error {
  constructor(readonly code: TicketSubmissionErrorCode) {
    super(code);
    this.name = "TicketSubmissionError";
  }
}

export type OneXTwoSelection = "HOME" | "DRAW" | "AWAY";
export type CorrectScoreSelection = `${number}-${number}` | "OTHER";
/** Encoded F1 selection strings (see domain/f1/selections.ts for the exact grammar). */
export type F1EncodedSelection = `DRV:${string}` | `PODIUM:${string}` | `POD3:${string}` | `H2H:${string}`;
/** A 1X2, correct-score or F1 selection string; validated against the market outcomes at submission. */
export type PredictionSelection = OneXTwoSelection | CorrectScoreSelection | F1EncodedSelection;

export interface MarketForSubmission {
  id: string;
  fixtureId: string;
  status: "OPEN" | "CLOSED" | "DATA_UNAVAILABLE";
  kickoffAt: string;
  snapshot: {
    version: string;
    dataAsOf: string;
    supplier: string;
    supplierFixtureId: number;
    bookmakerId: number;
    marketId: number;
    outcomes: Array<{ selection: PredictionSelection; decimalOdds: string }>;
    sourceVerified: boolean;
  };
}

export interface PointsAccount {
  userId: string;
  roomId: string;
  availablePoints: number;
  frozenPoints: number;
}

export interface SubmittedTicket {
  id: string;
  userId: string;
  roomId: string;
  marketId: string;
  fixtureId: string;
  idempotencyKey: string;
  stakePoints: number;
  status: "PENDING";
  createdAt: string;
  legs: Array<{
    selection: PredictionSelection;
    oddsSnapshot: {
      version: string;
      decimalOdds: string;
      dataAsOf: string;
      supplier: string;
      supplierFixtureId: number;
      bookmakerId: number;
      marketId: number;
    };
  }>;
}

export interface AtomicFreezeWrite {
  ticket: SubmittedTicket;
  balance: { availableDeltaPoints: number; frozenDeltaPoints: number };
  ledger: {
    id: string;
    type: "PREDICTION_FREEZE";
    userId: string;
    roomId: string;
    ticketId: string;
    availableDeltaPoints: number;
    frozenDeltaPoints: number;
    occurredAt: string;
  };
}

export interface IdempotencyScope {
  userId: string;
  roomId: string;
  idempotencyKey: string;
}

export interface TicketSubmissionTransaction {
  findByIdempotencyKey(scope: IdempotencyScope): Promise<SubmittedTicket | null>;
  getPointsAccount(userId: string, roomId: string): Promise<PointsAccount>;
  getMarket(marketId: string): Promise<MarketForSubmission | null>;
  /** Room tier gate for correct-score markets; read under the account row lock. */
  getRoomTier(roomId: string): Promise<RoomTier>;
  /** Room sport gate: every room predicts exactly one sport; read under the account row lock. */
  getRoomSport(roomId: string): Promise<RoomSport>;
  /** Whether the user already holds an unsettled correct-score ticket on the fixture; read under the account row lock. */
  hasOpenCorrectScoreTicket(userId: string, roomId: string, fixtureId: string): Promise<boolean>;
  /** Whether the user already holds an unsettled ticket on this exact market; read under the account row lock. */
  hasOpenTicketForMarket(userId: string, roomId: string, marketId: string): Promise<boolean>;
  /** Must enforce the idempotency unique key and account row lock itself. */
  persistFreeze(write: AtomicFreezeWrite): Promise<SubmittedTicket>;
}

export interface TicketSubmissionTransactionPort {
  /** Runs the callback at serializable-equivalent isolation for this account/idempotency scope. */
  run<T>(scope: IdempotencyScope, work: (transaction: TicketSubmissionTransaction) => Promise<T>): Promise<T>;
}

export interface SubmitTicketCommand extends IdempotencyScope {
  marketId: string;
  selection: PredictionSelection;
  stakePoints: number;
  acceptedOddsVersion: string;
  acceptedDecimalOdds: string;
}

export interface TicketSubmissionClock { now(): Date }
export interface TicketSubmissionIds { next(kind: "ticket" | "ledger"): string }

function validStake(stakePoints: number): boolean {
  return Number.isSafeInteger(stakePoints) && stakePoints > 0 && stakePoints <= MAX_TICKET_STAKE_POINTS;
}

function validPositiveDecimal(value: string): boolean {
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && value.replace(/[.0]/g, "").length > 0;
}

function assertMarketAvailable(market: MarketForSubmission | null, now: Date): asserts market is MarketForSubmission {
  if (market === null || market.status === "DATA_UNAVAILABLE" || !market.snapshot.sourceVerified) {
    throw new TicketSubmissionError("DATA_UNAVAILABLE");
  }
  if (market.status !== "OPEN") throw new TicketSubmissionError("MARKET_CLOSED");

  const kickoffAt = new Date(market.kickoffAt).getTime();
  if (!Number.isFinite(kickoffAt)) throw new TicketSubmissionError("DATA_UNAVAILABLE");
  if (now.getTime() >= kickoffAt) throw new TicketSubmissionError("MARKET_CLOSED");

  const dataAsOf = new Date(market.snapshot.dataAsOf).getTime();
  if (!Number.isFinite(dataAsOf) || dataAsOf > now.getTime()) {
    throw new TicketSubmissionError("DATA_UNAVAILABLE");
  }
}

/** Resolves the priced outcome for a selection. Football and most F1 kinds match an
 *  enumerated outcome directly; EXACT_PODIUM combos are derived from the market's
 *  per-driver base outcomes via the shared domain formula, so all 9,240 ordered
 *  combinations are priceable without enumerating them in the snapshot. Legacy
 *  snapshots that still enumerate `POD3:` outcomes match on the direct path. */
function resolveOutcome(
  market: MarketForSubmission,
  f1Kind: ReturnType<typeof f1MarketKindFromSupplierMarketId>,
  selection: PredictionSelection,
): { selection: PredictionSelection; decimalOdds: string } | null {
  const direct = market.snapshot.outcomes.find((candidate) => candidate.selection === selection);
  if (direct) return direct;
  if (f1Kind !== "EXACT_PODIUM") return null;
  const parsed = parseF1Selection("EXACT_PODIUM", selection);
  if (parsed === null || parsed.kind !== "EXACT_PODIUM") return null;
  const base = [parsed.first, parsed.second, parsed.third].map((code) =>
    market.snapshot.outcomes.find((candidate) => candidate.selection === `DRV:${code}`)?.decimalOdds);
  if (base[0] === undefined || base[1] === undefined || base[2] === undefined) return null;
  const derived = exactPodiumComboOdds([base[0], base[1], base[2]]);
  return derived === null ? null : { selection, decimalOdds: derived };
}

export class TicketSubmissionService {
  private readonly transaction: TicketSubmissionTransactionPort;
  private readonly clock: TicketSubmissionClock;
  private readonly ids: TicketSubmissionIds;

  constructor(input: { transaction: TicketSubmissionTransactionPort; clock: TicketSubmissionClock; ids: TicketSubmissionIds }) {
    this.transaction = input.transaction;
    this.clock = input.clock;
    this.ids = input.ids;
  }

  async submit(command: SubmitTicketCommand): Promise<SubmittedTicket> {
    const scope: IdempotencyScope = {
      userId: command.userId,
      roomId: command.roomId,
      idempotencyKey: command.idempotencyKey,
    };

    return this.transaction.run(scope, async (transaction) => {
      const replay = await transaction.findByIdempotencyKey(scope);
      if (replay) return replay;

      if (!validStake(command.stakePoints)) throw new TicketSubmissionError("INVALID_STAKE");

      const now = this.clock.now();
      const market = await transaction.getMarket(command.marketId);
      assertMarketAvailable(market, now);

      const f1Kind = f1MarketKindFromSupplierMarketId(market.snapshot.marketId);
      /* A room predicts exactly one sport: F1 markets only settle F1 rooms and
         football markets only settle football rooms. Legacy mixed rooms keep
         their history; the gate applies to new submissions only. */
      const eventSport: RoomSport = f1Kind === null ? "FOOTBALL" : "FORMULA_1";
      if ((await transaction.getRoomSport(command.roomId)) !== eventSport) {
        throw new TicketSubmissionError("ROOM_SPORT_MISMATCH");
      }
      if (f1Kind === null && marketKindFromSupplierMarketId(market.snapshot.marketId) === "CORRECT_SCORE") {
        if ((await transaction.getRoomTier(command.roomId)) !== "ADVANCED") {
          throw new TicketSubmissionError("ADVANCED_ROOM_REQUIRED");
        }
        if (await transaction.hasOpenCorrectScoreTicket(command.userId, command.roomId, market.fixtureId)) {
          throw new TicketSubmissionError("SCORE_TICKET_EXISTS");
        }
      }
      if (f1Kind !== null) {
        /* The selection must match the market's grammar. EXACT_PODIUM markets store
           per-driver base outcomes (`DRV:<code>`) that are pricing inputs, never
           bettable selections — without this guard a POD3 market would accept a
           bare `DRV:` selection because it appears in the outcome list. */
        if (parseF1Selection(f1Kind, command.selection) === null) {
          throw new TicketSubmissionError("DATA_UNAVAILABLE");
        }
        /* 一人一注: one settled-or-pending judgement per F1 market — once staked,
           the user waits for the result instead of averaging across outcomes. */
        if (await transaction.hasOpenTicketForMarket(command.userId, command.roomId, market.id)) {
          throw new TicketSubmissionError("MARKET_TICKET_EXISTS");
        }
      }

      const outcome = resolveOutcome(market, f1Kind, command.selection);
      if (!outcome || !validPositiveDecimal(outcome.decimalOdds)) throw new TicketSubmissionError("DATA_UNAVAILABLE");
      if (market.snapshot.version !== command.acceptedOddsVersion || outcome.decimalOdds !== command.acceptedDecimalOdds) {
        throw new TicketSubmissionError("ODDS_CHANGED");
      }

      const account = await transaction.getPointsAccount(command.userId, command.roomId);
      if (account.availablePoints < command.stakePoints) throw new TicketSubmissionError("INSUFFICIENT_POINTS");

      const createdAt = now.toISOString();
      const ticket: SubmittedTicket = {
        id: this.ids.next("ticket"),
        userId: command.userId,
        roomId: command.roomId,
        marketId: market.id,
        fixtureId: market.fixtureId,
        idempotencyKey: command.idempotencyKey,
        stakePoints: command.stakePoints,
        status: "PENDING",
        createdAt,
        legs: [{
          selection: command.selection,
          oddsSnapshot: {
            version: market.snapshot.version,
            decimalOdds: outcome.decimalOdds,
            dataAsOf: market.snapshot.dataAsOf,
            supplier: market.snapshot.supplier,
            supplierFixtureId: market.snapshot.supplierFixtureId,
            bookmakerId: market.snapshot.bookmakerId,
            marketId: market.snapshot.marketId,
          },
        }],
      };
      const availableDeltaPoints = -command.stakePoints;
      const frozenDeltaPoints = command.stakePoints;
      return transaction.persistFreeze({
        ticket,
        balance: { availableDeltaPoints, frozenDeltaPoints },
        ledger: {
          id: this.ids.next("ledger"),
          type: "PREDICTION_FREEZE",
          userId: command.userId,
          roomId: command.roomId,
          ticketId: ticket.id,
          availableDeltaPoints,
          frozenDeltaPoints,
          occurredAt: createdAt,
        },
      });
    });
  }
}
