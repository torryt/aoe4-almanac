import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { linkAoe4WorldBodySchema } from "@aoe4-portal/shared";
import type { AppContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { linkProfileAndBackfill, runSync } from "../services/sync.ts";
import { tracer } from "../telemetry.ts";

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

    return tracer.startActiveSpan("link-aoe4world.handler", async (span) => {
      span.setAttribute("user.id", userId);
      span.setAttribute("aoe4world.profile_id", profile_id);
      span.setAttribute("req.id", reqId);

      // Fire-and-forget: response should not wait for backfill.
      // The background promise gets its own root span so its work is visible.
      const bg = linkProfileAndBackfill(userId, profile_id, { reqId });
      bg.catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`[req ${reqId}] linkProfileAndBackfill failed:`, e);
      });
      // eslint-disable-next-line no-console
      console.log(
        `[req ${reqId}] link-aoe4world kicked off backfill profile_id=${profile_id}`,
      );

      const res = c.json({ ok: true, profile_id });
      span.end();
      return res;
    });
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
    // eslint-disable-next-line no-console
    console.error(`[req ${reqId}] sync failed:`, e);
  });
  return c.json({ ok: true });
});
