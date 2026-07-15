# Public and Private Rooms Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让注册用户创建公开或私人房间，并让所有已登录用户从公开大厅直接加入公开房间。

**Architecture:** 在房间聚合上增加不可变 `PUBLIC/PRIVATE` 可见性，并保持成员资格仍是访问房间详情、积分和预测的唯一授权依据。公开列表与公开加入使用独立端点，私人加入继续使用不可枚举邀请 token；两条路径在 repository transaction 内共享幂等成员与初始积分语义。

**Tech Stack:** TypeScript、Next.js 16 App Router、React 19、Vitest、Drizzle ORM、PostgreSQL

---

### Task 1: 增加房间可见性数据库合同

**Files:**
- Create: `packages/db/migrations/0012_room_visibility.sql`
- Modify: `packages/db/src/rooms/schema.ts`
- Modify: `packages/db/src/rooms/schema.test.ts`

**Step 1: Write failing schema tests**

断言 schema 暴露 `visibility`，并断言迁移创建 `room_visibility` enum、给现有房间设置 `PRIVATE` 默认值。

**Step 2: Run test and verify RED**

Run: `pnpm vitest run packages/db/src/rooms/schema.test.ts`

Expected: FAIL，当前 schema 没有 `visibility`。

**Step 3: Implement migration and Drizzle schema**

迁移核心：

```sql
DO $$ BEGIN
  CREATE TYPE "public"."room_visibility" AS ENUM ('PUBLIC', 'PRIVATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "room"."rooms"
  ADD COLUMN IF NOT EXISTS "visibility" "room_visibility" NOT NULL DEFAULT 'PRIVATE';

ALTER TABLE "room"."rooms"
  ALTER COLUMN "invite_token_hash" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "room_public_discovery_idx"
  ON "room"."rooms" ("visibility", "status", "created_at");
```

**Step 4: Run test and verify GREEN**

Run: `pnpm vitest run packages/db/src/rooms/schema.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/db/migrations/0012_room_visibility.sql packages/db/src/rooms/schema.ts packages/db/src/rooms/schema.test.ts
git commit -m "feat(db): add public and private room visibility"
```

### Task 2: 扩展房间领域服务

**Files:**
- Modify: `packages/domain/src/rooms/service.ts`
- Modify: `packages/domain/src/rooms/service.test.ts`

**Step 1: Write failing domain tests**

覆盖：

- 创建公开房间把 `PUBLIC` 传给 repository，且不返回邀请 token。
- 创建私人房间把 `PRIVATE` 传给 repository，并返回邀请 token。
- `joinPublic` 需要规则确认，只允许加入 `ACTIVE + PUBLIC` 房间。
- 重复加入返回 `joined: false`。

**Step 2: Run test and verify RED**

Run: `pnpm vitest run packages/domain/src/rooms/service.test.ts`

Expected: FAIL，新 API 尚不存在。

**Step 3: Implement minimal domain contract**

增加：

```ts
export type RoomVisibility = "PUBLIC" | "PRIVATE";
```

让 `create` 接收 visibility；增加 `listPublic` 和 `joinPublic`；保留 `join` 作为私人邀请加入。公开/私人非法交叉加入分别返回 `ROOM_NOT_JOINABLE` 或 `INVITE_INVALID`，不泄露私人房间存在性。

**Step 4: Run test and verify GREEN**

Run: `pnpm vitest run packages/domain/src/rooms/service.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/domain/src/rooms/service.ts packages/domain/src/rooms/service.test.ts
git commit -m "feat(domain): support public room discovery and joining"
```

### Task 3: 实现持久化公开列表与加入事务

**Files:**
- Modify: `packages/db/src/rooms/repository.ts`
- Create: `packages/db/src/rooms/repository.test.ts`

**Step 1: Write failing repository tests**

覆盖创建时保存 visibility、公开列表仅返回 `ACTIVE + PUBLIC`、列表只暴露房间名/房主昵称/成员数，以及按房间 ID 幂等加入并只发放一次初始积分。

**Step 2: Run test and verify RED**

Run: `pnpm vitest run packages/db/src/rooms/repository.test.ts`

Expected: FAIL，repository 端口与查询尚不存在。

**Step 3: Implement repository behavior**

- `createRoom` 保存 visibility；仅私人房间存储 invite hash，公开房间存储 `NULL`。
- `listPublicRooms` 查询 `ACTIVE + PUBLIC` 并聚合房主昵称和成员数。
- `joinPublicRoom` 在 transaction 中锁定房间，确认 visibility/status，使用与邀请加入一致的成员、积分、账本和审计写入。
- 提取 transaction 内部 helper，避免两条加入路径复制发分逻辑。

