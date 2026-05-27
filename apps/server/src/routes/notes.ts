import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { noteUpsertBodySchema } from "@aoe4-almanac/shared";
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
  // Exclude rows with empty or whitespace-only bodies — these can exist when
  // a user opened the editor (creating a row via auto-save) but typed nothing.
  // SQLite's single-arg trim() only strips ASCII spaces; pass an explicit
  // character set so tabs/newlines/CRs also count as empty.
  const nonEmpty = ne(
    sql`trim(${matchupNotes.bodyMd}, ' ' || x'09' || x'0a' || x'0d')`,
    "",
  );
  const where = myCiv
    ? and(
        eq(matchupNotes.userId, userId),
        eq(matchupNotes.myCivSlug, myCiv),
        nonEmpty,
      )
    : and(eq(matchupNotes.userId, userId), nonEmpty);
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
// Batch fetch — used by list views that need to show note presence/excerpt
// for many games at once. Returns only games that actually have a note row.
notesRoutes.get("/games", (c) => {
  const userId = c.get("userId");
  const idsParam = c.req.query("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return c.json({ notes: [] });
  const rows = db()
    .select()
    .from(gameNotes)
    .where(and(eq(gameNotes.userId, userId), inArray(gameNotes.gameId, ids)))
    .all();
  return c.json({
    notes: rows.map((r) => ({
      game_id: r.gameId,
      body_md: r.bodyMd,
      excerpt: excerpt(r.bodyMd),
      updated_at: r.updatedAt,
    })),
  });
});

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

// --- Bulk export ---
notesRoutes.get("/export", (c) => {
  const userId = c.get("userId");
  const civ = db()
    .select()
    .from(civNotes)
    .where(eq(civNotes.userId, userId))
    .all()
    .map((r) => ({
      civ_slug: r.civSlug,
      body_md: r.bodyMd,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }));
  const matchup = db()
    .select()
    .from(matchupNotes)
    .where(eq(matchupNotes.userId, userId))
    .all()
    .map((r) => ({
      my_civ_slug: r.myCivSlug,
      opp_civ_slug: r.oppCivSlug,
      body_md: r.bodyMd,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }));
  const map = db()
    .select()
    .from(mapNotes)
    .where(eq(mapNotes.userId, userId))
    .all()
    .map((r) => ({
      map_slug: r.mapSlug,
      body_md: r.bodyMd,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }));
  const game = db()
    .select()
    .from(gameNotes)
    .where(eq(gameNotes.userId, userId))
    .all()
    .map((r) => ({
      game_id: r.gameId,
      body_md: r.bodyMd,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }));
  return c.json({ civ, matchup, map, game });
});
