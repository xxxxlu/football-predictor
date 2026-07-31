import { CHANNEL_PAGE_SIZE, COMMUNITY_RULES_VERSION, decodeChatCursor } from "@pulse/domain";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { closeExpiredChannelMuteWindows, createClubChannelRepository } from "./channel.js";

type Row = Record<string, unknown>;
type Respond = (query: string) => Row[];

/** Same fake sql shape as the room chat suite: nested fragments plus `begin`. */
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
const messageRow = (n: number): Row => ({
  id: uuid(n), authorPulseId: `pulse_${n}`, authorNickname: null, body: `message ${n}`,
  createdAt: new Date(NOW.getTime() - n * 1000),
});

const RULES_OK = [{ present: 1 }];
const NO_MUTE = [{ mutedUntil: null }];
const ACCOUNT = [{ pulseId: "pulse_one", nickname: "阿伟" }];

const isRulesCheck = (q: string) => q.includes("FROM identity.rule_acceptances");
const isMuteCheck = (q: string) => q.includes("MAX(muted_until)");
const isPage = (q: string) => q.includes("FROM club.channel_messages m") && q.includes("ORDER BY m.created_at DESC");
const isAccount = (q: string) => q.includes('username_canonical AS "pulseId"');

describe("channel read path", () => {
  it("pages newest-first, hides moderated messages and blocked pairs in SQL, and reports the caller's own gates", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const overflow = Array.from({ length: CHANNEL_PAGE_SIZE + 1 }, (_, index) => messageRow(index + 1));
    const repository = createClubChannelRepository(fakeSql((q) => {
      if (isPage(q)) return overflow;
      if (isMuteCheck(q)) return NO_MUTE;
      if (isRulesCheck(q)) return RULES_OK;
      return [];
    }, log), clock);
    const page = await repository.listMessages("viewer-1");
    expect(page.messages).toHaveLength(CHANNEL_PAGE_SIZE);
    expect(page.mutedUntil).toBeNull();
    expect(page.rulesConfirmed).toBe(true);
    const cursor = decodeChatCursor(page.cursor!)!;
    expect(cursor.id).toBe(uuid(CHANNEL_PAGE_SIZE));

    const pageQuery = log.queries.find((q) => q.includes("ORDER BY m.created_at DESC"))!;
    // HIDDEN exclusion and the bidirectional block filter are SQL, not JS.
    expect(pageQuery).toContain("mm.state = 'HIDDEN'");
    expect(pageQuery).toContain("b.blocker_user_id =");
    expect(pageQuery).toContain("b.blocked_user_id = u.id");
    expect(pageQuery).toContain("b.blocker_user_id = u.id");
    // The read window bounds pagination to the newest N stored messages — the
    // 12.4 product default is enforced here, not just declared in the domain.
    expect(pageQuery).toContain("OFFSET");
    // A second request with the cursor narrows by the compound key.
    await repository.listMessages("viewer-1", { cursor: page.cursor! });
    expect(log.queries.some((q) => q.includes("AND (m.created_at, m.id) <"))).toBe(true);
  });

  it("refuses a cursor it did not mint", async () => {
    const repository = createClubChannelRepository(fakeSql(() => []), clock);
    await expect(repository.listMessages("viewer-1", { cursor: "not-a-cursor" }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST", status: 422 });
  });
});

describe("channel write path", () => {
  it("walks the AC2 gate order: rules, mute, rate, duplicate — each with its own stable code", async () => {
    const unconfirmed = createClubChannelRepository(fakeSql((q) => {
      if (isAccount(q)) return ACCOUNT;
      return [];
    }), clock);
    await expect(unconfirmed.sendMessage("user-1", "你好")).rejects.toMatchObject({ code: "RULES_CONFIRMATION_REQUIRED", status: 403 });

    const log = { queries: [] as string[], values: [] as unknown[] };
    const muted = createClubChannelRepository(fakeSql((q) => {
      if (isAccount(q)) return ACCOUNT;
      if (isRulesCheck(q)) return RULES_OK;
      if (isMuteCheck(q)) return [{ mutedUntil: "2026-07-31T13:00:00.000Z" }];
      return [];
    }, log), clock);
    await expect(muted.sendMessage("user-1", "你好")).rejects.toMatchObject({ code: "COMMUNITY_MUTED", status: 403 });
    // The mute gate trusts only the time window, never lifted_at alone (12.3 red line).
    const muteGate = log.queries.find((q) => q.includes("MAX(muted_until)"))!;
    expect(muteGate).toContain("lifted_at IS NULL AND muted_until >");

    const flooding = createClubChannelRepository(fakeSql((q) => {
      if (isAccount(q)) return ACCOUNT;
      if (isRulesCheck(q)) return RULES_OK;
      if (isMuteCheck(q)) return NO_MUTE;
      if (q.includes("count(*) AS recent")) return [{ recent: 5 }];
      return [];
    }), clock);
    await expect(flooding.sendMessage("user-1", "再来一条")).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });

    const repeating = createClubChannelRepository(fakeSql((q) => {
      if (isAccount(q)) return ACCOUNT;
      if (isRulesCheck(q)) return RULES_OK;
      if (isMuteCheck(q)) return NO_MUTE;
      if (q.includes("count(*) AS recent")) return [{ recent: 1 }];
      if (q.includes("SELECT body FROM club.channel_messages")) return [{ body: "同一句话" }];
      return [];
    }), clock);
    await expect(repeating.sendMessage("user-1", "同一句话")).rejects.toMatchObject({ code: "DUPLICATE_MESSAGE", status: 422 });
  });

  it("stores a message and returns the projection — and never touches rooms, points or predictions", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createClubChannelRepository(fakeSql((q) => {
      if (isAccount(q)) return ACCOUNT;
      if (isRulesCheck(q)) return RULES_OK;
      if (isMuteCheck(q)) return NO_MUTE;
      if (q.includes("count(*) AS recent")) return [{ recent: 0 }];
      if (q.includes("INSERT INTO club.channel_messages")) return [{ id: uuid(42), createdAt: NOW }];
      return [];
    }, log), clock);
    const message = await repository.sendMessage("user-1", "今晚谁夺冠？");
    expect(message).toEqual({ id: uuid(42), authorPulseId: "pulse_one", authorNickname: "阿伟", body: "今晚谁夺冠？", createdAt: NOW });
    // Count-then-insert gates need a per-user arbiter under READ COMMITTED:
    // the send transaction serializes on an advisory lock.
    expect(log.queries[0]).toContain("pg_advisory_xact_lock");
    // AC1: the lobby is not a points room — no query leaves identity.* and club.*.
    for (const query of log.queries) {
      for (const forbidden of ["room.", "ledger.", "prediction.", "supplier.", "available_points", "DELETE FROM"]) {
        expect(query).not.toContain(forbidden);
      }
    }
  });

  it("answers a missing or disabled account as USER_NOT_FOUND before any gate", async () => {
    const repository = createClubChannelRepository(fakeSql(() => []), clock);
    await expect(repository.sendMessage("ghost-1", "你好")).rejects.toMatchObject({ code: "USER_NOT_FOUND", status: 404 });
  });
});

