import { sql } from "drizzle-orm";
import type { MarketForSubmission, PredictionSelection } from "@football-predictor/domain";
import type { IdentityDatabase } from "../identity/repository.js";
import type { MarketSnapshotPort } from "./repository.js";

export interface SupplierSnapshotRow {
  marketId: string;
  fixtureId: string;
  marketStatus: string;
  fixtureStatus: string;
  syncState?: string;
  kickoffAt: Date | string;
  version: string;
  dataAsOf: Date | string;
  supplier: string;
  supplierFixtureId: string | number;
  bookmakerId: string | number;
  supplierMarketId: string | number;
  outcomes: unknown;
  sourceVerified: boolean;
}

/** Reads only the supplier-owned PostgreSQL product cache; it never performs external API calls. */
export class PostgresSupplierSnapshotAdapter implements MarketSnapshotPort {
  constructor(private readonly db: IdentityDatabase) {}
  async getMarket(marketId: string, transaction: IdentityDatabase = this.db) {
    const rows = await transaction.execute(sql<SupplierSnapshotRow>`
      SELECT m.id AS "marketId", f.id AS "fixtureId", m.status AS "marketStatus", f.status AS "fixtureStatus",
             m.sync_state AS "syncState", f.kickoff_at AS "kickoffAt", s.version, s.data_as_of AS "dataAsOf",
             s.supplier, s.supplier_fixture_id AS "supplierFixtureId", s.bookmaker_id AS "bookmakerId",
             s.supplier_market_id AS "supplierMarketId", s.outcomes, s.source_verified AS "sourceVerified"
      FROM supplier.markets m
      JOIN supplier.fixtures f ON f.id = m.fixture_id
      JOIN supplier.odds_snapshots s ON s.market_id = m.id AND s.version = m.current_version
      WHERE m.id = ${marketId}
      LIMIT 1
      FOR SHARE OF m, f, s
    `);
    const row = rows[0] as SupplierSnapshotRow | undefined;
    return row ? mapSupplierSnapshotRow(row) : null;
  }
}

export function mapSupplierSnapshotRow(row: SupplierSnapshotRow): MarketForSubmission {
  const prematch = row.fixtureStatus === "SCHEDULED";
  const open = row.sourceVerified && prematch;
  const outcomes = Array.isArray(row.outcomes) ? row.outcomes.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as { selection?: unknown; decimalOdds?: unknown };
    if (!isSelection(candidate.selection) || typeof candidate.decimalOdds !== "string") return [];
    return [{ selection: candidate.selection, decimalOdds: candidate.decimalOdds }];
  }) : [];
  return {
    id: row.marketId,
    fixtureId: row.fixtureId,
    status: open ? "OPEN" : prematch ? "DATA_UNAVAILABLE" : "CLOSED",
    kickoffAt: asIsoString(row.kickoffAt),
    snapshot: {
      version: row.version,
      dataAsOf: asIsoString(row.dataAsOf),
      supplier: row.supplier,
      supplierFixtureId: toSafeInteger(row.supplierFixtureId),
      bookmakerId: toSafeInteger(row.bookmakerId),
      marketId: toSafeInteger(row.supplierMarketId),
      outcomes,
      sourceVerified: row.sourceVerified,
    },
  };
}

function isSelection(value: unknown): value is PredictionSelection { return value === "HOME" || value === "DRAW" || value === "AWAY"; }
function toSafeInteger(value: string | number) { const parsed = Number(value); if (!Number.isSafeInteger(parsed)) throw new Error("Invalid supplier identifier"); return parsed; }
function asIsoString(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid supplier timestamp");
  return date.toISOString();
}
