import { RoomError, type RoomStatus } from "./service.js";

/**
 * Room grants (Story 8.1, FR43/FR44/FR45): a member asks, the owner decides
 * the amount. Every OWNER_GRANT ledger entry traces back to exactly one
 * member request — there is no request-less grant path, the same structural
 * guard as the governance inbox's "every disposition eats a reportId".
 */
export type GrantRequestStatus = "OPEN" | "APPROVED" | "DENIED";
export type GrantDecisionAction = "APPROVE" | "DENY";

export const GRANT_MIN_POINTS = 1;
/** Aligned with the per-ticket stake ceiling so one grant cannot flatten the room's ranking context. */
export const GRANT_MAX_POINTS = 20_000;
export const GRANT_NOTE_MAX_CODEPOINTS = 200;

export interface GrantRequestRecord {
  id: string;
  roomId: string;
  requester: { userId: string; displayName: string };
  note: string | null;
  status: GrantRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
  /** String decimal ("2500.00") — points never ride JSON floats. */
  approvedAmount: string | null;
  decisionNote: string | null;
}

/**
 * The decision rule, kept here so it is testable without a database. The
 * repository reads the locked request row inside the deciding transaction and
 * must act on exactly what this returns — throw the refusal, replay the
 * stored outcome, or proceed (same contract as roomCreationRefusal).
 */
export type GrantDecisionRuling =
  | { kind: "PROCEED" }
  | { kind: "REPLAY" }
  | { kind: "REFUSE"; error: RoomError };

export function ruleOnGrantDecision(input: {
  current: { status: GrantRequestStatus; approvedAmount: string | null };
  action: GrantDecisionAction;
  amount: string | null;
}): GrantDecisionRuling {
  if (input.current.status === "OPEN") return { kind: "PROCEED" };
  const sameOutcome = input.current.status === (input.action === "APPROVE" ? "APPROVED" : "DENIED")
    && input.current.approvedAmount === input.amount;
  if (sameOutcome) return { kind: "REPLAY" };
  return { kind: "REFUSE", error: new RoomError("GRANT_ALREADY_DECIDED", 409, "This request was already decided. Reload to see the outcome.") };
}

/** New requests and decisions are ACTIVE-room actions; history stays readable in any status. */
export function grantRoomStatusRefusal(status: RoomStatus): RoomError | null {
  if (status === "ACTIVE") return null;
  return new RoomError("ROOM_NOT_ACTIVE", 409, "Grants are only available while the room is active.");
}

/** Whole points, 1..20,000 → canonical "N.00" ledger form. */
export function normalizeGrantAmount(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < GRANT_MIN_POINTS || amount > GRANT_MAX_POINTS) {
    throw new RoomError("GRANT_AMOUNT_INVALID", 422, `Use a whole amount between ${GRANT_MIN_POINTS} and ${GRANT_MAX_POINTS.toLocaleString("en-US")} points.`);
  }
  return amount.toFixed(2);
}

/** Optional note, trimmed, counted by code points (emoji lesson: UTF-16 length overshoots char_length). */
export function normalizeGrantNote(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const note = value.trim();
  if (note.length === 0) return null;
  if ([...note].length > GRANT_NOTE_MAX_CODEPOINTS) {
    throw new RoomError("GRANT_NOTE_TOO_LONG", 422, `Keep the note within ${GRANT_NOTE_MAX_CODEPOINTS} characters.`);
  }
  return note;
}

export interface RoomGrantRepository {
  /**
   * Insert an OPEN request after verifying (inside the transaction) that the
   * room is ACTIVE and the requester is a member. Returns null when the room
   * or membership does not exist (the caller answers 404, same shape as every
   * other member read). A concurrent or repeated request must converge on the
   * existing OPEN row via the partial unique index and report created=false.
   * Throws RoomError("ROOM_NOT_ACTIVE") when the room is restricted/closed.
   */
  requestGrant(input: { id: string; roomId: string; requesterUserId: string; note: string | null; now: Date }): Promise<{ request: GrantRequestRecord; created: boolean } | null>;
  /**
   * Decide a request as the room owner: lock the request row, apply
   * ruleOnGrantDecision, and on APPROVE write — in the same transaction — the
   * OWNER_GRANT ledger entry (idempotencyKey `owner-grant:<requestId>`), the
   * available_points increase, the request closure and the audit event.
   * Returns null when the room is not owned by ownerId or the request does
   * not belong to it (404 same shape — existence is also disclosure).
   */
  decideGrant(input: { roomId: string; grantId: string; ownerId: string; action: GrantDecisionAction; amount: string | null; note: string | null; ledgerId: string; auditId: string; now: Date }): Promise<{ request: GrantRequestRecord; replayed: boolean } | null>;
  /**
   * Member-visible list: every APPROVED request plus the viewer's own rows in
   * any status; the owner additionally sees OPEN and DENIED rows. Redaction
   * happens in SQL — the projection never carries another member's pending or
   * denied requests to a non-owner.
   */
  listGrants(roomId: string, viewerUserId: string): Promise<{ isOwner: boolean; requests: GrantRequestRecord[] } | null>;
}

export class RoomGrantService {
  constructor(
    private readonly repository: RoomGrantRepository,
    private readonly tokens: { id(): string },
    private readonly now: () => Date,
  ) {}

  async request(input: { roomId: string; userId: string; note?: string | null }) {
    const note = normalizeGrantNote(input.note);
    const result = await this.repository.requestGrant({
      id: this.tokens.id(), roomId: input.roomId, requesterUserId: input.userId, note, now: this.now(),
    });
    if (!result) throw new RoomError("ROOM_NOT_FOUND", 404);
    if (!result.created) throw new RoomError("GRANT_REQUEST_EXISTS", 409, "Your previous request is still waiting for the owner.");
    return result.request;
  }

  async decide(input: { roomId: string; grantId: string; ownerId: string; action: GrantDecisionAction; amount?: number; note?: string | null }) {
    const amount = input.action === "APPROVE"
      ? normalizeGrantAmount(input.amount ?? Number.NaN)
      : null;
    const result = await this.repository.decideGrant({
      roomId: input.roomId, grantId: input.grantId, ownerId: input.ownerId, action: input.action,
      amount, note: normalizeGrantNote(input.note), ledgerId: this.tokens.id(), auditId: this.tokens.id(), now: this.now(),
    });
    if (!result) throw new RoomError("GRANT_NOT_FOUND", 404);
    return result.request;
  }

  async list(roomId: string, userId: string) {
    const result = await this.repository.listGrants(roomId, userId);
    if (!result) throw new RoomError("ROOM_NOT_FOUND", 404);
    return result;
  }
}
