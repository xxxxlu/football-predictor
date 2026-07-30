import { AuthError } from "../identity/service.js";

/**
 * The unified permission audit (FR60, FR90, NFR37).
 *
 * Governance history lives in three tables — `ops.audit_events`,
 * `identity.admin_account_audit_events` and `room.audit_events`. FR60 requires a
 * single reviewable trail, and NFR37 requires every entry to carry an identifier
 * an operator can follow. This module owns the *vocabulary* of that trail: which
 * actions exist, what they act on, and how a filter request is validated.
 *
 * The action list is closed on purpose. An unrecognised filter is refused rather
 * than ignored, because a silently dropped filter shows an operator a wider trail
 * than the one they asked for — and because it keeps arbitrary text out of the
 * action predicate.
 *
 * Nothing here reads or shapes metadata: redaction stays in the repository, which
 * is the single point every one of the three tables passes through.
 */

const MAX_ACTOR_LENGTH = 32;
const MAX_LIMIT = 200;
/**
 * The unfiltered page is the same size the endpoint has always returned, so an
 * operator who passes no filters sees the trail they saw before it gained them.
 */
const DEFAULT_LIMIT = 200;

/** What an audited action was performed *on*. Widened as new targets appear. */
export const AUDIT_TARGET_TYPES = ["USER", "ROOM", "REPORT", "JOB"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];
export const AUDIT_TARGET_TYPE_FILTERS = ["ALL", ...AUDIT_TARGET_TYPES] as const;
export type AuditTargetTypeFilter = (typeof AUDIT_TARGET_TYPE_FILTERS)[number];

export const AUDIT_RESULTS = ["SUCCESS", "FAILURE"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];
export const AUDIT_RESULT_FILTERS = ["ALL", ...AUDIT_RESULTS] as const;
export type AuditResultFilter = (typeof AUDIT_RESULT_FILTERS)[number];

/**
 * Every action any of the three writers can persist, grouped the way an operator
 * thinks about them. The group is what the filter offers; an operator picks a
 * group and gets the whole family rather than guessing exact spellings.
 *
 * The spellings themselves are historical and are NOT normalised here — renaming
 * `ROOM_RESTRICT` would silently orphan every row already written under it.
 */
export const AUDIT_ACTION_GROUPS = [
  {
    group: "ROLE",
    label: "运营职责",
    /** Who was trusted with what, and when it was taken back (FR80). */
    actions: ["OPERATOR_ROLE_GRANTED", "OPERATOR_ROLE_REVOKED"],
  },
  {
    group: "ACCOUNT",
    label: "账户安全",
    actions: ["ACCOUNT_DISABLED", "ACCOUNT_RESTORED", "SESSIONS_REVOKED"],
  },
  {
    group: "PRIVACY",
    label: "隐私与生命周期",
    actions: ["ACCOUNT_ANONYMIZATION_REQUESTED", "ACCOUNT_ANONYMIZED"],
  },
  {
    group: "ROOM",
    label: "房间治理",
    actions: ["ROOM_RESTRICT", "ROOM_CLOSE", "ROOM_RESTORE", "ROOM_PRE_MATCH_STAKE_VISIBILITY_UPDATED", "INVITE_RESET"],
  },
  {
    group: "COMMUNITY",
    label: "社区治理",
    actions: ["ROOM_REPORTED", "MESSAGE_REPORTED", "REPORT_TRIAGED", "REPORT_RESOLVED", "REPORT_DISMISSED", "MEMBER_UNMUTED"],
  },
  {
    group: "TASK",
    label: "运营任务",
    actions: ["JOB_RETRY_REQUESTED"],
  },
  {
    group: "LIFECYCLE",
    label: "房间生命周期",
    actions: ["ROOM_CREATED", "ROOM_JOINED"],
  },
] as const;

export type AuditActionGroup = (typeof AUDIT_ACTION_GROUPS)[number]["group"];
export const AUDIT_ACTION_GROUP_FILTERS = ["ALL", ...AUDIT_ACTION_GROUPS.map((entry) => entry.group)] as const;
export type AuditActionGroupFilter = (typeof AUDIT_ACTION_GROUP_FILTERS)[number];

/** Flat vocabulary, derived so the grouping above stays the single source. */
export const AUDIT_ACTIONS: readonly string[] = AUDIT_ACTION_GROUPS.flatMap((entry) => [...entry.actions]);

const GROUP_BY_ACTION = new Map<string, AuditActionGroup>(
  AUDIT_ACTION_GROUPS.flatMap((entry) => entry.actions.map((action) => [action, entry.group] as const)),
);

export function auditActionGroup(action: string): AuditActionGroup | null {
  return GROUP_BY_ACTION.get(action) ?? null;
}

export function auditActionsInGroup(group: AuditActionGroup): readonly string[] {
  return AUDIT_ACTION_GROUPS.find((entry) => entry.group === group)?.actions ?? [];
}

/**
 * The actions a super-admin should notice without going looking (FR81, NFR38).
 * Everything here either changes who holds power, removes an identity, or ends
 * someone's participation — the decisions that are hardest to walk back.
 */
