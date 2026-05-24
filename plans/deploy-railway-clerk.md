## Deploy: Railway + Clerk + SQLite

> **Living document.** The Progress section at the bottom is the source of truth for status. Update it as steps complete.

## Context

`aoe4-almanac` currently runs locally as a single-user app: SQLite at `~/.aoe4-almanac/data.db`, a hardcoded `local` user resolved by `apps/server/src/auth/middleware.ts`, Hono serves `/api/v1/*` and (if `AOE4_ALMANAC_WEB_DIST` is set) the built React bundle from the same process.

Goal: a public deployment with real user accounts where notes/games are private per user, with the smallest reasonable amount of work and ops.

Decisions made before this plan:
- **Hosting: Railway.** Persistent volume support for SQLite, deploy-from-git, ~$5/mo. Picked over Fly.io for reliability/DX; picked over a raw VPS because we don't want to own TLS / systemd / OS updates.
- **Auth: Clerk.** Email+password with full reset flow + Google OAuth, hosted UI, ~zero auth code on our side. Free up to 10k MAU. Picked over Better-Auth because the user wants the easiest possible onboarding and is OK with a managed auth vendor.
- **DB: SQLite stays.** No migration to Postgres or Turso. We add a `clerk_user_id` column to the existing `users` table and keep the internal autoincrement `id` as the FK that all domain tables already reference.
- **Backups: Litestream → Cloudflare R2.** Continuous replication; restore on boot if `/data/data.db` is missing. R2 has no egress fees, ~$0/mo at our size.

Non-goals for this deploy:
- Multi-region. Single Railway region; SQLite is single-writer anyway.
- Zero-downtime deploys. Brief drop during container swap is acceptable.
- Migrating existing local data to the hosted instance (different DBs; local stays local).

---

## Architecture after deploy

```
                ┌──────────────────────┐
   browser ────▶│  Railway service     │
                │  (single container)  │
                │                      │
                │  Hono on Node :3001  │
                │   ├─ /api/v1/*  ────▶│  better-sqlite3 → /data/data.db
                │   └─ /*  (SPA)       │              │
                │                      │              ▼
                │  Litestream sidecar  │     Cloudflare R2 (WAL replication)
                └──────────────────────┘
                          │
                          ▼
                  Clerk (JWT verify)
                  api.clerk.com
```

- One Railway service, one Docker image, one volume mounted at `/data`.
- Clerk handles signup/login/reset entirely in the browser via `@clerk/clerk-react`. Frontend attaches a Clerk JWT (`Authorization: Bearer …`) to every `/api/v1/*` call.
- Server verifies the JWT with Clerk's JWKS (cached), looks up or creates a row in `users` keyed by `clerk_user_id`, sets `c.userId`. **No route changes** — every route already reads `c.get("userId")`.
- Litestream runs in the same container, replicates `/data/data.db` to R2 continuously, restores from R2 on cold start if the volume is empty.

---

## What changes in the code

### 1. Schema — add Clerk identity to `users`

`apps/server/src/db/schema.ts`:

```ts
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),              // keep; becomes display handle
    displayName: text("display_name").notNull(),
    clerkUserId: text("clerk_user_id"),        // NEW — nullable for the seeded `local` row
    email: text("email"),                      // NEW — convenience copy from Clerk JWT
    aoe4worldProfileId: integer("aoe4world_profile_id"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    slugUq: uniqueIndex("users_slug_uq").on(t.slug),
    clerkIdUq: uniqueIndex("users_clerk_id_uq").on(t.clerkUserId),
    profileIdUq: uniqueIndex("users_profile_id_uq").on(t.aoe4worldProfileId),
  }),
);
```

- `sessions` table stays in schema for now but goes unused (Clerk owns sessions). Drop in a later migration once we're sure.
- Generate migration: `pnpm db:generate`. Commit the SQL.

### 2. Auth middleware — verify Clerk JWT, upsert user, set `userId`

Replace `apps/server/src/auth/middleware.ts`:

