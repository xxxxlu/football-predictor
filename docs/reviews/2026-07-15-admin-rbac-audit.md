# Admin / RBAC Security Audit — 2026-07-15

**Scope:** Server-side permission isolation for the five identities `anonymous`,
`authenticated_user`, `room_member`, `room_owner`, `super_admin`. Focus on
whether denials are enforced by the server (API handler / domain service /
repository / SQL / DB constraint) and not merely hidden in the UI.

**Method:** Static reading of every path listed in the audit brief plus the
identity/rooms/operations domain and DB layers, cross-checked against
`_bmad-output/planning-artifacts/prd.md` (FR1–FR72, NFR14–NFR23, Identity &
Access Contract). One repository change was additionally verified read-only
against the live local Postgres.

**Evidence labels:** `Confirmed` (verified in code, and where noted at runtime),
`Inferred` (strongly implied by code but not executed), `Needs runtime
verification` (correct-by-reading, not exercised here).

---

## 1. Executive Summary

The server-side RBAC is **strong**. Every sensitive read and write is gated at
the domain or repository layer, not by hiding UI controls. The audit found:

- **No P0.** No privilege escalation, IDOR, auth bypass, role/`isSuperAdmin`
  mass-assignment, cross-room data access, missing same-origin on mutations, or
  pre-lock prediction-selection leak. (`Confirmed`)
- **One P1 defect (now fixed): fragmented audit trail.** The admin audit view
  (`GET /api/v1/admin/audit`) read only `ops.audit_events` and therefore did not
  surface **account disable/restore** or **invite resets** — the events were
  persisted in two other tables but invisible to the reviewer. FR60/FR54 and
  Journey 4 expect a reviewable trail. Fixed by consolidating all three audit
  stores behind the endpoint, with defensive secret redaction. Runtime-verified
  against the local DB (old = 4 rows, unified = 12). (`Confirmed`)
- **Admin capability gaps (P1, not implemented):** view **all** rooms (not just
  reported ones), user-governance detail, standalone "revoke all sessions", and
  FR58 idempotent retry of failed sync/settlement jobs. These are missing
  capabilities, not security holes; recommendations and a minimal landing plan
  are in §5. FR58 retry is a **blocker** pending safe worker wiring.
- **P2 items:** SUCCESS-only (no FAILURE) audit records; leaderboard exposes
  other members' available/frozen points pre-settlement; `submission-status`
  is owner-only where FR34 implies members may see pre-lock submission state;
  audit list has no pagination/filters.

The audit deliberately did **not** widen admin power. The admin remains unable
to modify points, delete predictions/ledger, read passwords/recovery codes/full
session tokens, read pre-lock selections, or disable/replace another super-admin
— all `Confirmed` server-side.

> **Concurrency note.** During this review the repository advanced from `bf219fb`
> to `bfeea0c`: a parallel agent **implemented** the previously design-only
> public/private rooms feature (migration `0012_room_visibility.sql`, routes
> `GET /api/v1/rooms/public` and `POST /api/v1/rooms/[roomId]/join`, plus rooms
> handler/service/repository changes). Those commits touched none of the files
> changed by this audit. The new code was **re-audited and passes** (§2.2, §3.1
> item 11): public discovery is auth-gated and minimal-disclosure, public-join
> rejects PRIVATE/non-ACTIVE rooms without revealing their existence, joins are
> idempotent, and all post-join content stays membership-gated. Verification
> (§8) was re-run against the combined tree.

---

## 2. Current Permission Matrix

Cells: `ALLOW` / `DENY` / `CONDITIONAL` / `NA` / `NOT_IMPL`. `anon` = anonymous,
`user` = authenticated non-member, `mem` = room member, `own` = room owner,
`adm` = super_admin. "Enforced by" names the authoritative layer(s).

### 2.1 Identity & account

