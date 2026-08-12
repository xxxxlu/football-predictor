import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { createRoomGrantRepository } from "./grants.js";

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

const NOW = new Date("2026-08-12T10:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const grantRow = (overrides: Row = {}): Row => ({
  id: uuid(1), roomId: uuid(9), requesterUserId: uuid(2), requesterDisplayName: "Alice",
  note: null, status: "OPEN", requestedAt: NOW, decidedAt: null, approvedAmount: null, decisionNote: null,
  ...overrides,
});

const isRoomProbe = (q: string) => q.includes("SELECT r.status FROM room.rooms r");
const isDecisionLock = (q: string) => q.includes("FOR UPDATE OF g");
const isProjection = (q: string) => q.includes('AS "requesterDisplayName"') && !q.includes("FOR UPDATE");
const isMembership = (q: string) => q.includes("SELECT m.role FROM room.members m");
const uniqueViolation = () => Object.assign(new Error("duplicate key"), { code: "23505" });

describe("room grant repository — requests", () => {
  it("answers a non-member exactly like a missing room", async () => {
    const repository = createRoomGrantRepository(fakeSql((q) => (isRoomProbe(q) ? [] : [])));
    await expect(repository.requestGrant({ id: uuid(1), roomId: uuid(9), requesterUserId: uuid(2), note: null, now: NOW })).resolves.toBeNull();
    await expect(repository.listGrants(uuid(9), uuid(2))).resolves.toBeNull();
  });

  it("refuses new requests in a restricted or closed room with ROOM_NOT_ACTIVE", async () => {
    for (const status of ["RESTRICTED", "CLOSED"]) {
      const repository = createRoomGrantRepository(fakeSql((q) => (isRoomProbe(q) ? [{ status }] : [])));
      await expect(repository.requestGrant({ id: uuid(1), roomId: uuid(9), requesterUserId: uuid(2), note: null, now: NOW }))
        .rejects.toMatchObject({ code: "ROOM_NOT_ACTIVE", status: 409 });
    }
  });

  it("inserts an OPEN row and reads it back through the shared projection", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createRoomGrantRepository(fakeSql((q) => {
      if (isRoomProbe(q)) return [{ status: "ACTIVE" }];
      if (isProjection(q)) return [grantRow({ note: "需要补分" })];
      return [];
    }, log));
    const result = await repository.requestGrant({ id: uuid(1), roomId: uuid(9), requesterUserId: uuid(2), note: "需要补分", now: NOW });
    expect(result).toMatchObject({ created: true, request: { status: "OPEN", note: "需要补分", requester: { userId: uuid(2), displayName: "Alice" } } });
    expect(log.queries.some((q) => q.includes("INSERT INTO room.grant_requests"))).toBe(true);
    // Timestamps bind as ISO strings with an explicit cast (Next.js Date instrumentation).
    expect(log.values).toContain(NOW.toISOString());
  });

  it("converges a duplicate request on the existing OPEN row instead of a 500", async () => {
    let inserted = false;
    const repository = createRoomGrantRepository(fakeSql((q) => {
      if (isRoomProbe(q)) return [{ status: "ACTIVE" }];
      if (q.includes("INSERT INTO room.grant_requests")) { inserted = true; throw uniqueViolation(); }
      if (q.includes("g.status = 'OPEN'")) return [grantRow()];
      return [];
    }));
    const result = await repository.requestGrant({ id: uuid(5), roomId: uuid(9), requesterUserId: uuid(2), note: null, now: NOW });
    expect(inserted).toBe(true);
    expect(result).toMatchObject({ created: false, request: { id: uuid(1), status: "OPEN" } });
  });

  it("retries once when the colliding OPEN row was decided before the read-back", async () => {
    let inserts = 0;
    const repository = createRoomGrantRepository(fakeSql((q) => {
      if (isRoomProbe(q)) return [{ status: "ACTIVE" }];
      if (q.includes("INSERT INTO room.grant_requests")) { inserts += 1; if (inserts === 1) throw uniqueViolation(); return []; }
      if (q.includes("g.status = 'OPEN'")) return []; // the winner is already decided
      if (isProjection(q)) return [grantRow({ id: uuid(5) })];
      return [];
    }));
    const result = await repository.requestGrant({ id: uuid(5), roomId: uuid(9), requesterUserId: uuid(2), note: null, now: NOW });
    expect(inserts).toBe(2);
    expect(result).toMatchObject({ created: true, request: { id: uuid(5), status: "OPEN" } });
  });

  it("rethrows when the collision persists after the single retry", async () => {
    let inserts = 0;
    const repository = createRoomGrantRepository(fakeSql((q) => {
      if (isRoomProbe(q)) return [{ status: "ACTIVE" }];
      if (q.includes("INSERT INTO room.grant_requests")) { inserts += 1; throw uniqueViolation(); }
      return [];
    }));
    await expect(repository.requestGrant({ id: uuid(5), roomId: uuid(9), requesterUserId: uuid(2), note: null, now: NOW }))
      .rejects.toMatchObject({ code: "23505" });
    expect(inserts).toBe(2);
  });
});

