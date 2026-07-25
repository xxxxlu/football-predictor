# Rapid Launch Runbook — 2026-07-14

## 1. Release scope

Ship only the Phase 1 validation slice: username/password identity and recovery, private rooms and invites, per-room 10,000 points, cached 1X2 markets, integer prediction stakes up to 20,000, authoritative close, settlement, ledger, leaderboard, and fixed 18+/non-cash boundaries.

Keep Phase 2/3 disabled: public lobby, grants, parlays, Asian handicap, totals, live prediction, share cards and cash-like capabilities.

## 2. Images and process topology

Build from the repository root:

```bash
docker build -f Dockerfile.web -t pulse-web:$GIT_SHA .
docker build -f Dockerfile.worker -t pulse-worker:$GIT_SHA .
```

Run exactly one migration job before starting the new web/worker revision. Web and worker use the same immutable Git SHA. Both images use Node 24 and run as the non-root `node` user.

| Process | Command in image | Port | Health |
|---|---|---:|---|
| web | `pnpm --filter @pulse/web start` | 3000 | `GET /api/health/ready` |
| worker | `node apps/worker/dist/main.js` | none | container PID check plus structured `worker.started` log |
| migration job | `pnpm db:migrate` using the web image | none | exit code 0 and migration table verification |

The worker health check proves process liveness only. Release monitoring must additionally alert on job lag, failed jobs and settlement age once the job runner is connected.

## 3. Environment contract

Never bake secrets into images or committed `.env` files. Inject them through the deployment platform. Preserve the same `APP_VERSION` across web and worker.

### Web

| Variable | Required | Example/constraint |
|---|---:|---|
| `NODE_ENV` | yes | image sets `production` |
| `APP_ENV` | yes | `production` |
| `APP_VERSION` | yes | immutable Git SHA/release id |
| `LOG_LEVEL` | no | `info`; one of debug/info/warn/error |
| `PORT` | no | image default `3000` |
| `DATABASE_URL` | yes | PostgreSQL URL with TLS enforced by provider/config |
| `RULES_VERSION` | yes | immutable published rules id, e.g. `phase-1-2026-07-14` |
| `SESSION_TTL_DAYS` | no | default 30, allowed 1–90 |

### Worker

| Variable | Required | Example/constraint |
|---|---:|---|
| `NODE_ENV` | yes | image sets `production` |
| `APP_ENV` | yes | `production` |
| `APP_VERSION` | yes | same value as web |
| `LOG_LEVEL` | no | default `info` |
| `DATABASE_URL` | yes | same database as web, separate connection limit recommended |
| `API_FOOTBALL_KEY` | yes | server-only deployment secret |
| `API_FOOTBALL_BASE_URL` | no | defaults to official v3 endpoint |
| `API_FOOTBALL_BOOKMAKER_ID` | yes | positive numeric approved bookmaker id |
| `SUPPLIER_LEAGUE_ID` | yes | positive API-FOOTBALL league id |
| `SUPPLIER_SEASON` | yes | four-digit season |
| `SUPPLIER_WINDOW_PAST_DAYS` / `SUPPLIER_WINDOW_FUTURE_DAYS` | no | defaults `1` / `7` |
| `SUPPLIER_FIXTURES_INTERVAL_MINUTES` | no | defaults `60`; refreshes fixtures/results |
| `SUPPLIER_ODDS_INTERVAL_MINUTES` | no | defaults `10`; handler budget/retry time still wins |
| `SUPPLIER_SETTLEMENT_INTERVAL_SECONDS` | no | defaults `60` |
| `SUPPLIER_SETTLEMENT_BATCH_SIZE` | no | defaults `100`, maximum `1000` |
| `SUPPLIER_LIVE_ENABLED` | no | defaults `false`; read-only live snapshot fetch only |
| `SUPPLIER_LIVE_INTERVAL_MINUTES` | no | defaults `5`, used only when live is enabled |

The worker fails before `worker.started` when required configuration, startup calibration, or startup fixture refresh fails. It then runs prematch refresh from database fixture targets, ordinary fixture refresh, protected result refresh, and a one-minute settlement scan against the cached results. Result refresh is the only scheduled supplier job charged to the 10-call settlement reserve. Each job emits structured started/completed/failed/skipped events; `retryAt`/`nextRunAt` and the protected daily budget override timer frequency. SIGTERM stops new scheduling, waits for in-flight work, then closes database pools.

### PostgreSQL

