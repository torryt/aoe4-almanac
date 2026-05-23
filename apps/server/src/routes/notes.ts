import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { noteUpsertBodySchema } from "@aoe4-portal/shared";
import type { AppContext } from "../auth/middleware.ts";
import { db, sqlite } from "../db/client.ts";
import {
  civNotes,
  gameNotes,
  games,
  mapNotes,
  matchupNotes,
} from "../db/schema.ts";

export const notesRoutes = new Hono<AppContext>();

function excerpt(body: string): string {
  return body.replace(/\s+/g, " ").slice(0, 140);
}

// --- Civ notes ---
notesRoutes.get("/civs", (c) => {
  const userId = c.get("userId");
  const rows = db()
    .select()
    .from(civNotes)
    .where(eq(civNotes.userId, userId))
    .orderBy(desc(civNotes.updatedAt))
    .all();
  return c.json({
    notes: rows.map((r) => ({
      civ_slug: r.civSlug,
      updated_at: r.updatedAt,
      excerpt: excerpt(r.bodyMd),
    })),
  });
});

notesRoutes.get("/civs/:slug", (c) => {
  const userId = c.get("userId");
  const slug = c.req.param("slug");
  const row = db()
    .select()
    .from(civNotes)
    .where(and(eq(civNotes.userId, userId), eq(civNotes.civSlug, slug)))
    .get();
  return c.json({ body_md: row?.bodyMd ?? "", updated_at: row?.updatedAt ?? null });
});

notesRoutes.put(
  "/civs/:slug",
  zValidator("json", noteUpsertBodySchema),
  (c) => {
    const userId = c.get("userId");
    const slug = c.req.param("slug");
    const { body_md } = c.req.valid("json");
    sqlite()
      .prepare(
        `INSERT INTO civ_notes (user_id, civ_slug, body_md) VALUES (?, ?, ?)
         ON CONFLICT(user_id, civ_slug) DO UPDATE SET body_md = excluded.body_md, updated_at = unixepoch()`,
      )
      .run(userId, slug, body_md);
    return c.json({ ok: true });
  },
);

// --- Matchup notes ---
notesRoutes.get("/matchups", (c) => {
  const userId = c.get("userId");
  const myCiv = c.req.query("my_civ");
  const where = myCiv
    ? and(eq(matchupNotes.userId, userId), eq(matchupNotes.myCivSlug, myCiv))
    : eq(matchupNotes.userId, userId);
  const rows = db()
    .select()
    .from(matchupNotes)
    .where(where)
    .orderBy(desc(matchupNotes.updatedAt))
    .all();
  return c.json({
    notes: rows.map((r) => ({
      my_civ_slug: r.myCivSlug,
      opp_civ_slug: r.oppCivSlug,
      updated_at: r.updatedAt,
      excerpt: excerpt(r.bodyMd),
    })),
  });
});

notesRoutes.get("/matchups/:myCiv/:oppCiv", (c) => {
  const userId = c.get("userId");
  const myCiv = c.req.param("myCiv");
  const oppCiv = c.req.param("oppCiv");
  const row = db()
    .select()
    .from(matchupNotes)
    .where(
      and(
        eq(matchupNotes.userId, userId),
        eq(matchupNotes.myCivSlug, myCiv),
        eq(matchupNotes.oppCivSlug, oppCiv),
      ),
    )
    .get();
  return c.json({ body_md: row?.bodyMd ?? "", updated_at: row?.updatedAt ?? null });
});

notesRoutes.put(
  "/matchups/:myCiv/:oppCiv",
  zValidator("json", noteUpsertBodySchema),
  (c) => {
    const userId = c.get("userId");
    const myCiv = c.req.param("myCiv");
    const oppCiv = c.req.param("oppCiv");
    const { body_md } = c.req.valid("json");
    sqlite()
      .prepare(
        `INSERT INTO matchup_notes (user_id, my_civ_slug, opp_civ_slug, body_md) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, my_civ_slug, opp_civ_slug) DO UPDATE SET body_md = excluded.body_md, updated_at = unixepoch()`,
      )
      .run(userId, myCiv, oppCiv, body_md);
    return c.json({ ok: true });
  },
);

// --- Map notes ---
notesRoutes.get("/maps", (c) => {
  const userId = c.get("userId");
  const rows = db()
    .select()
    .from(mapNotes)
    .where(eq(mapNotes.userId, userId))
    .orderBy(desc(mapNotes.updatedAt))
    .all();
  return c.json({
    notes: rows.map((r) => ({
      map_slug: r.mapSlug,
      updated_at: r.updatedAt,
      excerpt: excerpt(r.bodyMd),
    })),
  });
});

notesRoutes.get("/maps/:slug", (c) => {
  const userId = c.get("userId");
  const slug = c.req.param("slug");
  const row = db()
    .select()
    .from(mapNotes)
    .where(and(eq(mapNotes.userId, userId), eq(mapNotes.mapSlug, slug)))
    .get();
  return c.json({ body_md: row?.bodyMd ?? "", updated_at: row?.updatedAt ?? null });
});

notesRoutes.put(
  "/maps/:slug",
  zValidator("json", noteUpsertBodySchema),
  (c) => {
    const userId = c.get("userId");
    const slug = c.req.param("slug");
    const { body_md } = c.req.valid("json");
    sqlite()
      .prepare(
        `INSERT INTO map_notes (user_id, map_slug, body_md) VALUES (?, ?, ?)
         ON CONFLICT(user_id, map_slug) DO UPDATE SET body_md = excluded.body_md, updated_at = unixepoch()`,
      )
      .run(userId, slug, body_md);
    return c.json({ ok: true });
  },
);

// --- Game notes ---
notesRoutes.get("/games/:gameId", (c) => {
  const userId = c.get("userId");
  const gameId = Number(c.req.param("gameId"));
  if (!Number.isFinite(gameId)) return c.json({ error: "bad id" }, 400);
  const row = db()
    .select()
    .from(gameNotes)
    .where(and(eq(gameNotes.userId, userId), eq(gameNotes.gameId, gameId)))
    .get();
  return c.json({ body_md: row?.bodyMd ?? "", updated_at: row?.updatedAt ?? null });
});

notesRoutes.put(
  "/games/:gameId",
  zValidator("json", noteUpsertBodySchema),
  (c) => {
    const userId = c.get("userId");
    const gameId = Number(c.req.param("gameId"));
    if (!Number.isFinite(gameId)) return c.json({ error: "bad id" }, 400);
    const { body_md } = c.req.valid("json");
    const owned = db()
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.id, gameId), eq(games.userId, userId)))
      .get();
    if (!owned) return c.json({ error: "game not found" }, 404);
    sqlite()
      .prepare(
        `INSERT INTO game_notes (user_id, game_id, body_md) VALUES (?, ?, ?)
         ON CONFLICT(user_id, game_id) DO UPDATE SET body_md = excluded.body_md, updated_at = unixepoch()`,
      )
      .run(userId, gameId, body_md);
    return c.json({ ok: true });
  },
);
