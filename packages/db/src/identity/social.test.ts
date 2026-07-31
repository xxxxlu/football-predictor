import type postgres from "postgres";
import { describe, expect, it } from "vitest";

import { OperationError } from "../operations/repository.js";
import { createSocialRepository } from "./social.js";

type Row = Record<string, unknown>;
type Respond = (query: string, values: unknown[]) => Row[];

/** Same fake as operations/user-security.test.ts: thenable queries + begin. */
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
    const normalized = text.replace(/\s+/g, " ").trim();
    log?.queries.push(normalized);
    log?.values.push(...values);
    return respond(normalized, values);
  };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => new FakeQuery(strings, values, run);
  (sql as unknown as { begin: unknown }).begin = (handler: (tx: unknown) => Promise<unknown>) => handler(sql);
  return sql as unknown as postgres.Sql;
}

const NOW = new Date("2026-07-31T10:00:00.000Z");
const clock = () => NOW;
const REQUESTER = "aaaaaaaa-0000-0000-0000-000000000001";
const TARGET = "bbbbbbbb-0000-0000-0000-000000000002";

const base = {
  resolve: (rows: Row[]): [string, Respond] => ["username_canonical = $ AND status = 'ACTIVE'", () => rows],
  window: (hour: number, day: number): [string, Respond] => ["FILTER (WHERE occurred_at >= $ )", () => [{ hourCount: String(hour), dayCount: String(day) }]],
  blocks: (present: boolean): [string, Respond] => ["FROM identity.user_blocks WHERE (blocker_user_id = $", () => (present ? [{ present: 1 }] : [])],
};

function respondWith(routes: Array<[string, Respond]>): Respond {
  return (query, values) => {
    for (const [needle, handler] of routes) {
      if (query.includes(needle)) return handler(query, values);
    }
    return [];
  };
}

async function expectOperationError(promise: Promise<unknown>, code: string, status: number) {
  const failure = await promise.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(OperationError);
  expect((failure as OperationError).code).toBe(code);
  expect((failure as OperationError).status).toBe(status);
}

describe("requestFriend", () => {
  it("answers USER_NOT_FOUND for an unknown or disabled PULSE ID", async () => {
    const repository = createSocialRepository(fakeSql(respondWith([base.resolve([])])), clock);
    await expectOperationError(repository.requestFriend(REQUESTER, "ghost"), "USER_NOT_FOUND", 404);
  });

  it("refuses a self request", async () => {
    const repository = createSocialRepository(fakeSql(respondWith([base.resolve([{ id: REQUESTER }])])), clock);
    await expectOperationError(repository.requestFriend(REQUESTER, "myself"), "SELF_FRIEND_FORBIDDEN", 422);
  });

  it("rate-limits from the persisted window before recording anything", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(
      fakeSql(respondWith([base.resolve([{ id: TARGET }]), base.window(10, 12)]), log),
      clock,
    );
    await expectOperationError(repository.requestFriend(REQUESTER, "bob"), "RATE_LIMITED", 429);
    expect(log.queries.some((query) => query.includes("INSERT INTO identity.friend_request_events"))).toBe(false);
    expect(log.queries.some((query) => query.includes("INSERT INTO identity.friendships"))).toBe(false);
  });

  it("suppresses a blocked request with the same shape as success and no relationship write", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(
      fakeSql(respondWith([base.resolve([{ id: TARGET }]), base.window(0, 0), base.blocks(true)]), log),
      clock,
    );
    await expect(repository.requestFriend(REQUESTER, "bob")).resolves.toEqual({ status: "PENDING" });
    // The attempt still consumes rate-limit quota, so probing costs the same as asking.
    expect(log.queries.some((query) => query.includes("INSERT INTO identity.friend_request_events"))).toBe(true);
    expect(log.queries.some((query) => query.includes("identity.friendships"))).toBe(false);
  });

  it("creates a pending row in canonical order for a fresh pair", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(
      fakeSql(respondWith([base.resolve([{ id: TARGET }]), base.window(3, 5), base.blocks(false)]), log),
      clock,
    );
    await expect(repository.requestFriend(REQUESTER, "bob")).resolves.toEqual({ status: "PENDING" });
    const insert = log.queries.find((query) => query.includes("INSERT INTO identity.friendships"));
    expect(insert).toBeDefined();
    expect(log.values).toContain(REQUESTER);
    expect(log.values).toContain(TARGET);
  });

  it("accepts when the other side already asked (mutual intent)", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(
      fakeSql(
        respondWith([
          base.resolve([{ id: TARGET }]),
          base.window(0, 0),
          base.blocks(false),
          ["FOR UPDATE", () => [{ status: "PENDING", requestedBy: TARGET }]],
        ]),
        log,
      ),
      clock,
    );
    await expect(repository.requestFriend(REQUESTER, "bob")).resolves.toEqual({ status: "ACCEPTED" });
    expect(log.queries.some((query) => query.includes("UPDATE identity.friendships SET status = 'ACCEPTED'"))).toBe(true);
  });

  it("replays idempotently when the same requester repeats a pending request", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(
      fakeSql(
        respondWith([
          base.resolve([{ id: TARGET }]),
          base.window(0, 0),
          base.blocks(false),
          ["FOR UPDATE", () => [{ status: "PENDING", requestedBy: REQUESTER }]],
        ]),
        log,
      ),
      clock,
    );
    await expect(repository.requestFriend(REQUESTER, "bob")).resolves.toEqual({ status: "PENDING" });
    expect(log.queries.some((query) => query.includes("INSERT INTO identity.friendships"))).toBe(false);
  });

  it("retries the whole transaction once when a concurrent insert wins the pair-unique race", async () => {
    let attempts = 0;
    const respond: Respond = (query) => {
      if (query.includes("username_canonical = $ AND status = 'ACTIVE'")) return [{ id: TARGET }];
      if (query.includes("FILTER (WHERE occurred_at >= $ )")) return [{ hourCount: "0", dayCount: "0" }];
      if (query.includes("FROM identity.user_blocks WHERE (blocker_user_id = $")) return [];
      if (query.includes("FOR UPDATE")) {
        // First attempt sees nothing; the retry sees the concurrent winner's row.
        return attempts > 1 ? [{ status: "PENDING", requestedBy: TARGET }] : [];
      }
      if (query.includes("INSERT INTO identity.friendships")) {
        attempts += 1;
        const duplicate = new Error("duplicate key value violates unique constraint \"friendships_pair_unique\"");
        (duplicate as { code?: string }).code = "23505";
        throw duplicate;
      }
      return [];
    };
    const sql = fakeSql((query, values) => respond(query, values));
    // The fake begin has no rollback, so bump attempts before the FOR UPDATE read of round two.
    attempts = 1;
    const repository = createSocialRepository(sql, clock);
    await expect(repository.requestFriend(REQUESTER, "bob")).resolves.toEqual({ status: "ACCEPTED" });
  });
});

