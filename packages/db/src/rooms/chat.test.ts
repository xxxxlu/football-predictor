import { decodeChatCursor, MESSAGE_PAGE_SIZE } from "@pulse/domain";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { createRoomChatRepository } from "./chat.js";

type Row = Record<string, unknown>;
type Respond = (query: string) => Row[];

/** Same fake sql shape as the governance inbox suite: nested fragments plus `begin`. */
class FakeQuery {
  constructor(readonly strings: readonly string[], readonly values: readonly unknown[], private readonly run: (query: FakeQuery) => Promise<Row[]>) {}
  then<T, U>(resolve?: (rows: Row[]) => T | PromiseLike<T>, reject?: (reason: unknown) => U | PromiseLike<U>) {
    return this.run(this).then(resolve, reject);
  }
}

function flatten(query: FakeQuery): { text: string; values: unknown[] } {
  let text = "";
  const values: unknown[] = [];
  query.strings.forEach((chunk, index) => {
    text += chunk;
    if (index >= query.values.length) return;
    const value = query.values[index];
    if (value instanceof FakeQuery) { const inner = flatten(value); text += inner.text; values.push(...inner.values); }
    else { text += " $ "; values.push(value); }
  });
  return { text, values };
}

function fakeSql(respond: Respond, log?: { queries: string[]; values: unknown[] }) {
  const run = async (query: FakeQuery) => {
    const { text, values } = flatten(query);
    log?.queries.push(text.replace(/\s+/g, " ").trim());
    log?.values.push(...values);
    return respond(text.replace(/\s+/g, " "));
  };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => new FakeQuery(strings, values, run);
  (sql as unknown as { begin: unknown }).begin = (handler: (tx: unknown) => Promise<unknown>) => handler(sql);
  return sql as unknown as postgres.Sql;
}

const NOW = new Date("2026-07-31T12:00:00.000Z");
const clock = () => new Date(NOW);

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const messageRow = (n: number, overrides: Partial<Row> = {}): Row => ({
  id: uuid(n), authorPulseId: `pulse_${n}`, authorNickname: null, body: `message ${n}`,
  createdAt: new Date(NOW.getTime() - n * 1000), isPinned: false, ...overrides,
});

const MEMBER = [{ roomStatus: "ACTIVE", role: "MEMBER", pinnedMessageId: null }];
const OWNER = [{ roomStatus: "ACTIVE", role: "OWNER", pinnedMessageId: null }];
const NO_MUTE = [{ mutedUntil: null }];

const isContext = (q: string) => q.includes('SELECT r.status AS "roomStatus"');
const isMuteCheck = (q: string) => q.includes("MAX(muted_until)");
const isPage = (q: string) => q.includes("FROM room.messages m") && q.includes("ORDER BY m.created_at DESC");