**Step 4: Run test and verify GREEN**

Run: `pnpm vitest run packages/db/src/rooms/repository.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/db/src/rooms/repository.ts packages/db/src/rooms/repository.test.ts
git commit -m "feat(db): persist and join public rooms"
```

### Task 4: 增加公开房间 API

**Files:**
- Modify: `apps/web/src/app/api/v1/rooms/_lib/handlers.ts`
- Modify: `apps/web/src/app/api/v1/rooms/_lib/handlers.test.ts`
- Create: `apps/web/src/app/api/v1/rooms/public/route.ts`
- Create: `apps/web/src/app/api/v1/rooms/[roomId]/join/route.ts`

**Step 1: Write failing handler tests**

断言创建请求接受 `visibility`；公开列表要求登录；公开加入要求 same-origin、登录与 `rulesAccepted: true`；私人邀请处理保持原行为。

**Step 2: Run test and verify RED**

Run: `pnpm vitest run apps/web/src/app/api/v1/rooms/_lib/handlers.test.ts`

Expected: FAIL，新 handler 不存在。

**Step 3: Implement handlers and routes**

创建 schema：

```ts
const createSchema = z.object({
  name: z.string(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  rulesAccepted: z.literal(true),
});
```

增加 `listPublic` 与 `joinPublic` handler，并建立两个 route 文件。

**Step 4: Run test and verify GREEN**

Run: `pnpm vitest run apps/web/src/app/api/v1/rooms/_lib/handlers.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add apps/web/src/app/api/v1/rooms
git commit -m "feat(api): expose public room discovery and join"
```

### Task 5: 实现公开大厅和创建类型选择

**Files:**
- Modify: `apps/web/src/features/rooms/room-flow.ts`
- Modify: `apps/web/src/features/rooms/room-flow.test.ts`
- Modify: `apps/web/src/features/rooms/room-list-view.tsx`
- Modify: `apps/web/src/features/rooms/room-detail-view.tsx`

**Step 1: Write failing flow tests**

覆盖公开/私人创建 payload、公开加入 request、API view 类型包含 visibility。

**Step 2: Run test and verify RED**

Run: `pnpm vitest run apps/web/src/features/rooms/room-flow.test.ts`

Expected: FAIL，新 payload 和公开加入函数不存在。

**Step 3: Implement flow helpers**

增加 `RoomVisibility`、`publicRoomJoinRequest(roomId)`，创建 request 包含 visibility。

**Step 4: Implement UI**

- 房间页加载 `GET /api/v1/rooms/public`。
- 增加“公开大厅”区域和加入按钮。
- 创建表单增加公开/私人 radio，默认私人。
- 房间卡片显示类型标签。
- 公开房间详情隐藏邀请重置区域；私人房间保持当前邀请 UI。
- 所有加入仍要求确认房间规则。

**Step 5: Run tests and verify GREEN**

Run: `pnpm vitest run apps/web/src/features/rooms/room-flow.test.ts apps/web/src/features/rooms/room-list-flow.test.ts`

Expected: PASS。

**Step 6: Commit**

```bash
git add apps/web/src/features/rooms
git commit -m "feat(web): add public room lobby"
```

### Task 6: 同步产品真值与全量验证

**Files:**
- Modify: `_bmad-output/planning-artifacts/prd.md`
- Modify: `README.md`

**Step 1: Update product truth**

将 PRD 中“Phase 2 单一系统公开大厅、SYSTEM_GRANT”调整为当前确认口径：注册用户创建公开/私人房间、公开大厅发现并直接加入、每个房间独立 10,000 初始积分。清理与新模型冲突的 Phase 1/Phase 2 描述。

**Step 2: Run focused room verification**

Run:

```bash
pnpm vitest run packages/domain/src/rooms/service.test.ts packages/db/src/rooms/schema.test.ts packages/db/src/rooms/repository.test.ts apps/web/src/app/api/v1/rooms/_lib/handlers.test.ts apps/web/src/features/rooms/room-flow.test.ts
```

Expected: PASS，0 failures。

**Step 3: Run full repository verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: 所有命令 exit code 0。

**Step 4: Review migration and diff**

Run:

```bash
git diff --check
git status --short
```

Expected: 无 whitespace error，仅包含计划内文件。

**Step 5: Commit**

```bash
git add _bmad-output/planning-artifacts/prd.md README.md
git commit -m "docs: align public and private room model"
```