describe("respondToFriendRequest", () => {
  const REQUEST_ROW = {
    id: "cccccccc-0000-0000-0000-000000000003",
    userLoId: REQUESTER,
    userHiId: TARGET,
    status: "PENDING",
    requestedBy: REQUESTER,
  };

  it("hides unknown and foreign requests behind the same REQUEST_NOT_FOUND", async () => {
    const repository = createSocialRepository(fakeSql(respondWith([["FOR UPDATE", () => []]])), clock);
    await expectOperationError(
      repository.respondToFriendRequest(TARGET, REQUEST_ROW.id, "accept"),
      "REQUEST_NOT_FOUND",
      404,
    );
  });

  it("refuses the requester answering their own request, same shape", async () => {
    const repository = createSocialRepository(
      fakeSql(respondWith([["FOR UPDATE", () => [REQUEST_ROW]]])),
      clock,
    );
    await expectOperationError(
      repository.respondToFriendRequest(REQUESTER, REQUEST_ROW.id, "accept"),
      "REQUEST_NOT_FOUND",
      404,
    );
  });

  it("hides a request once a block exists in either direction", async () => {
    const repository = createSocialRepository(
      fakeSql(respondWith([["FOR UPDATE", () => [REQUEST_ROW]], base.blocks(true)])),
      clock,
    );
    await expectOperationError(
      repository.respondToFriendRequest(TARGET, REQUEST_ROW.id, "accept"),
      "REQUEST_NOT_FOUND",
      404,
    );
  });

  it("accepts with a responded_at stamp and declines by deleting the row", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(
      fakeSql(respondWith([["FOR UPDATE", () => [REQUEST_ROW]], base.blocks(false)]), log),
      clock,
    );
    await expect(repository.respondToFriendRequest(TARGET, REQUEST_ROW.id, "accept")).resolves.toEqual({
      status: "ACCEPTED",
    });
    expect(log.queries.some((query) => query.includes("SET status = 'ACCEPTED', responded_at = $"))).toBe(true);
    await expect(repository.respondToFriendRequest(TARGET, REQUEST_ROW.id, "decline")).resolves.toEqual({
      status: "DECLINED",
    });
    expect(log.queries.some((query) => query.includes("DELETE FROM identity.friendships WHERE id = $"))).toBe(true);
  });
});

describe("friend and block reads", () => {
  it("passes clean rows through and rejects any projection drift", async () => {
    const clean = [{ userId: TARGET, pulseId: "bob", nickname: null, online: false }];
    const repository = createSocialRepository(fakeSql(() => clean), clock);
    await expect(repository.listFriends(REQUESTER)).resolves.toEqual(clean);

    const leaking = [{ userId: TARGET, pulseId: "bob", nickname: null, online: false, balance: 100 }];
    const drifted = createSocialRepository(fakeSql(() => leaking), clock);
    await expect(drifted.listFriends(REQUESTER)).rejects.toThrow(/must never carry "balance"/);
  });

  it("excludes blocked pairs and non-ACTIVE accounts in the SQL itself", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(fakeSql(() => [], log), clock);
    await repository.listFriends(REQUESTER);
    await repository.listFriendRequests(REQUESTER);
    for (const query of log.queries) {
      expect(query).toContain("NOT EXISTS");
      expect(query).toContain("u.status = 'ACTIVE'");
    }
  });

  it("computes online in SQL from consent AND freshness, never from sessions", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(fakeSql(() => [], log), clock);
    await repository.listFriends(REQUESTER);
    const [query] = log.queries;
    expect(query).toContain("COALESCE(u.show_online_to_friends AND p.online_beat_at > $ , false) AS online");
    expect(query).not.toContain("last_seen_at");
    // TTL cutoff derives from the injected clock: now - 90s.
    expect(log.values).toContain(new Date(NOW.getTime() - 90_000).toISOString());
  });
});

