# 2026 World Cup Complete History Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 展示 2026 世界杯全部未开始、直播中和已结束比赛，并提供状态筛选与合理排序。

**Architecture:** OpenLigaDB 同步层保存完整 2026 赛季，API cache runtime 返回 `SCHEDULED`、`LIVE`、`FINISHED` 三类有效比赛。前端在现有赛事和日期筛选旁增加状态筛选，并通过纯函数完成组合过滤与“当前赛事优先、历史赛果倒序”的排序。

**Tech Stack:** TypeScript、Next.js 16 App Router、React 19、Vitest、PostgreSQL cache、OpenLigaDB

---

### Task 1: 保留完整 2026 世界杯同步数据

**Files:**
- Modify: `packages/supplier/src/supplier.test.ts`
- Modify: `packages/supplier/src/index.ts:226-250`

**Step 1: Write the failing test**

在 `packages/supplier/src/supplier.test.ts` 为 `OpenLigaDbWorldCupSync` 增加测试：输入一场早于当前时间超过 24 小时的 `FINISHED` 比赛和一场未来比赛，断言 `saveFixtures` 收到两场比赛。

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/supplier/src/supplier.test.ts`

Expected: FAIL，历史比赛被当前 `recentCutoff` 过滤。

**Step 3: Write minimal implementation**

删除 `OpenLigaDbWorldCupSync.run()` 中最近 24 小时过滤，只保留：

```ts
const fixtures = await this.client.fetchWorldCup2026();
```

赔率同步仍只针对未来 `SCHEDULED` 比赛，避免对历史比赛请求实时赔率。

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/supplier/src/supplier.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/supplier/src/index.ts packages/supplier/src/supplier.test.ts
git commit -m "feat: retain complete 2026 World Cup fixtures"
```

### Task 2: API 返回已结束的 2026 世界杯比赛

**Files:**
- Modify: `apps/web/src/app/api/v1/matches/runtime.test.ts`
- Modify: `apps/web/src/app/api/v1/matches/runtime.ts:20-32`

**Step 1: Write the failing test**

修改 `visibleCurrentMatches` 测试，输入 `FINISHED`、`LIVE`、未来 `SCHEDULED` 和时间已过但仍标记 `SCHEDULED` 的记录，期望前三类有效赛季状态被保留，异常的过期 `SCHEDULED` 被排除。

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/src/app/api/v1/matches/runtime.test.ts`

Expected: FAIL，当前实现丢弃 `FINISHED`。

**Step 3: Write minimal implementation**

让 `visibleCurrentMatches` 明确保留 `FINISHED` 与 `LIVE`，并仅对 `SCHEDULED` 校验未来开球时间。

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/src/app/api/v1/matches/runtime.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add apps/web/src/app/api/v1/matches/runtime.ts apps/web/src/app/api/v1/matches/runtime.test.ts
git commit -m "feat: expose completed World Cup matches"
```

### Task 3: 增加状态筛选和比赛排序

**Files:**
- Modify: `apps/web/src/features/matchday/match-filters.test.ts`
- Modify: `apps/web/src/features/matchday/match-filters.ts`
- Modify: `apps/web/src/features/matchday/match-list.tsx`

**Step 1: Write the failing tests**

在 `match-filters.test.ts` 增加：

- `status: "predictable"` 只返回 `matchAvailability(match).predictable === true` 的比赛。
- `status: "finished"` 只返回 `state === "FINISHED"` 的比赛。
- 排序函数将直播和未来比赛按时间升序放在前面，将已结束比赛按时间降序放在后面。
- 状态、赛事和日期筛选能够组合。

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/web/src/features/matchday/match-filters.test.ts`

Expected: FAIL，状态筛选和目标排序尚不存在。

**Step 3: Write minimal pure-function implementation**

扩展筛选类型：

```ts
export type MatchStatusFilter = "" | "predictable" | "finished";
export type MatchFilter = {
  competition?: string;
  date?: string;
  status?: MatchStatusFilter;
  timeZone?: string;
};
```

增加 `sortMatchTimeline(matches)`，先划分 `FINISHED` 与非 `FINISHED`，分别排序后合并。让 `filterMatches` 同时应用赛事、日期和状态条件。

**Step 4: Add the status control to MatchList**

在 `match-list.tsx`：

- 新增 `status` state，默认 `""`。
- 在筛选区域增加 `全部 / 可预测 / 已结束` select。
- 把网格调整为容纳三个 select 和刷新按钮。
- 先调用 `sortMatchTimeline(matches)`，再组合筛选、分页和分组。
- 清除筛选时同步清空状态。

**Step 5: Run tests to verify they pass**

Run: `pnpm vitest run apps/web/src/features/matchday/match-filters.test.ts apps/web/src/features/matchday/types.test.ts`

Expected: PASS。

**Step 6: Commit**

```bash
git add apps/web/src/features/matchday/match-filters.ts apps/web/src/features/matchday/match-filters.test.ts apps/web/src/features/matchday/match-list.tsx
git commit -m "feat: filter complete World Cup match timeline"
```

### Task 4: 全量验证与运行说明同步

**Files:**
- Modify: `README.md`

**Step 1: Update documentation**

将 README 中“只返回直播或未来比赛”和“只保存过去 24 小时”的说明改为完整 2026 世界杯赛程与赛果；说明历史比赛不可预测。

**Step 2: Run focused verification**

Run:

```bash
pnpm vitest run packages/supplier/src/supplier.test.ts apps/web/src/app/api/v1/matches/runtime.test.ts apps/web/src/features/matchday/match-filters.test.ts apps/web/src/features/matchday/types.test.ts
```

Expected: PASS，0 failures。

**Step 3: Run repository verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Expected: 三条命令 exit code 0。

**Step 4: Review the diff**

Run:

```bash
git diff --check
git status --short
```

Expected: 无 whitespace error，只包含计划内文件。

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: describe complete World Cup match history"
```

