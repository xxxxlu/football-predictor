# Room Ticket Visibility Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在房间详情中展示成员投入记录，并用“平台超管控制未开赛投入可见、房主控制开赛后完整记录可见”的两个独立开关执行服务端隐私脱敏。

**Architecture:** 在 `room.rooms` 上增加两个带安全默认值的布尔列，由房间查询一并返回。历史票据接口在数据库仓储层根据本人/开赛阶段/开关计算 `REVEALED`、`STAKE_ONLY`、`PRIVATE`，前端只渲染服务端已经允许的数据；房主和超管分别通过独立写接口更新各自有权控制的开关，并写审计事件。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5.9、Zod、Drizzle ORM、PostgreSQL、Vitest、pnpm workspace

---

## File map

- `packages/db/migrations/0013_room_ticket_visibility.sql`: 新增两个房间可见性列及默认值。
- `packages/db/src/rooms/schema.ts`: Drizzle schema 映射。
- `packages/db/src/rooms/schema.test.ts`: 迁移打包与默认值回归测试。
- `packages/domain/src/rooms/service.ts`: 房间详情类型、房主更新开赛后开关的应用服务接口。
- `packages/domain/src/rooms/service.test.ts`: 房主授权与设置映射测试。
- `packages/db/src/rooms/repository.ts`: 房间设置读取和房主原子更新、房间审计。
- `packages/db/src/operations/repository.ts`: 票据阶段判定与服务端字段脱敏。
- `packages/db/src/operations/privacy.test.ts`: 本人/他人、赛前/赛后、开/关矩阵测试。
- `packages/db/src/operations/moderation-privacy.ts`: 超管房间列表和赛前开关更新、平台审计。
- `apps/web/src/app/api/v1/rooms/_lib/handlers.ts`: 房主设置请求校验与 handler。
- `apps/web/src/app/api/v1/rooms/_lib/handlers.test.ts`: 房主接口认证、同源、校验测试。
- `apps/web/src/app/api/v1/rooms/[roomId]/settings/route.ts`: 房主设置 PATCH 路由。
- `apps/web/src/app/api/v1/_lib/moderation-handlers.ts`: 超管房间列表和赛前开关 handler。
- `apps/web/src/app/api/v1/_lib/moderation-handlers.test.ts`: 超管鉴权、reauth、校验测试。
- `apps/web/src/app/api/v1/admin/rooms/route.ts`: 超管房间列表 GET 路由。
- `apps/web/src/app/api/v1/admin/rooms/[roomId]/visibility/route.ts`: 超管赛前开关 PATCH 路由。
- `apps/web/src/features/rooms/room-ticket-history.ts`: 历史记录 DTO 和纯展示映射。
- `apps/web/src/features/rooms/room-ticket-history.test.ts`: 三种可见级别展示测试。
- `apps/web/src/features/rooms/room-ticket-history-view.tsx`: 房间内“全部/我的”投入记录和房主开关。
- `apps/web/src/features/rooms/room-detail-view.tsx`: 挂载投入记录区块。
- `apps/web/src/features/rooms/room-flow.ts`: 规范化房间设置字段。
- `apps/web/src/features/rooms/room-flow.test.ts`: 设置默认值/归一化测试。
- `apps/web/src/features/operations/admin-moderation.ts`: 超管可见性 API 请求 helper。
- `apps/web/src/features/operations/admin-moderation.test.ts`: 请求结构测试。
- `apps/web/src/features/operations/admin-moderation-view.tsx`: 全部房间的赛前投入可见开关。

### Task 1: Persist room visibility settings

**Files:**
- Create: `packages/db/migrations/0013_room_ticket_visibility.sql`
- Modify: `packages/db/src/rooms/schema.ts`
- Test: `packages/db/src/rooms/schema.test.ts`

- [ ] **Step 1: Write the failing migration test**

Add a test that reads migration `0013` and asserts all four fragments:

```ts
expect(sql).toContain("pre_match_stake_visible BOOLEAN NOT NULL DEFAULT FALSE");
expect(sql).toContain("post_match_ticket_visible BOOLEAN NOT NULL DEFAULT TRUE");
expect(sql).toContain("ADD COLUMN IF NOT EXISTS pre_match_stake_visible");
expect(sql).toContain("ADD COLUMN IF NOT EXISTS post_match_ticket_visible");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run packages/db/src/rooms/schema.test.ts`

Expected: FAIL because `0013_room_ticket_visibility.sql` does not exist.

- [ ] **Step 3: Add the migration and schema fields**

Create the idempotent migration:

