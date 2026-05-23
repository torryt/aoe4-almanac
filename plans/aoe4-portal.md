# AoE4 Portal — Local-first game log & matchup notes

> **Living document.** The Progress section at the bottom is the source of truth for status. Update it as steps complete.

## Context

Main user mains Knights Templar (`templar`) in AoE4 and wants a private tool that:
1. Auto-imports their ranked games from the public **aoe4world.com** API (no auth required).
2. Lets them log non-ranked games manually.
3. Keeps notes along four dimensions: per-civ general, per-matchup (your civ × opp civ), per-map, and per-game.

Repo `/home/torry/dev/aoe4-portal` starts empty. Target: runs locally now; **schema and architecture are multi-user-ready** so hosting + auth can be added later without data migration.

API choice: **aoe4world** (not RelicLink directly). RelicLink requires Steam-auth gymnastics (see LibreMatch) and is overkill for a single-user log. aoe4world has everything we need, no key required, and exposes a clean `since=`-style cursor.

KT specifics that shaped the design:
- KT is officially a **variant** of `french` but plays nothing like it. Notes treat variants as fully distinct civs; UI surfaces the parent-variant relationship (e.g. "See also: French" link).
- Slug for Knights Templar in aoe4world's data repo is `templar`.

---

## Stack

- **pnpm workspaces** monorepo
- Frontend: **React + Vite + TypeScript**, **TanStack Router** (file-based routes), **TanStack Query**, **Tailwind v4** (low-config default — swap if CSS modules preferred)
- Backend: **Hono** on Node
- DB: **SQLite via `better-sqlite3` + Drizzle ORM** with `drizzle-kit` migrations from commit #1
- Shared: `zod` schemas in `packages/shared`, imported by both apps for end-to-end types
- Tooling: **oxlint** + **oxfmt** at the workspace root
- Editor for notes (MVP): `<textarea>` + `react-markdown` preview tab. Upgrade to tiptap later.

---

## Monorepo layout

```
/home/torry/dev/aoe4-portal/
├── package.json                    # workspace root, private:true
├── pnpm-workspace.yaml             # packages: ['apps/*','packages/*']
├── tsconfig.base.json
├── .oxlintrc.json
├── oxfmt.toml
├── .gitignore                      # node_modules, dist, *.db, ~/.aoe4-portal
├── README.md
├── plans/
│   └── aoe4-portal.md              # THIS FILE
│
├── apps/
│   ├── web/                        # Vite + React + TS
│   │   ├── vite.config.ts          # proxy /api -> http://localhost:3001
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── router.tsx          # TanStack Router
│   │       ├── query.ts            # QueryClient
│   │       ├── routes/             # file-based routes (see below)
│   │       ├── features/{games,notes,sync}/
│   │       ├── components/
│   │       └── lib/api.ts          # typed fetch using shared zod schemas
│   │
│   └── server/                     # Hono + Node
│       ├── drizzle.config.ts
│       └── src/
│           ├── index.ts            # entry; serves /api and built web/dist
│           ├── env.ts              # zod-parsed env (DB path, port, UA)
│           ├── db/{client,schema}.ts + migrations/
│           ├── auth/middleware.ts  # stub resolves the seeded 'local' user
│           ├── routes/{me,civs,games,notes,sync,stats}.ts
│           ├── services/{aoe4world,sync,games,notes,stats}.ts
│           └── scripts/{seed-civs,audit-civ-slugs}.ts
│
└── packages/shared/                # zod schemas + types
    └── src/{api-schemas,domain,index}.ts
```

Root scripts: `pnpm dev` (server + web in parallel), `pnpm build`, `pnpm db:generate|migrate|seed`, `pnpm lint`, `pnpm fmt`.

Same-origin in dev via Vite proxy → **no CORS**.

---

## Database schema (Drizzle / SQLite)

On connection open: `PRAGMA journal_mode=WAL; foreign_keys=ON; synchronous=NORMAL;`.
Timestamps stored as **unix seconds** (integer). Every editable row has `created_at` + `updated_at`.

