# PULSE

BMAD-planned TypeScript monorepo for PULSE — a non-cash multi-sport (football + Formula 1) prediction PWA.

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

Required runtime keys are validated by `@pulse/config`. Missing or invalid keys fail fast without printing secret values.

Registered users can create either `PUBLIC` or `PRIVATE` rooms. Active public rooms appear in the authenticated lobby and can be joined directly after rules confirmation; private rooms remain invitation-only. Every room keeps its own one-time 10,000-point initial account, and repeat joins never issue another grant.

### Advanced rooms and correct-score predictions

Rooms are created at one of two tiers — `STANDARD` (1X2 only) or `ADVANCED` — chosen at creation, immutable afterwards, with existing rooms defaulting to `STANDARD`. Advanced rooms additionally offer a platform-virtual **correct-score** market (`supplier = PLATFORM`, `supplier_market_id = 2`) that coexists with the 1X2 market (`supplier_market_id = 1`) on the same fixture. Players pick one score from a 17-way candidate set — the 16 listed scorelines plus an `OTHER` catch-all for any scoreline outside that set — at fixed virtual-points multipliers clearly labeled as a platform rule, not real bookmaker odds. The advanced-only gate, the 20,000-point stake ceiling, at most one unsettled correct-score ticket per fixture per player, atomic freeze, versioned-odds re-confirmation (`ODDS_CHANGED`) and settlement (an exact score match wins; `OTHER` wins only when the final score falls outside the listed set) are all enforced on the server — hiding the entry in standard rooms is never the authorization boundary. Refunds, idempotency, ledger append and result-correction reversal follow the same 1X2 rules (correct-score has no push). Run `pnpm db:migrate` to apply migration `0015` (adds the room tier) before using advanced rooms.

The `SUPER_ADMIN_*` values are one-shot seed inputs, not a password source of truth. First-login rotation updates only the database hash, clears `must_change_password`, revokes prior sessions, and issues a new browser session. Local `.env` files are intentionally not rewritten, and a later seed run does not reset an existing administrator password.

## Access control and admin governance

Authorization is enforced on the server (domain services, repositories and SQL) — never by hiding UI. Room detail, members, balances, ledger, leaderboard and predictions require room membership; there is no super-admin bypass of private-room content. Prediction selections stay hidden from other members until kickoff. The two seeded super-admins can list and disable/restore normal users, moderate reported rooms (restrict/close/restore) and read system health, each sensitive write requiring a fresh same-origin re-authentication proof valid for at most five minutes. Super-admins cannot modify points, delete predictions or ledger entries, read passwords/recovery codes/session tokens, view pre-kickoff selections, or disable/replace another super-admin, and the product cannot mint a third. `GET /api/v1/admin/audit` returns a single time-ordered governance trail consolidated from the account, room and operations audit stores, with secret-bearing metadata redacted. See `docs/reviews/2026-07-15-admin-rbac-audit.md` for the full permission matrix and audit.

## Rooms are scoped to one sport

A room predicts exactly one sport, chosen at creation and immutable afterwards (`FOOTBALL` or `FORMULA_1`, migration `0018`). The server refuses a ticket whose event belongs to the other sport (`ROOM_SPORT_MISMATCH`); legacy mixed rooms keep their history, and the gate applies to new submissions only. Room pages, the lobby and the prediction slips all render only the chosen sport's events.

## One bet per market

Every sport enforces **one bet per market** (一人一注): a second unsettled ticket on the same market is refused (`MARKET_TICKET_EXISTS`), so a player commits to one judgement instead of averaging across outcomes. Correct score keeps its own stricter per-fixture rule and error code (`SCORE_TICKET_EXISTS`). Existing pending tickets from before the rule keep settling normally; only new submissions are gated.

`GET /api/v1/rooms/:roomId/tickets/mine` restores that placed state after a reload — with `?fixtureId=` for a single event (the F1 session slip) and without it for every unsettled ticket in the room, because the football match list holds one slip per fixture and must not fan out a request per card. The slip then shows a waiting panel instead of the picker; hiding the form is never the authorization boundary.

## Current real football data

