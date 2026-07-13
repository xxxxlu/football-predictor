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

No API-FOOTBALL key is required for this foundation story.

## Development

```bash
pnpm dev:web
pnpm dev:worker
```

Required runtime keys are validated by `@football-predictor/config`. Missing or invalid keys fail fast without printing secret values.

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
