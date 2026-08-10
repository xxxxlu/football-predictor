import { and, count, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  encodeKeysetCursor,
  PUBLIC_ROOM_PAGE_SIZE,
  roomCreationRefusal,
  type KeysetCursor,
  type PublicRoomPage,
  type RoomRepository,
  type RoomSummaryRecord,
} from "@pulse/domain";
import { withAvatar, withoutAvatar } from "../identity/avatar-projection.js";
import type { IdentityDatabase } from "../identity/repository.js";
import { identityUsers, userAvatars } from "../identity/schema.js";
import { pointAccounts, pointLedgerEntries, roomAuditEvents, roomMembers, rooms } from "./schema.js";

type RoomTransaction = Parameters<Parameters<IdentityDatabase["transaction"]>[0]>[0];

export class DrizzleRoomRepository implements RoomRepository {
  constructor(private readonly db: IdentityDatabase) {}

  /**
   * Both creation guards are read and enforced inside the same transaction as
   * the insert, behind a per-owner advisory lock: a plain read-then-insert lets
   * two concurrent requests each see a count below the cap and each commit.
   * The lock is transaction-scoped, so a rollback releases it.
   */
  async createRoom(input: Parameters<RoomRepository["createRoom"]>[0]) {
    const hourAgo = new Date(input.now.getTime() - 3_600_000).toISOString();
    const dayAgo = new Date(input.now.getTime() - 86_400_000).toISOString();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('room-create:' || ${input.ownerId}, 0))`);
      // Timestamps bind as ISO strings with an explicit cast: the Next.js
      // runtime instruments the global Date, which defeats postgres.js's
      // `instanceof Date` inference and throws ERR_INVALID_ARG_TYPE.
      const [quota] = await tx.select({
        active: sql<string>`count(*) FILTER (WHERE ${rooms.status} <> 'CLOSED')`,
        lastHour: sql<string>`count(*) FILTER (WHERE ${rooms.createdAt} >= ${hourAgo}::timestamptz)`,
        lastDay: sql<string>`count(*) FILTER (WHERE ${rooms.createdAt} >= ${dayAgo}::timestamptz)`,
      }).from(rooms).where(eq(rooms.createdBy, input.ownerId));
      const refusal = roomCreationRefusal({
        active: Number(quota?.active ?? 0),
        lastHour: Number(quota?.lastHour ?? 0),
        lastDay: Number(quota?.lastDay ?? 0),
      });
      if (refusal) throw refusal;
      await tx.insert(rooms).values({ id: input.id, name: input.name, visibility: input.visibility, tier: input.tier, sport: input.sport, inviteTokenHash: input.inviteTokenHash, createdBy: input.ownerId, createdAt: input.now, updatedAt: input.now });
      await tx.insert(roomMembers).values({ roomId: input.id, userId: input.ownerId, role: "OWNER", acceptedRulesVersion: input.rulesVersion, acceptedRulesAt: input.now, joinedAt: input.now });
      await tx.insert(pointAccounts).values({ roomId: input.id, userId: input.ownerId, availablePoints: input.initialPoints, frozenPoints: "0.00", correctionDebt: "0.00", createdAt: input.now, updatedAt: input.now });
      await tx.insert(pointLedgerEntries).values({ id: input.auditId, roomId: input.id, userId: input.ownerId, kind: "INITIAL_GRANT", amount: input.initialPoints, availableDeltaPoints: input.initialPoints, idempotencyKey: `initial-grant:${input.id}:${input.ownerId}`, auditId: input.auditId, createdAt: input.now });
      await tx.insert(roomAuditEvents).values({ auditId: input.auditId, actorUserId: input.ownerId, roomId: input.id, action: "ROOM_CREATED", result: "SUCCESS", occurredAt: input.now });
    });
  }

  async rotateInvite(input: Parameters<RoomRepository["rotateInvite"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx.select({ id: rooms.id }).from(rooms)
        .innerJoin(roomMembers, and(eq(roomMembers.roomId, rooms.id), eq(roomMembers.userId, input.ownerId), eq(roomMembers.role, "OWNER")))
        .where(and(eq(rooms.id, input.roomId), eq(rooms.visibility, "PRIVATE"), eq(rooms.status, "ACTIVE"))).for("update").limit(1);
      if (!owned) return false;
      await tx.update(rooms).set({ inviteTokenHash: input.inviteTokenHash, updatedAt: input.now }).where(eq(rooms.id, input.roomId));
      await tx.insert(roomAuditEvents).values({ auditId: input.auditId, actorUserId: input.ownerId, roomId: input.roomId, action: "INVITE_RESET", result: "SUCCESS", occurredAt: input.now });
      return true;
    });
  }

  async previewInvite(inviteTokenHash: string) {
    const [room] = await this.db.select({ id: rooms.id, name: rooms.name, status: rooms.status }).from(rooms)
      .where(and(eq(rooms.visibility, "PRIVATE"), eq(rooms.inviteTokenHash, inviteTokenHash), eq(rooms.status, "ACTIVE"))).limit(1);
    return room ?? null;
  }

  async joinByInvite(input: Parameters<RoomRepository["joinByInvite"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [room] = await tx.select({ id: rooms.id }).from(rooms)
        .where(and(eq(rooms.visibility, "PRIVATE"), eq(rooms.inviteTokenHash, input.inviteTokenHash), eq(rooms.status, "ACTIVE"))).for("update").limit(1);
      if (!room) return null;
      return this.addMember(tx, room.id, input);
    });
  }

  /**
   * One lobby page, oldest room first — the order the lobby has always used, so
   * a flood lands at the end rather than burying the rooms people are in. Reads
   * PAGE_SIZE + 1 to learn whether a next page exists without a second count.
   */
  async listPublicRooms(userId: string, options: { cursor?: KeysetCursor } = {}): Promise<PublicRoomPage> {
    const cursor = options.cursor;
    const rows = await this.db.select({
      id: rooms.id,
      name: rooms.name,
      ownerName: sql<string>`COALESCE(${identityUsers.nickname}, ${identityUsers.usernameCanonical})`,
      sport: rooms.sport,
      createdAt: rooms.createdAt,
      memberCount: count(roomMembers.userId),
      joined: sql<boolean>`BOOL_OR(${roomMembers.userId} = ${userId})`,
    }).from(rooms)
      .innerJoin(identityUsers, eq(identityUsers.id, rooms.createdBy))
      .innerJoin(roomMembers, eq(roomMembers.roomId, rooms.id))
      .where(and(
        eq(rooms.visibility, "PUBLIC"),
        eq(rooms.status, "ACTIVE"),
        ...(cursor ? [sql`(${rooms.createdAt}, ${rooms.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`] : []),
      ))
      .groupBy(rooms.id, rooms.name, identityUsers.nickname, identityUsers.usernameCanonical, rooms.sport, rooms.createdAt)
      .orderBy(rooms.createdAt, rooms.id)
      .limit(PUBLIC_ROOM_PAGE_SIZE + 1);
    const hasMore = rows.length > PUBLIC_ROOM_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, PUBLIC_ROOM_PAGE_SIZE) : rows;
    const last = page[page.length - 1];
    return {
      rooms: page.map(({ createdAt: _createdAt, ...row }) => ({ ...row, memberCount: Number(row.memberCount), joined: Boolean(row.joined) })),
      cursor: hasMore && last ? encodeKeysetCursor({ createdAt: new Date(last.createdAt).toISOString(), id: last.id }) : null,
    };
  }

  async joinPublicRoom(input: Parameters<RoomRepository["joinPublicRoom"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [room] = await tx.select({ id: rooms.id }).from(rooms)
        .where(and(eq(rooms.id, input.roomId), eq(rooms.visibility, "PUBLIC"), eq(rooms.status, "ACTIVE"))).for("update").limit(1);
      if (!room) return null;
      return this.addMember(tx, room.id, input);
    });
  }

  async listRooms(userId: string): Promise<RoomSummaryRecord[]> {
    const allMembers = alias(roomMembers, "all_members");
    const rows = await this.db.select({ id: rooms.id, name: rooms.name, status: rooms.status, visibility: rooms.visibility, tier: rooms.tier, sport: rooms.sport, preMatchStakeVisible: rooms.preMatchStakeVisible, postMatchTicketVisible: rooms.postMatchTicketVisible, role: roomMembers.role, memberCount: count(allMembers.userId) })
      .from(roomMembers).innerJoin(rooms, eq(rooms.id, roomMembers.roomId)).innerJoin(allMembers, eq(allMembers.roomId, rooms.id))
      .where(and(eq(roomMembers.userId, userId), ne(rooms.status, "CLOSED"))).groupBy(rooms.id, rooms.name, rooms.status, rooms.visibility, rooms.tier, rooms.sport, rooms.preMatchStakeVisible, rooms.postMatchTicketVisible, roomMembers.role).orderBy(rooms.createdAt);
    return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) }));
  }

  async getRoomForMember(roomId: string, userId: string): Promise<RoomSummaryRecord | null> {
    const allMembers = alias(roomMembers, "all_members");
    const [row] = await this.db.select({ id: rooms.id, name: rooms.name, status: rooms.status, visibility: rooms.visibility, tier: rooms.tier, sport: rooms.sport, preMatchStakeVisible: rooms.preMatchStakeVisible, postMatchTicketVisible: rooms.postMatchTicketVisible, role: roomMembers.role, memberCount: count(allMembers.userId) })
      .from(roomMembers).innerJoin(rooms, eq(rooms.id, roomMembers.roomId)).innerJoin(allMembers, eq(allMembers.roomId, rooms.id))
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId), ne(rooms.status, "CLOSED"))).groupBy(rooms.id, rooms.name, rooms.status, rooms.visibility, rooms.tier, rooms.sport, rooms.preMatchStakeVisible, rooms.postMatchTicketVisible, roomMembers.role).limit(1);
    return row ? { ...row, memberCount: Number(row.memberCount) } : null;
  }

  async getBalance(roomId: string, userId: string) {
    const [balance] = await this.db.select({ availablePoints: pointAccounts.availablePoints, frozenPoints: pointAccounts.frozenPoints, correctionDebt: pointAccounts.correctionDebt })
      .from(pointAccounts).innerJoin(roomMembers, and(eq(roomMembers.roomId, pointAccounts.roomId), eq(roomMembers.userId, pointAccounts.userId)))
      .where(and(eq(pointAccounts.roomId, roomId), eq(pointAccounts.userId, userId))).limit(1);
    return balance ?? null;
  }

  async listMembers(roomId: string, userId: string) {
    const [authorized] = await this.db.select({ userId: roomMembers.userId }).from(roomMembers).where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId))).limit(1);
    if (!authorized) return null;
    // The roster keeps listing every member under a block (a room is a shared
    // space); only the photo is withheld, and only from the side that blocked.
    const rows = await this.db.select({
      userId: roomMembers.userId,
      username: sql<string>`COALESCE(${identityUsers.nickname}, ${identityUsers.usernameCanonical})`,
      role: roomMembers.role,
      avatarPublicId: userAvatars.publicId,
      avatarVersion: userAvatars.version,
      blockedByViewer: sql<boolean>`EXISTS (SELECT 1 FROM identity.user_blocks b
        WHERE b.blocker_user_id = ${userId} AND b.blocked_user_id = ${roomMembers.userId})`,
    })
      .from(roomMembers)
      .innerJoin(identityUsers, eq(identityUsers.id, roomMembers.userId))
      .leftJoin(userAvatars, and(eq(userAvatars.userId, roomMembers.userId), eq(userAvatars.moderationStatus, "APPROVED")))
      .where(eq(roomMembers.roomId, roomId)).orderBy(roomMembers.joinedAt);
    return rows.map(({ blockedByViewer, ...row }) => (blockedByViewer ? withoutAvatar(row) : withAvatar(row)));
  }

  async updatePostMatchTicketVisibility(input: Parameters<RoomRepository["updatePostMatchTicketVisibility"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx.select({ id: rooms.id }).from(rooms)
        .innerJoin(roomMembers, and(eq(roomMembers.roomId, rooms.id), eq(roomMembers.userId, input.ownerId), eq(roomMembers.role, "OWNER")))
        .where(eq(rooms.id, input.roomId)).for("update").limit(1);
      if (!owned) return false;
      await tx.update(rooms).set({ postMatchTicketVisible: input.visible, updatedAt: input.now }).where(eq(rooms.id, input.roomId));
      await tx.insert(roomAuditEvents).values({
        auditId: input.auditId, actorUserId: input.ownerId, roomId: input.roomId,
        action: input.visible ? "POST_MATCH_TICKET_VISIBILITY_ENABLED" : "POST_MATCH_TICKET_VISIBILITY_DISABLED",
        result: "SUCCESS", occurredAt: input.now,
      });
      return true;
    });
  }

  private async addMember(tx: RoomTransaction, roomId: string, input: { userId: string; rulesVersion: string; initialPoints: string; now: Date; auditId: string }) {
    const inserted = await tx.insert(roomMembers).values({
      roomId, userId: input.userId, role: "MEMBER", acceptedRulesVersion: input.rulesVersion, acceptedRulesAt: input.now, joinedAt: input.now,
    }).onConflictDoNothing().returning({ userId: roomMembers.userId });
    if (inserted.length === 0) {
      await tx.update(roomMembers).set({ acceptedRulesVersion: input.rulesVersion, acceptedRulesAt: input.now }).where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, input.userId)));
      return { roomId, joined: false };
    }
    await tx.insert(pointAccounts).values({ roomId, userId: input.userId, availablePoints: input.initialPoints, frozenPoints: "0.00", correctionDebt: "0.00", createdAt: input.now, updatedAt: input.now });
    await tx.insert(pointLedgerEntries).values({ id: input.auditId, roomId, userId: input.userId, kind: "INITIAL_GRANT", amount: input.initialPoints, availableDeltaPoints: input.initialPoints, idempotencyKey: `initial-grant:${roomId}:${input.userId}`, auditId: input.auditId, createdAt: input.now });
    await tx.insert(roomAuditEvents).values({ auditId: input.auditId, actorUserId: input.userId, roomId, action: "ROOM_JOINED", result: "SUCCESS", occurredAt: input.now });
    return { roomId, joined: true };
  }
}