| Operation | anon | user | mem | own | adm | Enforced by (Confirmed) |
|---|---|---|---|---|---|---|
| Register | ALLOW | NA | NA | NA | NA | domain `register` hardcodes `isSuperAdmin:false`; no role field in `registerSchema` — [service.ts:103](../../packages/domain/src/identity/service.ts), [handlers.ts:6](../../apps/web/src/app/api/v1/auth/_lib/handlers.ts) |
| Login | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | rate-limited 5/15min per account+source — [service.ts:112](../../packages/domain/src/identity/service.ts) |
| Recover account | ALLOW | ALLOW | — | — | ALLOW | username+recovery code; rotates code + revokes all sessions — [service.ts:192](../../packages/domain/src/identity/service.ts) |
| Change own password | DENY(401) | ALLOW | ALLOW | ALLOW | ALLOW | session required + current-pw verify; revokes prior sessions — [service.ts:136](../../packages/domain/src/identity/service.ts) |
| View/edit own nickname | DENY(401) | ALLOW | ALLOW | ALLOW | ALLOW | keyed on session `userId` — [operations/repository.ts:120](../../packages/db/src/operations/repository.ts) |
| Delete own account | DENY(401) | CONDITIONAL | CONDITIONAL | CONDITIONAL | **DENY(403)** | requires `confirmation:"DELETE"`; **refuses super-admin** — [moderation-privacy.ts:71](../../packages/db/src/operations/moderation-privacy.ts) |

### 2.2 Rooms lifecycle

| Operation | anon | user | mem | own | adm | Enforced by |
|---|---|---|---|---|---|---|
| Create PRIVATE room | DENY(401) | ALLOW | ALLOW | ALLOW | ALLOW | handler auth + domain `create` → creator = `OWNER`; private room gets an invite token | [rooms/_lib/handlers.ts:31](../../apps/web/src/app/api/v1/rooms/_lib/handlers.ts), [rooms/service.ts:56](../../packages/domain/src/rooms/service.ts) |
| Create PUBLIC room | DENY(401) | ALLOW | ALLOW | ALLOW | ALLOW | `visibility` is a validated `z.enum` user choice; PUBLIC gets `inviteTokenHash=NULL`, no token returned; `visibility` immutable afterward — [rooms/service.ts:56](../../packages/domain/src/rooms/service.ts) |
| Browse public lobby | DENY(401) | ALLOW(minimal) | ALLOW(minimal) | ALLOW(minimal) | ALLOW(minimal) | auth required; returns only `{id,name,ownerName,memberCount,joined}` for PUBLIC+ACTIVE; PRIVATE excluded — [rooms/repository.ts:50](../../packages/db/src/rooms/repository.ts) |
| Join public room by id | DENY(401) | CONDITIONAL | CONDITIONAL(idempotent) | — | CONDITIONAL(if joins) | locks `visibility='PUBLIC' AND status='ACTIVE'`; PRIVATE/closed → `ROOM_NOT_JOINABLE` (no existence leak); single grant — [rooms/repository.ts:66](../../packages/db/src/rooms/repository.ts) |
| Join private via invite | DENY(401) | CONDITIONAL | CONDITIONAL(idempotent) | — | CONDITIONAL | valid invite + rules; `visibility='PRIVATE' AND status='ACTIVE'`; `ON CONFLICT DO NOTHING` (no double grant) — [rooms/repository.ts:41](../../packages/db/src/rooms/repository.ts) |
| Reset invite | DENY(401) | DENY(404) | DENY(404) | **ALLOW (own PRIVATE only)** | DENY(404) | SQL join requires `role='OWNER'` + `visibility='PRIVATE'` on that room — [rooms/repository.ts:23](../../packages/db/src/rooms/repository.ts) |

### 2.3 Room data reads (member-scoped)