```ts
// pseudocode
import { verifyToken } from "@clerk/backend";

export async function authMiddleware(c, next) {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return c.json({ error: "unauthorized" }, 401);

  const claims = await verifyToken(auth.slice(7), {
    secretKey: env().CLERK_SECRET_KEY,
    // or jwtKey for offline JWKS verification — preferred, no Clerk roundtrip
  });

  const clerkUserId = claims.sub;
  const email = claims.email ?? null;

  // upsert — idempotent, runs once per new user
  let row = db().select({ id: users.id })
    .from(users).where(eq(users.clerkUserId, clerkUserId)).get();

  if (!row) {
    const slug = generateUniqueSlug(email ?? clerkUserId);
    const inserted = db().insert(users).values({
      slug, displayName: email ?? slug, clerkUserId, email,
    }).returning({ id: users.id }).get();
    row = inserted;
  }

  c.set("userId", row.id);
  await next();
}
```

- Use `jwtKey` (PEM from Clerk dashboard) for offline verification — no network call per request. Cache nothing else; verification is cheap.
- `generateUniqueSlug` strips `@domain`, lowercases, suffixes on collision. Keep slugs stable once assigned.
- Dev escape hatch: if `NODE_ENV=development` and no `CLERK_SECRET_KEY`, fall back to the old `local` user resolver so local dev keeps working without Clerk keys.

### 3. Env additions

`apps/server/src/env.ts`:

```ts
CLERK_SECRET_KEY: z.string().optional(),       // required in prod; dev falls back
CLERK_JWT_KEY: z.string().optional(),          // PEM for offline verification
AOE4_ALMANAC_DB_PATH: ...                      // already exists — set to /data/data.db in prod
```

