import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../auth/middleware.ts";
import { sqlite } from "../db/client.ts";

export const opponentsRoutes = new Hono<AppContext>();

const querySchema = z.object({
  search: z.string().trim().min(1).optional(),
  sort: z.enum(["matches", "recent", "name"]).optional().default("matches"),
  limit: z.coerce.number().int().positive().max(500).optional().default(200),
});

opponentsRoutes.get("/", zValidator("query", querySchema), (c) => {
  const userId = c.get("userId");
  const { search, sort, limit } = c.req.valid("query");

  const orderBy =
    sort === "name"
      ? "name COLLATE NOCASE ASC"
      : sort === "recent"
        ? "last_played_at DESC"
        : "games DESC, last_played_at DESC";

  const params: unknown[] = [userId];
  let searchClause = "";
  if (search) {
    searchClause = "AND p.name LIKE ? COLLATE NOCASE";
    params.push(`%${search}%`);
  }
  params.push(limit);

  const rows = sqlite()
    .prepare(
      `SELECT
         COALESCE(CAST(p.profile_id AS TEXT), 'n:' || p.name) AS key,
         p.profile_id AS profile_id,
         MAX(p.name) AS name,
         COUNT(*) AS games,
         SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END) AS losses,
         SUM(CASE WHEN g.my_result = 'draw' THEN 1 ELSE 0 END) AS draws,
         MAX(g.started_at) AS last_played_at
       FROM games g
       JOIN game_participants p ON p.game_id = g.id
         AND p.is_self = 0
         AND (g.my_team IS NULL OR p.team != g.my_team)
       WHERE g.user_id = ? ${searchClause}
       GROUP BY key
       ORDER BY ${orderBy}
       LIMIT ?`,
    )
    .all(...params) as Array<{
    key: string;
    profile_id: number | null;
    name: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    last_played_at: number;
  }>;

  return c.json({
    opponents: rows.map((r) => ({
      key: r.key,
      profile_id: r.profile_id,
      name: r.name,
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      last_played_at: r.last_played_at,
      win_rate: r.games > 0 ? r.wins / r.games : null,
    })),
  });
});

// Parse the composite opponent key used in the list endpoint.
// Numeric string => profile_id; "n:<name>" => unlinked opponent.
function parseKey(raw: string): { profileId: number | null; name: string | null } {
  if (raw.startsWith("n:")) {
    return { profileId: null, name: raw.slice(2) };
  }
  const n = Number(raw);
  if (Number.isFinite(n) && Number.isInteger(n) && n > 0) {
    return { profileId: n, name: null };
  }
  return { profileId: null, name: null };
}

