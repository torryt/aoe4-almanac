# aoe4-almanac

Local-first web app to log Age of Empires IV games (auto-imported from [aoe4world.com](https://aoe4world.com)) and keep notes on civs, matchups, maps, and individual games.

See `plans/aoe4-almanac.md` for the full design and live progress tracker.

## Stack

- pnpm workspaces
- React + Vite + TypeScript (`apps/web`)
- Hono on Node + better-sqlite3 + Drizzle ORM (`apps/server`)
- Shared zod schemas (`packages/shared`)
- oxlint + oxfmt

## Run locally

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Web on http://localhost:5173, server on http://localhost:3001. Visit `/settings` to link your aoe4world profile and trigger backfill.

The SQLite DB lives at `~/.aoe4-almanac/data.db` by default (override via `AOE4_ALMANAC_DB_PATH`).
