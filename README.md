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

The `SUPER_ADMIN_*` values are one-shot seed inputs, not a password source of truth. First-login rotation updates only the database hash, clears `must_change_password`, revokes prior sessions, and issues a new browser session. Local `.env` files are intentionally not rewritten, and a later seed run does not reset an existing administrator password.

## Current real match data

The production match list synchronizes the active **2026 World Cup** window from OpenLigaDB before cache reads (at most once every five minutes per warm server instance). OpenLigaDB needs no API key. The product stores only the upcoming window plus the previous 24 hours required for settlement, and the public match list returns only live or future fixtures. Competition and World Cup team names are localized to Chinese.

OpenLigaDB does not provide bookmaker odds. To keep the non-cash prediction flow testable without fabricating betting data, upcoming matches receive a clearly labeled platform rule: fixed virtual-points multiplier `3.00` for home/draw/away. Kickoff times and results remain supplier data and are never invented. If the community source is temporarily unavailable, reads degrade to the latest database cache.

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