export const HIGH_RISK_AUDIT_ACTIONS: readonly string[] = [
  "OPERATOR_ROLE_GRANTED",
  "OPERATOR_ROLE_REVOKED",
  "ACCOUNT_ANONYMIZED",
  "ACCOUNT_DISABLED",
  "ROOM_CLOSE",
  "JOB_RETRY_REQUESTED",
];

export function isHighRiskAuditAction(action: string): boolean {
  return HIGH_RISK_AUDIT_ACTIONS.includes(action);
}

export interface AuditQuery {
  /** Username fragment of the acting operator, already reduced to safe characters. */
  actor: string;
  targetType: AuditTargetTypeFilter;
  /** Exact target identifier, or "" for any. */
  targetId: string;
  group: AuditActionGroupFilter;
  /** One exact action from the closed vocabulary, or "" for the whole group. */
  action: string;
  result: AuditResultFilter;
  /** Inclusive lower bound. */
  from: Date | null;
  /**
   * Exclusive upper bound. Exclusive so a whole day can be selected without the
   * bound having to name the last representable instant inside it — the database
   * stores microseconds, and no end-of-day literal a client can build is the last
   * one of them.
   */
  to: Date | null;
  /** NFR37: a single audit identifier, used to jump straight to one entry. */
  correlationId: string;
  limit: number;
}

export const DEFAULT_AUDIT_QUERY: AuditQuery = {
  actor: "", targetType: "ALL", targetId: "", group: "ALL", action: "",
  result: "ALL", from: null, to: null, correlationId: "", limit: DEFAULT_LIMIT,
};

/**
 * Validates the audit filters (AC3). Refuses rather than ignores: an operator who
 * filtered to one room must not be shown the platform-wide trail because their
 * identifier was malformed.
 */
export function parseAuditQuery(raw: Record<string, string | null | undefined>): AuditQuery {
  const group = readEnum(raw.group, AUDIT_ACTION_GROUP_FILTERS, "group");
  const action = readAction(raw.action, group);
  const from = readInstant(raw.from, "from");
  const to = readInstant(raw.to, "to");
  if (from && to && from.getTime() > to.getTime()) invalid("time range");
  return {
    actor: readActorFragment(raw.actor),
    targetType: readEnum(raw.targetType, AUDIT_TARGET_TYPE_FILTERS, "targetType"),
    targetId: readUuid(raw.targetId, "targetId"),
    group,
    action,
    result: readEnum(raw.result, AUDIT_RESULT_FILTERS, "result"),
    from,
    to,
    correlationId: readUuid(raw.correlationId, "correlationId"),
    limit: readBoundedInteger(raw.limit, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT),
  };
}

/**
 * The action names a query narrows to, already intersected with the group. An
 * empty array means "no action predicate" — never "match nothing".
 */
export function resolveAuditActions(query: Pick<AuditQuery, "group" | "action">): readonly string[] {
  if (query.action) return [query.action];
  return query.group === "ALL" ? [] : auditActionsInGroup(query.group);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(field: string): never {
  throw new AuthError("INVALID_REQUEST", 422, `Check the ${field} filter and try again.`);
}

function readEnum<T extends string>(raw: string | null | undefined, allowed: readonly T[], field: string): T {
  if (raw === null || raw === undefined || raw === "") return allowed[0]!;
  return allowed.includes(raw as T) ? (raw as T) : invalid(field);
}

/**
 * Only the characters a canonical username can contain survive, so the value can
 * never carry a LIKE wildcard or a control character into the query. A fragment
 * that is left empty by that reduction is refused rather than dropped: an
 * operator who filtered to one person must not be handed the platform-wide trail
 * because none of what they typed could match a username.
 */
function readActorFragment(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "") return "";
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, MAX_ACTOR_LENGTH);
  return cleaned === "" ? invalid("actor") : cleaned;
}

function readUuid(raw: string | null | undefined, field: string): string {
  const value = (raw ?? "").trim();
  if (value === "") return "";
  return UUID_PATTERN.test(value) ? value.toLowerCase() : invalid(field);
}

/** An exact action must exist and, when a group is also given, belong to it. */
function readAction(raw: string | null | undefined, group: AuditActionGroupFilter): string {
  const value = (raw ?? "").trim();
  if (value === "") return "";
  if (!AUDIT_ACTIONS.includes(value)) invalid("action");
  if (group !== "ALL" && auditActionGroup(value) !== group) invalid("action");
  return value;
}

/**
 * An explicit instant with an explicit zone. A bare day or a loosely parsable
 * string would be read in whatever zone the server happens to run in, so the same
 * request would mean different windows on different deployments — the console
 * therefore widens the day it was given before sending it.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function readInstant(raw: string | null | undefined, field: string): Date | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  if (!ISO_INSTANT.test(value)) return invalid(field);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? invalid(field) : parsed;
}

function readBoundedInteger(raw: string | null | undefined, field: string, min: number, max: number, fallback: number): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) return invalid(field);
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid(field);
}