DB file path: `${AOE4_PORTAL_DB_PATH ?? '~/.aoe4-portal/data.db'}` — **not** in the repo.

### Tables

- **`users`** — `id`, `slug UNIQUE` (seeded `'local'`), `display_name`, nullable `aoe4world_profile_id UNIQUE`, timestamps. One row seeded by migration.
- **`sessions`** — `id (text PK)`, `user_id FK`, `expires_at`, `created_at`. Unused now; auth middleware short-circuits to the `local` user. Wiring real auth later = swap the middleware, no schema change.
- **`civilizations`** — `slug PK`, `name`, nullable `parent_slug`, `is_variant`, `flag_image_url`, `data_json`, timestamps. Seeded from `civs-index.json`. **Not** FK-referenced from elsewhere (so unknown civs don't break inserts).
- **`civ_slug_aliases`** — `alias PK`, `civ_slug` → normalizes any slug variants aoe4world's match payloads use vs civs-index. Grown by the `audit-civ-slugs` script.
- **`maps`** — `id`, `slug UNIQUE` (normalized), `name`, timestamps. Created lazily on first sighting.
- **`games`** — dual-source table. `id`, `user_id FK CASCADE`, `source ('aoe4world'|'manual')`, nullable `aoe4world_game_id` with **partial unique** `(user_id, aoe4world_game_id) WHERE NOT NULL`, `started_at`, `duration_seconds`, `map_slug`, `kind`, `leaderboard`, `patch`, `server`, `my_team`, `my_civ_slug`, `my_civ_randomized`, `my_result`, `my_rating`, `my_rating_diff`, `my_mmr`, `raw_payload_json`, `imported_at`, timestamps. Indexes: `(user_id, started_at DESC)`, `(user_id, my_civ_slug)`, `(user_id, map_slug)`.
- **`game_participants`** — one row per player in the match (incl. self). `id`, `game_id FK CASCADE`, `team`, `is_self`, `profile_id`, `name`, `civ_slug`, `civ_randomized`, `result`, `rating`, `rating_diff`, `mmr`. Indexes on `game_id`, `civ_slug`, `profile_id`. Enables team-game analytics and matchup-stat joins.
- **Notes (four tables, all FK to `user_id` CASCADE, all PUT-upsert idempotent)**:
  - `civ_notes` — UNIQUE `(user_id, civ_slug)`
  - `matchup_notes` — UNIQUE `(user_id, my_civ_slug, opp_civ_slug)` — **ordered pair**; `(templar, mongols)` ≠ `(mongols, templar)`
  - `map_notes` — UNIQUE `(user_id, map_slug)`
  - `game_notes` — UNIQUE `(user_id, game_id)`, FK to `games.id`

  Each has `body_md text not null default ''` + timestamps.
- **`sync_state`** — composite PK `(user_id, leaderboard)`, `last_seen_game_id`, `last_polled_at`, `last_success_at`, `last_error`.

---

## API surface (Hono, mounted at `/api/v1`)

Auth middleware injects `userId` (local user in dev). `@hono/zod-validator` for body/query. Note PUTs are upserts — URL path encodes identity.

```
GET    /me                                  # user + aoe4world link state
GET    /aoe4world/search?q=<name>           # proxied player search
POST   /me/link-aoe4world                   # { profile_id } → triggers backfill
DELETE /me/link-aoe4world

GET    /civs                                # all 23 + variant metadata
GET    /civs/:slug

GET    /games                               # filters: civ, opp_civ, map, result, kind, since, limit, cursor
GET    /games/:id
POST   /games                               # manual entry
PATCH  /games/:id                           # edit manual fields / overrides
DELETE /games/:id                           # source='manual' only

POST   /sync/run                            # { leaderboard?, full? }
GET    /sync/status

GET    /notes/civs                          # index (which civs have notes)
GET/PUT /notes/civs/:slug
GET    /notes/matchups?my_civ=<slug>
GET/PUT /notes/matchups/:my_civ/:opp_civ
GET    /notes/maps
GET/PUT /notes/maps/:slug
GET/PUT /notes/games/:game_id

GET    /stats/by-civ?my_civ=<slug>          # W/L vs each opp civ, 1v1 by default
GET    /stats/by-map
GET    /stats/recent
```

---

## Frontend routes (TanStack Router, file-based)

```
/                                # dashboard: recent games, last sync, KT quick links
/games                           # list + filters
/games/new                       # manual entry form
/games/$gameId                   # detail + per-game note editor
/notes/civs                      # civ index with "has notes" badges
/notes/civs/$slug                # editor + sidebar W/L on this civ
/notes/matchups                  # 23×23 grid; dots show populated notes; variants grouped under parent
/notes/matchups/$myCiv/$oppCiv   # editor + 1v1 stats for this matchup
/notes/maps
/notes/maps/$slug                # editor + map W/L
/settings                        # link aoe4world profile, force sync, sync status
```

Pattern: route loaders prefetch with `queryClient.ensureQueryData`; components use `useSuspenseQuery`; mutations invalidate by tag.

---

## aoe4world sync

- **API client** (`services/aoe4world.ts`): sets `User-Agent: aoe4-portal/0.1` so the maintainer can identify us; single in-flight request per user (mutex); 250ms gap between paginated calls; 30 req/min hard cap; respects 429 with expo backoff (5s → 5min cap), persists `last_error` to `sync_state`.
- **Initial backfill** (on link): full pagination of `/games` without `since=`; transactional insert per page.
- **Steady state** (app open): every 60s poll `/games/last` per tracked leaderboard. If its `game_id > sync_state.last_seen_game_id`, page `/games?since=<last_success_at - 5min>` until backfilled past `last_seen_game_id`.
- **Dedup**: `INSERT ... ON CONFLICT (user_id, aoe4world_game_id) DO NOTHING` — `since=` is a perf hint only, not a correctness mechanism.
- **Re-import / rating recalc**: on a known-safe column subset (`my_rating_diff`, `raw_payload_json`, etc.), use `ON CONFLICT DO UPDATE`. Never touch user-edited columns.
- **Manual sync** button on `/settings`.
- **Match detail**: list payload usually has everything; stash full row as `raw_payload_json`. Only call `/games/:game_id` lazily on the detail page if a field is missing.

### Civ slug normalization

After backfill, run `pnpm db:audit-civ-slugs`. It diffs `game_participants.civ_slug` vs `civilizations.slug` and prints unknown slugs. Commit each as a new `civ_slug_aliases` row.

---

## Design calls worth flagging

- **Variant civs**: KT and French are distinct in every notes dimension. UI shows a "See also: French" link on the KT civ note page; the matchup grid groups variants under parents visually (collapsible). 23 × 23 = 529 matchup cells — rows created lazily via PUT-upsert.
- **Matchup notes are 1v1-scoped by definition.** Team-game matchups (2v2/3v3/4v4) don't map cleanly to "my civ × opp civ"; per-game and per-civ notes carry that load. Stats filters use `kind = 'rm_1v1'`.
- **`civilization_randomized`**: stored on `games` and `game_participants`. Stats UI offers an "exclude randomized" toggle. Matchup notes still file under the rolled civ — that's the matchup that actually happened.
- **Manual entries**: minimum fields = `started_at`, `my_civ_slug`, `my_result`. Optionally attach one opponent (`game_participants` row, `is_self=0`) so manuals show in matchup stats.

---

## Multi-user retrofit checklist (validated up front)

- Every user-owned row has `user_id`. ✓
- `sessions` table exists; auth middleware is a swap point, not a refactor. ✓
- No globals keyed by "the user" — `userId` passed through every service call.
- `aoe4world` client accepts a config object so adding an API key later is one line.

---

## Files that will be central

- `apps/server/src/db/schema.ts` — full Drizzle schema
- `apps/server/src/db/client.ts` — SQLite pragmas + Drizzle instance
- `apps/server/src/services/aoe4world.ts` — rate-limited API client
- `apps/server/src/services/sync.ts` — backfill + cursor logic
- `apps/server/src/auth/middleware.ts` — stub user resolution
- `apps/server/src/routes/notes.ts` — PUT-upsert handlers
- `apps/server/src/scripts/seed-civs.ts` — pulls civs-index.json
- `apps/server/src/scripts/audit-civ-slugs.ts` — discovers slug aliases
- `apps/web/src/router.tsx` — TanStack Router tree
- `apps/web/src/routes/notes/matchups.tsx` — 23×23 grid w/ variant grouping
- `packages/shared/src/api-schemas.ts` — single source of truth for request/response shapes

---

## Verification

End-to-end smoke once landed:

1. `pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev`.
2. Open `http://localhost:5173` → `/settings`. Search your in-game name → select profile → backfill kicks off. Watch `/api/v1/sync/status` until `last_seen_game_id` is populated.
3. `/games` shows recent ranked games with civs, maps, W/L, rating delta.
4. `/games/new` — log a manual game (e.g. a custom KT vs Mongols) with one opp participant. Confirm it appears in the list and in matchup stats.
5. `/notes/civs/templar` — write a KT general note, save, reload, confirm persistence.
6. `/notes/matchups/templar/mongols` — write a matchup note. Confirm it shows on the matchup grid (`/notes/matchups`) with a "has notes" indicator on the (templar, mongols) cell.
7. `/notes/maps/<one-of-your-maps>` — same.
8. Open a 1v1 game detail page, attach a per-game note, confirm it survives a reload.
9. Restart server (`pnpm dev`), confirm all data persists from `~/.aoe4-portal/data.db`.
10. Run `pnpm db:audit-civ-slugs` — confirm zero unknown slugs (or commit the aliases it surfaces).
11. `pnpm lint` (oxlint) and `pnpm fmt` (oxfmt) both clean.

---

## Progress

> Source of truth for status. Update inline as work proceeds. Use `[ ]` / `[~]` (in progress) / `[x]` (done). Add a one-line note when something is non-obvious (date, decision, blocker).

### Step 1 — Scaffold workspace + root tooling ✓
- [x] `package.json` (root, private), `pnpm-workspace.yaml`, `.gitignore`, `tsconfig.base.json`
- [x] `.oxlintrc.json`, `oxfmt.toml`
- [x] `README.md` (one-paragraph what/how)
- [x] `pnpm.onlyBuiltDependencies` allows `better-sqlite3` + `esbuild` postinstall scripts

### Step 2 — `packages/shared` ✓
- [x] `domain.ts` (zod-typed Civ, Game, Participant, Result, …)
- [x] `api-schemas.ts` (request/response schemas for every endpoint)

### Step 3 — `apps/server` skeleton ✓
- [x] Hono on `127.0.0.1:3001`
- [x] `env.ts` zod-parsed (port, DB path, user-agent)
- [x] `db/client.ts` with WAL + foreign_keys + busy_timeout pragmas
- [x] `drizzle.config.ts`

### Step 4 — Drizzle schema + initial migration + seed ✓
- [x] `db/schema.ts`: users, sessions, civilizations, civ_slug_aliases, maps, games, game_participants, civ_notes, matchup_notes, map_notes, game_notes, sync_state
- [x] First migration generated and applied (`0000_far_tombstone.sql`)
- [x] `scripts/seed-civs.ts` pulls civs-index.json — 23 civs seeded, variants tagged via curated parent map
- [x] `users('local')` row created by seed

### Step 5 — Auth stub + initial routes ✓
- [x] `auth/middleware.ts` resolves `local` user
- [x] `/me`, `/me/link-aoe4world` (POST/DELETE), `/me/sync-now`
- [x] `/civs` list + `/civs/:slug`
- [x] `/notes/{civs,matchups,maps,games}/...` GET + PUT upsert
- [x] `POST /games` (manual entry, optionally with opponent + first game note)
- [x] `/aoe4world/search` proxy

### Step 6 — `apps/web` scaffold ✓
- [x] Vite 8 + React 19 + TS + Tailwind v4 + TanStack Router (file-based) + TanStack Query
- [x] Vite dev proxy `/api → 3001`
- [x] `lib/api.ts` typed fetch + query-key registry
- [x] `/settings` page: aoe4world search, link, sync now, full backfill, unlink

### Step 7 — Sync engine ✓
- [x] `services/aoe4world.ts`: User-Agent header, single-flight mutex, 250ms minimum gap, 30 req/min cap, exponential backoff on 429/5xx
- [x] `services/sync.ts`: link → full backfill, `runSync` mutex per user, `since=` cursor with 5-min cushion, dedup by partial-unique `(user_id, aoe4world_game_id)`, replace-then-insert participants
- [x] `services/normalize.ts`: civ slug normalization + alias lookup, map slug normalization, lazy `maps` ensure
- [x] `POST /sync/run`, `GET /sync/status`
- [x] `/games` list with filters (civ, opp_civ, map, result, kind, leaderboard, since, cursor)

### Step 8 — Games UI ✓
- [x] `/games` table with filter dropdowns (civ, opp, result, kind)
- [x] `/games/$gameId` detail: participants table, rating delta, link to aoe4world, per-game markdown notes
- [x] `/games/new` manual entry form (started_at, civs, result, opponent, map, duration, kind, notes)

### Step 9 — Civ + matchup notes UI ✓
- [x] `/notes/civs` index — base civs with variants nested under parent, "has notes" indicator
- [x] `/notes/civs/$slug` — markdown editor, W/L sidebar, top opponents, See-also for parent/variants
- [x] `/notes/matchups` — 23×23 grid (variants grouped under parent), green dot where notes exist; filter by my-civ
- [x] `/notes/matchups/$myCiv/$oppCiv` editor + 1v1 record sidebar + reverse-matchup link

### Step 10 — Map notes + stats + dashboard ✓
- [x] `/notes/maps` index showing maps you've played sorted by game count
- [x] `/notes/maps/$slug` editor + map record sidebar
- [x] `/stats/by-civ`, `/stats/by-map`, `/stats/recent` endpoints
- [x] Dashboard `/` wires up recent games list, sync status, and KT quick links

### Step 11 — Polish ✓
- [x] `scripts/audit-civ-slugs.ts` written and ready (run after first backfill to surface unknown slugs)
- [x] `pnpm exec oxlint` clean — 0 errors, only intentional rate-limiter warnings remain
- [x] `pnpm exec tsc --noEmit` clean for all three workspaces (shared, server, web)
- [x] `pnpm --filter @aoe4-portal/web build` succeeds (342 modules, 362 KB main bundle)

### Run it
```
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev      # vite on :5173, hono on :3001
```
Open http://localhost:5173, go to Settings → search your aoe4world name → Link → backfill runs.

### Verified during this session
- ✓ Server boots, `/healthz` and `/api/v1/me` return.
- ✓ `/api/v1/civs` returns all 23 civs with correct variant→parent mapping (templar→french, etc.).
- ✓ `PUT /api/v1/notes/civs/templar` + `GET` round-trip.
- ✓ `PUT /api/v1/notes/matchups/templar/mongols` + `GET` round-trip.
- ✓ `POST /api/v1/games` (manual KT-vs-Mongols custom game) creates row, participants, and game note transactionally.
- ✓ `/api/v1/aoe4world/search?q=Beasty` returns live results.
- ✓ `POST /api/v1/me/link-aoe4world` accepts profile_id and kicks off backfill.
- ✓ Vite serves index.html; route bundles compile; full `vite build` succeeds.
- ✓ Lint + typecheck clean across all packages.

### Known follow-ups (not blocking)
- The aoe4world `inFlight` mutex serializes ALL outbound calls (including the search proxy) — for a single-user local app this is fine; revisit if hosting.
- Sync of huge accounts (10k+ games like pro players) will burn through the 30-req/min cap and the synchronous-better-sqlite3 inserts will briefly starve the event loop between API calls. For a normal player profile (hundreds of games) it's a few seconds.
- The matchups index page has one ugly `window.location.search = …` shortcut in the civ-picker `<select>` (works, but should be replaced with `useNavigate` for cleaner SPA navigation).
- No real auth yet; everything resolves to the seeded `local` user via the stub middleware. The `sessions` table exists so plugging in cookie auth later is a middleware swap.
- Server "build" currently runs from source via `tsx`. Add a proper esbuild bundle when shipping to a real host.

### Decisions log
- 2026-05-23 — Chose aoe4world REST API over RelicLink for sync (no Steam-auth gymnastics; everything we need is exposed unauthenticated).
- 2026-05-23 — Variants treated as fully distinct civs in all notes dimensions; civilizations.parent_slug exists only to drive UI grouping (matchup grid + "See also" link).
- 2026-05-23 — Matchup notes restricted to 1v1 by convention. Team-game notes go on per-civ + per-game.
- 2026-05-23 — Variant parents seeded from a curated map in `seed-civs.ts` (civs-index.json doesn't expose parent relationships in a usable form).
- 2026-05-23 — Server runs via `tsx` in both dev and `start` for now; no bundled build until hosting.

### Open questions / blockers
- _(none right now)_

---

## Diagnostic / observability additions (2026-05-23)

### Mutex bug fixed in `services/aoe4world.ts`
`withMutex` was assigning `inFlight = p.finally(() => { if (inFlight === p) inFlight = undefined; })`. The closure compared `inFlight === p`, but `inFlight` was set to the *wrapped* finally-promise, not `p`. So `inFlight` was never cleared, and every subsequent caller spun forever in `while (inFlight) { await inFlight; }` (the wrapped promise was already resolved, so the await returned immediately, but the loop condition was still truthy → unbounded microtask loop, event-loop starvation, all subsequent HTTP requests hung). Fix: capture `wrapped` in the closure and compare against that.

### OpenTelemetry instrumentation
`apps/server/src/telemetry.ts` registers a `NodeTracerProvider` with a custom compact one-line ConsoleSpanExporter. Manual spans cover:
- Every incoming HTTP request (via `verboseLogger` middleware → also assigns an 8-char `reqId`)
- `link.profile_and_backfill`
- `aoe4world.{searchPlayers, getPlayer, getLastGame, getGamesPage, fetch, fetchJsonWithBackoff, withMutex, pace}`
- `sync.run`

Each span ends with a line like:
```
[otel a1b2c3d4 abc123 <-def456]     5.3ms  POST /api/v1/me/link-aoe4world  http.response.status_code=200 req.id=a1b2c3d4
```

### Verbose request logger
`apps/server/src/middleware/verboseLogger.ts` replaces `hono/logger`. Logs:
```
[req a1b2c3d4] → POST /api/v1/me/link-aoe4world body={"profile_id":1270139}
[req a1b2c3d4] link-aoe4world kicked off backfill profile_id=1270139
[req a1b2c3d4] ← 200 4.1ms POST /api/v1/me/link-aoe4world
```
plus per-stage sync logs (`sync.start`, `sync.page`, `sync.done`).

### SSE sync progress + UI spinner
- `GET /api/v1/sync/events` streams Server-Sent Events of types `link.player_fetched`, `sync.started`, `sync.page`, `sync.completed`, `sync.error`.
- `apps/server/src/services/syncEvents.ts` is the in-process broker; sync emits into it.
- `apps/web/src/lib/useSyncEvents.ts` React hook subscribes via `EventSource` and aggregates state.
- Settings page shows a coloured live progress panel (active → amber spinner; completed → green; error → red) with page #, games imported so far, and final summary.
- Dashboard sync card shows a compact inline spinner during active sync.
- All action buttons (Search, Link, Sync now, Full backfill, Unlink) show the `Spinner` component while their mutation is pending.
