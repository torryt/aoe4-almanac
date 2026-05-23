import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { aoe4worldSearchQuerySchema } from "@aoe4-almanac/shared";
import type { AppContext } from "../auth/middleware.ts";
import { searchPlayers } from "../services/aoe4world.ts";

export const aoe4worldRoutes = new Hono<AppContext>();

aoe4worldRoutes.get(
  "/search",
  zValidator("query", aoe4worldSearchQuerySchema),
  async (c) => {
    const { q } = c.req.valid("query");
    const res = await searchPlayers(q);
    return c.json({
      players: res.players.slice(0, 20).map((p) => ({
        profile_id: p.profile_id,
        name: p.name,
        country: p.country ?? null,
        avatar_url: p.avatars?.small ?? null,
        last_game_at: p.last_game_at ?? null,
      })),
    });
  },
);