```sql
ALTER TABLE room.rooms
  ADD COLUMN IF NOT EXISTS pre_match_stake_visible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS post_match_ticket_visible BOOLEAN NOT NULL DEFAULT TRUE;
```

Import `boolean` from `drizzle-orm/pg-core` and add:

```ts
preMatchStakeVisible: boolean("pre_match_stake_visible").notNull().default(false),
postMatchTicketVisible: boolean("post_match_ticket_visible").notNull().default(true),
```

- [ ] **Step 4: Run the focused test and DB build**

Run: `pnpm vitest run packages/db/src/rooms/schema.test.ts && pnpm --filter @pulse/db build`

Expected: PASS and TypeScript build exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0013_room_ticket_visibility.sql packages/db/src/rooms/schema.ts packages/db/src/rooms/schema.test.ts
git commit -m "feat: persist room ticket visibility settings"
```

### Task 2: Enforce ticket visibility on the server

**Files:**
- Modify: `packages/db/src/operations/repository.ts`
- Test: `packages/db/src/operations/privacy.test.ts`

- [ ] **Step 1: Write the failing policy matrix tests**

Replace single-phase expectations with a table that calls `redactTicketHistory` using settings:

```ts
const settings = { preMatchStakeVisible: false, postMatchTicketVisible: true };

it.each([
  ["owner before kickoff", "owner", beforeKickoff, settings, "REVEALED"],
  ["other before kickoff off", "viewer", beforeKickoff, settings, "PRIVATE"],
  ["other before kickoff on", "viewer", beforeKickoff, { ...settings, preMatchStakeVisible: true }, "STAKE_ONLY"],
  ["other after kickoff on", "viewer", afterKickoff, settings, "REVEALED"],
  ["other after kickoff off", "viewer", afterKickoff, { ...settings, postMatchTicketVisible: false }, "PRIVATE"],
])("%s", (_name, viewerId, now, roomSettings, visibility) => {
  expect(redactTicketHistory(row, viewerId, now, roomSettings).visibility).toBe(visibility);
});
```

Add field assertions: `STAKE_ONLY` contains `stakePoints` and `submittedAt` but omits selection/odds/settlement; `PRIVATE` contains neither stake nor submitted time nor settlement/net return; owner always receives the complete record.

- [ ] **Step 2: Run the privacy test and verify RED**

Run: `pnpm vitest run packages/db/src/operations/privacy.test.ts`

Expected: FAIL because the function has no room-settings argument or `STAKE_ONLY` result.

- [ ] **Step 3: Implement the three-level redaction function**

Use these exported types and precedence:

```ts
export interface RoomTicketVisibilitySettings {
  preMatchStakeVisible: boolean;
  postMatchTicketVisible: boolean;
}
export type TicketHistoryVisibility = "REVEALED" | "STAKE_ONLY" | "PRIVATE";

const started = now >= row.kickoff || row.matchStatus !== "SCHEDULED";
const visibility: TicketHistoryVisibility = row.ownerUserId === viewerId
  ? "REVEALED"
  : started
    ? settings.postMatchTicketVisible ? "REVEALED" : "PRIVATE"
    : settings.preMatchStakeVisible ? "STAKE_ONLY" : "PRIVATE";
```

Return a minimal common record (`ticketId`, `matchId`, teams, kickoff, owner, `submitted: true`, `status`). Add `submittedAt` and stake only for `STAKE_ONLY`; add selection, stake, odds, submitted time, settlement outcome, returned/net points and version only for `REVEALED`.

- [ ] **Step 4: Load settings with membership and apply them**

Change membership lookup to return:

```ts
{ role: roomMembers.role, preMatchStakeVisible: rooms.preMatchStakeVisible, postMatchTicketVisible: rooms.postMatchTicketVisible }
```

Join `room.rooms`, reject non-members exactly as before, and pass the two booleans into every `redactTicketHistory` call. Do not accept visibility flags from the client.

- [ ] **Step 5: Run focused tests and DB typecheck**

Run: `pnpm vitest run packages/db/src/operations/privacy.test.ts && pnpm --filter @pulse/db typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/operations/repository.ts packages/db/src/operations/privacy.test.ts
git commit -m "feat: enforce room ticket visibility policy"
```

### Task 3: Let room owners control post-kickoff visibility

**Files:**
- Modify: `packages/domain/src/rooms/service.ts`
- Modify: `packages/domain/src/rooms/service.test.ts`
- Modify: `packages/db/src/rooms/repository.ts`
- Modify: `apps/web/src/app/api/v1/rooms/_lib/handlers.ts`
- Modify: `apps/web/src/app/api/v1/rooms/_lib/handlers.test.ts`
- Create: `apps/web/src/app/api/v1/rooms/[roomId]/settings/route.ts`

- [ ] **Step 1: Write failing domain tests**

Extend the repository fake with `updatePostMatchTicketVisibility` and assert:

```ts
await expect(service.updatePostMatchTicketVisibility("room-1", "owner-1", false))
  .resolves.toMatchObject({ roomId: "room-1", postMatchTicketVisible: false });
