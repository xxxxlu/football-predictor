export const SUPPLIER_HARD_LIMIT = 95;
export const SETTLEMENT_PROTECTED_REQUESTS = 10;

export type SupplierRequestCategory = "STATIC" | "PREMATCH_ODDS" | "LIVE" | "SETTLEMENT";

export const CATEGORY_BASELINE: Readonly<Record<SupplierRequestCategory, number>> = {
  STATIC: 30,
  PREMATCH_ODDS: 50,
  LIVE: 5,
  SETTLEMENT: 10,
};

export interface SupplierBudgetState {
  billingDay: string;
  totalUsed: number;
  usedByCategory: Record<SupplierRequestCategory, number>;
  supplierLimit: number | null;
}

export interface BudgetSnapshot extends SupplierBudgetState {
  effectiveUsed: number;
  hardLimit: 95;
  remaining: number;
  protectedRemaining: number;
}

export type BudgetDecision =
  | { allowed: true; snapshot: BudgetSnapshot }
  | { allowed: false; reason: "CATEGORY_EXHAUSTED" | "PROTECTED_RESERVE" | "HARD_LIMIT"; snapshot: BudgetSnapshot };

export interface SupplierBudgetPort {
  consume(input: { category: SupplierRequestCategory; count: number; at: Date }): Promise<BudgetDecision>;
  reconcile(input: { at: Date; supplierLimit: number; supplierRemaining: number }): Promise<BudgetSnapshot>;
  snapshot(at: Date): Promise<BudgetSnapshot>;
}

export function utcBillingDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function emptyBudgetState(billingDay: string): SupplierBudgetState {
  return {
    billingDay,
    totalUsed: 0,
    usedByCategory: { STATIC: 0, PREMATCH_ODDS: 0, LIVE: 0, SETTLEMENT: 0 },
    supplierLimit: null,
  };
}

function toSnapshot(state: SupplierBudgetState): BudgetSnapshot {
  const effectiveUsed = state.totalUsed;
  const remaining = Math.max(0, SUPPLIER_HARD_LIMIT - effectiveUsed);
  return {
    ...state,
    usedByCategory: { ...state.usedByCategory },
    effectiveUsed,
    hardLimit: SUPPLIER_HARD_LIMIT,
    remaining,
    protectedRemaining: Math.min(SETTLEMENT_PROTECTED_REQUESTS, remaining),
  };
}

/**
 * Development/test adapter for the atomic persistence port. PostgreSQL must
 * implement the same operations with a row lock or compare-and-swap.
 */
export class InMemorySupplierBudget implements SupplierBudgetPort {
  private state: SupplierBudgetState;

  constructor(initial: SupplierBudgetState) {
    this.state = { ...initial, usedByCategory: { ...initial.usedByCategory } };
  }

  private resetIfNeeded(at: Date): void {
    const billingDay = utcBillingDay(at);
    if (billingDay !== this.state.billingDay) this.state = emptyBudgetState(billingDay);
  }

  async consume(input: { category: SupplierRequestCategory; count: number; at: Date }): Promise<BudgetDecision> {
    this.resetIfNeeded(input.at);
    if (!Number.isSafeInteger(input.count) || input.count < 1) throw new TypeError("count must be a positive integer");
    const categoryAfter = this.state.usedByCategory[input.category] + input.count;
    if (input.category !== "SETTLEMENT" && categoryAfter > CATEGORY_BASELINE[input.category]) {
      return { allowed: false, reason: "CATEGORY_EXHAUSTED", snapshot: toSnapshot(this.state) };
    }
    const totalAfter = this.state.totalUsed + input.count;
    if (totalAfter > SUPPLIER_HARD_LIMIT) {
      return { allowed: false, reason: "HARD_LIMIT", snapshot: toSnapshot(this.state) };
    }
    if (input.category !== "SETTLEMENT" && totalAfter > SUPPLIER_HARD_LIMIT - SETTLEMENT_PROTECTED_REQUESTS) {
      return { allowed: false, reason: "PROTECTED_RESERVE", snapshot: toSnapshot(this.state) };
    }
    this.state.totalUsed = totalAfter;
    this.state.usedByCategory[input.category] = categoryAfter;
    return { allowed: true, snapshot: toSnapshot(this.state) };
  }

  async reconcile(input: { at: Date; supplierLimit: number; supplierRemaining: number }): Promise<BudgetSnapshot> {
    this.resetIfNeeded(input.at);
    const reportedUsed = Math.max(0, input.supplierLimit - input.supplierRemaining);
    this.state.totalUsed = Math.max(this.state.totalUsed, reportedUsed);
    this.state.supplierLimit = input.supplierLimit;
    return toSnapshot(this.state);
  }

  async snapshot(at: Date): Promise<BudgetSnapshot> {
    this.resetIfNeeded(at);
    return toSnapshot(this.state);
  }
}
