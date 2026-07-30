import { AuthError, type AccountStatus } from "./service.js";
import type { GrantableOperatorRole } from "./capabilities.js";

/**
 * User security and lifecycle console (FR81, FR82).
 *
 * This module owns the *shape* of what an operator may see about one account and
 * the rules for narrowing the roster. Everything here is pure so the projection
 * contract can be tested without a database.
 *
 * The projection is deliberately thin. An operator sees identity, security state,
 * counts and governance history — never a credential, never a session token,
 * never a precise location, never an unsealed pick, never a ledger figure. There
 * is no field here that could be written back, so FR59 holds by construction.
 */

const DAY_MS = 86_400_000;
/** NFR22: public-identity removal is due within seven days of the request. */
export const ANONYMIZATION_SLA_DAYS = 7;
const MAX_SEARCH_LENGTH = 32;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

export const ACCOUNT_STATUS_FILTERS = ["ALL", "ACTIVE", "DISABLED"] as const;
export const ACTIVITY_FILTERS = ["ALL", "LAST_24H", "LAST_7D", "LAST_30D", "DORMANT_30D", "NEVER"] as const;
export const RESTRICTION_FILTERS = ["ALL", "COMMUNITY_RESTRICTED", "UNRESTRICTED"] as const;

export type AccountStatusFilter = (typeof ACCOUNT_STATUS_FILTERS)[number];
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];
export type RestrictionFilter = (typeof RESTRICTION_FILTERS)[number];

export interface UserSecurityQuery {
  search: string;
  status: AccountStatusFilter;
  activity: ActivityFilter;
  restriction: RestrictionFilter;
  minRooms: number;
  limit: number;
}

export type ActivityBucket = "ACTIVE_24H" | "ACTIVE_7D" | "ACTIVE_30D" | "DORMANT" | "NEVER";

export interface UserSecuritySummary {
  id: string;
  username: string;
  nickname: string | null;
  status: AccountStatus;
  lastSeenAt: Date | null;
  activityBucket: ActivityBucket;
  activeSessionCount: number;
  roomCount: number;
  ownedRoomCount: number;
  restrictedRoomCount: number;
  openReportCount: number;
  communityRestricted: boolean;
}

export interface GovernanceHistoryEntry {
  id: string;
  action: string;
  actor: string | null;
  result: string;
  metadata: unknown;
  occurredAt: Date;
}

export type AnonymizationStatus = "RECEIVED" | "COMPLETED";

export interface AnonymizationRecord {
  requestedAt: Date;
  status: AnonymizationStatus;
  completedAt: Date | null;
}

export interface AnonymizationSummary {
  status: AnonymizationStatus;
  dueAt: Date;
  overdue: boolean;
  daysRemaining: number;
}

export interface UserSecurityDetail extends Omit<UserSecuritySummary, never> {
  registeredAt: Date;
  operatorRoles: GrantableOperatorRole[];
  governanceHistory: GovernanceHistoryEntry[];
  anonymization: AnonymizationSummary | null;
}

function invalid(field: string): never {
  throw new AuthError("INVALID_REQUEST", 422, `Check the ${field} filter and try again.`);
}

function readEnum<T extends string>(raw: string | null | undefined, allowed: readonly T[], field: string): T {
  if (raw === null || raw === undefined || raw === "") return allowed[0]!;
  return allowed.includes(raw as T) ? (raw as T) : invalid(field);
}

function readBoundedInteger(raw: string | null | undefined, field: string, min: number, max: number, fallback: number): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) return invalid(field);
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid(field);
}

/**
 * Validates roster filters. Anything unrecognised is refused rather than ignored:
 * a silently dropped filter would widen the read the operator believed they had
 * narrowed.
 */
export function parseUserSecurityQuery(raw: Record<string, string | null | undefined>): UserSecurityQuery {
  return {
    // Only the characters a username can contain survive, so the value can never
    // carry a LIKE wildcard or control character into the query.
    search: (raw.search ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, MAX_SEARCH_LENGTH),
    status: readEnum(raw.status, ACCOUNT_STATUS_FILTERS, "status"),
    activity: readEnum(raw.activity, ACTIVITY_FILTERS, "activity"),
    restriction: readEnum(raw.restriction, RESTRICTION_FILTERS, "restriction"),
    minRooms: readBoundedInteger(raw.minRooms, "minRooms", 0, 1000, 0),
    limit: readBoundedInteger(raw.limit, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT),
  };
}