await expect(service.updatePostMatchTicketVisibility("missing", "member-1", true))
  .rejects.toMatchObject({ code: "ROOM_OWNER_REQUIRED", status: 403 });
```

Also assert `getRoom()` exposes both booleans.

- [ ] **Step 2: Run the domain test and verify RED**

Run: `pnpm vitest run packages/domain/src/rooms/service.test.ts`

Expected: FAIL because the repository/service method and view fields do not exist.

- [ ] **Step 3: Add domain contracts and owner-only repository update**

Extend `RoomSummaryRecord` with both booleans. Add repository contract:

```ts
updatePostMatchTicketVisibility(input: {
  roomId: string; ownerId: string; visible: boolean; now: Date; auditId: string;
}): Promise<boolean>;
```

Add service method that calls it and throws `RoomError("ROOM_OWNER_REQUIRED", 403, ...)` when false. In Drizzle, update only a room joined to an `OWNER` membership, set `post_match_ticket_visible`, `updated_at`, and insert `room.audit_events` with action `POST_MATCH_TICKET_VISIBILITY_ENABLED` or `POST_MATCH_TICKET_VISIBILITY_DISABLED`.

- [ ] **Step 4: Include settings in room detail queries**

Select/group/map `preMatchStakeVisible` and `postMatchTicketVisible` in `listRooms` and `getRoomForMember`, and return both from `toView` without changing their names.

- [ ] **Step 5: Write failing handler tests**

Add tests using a same-origin authenticated request:

```ts
const request = new Request("https://app.test/api/v1/rooms/room-1/settings", {
  method: "PATCH",
  headers: { origin: "https://app.test", cookie: "fp_session=session", "content-type": "application/json" },
  body: JSON.stringify({ postMatchTicketVisible: false }),
});
expect(await handlers.updateSettings(request, "room-1")).toMatchObject({ status: 200 });
expect(rooms.updatePostMatchTicketVisibility).toHaveBeenCalledWith("room-1", "user-1", false);
```

Add malformed-body and unauthenticated cases expecting 422 and 401.

- [ ] **Step 6: Implement handler and route**

Use strict schema:

```ts
const settingsSchema = z.object({ postMatchTicketVisible: z.boolean() }).strict();
```

Add `updateSettings` to `RoomsApplication` and handler, with `assertSameOrigin`, authenticated user lookup, and the service call. The route exports `PATCH` and delegates through the existing room runtime.

- [ ] **Step 7: Run focused tests and typechecks**

Run: `pnpm vitest run packages/domain/src/rooms/service.test.ts apps/web/src/app/api/v1/rooms/_lib/handlers.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/rooms/service.ts packages/domain/src/rooms/service.test.ts packages/db/src/rooms/repository.ts apps/web/src/app/api/v1/rooms/_lib/handlers.ts apps/web/src/app/api/v1/rooms/_lib/handlers.test.ts apps/web/src/app/api/v1/rooms/'[roomId]'/settings/route.ts
git commit -m "feat: let room owners control post-match records"
```

### Task 4: Let platform super-admins control pre-match stake visibility

**Files:**
- Modify: `packages/db/src/operations/moderation-privacy.ts`
- Modify: `packages/db/src/operations/moderation-privacy.test.ts`
- Modify: `apps/web/src/app/api/v1/_lib/moderation-handlers.ts`
- Modify: `apps/web/src/app/api/v1/_lib/moderation-handlers.test.ts`
- Create: `apps/web/src/app/api/v1/admin/rooms/route.ts`
- Create: `apps/web/src/app/api/v1/admin/rooms/[roomId]/visibility/route.ts`

- [ ] **Step 1: Write failing repository tests**

Add tests that expect `listRooms(adminId)` to call super-admin authorization and return room id/name/status/member count/both flags, and `updatePreMatchStakeVisibility(adminId, roomId, true)` to write the flag plus an `ops.audit_events` row whose action is `ROOM_PRE_MATCH_STAKE_VISIBILITY_UPDATED` and metadata contains only old/new boolean values.

- [ ] **Step 2: Run repository tests and verify RED**

Run: `pnpm vitest run packages/db/src/operations/moderation-privacy.test.ts`

Expected: FAIL because both methods are missing.

- [ ] **Step 3: Implement super-admin repository operations**

Implement:

```ts
listRooms(adminUserId: string): Promise<Array<{
  roomId: string; name: string; status: string; memberCount: number;
  preMatchStakeVisible: boolean; postMatchTicketVisible: boolean;
}>>
updatePreMatchStakeVisibility(adminUserId: string, roomId: string, visible: boolean): Promise<unknown>
```

Both begin with `assertSuperAdmin`. The update runs in a transaction, locks/returns the previous flag, throws `ROOM_NOT_FOUND` if absent, updates the room, and inserts a successful ops audit event without ticket content, passwords, cookies, or secrets.

- [ ] **Step 4: Write failing HTTP handler tests**

Test `listRooms` with a valid session. Test `updatePreMatchVisibility` with strict body `{ preMatchStakeVisible: true }`, same-origin request, session cookie and `x-reauth-proof`; expect authorization through `authorizeSuperAdminAction`. Add missing-proof 403 and unknown-field 422 cases.

- [ ] **Step 5: Implement HTTP handlers and routes**

Add to `Moderation`:

```ts
listRooms(userId: string): Promise<unknown>;
updatePreMatchStakeVisibility(userId: string, roomId: string, visible: boolean): Promise<unknown>;
```

Use `z.object({ preMatchStakeVisible: z.boolean() }).strict()`. GET `/api/v1/admin/rooms` authenticates normally and lets the repository enforce SUPER_ADMIN. PATCH `/api/v1/admin/rooms/[roomId]/visibility` requires same origin and reauth proof before calling the repository.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm vitest run packages/db/src/operations/moderation-privacy.test.ts apps/web/src/app/api/v1/_lib/moderation-handlers.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/operations/moderation-privacy.ts packages/db/src/operations/moderation-privacy.test.ts apps/web/src/app/api/v1/_lib/moderation-handlers.ts apps/web/src/app/api/v1/_lib/moderation-handlers.test.ts apps/web/src/app/api/v1/admin/rooms/route.ts apps/web/src/app/api/v1/admin/rooms/'[roomId]'/visibility/route.ts
git commit -m "feat: add super-admin pre-match visibility control"
```

