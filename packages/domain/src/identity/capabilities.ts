import { createCapabilityModel } from "@pulse/guardrails";

/**
 * Capability-based operator authorization (FR80, FR81).
 *
 * The product keeps exactly two `SUPER_ADMIN` accounts, provisioned only by
 * packages/db/scripts/seed-super-admins.mjs. Everything added on top is a
 * *restricted duty* granted per account and persisted as its own grant row, so
 * what an operator may do is a server-side fact re-read on every request rather
 * than a front-end decision.
 *
 * Deliberately absent: no capability in this list can overwrite a point
 * balance, edit or delete a prediction, or mutate a ledger entry. FR59 holds
 * for every role including `SUPER_ADMIN`, and the list is closed — introducing
 * such a capability would have to be a deliberate, reviewable change here.
 */

export const OPERATOR_CAPABILITIES = [
  /** Grant or revoke a restricted operator duty. Super-admin only. */
  "OPERATOR_ROLE_MANAGE",
  /** Read the account roster and per-account security state (no credentials). */
  "USER_SECURITY_READ",
  /** Disable or restore a normal account (FR55). */
  "USER_SECURITY_WRITE",
  /** Read room rosters, status and visibility settings. */
  "ROOM_GOVERNANCE_READ",
  /** Restrict, close or restore a room and change its stake visibility (FR56). */
  "ROOM_GOVERNANCE_WRITE",
  /** Read the report queue — the shared entry point for room and community triage (FR90). */
  "ROOM_REPORT_READ",
  /** Read reported chat/community content and its moderation state (Story 11.3). */
  "COMMUNITY_GOVERNANCE_READ",
  /** Hide reported content, mute a member, resolve a report (Story 11.3). */
  "COMMUNITY_GOVERNANCE_WRITE",
  /** Read the read-only operational health view (supplier budget, cache, jobs). */
  "OPERATIONS_HEALTH_READ",
  /** Retry a failed background job (FR58, Story 11.4). */
  "OPERATIONS_TASK_RETRY",
  /** Read the merged governance audit trail (FR60, NFR23). */
  "AUDIT_READ",
  /** Read aggregate audience statistics (coarse location, device mix). */
  "AUDIENCE_ANALYTICS_READ",
  /** Enter, confirm or cancel an official competition result — triggers settlement. */
  "COMPETITION_RESULT_ENTRY",
] as const;

export type Capability = (typeof OPERATOR_CAPABILITIES)[number];

export const OPERATOR_ROLES = ["SUPER_ADMIN", "OPERATIONS_ADMIN", "COMMUNITY_MODERATOR"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

/**
 * Roles a super-admin may hand out. `SUPER_ADMIN` is absent by construction:
 * the pair is provisioned by the seed CLI and there is no product path to a
 * third one.
 */
export const GRANTABLE_OPERATOR_ROLES = ["OPERATIONS_ADMIN", "COMMUNITY_MODERATOR"] as const;
export type GrantableOperatorRole = (typeof GRANTABLE_OPERATOR_ROLES)[number];

/** How many `SUPER_ADMIN` accounts the system is allowed to hold (FR80). */
export const SUPER_ADMIN_COUNT = 2;

const OPERATIONS_ADMIN_CAPABILITIES = [
  "USER_SECURITY_READ",
  "USER_SECURITY_WRITE",
  "ROOM_GOVERNANCE_READ",
  "ROOM_GOVERNANCE_WRITE",
  "ROOM_REPORT_READ",
  "OPERATIONS_HEALTH_READ",
  "OPERATIONS_TASK_RETRY",
] as const satisfies readonly Capability[];

const COMMUNITY_MODERATOR_CAPABILITIES = [
  "ROOM_REPORT_READ",
  "COMMUNITY_GOVERNANCE_READ",
  "COMMUNITY_GOVERNANCE_WRITE",
] as const satisfies readonly Capability[];

export const ROLE_CAPABILITIES: Record<OperatorRole, readonly Capability[]> = {
  SUPER_ADMIN: OPERATOR_CAPABILITIES,
  OPERATIONS_ADMIN: OPERATIONS_ADMIN_CAPABILITIES,
  COMMUNITY_MODERATOR: COMMUNITY_MODERATOR_CAPABILITIES,
};

/**
 * Capabilities whose exercise needs a fresh identity confirmation (NFR18).
 * Every state-changing capability is here; reads are not.
 */
export const REAUTH_REQUIRED_CAPABILITIES = [
  "OPERATOR_ROLE_MANAGE",
  "USER_SECURITY_WRITE",
  "ROOM_GOVERNANCE_WRITE",
  "COMMUNITY_GOVERNANCE_WRITE",
  "OPERATIONS_TASK_RETRY",
  "COMPETITION_RESULT_ENTRY",
] as const satisfies readonly Capability[];

/**
 * The tables above are the policy; the resolution mechanism is
 * `@pulse/guardrails`. Splitting them is what keeps this file readable as a
 * specification — everything here is a statement about *this* product, and none
 * of it is set arithmetic.
 */
const MODEL = createCapabilityModel<OperatorRole, Capability>({
  roleCapabilities: ROLE_CAPABILITIES,
  reauthRequired: REAUTH_REQUIRED_CAPABILITIES,
});

/** Resolves the effective capability set for a set of held roles. */
export function capabilitiesFor(roles: readonly OperatorRole[]): Set<Capability> {
  return MODEL.capabilitiesFor(roles);
}

export function hasCapability(roles: readonly OperatorRole[], capability: Capability): boolean {
  return MODEL.hasCapability(roles, capability);
}

export function requiresReauthentication(capability: Capability): boolean {
  return MODEL.requiresReauthentication(capability);
}

export function isGrantableOperatorRole(value: unknown): value is GrantableOperatorRole {
  return typeof value === "string" && (GRANTABLE_OPERATOR_ROLES as readonly string[]).includes(value);
}

export function isOperatorRole(value: unknown): value is OperatorRole {
  return typeof value === "string" && (OPERATOR_ROLES as readonly string[]).includes(value);
}

/** Roles held by an account: the seeded super-admin flag plus its active grants. */
export function operatorRolesOf(account: { isSuperAdmin: boolean; operatorRoles?: readonly GrantableOperatorRole[] }): OperatorRole[] {
  return account.isSuperAdmin ? ["SUPER_ADMIN", ...(account.operatorRoles ?? [])] : [...(account.operatorRoles ?? [])];
}
