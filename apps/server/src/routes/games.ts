import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  gamesQuerySchema,
  manualGameBodySchema,
  manualGamePatchSchema,
} from "@aoe4-almanac/shared";
import type { AppContext } from "../auth/middleware.ts";
import { db, sqlite } from "../db/client.ts";
import { gameParticipants, games } from "../db/schema.ts";
import {
  ensureMap,
  normalizeCivSlug,
  normalizeMapSlug,
} from "../services/normalize.ts";

export const gamesRoutes = new Hono<AppContext>();

gamesRoutes.get("/", zValidator("query", gamesQuerySchema), (c) => {
  const userId = c.get("userId");
  const q = c.req.valid("query");

  const where = [eq(games.userId, userId)];
  if (q.civ) where.push(eq(games.myCivSlug, q.civ));
  if (q.map) where.push(eq(games.mapSlug, q.map));
  if (q.result) where.push(eq(games.myResult, q.result));
  if (q.kind) where.push(eq(games.kind, q.kind));
  if (q.leaderboard) where.push(eq(games.leaderboard, q.leaderboard));
  if (q.since) where.push(sql`${games.startedAt} >= ${q.since}`);
  if (q.cursor) where.push(lt(games.id, q.cursor));

  // opp_civ filter requires a subquery over participants
  let candidateIds: number[] | null = null;
  if (q.opp_civ) {
    candidateIds = (
      sqlite()
        .prepare(
          `SELECT DISTINCT g.id AS id
           FROM games g
           JOIN game_participants p ON p.game_id = g.id
           WHERE g.user_id = ? AND p.is_self = 0 AND p.civ_slug = ?`,
        )
        .all(userId, q.opp_civ) as { id: number }[]
    ).map((r) => r.id);
    if (candidateIds.length === 0) {
      return c.json({ games: [], next_cursor: null });
    }
    where.push(inArray(games.id, candidateIds));
  }

  const rows = db()
    .select()
    .from(games)
    .where(and(...where))
    .orderBy(desc(games.startedAt), desc(games.id))
    .limit(q.limit)
    .all();

  const ids = rows.map((r) => r.id);
  const parts =
    ids.length > 0
      ? db()
          .select()
          .from(gameParticipants)
          .where(inArray(gameParticipants.gameId, ids))
          .all()
      : [];
  const partsByGame = new Map<number, typeof parts>();
  for (const p of parts) {
    const arr = partsByGame.get(p.gameId) ?? [];
    arr.push(p);
    partsByGame.set(p.gameId, arr);
  }

  const out = rows.map((g) => ({
    ...g,
    is_variant: undefined,
    participants: (partsByGame.get(g.id) ?? []).map((p) => ({
      id: p.id,
      game_id: p.gameId,
      team: p.team,
      is_self: Boolean(p.isSelf),
      profile_id: p.profileId,
      name: p.name,
      civ_slug: p.civSlug,
      civ_randomized: p.civRandomized,
      result: p.result,
      rating: p.rating,
      rating_diff: p.ratingDiff,
      mmr: p.mmr,
    })),
    aoe4world_game_id: g.aoe4worldGameId,
    started_at: g.startedAt,
    duration_seconds: g.durationSeconds,
    map_slug: g.mapSlug,
    user_id: g.userId,
    my_team: g.myTeam,
    my_civ_slug: g.myCivSlug,
    my_civ_randomized: g.myCivRandomized,
    my_result: g.myResult,
    my_rating: g.myRating,
    my_rating_diff: g.myRatingDiff,
    my_mmr: g.myMmr,
    imported_at: g.importedAt,
    created_at: g.createdAt,
    updated_at: g.updatedAt,
  }));

  const nextCursor =
    rows.length === q.limit && rows[rows.length - 1]
      ? (rows[rows.length - 1]?.id ?? null)
      : null;

  return c.json({ games: out, next_cursor: nextCursor });
});

gamesRoutes.get("/:id", (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
  const row = db()
    .select()
    .from(games)
    .where(and(eq(games.id, id), eq(games.userId, userId)))
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  const parts = db()
    .select()
    .from(gameParticipants)
    .where(eq(gameParticipants.gameId, id))
    .all();
  return c.json({
    ...row,
    aoe4world_game_id: row.aoe4worldGameId,
    started_at: row.startedAt,
    duration_seconds: row.durationSeconds,
    map_slug: row.mapSlug,
    user_id: row.userId,
    my_team: row.myTeam,
    my_civ_slug: row.myCivSlug,
    my_civ_randomized: row.myCivRandomized,
    my_result: row.myResult,
    my_rating: row.myRating,
    my_rating_diff: row.myRatingDiff,
    my_mmr: row.myMmr,
    imported_at: row.importedAt,
    raw_payload_json: row.rawPayloadJson,
    raw_payload: row.rawPayloadJson ? JSON.parse(row.rawPayloadJson) : null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    participants: parts.map((p) => ({
      id: p.id,
      game_id: p.gameId,
      team: p.team,
      is_self: Boolean(p.isSelf),
      profile_id: p.profileId,
      name: p.name,
      civ_slug: p.civSlug,
      civ_randomized: p.civRandomized,
      result: p.result,
      rating: p.rating,
      rating_diff: p.ratingDiff,
      mmr: p.mmr,
    })),
  });
});

