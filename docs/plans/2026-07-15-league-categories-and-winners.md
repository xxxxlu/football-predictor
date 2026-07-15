# League Categories and Finished Match Winners Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Classify the match list by league and show the confirmed score and winning team for finished matches.

**Architecture:** Extend the existing fixture repository mapping so confirmed results reach the current match API. Normalize the result into the frontend view model, group display data by competition before date, and render a dedicated finished-result state in `MatchCard`.

**Tech Stack:** TypeScript, Next.js 16, React 19, PostgreSQL, Vitest

---

### Task 1: Return fixture results from PostgreSQL

**Files:**
- Modify: `packages/db/src/supplier/repository.test.ts`
- Modify: `packages/db/src/supplier/repository.ts`

1. Add a failing repository test whose row contains `resultConfirmed`, `homeScore`, `awayScore`, and `resultVersion`, expecting a populated `result` object.
2. Run `pnpm --filter @football-predictor/db test -- repository.test.ts` and verify the assertion fails because `result` is absent.
3. Extend `FixtureRow`, both fixture SELECT lists, and `mapFixture` to return the result fields.
4. Re-run the focused test and verify it passes.

### Task 2: Normalize safe finished-match results

**Files:**
- Modify: `apps/web/src/features/matchday/types.test.ts`
- Modify: `apps/web/src/features/matchday/types.ts`

1. Add failing tests for a confirmed `2-1` result and for ignored unconfirmed/invalid results.
2. Run `pnpm --filter @football-predictor/web test -- src/features/matchday/types.test.ts` and verify failure because `MatchView.result` is missing.
3. Add the result shape to `ProductMatch` and `MatchView`; normalize only confirmed, finite, non-negative integer scores.
4. Re-run the focused test and verify it passes.

### Task 3: Group matches by league before date

**Files:**
- Modify: `apps/web/src/features/matchday/match-filters.test.ts`
- Modify: `apps/web/src/features/matchday/match-filters.ts`

1. Replace/add a failing grouping test expecting `competition -> dates -> matches` ordering.
2. Run `pnpm --filter @football-predictor/web test -- src/features/matchday/match-filters.test.ts` and verify the old date-first result fails.
3. Implement `groupMatchesByCompetition`, preserving current finished/open sorting rules inside each date.
4. Re-run the focused test and verify it passes.

### Task 4: Render league tabs and winners

**Files:**
- Modify: `apps/web/src/features/matchday/match-card.test.ts`
- Modify: `apps/web/src/components/match-card.tsx`
- Modify: `apps/web/src/features/matchday/match-list.tsx`

1. Add failing render tests for home win, away win, draw, and missing confirmed result.
2. Run `pnpm --filter @football-predictor/web test -- src/features/matchday/match-card.test.ts` and verify failure.
3. Render the final score and derived winner label for finished matches, while preserving the existing open-match odds presentation.
4. Replace the league select with accessible league filter buttons and render outer league sections containing date subsections.
5. Re-run the focused card and match-filter tests.

### Task 5: Verify the feature

**Files:**
- No additional files expected.

1. Run focused DB and web tests.
2. Run `pnpm lint`.
3. Run `pnpm build`.
4. Inspect `git diff --check` and `git status --short`, ensuring unrelated user changes are untouched.
