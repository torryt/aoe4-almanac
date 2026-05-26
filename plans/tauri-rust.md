# Ship aoe4-almanac as a Tauri app (Rust backend, no Node sidecar)

## Goal

Replace the Hono/Node server with a Rust backend embedded directly in a Tauri
v2 shell. The React/Vite frontend ships as the Tauri webview; all backend
calls move from `fetch('/api/v1/…')` to `invoke('cmd_…')`. No bundled Node
runtime, no localhost HTTP listener.

## Why this works for this app

- Single-user local app. Auth middleware is a hard-coded `local` user lookup
  (`apps/server/src/auth/middleware.ts`) — no sessions, cookies, or
  multi-tenant concerns to preserve over IPC.
- DB is already local SQLite at `~/.aoe4-almanac/data.db`. Drizzle has emitted
  plain `.sql` migrations under `apps/server/src/db/migrations/` that Rust
  can run as-is.
- Web → server contract is a single thin wrapper (`apps/web/src/lib/api.ts`,
  ~50 LOC of fetch). One file changes to swap fetch for `invoke`.
- Server is ~2200 LOC of straightforward CRUD + one sync service. Nothing
  exotic to port (no streaming uploads, no auth flows, no websockets — just
  one SSE-style pubsub for sync progress, which maps cleanly to Tauri events).

## Architecture

```
┌─ Tauri shell (Rust) ──────────────────────────────────┐
│  src-tauri/                                            │
│    src/                                                │
│      main.rs            ← tauri::Builder, command list │
│      db/                ← rusqlite pool + migrations   │
│        schema.sql       ← copied from drizzle output   │
│      commands/          ← one file per old route group │
│        me.rs games.rs notes.rs civs.rs                 │
│        opponents.rs stats.rs sync.rs aoe4world.rs      │
│      services/                                         │
│        sync.rs          ← port of services/sync.ts     │
│        aoe4world.rs     ← reqwest client               │
│        normalize.rs                                    │
│      events.rs          ← tauri::AppHandle.emit(...)   │
│      error.rs           ← serde-able AppError          │
│    tauri.conf.json                                     │
│    Cargo.toml                                          │
│                                                        │
│  Webview loads apps/web build output                   │
│    api.ts uses @tauri-apps/api/core invoke()           │
└────────────────────────────────────────────────────────┘
```

Crate choices:
- `tauri` v2 (stable, has `emit` for events, better mobile story if ever wanted).
- `rusqlite` with `bundled` feature (matches better-sqlite3 semantics, no
  system libsqlite dependency, easy cross-compile). Bundle a single connection
  behind a `Mutex` in `tauri::State` — the existing server already serialises
  through one `better-sqlite3` handle.
- `reqwest` (blocking is fine inside `tokio::task::spawn_blocking`, or use
  async — pick one and stay consistent) for aoe4world.com calls.
- `serde` + `serde_json` for DTOs. No need for a validation crate: input
  payloads are typed at the `invoke` boundary; serde decode failure is the
  validation.
- `thiserror` for `AppError`; serializes to a `{code, message}` shape the web
  layer already understands via `ApiError`.
- `refinery` or hand-rolled migration runner reading the drizzle `.sql` files
  from `OUT_DIR` via `include_str!`. Hand-rolled is ~30 LOC and avoids a dep.

## Migration plan (incremental, keeps app working)

### Phase 0 — scaffold (1 commit)
- `pnpm create tauri-app` is overkill; instead add `src-tauri/` by hand at the
  repo root with `tauri.conf.json` pointing `frontendDist` at
  `apps/web/dist` and `devUrl` at `http://localhost:5173`.
- Add a root `tauri` script: `pnpm tauri dev` proxies to
  `cargo tauri` after `pnpm --filter @aoe4-almanac/web dev` is up. Use the
  `beforeDevCommand` / `beforeBuildCommand` hooks in `tauri.conf.json`.
- Stand up an empty `App` with one smoke command (`ping`) and confirm
  `invoke('ping')` works from a temporary button in the web app.

### Phase 1 — DB + migrations in Rust (1 commit)
- Port `apps/server/src/env.ts:resolveDbPath` → Rust using `dirs::home_dir()`
  (`~/.aoe4-almanac/data.db` on all OSes; on Windows this becomes
  `%USERPROFILE%\.aoe4-almanac\data.db`, matching current behavior).
