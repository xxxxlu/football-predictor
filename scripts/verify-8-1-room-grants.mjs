#!/usr/bin/env node
/**
 * One-shot real-database verification for Story 8.1 (room grants).
 *
 * Runs against a LOCAL throwaway PostgreSQL only — never the production
 * database in .env. Bring one up first, then run with the workspace built
 * (`pnpm build:packages`) because the checks drive the REAL repository code:
 *
 *   POSTGRES_PORT=55432 docker compose up -d postgres
 *   DATABASE_URL=postgres://pulse:pulse@localhost:55432/pulse \
 *     node scripts/verify-8-1-room-grants.mjs
 *
 * Verifies what fake-sql structurally cannot:
 *   1. all migrations through 0032 apply, and 0032 replays idempotently;
 *   2. the composite FK refuses non-member requests; the partial unique index
 *      converges concurrent duplicate requests THROUGH the repository
 *      (exercising the outside-the-transaction 23505 recovery — a failed
 *      statement aborts its transaction, 25P02);
 *   3. concurrent double-approve through the repository yields exactly one
 *      OWNER_GRANT ledger row, one balance increase, one replay;
 *   4. the closure CHECKs refuse inconsistent decision rows;
 *   5. leaderboard parity: with zero owner grants the grant-sum ranking equals
 *      the old hardcoded (available - debt - 10000); an owner grant moves the
 *      balance but not the net points (FR45).
 */
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// The workspace root has no direct `postgres` dependency; resolve it through
// @pulse/db, whose runtime client this script drives anyway.
const postgres = createRequire(new URL("../packages/db/package.json", import.meta.url))("postgres");

const url = process.env.DATABASE_URL;
if (!url || !/localhost|127\.0\.0\.1/.test(url)) {
  console.error("Refusing to run: DATABASE_URL must point at a local throwaway database.");
  process.exit(1);
}

const { createRoomGrantRepository } = await import(new URL("../packages/db/dist/index.js", import.meta.url));

const sql = postgres(url, { max: 6, onnotice: () => {} });
let passed = 0;
const ok = (label) => { passed += 1; console.log(`  [${String(passed).padStart(2, "0")}] ${label}`); };
const fail = (label, detail) => { console.error(`FAILED: ${label}`, detail ?? ""); process.exitCode = 1; };

async function expectRejects(label, run, codes) {
  try { await run(); fail(label, "expected a constraint violation, none was raised"); }
  catch (error) {
    if (codes.includes(error.code)) ok(label);
    else fail(label, error);
  }
}