`apps/web/.env.production`:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_API_BASE_URL=/api/v1
```

### 4. Frontend — wrap with `<ClerkProvider>`, attach JWT to API calls

`apps/web/src/main.tsx`: wrap the router in `<ClerkProvider publishableKey={…}>`.

`apps/web/src/lib/api.ts` (or wherever `fetch` lives): pull token via `useAuth().getToken()` and add to every request. With TanStack Query, the cleanest path is a `fetcher` that takes the token from a `useAuth()` ref captured at QueryClient setup.

Route protection: wrap the authenticated routes in TanStack Router with a `beforeLoad` that checks `useAuth().isSignedIn`, redirects to `/sign-in` if not.

Pages to add (Clerk gives prebuilt components):
- `/sign-in` — `<SignIn />`
- `/sign-up` — `<SignUp />`
- `/user` (optional) — `<UserProfile />`

That's the whole UI for auth. No password reset page to build; Clerk handles it inside `<SignIn />`.

### 5. Privacy audit — confirm every domain query is user-scoped

All routes already pull `userId` from context (verified via grep on `c.get("userId")` in `routes/`). Before deploying, walk each `routes/*.ts` file once and confirm every query that touches `games`, `notes`, `opponents`, etc. has a `where(eq(table.userId, userId))` clause and that no route accepts a client-supplied `userId`. This is the single biggest correctness risk of going multi-tenant on a schema that started single-user.

---

## Files to add/change

```
apps/server/
├── Dockerfile                              # NEW
├── litestream.yml                          # NEW
├── docker-entrypoint.sh                    # NEW — restore-if-empty then exec node + litestream
├── src/
│   ├── auth/middleware.ts                  # REWRITE — Clerk JWT verify + user upsert
│   ├── env.ts                              # add CLERK_SECRET_KEY, CLERK_JWT_KEY
│   ├── db/schema.ts                        # add clerk_user_id, email to users
│   └── db/migrations/00xx_clerk_users.sql  # generated
└── package.json                            # add @clerk/backend

apps/web/
├── src/main.tsx                            # wrap in <ClerkProvider>
├── src/lib/api.ts                          # attach Clerk JWT
├── src/routes/sign-in.tsx                  # NEW — <SignIn />
├── src/routes/sign-up.tsx                  # NEW — <SignUp />
├── src/routes/__root.tsx                   # auth guard for protected routes
└── package.json                            # add @clerk/clerk-react

repo root/
├── railway.json                            # NEW — service config
├── .dockerignore                           # NEW
└── plans/deploy-railway-clerk.md           # THIS FILE
```

---

## Dockerfile (single-stage, multi-app build)

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @aoe4-almanac/shared run build \
 && pnpm --filter @aoe4-almanac/web run build

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
 && curl -L https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.deb -o /tmp/ls.deb \
 && dpkg -i /tmp/ls.deb && rm /tmp/ls.deb \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
ENV AOE4_ALMANAC_DB_PATH=/data/data.db \
    AOE4_ALMANAC_WEB_DIST=/app/apps/web/dist \
    HOST=0.0.0.0 \
    PORT=3001 \
    NODE_ENV=production
COPY apps/server/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

Server is run via `tsx` per its current `start` script — no separate compile step. Keep it.

## `docker-entrypoint.sh`

```sh
#!/bin/sh
set -e
mkdir -p /data
if [ ! -f /data/data.db ] && [ -n "$LITESTREAM_REPLICA_URL" ]; then
  echo "Restoring DB from Litestream replica…"
  litestream restore -if-replica-exists -o /data/data.db "$LITESTREAM_REPLICA_URL" || true
fi
cd /app/apps/server
pnpm db:migrate
exec litestream replicate -exec "pnpm start" -config /app/apps/server/litestream.yml
```

## `litestream.yml`

```yaml
dbs:
  - path: /data/data.db
    replicas:
      - url: ${LITESTREAM_REPLICA_URL}   # s3://aoe4-almanac-backup/db
        # R2 creds via env: LITESTREAM_ACCESS_KEY_ID, LITESTREAM_SECRET_ACCESS_KEY
        # endpoint for R2:  LITESTREAM_S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
        retention: 168h
        snapshot-interval: 24h
```

---

## Railway setup

1. **Create project from this GitHub repo.** Railway auto-detects Dockerfile.
2. **Add a Volume**, mount path `/data`, 1 GB to start.
3. **Set env vars** in the Railway service:
   - `CLERK_SECRET_KEY` — from Clerk dashboard (production instance)
   - `CLERK_JWT_KEY` — PEM, from Clerk dashboard → API keys
   - `LITESTREAM_REPLICA_URL` — e.g. `s3://aoe4-almanac-backup/db`
   - `LITESTREAM_S3_ENDPOINT` — R2 endpoint
   - `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` — R2 API token
   - `AOE4_ALMANAC_USER_AGENT` — production string with real contact URL
4. **Build settings**: leave default; Dockerfile path `apps/server/Dockerfile` *or* keep at repo root if we put it there (TBD — root is simpler).
5. **Generate a public domain** in Railway → Settings → Networking. Note the URL.
6. **Configure Clerk allowed origins** to that URL.
7. Trigger deploy. First boot: `db:migrate` runs, Litestream has nothing to restore, app starts on port 3001, Railway proxies 443→3001.

`railway.json` (optional but nice for reproducibility):

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": {
    "startCommand": "/usr/local/bin/entrypoint.sh",
    "healthcheckPath": "/healthz",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

---

## Clerk setup

1. Create Clerk app → choose **Email + Password** and **Google** as sign-in methods.
2. Enable **email verification** and **password reset** (defaults).
3. Customize the sign-in/sign-up page branding (optional).
4. From **API Keys**:
   - copy `Publishable key` → `VITE_CLERK_PUBLISHABLE_KEY` (frontend build env)
   - copy `Secret key` → `CLERK_SECRET_KEY` (Railway env)
   - copy `JWT public key` (PEM) → `CLERK_JWT_KEY` (Railway env)
5. **Webhooks (optional, later):** subscribe to `user.deleted` to clean up the corresponding `users` row + cascade.

---

## Backup & restore

- **Continuous**: Litestream replicates WAL frames to R2 every ~1 second.
- **Daily snapshot**: `snapshot-interval: 24h` keeps point-in-time recovery within 7 days (`retention: 168h`).
- **Restore drill** (do this once before going live):
  1. Stop the service.
  2. Delete the volume contents (Railway shell): `rm /data/data.db*`.
  3. Restart. Entrypoint pulls from R2, app comes up with prior data.
  4. Verify a known row.
- **Disaster recovery** (R2 lost too): the only authoritative copy is the volume. R2 is the second copy. A third copy (manual `sqlite3 .backup` to local laptop weekly) is cheap insurance.

---

## Cost estimate

| Item | Monthly |
|---|---|
| Railway Hobby (service + 1 GB volume) | ~$5 |
| Clerk (under 10k MAU) | $0 |
| Cloudflare R2 (a few hundred MB, no egress) | ~$0 |
| **Total** | **~$5** |

---

## Verification

Before announcing the URL:

1. **Local container smoke test**: `docker build` + `docker run` with a tmpfs volume, hit `/healthz`, sign up via a local Clerk dev instance, create a note, restart container, confirm note persists.
2. **Privacy check**: sign up two accounts in production, confirm account A cannot read account B's notes via direct API calls (try forging `userId` in query strings / bodies — should be ignored).
3. **Restore drill**: see above.
4. **aoe4world sync end-to-end** with a real profile, on the deployed instance.
5. **CSP / HTTPS**: confirm Clerk's frames/scripts load and there are no mixed-content warnings.
6. **Rate limit check**: Clerk handles auth-endpoint rate limits; confirm our `/api/v1/sync` endpoint has *some* throttling so a logged-in user can't hammer aoe4world from our server. (May need a tiny per-user lockout — TBD, follow-up issue.)

---

## Risks / decisions to revisit

- **`tsx` in production.** Current `start` script runs `tsx src/index.ts`. Fine for now (Node 22 + tsx is stable), but a `tsc --build` + `node dist/index.js` flow is cheaper at boot and removes a dev-dep from the prod image. Defer until measured.
- **Single container = single point of failure.** Acceptable; documented. Migrate to Turso (drop-in libSQL) if we ever want >1 instance.
- **Clerk lock-in.** Auth identity is at Clerk; if we ever leave, we have email per user in our DB but no password hashes. Migration path: invite all users to re-set passwords via a new auth system. Not free, but not catastrophic.
- **`sessions` table is now dead code.** Leave for one deploy, drop in the next migration once nothing references it.
- **Dev environment.** Devs need *either* Clerk dev keys *or* the dev fallback to the `local` user. Document both in `README.md`. Don't ship the fallback to prod (guard with `NODE_ENV !== "production"`).

---

## Progress

Update inline as steps complete. `[ ]` → `[x]` with date.

### Phase 1 — Code changes (local, no deploy)
- [ ] Add `@clerk/backend` to server, `@clerk/clerk-react` to web
- [ ] Schema: add `clerk_user_id`, `email` to `users`; generate migration
- [ ] Rewrite `auth/middleware.ts` (Clerk verify + upsert, dev fallback)
- [ ] Frontend: `<ClerkProvider>`, `/sign-in`, `/sign-up`, auth guard
- [ ] Frontend: attach Clerk JWT to API client
- [ ] Privacy audit pass on every route in `apps/server/src/routes/`
- [ ] Local smoke test with a Clerk dev instance

### Phase 2 — Containerize
- [ ] `Dockerfile` builds web + boots server, image < 500 MB
- [ ] `docker-entrypoint.sh` runs migrate then `litestream replicate -exec`
- [ ] `litestream.yml` checked in
- [ ] Local `docker run` works end-to-end with a temp R2 bucket

### Phase 3 — Railway
- [ ] Create Railway project, attach repo
- [ ] Create volume at `/data`
- [ ] Set all env vars (Clerk + Litestream + R2)
- [ ] First deploy succeeds, `/healthz` 200
- [ ] Custom domain (optional)
- [ ] Clerk allowed origins updated to prod URL

### Phase 4 — Clerk production
- [ ] Switch frontend build to Clerk production publishable key
- [ ] Confirm email verification + password reset emails arrive
- [ ] Confirm Google OAuth callback succeeds

### Phase 5 — Backups + go-live
- [ ] Restore drill from R2 succeeds
- [ ] Two-account privacy check passes
- [ ] Sync against real aoe4world profile in prod
- [ ] Announce URL