describe("room grant repository — decisions", () => {
  const lockRow = (overrides: Row = {}): Row => ({
    id: uuid(1), status: "OPEN", approvedAmount: null, requesterUserId: uuid(2), roomStatus: "ACTIVE", ...overrides,
  });

  function harness(rows: { lock?: Row[]; projected?: Row[]; onLedgerInsert?: () => void }) {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createRoomGrantRepository(fakeSql((q) => {
      if (isDecisionLock(q)) return rows.lock ?? [];
      if (q.includes("INSERT INTO ledger.entries")) { rows.onLedgerInsert?.(); return []; }
      if (isProjection(q)) return rows.projected ?? [];
      return [];
    }, log));
    return { repository, log };
  }

  it("answers a non-owner or unknown request as null — 404 same shape", async () => {
    const { repository, log } = harness({ lock: [] });
    await expect(repository.decideGrant({ roomId: uuid(9), grantId: uuid(1), ownerId: uuid(3), action: "APPROVE", amount: "500.00", note: null, ledgerId: uuid(7), auditId: uuid(8), now: NOW })).resolves.toBeNull();
    // The one statement carries every authorization fact: owner join + room + request.
    const lock = log.queries.find(isDecisionLock) ?? "";
    expect(lock).toContain("o.role = 'OWNER'");
    expect(lock).toContain("JOIN room.rooms r");
  });

  it("approves in one transaction: ledger entry, balance, closure, audit", async () => {
    const { repository, log } = harness({
      lock: [lockRow()],
      projected: [grantRow({ status: "APPROVED", approvedAmount: "500.00", decidedAt: NOW })],
    });
    const result = await repository.decideGrant({ roomId: uuid(9), grantId: uuid(1), ownerId: uuid(3), action: "APPROVE", amount: "500.00", note: null, ledgerId: uuid(7), auditId: uuid(8), now: NOW });
    expect(result).toMatchObject({ replayed: false, request: { status: "APPROVED", approvedAmount: "500.00" } });
    const queries = log.queries;
    expect(queries.some((q) => q.includes("FROM ledger.point_accounts") && q.includes("FOR UPDATE"))).toBe(true);
    expect(queries.some((q) => q.includes("INSERT INTO ledger.entries") && q.includes("'OWNER_GRANT'"))).toBe(true);
    expect(queries.some((q) => q.includes("UPDATE ledger.point_accounts SET available_points = available_points +"))).toBe(true);
    expect(queries.some((q) => q.includes("UPDATE room.grant_requests SET status = 'APPROVED'"))).toBe(true);
    expect(queries.some((q) => q.includes("INSERT INTO room.audit_events") && q.includes("'GRANT_APPROVED'"))).toBe(true);
    // The ledger idempotency key is the request's natural key.
    expect(log.values).toContain(`owner-grant:${uuid(1)}`);
  });

  it("denies without touching the ledger or the account", async () => {
    const { repository, log } = harness({
      lock: [lockRow()],
      projected: [grantRow({ status: "DENIED", decidedAt: NOW, decisionNote: "本轮先不补" })],
    });
    const result = await repository.decideGrant({ roomId: uuid(9), grantId: uuid(1), ownerId: uuid(3), action: "DENY", amount: null, note: "本轮先不补", ledgerId: uuid(7), auditId: uuid(8), now: NOW });
    expect(result).toMatchObject({ replayed: false, request: { status: "DENIED" } });
    expect(log.queries.some((q) => q.includes("ledger."))).toBe(false);
    expect(log.queries.some((q) => q.includes("'GRANT_DENIED'"))).toBe(true);
  });

  it("replays an identical repeated approval and refuses a conflicting one", async () => {
    const decided = lockRow({ status: "APPROVED", approvedAmount: "500.00" });
    const replay = harness({ lock: [decided], projected: [grantRow({ status: "APPROVED", approvedAmount: "500.00", decidedAt: NOW })] });
    await expect(replay.repository.decideGrant({ roomId: uuid(9), grantId: uuid(1), ownerId: uuid(3), action: "APPROVE", amount: "500.00", note: null, ledgerId: uuid(7), auditId: uuid(8), now: NOW }))
      .resolves.toMatchObject({ replayed: true });
    expect(replay.log.queries.some((q) => q.includes("INSERT INTO ledger.entries"))).toBe(false);

    const conflict = harness({ lock: [decided] });
    await expect(conflict.repository.decideGrant({ roomId: uuid(9), grantId: uuid(1), ownerId: uuid(3), action: "APPROVE", amount: "800.00", note: null, ledgerId: uuid(7), auditId: uuid(8), now: NOW }))
      .rejects.toMatchObject({ code: "GRANT_ALREADY_DECIDED", status: 409 });
  });

  it("refuses deciding an OPEN request once the room is no longer active", async () => {
    const { repository } = harness({ lock: [lockRow({ roomStatus: "RESTRICTED" })] });
    await expect(repository.decideGrant({ roomId: uuid(9), grantId: uuid(1), ownerId: uuid(3), action: "DENY", amount: null, note: null, ledgerId: uuid(7), auditId: uuid(8), now: NOW }))
      .rejects.toMatchObject({ code: "ROOM_NOT_ACTIVE", status: 409 });
  });

  it("converges a raced double-approve on the stored outcome when the ledger key collides", async () => {
    const { repository } = harness({
      lock: [lockRow()],
      projected: [grantRow({ status: "APPROVED", approvedAmount: "500.00", decidedAt: NOW })],
      onLedgerInsert: () => { throw uniqueViolation(); },
    });
    await expect(repository.decideGrant({ roomId: uuid(9), grantId: uuid(1), ownerId: uuid(3), action: "APPROVE", amount: "500.00", note: null, ledgerId: uuid(7), auditId: uuid(8), now: NOW }))
      .resolves.toMatchObject({ replayed: true, request: { status: "APPROVED" } });
  });

  it("re-arbitrates the collision recovery: a divergent amount still answers 409, never the other outcome", async () => {
    const { repository } = harness({
      lock: [lockRow()],
      projected: [grantRow({ status: "APPROVED", approvedAmount: "500.00", decidedAt: NOW })],
      onLedgerInsert: () => { throw uniqueViolation(); },
    });
    await expect(repository.decideGrant({ roomId: uuid(9), grantId: uuid(1), ownerId: uuid(3), action: "APPROVE", amount: "800.00", note: null, ledgerId: uuid(7), auditId: uuid(8), now: NOW }))
      .rejects.toMatchObject({ code: "GRANT_ALREADY_DECIDED", status: 409 });
  });
});