| Operation | anon | user | mem | own | adm(non-member) | Enforced by |
|---|---|---|---|---|---|---|
| Room detail | DENY(401) | DENY(404) | ALLOW | ALLOW | **DENY(404)** | `getRoomForMember` requires membership — [rooms/repository.ts:66](../../packages/db/src/rooms/repository.ts) |
| Members list | DENY(401) | DENY(404) | ALLOW | ALLOW | **DENY(404)** | `listMembers` authorizes caller membership first — [rooms/repository.ts:81](../../packages/db/src/rooms/repository.ts) |
| Own balance | DENY(401) | DENY(404) | ALLOW | ALLOW | **DENY(404)** | `getBalance` joined on `room.members` — [rooms/repository.ts:74](../../packages/db/src/rooms/repository.ts) |
| Ledger | DENY(401) | DENY(404) | ALLOW(own entries) | ALLOW | **DENY(404)** | `assertMember` then filters `user_id` — [operations/repository.ts:189](../../packages/db/src/operations/repository.ts) |
| Leaderboard | DENY(401) | DENY(404) | ALLOW | ALLOW | **DENY(404)** | `assertMember` — [operations/repository.ts:204](../../packages/db/src/operations/repository.ts) |
| Ticket history | DENY(401) | DENY(404) | ALLOW(redacted) | ALLOW(redacted) | **DENY(404)** | `assertMember` + `redactTicketHistory` — [operations/repository.ts:176](../../packages/db/src/operations/repository.ts) |
| Submission status (who submitted) | DENY(401) | DENY(404) | **DENY(403)** | ALLOW(own room) | DENY(404) | `assertMember(…, ownerOnly=true)` — [operations/repository.ts:158](../../packages/db/src/operations/repository.ts) — **see F8** |

