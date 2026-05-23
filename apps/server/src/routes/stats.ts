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
  return c.json({
    recent,
    last_30d: {
      games,
      wins: agg?.wins ?? 0,
      losses: agg?.losses ?? 0,
      win_rate: games > 0 ? (agg?.wins ?? 0) / games : null,
    },
  });
});
