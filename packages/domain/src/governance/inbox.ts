import { AuthError } from "../identity/service.js";
import type { Capability } from "../identity/capabilities.js";
import { assertSafeUserSecurityPayload } from "../identity/user-security.js";

/**
 * Room and community governance inbox (FR81, FR83, FR90).
 *
 * One queue, two kinds of report. A room report is filed against a room; a
 * message report is filed against a single chat message. They share a severity
 * scale, a state machine and an audit shape so triage does not fork per surface,
 * while *what an operator may see and do* is decided per kind by capability:
 *
 *   ROOM    reads with ROOM_GOVERNANCE_READ,      acts with ROOM_GOVERNANCE_WRITE
 *   MESSAGE reads with COMMUNITY_GOVERNANCE_READ, acts with COMMUNITY_GOVERNANCE_WRITE
 *
 * With the Story 11.1 role matrix that resolves exactly as the product wants:
 * an OPERATIONS_ADMIN sees room reports only, a COMMUNITY_MODERATOR sees message
 * reports only, and neither can reach the other's surface by changing a filter.
 *
 * The structural invariant that makes cross-room access impossible: every
 * disposition names a *report*, never a room, message or member. The server
 * derives the target from the report row, so an operator can only act where a
 * report exists — there is no parameter to point somewhere else.
 *
 * Everything here is pure, so the scoping rules and the state machine are
 * testable without a database.
 */

export const REPORT_KINDS = ["ROOM", "MESSAGE"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Triage priority. Reporters never set this — an operator assigns it (FR90). */
export const REPORT_SEVERITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];
export const DEFAULT_REPORT_SEVERITY: ReportSeverity = "NORMAL";

export const REPORT_STATUSES = ["OPEN", "ASSIGNED", "RESOLVED", "DISMISSED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Closed states are final. Reopening would rewrite a settled decision; a new report is filed instead (NFR23). */
export const TERMINAL_REPORT_STATUSES = ["RESOLVED", "DISMISSED"] as const;
const TERMINAL = new Set<ReportStatus>(TERMINAL_REPORT_STATUSES);

export function isTerminalReportStatus(status: ReportStatus): boolean {
  return TERMINAL.has(status);
}

const ALLOWED_TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  OPEN: ["ASSIGNED", "RESOLVED", "DISMISSED"],
  ASSIGNED: ["OPEN", "ASSIGNED", "RESOLVED", "DISMISSED"],
  RESOLVED: [],
  DISMISSED: [],
};

