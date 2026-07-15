# Last Known Odds Until Kickoff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让最后一次有效赔率快照在比赛开球前持续可用于预测，不再因快照年龄暂停提交。

**Architecture:** 将“供应商同步健康”和“用户是否可按已保存快照提交”拆开。数据库继续保存赔率版本，读取和提交链路只要求快照存在、来源可验证、时间戳有效且比赛尚未开球；同步异常仍在管理员状态中单独暴露。

**Tech Stack:** TypeScript、Vitest、Next.js、PostgreSQL supplier cache

---

### Task 1: 调整市场可用性领域规则

**Files:**
- Modify: `packages/domain/src/competition/competition.test.ts`
- Modify: `packages/domain/src/competition/index.ts`

**Step 1: Write failing tests**

增加断言：`THE_ODDS_API` 和 `API_FOOTBALL` 的已验证历史快照，即使超过原 3 小时/10 分钟窗口，仍返回 `marketStatus: "OPEN"`、`canSubmit: true`；未来时间戳、无快照和未验证来源仍不可用。

**Step 2: Run RED**

Run: `pnpm vitest run packages/domain/src/competition/competition.test.ts`

Expected: FAIL，当前超时快照返回 `STALE/DATA_UNAVAILABLE`。

**Step 3: Implement minimal rule**

删除最大年龄封盘逻辑。保留时间戳可解析、不得晚于当前时间、快照存在和 `sourceVerified` 校验。同步状态可以作为观测字段，但不得关闭已有有效快照。

**Step 4: Run GREEN**

Run: `pnpm vitest run packages/domain/src/competition/competition.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/domain/src/competition/index.ts packages/domain/src/competition/competition.test.ts
git commit -m "feat: keep verified odds open until kickoff"
```

### Task 2: 调整预测提交的最终服务端闸门

**Files:**
- Modify: `packages/domain/src/predictions/ticket-submission.test.ts`
- Modify: `packages/domain/src/predictions/ticket-submission.ts`

**Step 1: Write failing tests**

覆盖：

- 24 小时前的有效真实赔率在开球前可以提交。
- 到达 `kickoffAt` 的精确时刻返回 `MARKET_CLOSED`。
- 未来 `dataAsOf`、无效时间戳、未验证来源继续返回 `DATA_UNAVAILABLE`。
- 赔率版本或倍率变化继续返回 `ODDS_CHANGED`。

**Step 2: Run RED**

Run: `pnpm vitest run packages/domain/src/predictions/ticket-submission.test.ts`

Expected: FAIL，旧快照被年龄上限拒绝。

**Step 3: Implement minimal validation**

删除 `MAX_PREMATCH_ODDS_AGE_MS` / `THE_ODDS_API_SUBMISSION_MAX_AGE_MS` 的拒绝分支，只验证时间戳有限且不在未来；保留服务端 kickoff、market status、source verification 和 accepted version/odds 校验。

**Step 4: Run GREEN**

Run: `pnpm vitest run packages/domain/src/predictions/ticket-submission.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/domain/src/predictions/ticket-submission.ts packages/domain/src/predictions/ticket-submission.test.ts
git commit -m "feat: accept last known odds before kickoff"
```

### Task 3: 保持数据库市场快照可提交

**Files:**
- Modify: `packages/db/src/supplier/repository.test.ts`
- Modify: `packages/db/src/supplier/repository.ts`
- Modify: `packages/db/src/predictions/supplier-snapshot-adapter.test.ts`

**Step 1: Write failing tests**

断言 `statusForSync` 对任意年龄的已验证且非未来快照返回 `OPEN`；同步失败/暂停不会覆盖已经存在的有效赔率版本；adapter 对 `SCHEDULED + OPEN + verified` 快照保持开放。

**Step 2: Run RED**

Run:

```bash
pnpm vitest run packages/db/src/supplier/repository.test.ts packages/db/src/predictions/supplier-snapshot-adapter.test.ts
```

Expected: FAIL，repository 仍按 3 小时/10 分钟关闭市场。

**Step 3: Implement persistence behavior**

- `statusForSync` 不再使用年龄上限，只拒绝不可验证、无效或未来快照。
- `setSyncState` 不因同步健康状态覆盖已验证快照的 `OPEN` 市场状态。
- 管理员健康页继续独立计算快照年龄和同步失败数量。

**Step 4: Run GREEN**

Run:

```bash
pnpm vitest run packages/db/src/supplier/repository.test.ts packages/db/src/predictions/supplier-snapshot-adapter.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/db/src/supplier/repository.ts packages/db/src/supplier/repository.test.ts packages/db/src/predictions/supplier-snapshot-adapter.test.ts
git commit -m "feat(db): retain last known prematch market"
```

### Task 4: 更新用户展示与说明

**Files:**
- Modify: `apps/web/src/features/matchday/match-filters.test.ts`
- Modify: `apps/web/src/features/matchday/match-filters.ts`
- Modify: `apps/web/src/components/status-banner.tsx`
- Modify: `apps/web/src/components/match-card.tsx`
- Modify: `apps/web/src/app/terms/page.tsx`
- Modify: `README.md`

**Step 1: Write failing UI-domain tests**

断言带有最后有效赔率的比赛保持 `predictable: true`，且展示文案为“使用最后有效赔率”而不是“倍率数据已过期”。

**Step 2: Run RED**

Run: `pnpm vitest run apps/web/src/features/matchday/match-filters.test.ts`

Expected: FAIL，当前 `stale` 优先阻止预测。

**Step 3: Implement UI behavior**

- 可预测性以 `state === "OPEN"` 和有效 market 为准，不以快照年龄为准。
- 展示最后更新时间和“提交前服务端仍会校验赔率版本与开球时间”。
- 删除误导性的过期封盘文案。
- 条款与 README 写明最后有效快照持续到开球。

**Step 4: Run GREEN**

Run: `pnpm vitest run apps/web/src/features/matchday/match-filters.test.ts apps/web/src/features/matchday/types.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add apps/web/src/features/matchday apps/web/src/components/status-banner.tsx apps/web/src/components/match-card.tsx apps/web/src/app/terms/page.tsx README.md
git commit -m "feat(web): explain last known odds before kickoff"
```

### Task 5: 全量验证

**Files:**
- No new files

**Step 1: Run focused tests**

```bash
pnpm vitest run packages/domain/src/competition/competition.test.ts packages/domain/src/predictions/ticket-submission.test.ts packages/db/src/supplier/repository.test.ts packages/db/src/predictions/supplier-snapshot-adapter.test.ts apps/web/src/features/matchday/match-filters.test.ts apps/web/src/features/matchday/types.test.ts
```

Expected: PASS。

**Step 2: Run full verification**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
```

Expected: 全部 exit code 0。

