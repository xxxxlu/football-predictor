export type SubscriptionTier = "FREE" | "PRO_TRIAL" | "PRO_MONTHLY" | "PRO_ANNUAL";

export type SubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "EXPIRED";

export type BillingProvider = "points" | "stripe" | "alipay" | "wechat" | "mock_gateway";

export const PRO_POINTS_PRICING = {
  PRO_MONTHLY: 5000,
  PRO_ANNUAL: 38000,
} as const;

export interface SubscriptionRecord {
  id: string;
  userId: string;
  planTier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodStart: string; // ISO string
  currentPeriodEnd: string;   // ISO string
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  provider: BillingProvider;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserBillingProfile {
  userId: string;
  subscription: SubscriptionRecord | null;
  isPro: boolean;
  daysRemaining: number;
  trialAvailable: boolean;
  availablePoints?: number;
}

export type ProFeature =
  | "monte_carlo_matrix"
  | "xg_advanced_breakdown"
  | "sharp_money_detector"
  | "vip_crest_badge"
  | "early_lineup_alerts";

export interface CheckoutSessionParams {
  userId: string;
  planTier: "PRO_MONTHLY" | "PRO_ANNUAL";
  provider: BillingProvider;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  provider: BillingProvider;
}
