import type {
  ProFeature,
  SubscriptionRecord,
  SubscriptionTier,
  UserBillingProfile,
} from "./types.js";

export const PRO_TRIAL_DAYS = 7;
export const PRO_MONTHLY_DAYS = 30;
export const PRO_ANNUAL_DAYS = 365;

/**
 * Checks whether an active subscription confers PULSE PRO rights at the given instant.
 * A subscription confers PRO if:
 * 1. Status is "TRIALING" or "ACTIVE"
 * 2. Status is "PAST_DUE" but within grace period (up to 3 days after currentPeriodEnd)
 * 3. Current time is before the effective expiry threshold
 */
export function hasProAccess(
  subscription: SubscriptionRecord | null,
  now: Date = new Date(),
): boolean {
  if (!subscription) return false;
  if (subscription.planTier === "FREE") return false;

  const nowMs = now.getTime();
  const endMs = new Date(subscription.currentPeriodEnd).getTime();

  if (subscription.status === "ACTIVE" || subscription.status === "TRIALING") {
    return nowMs < endMs;
  }

  // Grace period for PAST_DUE: 3 days grace before cutting off
  if (subscription.status === "PAST_DUE") {
    const graceEndMs = endMs + 3 * 24 * 60 * 60 * 1000;
    return nowMs < graceEndMs;
  }

  return false;
}

/**
 * Computes remaining days of active access. Returns 0 if expired or not active.
 */
export function getDaysRemaining(
  subscription: SubscriptionRecord | null,
  now: Date = new Date(),
): number {
  if (!hasProAccess(subscription, now)) return 0;
  const nowMs = now.getTime();
  const endMs = new Date(subscription!.currentPeriodEnd).getTime();
  const diffMs = Math.max(0, endMs - nowMs);
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Computes target period end given plan tier and start timestamp.
 */
export function calculatePeriodEnd(
  planTier: SubscriptionTier,
  startDate: Date = new Date(),
): Date {
  const result = new Date(startDate.getTime());
  switch (planTier) {
    case "PRO_TRIAL":
      result.setDate(result.getDate() + PRO_TRIAL_DAYS);
      break;
    case "PRO_MONTHLY":
      result.setDate(result.getDate() + PRO_MONTHLY_DAYS);
      break;
    case "PRO_ANNUAL":
      result.setDate(result.getDate() + PRO_ANNUAL_DAYS);
      break;
    case "FREE":
    default:
      break;
  }
  return result;
}

/**
 * Checks if a subscription should be automatically downgraded to EXPIRED.
 */
export function isSubscriptionExpired(
  subscription: SubscriptionRecord,
  now: Date = new Date(),
): boolean {
  if (subscription.status === "EXPIRED" || subscription.status === "CANCELED") {
    return true;
  }
  const nowMs = now.getTime();
  const endMs = new Date(subscription.currentPeriodEnd).getTime();
  return nowMs >= endMs;
}

/**
 * Validates feature access for specific PRO quantitative metrics.
 */
export function canAccessProFeature(
  subscription: SubscriptionRecord | null,
  feature: ProFeature,
  now: Date = new Date(),
): boolean {
  if (!hasProAccess(subscription, now)) return false;

  // Currently all PRO features are unlocked with any valid PRO tier
  const allowedFeatures: ProFeature[] = [
    "monte_carlo_matrix",
    "xg_advanced_breakdown",
    "sharp_money_detector",
    "vip_crest_badge",
    "early_lineup_alerts",
  ];
  return allowedFeatures.includes(feature);
}

/**
 * Helper to build user billing profile overview.
 */
export function buildBillingProfile(
  userId: string,
  subscription: SubscriptionRecord | null,
  hasHadTrialBefore: boolean = false,
  now: Date = new Date(),
): UserBillingProfile {
  const isPro = hasProAccess(subscription, now);
  const daysRemaining = getDaysRemaining(subscription, now);
  const trialAvailable = !hasHadTrialBefore && (!subscription || subscription.planTier === "FREE");

  return {
    userId,
    subscription,
    isPro,
    daysRemaining,
    trialAvailable,
  };
}
