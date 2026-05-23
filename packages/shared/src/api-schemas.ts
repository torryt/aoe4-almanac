import { z } from "zod";
import {
  civSchema,
  civSlugSchema,
  gameKindSchema,
  gameSchema,
  gameWithParticipantsSchema,
  leaderboardSchema,
  mapSlugSchema,
  noteBodySchema,
  resultSchema,
  syncStateSchema,
  userMeSchema,
  aoe4worldSearchResultSchema,
} from "./domain.ts";

// /me
export const meResponseSchema = userMeSchema;

// /aoe4world/search
export const aoe4worldSearchQuerySchema = z.object({ q: z.string().min(2) });
export const aoe4worldSearchResponseSchema = z.object({
  players: z.array(aoe4worldSearchResultSchema),
});

// /me/link-aoe4world
export const linkAoe4WorldBodySchema = z.object({
  profile_id: z.number().int().positive(),
});

// /civs
export const civsResponseSchema = z.object({ civs: z.array(civSchema) });

// /games
export const gamesQuerySchema = z.object({
  civ: civSlugSchema.optional(),
  opp_civ: civSlugSchema.optional(),
  map: mapSlugSchema.optional(),
  result: resultSchema.optional(),
  kind: gameKindSchema.optional(),
  leaderboard: leaderboardSchema.optional(),
  since: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().optional(),
});
export const gamesResponseSchema = z.object({
  games: z.array(gameWithParticipantsSchema),
  next_cursor: z.number().int().nullable(),
});

// POST /games (manual entry)
export const manualGameBodySchema = z.object({
  started_at: z.number().int(),
  duration_seconds: z.number().int().min(0).max(60 * 60 * 24).nullable().optional(),
  map_slug: mapSlugSchema.nullable().optional(),
  kind: gameKindSchema.default("custom"),
  my_civ_slug: civSlugSchema,
  my_result: resultSchema,
  opp_civ_slug: civSlugSchema.optional(),
  opp_name: z.string().min(1).max(64).optional(),
  notes: z.string().max(200000).optional(),
});

export const manualGamePatchSchema = manualGameBodySchema.partial();

// /sync
export const syncRunBodySchema = z
  .object({
    leaderboard: leaderboardSchema.optional(),
    full: z.boolean().optional(),
  })
  .default({});

export const syncStatusResponseSchema = z.object({
  rows: z.array(syncStateSchema),
  in_flight: z.boolean(),
});

// notes
export const noteUpsertBodySchema = noteBodySchema;
export const noteResponseSchema = z.object({
  body_md: z.string(),
  updated_at: z.number().int().nullable(),
});

export const civNoteIndexSchema = z.object({
  notes: z.array(
    z.object({
      civ_slug: civSlugSchema,
      updated_at: z.number().int(),
      excerpt: z.string(),
    }),
  ),
});

export const matchupNoteIndexSchema = z.object({
  notes: z.array(
    z.object({
      my_civ_slug: civSlugSchema,
      opp_civ_slug: civSlugSchema,
      updated_at: z.number().int(),
      excerpt: z.string(),
    }),
  ),
});

export const mapNoteIndexSchema = z.object({
  notes: z.array(
    z.object({
      map_slug: mapSlugSchema,
      updated_at: z.number().int(),
      excerpt: z.string(),
    }),
  ),
});

// stats
export const statsByCivQuerySchema = z.object({
  my_civ: civSlugSchema,
  kind: gameKindSchema.optional(),
  exclude_randomized: z.coerce.boolean().optional(),
});

export const statsByCivResponseSchema = z.object({
  my_civ: civSlugSchema,
  rows: z.array(
    z.object({
      opp_civ_slug: civSlugSchema,
      games: z.number().int(),
      wins: z.number().int(),
      losses: z.number().int(),
      draws: z.number().int(),
      win_rate: z.number().nullable(),
    }),
  ),
});

export const statsByMapResponseSchema = z.object({
  rows: z.array(
    z.object({
      map_slug: mapSlugSchema,
      games: z.number().int(),
      wins: z.number().int(),
      losses: z.number().int(),
      win_rate: z.number().nullable(),
    }),
  ),
});

export const statsRecentResponseSchema = z.object({
  recent: z.array(gameSchema),
  last_30d: z.object({
    games: z.number().int(),
    wins: z.number().int(),
    losses: z.number().int(),
    win_rate: z.number().nullable(),
  }),
});

export type ManualGameBody = z.infer<typeof manualGameBodySchema>;
export type GamesQuery = z.infer<typeof gamesQuerySchema>;
export type SyncStatusResponse = z.infer<typeof syncStatusResponseSchema>;
export type StatsByCivResponse = z.infer<typeof statsByCivResponseSchema>;
export type StatsByMapResponse = z.infer<typeof statsByMapResponseSchema>;
export type StatsRecentResponse = z.infer<typeof statsRecentResponseSchema>;