/** `ASSIGNED → ASSIGNED` is allowed: reassignment and severity changes are ordinary triage. */
export function canTransitionReport(from: ReportStatus, to: ReportStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export const REPORT_DISPOSITIONS = [
  "RESTRICT_ROOM",
  "CLOSE_ROOM",
  "RESTORE_ROOM",
  "HIDE_MESSAGE",
  "RESTORE_MESSAGE",
  "MUTE_MEMBER",
  "DISMISS",
] as const;
export type ReportDisposition = (typeof REPORT_DISPOSITIONS)[number];

/**
 * Which dispositions belong to which kind. `DISMISS` is shared — closing a
 * report with no action needed is available on both surfaces.
 */
export const KIND_DISPOSITIONS: Record<ReportKind, readonly ReportDisposition[]> = {
  ROOM: ["RESTRICT_ROOM", "CLOSE_ROOM", "RESTORE_ROOM", "DISMISS"],
  MESSAGE: ["HIDE_MESSAGE", "RESTORE_MESSAGE", "MUTE_MEMBER", "DISMISS"],
};

/** Reading the queue at all. Both restricted duties hold this; it is the shared entry point. */
export const INBOX_CAPABILITY = "ROOM_REPORT_READ" as const satisfies Capability;

export const KIND_READ_CAPABILITY: Record<ReportKind, Capability> = {
  ROOM: "ROOM_GOVERNANCE_READ",
  MESSAGE: "COMMUNITY_GOVERNANCE_READ",
};

export const KIND_WRITE_CAPABILITY: Record<ReportKind, Capability> = {
  ROOM: "ROOM_GOVERNANCE_WRITE",
  MESSAGE: "COMMUNITY_GOVERNANCE_WRITE",
};

/** Room status a room disposition puts the room into. Same vocabulary as the room list's RESTRICT/CLOSE/RESTORE. */
export function roomStatusForDisposition(disposition: "RESTRICT_ROOM" | "CLOSE_ROOM" | "RESTORE_ROOM"): "RESTRICTED" | "CLOSED" | "ACTIVE" {
  return disposition === "RESTRICT_ROOM" ? "RESTRICTED" : disposition === "CLOSE_ROOM" ? "CLOSED" : "ACTIVE";
}

export function reportKindOfDisposition(disposition: ReportDisposition): ReportKind | null {
  if (disposition === "DISMISS") return null;
  return KIND_DISPOSITIONS.ROOM.includes(disposition) ? "ROOM" : "MESSAGE";
}

/** The capability a disposition costs. `DISMISS` costs the write capability of the report's own kind. */
export function dispositionCapability(kind: ReportKind, disposition: ReportDisposition): Capability {
  const owner = reportKindOfDisposition(disposition);
  if (owner && owner !== kind) throw new AuthError("INVALID_REQUEST", 422, "That action does not apply to this report.");
  return KIND_WRITE_CAPABILITY[kind];
}

function forbidden(): never {
  throw new AuthError("FORBIDDEN", 403, "You do not have permission for this operation.");
}

/** Report kinds an operator may read, in declaration order. */
export function visibleReportKinds(capabilities: Iterable<Capability>): ReportKind[] {
  const held = capabilities instanceof Set ? capabilities : new Set(capabilities);
  if (!held.has(INBOX_CAPABILITY)) return [];
  return REPORT_KINDS.filter((kind) => held.has(KIND_READ_CAPABILITY[kind]));
}

/** Dispositions an operator may apply to a report of this kind, given what they hold. */
export function availableDispositions(kind: ReportKind, capabilities: Iterable<Capability>): ReportDisposition[] {
  const held = capabilities instanceof Set ? capabilities : new Set(capabilities);
  return held.has(KIND_WRITE_CAPABILITY[kind]) ? [...KIND_DISPOSITIONS[kind]] : [];
}

export const REPORT_KIND_FILTERS = ["ALL", ...REPORT_KINDS] as const;
/** `PENDING` is the working set — everything not yet closed. */
export const REPORT_STATUS_FILTERS = ["PENDING", "ALL", ...REPORT_STATUSES] as const;
export const REPORT_SEVERITY_FILTERS = ["ALL", ...REPORT_SEVERITIES] as const;
export const REPORT_ASSIGNEE_FILTERS = ["ALL", "ME", "UNASSIGNED", "OTHERS"] as const;

export type ReportKindFilter = (typeof REPORT_KIND_FILTERS)[number];
export type ReportStatusFilter = (typeof REPORT_STATUS_FILTERS)[number];
export type ReportSeverityFilter = (typeof REPORT_SEVERITY_FILTERS)[number];
export type ReportAssigneeFilter = (typeof REPORT_ASSIGNEE_FILTERS)[number];

export interface GovernanceInboxQuery {
  kind: ReportKindFilter;
  status: ReportStatusFilter;
  severity: ReportSeverityFilter;
  assignee: ReportAssigneeFilter;
  limit: number;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

function readEnum<T extends string>(raw: string | null | undefined, allowed: readonly T[], field: string): T {
  if (raw === null || raw === undefined || raw === "") return allowed[0]!;
  if (allowed.includes(raw as T)) return raw as T;
  throw new AuthError("INVALID_REQUEST", 422, `Check the ${field} filter and try again.`);
}

/**
 * Validates inbox filters. As in the user security console, an unrecognised
 * value is refused rather than ignored — silently dropping a filter would widen
 * a read the operator believed they had narrowed.
 */
export function parseGovernanceInboxQuery(raw: Record<string, string | null | undefined>): GovernanceInboxQuery {
  const limitRaw = (raw.limit ?? "").trim();
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== "") {
    if (!/^\d+$/.test(limitRaw)) throw new AuthError("INVALID_REQUEST", 422, "Check the limit filter and try again.");
    limit = Number(limitRaw);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new AuthError("INVALID_REQUEST", 422, "Check the limit filter and try again.");
  }
  return {
    kind: readEnum(raw.kind, REPORT_KIND_FILTERS, "kind"),
    status: readEnum(raw.status, REPORT_STATUS_FILTERS, "status"),
    severity: readEnum(raw.severity, REPORT_SEVERITY_FILTERS, "severity"),
    assignee: readEnum(raw.assignee, REPORT_ASSIGNEE_FILTERS, "assignee"),
    limit,
  };
}

/**
 * Narrows a requested kind filter to what the operator may actually read.
 * Asking for a kind outside the operator's duty is a refusal, not an empty
 * list: a moderator who filters to room reports deserves to be told they have
 * no room governance duty rather than to conclude no rooms were ever reported.
 */
export function resolveInboxKinds(filter: ReportKindFilter, capabilities: Iterable<Capability>): ReportKind[] {
  const visible = visibleReportKinds(capabilities);
  if (visible.length === 0) forbidden();
  if (filter === "ALL") return visible;
  return visible.includes(filter) ? [filter] : forbidden();
}

/** Statuses a status filter expands to; `[]` means "no status constraint". */
export function resolveInboxStatuses(filter: ReportStatusFilter): ReportStatus[] {
  if (filter === "ALL") return [];
  if (filter === "PENDING") return ["OPEN", "ASSIGNED"];
  return [filter];
}

export const MIN_DISPOSITION_REASON = 5;
export const MAX_DISPOSITION_REASON = 500;

/**
 * A temporary mute is temporary by construction: the duration comes from a
 * closed list and the longest option is a week. Anything indefinite is an
 * account-level sanction, which lives behind USER_SECURITY_WRITE and is not
 * reachable from this surface.
 */
export const MUTE_DURATION_HOURS = [1, 24, 72, 168] as const;
export type MuteDurationHours = (typeof MUTE_DURATION_HOURS)[number];

export function isMuteDuration(value: unknown): value is MuteDurationHours {
  return typeof value === "number" && (MUTE_DURATION_HOURS as readonly number[]).includes(value);
}

export function muteExpiresAt(now: Date, hours: MuteDurationHours): Date {
  return new Date(now.getTime() + hours * 3_600_000);
}

export function isMuteActive(mutedUntil: Date | null, now: Date): boolean {
  return mutedUntil !== null && mutedUntil.getTime() > now.getTime();
}

export const GOVERNANCE_NOTICE_KINDS = [
  "REPORT_DISMISSED",
  "ROOM_RESTRICTED",
  "ROOM_CLOSED",
  "ROOM_RESTORED",
  "MESSAGE_HIDDEN",
  "MESSAGE_RESTORED",
  "MEMBER_MUTED",
  /** An operator ended a mute early. Not a disposition — the report is already closed. */
  "MEMBER_UNMUTED",
] as const;
export type GovernanceNoticeKind = (typeof GOVERNANCE_NOTICE_KINDS)[number];

export const DISPOSITION_NOTICE_KIND: Record<ReportDisposition, GovernanceNoticeKind> = {
  RESTRICT_ROOM: "ROOM_RESTRICTED",
  CLOSE_ROOM: "ROOM_CLOSED",
  RESTORE_ROOM: "ROOM_RESTORED",
  HIDE_MESSAGE: "MESSAGE_HIDDEN",
  RESTORE_MESSAGE: "MESSAGE_RESTORED",
  MUTE_MEMBER: "MEMBER_MUTED",
  DISMISS: "REPORT_DISMISSED",
};

/**
 * Who is owed an explanation (AC4). Roles, not identifiers — the repository maps
 * them onto the actual accounts it read from the report row.
 *
 * `SUBJECT` is the member whose content or participation is affected;
 * `ROOM_OWNER` is the accountable holder of a moderated room; `REPORTER` always
 * learns the outcome of what they filed.
 */
export const NOTICE_AUDIENCE_ROLES = ["SUBJECT", "ROOM_OWNER", "REPORTER"] as const;
export type NoticeAudienceRole = (typeof NOTICE_AUDIENCE_ROLES)[number];

export function noticeAudience(disposition: ReportDisposition): readonly NoticeAudienceRole[] {
  switch (disposition) {
    case "RESTRICT_ROOM":
    case "CLOSE_ROOM":
    case "RESTORE_ROOM":
      return ["ROOM_OWNER", "REPORTER"];
    case "HIDE_MESSAGE":
    case "RESTORE_MESSAGE":
    case "MUTE_MEMBER":
      return ["SUBJECT", "REPORTER"];
    case "DISMISS":
      return ["REPORTER"];
  }
}

export interface ReportSummary {
  reportId: string;
  kind: ReportKind;
  severity: ReportSeverity;
  status: ReportStatus;
  reason: string;
  reporter: string;
  assignee: string | null;
  assignedToMe: boolean;
  subject: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomReportContext {
  roomId: string;
  roomName: string;
  roomStatus: string;
  memberCount: number;
  openReportCount: number;
}

/**
 * The reported message and nothing around it. There is deliberately no
 * surrounding thread, no sibling messages and no room identifier: a moderator
 * handles what was reported, not the conversation it sat in (FR83).
 */
export interface MessageReportContext {
  messageId: string;
  roomName: string;
  author: string;
  body: string;
  sentAt: Date;
  hidden: boolean;
  mutedUntil: Date | null;
}

export interface ReportHistoryEntry {
  id: string;
  action: string;
  actor: string | null;
  result: string;
  metadata: unknown;
  occurredAt: Date;
}

export interface ReportDetail extends ReportSummary {
  room: RoomReportContext | null;
  message: MessageReportContext | null;
  history: ReportHistoryEntry[];
  availableDispositions: ReportDisposition[];
}

const MESSAGE_CONTEXT_KEYS = new Set(["messageId", "roomName", "author", "body", "sentAt", "hidden", "mutedUntil"]);
/** Shapes that would turn a single reported item into a browsable feed. */
const BULK_CONTEXT_KEYS = /^(messages|thread|conversation|siblings|transcript|history|picks|selections)$/i;

/**
 * Minimal-disclosure guard for a report detail payload, in the same spirit as
 * assertSafeUserSecurityPayload: a future widening of the projection fails a
 * test here instead of leaking in production.
 *
 * It enforces three things — the kind carries only its own context, message
 * context stays a single message with a fixed field set, and no banned field
 * (credential, ledger figure, unsealed pick, precise location) appears at any
 * depth.
 */
export function assertMinimalReportContext(detail: { kind: ReportKind; room?: unknown; message?: unknown; history?: unknown }): void {
  if (detail.kind === "ROOM") {
    if (detail.message != null) throw new Error("A room report must not carry message content");
  } else {
    if (detail.room != null) throw new Error("A message report must not carry room governance context");
    if (!detail.message || typeof detail.message !== "object" || Array.isArray(detail.message)) {
      throw new Error("A message report must carry exactly one reported message");
    }
    for (const key of Object.keys(detail.message as Record<string, unknown>)) {
      if (!MESSAGE_CONTEXT_KEYS.has(key)) throw new Error(`Message report context must not expose "${key}"`);
    }
  }
  // History is left out of both walks on purpose: audit metadata has already
  // been through redactAuditMetadata, and refusing a historical row over a field
  // name would turn an old audit entry into a broken page.
  const { history: _history, ...projection } = detail;
  assertNoBulkContext(projection, "$");
  assertSafeUserSecurityPayload(projection);
}

function assertNoBulkContext(payload: unknown, path: string): void {
  if (Array.isArray(payload)) {
    payload.forEach((entry, index) => assertNoBulkContext(entry, `${path}[${index}]`));
    return;
  }
  if (!payload || typeof payload !== "object" || payload instanceof Date) return;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (BULK_CONTEXT_KEYS.test(key)) throw new Error(`Report context must not expose "${key}" (at ${path}.${key})`);
    assertNoBulkContext(value, `${path}.${key}`);
  }
}