The football feed synchronizes the **German 2026/27 competitions** from OpenLigaDB — Bundesliga, 2. Bundesliga, 3. Liga, DFB-Pokal and the Supercup — driven by `OPENLIGADB_COMPETITIONS` (`shortcut:season[:oddsSportKey]`, comma-separated). OpenLigaDB needs no API key. The configured list must always name a live season: a competition that has finished produces no upcoming fixtures, which freezes the match list *and* starves settlement of results. The 2026 World Cup ended 2026-07-19 and is history, not a feed.

Finished, live, and future fixtures remain available in the public match list; users can switch between all, predictable, and finished matches. List reads are bounded to a kickoff window (`now-14d .. now+60d`) so the payload stays well under the CloudBase gateway's ~2 MB response cap. Competition and team names are localized to Chinese.

Real 1X2 odds come from The-Odds-API, one request per distinct sport key per refresh interval (`ODDS_SYNC_INTERVAL_MINUTES`, six hours by default — three sport keys then cost about 360 credits a month, inside the free allowance). Fixtures without a verified bookmaker snapshot receive a clearly labeled platform rule instead: fixed virtual-points multiplier `3.00` for home/draw/away. Kickoff times and results remain supplier data and are never invented. If a source is temporarily unavailable, reads degrade to the latest database cache and the match list says so.

## Formula 1

F1 race weekends carry sessions (qualifying, sprint qualifying, sprint, grand prix) with their own markets: qualifying offers 杆位 (pole), race sessions offer 冠军 (winner) and 领奖台之争 — an exact-podium market where any three drivers can be ordered P1→P2→P3. That market stores per-driver base odds (`DRV:<code>`) and derives each combination's multiplier from a shared domain formula, so all 9,240 ordered combinations are priceable without enumerating them in a snapshot; a `DRV:` entry is a pricing input and is never a bettable selection. The retired `PODIUM` and `H2H` markets are no longer offered, while existing tickets on them still settle.

Session results are imported from Jolpica (the maintained Ergast successor) by `pnpm db:import:f1-results-2026` — idempotent, versioned, never touching a session that has not started, and reporting sprint qualifying as uncovered rather than fabricating a classification. A super-admin can also enter a result by hand. Sessions whose start time has passed are locked (markets closed) by the scheduled sweep.

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

End-to-end journeys (Playwright) and the axe accessibility scan run against a real
server and database. They need migrations plus the F1 and football fixtures
(`pnpm db:migrate`, `pnpm db:seed:f1-2026`, `pnpm db:seed:e2e`, `pnpm db:seed:super-admins`)
and `APP_ENV=test`, which keeps the session cookie usable over plain HTTP:

```bash
pnpm test:e2e
```

`pnpm verify:production-health` asserts read-only data invariants against a
deployed database — a live football feed, recent fixture captures, no ticket left
pending on a confirmed result, no started F1 session left unlocked. The scheduled
sweep runs it every time, because a green pipeline is not by itself proof that the
product is working.

## Health endpoints

- `GET /api/health/live`: process liveness only; never calls databases or suppliers.
- `GET /api/health/ready`: validates runtime configuration, database reachability, and that the migration files shipped in the artifact match `app_schema_migrations` exactly; returns 503 when unready and never calls a supplier. That exact comparison is why a deploy must carry any new `.sql` file, not only the rebuilt app.

## Deployment and scheduled operations

Production runs on Tencent CloudBase function-style hosting; the release
procedure, verification steps and known failure modes are in
[`docs/runbooks/cloudbase-production-deploy.md`](docs/runbooks/cloudbase-production-deploy.md).
`render.yaml` and `vercel.json` are unused alternatives kept for portability.

No resident worker runs in production. `.github/workflows/supplier-sync.yml` is
the only production automation: every two hours it applies migrations, imports
official F1 session results, refreshes football fixtures and odds, closes the
markets of started F1 sessions, and settles every ticket whose result is
confirmed. The competition list must always name a live season — a finished
competition turns the sweep into a silent no-op that freezes the match list and
starves settlement.

## Workspace boundaries

- `apps/web`: Next.js App Router web/PWA and HTTP transport.
- `apps/worker`: the resident scheduler plus the `scheduled-sweep` job that stands in for it where only scheduled invocations run.
- `packages/domain`: framework-free domain boundary — prediction, settlement, F1 pricing and every authorization rule.
- `packages/db`: SQL schema, migrations and repositories.
- `packages/config`: shared runtime configuration validation.
- `packages/contracts`: shared API schemas/contracts.
- `packages/testkit`: shared test builders/fakes added only when needed.
