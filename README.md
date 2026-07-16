# Football Predictor

BMAD-planned TypeScript monorepo for a non-cash football prediction PWA.

## Prerequisites

- Node.js 24 LTS (production and CI baseline)
- pnpm 10.4.0

The local machine may currently expose Node 25.5.0. It can be used for temporary checks, but it is not a supported production baseline because it is not an LTS line.

## Setup

```bash
cp .env.example .env
pnpm install --frozen-lockfile
```

The web app can start without live supplier access. The worker and manual supplier prewarm require a server-only `API_FOOTBALL_KEY`.

## Development

```bash
pnpm dev:web
pnpm dev:worker
```

Required runtime keys are validated by `@football-predictor/config`. Missing or invalid keys fail fast without printing secret values.

Registered users can create either `PUBLIC` or `PRIVATE` rooms. Active public rooms appear in the authenticated lobby and can be joined directly after rules confirmation; private rooms remain invitation-only. Every room keeps its own one-time 10,000-point initial account, and repeat joins never issue another grant.

### Advanced rooms and correct-score predictions

Rooms are created at one of two tiers — `STANDARD` (1X2 only) or `ADVANCED` — chosen at creation, immutable afterwards, with existing rooms defaulting to `STANDARD`. Advanced rooms additionally offer a platform-virtual **correct-score** market (`supplier = PLATFORM`, `supplier_market_id = 2`) that coexists with the 1X2 market (`supplier_market_id = 1`) on the same fixture. Players pick one score from a 17-way candidate set — the 16 listed scorelines plus an `OTHER` catch-all for any scoreline outside that set — at fixed virtual-points multipliers clearly labeled as a platform rule, not real bookmaker odds. The advanced-only gate, the 20,000-point stake ceiling, at most one unsettled correct-score ticket per fixture per player, atomic freeze, versioned-odds re-confirmation (`ODDS_CHANGED`) and settlement (an exact score match wins; `OTHER` wins only when the final score falls outside the listed set) are all enforced on the server — hiding the entry in standard rooms is never the authorization boundary. Refunds, idempotency, ledger append and result-correction reversal follow the same 1X2 rules (correct-score has no push). Run `pnpm db:migrate` to apply migration `0015` (adds the room tier) before using advanced rooms.

The `SUPER_ADMIN_*` values are one-shot seed inputs, not a password source of truth. First-login rotation updates only the database hash, clears `must_change_password`, revokes prior sessions, and issues a new browser session. Local `.env` files are intentionally not rewritten, and a later seed run does not reset an existing administrator password.

## Access control and admin governance

Authorization is enforced on the server (domain services, repositories and SQL) — never by hiding UI. Room detail, members, balances, ledger, leaderboard and predictions require room membership; there is no super-admin bypass of private-room content. Prediction selections stay hidden from other members until kickoff. The two seeded super-admins can list and disable/restore normal users, moderate reported rooms (restrict/close/restore) and read system health, each sensitive write requiring a fresh same-origin re-authentication proof valid for at most five minutes. Super-admins cannot modify points, delete predictions or ledger entries, read passwords/recovery codes/session tokens, view pre-kickoff selections, or disable/replace another super-admin, and the product cannot mint a third. `GET /api/v1/admin/audit` returns a single time-ordered governance trail consolidated from the account, room and operations audit stores, with secret-bearing metadata redacted. See `docs/reviews/2026-07-15-admin-rbac-audit.md` for the full permission matrix and audit.

## Current real match data

The production match list synchronizes the complete **2026 World Cup** schedule from OpenLigaDB before cache reads (at most once every five minutes per warm server instance). OpenLigaDB needs no API key. Finished, live, and future fixtures remain available in the public match list; users can switch between all, predictable, and finished matches. Current fixtures are shown first, while completed fixtures are ordered newest-first. Competition and World Cup team names are localized to Chinese.

OpenLigaDB does not provide bookmaker odds. To keep the non-cash prediction flow testable without fabricating betting data, upcoming matches receive a clearly labeled platform rule: fixed virtual-points multiplier `3.00` for home/draw/away. Kickoff times and results remain supplier data and are never invented. If the community source is temporarily unavailable, reads degrade to the latest database cache.

When a verified bookmaker-odds snapshot has been stored, that exact version remains available for non-cash predictions until the server-recorded kickoff time. Snapshot age and supplier-sync health remain visible operational signals, but they do not close a prematch market by themselves. A missing, unverifiable, future-dated, cancelled, postponed, live, or finished market remains unavailable.

API-FOOTBALL remains an optional supplier for licensed bookmaker odds. Its free plan does not expose the 2026 season, so `SUPPLIER_COMPETITIONS` and `SUPPLIER_REFERENCE_DATE` are blank by default. Configure a paid/current-season plan before enabling `SUPPLIER_CURRENT_SEASON_ENABLED`; the manual/scheduled workflow refuses to pretend the free plan can sync 2026.

```bash
pnpm db:migrate
```

The legacy `pnpm supplier:prewarm` command is still available when a compatible API-FOOTBALL plan and explicit competitions are configured. It preserves the persisted 95-call daily guard and never prints the API key.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Health endpoints

- `GET /api/health/live`: process liveness only; never calls databases or suppliers.
- `GET /api/health/ready`: validates dependencies introduced so far (currently runtime configuration); returns 503 when unready and never calls API-FOOTBALL.

## Workspace boundaries

- `apps/web`: Next.js App Router web/PWA and HTTP transport.
- `apps/worker`: scheduled/background process entrypoint.
- `packages/domain`: framework-free domain boundary.
- `packages/db`: future SQL/repository boundary; no business schema in Story 1.1.
- `packages/config`: shared runtime configuration validation.
- `packages/contracts`: shared API schemas/contracts.
- `packages/testkit`: shared test builders/fakes added only when needed.