try {
  // 1. Migrations.
  const dir = new URL("../packages/db/migrations/", import.meta.url);
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) await sql.unsafe(await readFile(new URL(file, dir), "utf8"));
  ok(`all ${files.length} migrations applied in order`);
  await sql.unsafe(await readFile(new URL("0032_room_grants.sql", dir), "utf8"));
  ok("0032 replays idempotently");

  // Seed: one room, one owner, one member, both with accounts + initial grants.
  const owner = randomUUID(), member = randomUUID(), room = randomUUID();
  const now = new Date().toISOString();
  for (const [id, name] of [[owner, `owner_${id8(owner)}`], [member, `member_${id8(member)}`]]) {
    await sql`INSERT INTO identity.users (id, username_canonical, password_hash, recovery_code_hash)
      VALUES (${id}, ${name}, 'x', 'x')`;
  }
  await sql`INSERT INTO room.rooms (id, name, status, visibility, created_by, created_at, updated_at)
    VALUES (${room}, 'verify-8-1', 'ACTIVE', 'PRIVATE', ${owner}, ${now}::timestamptz, ${now}::timestamptz)`;
  for (const id of [owner, member]) {
    await sql`INSERT INTO room.members (room_id, user_id, role, accepted_rules_version, accepted_rules_at, joined_at)
      VALUES (${room}, ${id}, ${id === owner ? "OWNER" : "MEMBER"}, 'v1', ${now}::timestamptz, ${now}::timestamptz)`;
    await sql`INSERT INTO ledger.point_accounts (room_id, user_id, available_points, created_at, updated_at)
      VALUES (${room}, ${id}, '10000.00', ${now}::timestamptz, ${now}::timestamptz)`;
    await sql`INSERT INTO ledger.entries (id, room_id, user_id, kind, amount, available_delta_points, idempotency_key, audit_id, created_at)
      VALUES (${randomUUID()}, ${room}, ${id}, 'INITIAL_GRANT', '10000.00', '10000.00', ${`initial-grant:${room}:${id}`}, ${randomUUID()}, ${now}::timestamptz)`;
  }
  ok("seeded room, owner, member, accounts and initial grants");

  const repository = createRoomGrantRepository(sql);

  // 2. Authorization shapes + concurrent duplicate requests via the repository.
  if (await repository.requestGrant({ id: randomUUID(), roomId: room, requesterUserId: randomUUID(), note: null, now: new Date() }) === null) {
    ok("repository answers a non-member request as null (404 same shape)");
  } else fail("non-member request should be null");

  const raceRequests = await Promise.all([0, 1].map(() =>
    repository.requestGrant({ id: randomUUID(), roomId: room, requesterUserId: member, note: "需要补分", now: new Date() })));
  const createdFlags = raceRequests.map((r) => r?.created).sort();
  const requestIds = new Set(raceRequests.map((r) => r?.request.id));
  if (createdFlags.join(",") === "false,true" && requestIds.size === 1) {
    ok("concurrent duplicate requests converge on one OPEN row through the repository (25P02-safe recovery)");
  } else fail("concurrent duplicate requests", { createdFlags, requestIds: [...requestIds] });
  const requestId = [...requestIds][0];

  if (await repository.listGrants(room, randomUUID()) === null) ok("repository answers a non-member list as null");
  else fail("non-member list should be null");
  const memberView = await repository.listGrants(room, member);
  if (!memberView.isOwner && memberView.requests.some((row) => row.id === requestId)) ok("member sees their own OPEN request");
  else fail("member list", memberView);

  // 3. Closure CHECKs (raw SQL — unrepresentable states must be refused by the database itself).
  await expectRejects("composite FK refuses a request from a non-member at the database layer", async () => {
    await sql`INSERT INTO room.grant_requests (id, room_id, requester_user_id, status, requested_at)
      VALUES (${randomUUID()}, ${room}, ${randomUUID()}, 'OPEN', ${now}::timestamptz)`;
  }, ["23503"]);
  await expectRejects("closure CHECK refuses APPROVED without a ledger row", async () => {
    await sql`UPDATE room.grant_requests SET status = 'APPROVED', decided_by = ${owner}, decided_at = ${now}::timestamptz, approved_amount = '500.00'
      WHERE id = ${requestId}`;
  }, ["23514"]);
  await expectRejects("amount CHECK refuses fractional grants", async () => {
    await sql`UPDATE room.grant_requests SET approved_amount = '500.50' WHERE id = ${requestId}`;
  }, ["23514"]);

  // 4. Concurrent double-approve through the repository.
  const nonOwnerDecision = await repository.decideGrant({ roomId: room, grantId: requestId, ownerId: member, action: "APPROVE", amount: "2500.00", note: null, ledgerId: randomUUID(), auditId: randomUUID(), now: new Date() });
  if (nonOwnerDecision === null) ok("repository answers a non-owner decision as null (404 same shape)");
  else fail("non-owner decision should be null");

  const raceDecisions = await Promise.all([0, 1].map(() =>
    repository.decideGrant({ roomId: room, grantId: requestId, ownerId: owner, action: "APPROVE", amount: "2500.00", note: null, ledgerId: randomUUID(), auditId: randomUUID(), now: new Date() })));
  const replayFlags = raceDecisions.map((r) => r?.replayed).sort();
  const [{ count: grantRows }] = await sql`SELECT COUNT(*)::int AS count FROM ledger.entries WHERE idempotency_key = ${`owner-grant:${requestId}`}`;
  const [{ available }] = await sql`SELECT available_points::text AS available FROM ledger.point_accounts WHERE room_id = ${room} AND user_id = ${member}`;
  if (replayFlags.join(",") === "false,true" && grantRows === 1 && available === "12500.00") {
    ok("concurrent double-approve converged: one OWNER_GRANT row, one replay, balance 12500.00");
  } else fail("concurrent double-approve", { replayFlags, grantRows, available });

  const conflicting = await repository.decideGrant({ roomId: room, grantId: requestId, ownerId: owner, action: "DENY", amount: null, note: null, ledgerId: randomUUID(), auditId: randomUUID(), now: new Date() }).catch((error) => error);
  if (conflicting?.code === "GRANT_ALREADY_DECIDED") ok("conflicting later decision refused with GRANT_ALREADY_DECIDED");
  else fail("conflicting decision", conflicting);

  const [{ count: auditRows }] = await sql`SELECT COUNT(*)::int AS count FROM room.audit_events WHERE room_id = ${room} AND action = 'GRANT_APPROVED'`;
  if (auditRows === 1) ok("exactly one GRANT_APPROVED audit event");
  else fail("audit events", { auditRows });

  // 5. Leaderboard parity and FR45.
  const grantSum = (alias) => `COALESCE((SELECT SUM(e.amount) FROM ledger.entries e WHERE e.room_id=${alias}.room_id AND e.user_id=${alias}.user_id AND e.kind IN ('INITIAL_GRANT','OWNER_GRANT')),0)`;
  const rows = await sql.unsafe(`SELECT a.user_id,
      (a.available_points - a.correction_debt - ${grantSum("a")})::text AS net_new,
      (a.available_points - a.correction_debt - 10000)::text AS net_old,
      ${grantSum("a")}::text AS granted
    FROM ledger.point_accounts a WHERE a.room_id = '${room}' ORDER BY a.user_id`);
  const ownerRow = rows.find((r) => r.user_id === owner);
  const memberRow = rows.find((r) => r.user_id === member);
  if (ownerRow.net_new === ownerRow.net_old && Number(ownerRow.granted) === 10000) ok("zero-owner-grant account: new net equals old hardcoded net");
  else fail("leaderboard parity (owner)", ownerRow);
  if (Number(memberRow.net_new) === 0 && Number(memberRow.net_old) === 2500 && Number(memberRow.granted) === 12500) ok("granted member: balance moved, net points did not (FR45)");
  else fail("leaderboard FR45 (member)", memberRow);

  console.log(process.exitCode ? "\nRESULT: FAILURES ABOVE" : `\nRESULT: all ${passed} checks passed`);
} finally {
  await sql.end();
}

function id8(value) { return value.slice(0, 8); }
