import { describe, expect, it } from "vitest";
import { RoomError, RoomService, type RoomRepository, type RoomSummaryRecord } from "./service.js";

class MemoryRoomRepository implements RoomRepository {
  rooms = new Map<string, RoomSummaryRecord & { inviteHash: string | null; ownerId: string }>();
  members = new Map<string, { userId: string; role: "OWNER" | "MEMBER"; rulesVersion: string }>();
  balances = new Map<string, { availablePoints: string; frozenPoints: string; correctionDebt: string }>();
  ledger: Array<{ roomId: string; userId: string; kind: string; amount: string }> = [];

  async createRoom(input: Parameters<RoomRepository["createRoom"]>[0]) {
    this.rooms.set(input.id, { id: input.id, name: input.name, status: "ACTIVE", visibility: input.visibility, memberCount: 1, role: "OWNER", inviteHash: input.inviteTokenHash, ownerId: input.ownerId });
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
  async listPublicRooms(userId: string) {
    return [...this.rooms.values()].filter((room) => room.visibility === "PUBLIC" && room.status === "ACTIVE").map((room) => ({
      id: room.id, name: room.name, ownerName: room.ownerId, memberCount: room.memberCount, joined: this.members.has(`${room.id}:${userId}`),
    }));
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
}

let sequence = 0;
const tokens = { inviteToken: () => `invite-${++sequence}`, hash: (value: string) => `hash-${value}`, id: () => `id-${++sequence}` };
const now = new Date("2026-07-13T12:00:00Z");
function setup() { const repository = new MemoryRoomRepository(); return { repository, service: new RoomService(repository, tokens, () => now, { rulesVersion: "rooms-2026-07", initialPoints: "10000.00" }) }; }

describe("RoomService", () => {
  it("atomically creates a private room, owner membership and isolated initial balance", async () => {
    const { repository, service } = setup();
    const created = await service.create({ userId: "alice", name: "决赛之夜", visibility: "PRIVATE", rulesAccepted: true });
    expect(created).toMatchObject({ name: "决赛之夜", role: "room_owner", inviteToken: expect.stringMatching(/^invite-/) });
    await expect(service.getBalance(created.id, "alice")).resolves.toEqual({ availablePoints: "10000.00", frozenPoints: "0.00", correctionDebt: "0.00" });
    expect(repository.ledger).toEqual([{ roomId: created.id, userId: "alice", kind: "INITIAL_GRANT", amount: "10000.00" }]);
  });

  it("creates a public room without exposing an invitation token", async () => {
    const { repository, service } = setup();
    const created = await service.create({ userId: "alice", name: "公开看球局", visibility: "PUBLIC", rulesAccepted: true });
    expect(created).toMatchObject({ name: "公开看球局", visibility: "PUBLIC" });
    expect(created).not.toHaveProperty("inviteToken");
    expect(repository.rooms.get(created.id)).toMatchObject({ visibility: "PUBLIC", inviteHash: null });
  });

  it("lists and idempotently joins active public rooms after rules confirmation", async () => {
    const { repository, service } = setup();
    const room = await service.create({ userId: "alice", name: "公开看球局", visibility: "PUBLIC", rulesAccepted: true });
    await expect(service.listPublic("bob")).resolves.toEqual([{ id: room.id, name: "公开看球局", ownerName: "alice", memberCount: 1, joined: false }]);
    await expect(service.joinPublic({ roomId: room.id, userId: "bob", rulesAccepted: true })).resolves.toEqual({ roomId: room.id, joined: true });
    await expect(service.joinPublic({ roomId: room.id, userId: "bob", rulesAccepted: true })).resolves.toEqual({ roomId: room.id, joined: false });
    expect(repository.ledger.filter((entry) => entry.userId === "bob")).toHaveLength(1);
  });

  it("requires current room rules before creating or joining", async () => {
    const { service } = setup();
    await expect(service.create({ userId: "alice", name: "决赛之夜", visibility: "PRIVATE", rulesAccepted: false })).rejects.toMatchObject({ code: "ROOM_RULES_REQUIRED" });
  });

  it("reset invalidates the old invite without changing members or balances", async () => {
    const { service } = setup();
    const created = await service.create({ userId: "alice", name: "决赛之夜", visibility: "PRIVATE", rulesAccepted: true });
    const rotated = await service.resetInvite(created.id, "alice");
    await expect(service.previewInvite(created.inviteToken)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    await expect(service.previewInvite(rotated.inviteToken)).resolves.toMatchObject({ id: created.id });
    await expect(service.getBalance(created.id, "alice")).resolves.toMatchObject({ availablePoints: "10000.00" });
  });

  it("concurrent repeated joins create one membership, one account and one grant", async () => {
    const { repository, service } = setup();
    const room = await service.create({ userId: "alice", name: "决赛之夜", visibility: "PRIVATE", rulesAccepted: true });
    const results = await Promise.all(Array.from({ length: 8 }, () => service.join({ userId: "bob", inviteToken: room.inviteToken, rulesAccepted: true })));
    expect(results.filter((result) => result.joined)).toHaveLength(1);
    expect(repository.ledger.filter((entry) => entry.userId === "bob")).toHaveLength(1);
    await expect(service.getBalance(room.id, "bob")).resolves.toMatchObject({ availablePoints: "10000.00", frozenPoints: "0.00" });
  });

  it("does not reveal whether a room exists to non-members", async () => {
    const { service } = setup();
    const room = await service.create({ userId: "alice", name: "决赛之夜", visibility: "PRIVATE", rulesAccepted: true });
    await expect(service.getRoom(room.id, "mallory")).rejects.toEqual(new RoomError("ROOM_NOT_FOUND", 404));
    await expect(service.getRoom("missing", "mallory")).rejects.toEqual(new RoomError("ROOM_NOT_FOUND", 404));
  });
});
