import { describe, expect, it, vi } from "vitest";
import { PostgresBillingRepository } from "./repository.js";

function mockRow(overrides = {}) {
  const now = new Date("2026-10-19T10:00:00Z");
  const end = new Date("2026-11-18T10:00:00Z");
  return {
    id: "sub-123",
    user_id: "user-123",
    plan_tier: "PRO_MONTHLY",
    status: "ACTIVE",
    current_period_start: now,
    current_period_end: end,
    cancel_at_period_end: false,
    canceled_at: null,
    trial_start: null,
    trial_end: null,
    provider: "stripe",
    provider_customer_id: "cus_123",
    provider_subscription_id: "sub_123",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("PostgresBillingRepository", () => {
  it("retrieves and maps active subscription", async () => {
    const row = mockRow();
    const sql = (async () => [row]) as unknown as import("postgres").Sql;
    const repo = new PostgresBillingRepository(sql);

    const sub = await repo.getActiveSubscription("user-123");
    expect(sub).not.toBeNull();
    expect(sub?.id).toBe("sub-123");
    expect(sub?.userId).toBe("user-123");
    expect(sub?.planTier).toBe("PRO_MONTHLY");
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.provider).toBe("stripe");
    expect(sub?.providerCustomerId).toBe("cus_123");
    expect(sub?.currentPeriodEnd).toBe(row.current_period_end.toISOString());
  });

  it("checks if user had trial", async () => {
    const sqlTrue = (async () => [{ exists: true }]) as unknown as import("postgres").Sql;
    const repoTrue = new PostgresBillingRepository(sqlTrue);
    expect(await repoTrue.hasHadTrial("user-123")).toBe(true);

    const sqlFalse = (async () => [{ exists: false }]) as unknown as import("postgres").Sql;
    const repoFalse = new PostgresBillingRepository(sqlFalse);
    expect(await repoFalse.hasHadTrial("user-456")).toBe(false);
  });

  it("activates 7-day free trial for eligible user", async () => {
    const trialRow = mockRow({
      plan_tier: "PRO_TRIAL",
      status: "TRIALING",
      trial_start: new Date("2026-10-19T10:00:00Z"),
      trial_end: new Date("2026-10-26T10:00:00Z"),
      current_period_start: new Date("2026-10-19T10:00:00Z"),
      current_period_end: new Date("2026-10-26T10:00:00Z"),
    });

    let queryCount = 0;
    const sql = (async () => {
      queryCount++;
      if (queryCount === 1) return []; // no active sub
      if (queryCount === 2) return [{ exists: false }]; // no previous trial
      return [trialRow]; // insert returning
    }) as unknown as import("postgres").Sql;

    const repo = new PostgresBillingRepository(sql);
    const sub = await repo.activateTrial("user-123", {
      now: new Date("2026-10-19T10:00:00Z"),
    });

    expect(sub.planTier).toBe("PRO_TRIAL");
    expect(sub.status).toBe("TRIALING");
    expect(sub.trialStart).not.toBeNull();
    expect(sub.trialEnd).not.toBeNull();
  });

  it("rejects trial activation if user already has an active sub or previously claimed trial", async () => {
    // Has active sub
    const sqlActive = (async () => [mockRow()]) as unknown as import("postgres").Sql;
    const repoActive = new PostgresBillingRepository(sqlActive);
    await expect(repoActive.activateTrial("user-123")).rejects.toThrow(
      "User already has an active subscription",
    );

    // Previously claimed trial
    let queryCount = 0;
    const sqlClaimed = (async () => {
      queryCount++;
      if (queryCount === 1) return []; // no active sub
      return [{ exists: true }]; // already had trial
    }) as unknown as import("postgres").Sql;
    const repoClaimed = new PostgresBillingRepository(sqlClaimed);
    await expect(repoClaimed.activateTrial("user-123")).rejects.toThrow(
      "Free trial has already been claimed for this account",
    );
  });

  it("records checkout sessions and updates to completed", async () => {
    let recorded = false;
    let completed = false;

    const sql = (async (strings: TemplateStringsArray) => {
      const q = strings.join(" ");
      if (q.includes("INSERT INTO \"billing\".\"checkout_sessions\"")) {
        recorded = true;
      }
      if (q.includes("UPDATE \"billing\".\"checkout_sessions\"")) {
        completed = true;
      }
      return [];
    }) as unknown as import("postgres").Sql;

    const repo = new PostgresBillingRepository(sql);
    await repo.recordCheckoutSession({
      id: "cs-1",
      userId: "u-1",
      planTier: "PRO_MONTHLY",
      provider: "stripe",
      sessionId: "sess_123",
      amountCents: 1999,
    });
    expect(recorded).toBe(true);

    await repo.completeCheckoutSession("sess_123");
    expect(completed).toBe(true);
  });

  it("ensures webhook events are idempotent", async () => {
    // First time -> returns row
    const sqlFirst = (async () => [{ id: "evt_1" }]) as unknown as import("postgres").Sql;
    const repoFirst = new PostgresBillingRepository(sqlFirst);
    expect(
      await repoFirst.recordWebhookEvent({
        id: "evt_1",
        provider: "stripe",
        eventType: "customer.subscription.created",
        payload: { id: "evt_1" },
      }),
    ).toBe(true);

    // Second time (conflict) -> returns empty array
    const sqlDuplicate = (async () => []) as unknown as import("postgres").Sql;
    const repoDuplicate = new PostgresBillingRepository(sqlDuplicate);
    expect(
      await repoDuplicate.recordWebhookEvent({
        id: "evt_1",
        provider: "stripe",
        eventType: "customer.subscription.created",
        payload: { id: "evt_1" },
      }),
    ).toBe(false);
  });

  it("downgrades expired subscriptions", async () => {
    const sql = (async () => {
      const res = [] as any;
      res.count = 3;
      return res;
    }) as unknown as import("postgres").Sql;

    const repo = new PostgresBillingRepository(sql);
    const downgraded = await repo.downgradeExpiredSubscriptions(new Date("2026-10-19T12:00:00Z"));
    expect(downgraded).toBe(3);
  });

  it("retrieves user's total available points across rooms", async () => {
    const sql = (async () => [{ total: "15000" }]) as unknown as import("postgres").Sql;
    const repo = new PostgresBillingRepository(sql);
    const points = await repo.getUserTotalPoints("user-123");
    expect(points).toBe(15000);
  });

  it("subscribes with virtual points when balance is sufficient", async () => {
    const subRow = mockRow({
      plan_tier: "PRO_MONTHLY",
      status: "ACTIVE",
      provider: "points",
      provider_subscription_id: "points_sub-123",
    });

    let txStep = 0;
    const txMock = (async () => {
      txStep++;
      if (txStep === 1) return [{ roomId: "room-1", availablePoints: "8000" }]; // accounts
      if (txStep === 2) return []; // update point_accounts
      if (txStep === 3) return []; // insert ledger.entries
      if (txStep === 4) return []; // select existing active sub -> none
      if (txStep === 5) return [subRow]; // insert new sub
      return [];
    }) as any;

    const sql = {
      begin: vi.fn().mockImplementation(async (cb: any) => cb(txMock)),
    } as unknown as import("postgres").Sql;

    const repo = new PostgresBillingRepository(sql);
    const sub = await repo.subscribeWithPoints("user-123", "PRO_MONTHLY", {
      now: new Date("2026-10-19T10:00:00Z"),
    });

    expect(sub.planTier).toBe("PRO_MONTHLY");
    expect(sub.status).toBe("ACTIVE");
    expect(sub.provider).toBe("points");
  });

  it("rejects points subscription when user has insufficient points", async () => {
    const txMock = (async () => {
      return [{ roomId: "room-1", availablePoints: "2000" }]; // only 2000 points, need 5000
    }) as any;

    const sql = {
      begin: vi.fn().mockImplementation(async (cb: any) => cb(txMock)),
    } as unknown as import("postgres").Sql;

    const repo = new PostgresBillingRepository(sql);
    await expect(
      repo.subscribeWithPoints("user-123", "PRO_MONTHLY", {
        now: new Date("2026-10-19T10:00:00Z"),
      }),
    ).rejects.toThrow("INSUFFICIENT_POINTS");
  });
});
