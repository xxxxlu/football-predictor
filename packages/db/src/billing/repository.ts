import { randomUUID } from "node:crypto";
import type {
  BillingProvider,
  SubscriptionRecord,
  SubscriptionStatus,
  SubscriptionTier,
} from "@pulse/domain";
import { calculatePeriodEnd, PRO_POINTS_PRICING } from "@pulse/domain";
import type postgres from "postgres";

export type BillingSql = postgres.Sql;

interface DbSubscriptionRow {
  id: string;
  user_id: string;
  plan_tier: string;
  status: string;
  current_period_start: Date;
  current_period_end: Date;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
  trial_start: Date | null;
  trial_end: Date | null;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapSubscription(row: DbSubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    planTier: row.plan_tier as SubscriptionTier,
    status: row.status as SubscriptionStatus,
    currentPeriodStart: row.current_period_start.toISOString(),
    currentPeriodEnd: row.current_period_end.toISOString(),
    cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: row.canceled_at ? row.canceled_at.toISOString() : null,
    trialStart: row.trial_start ? row.trial_start.toISOString() : null,
    trialEnd: row.trial_end ? row.trial_end.toISOString() : null,
    provider: row.provider as BillingProvider,
    providerCustomerId: row.provider_customer_id,
    providerSubscriptionId: row.provider_subscription_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresBillingRepository {
  constructor(private readonly sql: BillingSql) {}

  /**
   * Retrieves the current active or trialing subscription for a user.
   */
  async getActiveSubscription(userId: string): Promise<SubscriptionRecord | null> {
    const [row] = await this.sql<DbSubscriptionRow[]>`
      SELECT * FROM "billing"."subscriptions"
      WHERE user_id = ${userId}
        AND status IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
      LIMIT 1
    `;
    return row ? mapSubscription(row) : null;
  }

  /**
   * Checks whether the user has ever claimed a PRO trial (prevent trial abuse).
   */
  async hasHadTrial(userId: string): Promise<boolean> {
    const [row] = await this.sql<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM "billing"."subscriptions"
        WHERE user_id = ${userId} AND trial_start IS NOT NULL
      ) AS "exists"
    `;
    return Boolean(row?.exists);
  }

  /**
   * Activates a 7-day free trial for an eligible user.
   */
  async activateTrial(
    userId: string,
    options: { provider?: BillingProvider; now?: Date } = {},
  ): Promise<SubscriptionRecord> {
    const now = options.now ?? new Date();
    const trialEnd = calculatePeriodEnd("PRO_TRIAL", now);
    const provider = options.provider ?? "stripe";
    const subId = randomUUID();

    // Check if user already has an active subscription
    const existing = await this.getActiveSubscription(userId);
    if (existing) {
      throw new Error("User already has an active subscription");
    }

    // Check if trial was ever used
    const hadTrial = await this.hasHadTrial(userId);
    if (hadTrial) {
      throw new Error("Free trial has already been claimed for this account");
    }

    const [row] = await this.sql<DbSubscriptionRow[]>`
      INSERT INTO "billing"."subscriptions" (
        id, user_id, plan_tier, status,
        current_period_start, current_period_end,
        trial_start, trial_end, provider,
        created_at, updated_at
      ) VALUES (
        ${subId}, ${userId}, 'PRO_TRIAL', 'TRIALING',
        ${now}, ${trialEnd},
        ${now}, ${trialEnd}, ${provider},
        ${now}, ${now}
      )
      RETURNING *
    `;

    if (!row) {
      throw new Error("Failed to activate trial subscription");
    }
    return mapSubscription(row);
  }

  /**
   * Inserts or updates a subscription upon payment or renewal.
   */
  async upsertSubscription(
    sub: Omit<SubscriptionRecord, "createdAt" | "updatedAt">,
  ): Promise<SubscriptionRecord> {
    const now = new Date();
    const [row] = await this.sql<DbSubscriptionRow[]>`
      INSERT INTO "billing"."subscriptions" (
        id, user_id, plan_tier, status,
        current_period_start, current_period_end,
        cancel_at_period_end, canceled_at,
        trial_start, trial_end,
        provider, provider_customer_id, provider_subscription_id,
        created_at, updated_at
      ) VALUES (
        ${sub.id}, ${sub.userId}, ${sub.planTier}, ${sub.status},
        ${new Date(sub.currentPeriodStart)}, ${new Date(sub.currentPeriodEnd)},
        ${sub.cancelAtPeriodEnd}, ${sub.canceledAt ? new Date(sub.canceledAt) : null},
        ${sub.trialStart ? new Date(sub.trialStart) : null}, ${sub.trialEnd ? new Date(sub.trialEnd) : null},
        ${sub.provider}, ${sub.providerCustomerId}, ${sub.providerSubscriptionId},
        ${now}, ${now}
      )
      ON CONFLICT (id) DO UPDATE SET
        plan_tier = EXCLUDED.plan_tier,
        status = EXCLUDED.status,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        canceled_at = EXCLUDED.canceled_at,
        provider_customer_id = EXCLUDED.provider_customer_id,
        provider_subscription_id = EXCLUDED.provider_subscription_id,
        updated_at = ${now}
      RETURNING *
    `;
    if (!row) {
      throw new Error("Failed to upsert subscription");
    }
    return mapSubscription(row);
  }

  /**
   * Records a pending checkout session.
   */
  async recordCheckoutSession(input: {
    id: string;
    userId: string;
    planTier: "PRO_MONTHLY" | "PRO_ANNUAL";
    provider: BillingProvider;
    sessionId: string;
    amountCents: number;
    currency?: string;
  }): Promise<void> {
    await this.sql`
      INSERT INTO "billing"."checkout_sessions" (
        id, user_id, plan_tier, provider, session_id,
        amount_cents, currency, status, created_at
      ) VALUES (
        ${input.id}, ${input.userId}, ${input.planTier}, ${input.provider}, ${input.sessionId},
        ${input.amountCents}, ${input.currency ?? "usd"}, 'PENDING', now()
      )
    `;
  }

  /**
   * Marks a checkout session as completed.
   */
  async completeCheckoutSession(sessionId: string): Promise<void> {
    await this.sql`
      UPDATE "billing"."checkout_sessions"
      SET status = 'COMPLETED', completed_at = now()
      WHERE session_id = ${sessionId}
    `;
  }

  /**
   * Idempotent audit log for inbound webhook events.
   * Returns true if newly inserted, false if already processed.
   */
  async recordWebhookEvent(input: {
    id: string;
    provider: BillingProvider;
    eventType: string;
    payload: unknown;
  }): Promise<boolean> {
    const rows = await this.sql`
      INSERT INTO "billing"."webhook_events" (id, provider, event_type, payload, processed_at)
      VALUES (${input.id}, ${input.provider}, ${input.eventType}, ${JSON.stringify(input.payload)}, now())
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    return rows.length > 0;
  }

  /**
   * Background sweep / worker task: downgrades expired subscriptions to EXPIRED.
   */
  async downgradeExpiredSubscriptions(now: Date = new Date()): Promise<number> {
    const result = await this.sql`
      UPDATE "billing"."subscriptions"
      SET status = 'EXPIRED', updated_at = ${now}
      WHERE status IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
        AND current_period_end < ${now}
    `;
    return result.count;
  }

  /**
   * Retrieves the user's total available points across all rooms.
   */
  async getUserTotalPoints(userId: string): Promise<number> {
    const [row] = await this.sql<Array<{ total: string }>>`
      SELECT COALESCE(SUM(available_points), 0) AS total
      FROM ledger.point_accounts
      WHERE user_id = ${userId}
    `;
    return Number(row?.total ?? 0);
  }

  /**
   * Subscribes user to PULSE PRO using virtual points from their ledger account.
   */
  async subscribeWithPoints(
    userId: string,
    planTier: "PRO_MONTHLY" | "PRO_ANNUAL",
    options: { now?: Date } = {},
  ): Promise<SubscriptionRecord> {
    const cost = PRO_POINTS_PRICING[planTier];
    const now = options.now ?? new Date();
    const periodEnd = calculatePeriodEnd(planTier, now);

    return this.sql.begin(async (tx) => {
      // 1. Lock and find room accounts with available points
      const accounts = await tx<Array<{ roomId: string; availablePoints: string }>>`
        SELECT room_id AS "roomId", available_points AS "availablePoints"
        FROM ledger.point_accounts
        WHERE user_id = ${userId} AND available_points > 0
        ORDER BY available_points DESC
        FOR UPDATE
      `;

      const totalAvailable = accounts.reduce((sum, acc) => sum + Number(acc.availablePoints), 0);
      if (totalAvailable < cost) {
        throw new Error(`INSUFFICIENT_POINTS: 需要 ${cost} 积分，当前可用 ${totalAvailable} 积分`);
      }

      // 2. Deduct points from accounts in order
      let remainingCost = cost;
      for (const account of accounts) {
        if (remainingCost <= 0) break;
        const available = Number(account.availablePoints);
        const toDeduct = Math.min(available, remainingCost);

        await tx`
          UPDATE ledger.point_accounts
          SET available_points = available_points - ${toDeduct},
              updated_at = ${now}
          WHERE room_id = ${account.roomId} AND user_id = ${userId}
        `;

        const ledgerId = randomUUID();
        await tx`
          INSERT INTO ledger.entries (
            id, room_id, user_id, kind, amount,
            available_delta_points, frozen_delta_points, correction_debt_delta_points,
            idempotency_key, audit_id, created_at
          ) VALUES (
            ${ledgerId}, ${account.roomId}, ${userId}, 'PRO_SUBSCRIPTION', ${toDeduct},
            ${-toDeduct}, 0, 0,
            ${`sub_points:${userId}:${planTier}:${account.roomId}:${now.getTime()}`},
            ${ledgerId}, ${now}
          )
        `;

        remainingCost -= toDeduct;
      }

      // 3. Check existing active subscription to extend or create new
      const [existing] = await tx<DbSubscriptionRow[]>`
        SELECT * FROM "billing"."subscriptions"
        WHERE user_id = ${userId}
          AND status IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
        FOR UPDATE
        LIMIT 1
      `;

      let effectiveEnd = periodEnd;
      let subId: string = randomUUID();

      if (existing) {
        subId = existing.id;
        const existingEnd = new Date(existing.current_period_end);
        if (existingEnd > now) {
          effectiveEnd = calculatePeriodEnd(planTier, existingEnd);
        }

        const [subRow] = await tx<DbSubscriptionRow[]>`
          UPDATE "billing"."subscriptions"
          SET plan_tier = ${planTier},
              status = 'ACTIVE',
              current_period_end = ${effectiveEnd},
              provider = 'points',
              updated_at = ${now}
          WHERE id = ${subId}
          RETURNING *
        `;
        return mapSubscription(subRow!);
      }

      const [subRow] = await tx<DbSubscriptionRow[]>`
        INSERT INTO "billing"."subscriptions" (
          id, user_id, plan_tier, status,
          current_period_start, current_period_end,
          cancel_at_period_end, canceled_at,
          trial_start, trial_end,
          provider, provider_customer_id, provider_subscription_id,
          created_at, updated_at
        ) VALUES (
          ${subId}, ${userId}, ${planTier}, 'ACTIVE',
          ${now}, ${periodEnd},
          false, null,
          null, null,
          'points', null, ${`points_${subId}`},
          ${now}, ${now}
        )
        RETURNING *
      `;

      if (!subRow) {
        throw new Error("Failed to activate points subscription");
      }

      return mapSubscription(subRow);
    }) as Promise<SubscriptionRecord>;
  }
}

import { getSharedIdentityDatabase } from "../identity/repository.js";

export function getBillingRepository(databaseUrl: string): PostgresBillingRepository {
  const { sql } = getSharedIdentityDatabase(databaseUrl);
  return new PostgresBillingRepository(sql);
}