`adm(non-member)` is **DENY** everywhere above: there is no `isSuperAdmin`
bypass branch in any room read — a super-admin who is not a member is treated
exactly like any non-member (`Confirmed`; satisfies audit check #6, FR54, NFR19).

### 2.4 Predictions & privacy

| Operation | anon | user | mem | own | adm | Enforced by |
|---|---|---|---|---|---|---|
| Submit prediction | DENY(401) | DENY(404) | CONDITIONAL | CONDITIONAL | CONDITIONAL(if member) | locks `point_accounts` by `(room,user)` → `ROOM_NOT_FOUND` for non-members; `roomAllowsPredictions` blocks RESTRICTED/CLOSED; market lock server-authoritative — [predictions/repository.ts:27](../../packages/db/src/predictions/repository.ts), [tickets/handler.ts:18](../../apps/web/src/app/api/v1/rooms/[roomId]/tickets/handler.ts) |
| See *who* submitted | — | — | (owner only, F8) | ALLOW | DENY(non-member) | boolean `submitted` only; no selection — [operations/repository.ts:158](../../packages/db/src/operations/repository.ts) |
| See others' **pre-lock** selection/stake | DENY | DENY | **DENY** | **DENY** | **DENY** | `redactTicketHistory`: reveal only if `isCurrentUser` OR `now>=kickoff` OR match not `SCHEDULED` — [operations/repository.ts:60](../../packages/db/src/operations/repository.ts) |
| See others' **post-lock** selection | — | — | ALLOW | ALLOW | ALLOW(if member) | same function, post-kickoff branch |
| Report a room | DENY(401) | DENY(404) | ALLOW(own, non-CLOSED) | ALLOW | ALLOW(if member) | SQL requires reporter ∈ members — [moderation-privacy.ts:19](../../packages/db/src/operations/moderation-privacy.ts) |
| Browse matches | DENY(401) | ALLOW | ALLOW | ALLOW | ALLOW | `authorizeMatchRead` requires session; room-scoped reads require membership — [matches/access.ts:4](../../apps/web/src/app/api/v1/matches/access.ts) |

### 2.5 Admin — user governance

| Operation | anon | user | mem/own | adm | Enforced by |
|---|---|---|---|---|---|
| List normal users | DENY(401) | DENY(403) | DENY(403) | ALLOW | `requireReadySuperAdmin` (isSuperAdmin + !mustChangePassword) — [service.ts:160,180](../../packages/domain/src/identity/service.ts) |
| Disable / restore user | DENY(401) | DENY(403) | DENY(403) | CONDITIONAL | `authorizeSuperAdminAction` (super-admin **+ session-bound reauth proof ≤5min**) + SQL `is_super_admin=false` on target — [service.ts:165,172](../../packages/domain/src/identity/service.ts), [identity/repository.ts:103](../../packages/db/src/identity/repository.ts) |
| Disable/replace **another super-admin** | DENY | DENY | DENY | **DENY** | target predicate `is_super_admin=false`; `delete` refuses super-admin — [identity/repository.ts:108](../../packages/db/src/identity/repository.ts), [moderation-privacy.ts:78](../../packages/db/src/operations/moderation-privacy.ts) |
| Create a 3rd super-admin | DENY | DENY | DENY | DENY | seed asserts exactly the 2 configured accounts; register cannot set the flag — [seed-super-admins.mjs:38](../../packages/db/scripts/seed-super-admins.mjs) |
| Standalone "revoke all sessions" | — | — | — | **NOT_IMPL** | sessions revoked only as a side-effect of disable — F5 |
| Read password / recovery / full session token | DENY | DENY | DENY | **DENY** | read paths never select these columns anywhere |

### 2.6 Admin — room governance

| Operation | anon | user | mem/own | adm | Enforced by |
|---|---|---|---|---|---|
| View reports | DENY(401) | DENY(403) | DENY(403) | ALLOW | `assertSuperAdmin` — [moderation-privacy.ts:36,90](../../packages/db/src/operations/moderation-privacy.ts) |
| Restrict / close / restore room | DENY(401) | DENY(403) | DENY(403) | CONDITIONAL(reauth + reason) | `authorizeSuperAdminAction` + inline `is_super_admin` recheck in tx — [moderation-handlers.ts:36](../../apps/web/src/app/api/v1/_lib/moderation-handlers.ts), [moderation-privacy.ts:55](../../packages/db/src/operations/moderation-privacy.ts) |
| View **all** rooms (governance list) | — | — | — | **NOT_IMPL** | only *reported* rooms are listable — F3 |
| Read private-room member/points/predictions via admin | DENY | DENY | DENY | **DENY** | `moderateRoom` touches only room status + report resolution; no content read — [moderation-privacy.ts:55](../../packages/db/src/operations/moderation-privacy.ts) |

### 2.7 Admin — system operations

| Operation | anon | user | mem/own | adm | Enforced by |
|---|---|---|---|---|---|
| View supplier budget / cache / settlement / jobs | DENY(401) | DENY(403) | DENY(403) | ALLOW | `adminStatus` gates on `is_super_admin` — [operations/repository.ts:214](../../packages/db/src/operations/repository.ts) |
| View unified audit trail | DENY(401) | DENY(403) | DENY(403) | ALLOW | `assertSuperAdmin` + consolidated `listAudit` (this change) — [moderation-privacy.ts](../../packages/db/src/operations/moderation-privacy.ts) |
| Retry failed sync/settlement job (FR58) | — | — | — | **NOT_IMPL** | no retry route; `ops.jobs` supports it — F6 (blocker) |
| Modify points / delete prediction / delete ledger (FR59) | DENY | DENY | DENY | **DENY (by design)** | no endpoint exists in any layer |

---

## 3. Confirmed Findings

Security-relevant behaviors verified in code (and, where noted, at runtime).

### 3.1 Controls that pass (no action)

1. **Admin endpoints are server-gated, not UI-gated.** `/admin/*` pages are
   client shells; every backing API independently enforces `is_super_admin`
   (`requireReadySuperAdmin`, `assertSuperAdmin`, `adminStatus` check). A normal
   user who navigates to `/admin/users` receives 403 JSON. (`Confirmed`)
2. **Reauth proof** is session-bound and expires in 5 minutes: `verifyReauthProof`
   requires matching `userId` + `sessionTokenHash` + `expiresAt>now` + live
   session; cross-session or expired proofs are rejected. Required on every admin
   write and same-origin enforced. Cookie is `SameSite=Strict; Path=/api/v1/admin`.
   ([identity/repository.ts:95](../../packages/db/src/identity/repository.ts),
   [auth/_lib/handlers.ts:113](../../apps/web/src/app/api/v1/auth/_lib/handlers.ts)) (`Confirmed`)
3. **No role/`isSuperAdmin`/`visibility` mass-assignment.** Zod schemas are
   `.strict()` where relevant; `register` cannot set the admin flag; room
   creation always makes the creator `OWNER`. (`Confirmed`)
4. **No IDOR / no cross-room access.** All room reads require membership; a
   forged `roomId` yields `ROOM_NOT_FOUND`. Prediction submission locks the
   `(room,user)` point account, so a non-member cannot submit. (`Confirmed`)
5. **Super-admin does not auto-bypass private rooms.** No room read branches on
   `is_super_admin`. (`Confirmed`; audit check #6, #10)
6. **Cannot disable/delete/replace another super-admin; cannot mint a third.**
   (`Confirmed`; audit checks #7, #8)
7. **Disabled account = immediate lockout.** `findActiveSession` inner-joins
   `identity.users.status='ACTIVE'`, so a disabled user's existing sessions stop
   authenticating instantly; disable also revokes sessions in the same tx.
   ([identity/repository.ts:58,111](../../packages/db/src/identity/repository.ts)) (`Confirmed`; check #9)
8. **Pre-lock prediction privacy.** Others' selection/stake are withheld until
   kickoff via `redactTicketHistory`. (`Confirmed`; check #12)
9. **Super-admin 30-min idle timeout, login/recovery rate-limit, argon2id
   password hashing, one-time hashed recovery code.** (`Confirmed`)
10. **Private rooms do not leak existence.** Invalid/expired invites and
    non-membership return generic `INVITE_INVALID`/`ROOM_NOT_FOUND`; a PRIVATE
    room is excluded from the public lobby and cannot be joined through the
    public-join route (`ROOM_NOT_JOINABLE`). (`Confirmed`; check #11)
11. **Public rooms are discoverable but content stays gated.** The lobby
    (`GET /api/v1/rooms/public`) requires a session and returns only name, owner
    display name, member count and a `joined` flag — never members, points,
    ledger or predictions. `joinPublicRoom` accepts only `PUBLIC + ACTIVE`
    rooms, requires rule acceptance, and is idempotent (single 10,000-point
    grant). After joining, all detail reads remain membership-gated exactly as
    for private rooms; `visibility` has no mutation path.
    ([rooms/repository.ts:50,66](../../packages/db/src/rooms/repository.ts),
    [rooms/service.ts:107](../../packages/domain/src/rooms/service.ts))
    (`Confirmed`; checks #10, #11)

### 3.2 Defects

- **F1 — Audit trail fragmentation (P1, fixed).** `listAudit` read only
  `ops.audit_events`; **account disable/restore** live in
  `identity.admin_account_audit_events` and **invite reset / room create / join**
  in `room.audit_events`, so the single most sensitive action (disabling a user)
  was **not reviewable** in the admin audit view. FR60 requires these to be
  audited *and* Journey 4 expects the admin to confirm actions "通过日志". Runtime
  check on the local DB: the old ops-only query returned **4** rows; the unified
  query returns **12** (adding 8 room events incl. `INVITE_RESET`). (`Confirmed`)
- **F2 — Audit metadata returned raw (P2 hardening, fixed).** `metadata` was
  returned verbatim. Although no current writer stores secrets there, audit
  check #14 / NFR41 require the response never to surface tokens/recovery
  codes/invite secrets. Now redacted defensively at all depths. (`Confirmed`)
- **F7 — SUCCESS-only audit records (P2).** Audit rows are written only on the
  success path inside the transaction; denied attempts (FORBIDDEN,
  TARGET_NOT_MANAGEABLE, reauth failures) write nothing. FR60 / audit brief
  §D want SUCCESS **or** FAILURE. (`Confirmed`)
- **F8 — `submission-status` is owner-only (P2, functional).** FR34 says
  pre-lock "其他成员只能看到提交状态" (other members see submission status).
  Today only the owner can read it (`ownerOnly=true`). This is *more*
  restrictive than spec — not a security risk, but a PRD/code divergence.
  (`Confirmed`)
- **F9 — Leaderboard exposes members' available/frozen points (P2, info).**
  `projectLeaderboard` returns every member's `availablePoints`/`frozenPoints`.
  Pre-settlement, a non-zero `frozenPoints` reveals that a member has an open
  prediction and the total stake ("投入"), which FR34 restricts to post-lock. It
  does **not** reveal the selection or the match. (`Confirmed`)

---

## 4. PRD vs Code Gaps

| PRD | Expectation | Code today | Verdict |
|---|---|---|---|
| FR54 / FR60 | Admin can review status + reports + related audit | Audit view omitted account-status and invite events | **Gap — fixed (F1)** (`Confirmed`) |
| FR54 §B (brief) | Admin can view **all** rooms with status/owner/counts | Only *reported* rooms listable | **Gap (F3)** — NOT_IMPL (`Confirmed`) |
| FR54 §A (brief) | User governance detail (created/last login/room count/security summary) | List returns only `{id,username,status}` | **Gap (F4)** — NOT_IMPL (`Confirmed`) |
| FR57 / FR58 | View job/settlement failures **and safely retry** with original idempotency scope | View exists (`adminStatus`); **retry does not** | **Gap (F6)** — NOT_IMPL / blocker (`Confirmed`) |
| FR34 | Pre-lock: other members see submission status | Owner-only | **Gap (F8)** (`Confirmed`) |
| FR55 | Disable/restore user (implies session revocation control) | Works; no *standalone* revoke | **Gap (F5)** — NOT_IMPL (`Confirmed`) |
| Public/private rooms | Registered users create PUBLIC/PRIVATE rooms; public lobby discoverable + directly joinable; private via invite | **Implemented** at `bfeea0c` (concurrent commit) and re-audited clean | **Aligned** (`Confirmed`) — see §3.1 item 11 |
| FR59 | Admin cannot override points / delete prediction / ledger | No such endpoint | **Aligned** (`Confirmed`) |

---

## 5. P0 / P1 / P2 Recommendations

**P0 — none.**

**P1**

- **R1 (done) — Consolidate the admin audit view** across the three audit
  stores with secret redaction (F1, F2). Implemented; see §6.
- **R2 — Admin "all rooms" governance list (F3).** New read
  `PostgresModerationPrivacyRepository.listRooms(adminUserId, filters)` gated by
  `assertSuperAdmin`, returning metadata only: `roomId, name, visibility(when
  added), status, ownerDisplayName, memberCount, openReportCount, createdAt`.
  Filter by status / owner / name. **Must not** return members, points, ledger,
  or predictions (keep the private-room minimal-disclosure invariant). Add
  `GET /api/v1/admin/rooms`. Pure projection + handler-authz are unit-testable;
  the SQL needs runtime verification against the local DB (as done for R1).
- **R3 — User-governance detail (F4).** Extend the list/《detail》read with
  `createdAt`, `lastSeenAt` (from `sessions.last_seen_at`), room count, and a
  recent security-event **summary** (counts/kinds from
  `identity.security_events`, never raw source keys). Never expose password /
  recovery / session-token material.
- **R4 — Standalone "revoke all sessions" (F5).** Domain
  `revokeAccountSessions({actorSessionToken, proofToken, targetUserId})` reusing
  `authorizeSuperAdminAction`, revoking the target's live sessions **without**
  changing account status, and writing a `SESSIONS_REVOKED` audit row. Refuse
  super-admin targets (mirror `setNormalAccountStatus`).
- **R5 (blocker) — FR58 safe retry of failed sync/settlement jobs.** The
  `ops.jobs` model already supports idempotent re-claim by `job_key` with a
  preserved payload ([jobs.ts:66](../../packages/db/src/operations/jobs.ts)).
  **Minimal safe landing:** an admin endpoint (reauth + audit) that flips a
  **FAILED** `ops.jobs` row to `QUEUED` with `available_at=now`, **without
  touching `payload`, `attempt` scope, odds, results, or settlement version**;
  the existing worker then re-claims and re-runs it idempotently. It must not be
  possible to retry a non-FAILED job or edit its inputs. **Why blocker:** the
  actual re-execution happens in `apps/worker`, which cannot be exercised
  end-to-end in this review without a running worker + DB; shipping a "retry"
  that only re-queues without verified worker pickup would risk a false sense of
  success. Recommend implementing behind a domain port with a fake in unit tests
  **and** a worker integration test before enabling. (`Needs runtime verification`)

**P2**

- **R6 — FAILURE audit records (F7).** Emit a `result='FAILURE'` audit row on
  denied/failed admin writes (own transaction or best-effort append) so every
  attempt is non-repudiable. Requires widening the
  `admin_account_audit_events.result` CHECK (currently `'SUCCESS'` only) — a
  migration.
- **R7 — Leaderboard disclosure (F9).** Consider returning only the viewer's own
  `available/frozen` detail and net rank for others, or defer frozen exposure
  until settlement, to honor FR34's post-lock stake rule. (Judgement call — may
  be intended for a points ledger; flagged, not changed.)
- **R8 — Submission-status for members (F8).** If FR34 is authoritative, allow
  members (not only owner) to read the boolean submission list (never
  selections) pre-lock.
- **R9 — Audit pagination/filters (brief §D).** Add cursor/time-range/actor/
  action/targetType/result filters to the (now unified) audit endpoint.

Recommendations intentionally **exclude** any ability to modify points, delete
ledger/predictions, read secrets, read pre-lock selections, or manage another
super-admin — consistent with FR59 and the brief's "do not build an omnipotent
admin" constraint.

---

## 6. Implemented Changes

TDD (failing test → implementation → green), then full workspace verification.

**Production code**

- [`packages/db/src/operations/moderation-privacy.ts`](../../packages/db/src/operations/moderation-privacy.ts)
  - `listAudit` now `UNION ALL`s the three governance audit stores
    (`ops.audit_events` + `identity.admin_account_audit_events` +
    `room.audit_events`), resolves the actor display name, orders by time, and
    normalizes+redacts each row. Still gated by `assertSuperAdmin`.
  - New pure, exported helpers: `redactAuditMetadata` (recursively replaces any
    secret-like key — token/password/secret/recovery/invite/proof/hash/
    credential/otp/apikey — with `[REDACTED]`) and `normalizeAuditEvent` (maps a
    merged row to the stable API shape). Output shape unchanged for the existing
    frontend consumer.

**Tests**

- [`packages/db/src/operations/moderation-privacy.test.ts`](../../packages/db/src/operations/moderation-privacy.test.ts)
  — +3: metadata redaction at depth, non-object metadata tolerance, and
  cross-source normalization.
- [`packages/domain/src/identity/service.test.ts`](../../packages/domain/src/identity/service.test.ts)
  — +4 RBAC regression guards: normal user → `FORBIDDEN` on every super-admin
  capability; anonymous/unknown session → `UNAUTHENTICATED`; registration never
  mints a super-admin; a ready super-admin reads only the normal-account roster.
- [`apps/web/src/app/api/v1/admin/users/handlers.test.ts`](../../apps/web/src/app/api/v1/admin/users/handlers.test.ts)
  — +3 HTTP-boundary guards: no session → 401 (service untouched); server-side
  `FORBIDDEN` → 403; status write without reauth proof → 403 (service untouched).

**Docs**

- [`_bmad-output/planning-artifacts/prd.md`](../../_bmad-output/planning-artifacts/prd.md)
  — FR60 clarified: audit lives across multiple stores and the super-admin audit
  view must present a single time-ordered, secret-redacted trail.
- [`README.md`](../../README.md) — new "Access control and admin governance"
  section summarizing the server-enforced model and the consolidated audit view.
- This report (`docs/reviews/2026-07-15-admin-rbac-audit.md`).

**Not changed on purpose:** no widening of admin power; F3/F4/F5/F6/F7/R7/R8/R9
are recommendations (§5), several requiring migrations or worker wiring.

**Database migrations:** none in this change. (R5 and R6 would each require one;
not included.)

---

## 7. Remaining Risks

- **F6 / FR58 retry** remains unimplemented — a real operational capability gap
  (a stuck settlement cannot be safely retried from the product). Tracked as a
  blocker with the minimal plan in R5. (`Confirmed` gap)
- **F3/F4/F5** capability gaps remain; admins can govern reported rooms and
  disable users but lack a full room roster, user detail, and standalone session
  revocation. (`Confirmed`)
- **F7/F9/F8** P2 items remain (no failure-audit rows; leaderboard stake
  exposure; owner-only submission status).
- **SQL coverage:** the repository SQL layer is not unit-tested anywhere in the
  project (only pure functions are). The unified `listAudit` query was verified
  read-only against the live local Postgres for this review; CI does not
  exercise it. (`Needs runtime verification` in CI)
- **Public/PRIVATE rooms & full World Cup history** are design/plan documents
  only; when built they must preserve every invariant in §2.3–§2.6 (membership
  gating, no admin content bypass, minimal public disclosure).

---

## 8. Verification Evidence

Commands run at HEAD with the changes applied (working tree = 4 files; see §6):

| Command | Result |
|---|---|
| `pnpm typecheck` | **pass** — all packages/apps `Done` |
| `pnpm lint` | **pass** — no errors (Node 25-vs-24 engine warning only) |
| `pnpm test` | **pass — 61 files (~273–274 tests)**. This audit adds exactly **10** tests (moderation-privacy +3, identity service +4, admin handlers +3); the total fluctuates only because a parallel agent is concurrently editing `apps/web/src/app/api/v1/matches/runtime{,.test}.ts` (outside this audit). Every run observed was green. |
| `pnpm build` | **pass (exit 0)** after removing broken self-referential `node_modules/node_modules` symlinks — a pnpm workspace artifact, outside the diff (`node_modules` is gitignored) |
| `git diff --check` | clean (no whitespace errors) |
| `git status --short` | this audit owns 6 tracked files (`moderation-privacy.ts`, `service.test.ts`, `handlers.test.ts`, `moderation-privacy.test.ts`, `prd.md`, `README.md`) + untracked `docs/reviews/`. Any `matches/runtime{,.test}.ts` entries are a parallel agent's WIP, **not** part of this audit |
| Live-DB read-only check of unified `listAudit` SQL | **pass** — old ops-only = 4 rows, unified = 12; surfaced `ROOM:INVITE_RESET`, `ROOM:ROOM_CREATED/JOINED/REPORTED`, `USER:ACCOUNT_ANONYMIZED` |

All commands were re-run against the combined tree after the concurrent
public-rooms commits landed (HEAD `bfeea0c`); the audit's changes and the
public-rooms changes coexist with zero failures.

**Conclusion labels:** §3.1 controls, F1, F2, F7, F8, F9 and the §4 gaps are
`Confirmed`. R5/FR58 end-to-end retry and CI-level SQL coverage are `Needs
runtime verification`. No claims in this report rest on `Inferred`-only
evidence.

**Not performed (per instructions):** no deploy, no push, no secret disclosure
(the DB URL was read but never printed), no destructive DB mutation.