gamesRoutes.post("/", zValidator("json", manualGameBodySchema), (c) => {
  const userId = c.get("userId");
  const body = c.req.valid("json");
  const myCiv = normalizeCivSlug(body.my_civ_slug);
  const mapSlug = body.map_slug ? normalizeMapSlug(body.map_slug) : null;
  if (mapSlug) ensureMap(mapSlug, body.map_slug ?? null);

  let newGameId = 0;
  sqlite().transaction(() => {
    const result = sqlite()
      .prepare(
        `INSERT INTO games (
           user_id, source, started_at, duration_seconds, map_slug, kind,
           my_civ_slug, my_result, created_at, updated_at
         ) VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
      )
      .run(
        userId,
        body.started_at,
        body.duration_seconds ?? null,
        mapSlug,
        body.kind,
        myCiv,
        body.my_result,
      );
    newGameId = Number(result.lastInsertRowid);

    // Self participant
    sqlite()
      .prepare(
        `INSERT INTO game_participants (game_id, team, is_self, name, civ_slug, result)
         VALUES (?, 0, 1, 'Me', ?, ?)`,
      )
      .run(newGameId, myCiv, body.my_result);

    if (body.opp_civ_slug) {
      const oppCiv = normalizeCivSlug(body.opp_civ_slug);
      const oppResult =
        body.my_result === "win" ? "loss" : body.my_result === "loss" ? "win" : body.my_result;
      sqlite()
        .prepare(
          `INSERT INTO game_participants (game_id, team, is_self, name, civ_slug, result)
           VALUES (?, 1, 0, ?, ?, ?)`,
        )
        .run(newGameId, body.opp_name ?? "Opponent", oppCiv, oppResult);
    }

    if (body.notes) {
      sqlite()
        .prepare(
          `INSERT INTO game_notes (user_id, game_id, body_md) VALUES (?, ?, ?)`,
        )
        .run(userId, newGameId, body.notes);
    }
  })();

  return c.json({ id: newGameId }, 201);
});

gamesRoutes.patch("/:id", zValidator("json", manualGamePatchSchema), (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
  const body = c.req.valid("json");

  const existing = db()
    .select()
    .from(games)
    .where(and(eq(games.id, id), eq(games.userId, userId)))
    .get();
  if (!existing) return c.json({ error: "not found" }, 404);
  if (existing.source !== "manual") {
    return c.json({ error: "only manual games can be edited" }, 400);
  }

  const sets: Record<string, unknown> = {};
  if (body.started_at !== undefined) sets["started_at"] = body.started_at;
  if (body.duration_seconds !== undefined)
    sets["duration_seconds"] = body.duration_seconds;
  if (body.map_slug !== undefined) {
    const m = body.map_slug ? normalizeMapSlug(body.map_slug) : null;
    sets["map_slug"] = m;
    if (m) ensureMap(m, body.map_slug ?? null);
  }
  if (body.kind !== undefined) sets["kind"] = body.kind;
  if (body.my_civ_slug !== undefined)
    sets["my_civ_slug"] = normalizeCivSlug(body.my_civ_slug);
  if (body.my_result !== undefined) sets["my_result"] = body.my_result;

  if (Object.keys(sets).length > 0) {
    const fields = Object.keys(sets).map((k) => `${k} = ?`);
    const values = Object.values(sets);
    sqlite()
      .prepare(
        `UPDATE games SET ${fields.join(", ")}, updated_at = unixepoch() WHERE id = ?`,
      )
      .run(...values, id);
  }
  return c.json({ ok: true });
});

gamesRoutes.delete("/:id", (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
  const existing = db()
    .select()
    .from(games)
    .where(and(eq(games.id, id), eq(games.userId, userId)))
    .get();
  if (!existing) return c.json({ error: "not found" }, 404);
  if (existing.source !== "manual") {
    return c.json({ error: "only manual games can be deleted" }, 400);
  }
  db().delete(games).where(eq(games.id, id)).run();
  // Cascade handles game_notes + participants
  return c.json({ ok: true });
});
