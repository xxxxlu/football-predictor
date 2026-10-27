import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET as getProfile } from "@/app/api/v1/billing/profile/route";
import { POST as postTrial } from "@/app/api/v1/billing/trial/route";
import { POST as postCheckout } from "@/app/api/v1/billing/checkout/route";
import { POST as postSubscribePoints } from "@/app/api/v1/billing/subscribe-points/route";
import { POST as postWebhook } from "@/app/api/v1/billing/webhook/route";
import { GET as getProInsights } from "@/app/api/v1/matches/[matchId]/pro-insights/route";
import * as guardModule from "./guard";
import * as runtimeModule from "./runtime";
import type { UserBillingProfile, SubscriptionRecord } from "@pulse/domain";

function mockProfile(overrides: Partial<UserBillingProfile> = {}): UserBillingProfile {
  return {
    userId: "test-user-id",
    subscription: null,
    isPro: false,
    daysRemaining: 0,
    trialAvailable: true,
    ...overrides,
  };
}

describe("Billing & PULSE PRO Commercialization Flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/v1/billing/profile", () => {
    it("returns default free profile when user is not authenticated", async () => {
      vi.spyOn(guardModule, "resolveSessionUser").mockResolvedValue(null);

      const req = new Request("http://localhost:3000/api/v1/billing/profile");
      const res = await getProfile(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.isPro).toBe(false);
      expect(json.trialAvailable).toBe(true);
      expect(json.daysRemaining).toBe(0);
    });

    it("returns user's active billing profile when authenticated", async () => {
      vi.spyOn(guardModule, "resolveSessionUser").mockResolvedValue({ userId: "user-123" });
      const mockService = {
        getProfile: vi.fn().mockResolvedValue(
          mockProfile({
            userId: "user-123",
            isPro: true,
            daysRemaining: 25,
            trialAvailable: false,
          }),
        ),
      } as never;
      vi.spyOn(runtimeModule, "getBillingService").mockReturnValue(mockService);

      const req = new Request("http://localhost:3000/api/v1/billing/profile");
      const res = await getProfile(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.isPro).toBe(true);
      expect(json.daysRemaining).toBe(25);
    });
  });

  describe("POST /api/v1/billing/trial", () => {
    it("rejects unauthenticated requests with 401", async () => {
      vi.spyOn(guardModule, "resolveSessionUser").mockResolvedValue(null);

      const req = new Request("http://localhost:3000/api/v1/billing/trial", { method: "POST" });
      const res = await postTrial(req);
      expect(res.status).toBe(401);
    });

    it("activates 7-day free trial on first claim", async () => {
      vi.spyOn(guardModule, "resolveSessionUser").mockResolvedValue({ userId: "user-123" });
      const mockSub: SubscriptionRecord = {
        id: "sub-trial",
        userId: "user-123",
        planTier: "PRO_TRIAL",
        status: "TRIALING",
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 7 * 86400000).toISOString(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: new Date().toISOString(),
        trialEnd: new Date(Date.now() + 7 * 86400000).toISOString(),
        provider: "stripe",
        providerCustomerId: null,
        providerSubscriptionId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockService = {
        activateTrial: vi.fn().mockResolvedValue(mockSub),
      } as never;
      vi.spyOn(runtimeModule, "getBillingService").mockReturnValue(mockService);

      const req = new Request("http://localhost:3000/api/v1/billing/trial", { method: "POST" });
      const res = await postTrial(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.subscription.planTier).toBe("PRO_TRIAL");
    });

    it("returns 400 when trial was already claimed", async () => {
      vi.spyOn(guardModule, "resolveSessionUser").mockResolvedValue({ userId: "user-123" });
      const mockService = {
        activateTrial: vi.fn().mockRejectedValue(new Error("Free trial has already been claimed")),
      } as never;
      vi.spyOn(runtimeModule, "getBillingService").mockReturnValue(mockService);

      const req = new Request("http://localhost:3000/api/v1/billing/trial", { method: "POST" });
      const res = await postTrial(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("TRIAL_ALREADY_CLAIMED");
    });
  });

  describe("POST /api/v1/billing/checkout", () => {
    it("creates checkout session for authenticated user", async () => {
      vi.spyOn(guardModule, "resolveSessionUser").mockResolvedValue({ userId: "user-123" });
      const mockService = {
        createCheckout: vi.fn().mockResolvedValue({
          sessionId: "cs_12345",
          checkoutUrl: "https://checkout.stripe.com/pay/cs_12345",
          provider: "stripe",
        }),
      } as never;
      vi.spyOn(runtimeModule, "getBillingService").mockReturnValue(mockService);

      const req = new Request("http://localhost:3000/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planTier: "PRO_MONTHLY" }),
      });
      const res = await postCheckout(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.sessionId).toBe("cs_12345");
      expect(json.checkoutUrl).toContain("checkout.stripe.com");
    });
  });

  describe("POST /api/v1/billing/subscribe-points", () => {
    it("rejects unauthenticated requests with 401", async () => {
      vi.spyOn(guardModule, "resolveSessionUser").mockResolvedValue(null);

      const req = new Request("http://localhost:3000/api/v1/billing/subscribe-points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planTier: "PRO_MONTHLY" }),
      });
      const res = await postSubscribePoints(req);
      expect(res.status).toBe(401);
    });

    it("activates monthly subscription using virtual points", async () => {
      vi.spyOn(guardModule, "resolveSessionUser").mockResolvedValue({ userId: "user-123" });
      const mockSub: SubscriptionRecord = {
        id: "sub-points",
        userId: "user-123",
        planTier: "PRO_MONTHLY",
        status: "ACTIVE",
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        provider: "points",
        providerCustomerId: null,
        providerSubscriptionId: "points_sub-points",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockService = {
        subscribeWithPoints: vi.fn().mockResolvedValue(mockSub),
        getProfile: vi.fn().mockResolvedValue({
          userId: "user-123",
          subscription: mockSub,
          isPro: true,
          daysRemaining: 30,
          trialAvailable: false,
          availablePoints: 5000,
        }),
      } as never;
      vi.spyOn(runtimeModule, "getBillingService").mockReturnValue(mockService);

      const req = new Request("http://localhost:3000/api/v1/billing/subscribe-points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planTier: "PRO_MONTHLY" }),
      });
      const res = await postSubscribePoints(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.subscription.provider).toBe("points");
      expect(json.daysRemaining).toBe(30);
      expect(json.availablePoints).toBe(5000);
    });

    it("returns 400 when user has insufficient points", async () => {
      vi.spyOn(guardModule, "resolveSessionUser").mockResolvedValue({ userId: "user-123" });
      const mockService = {
        subscribeWithPoints: vi.fn().mockRejectedValue(
          new Error("INSUFFICIENT_POINTS: 需要 5000 积分，当前可用 1200 积分"),
        ),
      } as never;
      vi.spyOn(runtimeModule, "getBillingService").mockReturnValue(mockService);

      const req = new Request("http://localhost:3000/api/v1/billing/subscribe-points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planTier: "PRO_MONTHLY" }),
      });
      const res = await postSubscribePoints(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe("INSUFFICIENT_POINTS");
      expect(json.message).toContain("需要 5000 积分");
    });
  });

  describe("POST /api/v1/billing/webhook", () => {
    it("processes checkout completion and acknowledges receipt", async () => {
      const mockService = {
        handleWebhook: vi.fn().mockResolvedValue({
          success: true,
          duplicate: false,
          eventType: "checkout.session.completed",
        }),
      } as never;
      vi.spyOn(runtimeModule, "getBillingService").mockReturnValue(mockService);

      const req = new Request("http://localhost:3000/api/v1/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: JSON.stringify({
          id: "evt_1",
          type: "checkout.session.completed",
          data: { object: { id: "cs_1" } },
        }),
      });

      const res = await postWebhook(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
      expect(json.eventType).toBe("checkout.session.completed");
    });
  });

  describe("GET /api/v1/matches/[matchId]/pro-insights", () => {
    it("veils sharp money data for non-subscribers", async () => {
      vi.spyOn(guardModule, "resolveSessionUser").mockResolvedValue({ userId: "user-free" });
      const mockService = {
        getProfile: vi.fn().mockResolvedValue(mockProfile({ isPro: false })),
      } as never;
      vi.spyOn(runtimeModule, "getBillingService").mockReturnValue(mockService);

      const req = new Request("http://localhost:3000/api/v1/matches/match-1/pro-insights");
      const res = await getProInsights(req, {
        params: Promise.resolve({ matchId: "match-1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.isPro).toBe(false);
      expect(json.sharpAction).toBeNull();
      expect(json.lockedReason).toBeDefined();
    });

    it("unlocks full sharp action indicators for VIP subscribers", async () => {
      vi.spyOn(guardModule, "resolveSessionUser").mockResolvedValue({ userId: "user-vip" });
      const mockService = {
        getProfile: vi.fn().mockResolvedValue(mockProfile({ isPro: true })),
      } as never;
      vi.spyOn(runtimeModule, "getBillingService").mockReturnValue(mockService);

      const req = new Request("http://localhost:3000/api/v1/matches/match-1/pro-insights");
      const res = await getProInsights(req, {
        params: Promise.resolve({ matchId: "match-1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.isPro).toBe(true);
      expect(json.sharpAction).not.toBeNull();
      expect(json.sharpAction.oddsDefenseShift).toBe(-0.18);
      expect(json.sharpAction.recommendedValueMarket).toBeDefined();
    });
  });
});
