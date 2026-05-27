# AGENTS.md

Two backends, kept in sync:
- **Tauri (`src-tauri/`)** — main backend (Rust, local SQLite).
- **Node (`apps/server/`)** — also used (TS + Hono).

Backend changes (routes, queries, schema) must be applied to **both** — a fix on one side only causes divergent behavior depending on transport.
