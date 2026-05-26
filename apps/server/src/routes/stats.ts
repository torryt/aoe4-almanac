import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { statsByCivQuerySchema } from "@aoe4-almanac/shared";
import type { AppContext } from "../auth/middleware.ts";
import { sqlite } from "../db/client.ts";

export const statsRoutes = new Hono<AppContext>();

statsRoutes.get("/by-civ", zValidator("query", statsByCivQuerySchema), (c) => {
  const userId = c.get("userId");
  const { my_civ, kind, exclude_randomized } = c.req.valid("query");
  const kindClause = kind ? "AND g.kind = ?" : "";
  const randClause = exclude_randomized
    ? "AND (g.my_civ_randomized IS NULL OR g.my_civ_randomized = 0)"
    : "";
  const params: unknown[] = [userId, my_civ];
  if (kind) params.push(kind);
  const rows = sqlite()
    .prepare(
      `SELECT
         p.civ_slug AS opp_civ_slug,
         COUNT(*) AS games,
         SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END) AS losses,
         SUM(CASE WHEN g.my_result = 'draw' THEN 1 ELSE 0 END) AS draws
       FROM games g
       JOIN game_participants p ON p.game_id = g.id AND p.is_self = 0
       WHERE g.user_id = ? AND g.my_civ_slug = ? ${kindClause} ${randClause}
       GROUP BY p.civ_slug
       ORDER BY games DESC`,
    )
    .all(...params) as Array<{
    opp_civ_slug: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
  }>;
  return c.json({
    my_civ,
    rows: rows.map((r) => ({
      opp_civ_slug: r.opp_civ_slug,
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      win_rate: r.games > 0 ? r.wins / r.games : null,
    })),
  });
});

statsRoutes.get("/matchups", (c) => {
  const userId = c.get("userId");
  const rows = sqlite()
    .prepare(
      `SELECT
         g.my_civ_slug AS my_civ_slug,
         p.civ_slug AS opp_civ_slug,
         COUNT(*) AS games,
         SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END) AS losses,
         SUM(CASE WHEN g.my_result = 'draw' THEN 1 ELSE 0 END) AS draws
       FROM games g
       JOIN game_participants p ON p.game_id = g.id AND p.is_self = 0
       WHERE g.user_id = ?
       GROUP BY g.my_civ_slug, p.civ_slug`,
    )
    .all(userId) as Array<{
    my_civ_slug: string;
    opp_civ_slug: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
  }>;
  return c.json({
    rows: rows.map((r) => ({
      my_civ_slug: r.my_civ_slug,
      opp_civ_slug: r.opp_civ_slug,
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      win_rate: r.games > 0 ? r.wins / r.games : null,
    })),
  });
});

statsRoutes.get("/by-map", (c) => {
  const userId = c.get("userId");
  const rows = sqlite()
    .prepare(
      `SELECT
         map_slug,
         COUNT(*) AS games,
         SUM(CASE WHEN my_result = 'win' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN my_result = 'loss' THEN 1 ELSE 0 END) AS losses
       FROM games
       WHERE user_id = ? AND map_slug IS NOT NULL
       GROUP BY map_slug
       ORDER BY games DESC`,
    )
    .all(userId) as Array<{
    map_slug: string;
    games: number;
    wins: number;
    losses: number;
  }>;
  return c.json({
    rows: rows.map((r) => ({
      map_slug: r.map_slug,
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      win_rate: r.games > 0 ? r.wins / r.games : null,
    })),
  });
});

statsRoutes.get("/rating-history", (c) => {
  const userId = c.get("userId");
  const leaderboard = c.req.query("leaderboard") || "rm_solo";
  const limitRaw = Number(c.req.query("limit") ?? "60");
  const limit = Number.isFinite(limitRaw)
    ? Math.max(2, Math.min(20000, Math.floor(limitRaw)))
    : 60;
  const rows = sqlite()
    .prepare(
      `SELECT started_at, my_rating
       FROM games
       WHERE user_id = ?
         AND leaderboard = ?
         AND my_rating IS NOT NULL
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(userId, leaderboard, limit) as Array<{
    started_at: number;
    my_rating: number;
  }>;
  const points = rows.reverse().map((r) => ({
    at: r.started_at,
    rating: r.my_rating,
  }));
  return c.json({ leaderboard, points });
});

statsRoutes.get("/recent", (c) => {
  const userId = c.get("userId");
  const recent = sqlite()
    .prepare(
      `SELECT * FROM games WHERE user_id = ? ORDER BY started_at DESC LIMIT 10`,
    )
    .all(userId) as Array<Record<string, unknown>>;
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const agg = sqlite()
    .prepare(
      `SELECT
         COUNT(*) AS games,
         SUM(CASE WHEN my_result = 'win' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN my_result = 'loss' THEN 1 ELSE 0 END) AS losses
       FROM games WHERE user_id = ? AND started_at >= ?`,
    )
    .get(userId, cutoff) as { games: number; wins: number; losses: number } | undefined;
  const games = agg?.games ?? 0;
  const total = sqlite()
    .prepare(`SELECT COUNT(*) AS n FROM games WHERE user_id = ?`)
    .get(userId) as { n: number } | undefined;
  const topCiv = sqlite()
    .prepare(
      `SELECT my_civ_slug AS slug, COUNT(*) AS n
       FROM (
         SELECT my_civ_slug FROM games
         WHERE user_id = ? AND my_civ_slug IS NOT NULL
         ORDER BY started_at DESC LIMIT 30
       )
       GROUP BY my_civ_slug
       ORDER BY n DESC LIMIT 1`,
    )
    .get(userId) as { slug: string; n: number } | undefined;
  return c.json({
    recent,
    total_games: total?.n ?? 0,
    last_30d: {
      games,
      wins: agg?.wins ?? 0,
      losses: agg?.losses ?? 0,
      win_rate: games > 0 ? (agg?.wins ?? 0) / games : null,
    },
    top_civ_slug: topCiv?.slug ?? null,
  });
});
