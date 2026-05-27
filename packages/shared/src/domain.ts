import { z } from "zod";

export const civSlugSchema = z.string().min(1).max(64);
export const mapSlugSchema = z.string().min(1).max(128);

export const leaderboardSchema = z.enum([
  "rm_solo",
  "rm_team",
  "rm_1v1",
  "rm_2v2",
  "rm_3v3",
  "rm_4v4",
  "qm_1v1",
  "qm_2v2",
  "qm_3v3",
  "qm_4v4",
  "custom",
  "unknown",
]);
export type Leaderboard = z.infer<typeof leaderboardSchema>;

export const gameKindSchema = z.enum([
  "rm_1v1",
  "rm_2v2",
  "rm_3v3",
  "rm_4v4",
  "rm_team",
  "qm_1v1",
  "qm_2v2",
  "qm_3v3",
  "qm_4v4",
  "custom",
  "manual",
  "unknown",
]);
export type GameKind = z.infer<typeof gameKindSchema>;

export const resultSchema = z.enum(["win", "loss", "draw", "unknown"]);
export type Result = z.infer<typeof resultSchema>;

export const sourceSchema = z.enum(["aoe4world", "manual"]);
export type GameSource = z.infer<typeof sourceSchema>;

export const civSchema = z.object({
  slug: civSlugSchema,
  name: z.string(),
  parent_slug: civSlugSchema.nullable(),
  is_variant: z.boolean(),
  flag_image_url: z.string().url().nullable(),
});
export type Civ = z.infer<typeof civSchema>;

export const participantSchema = z.object({
  id: z.number().int(),
  game_id: z.number().int(),
  team: z.number().int(),
  is_self: z.boolean(),
  profile_id: z.number().int().nullable(),
  name: z.string(),
  civ_slug: civSlugSchema,
  civ_randomized: z.boolean().nullable(),
  result: resultSchema,
  rating: z.number().int().nullable(),
  rating_diff: z.number().int().nullable(),
  mmr: z.number().int().nullable(),
});
export type Participant = z.infer<typeof participantSchema>;

export const gameSchema = z.object({
  id: z.number().int(),
  user_id: z.number().int(),
  source: sourceSchema,
  aoe4world_game_id: z.number().int().nullable(),
  started_at: z.number().int(),
  duration_seconds: z.number().int().nullable(),
  map_slug: mapSlugSchema.nullable(),
  kind: gameKindSchema,
  leaderboard: leaderboardSchema.nullable(),
  patch: z.number().int().nullable(),
  server: z.string().nullable(),
  my_team: z.number().int().nullable(),
  my_civ_slug: civSlugSchema,
  my_civ_randomized: z.boolean().nullable(),
  my_result: resultSchema,
  my_rating: z.number().int().nullable(),
  my_rating_diff: z.number().int().nullable(),
  my_mmr: z.number().int().nullable(),
  imported_at: z.number().int().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type Game = z.infer<typeof gameSchema>;

export const gameWithParticipantsSchema = gameSchema.extend({
  participants: z.array(participantSchema),
});
export type GameWithParticipants = z.infer<typeof gameWithParticipantsSchema>;

export const noteBodySchema = z.object({
  body_md: z.string().max(200000),
});

export const userMeSchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  display_name: z.string(),
  aoe4world_profile_id: z.number().int().nullable(),
});
export type UserMe = z.infer<typeof userMeSchema>;

export const userPreferencesSchema = z.object({
  auto_save_notes: z.boolean(),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const syncStateSchema = z.object({
  leaderboard: z.string(),
  last_seen_game_id: z.number().int().nullable(),
  last_polled_at: z.number().int().nullable(),
  last_success_at: z.number().int().nullable(),
  last_error: z.string().nullable(),
});
export type SyncState = z.infer<typeof syncStateSchema>;

export const aoe4worldSearchResultSchema = z.object({
  profile_id: z.number().int(),
  name: z.string(),
  country: z.string().nullable(),
  avatar_url: z.string().nullable(),
  last_game_at: z.string().nullable(),
});
export type Aoe4WorldSearchResult = z.infer<typeof aoe4worldSearchResultSchema>;
