# Free Real Odds Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add budget-aware real World Cup 1X2 odds from The Odds API while keeping OpenLigaDB as the schedule/result source.

**Architecture:** Extend the supplier package with a small The Odds API client and compose it into the existing World Cup sync. Persist a single complete bookmaker snapshot per fixture, use PostgreSQL-backed two-hour throttling, and retain the existing platform market only when no odds key is configured.

**Tech Stack:** TypeScript, Vitest, Next.js route runtime, PostgreSQL supplier cache.

---

### Task 1: Add provider mapping and cache throttle

**Files:**
- Modify: `packages/supplier/src/supplier.test.ts`
- Modify: `packages/supplier/src/index.ts`

1. Write failing tests for complete bookmaker mapping, fixture matching, and a second run inside two hours making zero provider calls.
2. Run the focused supplier tests and confirm the expected failures.
3. Implement the client, deterministic identifiers, matching, and persisted-cache throttle.
4. Re-run the focused supplier tests.

### Task 2: Make freshness provider-aware

**Files:**
- Modify: `packages/domain/src/competition/competition.test.ts`
- Modify: `packages/domain/src/predictions/ticket-submission.test.ts`
- Modify: `packages/domain/src/competition/index.ts`
- Modify: `packages/domain/src/predictions/ticket-submission.ts`
- Modify: `packages/db/src/supplier/repository.ts`

1. Write failing tests proving The Odds API snapshots remain usable for the bounded free-sync window but expire afterward.
2. Implement the shared provider-specific maximum age and persistence typing.
3. Run domain and database tests.

### Task 3: Wire configuration and production runtime

**Files:**
- Modify: `apps/web/src/app/api/v1/matches/runtime.test.ts`
- Modify: `apps/web/src/app/api/v1/matches/runtime.ts`
- Modify: `.env.example`
- Modify: `.github/workflows/supplier-sync.yml`

1. Write a failing runtime construction test for key-enabled composition where practical.
2. Pass `THE_ODDS_API_KEY` to the World Cup sync without logging it.
3. Document the variables and change scheduled sync to the new free source with two daily runs.
4. Run focused tests and typecheck.

### Task 4: Verify and ship

1. Run all relevant tests, lint, typecheck, and production build.
2. Add only files from this implementation, leaving unrelated user UI edits untouched.
3. Commit, push `main`, configure the existing key in Vercel without printing it, and wait for readiness.
