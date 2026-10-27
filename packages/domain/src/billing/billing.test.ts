import { describe, expect, it } from "vitest";
import {
  calculatePeriodEnd,
  canAccessProFeature,
  getDaysRemaining,
  hasProAccess,
  isSubscriptionExpired,
  buildBillingProfile,
  PRO_TRIAL_DAYS,
  PRO_MONTHLY_DAYS,
  PRO_ANNUAL_DAYS,
} from "./entitlements.js";
import type { SubscriptionRecord } from "./types.js";

function mockSub(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  const now = new Date("2026-10-19T10:00:00Z");
  const end = new Date("2026-11-18T10:00:00Z");
  return {
    id: "sub-1",
    userId: "user-1",
    planTier: "PRO_MONTHLY",
    status: "ACTIVE",
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: end.toISOString(),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialStart: null,
    trialEnd: null,
    provider: "stripe",
    providerCustomerId: "cus_123",
    providerSubscriptionId: "sub_123",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe("Billing & PRO Entitlements", () => {
  const baseNow = new Date("2026-10-19T12:00:00Z");

  describe("hasProAccess", () => {
    it("returns false for null subscription or FREE tier", () => {
      expect(hasProAccess(null, baseNow)).toBe(false);
      expect(hasProAccess(mockSub({ planTier: "FREE" }), baseNow)).toBe(false);
    });

    it("returns true for active subscription before end date", () => {
      const active = mockSub({
        status: "ACTIVE",
        currentPeriodEnd: "2026-10-25T00:00:00Z",
      });
      expect(hasProAccess(active, baseNow)).toBe(true);
    });

    it("returns true for trialing subscription before end date", () => {
      const trialing = mockSub({
        planTier: "PRO_TRIAL",
        status: "TRIALING",
        currentPeriodEnd: "2026-10-26T00:00:00Z",
      });
      expect(hasProAccess(trialing, baseNow)).toBe(true);
    });

    it("returns false if active subscription has passed period end", () => {
      const expired = mockSub({
        status: "ACTIVE",
        currentPeriodEnd: "2026-10-18T00:00:00Z",
      });
      expect(hasProAccess(expired, baseNow)).toBe(false);
    });

    it("honors grace period for PAST_DUE subscriptions within 3 days", () => {
      const pastDueRecent = mockSub({
        status: "PAST_DUE",
        currentPeriodEnd: "2026-10-18T00:00:00Z", // 1.5 days ago -> in grace
      });
      expect(hasProAccess(pastDueRecent, baseNow)).toBe(true);

      const pastDueOld = mockSub({
        status: "PAST_DUE",
        currentPeriodEnd: "2026-10-15T00:00:00Z", // 4.5 days ago -> outside grace
      });
      expect(hasProAccess(pastDueOld, baseNow)).toBe(false);
    });

    it("returns false for EXPIRED or CANCELED subscriptions", () => {
      expect(hasProAccess(mockSub({ status: "EXPIRED" }), baseNow)).toBe(false);
      expect(hasProAccess(mockSub({ status: "CANCELED" }), baseNow)).toBe(false);
    });
  });

  describe("getDaysRemaining", () => {
    it("returns correct days for active subscription", () => {
      const sub = mockSub({
        status: "ACTIVE",
        currentPeriodEnd: "2026-10-22T12:00:00Z", // 3 days
      });
      expect(getDaysRemaining(sub, baseNow)).toBe(3);
    });

    it("returns 0 for expired subscription", () => {
      const sub = mockSub({
        status: "EXPIRED",
        currentPeriodEnd: "2026-10-10T00:00:00Z",
      });
      expect(getDaysRemaining(sub, baseNow)).toBe(0);
    });
  });

  describe("calculatePeriodEnd", () => {
    it("adds 7 days for PRO_TRIAL", () => {
      const end = calculatePeriodEnd("PRO_TRIAL", baseNow);
      const diffDays = Math.round((end.getTime() - baseNow.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(PRO_TRIAL_DAYS);
    });

    it("adds 30 days for PRO_MONTHLY", () => {
      const end = calculatePeriodEnd("PRO_MONTHLY", baseNow);
      const diffDays = Math.round((end.getTime() - baseNow.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(PRO_MONTHLY_DAYS);
    });

    it("adds 365 days for PRO_ANNUAL", () => {
      const end = calculatePeriodEnd("PRO_ANNUAL", baseNow);
      const diffDays = Math.round((end.getTime() - baseNow.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(PRO_ANNUAL_DAYS);
    });
  });

  describe("canAccessProFeature", () => {
    it("permits features only when user has active PRO status", () => {
      const active = mockSub({ status: "ACTIVE" });
      expect(canAccessProFeature(active, "monte_carlo_matrix", baseNow)).toBe(true);
      expect(canAccessProFeature(active, "sharp_money_detector", baseNow)).toBe(true);

      const expired = mockSub({ status: "EXPIRED" });
      expect(canAccessProFeature(expired, "monte_carlo_matrix", baseNow)).toBe(false);
      expect(canAccessProFeature(expired, "sharp_money_detector", baseNow)).toBe(false);
    });
  });

  describe("buildBillingProfile", () => {
    it("correctly identifies trial eligibility and PRO status", () => {
      // First-time free user
      const freeProfile = buildBillingProfile("u1", null, false, baseNow);
      expect(freeProfile.isPro).toBe(false);
      expect(freeProfile.trialAvailable).toBe(true);
      expect(freeProfile.daysRemaining).toBe(0);

      // User who already used trial
      const usedTrialProfile = buildBillingProfile("u1", null, true, baseNow);
      expect(usedTrialProfile.trialAvailable).toBe(false);

      // Active monthly user
      const active = mockSub({ currentPeriodEnd: "2026-10-29T12:00:00Z" });
      const activeProfile = buildBillingProfile("u1", active, true, baseNow);
      expect(activeProfile.isPro).toBe(true);
      expect(activeProfile.daysRemaining).toBe(10);
      expect(activeProfile.trialAvailable).toBe(false);
    });
  });

  describe("isSubscriptionExpired", () => {
    it("returns true if explicitly marked EXPIRED or past period end", () => {
      expect(isSubscriptionExpired(mockSub({ status: "EXPIRED" }), baseNow)).toBe(true);
      expect(
        isSubscriptionExpired(
          mockSub({ status: "ACTIVE", currentPeriodEnd: "2026-10-18T00:00:00Z" }),
          baseNow,
        ),
      ).toBe(true);
    });
  });
});
