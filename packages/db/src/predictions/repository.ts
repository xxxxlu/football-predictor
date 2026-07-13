import { and, eq, sql } from "drizzle-orm";
import {
  RoomError,
  TicketSubmissionError,
  type AtomicFreezeWrite,
  type IdempotencyScope,
  type MarketForSubmission,
  type SubmittedTicket,
  type TicketSubmissionTransaction,
  type TicketSubmissionTransactionPort,
} from "@football-predictor/domain";
import type { IdentityDatabase } from "../identity/repository.js";
import { pointAccounts, pointLedgerEntries } from "../rooms/schema.js";
import { predictionLegs, predictionTickets } from "./schema.js";

/** Supplier-owned cache adapter. Implementations must return the current immutable product-cache snapshot and never call the supplier on demand. */
export interface MarketSnapshotPort {
  getMarket(marketId: string, transaction?: IdentityDatabase): Promise<MarketForSubmission | null>;
}

export class DrizzleTicketSubmissionPort implements TicketSubmissionTransactionPort {
  constructor(private readonly db: IdentityDatabase, private readonly snapshots: MarketSnapshotPort) {}

  async run<T>(scope: IdempotencyScope, work: (transaction: TicketSubmissionTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const [lockedAccount] = await tx.select({ userId: pointAccounts.userId }).from(pointAccounts)
        .where(and(eq(pointAccounts.roomId, scope.roomId), eq(pointAccounts.userId, scope.userId))).for("update").limit(1);
      if (!lockedAccount) throw new RoomError("ROOM_NOT_FOUND", 404);

      const transaction: TicketSubmissionTransaction = {
        findByIdempotencyKey: async (key) => {
          const [ticket] = await tx.select().from(predictionTickets).where(and(
            eq(predictionTickets.userId, key.userId), eq(predictionTickets.roomId, key.roomId), eq(predictionTickets.idempotencyKey, key.idempotencyKey),
          )).limit(1);
          if (!ticket) return null;
          const legs = await tx.select().from(predictionLegs).where(eq(predictionLegs.ticketId, ticket.id)).orderBy(predictionLegs.legNumber);
          return mapTicket(ticket, legs);
        },
        getPointsAccount: async (userId, roomId) => {
          const [account] = await tx.select().from(pointAccounts).where(and(eq(pointAccounts.userId, userId), eq(pointAccounts.roomId, roomId))).limit(1);
          if (!account) throw new RoomError("ROOM_NOT_FOUND", 404);
          return { userId, roomId, availablePoints: toSafeInteger(account.availablePoints), frozenPoints: toSafeInteger(account.frozenPoints) };
        },
        getMarket: (marketId) => this.snapshots.getMarket(marketId, tx as IdentityDatabase),
        persistFreeze: async (write) => persistFreeze(tx as IdentityDatabase, write),
      };
      return work(transaction);
    });
  }
}

async function persistFreeze(db: IdentityDatabase, write: AtomicFreezeWrite): Promise<SubmittedTicket> {
  const stake = write.ticket.stakePoints;
  const updated = await db.update(pointAccounts).set({
    availablePoints: sql`${pointAccounts.availablePoints} + ${write.balance.availableDeltaPoints}`,
    frozenPoints: sql`${pointAccounts.frozenPoints} + ${write.balance.frozenDeltaPoints}`,
    updatedAt: new Date(write.ticket.createdAt),
  }).where(and(
    eq(pointAccounts.roomId, write.ticket.roomId),
    eq(pointAccounts.userId, write.ticket.userId),
    sql`${pointAccounts.availablePoints} >= ${stake}`,
  )).returning({ userId: pointAccounts.userId });
  if (updated.length === 0) throw new TicketSubmissionError("INSUFFICIENT_POINTS");

  await db.insert(predictionTickets).values({
    id: write.ticket.id,
    userId: write.ticket.userId,
    roomId: write.ticket.roomId,
    marketId: write.ticket.marketId,
    fixtureId: write.ticket.fixtureId,
    idempotencyKey: write.ticket.idempotencyKey,
    stakePoints: String(write.ticket.stakePoints),
    status: write.ticket.status,
    createdAt: new Date(write.ticket.createdAt),
  });
  await db.insert(predictionLegs).values(write.ticket.legs.map((leg, index) => ({
    ticketId: write.ticket.id,
    legNumber: index + 1,
    selection: leg.selection,
    oddsVersion: leg.oddsSnapshot.version,
    decimalOdds: leg.oddsSnapshot.decimalOdds,
    dataAsOf: new Date(leg.oddsSnapshot.dataAsOf),
    supplier: leg.oddsSnapshot.supplier,
    supplierFixtureId: leg.oddsSnapshot.supplierFixtureId,
    bookmakerId: leg.oddsSnapshot.bookmakerId,
    supplierMarketId: leg.oddsSnapshot.marketId,
  })));
  await db.insert(pointLedgerEntries).values({
    id: write.ledger.id,
    roomId: write.ledger.roomId,
    userId: write.ledger.userId,
    kind: write.ledger.type,
    amount: String(stake),
    availableDeltaPoints: String(write.ledger.availableDeltaPoints),
    frozenDeltaPoints: String(write.ledger.frozenDeltaPoints),
    ticketId: write.ledger.ticketId,
    idempotencyKey: `freeze:${write.ticket.id}`,
    auditId: write.ledger.id,
    createdAt: new Date(write.ledger.occurredAt),
  });
  return write.ticket;
}

function mapTicket(ticket: typeof predictionTickets.$inferSelect, legs: Array<typeof predictionLegs.$inferSelect>): SubmittedTicket {
  return {
    id: ticket.id, userId: ticket.userId, roomId: ticket.roomId, marketId: ticket.marketId, fixtureId: ticket.fixtureId,
    idempotencyKey: ticket.idempotencyKey, stakePoints: toSafeInteger(ticket.stakePoints), status: "PENDING", createdAt: ticket.createdAt.toISOString(),
    legs: legs.map((leg) => ({ selection: leg.selection as "HOME" | "DRAW" | "AWAY", oddsSnapshot: {
      version: leg.oddsVersion, decimalOdds: leg.decimalOdds, dataAsOf: leg.dataAsOf.toISOString(), supplier: leg.supplier,
      supplierFixtureId: leg.supplierFixtureId, bookmakerId: leg.bookmakerId, marketId: leg.supplierMarketId,
    } })),
  };
}

function toSafeInteger(value: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("Point value is outside the safe integer range");
  return number;
}