### Task 5: Show room ticket history and the owner control

**Files:**
- Create: `apps/web/src/features/rooms/room-ticket-history.ts`
- Create: `apps/web/src/features/rooms/room-ticket-history.test.ts`
- Create: `apps/web/src/features/rooms/room-ticket-history-view.tsx`
- Modify: `apps/web/src/features/rooms/room-detail-view.tsx`
- Modify: `apps/web/src/features/rooms/room-flow.ts`
- Modify: `apps/web/src/features/rooms/room-flow.test.ts`

- [ ] **Step 1: Write failing pure presentation tests**

Define fixtures for each visibility and assert `toTicketHistoryView` produces:

```ts
expect(privateView).toMatchObject({ disclosure: "已提交，详情未公开", stake: null, selection: null, odds: null });
expect(stakeOnlyView).toMatchObject({ disclosure: "已公开投入", stake: "2,000", selection: null, odds: null });
expect(revealedView).toMatchObject({ disclosure: "完整记录", stake: "2,000", selection: "客胜", odds: "2.45" });
```

Assert returned/net points are absent unless `REVEALED`, and own records are labeled “我的记录”. Add room-flow expectations that missing legacy settings normalize to `false`/`true`.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run apps/web/src/features/rooms/room-ticket-history.test.ts apps/web/src/features/rooms/room-flow.test.ts`

Expected: FAIL because the helper and normalized settings are missing.

- [ ] **Step 3: Implement DTO normalization and pure view mapping**

Create discriminated input types for `PRIVATE`, `STAKE_ONLY`, `REVEALED`; map only present server fields. Format points with `Intl.NumberFormat("zh-CN")`, odds with two decimals, selections as 主胜/平局/客胜. Never infer hidden selection or odds client-side.

Extend room detail normalization with:

```ts
preMatchStakeVisible: input.preMatchStakeVisible === true,
postMatchTicketVisible: input.postMatchTicketVisible !== false,
```

- [ ] **Step 4: Implement the room history component**

Fetch `/api/v1/rooms/${roomId}/tickets/history`, render “全部记录 / 我的记录” filters, loading/empty/error states, member name, match, submit state, and only the fields allowed by the DTO. Use stable ticket ids as keys and preserve Chinese competition/team labels supplied by the API.

For `isOwner`, render “开赛后公开完整记录” switch. PATCH `/api/v1/rooms/${roomId}/settings` with `{ postMatchTicketVisible }`; optimistically disable the control during the request, revert on failure, and show the API error without changing ticket fields locally.

- [ ] **Step 5: Mount it in room detail**

In `room-detail-view.tsx`, render:

```tsx
<RoomTicketHistoryView
  roomId={roomId}
  isOwner={detail.isOwner}
  initialPostMatchTicketVisible={detail.postMatchTicketVisible}