describe("community rules acceptance", () => {
  it("writes the community:v1 row idempotently, carrying the account's existing adult confirmation", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createClubChannelRepository(fakeSql((q) => (isRulesCheck(q) && q.includes("SELECT 1 AS present") ? RULES_OK : []), log), clock);
    await expect(repository.acceptCommunityRules("user-1")).resolves.toEqual({ version: COMMUNITY_RULES_VERSION, confirmed: true });
    const insert = log.queries.find((q) => q.includes("INSERT INTO identity.rule_acceptances"))!;
    expect(insert).toContain("ON CONFLICT (user_id, rules_version) DO NOTHING");
    // No second adulthood semantics: the value comes from the account's own rows.
    expect(insert).toContain("bool_or(ra.is_adult_confirmed)");
    expect(insert).toContain("u.status = 'ACTIVE'");
    expect(log.values).toContain(COMMUNITY_RULES_VERSION);
  });

  it("reports the caller's own confirmation state", async () => {
    const confirmed = createClubChannelRepository(fakeSql((q) => (isRulesCheck(q) ? RULES_OK : [])), clock);
    await expect(confirmed.getCommunityRulesStatus("user-1")).resolves.toEqual({ version: COMMUNITY_RULES_VERSION, confirmed: true });
    const fresh = createClubChannelRepository(fakeSql(() => []), clock);
    await expect(fresh.getCommunityRulesStatus("user-1")).resolves.toEqual({ version: COMMUNITY_RULES_VERSION, confirmed: false });
  });
});

describe("lobby directory", () => {
  it("lists only opted-in, present, unblocked members — public pair only", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createClubChannelRepository(fakeSql((q) => {
      if (q.includes("u.show_in_lobby_directory")) return [{ pulseId: "pulse_two", nickname: "阿强" }];
      return [];
    }, log), clock);
    await expect(repository.lobbyDirectory("viewer-1")).resolves.toEqual([{ pulseId: "pulse_two", nickname: "阿强" }]);
    const directory = log.queries.find((q) => q.includes("u.show_in_lobby_directory"))!;
    // Its own toggle, the lobby beat inside the TTL, blocks both ways.
    expect(directory).toContain("p.lobby_beat_at >");
    expect(directory).toContain("b.blocker_user_id = u.id");
    expect(directory).not.toContain("show_online_to_friends");
    expect(directory).not.toContain("last_seen_at");
  });
});

describe("friend activity", () => {
  it("returns null challenge state until the viewer has answered today — the 12.2 mutual gate in SQL", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createClubChannelRepository(fakeSql((q) => {
      if (q.includes("AS answered")) return [{ answered: false }];
      if (q.includes("FROM identity.friendships f")) return [{ pulseId: "pulse_two", nickname: null, online: true, inLobby: false, answeredToday: null }];
      return [];
    }, log), clock);
    const activity = await repository.friendActivity("viewer-1", "2026-07-31");
    expect(activity.viewerAnswered).toBe(false);
    expect(activity.friends).toEqual([{ pulseId: "pulse_two", nickname: null, online: true, inLobby: false, answeredToday: null }]);
    const friends = log.queries.find((q) => q.includes("FROM identity.friendships f"))!;
    // Presence keeps the 12.1 consent semantics; blocks filter both ways.
    // `inLobby` is the reader for 向好友展示「正在大厅」 — its own toggle, own beat.
    expect(friends).toContain("u.show_online_to_friends AND p.online_beat_at >");
    expect(friends).toContain("u.show_lobby_to_friends AND p.lobby_beat_at >");
    expect(friends).toContain("f.status = 'ACCEPTED'");
    expect(friends).toContain("b.blocked_user_id = u.id");
    expect(friends).not.toContain("last_seen_at");
  });
});

describe("expired community mute settlement", () => {
  it("closes only windows that have run out, as self-settlement without a lifter", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const sql = fakeSql(() => [], log);
    await closeExpiredChannelMuteWindows(sql as unknown as postgres.ISql, "user-1", NOW.toISOString());
    const sweep = log.queries[0]!;
    expect(sweep).toContain("SET lifted_at = muted_until");
    expect(sweep).toContain("lifted_at IS NULL AND muted_until <=");
    expect(sweep).not.toContain("lifted_by");
  });
});
