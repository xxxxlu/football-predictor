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

export interface RoomRepository {
  createRoom(input: { id: string; name: string; ownerId: string; visibility: RoomVisibility; tier: RoomTier; sport: RoomSport; rulesVersion: string; inviteTokenHash: string | null; initialPoints: string; now: Date; auditId: string }): Promise<void>;
  rotateInvite(input: { roomId: string; ownerId: string; inviteTokenHash: string; now: Date; auditId: string }): Promise<boolean>;
  previewInvite(inviteTokenHash: string): Promise<{ id: string; name: string; status: RoomStatus } | null>;
  joinByInvite(input: { inviteTokenHash: string; userId: string; rulesVersion: string; initialPoints: string; now: Date; auditId: string }): Promise<{ roomId: string; joined: boolean } | null>;
  listPublicRooms(userId: string): Promise<PublicRoomSummaryRecord[]>;
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

  async listPublic(userId: string) {
    return this.repository.listPublicRooms(userId);
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
