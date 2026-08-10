import { decodeKeysetCursor, type KeysetCursor } from "./keyset-cursor.js";

export type RoomStatus = "ACTIVE" | "RESTRICTED" | "CLOSED";
export type RoomRole = "OWNER" | "MEMBER";
export type RoomVisibility = "PUBLIC" | "PRIVATE";
export type RoomTier = "STANDARD" | "ADVANCED";
/** Which sport this room's contest is about; every room predicts exactly one sport. */
export type RoomSport = "FOOTBALL" | "FORMULA_1";

export interface RoomSummaryRecord {
  id: string;
  name: string;
  status: RoomStatus;
  visibility: RoomVisibility;
  tier: RoomTier;
  sport: RoomSport;
  preMatchStakeVisible: boolean;
  postMatchTicketVisible: boolean;
  role: RoomRole;
  memberCount: number;
}

export interface PublicRoomSummaryRecord {
  id: string;
  name: string;
  ownerName: string;
  sport: RoomSport;
  memberCount: number;
  joined: boolean;
}

/** One lobby page plus the cursor for the next, or null at the end. */
export interface PublicRoomPage {
  rooms: PublicRoomSummaryRecord[];
  cursor: string | null;
}

/**
 * The lobby is a browsable list, not a dump: an unpaged read grew with every
 * public room ever opened and would eventually breach the CloudBase gateway's
 * ~2 MB response cap, taking the whole lobby down rather than degrading.
 */
export const PUBLIC_ROOM_PAGE_SIZE = 30;

/**
 * Room-creation quota. Each room mints its owner a fresh 10,000-point account,
 * a ledger grant and — when PUBLIC — a lobby entry, so unlimited creation is
 * both an abuse channel and the product's accidental answer to a busted
 * balance. These bound it without getting in a real user's way; the shape of a
 * deliberate top-up is Epic 8's call, not this guard's.
 *
 * The active cap counts rooms that are not CLOSED, so routine cleanup gives the
 * allowance back. The rate window counts every creation regardless of what
 * happened to the room afterwards — closing a room must not buy another turn.
 */
export const ACTIVE_ROOMS_PER_OWNER = 20;
export const ROOMS_PER_HOUR = 5;
export const ROOMS_PER_DAY = 20;

export interface RoomRepository {
  createRoom(input: { id: string; name: string; ownerId: string; visibility: RoomVisibility; tier: RoomTier; sport: RoomSport; rulesVersion: string; inviteTokenHash: string | null; initialPoints: string; now: Date; auditId: string }): Promise<void>;
  rotateInvite(input: { roomId: string; ownerId: string; inviteTokenHash: string; now: Date; auditId: string }): Promise<boolean>;
  previewInvite(inviteTokenHash: string): Promise<{ id: string; name: string; status: RoomStatus } | null>;
  joinByInvite(input: { inviteTokenHash: string; userId: string; rulesVersion: string; initialPoints: string; now: Date; auditId: string }): Promise<{ roomId: string; joined: boolean } | null>;
  listPublicRooms(userId: string, options: { cursor?: KeysetCursor }): Promise<PublicRoomPage>;
  joinPublicRoom(input: { roomId: string; userId: string; rulesVersion: string; initialPoints: string; now: Date; auditId: string }): Promise<{ roomId: string; joined: boolean } | null>;
  listRooms(userId: string): Promise<RoomSummaryRecord[]>;
  getRoomForMember(roomId: string, userId: string): Promise<RoomSummaryRecord | null>;
  getBalance(roomId: string, userId: string): Promise<{ availablePoints: string; frozenPoints: string; correctionDebt: string } | null>;
  listMembers(roomId: string, userId: string): Promise<Array<{ userId: string; username: string; role: RoomRole }> | null>;
  updatePostMatchTicketVisibility(input: { roomId: string; ownerId: string; visible: boolean; now: Date; auditId: string }): Promise<boolean>;
}

export interface RoomTokenFactory {
  inviteToken(): string;
  hash(value: string): string;
  id(): string;
}

export class RoomError extends Error {
  constructor(readonly code: string, readonly status: number, readonly action?: string) {
    super(code);
    this.name = "RoomError";
  }
}

/**
 * The room-creation guard's decision, kept here so the rule itself is testable
 * without a database. The repository supplies the counts and the atomicity —
 * it must read them inside the creating transaction, because two concurrent
 * requests can otherwise each see a count below the cap and each commit.
 *
 * Returns the refusal rather than throwing so a caller cannot lose it to an
 * empty catch: the repository's only correct move is to throw what it gets.
 */
export function roomCreationRefusal(counts: { active: number; lastHour: number; lastDay: number }): RoomError | null {
  if (counts.active >= ACTIVE_ROOMS_PER_OWNER) {
    return new RoomError("ROOM_LIMIT_REACHED", 409, `Close one of your ${ACTIVE_ROOMS_PER_OWNER} open rooms before creating another.`);
  }
  if (counts.lastHour >= ROOMS_PER_HOUR || counts.lastDay >= ROOMS_PER_DAY) {
    return new RoomError("ROOM_RATE_LIMITED", 429, "You have created several rooms just now. Try again later.");
  }
  return null;
}

export class RoomService {
  constructor(
    private readonly repository: RoomRepository,
    private readonly tokens: RoomTokenFactory,
    private readonly now: () => Date,
    private readonly options: { rulesVersion: string; initialPoints: string },
  ) {}