describe("room chat repository", () => {
  it("answers a non-member exactly like a missing room, for reads and writes alike", async () => {
    const repository = createRoomChatRepository(fakeSql(() => []), clock);
    const notFound = { code: "ROOM_NOT_FOUND", status: 404 };
    await expect(repository.listMessages("room-1", "outsider-1")).rejects.toMatchObject(notFound);
    await expect(repository.sendMessage("room-1", "outsider-1", "你好")).rejects.toMatchObject(notFound);
    // Owner-only surfaces answer the same shape to a plain member: they must
    // not confirm their own existence to someone who cannot use them.
    const asMember = createRoomChatRepository(fakeSql((q) => (isContext(q) ? MEMBER : NO_MUTE)), clock);
    await expect(asMember.pinMessage("room-1", "member-1", uuid(1))).rejects.toMatchObject(notFound);
    await expect(asMember.unpinMessage("room-1", "member-1", uuid(1))).rejects.toMatchObject(notFound);
    await expect(asMember.muteMember("room-1", "member-1", { memberUserId: "member-2", muteHours: 1, reason: "刷屏广告" })).rejects.toMatchObject(notFound);
    await expect(asMember.unmuteMember("room-1", "member-1", uuid(9), "误禁")).rejects.toMatchObject(notFound);
  });

  it("pages newest-first with a keyset cursor and never shows a hidden message", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const overflow = Array.from({ length: MESSAGE_PAGE_SIZE + 1 }, (_, index) => messageRow(index + 1));
    const repository = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return MEMBER;
      if (isPage(q)) return overflow;
      return NO_MUTE;
    }, log), clock);
    const page = await repository.listMessages("room-1", "member-1");
    expect(page.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(page).toMatchObject({ pinned: null, mutedUntil: null, canPost: true, isOwner: false });
    expect(page).not.toHaveProperty("mutes");
    // The cursor round-trips and points at the last row that was returned.
    const cursor = decodeChatCursor(page.cursor!)!;
    expect(cursor.id).toBe(uuid(MESSAGE_PAGE_SIZE));
    // Hidden messages are excluded in SQL, not filtered in JS.
    const pageQuery = log.queries.find((q) => q.includes("ORDER BY m.created_at DESC"))!;
    expect(pageQuery).toContain("NOT EXISTS");
    expect(pageQuery).toContain("mm.state = 'HIDDEN'");
    // A second request with the cursor narrows by the compound key.
    await repository.listMessages("room-1", "member-1", { cursor: page.cursor! });
    expect(log.queries.some((q) => q.includes("AND (m.created_at, m.id) <"))).toBe(true);
  });

  it("refuses a cursor it did not mint", async () => {
    const repository = createRoomChatRepository(fakeSql((q) => (isContext(q) ? MEMBER : NO_MUTE)), clock);
    await expect(repository.listMessages("room-1", "member-1", { cursor: "not-a-cursor" }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST", status: 422 });
  });

  it("gives the owner — and only the owner — the room's live owner-issued mutes", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return OWNER;
      if (q.includes("FROM room.member_mutes mu")) return [{ muteId: uuid(7), pulseId: "pulse_two", nickname: "阿强", mutedUntil: new Date("2026-08-01T12:00:00.000Z") }];
      if (isPage(q)) return [];
      return NO_MUTE;
    }, log), clock);
    const page = await repository.listMessages("room-1", "owner-1");
    expect(page.isOwner).toBe(true);
    expect(page.mutes).toEqual([{ muteId: uuid(7), pulseId: "pulse_two", nickname: "阿强", mutedUntil: new Date("2026-08-01T12:00:00.000Z") }]);
    // Owner-path rows only, and only windows that are still live (gap ③).
    const mutesQuery = log.queries.find((q) => q.includes("FROM room.member_mutes mu"))!;
    expect(mutesQuery).toContain("report_id IS NULL");
    expect(mutesQuery).toContain("lifted_at IS NULL AND mu.muted_until >");
  });

  it("tells a muted member when their own mute ends", async () => {
    const mutedUntil = "2026-07-31T13:00:00.000Z";
    const repository = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return MEMBER;
      if (isMuteCheck(q)) return [{ mutedUntil }];
      return [];
    }), clock);
    const page = await repository.listMessages("room-1", "member-1");
    expect(page.mutedUntil).toBe(mutedUntil);
  });

  it("keeps a restricted room readable but not writable", async () => {
    const restricted = [{ roomStatus: "RESTRICTED", role: "MEMBER", pinnedMessageId: null }];
    const repository = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return restricted;
      if (isPage(q)) return [messageRow(1)];
      return NO_MUTE;
    }), clock);
    const page = await repository.listMessages("room-1", "member-1");
    expect(page.canPost).toBe(false);
    expect(page.messages).toHaveLength(1);
    await expect(repository.sendMessage("room-1", "member-1", "还能说话吗"))
      .rejects.toMatchObject({ code: "ROOM_NOT_ACTIVE", status: 409 });
  });

  it("gates sending on the live mute window, the rate window, and the last message", async () => {
    const muted = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return MEMBER;
      if (isMuteCheck(q)) return [{ mutedUntil: "2026-07-31T13:00:00.000Z" }];
      return [];
    }), clock);
    await expect(muted.sendMessage("room-1", "member-1", "你好")).rejects.toMatchObject({ code: "MUTED", status: 403 });

    const log = { queries: [] as string[], values: [] as unknown[] };
    const flooding = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return MEMBER;
      if (isMuteCheck(q)) return NO_MUTE;
      if (q.includes("count(*) AS recent")) return [{ recent: 10 }];
      return [];
    }, log), clock);
    await expect(flooding.sendMessage("room-1", "member-1", "再来一条")).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    // The mute gate trusts only the time window (gap ③), never lifted_at alone.
    const muteGate = log.queries.find((q) => q.includes("MAX(muted_until)"))!;
    expect(muteGate).toContain("lifted_at IS NULL AND muted_until >");

    const repeating = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return MEMBER;
      if (isMuteCheck(q)) return NO_MUTE;
      if (q.includes("count(*) AS recent")) return [{ recent: 3 }];
      if (q.includes("SELECT body FROM room.messages")) return [{ body: "同一句话" }];
      return [];
    }), clock);
    await expect(repeating.sendMessage("room-1", "member-1", "同一句话")).rejects.toMatchObject({ code: "DUPLICATE_MESSAGE", status: 422 });
  });

  it("stores a message and returns the projection — and never touches points or predictions", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return MEMBER;
      if (isMuteCheck(q)) return NO_MUTE;
      if (q.includes("count(*) AS recent")) return [{ recent: 0 }];
      if (q.includes("INSERT INTO room.messages")) return [{ id: uuid(42), createdAt: NOW }];
      if (q.includes('username_canonical AS "pulseId"')) return [{ pulseId: "pulse_one", nickname: "阿伟" }];
      return [];
    }, log), clock);
    const message = await repository.sendMessage("room-1", "member-1", "今晚谁赢？");
    // Story 12.6 added the author's avatar pair and nothing else; a sender with
    // no avatar reads back as nulls so the client renders initials.
    expect(message).toEqual({ id: uuid(42), authorPulseId: "pulse_one", authorNickname: "阿伟", body: "今晚谁赢？", createdAt: NOW, isPinned: false, authorAvatarUrl: null, authorAvatarVersion: null });
    // The rate/duplicate gates are count-then-insert: a per-sender advisory
    // lock serializes concurrent sends so the gates can't be raced past.
    expect(log.queries[0]).toContain("pg_advisory_xact_lock");
    // FR59 / AC4: no chat query reaches into the prediction economy.
    for (const query of log.queries) {
      for (const forbidden of ["ledger.", "prediction.", "available_points", "DELETE FROM"]) expect(query).not.toContain(forbidden);
    }
  });

  it("pins only a visible message of this room, into the single pin slot", async () => {
    const missing = createRoomChatRepository(fakeSql((q) => (isContext(q) ? OWNER : [])), clock);
    await expect(missing.pinMessage("room-1", "owner-1", uuid(1))).rejects.toMatchObject({ code: "MESSAGE_NOT_FOUND", status: 404 });

    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return OWNER;
      if (q.includes("SET pinned_message_id = m.id")) return [{ messageId: uuid(1) }];
      return [];
    }, log), clock);
    await expect(repository.pinMessage("room-1", "owner-1", uuid(1))).resolves.toMatchObject({ pinned: true, messageId: uuid(1) });
    const update = log.queries.find((q) => q.includes("SET pinned_message_id = m.id"))!;
    expect(update).toContain("mm.state = 'HIDDEN'");
    const audit = log.queries.find((q) => q.includes("INSERT INTO ops.audit_events"))!;
    expect(audit).toContain("::text::jsonb");
    expect(log.values).toContain("MESSAGE_PINNED");
  });

  it("unpinning an empty slot or the WRONG message is a conflict, not a silent success", async () => {
    const empty = createRoomChatRepository(fakeSql((q) => (isContext(q) ? OWNER : [])), clock);
    await expect(empty.unpinMessage("room-1", "owner-1", uuid(1))).rejects.toMatchObject({ code: "MESSAGE_NOT_PINNED", status: 409 });

    const log = { queries: [] as string[], values: [] as unknown[] };
    const pinnedRoom = [{ roomStatus: "ACTIVE", role: "OWNER", pinnedMessageId: uuid(1) }];
    const repository = createRoomChatRepository(fakeSql((q) => (isContext(q) ? pinnedRoom : []), log), clock);
    // A DELETE aimed at a message that is not the current pin must not undo a
    // concurrent repin — the URL's messageId is checked against the slot.
    await expect(repository.unpinMessage("room-1", "owner-1", uuid(2))).rejects.toMatchObject({ code: "MESSAGE_NOT_PINNED", status: 409 });
    await expect(repository.unpinMessage("room-1", "owner-1", uuid(1))).resolves.toMatchObject({ pinned: false });
    expect(log.values).toContain("MESSAGE_UNPINNED");
  });

  it("owner mutes settle expired windows first, land under the member, and never stack", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return OWNER;
      if (q.includes('SELECT user_id AS "userId" FROM room.members')) return [{ userId: "member-2" }];
      return [];
    }, log), clock);
    const result = await repository.muteMember("room-1", "owner-1", { memberUserId: "member-2", muteHours: 24, reason: "连续刷屏广告" });
    expect(result.mutedUntil).toBe("2026-08-01T12:00:00.000Z");
    // Gap ③: the expired-window sweep runs before the insert, or the "one live
    // mute" index would refuse a legitimate mute months later.
    const sweep = log.queries.findIndex((q) => q.includes("SET lifted_at = muted_until"));
    const insert = log.queries.findIndex((q) => q.includes("INSERT INTO room.member_mutes"));
    expect(sweep).toBeGreaterThanOrEqual(0);
    expect(sweep).toBeLessThan(insert);
    // Owner path is marked by report_id IS NULL, audited under the member (gap ②).
    expect(log.values).toContain(null);
    expect(log.values).toContain("MEMBER_MUTED");
    expect(log.values).toContain("USER");
    expect(log.values).toContain("member-2");

    await expect(repository.muteMember("room-1", "owner-1", { memberUserId: "owner-1", muteHours: 1, reason: "自己禁自己" }))
      .rejects.toMatchObject({ code: "SELF_MUTE_FORBIDDEN", status: 422 });

    const outsider = createRoomChatRepository(fakeSql((q) => (isContext(q) ? OWNER : [])), clock);
    await expect(outsider.muteMember("room-1", "owner-1", { memberUserId: "stranger-1", muteHours: 1, reason: "不是成员" }))
      .rejects.toMatchObject({ code: "MEMBER_NOT_FOUND", status: 404 });

    const stacked = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return OWNER;
      if (q.includes('SELECT user_id AS "userId" FROM room.members')) return [{ userId: "member-2" }];
      if (q.includes("INSERT INTO room.member_mutes")) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      return [];
    }), clock);
    await expect(stacked.muteMember("room-1", "owner-1", { memberUserId: "member-2", muteHours: 1, reason: "再禁一次" }))
      .rejects.toMatchObject({ code: "MUTE_ALREADY_ACTIVE", status: 409 });
  });

  it("owner unmute lifts only a live owner-issued mute, and is audited", async () => {
    const inactive = createRoomChatRepository(fakeSql((q) => (isContext(q) ? OWNER : [])), clock);
    await expect(inactive.unmuteMember("room-1", "owner-1", uuid(7), "误禁，解除"))
      .rejects.toMatchObject({ code: "MUTE_NOT_ACTIVE", status: 409 });

    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createRoomChatRepository(fakeSql((q) => {
      if (isContext(q)) return OWNER;
      if (q.includes("SET lifted_by =")) return [{ userId: "member-2" }];
      return [];
    }, log), clock);
    await expect(repository.unmuteMember("room-1", "owner-1", uuid(7), "误禁，解除")).resolves.toMatchObject({ lifted: true });
    const lift = log.queries.find((q) => q.includes("SET lifted_by ="))!;
    // Inbox mutes (report_id set) stay with the inbox; expired windows are not "lifted".
    expect(lift).toContain("report_id IS NULL");
    expect(lift).toContain("muted_until >");
    expect(log.values).toContain("MEMBER_UNMUTED");
    expect(log.values).toContain("member-2");
  });
});