/** Buckets an account by last observed session activity. Boundaries favour the shorter window. */
export function activityBucket(lastSeenAt: Date | null, now: Date): ActivityBucket {
  if (!lastSeenAt) return "NEVER";
  const elapsed = now.getTime() - lastSeenAt.getTime();
  if (elapsed <= DAY_MS) return "ACTIVE_24H";
  if (elapsed <= 7 * DAY_MS) return "ACTIVE_7D";
  if (elapsed <= 30 * DAY_MS) return "ACTIVE_30D";
  return "DORMANT";
}

const ACTIVITY_FILTER_BUCKETS: Record<Exclude<ActivityFilter, "ALL">, readonly ActivityBucket[]> = {
  LAST_24H: ["ACTIVE_24H"],
  LAST_7D: ["ACTIVE_24H", "ACTIVE_7D"],
  LAST_30D: ["ACTIVE_24H", "ACTIVE_7D", "ACTIVE_30D"],
  DORMANT_30D: ["DORMANT"],
  NEVER: ["NEVER"],
};

export function matchesActivityFilter(bucket: ActivityBucket, filter: ActivityFilter): boolean {
  return filter === "ALL" || ACTIVITY_FILTER_BUCKETS[filter].includes(bucket);
}

/**
 * Restates an anonymization request as a service level rather than a raw row, so
 * the console can show an operator what is owed and by when (NFR22). A completed
 * request is never "overdue" after the fact — it is closed.
 */
export function summarizeLifecycle(record: AnonymizationRecord | null, now: Date): AnonymizationSummary | null {
  if (!record) return null;
  const dueAt = new Date(record.requestedAt.getTime() + ANONYMIZATION_SLA_DAYS * DAY_MS);
  if (record.status === "COMPLETED") return { status: "COMPLETED", dueAt, overdue: false, daysRemaining: 0 };
  const remainingMs = dueAt.getTime() - now.getTime();
  return { status: "RECEIVED", dueAt, overdue: remainingMs <= 0, daysRemaining: Math.max(0, Math.floor(remainingMs / DAY_MS)) };
}

/**
 * Field names the console must never carry, in either snake_case or camelCase.
 * Kept as an explicit list so the ban is reviewable rather than implied by a
 * regular expression buried in a helper.
 */
export const FORBIDDEN_USER_SECURITY_KEYS = [
  "password", "passwordhash", "recovery", "recoverycode", "recoverycodehash", "recovery_code", "recovery_code_hash",
  "token", "tokenhash", "token_hash", "sessiontoken", "session_token", "proof", "prooftoken", "secret", "credential",
  "ipaddress", "ip_address", "latitude", "longitude", "city", "region", "timezone", "useragent", "user_agent",
  "selection", "selections", "stake", "stakepoints", "stake_points", "odds",
  "balance", "availablepoints", "available_points", "frozenpoints", "frozen_points", "ledger", "ledgerentries", "ledger_entries",
] as const;

const FORBIDDEN_KEY_SET = new Set<string>(FORBIDDEN_USER_SECURITY_KEYS);

/**
 * The placeholder audit redaction leaves behind. Shared with the redaction
 * routine so the two cannot drift: audit metadata legitimately keeps a
 * secret-like key name with its value replaced, and that carries no information.
 */
export const REDACTION_MARKER = "[REDACTED]";

/**
 * Defensive projection guard, in the same spirit as redactAuditMetadata: walks a
 * response payload and refuses any banned field, at any depth. A future writer
 * who widens a SELECT gets a failing test instead of a leak in production.
 *
 * A banned key is tolerated only when its value is exactly the redaction marker,
 * because that is what a governance timeline looks like after redaction. Any
 * actual value under a banned name is still a failure.
 */
export function assertSafeUserSecurityPayload(payload: unknown, path = "$"): void {
  if (Array.isArray(payload)) {
    payload.forEach((entry, index) => assertSafeUserSecurityPayload(entry, `${path}[${index}]`));
    return;
  }
  if (!payload || typeof payload !== "object" || payload instanceof Date) return;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    const banned = FORBIDDEN_KEY_SET.has(normalized) || /(passwordhash|recoverycode|tokenhash|sessiontoken)/.test(normalized.replace(/_/g, ""));
    if (banned && value !== REDACTION_MARKER) {
      throw new Error(`User security projection must not expose "${key}" (at ${path}.${key})`);
    }
    assertSafeUserSecurityPayload(value, `${path}.${key}`);
  }
}
