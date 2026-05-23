import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { env } from "./env.ts";
import { authMiddleware, type AppContext } from "./auth/middleware.ts";
import { verboseLogger } from "./middleware/verboseLogger.ts";
import { meRoutes } from "./routes/me.ts";
import { aoe4worldRoutes } from "./routes/aoe4world.ts";
import { civsRoutes } from "./routes/civs.ts";
import { gamesRoutes } from "./routes/games.ts";
import { notesRoutes } from "./routes/notes.ts";
import { syncRoutes } from "./routes/sync.ts";
import { statsRoutes } from "./routes/stats.ts";

const app = new Hono<AppContext>();

app.use("*", verboseLogger());

const api = new Hono<AppContext>();
api.use("*", authMiddleware);
api.route("/me", meRoutes);
api.route("/aoe4world", aoe4worldRoutes);
api.route("/civs", civsRoutes);
api.route("/games", gamesRoutes);
api.route("/notes", notesRoutes);
api.route("/sync", syncRoutes);
api.route("/stats", statsRoutes);

app.route("/api/v1", api);
app.get("/healthz", (c) => c.json({ ok: true }));

const e = env();
const webDist = e.AOE4_PORTAL_WEB_DIST;
if (webDist) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ path: `${webDist}/index.html` }));
}

serve(
  { fetch: app.fetch, port: e.PORT, hostname: e.HOST },
  (info) => {
    // eslint-disable-next-line no-console
    console.log(`aoe4-portal server listening on http://${e.HOST}:${info.port}`);
  },

);