opponentsRoutes.get("/:key", (c) => {
  const userId = c.get("userId");
  const raw = decodeURIComponent(c.req.param("key"));
  const { profileId, name } = parseKey(raw);
  if (profileId === null && name === null) {
    return c.json({ error: "bad key" }, 400);
  }

  // Match clause: either by profile_id or by name (when profile is unknown).
  // We always require is_self = 0 to scope to opponent rows.
  const matchClause =
    profileId !== null
      ? "p.is_self = 0 AND (g.my_team IS NULL OR p.team != g.my_team) AND p.profile_id = ?"
      : "p.is_self = 0 AND (g.my_team IS NULL OR p.team != g.my_team) AND p.profile_id IS NULL AND p.name = ?";
  const matchValue: unknown = profileId !== null ? profileId : name;

  const summary = sqlite()
    .prepare(
      `SELECT
         p.profile_id AS profile_id,
         MAX(p.name) AS name,
         COUNT(*) AS games,
         SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END) AS losses,
         SUM(CASE WHEN g.my_result = 'draw' THEN 1 ELSE 0 END) AS draws,
         MIN(g.started_at) AS first_played_at,
         MAX(g.started_at) AS last_played_at
       FROM games g
       JOIN game_participants p ON p.game_id = g.id
       WHERE g.user_id = ? AND ${matchClause}`,
    )
    .get(userId, matchValue) as
    | {
        profile_id: number | null;
        name: string | null;
        games: number;
        wins: number;
        losses: number;
        draws: number;
        first_played_at: number | null;
        last_played_at: number | null;
      }
    | undefined;

  if (!summary || summary.games === 0) {
    return c.json({ error: "not found" }, 404);
  }

  const byOppCiv = sqlite()
    .prepare(
      `SELECT
         p.civ_slug AS civ_slug,
         COUNT(*) AS games,
         SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END) AS losses
       FROM games g
       JOIN game_participants p ON p.game_id = g.id
       WHERE g.user_id = ? AND ${matchClause}
       GROUP BY p.civ_slug
       ORDER BY games DESC`,
    )
    .all(userId, matchValue) as Array<{
    civ_slug: string;
    games: number;
    wins: number;
    losses: number;
  }>;

  const byMyCiv = sqlite()
    .prepare(
      `SELECT
         g.my_civ_slug AS civ_slug,
         COUNT(*) AS games,
         SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END) AS losses
       FROM games g
       JOIN game_participants p ON p.game_id = g.id
       WHERE g.user_id = ? AND ${matchClause}
       GROUP BY g.my_civ_slug
       ORDER BY games DESC`,
    )
    .all(userId, matchValue) as Array<{
    civ_slug: string;
    games: number;
    wins: number;
    losses: number;
  }>;

  const byMap = sqlite()
    .prepare(
      `SELECT
         g.map_slug AS map_slug,
         COUNT(*) AS games,
         SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END) AS losses
       FROM games g
       JOIN game_participants p ON p.game_id = g.id
       WHERE g.user_id = ? AND ${matchClause} AND g.map_slug IS NOT NULL
       GROUP BY g.map_slug
       ORDER BY games DESC`,
    )
    .all(userId, matchValue) as Array<{
    map_slug: string;
    games: number;
    wins: number;
    losses: number;
  }>;

  const gameRows = sqlite()
    .prepare(
      `SELECT
         g.id AS id,
         g.started_at AS started_at,
         g.duration_seconds AS duration_seconds,
         g.map_slug AS map_slug,
         g.kind AS kind,
         g.my_civ_slug AS my_civ_slug,
         g.my_result AS my_result,
         g.my_rating AS my_rating,
         g.my_rating_diff AS my_rating_diff,
         p.civ_slug AS opp_civ_slug,
         p.rating AS opp_rating
       FROM games g
       JOIN game_participants p ON p.game_id = g.id
       WHERE g.user_id = ? AND ${matchClause}
       ORDER BY g.started_at DESC, g.id DESC`,
    )
    .all(userId, matchValue) as Array<{
    id: number;
    started_at: number;
    duration_seconds: number | null;
    map_slug: string | null;
    kind: string;
    my_civ_slug: string;
    my_result: "win" | "loss" | "draw" | "unknown";
    my_rating: number | null;
    my_rating_diff: number | null;
    opp_civ_slug: string;
    opp_rating: number | null;
  }>;

  return c.json({
    opponent: {
      profile_id: summary.profile_id,
      name: summary.name,
      games: summary.games,
      wins: summary.wins,
      losses: summary.losses,
      draws: summary.draws,
      first_played_at: summary.first_played_at,
      last_played_at: summary.last_played_at,
      win_rate: summary.games > 0 ? summary.wins / summary.games : null,
    },
    by_opp_civ: byOppCiv.map((r) => ({
      ...r,
      win_rate: r.games > 0 ? r.wins / r.games : null,
    })),
    by_my_civ: byMyCiv.map((r) => ({
      ...r,
      win_rate: r.games > 0 ? r.wins / r.games : null,
    })),
    by_map: byMap.map((r) => ({
      ...r,
      win_rate: r.games > 0 ? r.wins / r.games : null,
    })),
    games: gameRows,
  });
});