describe("blocks and privacy writes", () => {
  it("blocking severs the friendship in the same transaction and is idempotent", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(
      fakeSql(respondWith([base.resolve([{ id: TARGET }])]), log),
      clock,
    );
    await expect(repository.blockUser(REQUESTER, "bob")).resolves.toEqual({ blocked: true });
    expect(log.queries.some((query) => query.includes("ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING"))).toBe(true);
    expect(log.queries.some((query) => query.includes("DELETE FROM identity.friendships"))).toBe(true);
  });

  it("refuses a self block", async () => {
    const repository = createSocialRepository(fakeSql(respondWith([base.resolve([{ id: REQUESTER }])])), clock);
    await expectOperationError(repository.blockUser(REQUESTER, "me"), "SELF_BLOCK_FORBIDDEN", 422);
  });

  it("reports whether an unblock actually removed a row", async () => {
    const hit = createSocialRepository(fakeSql(() => [{ blockedUserId: TARGET }]), clock);
    await expect(hit.unblockUser(REQUESTER, TARGET)).resolves.toEqual({ unblocked: true });
    const miss = createSocialRepository(fakeSql(() => []), clock);
    await expect(miss.unblockUser(REQUESTER, TARGET)).resolves.toEqual({ unblocked: false });
  });

  it("updates privacy toggles partially via COALESCE and returns the stored state", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(
      fakeSql(() => [{ showOnlineToFriends: true, showLobbyToFriends: false, showInLobbyDirectory: false }], log),
      clock,
    );
    await expect(repository.updatePrivacyPreferences(REQUESTER, { showOnlineToFriends: true })).resolves.toEqual({
      showOnlineToFriends: true,
      showLobbyToFriends: false,
      showInLobbyDirectory: false,
    });
    expect(log.queries[0]).toContain("COALESCE( $ , show_online_to_friends)");
    // The third toggle (12.4 lobby directory) patches the same way.
    expect(log.queries[0]).toContain("COALESCE( $ , show_in_lobby_directory)");
    // The untouched toggles travel as null so COALESCE keeps the stored value.
    expect(log.values).toContain(null);
  });
});

describe("recordHeartbeat", () => {
  it("writes only when the account is ACTIVE and has opted in, reporting the outcome", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const recorded = createSocialRepository(fakeSql(() => [{ userId: REQUESTER }], log), clock);
    await expect(recorded.recordHeartbeat(REQUESTER)).resolves.toEqual({ recorded: true });
    expect(log.queries[0]).toContain("u.status = 'ACTIVE'");
    // Each beat column is gated by its own consent, in SQL (12.1 + 12.4).
    expect(log.queries[0]).toContain("CASE WHEN u.show_online_to_friends OR u.show_lobby_to_friends THEN");
    expect(log.queries[0]).toContain("(u.show_lobby_to_friends OR u.show_in_lobby_directory) THEN");
    const gated = createSocialRepository(fakeSql(() => []), clock);
    await expect(gated.recordHeartbeat(REQUESTER)).resolves.toEqual({ recorded: false });
  });

  it("stamps the lobby beat only for a lobby-surface heartbeat, keeping the other column's value", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(fakeSql(() => [{ userId: REQUESTER }], log), clock);
    await repository.recordHeartbeat(REQUESTER, "lobby");
    expect(log.values).toContain(true);
    // A missed surface must not blank the other beat: the upsert COALESCEs.
    expect(log.queries[0]).toContain("online_beat_at = COALESCE(EXCLUDED.online_beat_at");
    expect(log.queries[0]).toContain("lobby_beat_at = COALESCE(EXCLUDED.lobby_beat_at");
    const plain = { queries: [] as string[], values: [] as unknown[] };
    const online = createSocialRepository(fakeSql(() => [{ userId: REQUESTER }], plain), clock);
    await online.recordHeartbeat(REQUESTER);
    expect(plain.values).toContain(false);
  });
});

describe("removeFriend", () => {
  it("deletes the canonical pair row and reports whether one existed", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createSocialRepository(fakeSql(() => [{ id: "x" }], log), clock);
    await expect(repository.removeFriend(TARGET, REQUESTER)).resolves.toEqual({ removed: true });
    // Canonical order regardless of argument order.
    expect(log.values.slice(0, 2)).toEqual([REQUESTER, TARGET]);
    const miss = createSocialRepository(fakeSql(() => []), clock);
    await expect(miss.removeFriend(REQUESTER, TARGET)).resolves.toEqual({ removed: false });
    await expect(miss.removeFriend(REQUESTER, REQUESTER)).resolves.toEqual({ removed: false });
  });
});
