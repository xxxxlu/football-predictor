import { describe, expect, it } from "vitest";
import { encodeKeysetCursor, type KeysetCursor } from "./keyset-cursor.js";
import { ACTIVE_ROOMS_PER_OWNER, PUBLIC_ROOM_PAGE_SIZE, RoomError, roomCreationRefusal, RoomService, ROOMS_PER_DAY, ROOMS_PER_HOUR, type PublicRoomPage, type RoomRepository, type RoomSummaryRecord } from "./service.js";

class MemoryRoomRepository implements RoomRepository {
  rooms = new Map<string, RoomSummaryRecord & { inviteHash: string | null; ownerId: string; createdAt: Date }>();
  members = new Map<string, { userId: string; role: "OWNER" | "MEMBER"; rulesVersion: string }>();
  balances = new Map<string, { availablePoints: string; frozenPoints: string; correctionDebt: string }>();
  ledger: Array<{ roomId: string; userId: string; kind: string; amount: string }> = [];

  async createRoom(input: Parameters<RoomRepository["createRoom"]>[0]) {
    this.rooms.set(input.id, { id: input.id, name: input.name, status: "ACTIVE", visibility: input.visibility, tier: input.tier, sport: input.sport, preMatchStakeVisible: false, postMatchTicketVisible: true, memberCount: 1, role: "OWNER", inviteHash: input.inviteTokenHash, ownerId: input.ownerId, createdAt: input.now });
    this.members.set(`${input.id}:${input.ownerId}`, { userId: input.ownerId, role: "OWNER", rulesVersion: input.rulesVersion });
    this.balances.set(`${input.id}:${input.ownerId}`, { availablePoints: input.initialPoints, frozenPoints: "0.00", correctionDebt: "0.00" });
    this.ledger.push({ roomId: input.id, userId: input.ownerId, kind: "INITIAL_GRANT", amount: input.initialPoints });
  }
  async rotateInvite(input: Parameters<RoomRepository["rotateInvite"]>[0]) {
    const room = this.rooms.get(input.roomId);
    const membership = this.members.get(`${input.roomId}:${input.ownerId}`);
    if (!room || membership?.role !== "OWNER" || room.status !== "ACTIVE") return false;
    room.inviteHash = input.inviteTokenHash;
    return true;
  }
  async previewInvite(inviteTokenHash: string) {
    const room = [...this.rooms.values()].find((candidate) => candidate.inviteHash === inviteTokenHash && candidate.status === "ACTIVE");
    return room ? { id: room.id, name: room.name, status: room.status } : null;
  }
  async joinByInvite(input: Parameters<RoomRepository["joinByInvite"]>[0]) {
    const room = [...this.rooms.values()].find((candidate) => candidate.visibility === "PRIVATE" && candidate.inviteHash === input.inviteTokenHash && candidate.status === "ACTIVE");
    if (!room) return null;
    const key = `${room.id}:${input.userId}`;
    const joined = !this.members.has(key);
    if (joined) {
      this.members.set(key, { userId: input.userId, role: "MEMBER", rulesVersion: input.rulesVersion });
      this.balances.set(key, { availablePoints: input.initialPoints, frozenPoints: "0.00", correctionDebt: "0.00" });
      this.ledger.push({ roomId: room.id, userId: input.userId, kind: "INITIAL_GRANT", amount: input.initialPoints });
      room.memberCount += 1;
    }
    return { roomId: room.id, joined };
  }
  /** Pages exactly as the real repository does — same order, same page size,
   *  same strict (createdAt, id) comparison. A fake that returned everything
   *  would let an unpaged regression walk straight through these tests. */
  async listPublicRooms(userId: string, options: { cursor?: KeysetCursor } = {}): Promise<PublicRoomPage> {
    const ordered = [...this.rooms.values()]
      .filter((room) => room.visibility === "PUBLIC" && room.status === "ACTIVE")
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
    const after = options.cursor;
    const remaining = after
      ? ordered.filter((room) => `${room.createdAt.toISOString()}|${room.id}` > `${after.createdAt}|${after.id}`)
      : ordered;
    const page = remaining.slice(0, PUBLIC_ROOM_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      rooms: page.map((room) => ({
        id: room.id, name: room.name, ownerName: room.ownerId, sport: room.sport, memberCount: room.memberCount, joined: this.members.has(`${room.id}:${userId}`),
      })),
      cursor: remaining.length > PUBLIC_ROOM_PAGE_SIZE && last ? encodeKeysetCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }
  async joinPublicRoom(input: Parameters<RoomRepository["joinPublicRoom"]>[0]) {
    const room = this.rooms.get(input.roomId);
    if (!room || room.visibility !== "PUBLIC" || room.status !== "ACTIVE") return null;
    return this.joinRoom(room, input);
  }
  private async joinRoom(room: RoomSummaryRecord & { inviteHash: string | null; ownerId: string }, input: { userId: string; rulesVersion: string; initialPoints: string }) {
    const key = `${room.id}:${input.userId}`;
    const joined = !this.members.has(key);
    if (joined) {
      this.members.set(key, { userId: input.userId, role: "MEMBER", rulesVersion: input.rulesVersion });
      this.balances.set(key, { availablePoints: input.initialPoints, frozenPoints: "0.00", correctionDebt: "0.00" });
      this.ledger.push({ roomId: room.id, userId: input.userId, kind: "INITIAL_GRANT", amount: input.initialPoints });
      room.memberCount += 1;
    }
    return { roomId: room.id, joined };
  }
  async listRooms(userId: string) {
    return [...this.rooms.values()].flatMap((room) => {
      const member = this.members.get(`${room.id}:${userId}`);
      return member ? [{ ...room, role: member.role }] : [];
    });
  }
  async getRoomForMember(roomId: string, userId: string) {
    const room = this.rooms.get(roomId); const member = this.members.get(`${roomId}:${userId}`);
    return room && member ? { ...room, role: member.role } : null;
  }
  async getBalance(roomId: string, userId: string) { return this.members.has(`${roomId}:${userId}`) ? this.balances.get(`${roomId}:${userId}`) ?? null : null; }
  async listMembers(roomId: string, userId: string) {
    if (!this.members.has(`${roomId}:${userId}`)) return null;
    return [...this.members.entries()].filter(([key]) => key.startsWith(`${roomId}:`)).map(([, member]) => ({ userId: member.userId, username: member.userId, role: member.role }));
  }
  async updatePostMatchTicketVisibility(input: Parameters<RoomRepository["updatePostMatchTicketVisibility"]>[0]) {
    const room = this.rooms.get(input.roomId);
    const membership = this.members.get(`${input.roomId}:${input.ownerId}`);
    if (!room || membership?.role !== "OWNER") return false;
    room.postMatchTicketVisible = input.visible;
    return true;
  }
}

let sequence = 0;
/** Room ids are UUIDs in production (`randomUUID`), and the lobby cursor
 *  decoder refuses a non-UUID id — a fake that minted `id-1` would make a
 *  perfectly good cursor look malformed. Zero-padded so the sequence also
 *  sorts the way the real (created_at, id) keyset does. */
const testUuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const tokens = { inviteToken: () => `invite-${++sequence}`, hash: (value: string) => `hash-${value}`, id: () => testUuid(++sequence) };
const now = new Date("2026-07-13T12:00:00Z");
function setup() { const repository = new MemoryRoomRepository(); return { repository, service: new RoomService(repository, tokens, () => now, { rulesVersion: "rooms-2026-07", initialPoints: "10000.00" }) }; }

describe("RoomService", () => {
  it("atomically creates a private room, owner membership and isolated initial balance", async () => {
    const { repository, service } = setup();
    const created = await service.create({ userId: "alice", name: "决赛之夜", visibility: "PRIVATE", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: true });
    expect(created).toMatchObject({ name: "决赛之夜", role: "room_owner", inviteToken: expect.stringMatching(/^invite-/) });
    await expect(service.getBalance(created.id, "alice")).resolves.toEqual({ availablePoints: "10000.00", frozenPoints: "0.00", correctionDebt: "0.00" });
    expect(repository.ledger).toEqual([{ roomId: created.id, userId: "alice", kind: "INITIAL_GRANT", amount: "10000.00" }]);
  });

  it("defaults new rooms to the standard tier and can create advanced-tier rooms", async () => {
    const { service } = setup();
    const standard = await service.create({ userId: "alice", name: "标准房", visibility: "PRIVATE", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: true });
    expect(standard).toMatchObject({ tier: "STANDARD" });
    const advanced = await service.create({ userId: "alice", name: "高级房", visibility: "PRIVATE", tier: "ADVANCED", sport: "FOOTBALL", rulesAccepted: true });
    expect(advanced).toMatchObject({ tier: "ADVANCED" });
    await expect(service.getRoom(advanced.id, "alice")).resolves.toMatchObject({ tier: "ADVANCED" });
  });

  it("defaults new rooms to football and carries an explicit F1 sport through create, get and list views", async () => {
    const { service } = setup();
    const football = await service.create({ userId: "alice", name: "足球房", visibility: "PRIVATE", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: true });
    expect(football).toMatchObject({ sport: "FOOTBALL" });
    const f1 = await service.create({ userId: "alice", name: "车迷房", visibility: "PRIVATE", tier: "STANDARD", sport: "FORMULA_1", rulesAccepted: true });
    expect(f1).toMatchObject({ sport: "FORMULA_1" });
    await expect(service.getRoom(f1.id, "alice")).resolves.toMatchObject({ sport: "FORMULA_1" });
    const listed = await service.listRooms("alice");
    expect(listed.find((room) => room.id === f1.id)).toMatchObject({ sport: "FORMULA_1" });
    expect(listed.find((room) => room.id === football.id)).toMatchObject({ sport: "FOOTBALL" });
  });

  it("creates a public room without exposing an invitation token", async () => {
    const { repository, service } = setup();
    const created = await service.create({ userId: "alice", name: "公开看球局", visibility: "PUBLIC", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: true });
    expect(created).toMatchObject({ name: "公开看球局", visibility: "PUBLIC" });
    expect(created).not.toHaveProperty("inviteToken");
    expect(repository.rooms.get(created.id)).toMatchObject({ visibility: "PUBLIC", inviteHash: null });
  });

  it("lists and idempotently joins active public rooms after rules confirmation", async () => {
    const { repository, service } = setup();
    const room = await service.create({ userId: "alice", name: "公开看球局", visibility: "PUBLIC", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: true });
    await expect(service.listPublic("bob")).resolves.toEqual({ rooms: [{ id: room.id, name: "公开看球局", ownerName: "alice", sport: "FOOTBALL", memberCount: 1, joined: false }], cursor: null });
    await expect(service.joinPublic({ roomId: room.id, userId: "bob", rulesAccepted: true })).resolves.toEqual({ roomId: room.id, joined: true });
    await expect(service.joinPublic({ roomId: room.id, userId: "bob", rulesAccepted: true })).resolves.toEqual({ roomId: room.id, joined: false });
    expect(repository.ledger.filter((entry) => entry.userId === "bob")).toHaveLength(1);
  });

  it("requires current room rules before creating or joining", async () => {
    const { service } = setup();
    await expect(service.create({ userId: "alice", name: "决赛之夜", visibility: "PRIVATE", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: false })).rejects.toMatchObject({ code: "ROOM_RULES_REQUIRED" });
  });

  it("reset invalidates the old invite without changing members or balances", async () => {
    const { service } = setup();
    const created = await service.create({ userId: "alice", name: "决赛之夜", visibility: "PRIVATE", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: true });
    const rotated = await service.resetInvite(created.id, "alice");
    await expect(service.previewInvite(created.inviteToken!)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    await expect(service.previewInvite(rotated.inviteToken)).resolves.toMatchObject({ id: created.id });
    await expect(service.getBalance(created.id, "alice")).resolves.toMatchObject({ availablePoints: "10000.00" });
  });

  it("concurrent repeated joins create one membership, one account and one grant", async () => {
    const { repository, service } = setup();
    const room = await service.create({ userId: "alice", name: "决赛之夜", visibility: "PRIVATE", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: true });
    const results = await Promise.all(Array.from({ length: 8 }, () => service.join({ userId: "bob", inviteToken: room.inviteToken!, rulesAccepted: true })));
    expect(results.filter((result) => result.joined)).toHaveLength(1);
    expect(repository.ledger.filter((entry) => entry.userId === "bob")).toHaveLength(1);
    await expect(service.getBalance(room.id, "bob")).resolves.toMatchObject({ availablePoints: "10000.00", frozenPoints: "0.00" });
  });

  it("does not reveal whether a room exists to non-members", async () => {
    const { service } = setup();
    const room = await service.create({ userId: "alice", name: "决赛之夜", visibility: "PRIVATE", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: true });
    await expect(service.getRoom(room.id, "mallory")).rejects.toEqual(new RoomError("ROOM_NOT_FOUND", 404));
    await expect(service.getRoom("missing", "mallory")).rejects.toEqual(new RoomError("ROOM_NOT_FOUND", 404));
  });

  it("lets only the room owner control post-kickoff ticket visibility", async () => {
    const { service } = setup();
    const room = await service.create({ userId: "alice", name: "决赛之夜", visibility: "PRIVATE", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: true });
    await expect(service.updatePostMatchTicketVisibility(room.id, "alice", false)).resolves.toMatchObject({ roomId: room.id, postMatchTicketVisible: false });
    await expect(service.getRoom(room.id, "alice")).resolves.toMatchObject({ preMatchStakeVisible: false, postMatchTicketVisible: false });
    await expect(service.updatePostMatchTicketVisibility(room.id, "mallory", true)).rejects.toMatchObject({ code: "ROOM_OWNER_REQUIRED", status: 403 });
  });
});

// The lobby used to return every ACTIVE public room ever opened. Combined with
// unlimited room creation that is an unbounded response, and the CloudBase
// gateway caps one at ~2 MB — the lobby would stop working rather than degrade.
describe("public lobby paging", () => {
  async function seedPublicRooms(service: RoomService, count: number) {
    for (let index = 0; index < count; index += 1) {
      await service.create({ userId: `owner-${index}`, name: `房间 ${index}`, visibility: "PUBLIC", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: true });
    }
  }

  it("caps a page and offers a cursor only while rooms remain", async () => {
    const { service } = setup();
    await seedPublicRooms(service, PUBLIC_ROOM_PAGE_SIZE + 5);
    const first = await service.listPublic("bob");
    expect(first.rooms).toHaveLength(PUBLIC_ROOM_PAGE_SIZE);
    expect(first.cursor).toEqual(expect.any(String));

    const second = await service.listPublic("bob", { cursor: first.cursor! });
    expect(second.rooms).toHaveLength(5);
    // The end of the list says so, rather than handing back a cursor that
    // returns an empty page forever.
    expect(second.cursor).toBeNull();
  });

  it("walks every room exactly once across pages", async () => {
    const { service } = setup();
    await seedPublicRooms(service, PUBLIC_ROOM_PAGE_SIZE * 2);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: PublicRoomPage = await service.listPublic("bob", cursor ? { cursor } : {});
      seen.push(...page.rooms.map((room) => room.id));
      cursor = page.cursor;
    } while (cursor);
    expect(seen).toHaveLength(PUBLIC_ROOM_PAGE_SIZE * 2);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("refuses a malformed cursor instead of silently restarting at page one", async () => {
    const { service } = setup();
    await seedPublicRooms(service, 3);
    // Silently falling back to page one loops a paging caller forever.
    await expect(service.listPublic("bob", { cursor: "not-a-cursor" })).rejects.toMatchObject({ code: "INVALID_CURSOR", status: 422 });
    await expect(service.listPublic("bob", { cursor: "" })).rejects.toMatchObject({ code: "INVALID_CURSOR", status: 422 });
    await expect(service.listPublic("bob", { cursor: encodeKeysetCursor({ createdAt: now.toISOString(), id: "1 OR 1=1" }) })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
});

// Every room mints its owner a fresh 10,000-point account plus a ledger grant,
// and a PUBLIC one also takes a lobby slot — so unlimited creation is both an
// abuse channel and the product's accidental answer to a busted balance.
describe("room creation quota", () => {
  const clear = { active: 0, lastHour: 0, lastDay: 0 };

  it("allows creation below every limit", () => {
    expect(roomCreationRefusal(clear)).toBeNull();
    expect(roomCreationRefusal({ active: ACTIVE_ROOMS_PER_OWNER - 1, lastHour: ROOMS_PER_HOUR - 1, lastDay: ROOMS_PER_DAY - 1 })).toBeNull();
  });

  it("refuses at the active-room cap, not one room past it", () => {
    expect(roomCreationRefusal({ ...clear, active: ACTIVE_ROOMS_PER_OWNER })).toMatchObject({ code: "ROOM_LIMIT_REACHED", status: 409 });
  });

  it("refuses on either rate window", () => {
    expect(roomCreationRefusal({ ...clear, lastHour: ROOMS_PER_HOUR })).toMatchObject({ code: "ROOM_RATE_LIMITED", status: 429 });
    expect(roomCreationRefusal({ ...clear, lastDay: ROOMS_PER_DAY })).toMatchObject({ code: "ROOM_RATE_LIMITED", status: 429 });
  });

  it("reports the cap first when both are breached, because it is the actionable one", () => {
    // "Close a room" is something the owner can do now; "wait" is not.
    expect(roomCreationRefusal({ active: ACTIVE_ROOMS_PER_OWNER, lastHour: ROOMS_PER_HOUR, lastDay: ROOMS_PER_DAY })).toMatchObject({ code: "ROOM_LIMIT_REACHED" });
  });

  it("carries an action the API can show, since the handler renders error.action", () => {
    expect(roomCreationRefusal({ ...clear, active: ACTIVE_ROOMS_PER_OWNER })?.action).toContain(String(ACTIVE_ROOMS_PER_OWNER));
    expect(roomCreationRefusal({ ...clear, lastHour: ROOMS_PER_HOUR })?.action).toBeTruthy();
  });
});
