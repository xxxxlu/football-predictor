import { randomUUID } from "node:crypto";
import { loadIdentityConfig } from "@pulse/config";
import {
  getBillingRepository,
  type PostgresBillingRepository,
} from "@pulse/db";
import {
  buildBillingProfile,
  calculatePeriodEnd,
  type SubscriptionRecord,
  type UserBillingProfile,
} from "@pulse/domain";
import {
  getPaymentGateway,
  type PaymentGatewayPort,
} from "./gateway";

export class BillingService {
  constructor(
    private readonly repo: PostgresBillingRepository,
    private readonly gateway: PaymentGatewayPort,
  ) {}

  async getProfile(userId: string): Promise<UserBillingProfile> {
    const [sub, hadTrial, points] = await Promise.all([
      this.repo.getActiveSubscription(userId),
      this.repo.hasHadTrial(userId),
      this.repo.getUserTotalPoints(userId),
    ]);
    const profile = buildBillingProfile(userId, sub, hadTrial);
    return {
      ...profile,
      availablePoints: points,
    };
  }

  async activateTrial(userId: string): Promise<SubscriptionRecord> {
    return this.repo.activateTrial(userId, { provider: this.gateway.provider });
  }

  async subscribeWithPoints(
    userId: string,
    planTier: "PRO_MONTHLY" | "PRO_ANNUAL",
  ): Promise<SubscriptionRecord> {
    return this.repo.subscribeWithPoints(userId, planTier);
  }

  async createCheckout(
    userId: string,
    planTier: "PRO_MONTHLY" | "PRO_ANNUAL",
    baseUrl: string,
  ) {
    const successUrl = `${baseUrl}/?pro_checkout_success=true`;
    const cancelUrl = `${baseUrl}/?pro_checkout_canceled=true`;

    const result = await this.gateway.createCheckoutSession({
      userId,
      planTier,
      provider: this.gateway.provider,
      successUrl,
      cancelUrl,
    });

    const amountCents = planTier === "PRO_MONTHLY" ? 1999 : 14999;

    await this.repo.recordCheckoutSession({
      id: randomUUID(),
      userId,
      planTier,
      provider: this.gateway.provider,
      sessionId: result.sessionId,
      amountCents,
    });

    return result;
  }

  async handleWebhook(payloadText: string, signature: string) {
    const event = await this.gateway.verifyWebhookSignature(payloadText, signature);

    const isFirstTime = await this.repo.recordWebhookEvent({
      id: event.id,
      provider: this.gateway.provider,
      eventType: event.type,
      payload: event,
    });

    if (!isFirstTime) {
      return { success: true, duplicate: true, eventType: event.type };
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        id?: string;
        client_reference_id?: string;
        metadata?: { userId?: string };
        customer?: string;
        subscription?: string;
      };
      const sessionId = session.id as string;
      const userId = (session.client_reference_id ?? session.metadata?.userId) as string;
      const customerId = (session.customer ?? null) as string | null;
      const subscriptionId = (session.subscription ?? null) as string | null;

      if (sessionId) {
        await this.repo.completeCheckoutSession(sessionId);
      }

      if (userId) {
        const now = new Date();
        const periodEnd = calculatePeriodEnd("PRO_MONTHLY", now);
        await this.repo.upsertSubscription({
          id: randomUUID(),
          userId,
          planTier: "PRO_MONTHLY",
          status: "ACTIVE",
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
          cancelAtPeriodEnd: false,
          canceledAt: null,
          trialStart: null,
          trialEnd: null,
          provider: this.gateway.provider,
          providerCustomerId: customerId,
          providerSubscriptionId: subscriptionId,
        });
      }
    } else if (event.type === "customer.subscription.deleted") {
      const subObj = event.data.object as {
        id?: string;
        customer?: string;
        metadata?: { userId?: string };
      };
      const subId = subObj.id as string;
      if (subId) {
        // Expire or cancel
        const now = new Date();
        const userId = subObj.metadata?.userId;
        if (userId) {
          await this.repo.upsertSubscription({
            id: randomUUID(),
            userId,
            planTier: "FREE",
            status: "CANCELED",
            currentPeriodStart: now.toISOString(),
            currentPeriodEnd: now.toISOString(),
            cancelAtPeriodEnd: false,
            canceledAt: now.toISOString(),
            trialStart: null,
            trialEnd: null,
            provider: this.gateway.provider,
            providerCustomerId: subObj.customer as string | null,
            providerSubscriptionId: subId,
          });
        }
      }
    }

    return { success: true, duplicate: false, eventType: event.type };
  }
}

declare global {
  var __pulseBillingService: BillingService | undefined;
}

export function getBillingService(): BillingService {
  if (globalThis.__pulseBillingService) return globalThis.__pulseBillingService;
  const config = loadIdentityConfig(process.env);
  const repo = getBillingRepository(config.databaseUrl);
  const gateway = getPaymentGateway();
  const service = new BillingService(repo, gateway);
  globalThis.__pulseBillingService = service;
  return service;
}
