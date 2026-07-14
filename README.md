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

## Prewarm real match data

Run migrations first, then set the server-only supplier variables in `.env`. A single run can warm up to 30 competitions while preserving the daily request protections; status calibration is non-billable:

```dotenv
API_FOOTBALL_KEY=replace-locally
API_FOOTBALL_BOOKMAKER_ID=8
SUPPLIER_COMPETITIONS=1:2026,2:2026,39:2026,140:2026,135:2026,78:2026,61:2026,253:2026,71:2026,98:2026,292:2026,169:2026
```

```bash
pnpm db:migrate
pnpm supplier:prewarm
```

`SUPPLIER_COMPETITIONS` uses comma-separated `leagueId:season` pairs. When omitted, prewarm falls back to `SUPPLIER_LEAGUE_ID` and `SUPPLIER_SEASON`. The command performs status calibration, fixture synchronization, and scheduled 1X2 odds warming before exiting. Odds are fetched by league/date with API-FOOTBALL pagination (10 fixtures per request), rather than spending one request per match. Its JSON result contains only synchronized competition/fixture/odds counts and remaining/protected budget; it never prints the API key. Missing configuration fails immediately with the names of variables that must be set.

Because prematch odds are capped at 50 requests per UTC day and 10 calls remain protected for settlement, a run skips already-fresh odds and may report additional `oddsSkipped` when there are more targets than the safe budget permits. Re-run after the UTC budget reset instead of bypassing the guard.

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
