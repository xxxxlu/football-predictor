# Zero-Cost Production Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish the football predictor web application with a free web tier, free PostgreSQL tier, automated CI/CD, and quota-safe supplier refreshes.

**Architecture:** Deploy the Next.js frontend and API routes together on Vercel, store persistent state in Neon PostgreSQL, and run bounded supplier synchronization from GitHub Actions instead of an always-on worker. Keep settlement and supplier jobs idempotent through the existing database-backed job and ledger protections.

**Tech Stack:** Next.js 16, pnpm workspace, PostgreSQL/Neon, Vercel, GitHub Actions, API-FOOTBALL.

---

### Task 1: Add Vercel monorepo deployment configuration

**Files:**
- Create: `vercel.json`
- Modify: `scripts/workspace-structure.test.mjs`

1. Add a failing workspace test for the Vercel build contract.
2. Run `pnpm verify:workspace` and confirm the new assertion fails.
3. Add the root Vercel configuration using the existing workspace build.
4. Re-run `pnpm verify:workspace` and confirm it passes.

### Task 2: Add bounded free-tier supplier automation

**Files:**
- Create: `.github/workflows/supplier-sync.yml`
- Modify: `scripts/workspace-structure.test.mjs`

1. Add failing structural assertions for a manually triggerable, twice-daily supplier workflow.
2. Run the workspace test and confirm failure.
3. Add a workflow that installs locked dependencies, runs migrations, and invokes the existing bounded prewarm command using repository secrets.
4. Re-run the workspace test and confirm it passes.

### Task 3: Verify deployability

1. Run `pnpm verify:workspace`.
2. Run `pnpm lint`.
3. Run `pnpm typecheck`.
4. Run `pnpm test`.
5. Run `pnpm build`.

### Task 4: Provision and deploy

1. Create or connect a Neon Free PostgreSQL database.
2. Apply migrations and seed the two super administrators.
3. Create or connect a Vercel project to the GitHub repository.
4. Configure production environment variables without exposing secrets.
5. Deploy `main` and run `pnpm smoke <production-url>`.
6. Trigger `supplier-sync` once and verify real fixtures appear online.
