import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { linkAoe4WorldBodySchema } from "@aoe4-portal/shared";
import type { AppContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { log, logError } from "../log.ts";
import { linkProfileAndBackfill, runSync } from "../services/sync.ts";

export const meRoutes = new Hono<AppContext>();

meRoutes.get("/", (c) => {
  const userId = c.get("userId");
  const row = db().select().from(users).where(eq(users.id, userId)).get();
  if (!row) return c.json({ error: "user not found" }, 404);
  return c.json({
    id: row.id,
    slug: row.slug,
    display_name: row.displayName,
    aoe4world_profile_id: row.aoe4worldProfileId,
  });
});

meRoutes.post(
  "/link-aoe4world",
  zValidator("json", linkAoe4WorldBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const reqId = c.get("reqId");
    const { profile_id } = c.req.valid("json");

    linkProfileAndBackfill(userId, profile_id, { reqId }).catch((e) => {
      logError(reqId, "linkProfileAndBackfill failed:", e);
    });
    log(reqId, `link-aoe4world kicked off backfill profile_id=${profile_id}`);

    return c.json({ ok: true, profile_id });
  },
);

meRoutes.delete("/link-aoe4world", (c) => {
  const userId = c.get("userId");
  db()
    .update(users)
    .set({ aoe4worldProfileId: null, updatedAt: sql`(unixepoch())` })
    .where(eq(users.id, userId))
    .run();
  return c.json({ ok: true });
});

meRoutes.post("/sync-now", async (c) => {
  const userId = c.get("userId");
  const reqId = c.get("reqId");
  runSync(userId, false, { reqId }).catch((e) => {
    logError(reqId, "sync failed:", e);
  });
  return c.json({ ok: true });
});
