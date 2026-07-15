export const MAX_TICKET_STAKE_POINTS = 20_000;

export type TicketSubmissionErrorCode =
  | "MARKET_CLOSED"
  | "ODDS_CHANGED"
  | "DATA_UNAVAILABLE"
  | "INSUFFICIENT_POINTS"
  | "INVALID_STAKE";

export class TicketSubmissionError extends Error {
  constructor(readonly code: TicketSubmissionErrorCode) {
    super(code);
    this.name = "TicketSubmissionError";
  }
}

export type PredictionSelection = "HOME" | "DRAW" | "AWAY";

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

      const outcome = market.snapshot.outcomes.find((candidate) => candidate.selection === command.selection);
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
