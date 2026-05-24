import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    aoe4worldProfileId: integer("aoe4world_profile_id"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    slugUq: uniqueIndex("users_slug_uq").on(t.slug),
    profileIdUq: uniqueIndex("users_profile_id_uq").on(t.aoe4worldProfileId),
  }),
);

export const userPreferences = sqliteTable("user_preferences", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  autoSaveNotes: integer("auto_save_notes", { mode: "boolean" })
    .notNull()
    .default(true),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
  }),
);

export const civilizations = sqliteTable("civilizations", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  parentSlug: text("parent_slug"),
  isVariant: integer("is_variant", { mode: "boolean" }).notNull().default(false),
  flagImageUrl: text("flag_image_url"),
  dataJson: text("data_json"),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const civSlugAliases = sqliteTable("civ_slug_aliases", {
  alias: text("alias").primaryKey(),
  civSlug: text("civ_slug").notNull(),
});

export const maps = sqliteTable(
  "maps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    slugUq: uniqueIndex("maps_slug_uq").on(t.slug),
  }),
);

export const games = sqliteTable(
  "games",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["aoe4world"] }).notNull(),
    aoe4worldGameId: integer("aoe4world_game_id"),
    startedAt: integer("started_at").notNull(),
    durationSeconds: integer("duration_seconds"),
    mapSlug: text("map_slug"),
    kind: text("kind").notNull(),
    leaderboard: text("leaderboard"),
    patch: integer("patch"),
    server: text("server"),
    myTeam: integer("my_team"),
    myCivSlug: text("my_civ_slug").notNull(),
    myCivRandomized: integer("my_civ_randomized", { mode: "boolean" }),
    myResult: text("my_result", { enum: ["win", "loss", "draw", "unknown"] }).notNull(),
    myRating: integer("my_rating"),
    myRatingDiff: integer("my_rating_diff"),
    myMmr: integer("my_mmr"),
    rawPayloadJson: text("raw_payload_json"),
    importedAt: integer("imported_at"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    // Partial unique: only enforced when aoe4world_game_id is non-null.
    aoe4worldUq: uniqueIndex("games_aoe4world_uq")
      .on(t.userId, t.aoe4worldGameId)
      .where(sql`${t.aoe4worldGameId} IS NOT NULL`),
    userStartedIdx: index("games_user_started_idx").on(t.userId, t.startedAt),
    userCivIdx: index("games_user_civ_idx").on(t.userId, t.myCivSlug),
    userMapIdx: index("games_user_map_idx").on(t.userId, t.mapSlug),
  }),
);

export const gameParticipants = sqliteTable(
  "game_participants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    team: integer("team").notNull(),
    isSelf: integer("is_self", { mode: "boolean" }).notNull(),
    profileId: integer("profile_id"),
    name: text("name").notNull(),
    civSlug: text("civ_slug").notNull(),
    civRandomized: integer("civ_randomized", { mode: "boolean" }),
    result: text("result", { enum: ["win", "loss", "draw", "unknown"] }).notNull(),
    rating: integer("rating"),
    ratingDiff: integer("rating_diff"),
    mmr: integer("mmr"),
  },
  (t) => ({
    gameIdx: index("participants_game_idx").on(t.gameId),
    civIdx: index("participants_civ_idx").on(t.civSlug),
    profileIdx: index("participants_profile_idx").on(t.profileId),
  }),
);

export const civNotes = sqliteTable(
  "civ_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    civSlug: text("civ_slug").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    userCivUq: uniqueIndex("civ_notes_user_civ_uq").on(t.userId, t.civSlug),
  }),
);

export const matchupNotes = sqliteTable(
  "matchup_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    myCivSlug: text("my_civ_slug").notNull(),
    oppCivSlug: text("opp_civ_slug").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    pairUq: uniqueIndex("matchup_notes_pair_uq").on(
      t.userId,
      t.myCivSlug,
      t.oppCivSlug,
    ),
    userMyCivIdx: index("matchup_notes_user_mycivc_idx").on(t.userId, t.myCivSlug),
  }),
);

export const mapNotes = sqliteTable(
  "map_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mapSlug: text("map_slug").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    userMapUq: uniqueIndex("map_notes_user_map_uq").on(t.userId, t.mapSlug),
  }),
);

export const gameNotes = sqliteTable(
  "game_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    bodyMd: text("body_md").notNull().default(""),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    userGameUq: uniqueIndex("game_notes_user_game_uq").on(t.userId, t.gameId),
  }),
);

export const syncState = sqliteTable(
  "sync_state",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leaderboard: text("leaderboard").notNull(),
    lastSeenGameId: integer("last_seen_game_id"),
    lastPolledAt: integer("last_polled_at"),
    lastSuccessAt: integer("last_success_at"),
    lastError: text("last_error"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.leaderboard] }),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type GameInsert = typeof games.$inferInsert;
export type ParticipantRow = typeof gameParticipants.$inferSelect;
export type ParticipantInsert = typeof gameParticipants.$inferInsert;
export type CivRow = typeof civilizations.$inferSelect;
export type SyncStateRow = typeof syncState.$inferSelect;