/>
```

Place it after the match list so match prediction remains the primary action and records remain inside the same room page.

- [ ] **Step 6: Run focused tests, lint, and web typecheck**

Run: `pnpm vitest run apps/web/src/features/rooms/room-ticket-history.test.ts apps/web/src/features/rooms/room-flow.test.ts && pnpm --filter @pulse/web lint && pnpm --filter @pulse/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/rooms/room-ticket-history.ts apps/web/src/features/rooms/room-ticket-history.test.ts apps/web/src/features/rooms/room-ticket-history-view.tsx apps/web/src/features/rooms/room-detail-view.tsx apps/web/src/features/rooms/room-flow.ts apps/web/src/features/rooms/room-flow.test.ts
git commit -m "feat: show ticket records inside rooms"
```

### Task 6: Add the super-admin UI control

**Files:**
- Modify: `apps/web/src/features/operations/admin-moderation.ts`
- Modify: `apps/web/src/features/operations/admin-moderation.test.ts`
- Modify: `apps/web/src/features/operations/admin-moderation-view.tsx`

- [ ] **Step 1: Write failing request-helper tests**

Assert the helper sends:

```ts
expect(request).toMatchObject({
  url: "/api/v1/admin/rooms/room-1/visibility",
  init: {
    method: "PATCH",
    body: JSON.stringify({ preMatchStakeVisible: true }),
  },
});
expect(new Headers(request.init.headers).get("x-reauth-proof")).toBe("proof-token");
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `pnpm vitest run apps/web/src/features/operations/admin-moderation.test.ts`

Expected: FAIL because the visibility request helper is missing.

- [ ] **Step 3: Implement helper and admin room controls**

Load `/api/v1/admin/rooms` beside reports/audit. Render a dedicated “房间记录可见性” list for every room, not only reported rooms. Each item shows room name/status/member count and a switch labeled “未开赛公开其他成员投入积分”. On change, prompt for the current super-admin password, obtain a reauth proof through the existing flow, PATCH the strict boolean body, then replace the item with the server response. Disable only the active room switch while saving.

- [ ] **Step 4: Run focused tests, lint, and web typecheck**

Run: `pnpm vitest run apps/web/src/features/operations/admin-moderation.test.ts && pnpm --filter @pulse/web lint && pnpm --filter @pulse/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/operations/admin-moderation.ts apps/web/src/features/operations/admin-moderation.test.ts apps/web/src/features/operations/admin-moderation-view.tsx
git commit -m "feat: manage pre-match visibility in admin"
```

### Task 7: Full verification, migrate, and release

**Files:**
- Modify only if verification reveals a regression in files already listed above.

- [ ] **Step 1: Run all local quality gates**

Run:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands exit 0; no whitespace errors.

- [ ] **Step 2: Apply the production migration without printing credentials**

Run using the already configured local environment, never echoing `DATABASE_URL`:

```bash
pnpm db:migrate
```

Expected: migration runner reports `0013_room_ticket_visibility.sql` applied, with no connection string in output.

- [ ] **Step 3: Commit any verification-only fixes**

If tracked source files changed during Step 1, stage only those reviewed files and commit:

Stage only the reviewed visibility implementation paths, then commit:

```bash
git add packages/db packages/domain/src/rooms apps/web/src/app/api/v1 apps/web/src/features/rooms apps/web/src/features/operations
git commit -m "fix: complete room ticket visibility rollout"
```

If no source changes exist, skip this commit.

- [ ] **Step 4: Push main**

Run: `git status --short --branch && git push origin main`

Expected: clean `main`, push succeeds without force.

- [ ] **Step 5: Verify deployment and migration readiness**

Check the GitHub Actions run and Vercel deployment triggered by the pushed commit. Prepare and deploy the same commit to CloudBase using the repository’s `cloudbase:prepare-package` flow. Verify health readiness and authenticated room/admin pages without logging cookies, passwords, reauth proofs, environment variables, or connection strings.

Expected: primary CloudBase URL and Vercel backup both return 200 for health/readiness; room detail shows records; owner can change only post-match visibility; super-admin can change only pre-match stake visibility; a regular member receives 403 from both privileged writes.