- PostgreSQL 18.
- Require TLS from application processes; never expose 5432 publicly.
- Use a least-privilege runtime user. A migration role may own schema objects; the application role must not be a superuser.
- Configure connection limits for web, worker and migration separately.
- Automated backups at least every 6 hours, retained at least 7 days; verify a restore before inviting users.
- Target `RPO ≤ 6h`, `RTO ≤ 4h`.

Two super-admin accounts must be seeded by a separate audited one-shot operation from deployment secrets, then forced to rotate their initial passwords. No seed credentials belong in container environment after the operation. The current migration command does not seed administrators.

## 4. Pre-deploy gates

- [ ] Release commit CI is green, including PostgreSQL migration smoke and second-run idempotency.
- [ ] Web and worker images are built from that exact commit and pass vulnerability/platform scanning.
- [ ] `DATABASE_URL` reaches production PostgreSQL over TLS.
- [ ] Backup and restore evidence exists before real invitations are sent.
- [ ] Exactly two super admins exist and initial credentials were rotated.
- [ ] `API_FOOTBALL_KEY` is server-only; health endpoints and normal page reads do not call the supplier.
- [ ] Internal daily ceiling is 95 and settlement reserve is 10; normal sync cannot use the reserve.
- [ ] Registration, recovery, invitation, prediction, settlement, ledger and correction smoke paths pass.
- [ ] Duplicate requests create no duplicate account, membership, freeze, settlement or ledger effect.
- [ ] Stale/unverifiable data returns `DATA_UNAVAILABLE` and accepts no prediction.
- [ ] 18+ and non-cash text is visible; no payment, withdrawal, prize or betting links exist.

## 5. Migration and deploy

```bash
# Local validation; override when 5432 is already occupied.
POSTGRES_PORT=55432 docker compose up -d postgres
DATABASE_URL=postgresql://pulse:pulse@127.0.0.1:55432/pulse pnpm db:migrate

# 1. Record current image digests and migration table.
docker run --rm --env-file /secure/prod.env pulse-web:$GIT_SHA pnpm db:migrate

# 2. One-shot, audited seed; remove these secrets after both admins rotate passwords.
docker run --rm --env-file /secure/admin-seed.env pulse-web:$GIT_SHA pnpm db:seed:super-admins

# 3. Start/roll the web revision, then worker revision.
# Platform-specific commands intentionally omitted: this runbook does not deploy.
```

Migrations use a PostgreSQL advisory transaction lock and `app_schema_migrations`; only committed `.sql` files run, in lexical order. The command is safe to retry. Do not run `schema push` in production.

## 6. Post-deploy health checks

```bash
curl --fail --silent https://YOUR_HOST/api/health/live
curl --fail --silent https://YOUR_HOST/api/health/ready
curl --fail --silent https://YOUR_HOST/manifest.webmanifest
```

Confirm:

1. `/live` returns the intended `APP_VERSION` without accessing PostgreSQL or the supplier.
2. `/ready` is HTTP 200 and confirms PostgreSQL connectivity plus the exact committed migration set without exposing the DSN or raw database errors.
3. Worker logs exactly one `worker.started` event for the release version and remains running.
4. Registration → recovery-code save → logout → login works over HTTPS with Secure/HttpOnly/SameSite cookie.
5. Invite join is idempotent and initializes exactly 10,000 points once.
6. A stale market rejects a ticket without changing balance; a valid integer stake freezes exactly once.
7. Supplier budget starts below 95 with 10 requests protected for settlement.
8. No passwords, recovery codes, session tokens, invitation tokens or API keys appear in logs.

## 7. Rollback

Database migrations are forward-only. Never delete ledger rows or run ad-hoc down SQL during an incident.

1. Stop/disable new prediction submissions using the server-side market/maintenance control. If that control is unavailable, stop the web revision rather than accept uncertain writes.
2. Pause worker job leasing; allow an in-flight transaction to finish. Mark uncertain supplier markets unavailable.
3. Roll web and worker back to the previous known-good image digests. Keep the database at the migrated schema; migrations must be expand/contract compatible.
4. Verify `/live`, `/ready`, an authenticated DB read and ledger invariants.
5. Resume only idempotent jobs. Re-run settlement jobs by their dedupe/result-version keys.
6. If data restoration is required, preserve the incident database, restore to a separate instance, reconcile ledger/audit evidence, then perform an approved cutover. Never overwrite production blindly.

## 8. Stop/go decision

**STOP** if migration count differs from committed SQL files, readiness is non-200, DB TLS is absent, two admins are not controlled, backup restore is unverified, supplier reserve can be consumed by normal sync, or ledger differences cannot be explained. Otherwise record gate evidence and proceed with a limited invite cohort.
