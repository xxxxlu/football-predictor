import type { Capability } from "../identity/capabilities.js";

/**
 * Unified operations overview (FR81, NFR38, NFR39).
 *
 * The workbench answers two questions — what needs attention, and who did what —
 * without letting aggregation become a way around the capability matrix. Each
 * card declares the capability that entitles an operator to *its own* summary,
 * and each card's next step declares its own capability again. An operator sees
 * the cards their duties cover and nothing else; the totals they see are computed
 * from the same scoped reads their individual consoles use.
 *
 * Everything here is pure so the assembly rules and the severity thresholds can
 * be tested without a database.
 */

export const OVERVIEW_CARDS = [
  "SUPPLIER_HEALTH",
  "SETTLEMENT_HEALTH",
  "JOB_HEALTH",
  "REPORT_QUEUE",
  "ACCOUNT_RISK",
  "ROLE_CHANGES",
  "HIGH_RISK_ACTIONS",
] as const;
export type OverviewCard = (typeof OVERVIEW_CARDS)[number];

/** The capability that entitles an operator to a card's summary. */
export const OVERVIEW_CARD_CAPABILITY: Record<OverviewCard, Capability> = {
  SUPPLIER_HEALTH: "OPERATIONS_HEALTH_READ",
  SETTLEMENT_HEALTH: "OPERATIONS_HEALTH_READ",
  JOB_HEALTH: "OPERATIONS_HEALTH_READ",
  REPORT_QUEUE: "ROOM_REPORT_READ",
  ACCOUNT_RISK: "USER_SECURITY_READ",
  ROLE_CHANGES: "OPERATOR_ROLE_MANAGE",
  HIGH_RISK_ACTIONS: "AUDIT_READ",
};

/**
 * The capabilities that entitle an account to *some* overview. The aggregate route
 * admits anyone holding one of these and then shows only their own cards; an
 * account holding none of them has no operational duty and is refused outright.
 */
export const OVERVIEW_CAPABILITIES: readonly Capability[] = [...new Set(Object.values(OVERVIEW_CARD_CAPABILITY))];

export interface OverviewAction {
  label: string;
  href: string;
  capability: Capability;
}

/**
 * The one thing a card invites you to do next. Its capability is checked
 * separately from the card's: reading that four jobs failed is a health question,
 * retrying one is an operational write.
 */
export const OVERVIEW_CARD_ACTION: Record<OverviewCard, OverviewAction | null> = {
  SUPPLIER_HEALTH: null,
  SETTLEMENT_HEALTH: null,
  JOB_HEALTH: { label: "重试失败任务", href: "/admin/status#failed-jobs", capability: "OPERATIONS_TASK_RETRY" },
  REPORT_QUEUE: { label: "打开治理收件箱", href: "/admin/moderation", capability: "ROOM_REPORT_READ" },
  ACCOUNT_RISK: { label: "打开用户安全台", href: "/admin/users", capability: "USER_SECURITY_READ" },
  ROLE_CHANGES: { label: "管理运营职责", href: "/admin/operators", capability: "OPERATOR_ROLE_MANAGE" },
  HIGH_RISK_ACTIONS: { label: "查看完整审计", href: "/admin/status#audit", capability: "AUDIT_READ" },
};

/** How loudly a card should speak. `ACT` means something is waiting on a person. */
export const OVERVIEW_SEVERITIES = ["OK", "WATCH", "ACT"] as const;
export type OverviewSeverity = (typeof OVERVIEW_SEVERITIES)[number];

const RANK: Record<OverviewSeverity, number> = { OK: 0, WATCH: 1, ACT: 2 };

export function visibleOverviewCards(capabilities: Iterable<Capability>): OverviewCard[] {
  const held = capabilities instanceof Set ? capabilities : new Set(capabilities);
  return OVERVIEW_CARDS.filter((card) => held.has(OVERVIEW_CARD_CAPABILITY[card]));
}

export function overviewNextStep(card: OverviewCard, capabilities: Iterable<Capability>): OverviewAction | null {
  const action = OVERVIEW_CARD_ACTION[card];
  if (!action) return null;
  const held = capabilities instanceof Set ? capabilities : new Set(capabilities);
  return held.has(action.capability) ? action : null;
}

/**
 * The headline. Deliberately the worst of what *this* operator can see: telling a
 * community moderator the platform is critical because of a supplier budget they
 * have no duty over — and cannot act on — is noise, not information.
 */
export function overallSeverity(severities: Iterable<OverviewSeverity>): OverviewSeverity {
  let worst: OverviewSeverity = "OK";
  for (const severity of severities) if (RANK[severity] > RANK[worst]) worst = severity;
  return worst;
}

/** Supplier budget: the settlement reserve is the line that must not be crossed (NFR39). */
export function supplierSeverity(input: { generalRemaining: number; staleMatches: number; unavailableMatches: number }): OverviewSeverity {
  if (input.generalRemaining <= 0 || input.unavailableMatches > 0) return "ACT";
  if (input.generalRemaining <= 10 || input.staleMatches > 0) return "WATCH";
  return "OK";
}

export function settlementSeverity(input: { failed: number; pending: number; overdueSettlements: number }): OverviewSeverity {
  if (input.failed > 0 || input.overdueSettlements > 0) return "ACT";
  if (input.pending > 0) return "WATCH";
  return "OK";
}

/**
 * NFR38 asks a super-admin to see a critical failure within five minutes, so a
 * failed job is `ACT` from the moment it lands rather than after a grace period.
 * A queue that has drifted past five minutes of lag is worth watching.
 */
export const JOB_LAG_WATCH_SECONDS = 300;

export function jobSeverity(input: { failed: number; maxLagSeconds: number }): OverviewSeverity {
  if (input.failed > 0) return "ACT";
  if (input.maxLagSeconds > JOB_LAG_WATCH_SECONDS) return "WATCH";
  return "OK";
}

/** A report nobody has claimed is the thing that actually needs a person. */
export function reportQueueSeverity(input: { unassigned: number; pending: number }): OverviewSeverity {
  if (input.unassigned > 0) return "ACT";
  if (input.pending > 0) return "WATCH";
  return "OK";
}

/**
 * Account risk leads with the seven-day anonymization service level (NFR22): an
 * overdue request is a commitment already broken, while disabled accounts and
 * owners of restricted rooms are standing state an operator should merely be
 * aware of. Every input here is a figure the user security roster already shows
 * to the same capability, so the card summarises rather than widens.
 */
export function accountRiskSeverity(input: { overdueAnonymizations: number; openAnonymizations: number; disabledAccounts: number; restrictedRoomOwners: number }): OverviewSeverity {
  if (input.overdueAnonymizations > 0) return "ACT";
  if (input.openAnonymizations > 0 || input.restrictedRoomOwners > 0) return "WATCH";
  return input.disabledAccounts > 0 ? "WATCH" : "OK";
}
