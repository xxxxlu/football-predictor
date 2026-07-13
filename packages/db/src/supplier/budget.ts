import type postgres from "postgres";

export type SupplierRequestCategory = "STATIC" | "PREMATCH_ODDS" | "LIVE" | "SETTLEMENT";
export type BudgetReason = "CATEGORY_EXHAUSTED" | "PROTECTED_RESERVE" | "HARD_LIMIT";

export interface SupplierBudgetRow {
  billingDay: string;
  totalUsed: number;
  staticUsed: number;
  prematchOddsUsed: number;
  liveUsed: number;
  settlementUsed: number;
  supplierLimit: number | null;
}

export interface SupplierBudgetSnapshot {
  billingDay: string;
  totalUsed: number;
  usedByCategory: Record<SupplierRequestCategory, number>;
  supplierLimit: number | null;
  effectiveUsed: number;
  hardLimit: 95;
  remaining: number;
  protectedRemaining: number;
}

const HARD_LIMIT = 95;
const PROTECTED = 10;
const CATEGORY_LIMIT: Record<SupplierRequestCategory, number> = { STATIC: 5, PREMATCH_ODDS: 10, LIVE: 70, SETTLEMENT: 10 };

function categoryValue(row: SupplierBudgetRow, category: SupplierRequestCategory): number {
  if (category === "STATIC") return row.staticUsed;
  if (category === "PREMATCH_ODDS") return row.prematchOddsUsed;
  if (category === "LIVE") return row.liveUsed;
  return row.settlementUsed;
}

function withCategory(row: SupplierBudgetRow, category: SupplierRequestCategory, value: number): SupplierBudgetRow {
  if (category === "STATIC") return { ...row, staticUsed: value };
  if (category === "PREMATCH_ODDS") return { ...row, prematchOddsUsed: value };
  if (category === "LIVE") return { ...row, liveUsed: value };
  return { ...row, settlementUsed: value };
}

export function decideBudgetConsumption(row: SupplierBudgetRow, category: SupplierRequestCategory, count: number):
  | { allowed: true; row: SupplierBudgetRow }
  | { allowed: false; reason: BudgetReason; row: SupplierBudgetRow } {
  if (!Number.isSafeInteger(count) || count < 1) throw new TypeError("count must be a positive integer");
  const categoryAfter = categoryValue(row, category) + count;
  if (category !== "SETTLEMENT" && categoryAfter > CATEGORY_LIMIT[category]) return { allowed: false, reason: "CATEGORY_EXHAUSTED", row };
  const totalAfter = row.totalUsed + count;
  if (totalAfter > HARD_LIMIT) return { allowed: false, reason: "HARD_LIMIT", row };
  if (category !== "SETTLEMENT" && totalAfter > HARD_LIMIT - PROTECTED) return { allowed: false, reason: "PROTECTED_RESERVE", row };
  return { allowed: true, row: withCategory({ ...row, totalUsed: totalAfter }, category, categoryAfter) };
}

export function reconcileBudgetRow(row: SupplierBudgetRow, supplierLimit: number, supplierRemaining: number): SupplierBudgetRow {
  return { ...row, totalUsed: Math.min(HARD_LIMIT, Math.max(row.totalUsed, Math.max(0, supplierLimit - supplierRemaining))), supplierLimit };
}

export function toBudgetSnapshot(row: SupplierBudgetRow): SupplierBudgetSnapshot {
  const remaining = Math.max(0, HARD_LIMIT - row.totalUsed);
  return {
    billingDay: row.billingDay,
    totalUsed: row.totalUsed,
    usedByCategory: { STATIC: row.staticUsed, PREMATCH_ODDS: row.prematchOddsUsed, LIVE: row.liveUsed, SETTLEMENT: row.settlementUsed },
    supplierLimit: row.supplierLimit,
    effectiveUsed: row.totalUsed,
    hardLimit: HARD_LIMIT,
    remaining,
    protectedRemaining: Math.min(PROTECTED, remaining),
  };
}

function billingDay(at: Date): string { return at.toISOString().slice(0, 10); }

async function ensureRow(sql: postgres.TransactionSql | postgres.Sql, day: string): Promise<void> {
  await sql`INSERT INTO supplier.request_budgets (billing_day) VALUES (${day}) ON CONFLICT (billing_day) DO NOTHING`;
}

async function lockRow(sql: postgres.TransactionSql, day: string): Promise<SupplierBudgetRow> {
  const [row] = await sql<SupplierBudgetRow[]>`
    SELECT billing_day::text AS "billingDay", total_used AS "totalUsed", static_used AS "staticUsed",
      prematch_odds_used AS "prematchOddsUsed", live_used AS "liveUsed", settlement_used AS "settlementUsed",
      supplier_limit AS "supplierLimit"
    FROM supplier.request_budgets WHERE billing_day = ${day} FOR UPDATE`;
  if (!row) throw new Error("Supplier budget row was not created");
  return row;
}

async function saveRow(sql: postgres.TransactionSql, row: SupplierBudgetRow, at: Date): Promise<void> {
  await sql`UPDATE supplier.request_budgets SET total_used=${row.totalUsed}, static_used=${row.staticUsed},
    prematch_odds_used=${row.prematchOddsUsed}, live_used=${row.liveUsed}, settlement_used=${row.settlementUsed},
    supplier_limit=${row.supplierLimit}, updated_at=${at} WHERE billing_day=${row.billingDay}`;
}

export class PostgresSupplierBudget {
  constructor(private readonly sql: postgres.Sql) {}

  async consume(input: { category: SupplierRequestCategory; count: number; at: Date }) {
    return this.sql.begin(async (tx) => {
      const day = billingDay(input.at);
      await ensureRow(tx, day);
      const current = await lockRow(tx, day);
      const decision = decideBudgetConsumption(current, input.category, input.count);
      if (decision.allowed) await saveRow(tx, decision.row, input.at);
      return decision.allowed
        ? { allowed: true as const, snapshot: toBudgetSnapshot(decision.row) }
        : { allowed: false as const, reason: decision.reason, snapshot: toBudgetSnapshot(current) };
    });
  }

  async reconcile(input: { at: Date; supplierLimit: number; supplierRemaining: number }): Promise<SupplierBudgetSnapshot> {
    return this.sql.begin(async (tx) => {
      const day = billingDay(input.at);
      await ensureRow(tx, day);
      const current = await lockRow(tx, day);
      const reconciled = reconcileBudgetRow(current, input.supplierLimit, input.supplierRemaining);
      await saveRow(tx, reconciled, input.at);
      return toBudgetSnapshot(reconciled);
    });
  }

  async snapshot(at: Date): Promise<SupplierBudgetSnapshot> {
    return this.sql.begin(async (tx) => {
      const day = billingDay(at);
      await ensureRow(tx, day);
      return toBudgetSnapshot(await lockRow(tx, day));
    });
  }
}
