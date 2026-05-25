import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  linkAoe4WorldBodySchema,
  preferencesUpdateBodySchema,
} from "@aoe4-almanac/shared";
import type { AppContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { userPreferences, users } from "../db/schema.ts";
import { log, logError } from "../log.ts";
import {
  getLeaderboardPage,
  getPlayer,
} from "../services/aoe4world.ts";
import {
  countUserGameData,
  linkProfileAndBackfill,
  runSync,
  wipeUserGameData,
} from "../services/sync.ts";

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

meRoutes.get("/data-counts", (c) => {
  const userId = c.get("userId");
  const counts = countUserGameData(userId);
  const row = db()
    .select({ profileId: users.aoe4worldProfileId })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return c.json({
    current_profile_id: row?.profileId ?? null,
    ...counts,
  });
});

meRoutes.delete("/link-aoe4world", (c) => {
  const userId = c.get("userId");
  const reqId = c.get("reqId");
  const wiped = wipeUserGameData(userId);
  db()
    .update(users)
    .set({ aoe4worldProfileId: null, updatedAt: sql`(unixepoch())` })
    .where(eq(users.id, userId))
    .run();
  log(
    reqId,
    `unlink.wiped user=${userId} games=${wiped.games} game_notes=${wiped.game_notes} sync_rows=${wiped.sync_state_rows}`,
  );
  return c.json({ ok: true, wiped });
});

type RatingInfoCacheEntry = {
  at: number;
  data: unknown;
};
const ratingInfoCache = new Map<string, RatingInfoCacheEntry>();
const RATING_INFO_TTL_MS = 10 * 60_000;

meRoutes.get("/rating-info", async (c) => {
  const userId = c.get("userId");
  const reqId = c.get("reqId");
  const leaderboard = c.req.query("leaderboard") || "rm_solo";

  const row = db()
    .select({ profileId: users.aoe4worldProfileId })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  const profileId = row?.profileId;
  if (!profileId) return c.json({ error: "not linked" }, 404);

  const cacheKey = `${userId}:${leaderboard}`;
  const cached = ratingInfoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RATING_INFO_TTL_MS) {
    return c.json(cached.data);
  }

  try {
    const player = await getPlayer(profileId);
    const mode = player.modes?.[leaderboard];
    if (!mode) {
      const payload = {
        leaderboard,
        country: player.country ?? null,
        unranked: true,
      };
      ratingInfoCache.set(cacheKey, { at: Date.now(), data: payload });
      return c.json(payload);
    }

    // Get global total
    let rankTotal: number | null = null;
    try {
      const lb = await getLeaderboardPage(leaderboard, { page: 1 });
      rankTotal = lb.total_count;
    } catch (e) {
      logError(reqId, "leaderboard total fetch failed:", e);
    }

    // Country rank: paginate country-filtered leaderboard until we find profile
    let countryRank: number | null = null;
    let countryTotal: number | null = null;
    const country = player.country ?? null;
    if (country && mode.rating != null) {
      try {
        const MAX_PAGES = 20; // up to 1000 players in their country
        for (let page = 1; page <= MAX_PAGES; page++) {
          const lb = await getLeaderboardPage(leaderboard, { country, page });
          if (page === 1) countryTotal = lb.total_count;
          const idx = lb.players.findIndex((p) => p.profile_id === profileId);
          if (idx >= 0) {
            // The `rank` field in leaderboard rows is the global ladder rank,
            // not the country rank — derive country rank from position.
            countryRank = lb.offset + idx + 1;
            break;
          }
          if (lb.players.length < lb.per_page) break;
          if (lb.offset + lb.players.length >= lb.total_count) break;
        }
      } catch (e) {
        logError(reqId, "country leaderboard fetch failed:", e);
      }
    }

    const payload = {
      leaderboard,
      profile_id: profileId,
      country,
      rating: mode.rating ?? null,
      max_rating: mode.max_rating ?? null,
      rank: mode.rank ?? null,
      rank_total: rankTotal,
      rank_level: mode.rank_level ?? null,
      country_rank: countryRank,
      country_total: countryTotal,
      streak: mode.streak ?? null,
      games_count: mode.games_count ?? null,
      wins_count: mode.wins_count ?? null,
      losses_count: mode.losses_count ?? null,
      win_rate: mode.win_rate ?? null,
      unranked: false,
    };
    ratingInfoCache.set(cacheKey, { at: Date.now(), data: payload });
    return c.json(payload);
  } catch (e) {
    logError(reqId, "rating-info failed:", e);
    return c.json({ error: "fetch failed" }, 502);
  }
});

const DEFAULT_PREFERENCES = { auto_save_notes: true };

meRoutes.get("/preferences", (c) => {
  const userId = c.get("userId");
  const row = db()
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .get();
  if (!row) return c.json(DEFAULT_PREFERENCES);
  return c.json({ auto_save_notes: row.autoSaveNotes });
});

meRoutes.put(
  "/preferences",
  zValidator("json", preferencesUpdateBodySchema),
  (c) => {
    const userId = c.get("userId");
    const patch = c.req.valid("json");
    const existing = db()
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();
    const merged = {
      autoSaveNotes:
        patch.auto_save_notes ?? existing?.autoSaveNotes ?? true,
    };
    db()
      .insert(userPreferences)
      .values({ userId, ...merged })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { ...merged, updatedAt: sql`(unixepoch())` },
      })
      .run();
    return c.json({ auto_save_notes: merged.autoSaveNotes });
  },
);

meRoutes.post("/sync-now", async (c) => {
  const userId = c.get("userId");
  const reqId = c.get("reqId");
  runSync(userId, false, { reqId }).catch((e) => {
    logError(reqId, "sync failed:", e);
  });
  return c.json({ ok: true });
});