describe("room grant repository — list", () => {
  it("redacts in SQL: a non-owner's query never selects other members' pending or denied rows", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createRoomGrantRepository(fakeSql((q) => {
      if (isMembership(q)) return [{ role: "MEMBER" }];
      if (isProjection(q)) return [grantRow({ status: "APPROVED", approvedAmount: "1000.00", decidedAt: NOW })];
      return [];
    }, log));
    const result = await repository.listGrants(uuid(9), uuid(2));
    expect(result).toMatchObject({ isOwner: false });
    const page = log.queries.find((q) => q.includes("ORDER BY (g.status = 'OPEN') DESC, g.requested_at DESC")) ?? "";
    expect(page).toContain("g.status = 'APPROVED' OR g.requester_user_id =");
    expect(log.values).toContain(false); // the isOwner flag rides the query, not JS post-filtering
  });

  it("hands the owner the full queue", async () => {
    const repository = createRoomGrantRepository(fakeSql((q) => {
      if (isMembership(q)) return [{ role: "OWNER" }];
      if (isProjection(q)) return [grantRow(), grantRow({ id: uuid(4), status: "DENIED", decidedAt: NOW })];
      return [];
    }));
    const result = await repository.listGrants(uuid(9), uuid(3));
    expect(result?.isOwner).toBe(true);
    expect(result?.requests).toHaveLength(2);
  });
});