- Embed the two `.sql` files via `include_str!` and run them in order against
  the existing `__drizzle_migrations` table (or a parallel
  `__rust_migrations` table — pick one and document; reusing drizzle's table
  means a fresh Tauri install on top of an existing data.db is a no-op).
- Set the same pragmas as `db/client.ts`: WAL, foreign_keys=ON,
  synchronous=NORMAL, busy_timeout=5000.
- **Backup before first run**: before applying any migrations on an existing
  DB, copy `data.db` to `data.db.bak-<ISO-timestamp>` in the same directory
  (also copy `-wal` / `-shm` sidecars if present). Skip if no DB file exists
  yet. Keep the backup unconditionally — if a user hits a migration bug,
  they can restore by hand. A simple `std::fs::copy` is enough; do it
  inside the migration runner before the first `ALTER`/`CREATE`.
- Seed step: port `scripts/seed-civs.ts`. The civs list lives in
  `packages/shared` (check) — re-read it from there at build time via a
  `build.rs` that copies the JSON into the binary, or just hand-translate
  into a `civs.json` under `src-tauri/resources/` and load with
  `include_str!`. Build-time copy keeps `packages/shared` as the source of
  truth.

### Phase 2 — port read-only routes first (3-4 commits)
Order by complexity, lowest first. Each commit: port the Rust command, switch
the corresponding `api.ts` call to `invoke`, delete the Hono route.

1. `civs.ts` (42 LOC) — single select, ideal canary.
2. `me.ts` (230 LOC) — me, preferences, link/unlink, data counts, rating info.
   Splits naturally into `cmd_me`, `cmd_get_preferences`,
   `cmd_set_preferences`, `cmd_link_profile`, `cmd_unlink_profile`,
   `cmd_data_counts`, `cmd_rating_info`.
3. `stats.ts` (192 LOC) — pure SQL aggregations; map each handler to a
   command, keep the SQL strings nearly verbatim.
4. `opponents.ts` (258 LOC) — same shape as stats.
5. `games.ts` (159 LOC) — list + by-id; watch the filter object → struct
   translation.
6. `notes.ts` (244 LOC) — civ / matchup / map / game notes; biggest surface
   area but mechanically identical to the others. Port the test file
   (`notes.test.ts`) to `#[cfg(test)]` in Rust using `tempfile` for an
   ephemeral DB.

### Phase 3 — sync service (1-2 commits, biggest port)
- Port `services/aoe4world.ts` (276 LOC) using `reqwest`. The aoe4world.com
  API is pagination + JSON; this is straightforward but largest single
  translation unit.
- Port `services/normalize.ts` (73 LOC).
- Port `services/sync.ts` (450 LOC). Replace the in-process pubsub
  (`syncEvents.ts`) with `app_handle.emit("sync", &payload)`. Web side:
  swap the SSE consumer for `listen('sync', cb)` from
  `@tauri-apps/api/event`.
- Concurrency: today `sync.ts` enforces single-flight via a module-level
  flag; in Rust use a `tokio::sync::Mutex<Option<JoinHandle<_>>>` in
  `tauri::State`.
- HTTP user agent: currently sourced from env (`AOE4_ALMANAC_USER_AGENT`).
  Bake the default into the Rust constant and keep an env override for
  development.

### Phase 4 — frontend wiring (1 commit)
- Rewrite `apps/web/src/lib/api.ts`:
  - Replace the `request()` body with `import { invoke } from
    '@tauri-apps/api/core'`. Keep the `api.get/post/put/patch/delete` shape
    so call sites don't change: each helper maps `(path, body)` to a
    command name + args. Easiest: keep the URL-style paths and let `api.ts`
    translate `/me` → `cmd_me`, `/games?foo=bar` → `cmd_games_list({foo})`,
    etc. via a small mapping table.
  - Or, more idiomatic: replace each call site with a typed wrapper
    (`getMe()`, `listGames(filter)`, …). Cleaner but ~30-40 touch points.
    Recommend the mapping-table approach first to keep this phase mechanical,
    then refactor to typed wrappers in a follow-up if desired.