  async create(input: { userId: string; name: string; visibility: RoomVisibility; tier: RoomTier; sport: RoomSport; rulesAccepted: boolean }) {
    this.assertRules(input.rulesAccepted);
    const name = normalizeRoomName(input.name);
    const id = this.tokens.id();
    const auditId = this.tokens.id();
    const inviteToken = input.visibility === "PRIVATE" ? this.tokens.inviteToken() : undefined;
    await this.repository.createRoom({
      id,
      name,
      ownerId: input.userId,
      visibility: input.visibility,
      tier: input.tier,
      sport: input.sport,
      rulesVersion: this.options.rulesVersion,
      inviteTokenHash: inviteToken ? this.tokens.hash(inviteToken) : null,
      initialPoints: this.options.initialPoints,
      now: this.now(),
      auditId,
    });
    return {
      id, name, visibility: input.visibility, tier: input.tier, sport: input.sport, role: "room_owner" as const, memberCount: 1, auditId,
      ...(inviteToken ? { inviteToken } : {}),
    };
  }

  async resetInvite(roomId: string, ownerId: string) {
    const inviteToken = this.tokens.inviteToken();
    const auditId = this.tokens.id();
    const rotated = await this.repository.rotateInvite({ roomId, ownerId, inviteTokenHash: this.tokens.hash(inviteToken), now: this.now(), auditId });
    if (!rotated) throw new RoomError("ROOM_NOT_FOUND", 404, "Open one of your active rooms and try again.");
    return { roomId, inviteToken, auditId };
  }

  async previewInvite(inviteToken: string) {
    const room = inviteToken ? await this.repository.previewInvite(this.tokens.hash(inviteToken)) : null;
    if (!room) throw new RoomError("INVITE_INVALID", 404, "Ask the room owner for a new invite.");
    return { id: room.id, name: room.name };
  }

  async join(input: { userId: string; inviteToken: string; rulesAccepted: boolean }) {
    this.assertRules(input.rulesAccepted);
    const joined = input.inviteToken ? await this.repository.joinByInvite({
      inviteTokenHash: this.tokens.hash(input.inviteToken),
      userId: input.userId,
      rulesVersion: this.options.rulesVersion,
      initialPoints: this.options.initialPoints,
      now: this.now(),
      auditId: this.tokens.id(),
    }) : null;
    if (!joined) throw new RoomError("INVITE_INVALID", 404, "Ask the room owner for a new invite.");
    return joined;
  }

  /** A malformed cursor is refused, never silently treated as "start over":
   *  handing back page one under a next-page request loops the caller forever. */
  async listPublic(userId: string, options: { cursor?: string } = {}) {
    if (options.cursor === undefined) return this.repository.listPublicRooms(userId, {});
    const cursor = decodeKeysetCursor(options.cursor);
    if (!cursor) throw new RoomError("INVALID_CURSOR", 422, "Reload the lobby and try again.");
    return this.repository.listPublicRooms(userId, { cursor });
  }

  async joinPublic(input: { roomId: string; userId: string; rulesAccepted: boolean }) {
    this.assertRules(input.rulesAccepted);
    const joined = await this.repository.joinPublicRoom({
      roomId: input.roomId,
      userId: input.userId,
      rulesVersion: this.options.rulesVersion,
      initialPoints: this.options.initialPoints,
      now: this.now(),
      auditId: this.tokens.id(),
    });
    if (!joined) throw new RoomError("ROOM_NOT_JOINABLE", 404, "This public room is not available to join.");
    return joined;
  }

  async listRooms(userId: string) {
    return (await this.repository.listRooms(userId)).map(toView);
  }

  async getRoom(roomId: string, userId: string) {
    const room = await this.repository.getRoomForMember(roomId, userId);
    if (!room) throw new RoomError("ROOM_NOT_FOUND", 404);
    return toView(room);
  }

  async getBalance(roomId: string, userId: string) {
    const balance = await this.repository.getBalance(roomId, userId);
    if (!balance) throw new RoomError("ROOM_NOT_FOUND", 404);
    return balance;
  }

  async getMembers(roomId: string, userId: string) {
    const members = await this.repository.listMembers(roomId, userId);
    if (!members) throw new RoomError("ROOM_NOT_FOUND", 404);
    return members.map((member) => ({ ...member, role: member.role === "OWNER" ? "room_owner" as const : "member" as const }));
  }

  async updatePostMatchTicketVisibility(roomId: string, ownerId: string, visible: boolean) {
    const updated = await this.repository.updatePostMatchTicketVisibility({ roomId, ownerId, visible, now: this.now(), auditId: this.tokens.id() });
    if (!updated) throw new RoomError("ROOM_OWNER_REQUIRED", 403, "Only the room owner can change post-kickoff record visibility.");
    return { roomId, postMatchTicketVisible: visible };
  }

  private assertRules(accepted: boolean) {
    if (!accepted) throw new RoomError("ROOM_RULES_REQUIRED", 422, "Confirm the current room rules.");
  }
}

function normalizeRoomName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw new RoomError("INVALID_ROOM_NAME", 422, "Use a room name between 2 and 80 characters.");
  return name;
}

function toView(room: RoomSummaryRecord) {
  return { id: room.id, name: room.name, status: room.status, visibility: room.visibility, tier: room.tier, sport: room.sport, preMatchStakeVisible: room.preMatchStakeVisible, postMatchTicketVisible: room.postMatchTicketVisible, memberCount: room.memberCount, role: room.role === "OWNER" ? "room_owner" as const : "member" as const };
}