- Replace SSE subscription with Tauri event listener (one file —
  whichever component owns `useSyncStatus`).
- Vite dev still works inside `tauri dev` because `devUrl` points at Vite;
  `invoke` is provided by the Tauri runtime in the webview context. For
  pure-browser `pnpm --filter @aoe4-almanac/web dev`, ship a thin
  `__TAURI__`-gated shim that surfaces a clear "must run inside Tauri" error
  — or keep the Hono server alive in a `legacy/` directory through Phase 3
  so browser dev keeps working until cutover.

### Phase 5 — packaging + delete the Node server (1 commit)
- `tauri.conf.json` bundle targets: `dmg`, `app`, `msi`, `nsis`, `deb`,
  `appimage`. Sign config left empty initially (unsigned builds for personal
  use); add signing later if distributing publicly.
- Icons: generate with `cargo tauri icon` from a single source PNG.
- App id: `com.torryt.aoe4-almanac` (or similar — pick before
  first signed build, hard to change later).
- Delete `apps/server/` once Phase 4 is verified end-to-end. Remove from
  `pnpm-workspace.yaml`. Move `apps/server/src/db/migrations/*.sql` into
  `src-tauri/migrations/` first.
- Update root `package.json` scripts: `dev` runs `tauri dev`, `build` runs
  `tauri build`. Drop `db:migrate` / `db:seed` (Rust runs them on app start).

## Things that need decisions before starting

1. **Migration table reuse**: keep drizzle's `__drizzle_migrations` table
   semantics, or start a fresh `__rust_migrations`?
   - Reuse: existing local DBs upgrade in place, no special case.
   - Fresh: cleaner, but need a one-time "if drizzle table exists, treat all
     its migrations as applied" check on first run.
   - Recommend **reuse**.

2. **api.ts strategy**: mapping table (mechanical) vs typed wrappers
   (idiomatic). Recommend mapping table for the cutover commit, refactor
   afterwards.

3. **App ID & display name**: locked in at first signed build. Need a
   decision before Phase 5.

4. **Browser dev story**: do we want to keep `pnpm --filter web dev` working
   in a plain browser (requires keeping Hono server alive or building a
   mock-invoke layer), or commit fully to Tauri-only dev? Recommend
   **Tauri-only**; the Vite HMR experience inside `tauri dev` is the same.

5. **CI**: cross-compiling Tauri on GitHub Actions needs platform-specific
   runners (`macos-14`, `windows-latest`, `ubuntu-22.04`). Adding a release
   workflow is a separate task — flag it but don't block the port on it.

## Risks / unknowns

- **aoe4world.com client**: 276 LOC of pagination + retry logic. This is the
  one place a port could subtly differ from the TS version. Mitigate by
  running both side-by-side against a fixed aoe4world profile during Phase 3
  and diffing the resulting DB rows.
- **`better-sqlite3` synchronous semantics**: the current code is fully
  synchronous and relies on it (auth middleware does a sync `.get()`).
  `rusqlite` is also synchronous; do all DB work inside
  `tokio::task::spawn_blocking` or use `tauri::async_runtime::spawn_blocking`.
  Don't reach for `sqlx` — async SQLite buys nothing here.
- **WSL dev**: you're on WSL2. `tauri dev` needs a Linux GUI; works under
  WSLg but icons/tray may behave oddly. Production builds happen per-OS
  anyway, so this is just a dev-loop annoyance.
- **Migrations on existing local DBs**: anyone with the current Node app
  installed locally has a `data.db` already. The reuse-drizzle-table
  approach above handles this transparently; verify with a copy of your
  own data.db before shipping.

## Effort estimate

Per phase (rough, assuming familiarity with Tauri + Rust):

| Phase | Scope                              | Effort |
|-------|------------------------------------|--------|
| 0     | Scaffold + smoke command           | 0.5 d  |
| 1     | DB + migrations + seed             | 0.5 d  |
| 2     | 6 route files → commands           | 2-3 d  |
| 3     | Sync service (the hard one)        | 2 d    |
| 4     | Frontend wiring + SSE → events     | 0.5 d  |
| 5     | Bundle config, delete server       | 0.5 d  |
|       | **Total**                          | **6-7 d** |

Phase 3 is where surprises hide; everything else is mechanical translation.
