import type { QueryClient } from "@tanstack/react-query";
import { transport, TransportError } from "./transport/index.ts";

export { TransportError as ApiError };

export const api = {
  get: <T,>(path: string) => transport.request<T>("GET", path),
  post: <T,>(path: string, body?: unknown) => transport.request<T>("POST", path, body),
  put: <T,>(path: string, body?: unknown) => transport.request<T>("PUT", path, body),
  patch: <T,>(path: string, body?: unknown) => transport.request<T>("PATCH", path, body),
  delete: <T,>(path: string) => transport.request<T>("DELETE", path),
};

// Query keys
export const qk = {
  me: ["me"] as const,
  preferences: ["me", "preferences"] as const,
  civs: ["civs"] as const,
  games: (filters: Record<string, unknown> = {}) => ["games", filters] as const,
  game: (id: number) => ["game", id] as const,
  syncStatus: ["sync", "status"] as const,
  civNotes: ["notes", "civs"] as const,
  civNote: (slug: string) => ["notes", "civ", slug] as const,
  matchupNotes: (myCiv?: string) => ["notes", "matchups", myCiv] as const,
  matchupNote: (a: string, b: string) => ["notes", "matchup", a, b] as const,
  mapNotes: ["notes", "maps"] as const,
  mapNote: (slug: string) => ["notes", "map", slug] as const,
  gameNote: (id: number) => ["notes", "game", id] as const,
  gameNotesBatch: (ids: number[]) =>
    ["notes", "games", "batch", [...ids].sort((a, b) => a - b).join(",")] as const,
  statsByCiv: (myCiv: string) => ["stats", "by-civ", myCiv] as const,
  statsMatchups: ["stats", "matchups"] as const,
  statsByMap: ["stats", "by-map"] as const,
  statsRecent: ["stats", "recent"] as const,
  ratingInfo: (leaderboard: string) => ["me", "rating-info", leaderboard] as const,
  ratingHistory: (leaderboard: string) =>
    ["stats", "rating-history", leaderboard] as const,
  opponents: (params: Record<string, unknown> = {}) =>
    ["opponents", params] as const,
  opponent: (key: string) => ["opponent", key] as const,
  dataCounts: ["me", "data-counts"] as const,
};

// Query-key prefixes for any cache derived from imported game data. Wiped on
// link (data identity changes) and unlink (data deleted). Civ / matchup / map
// notes are intentionally excluded — they belong to the user, not the profile.
const GAME_DATA_KEY_PREFIXES = [
  ["games"],
  ["game"],
  ["sync"],
  ["stats"],
  ["opponents"],
  ["opponent"],
  ["notes", "game"],
  qk.dataCounts,
  ["me", "rating-info"],
] as const;

export function clearGameDataCache(qc: QueryClient): void {
  for (const key of GAME_DATA_KEY_PREFIXES) {
    qc.removeQueries({ queryKey: key as readonly unknown[] });
  }
}

export function invalidateGameDataCache(qc: QueryClient): void {
  for (const key of GAME_DATA_KEY_PREFIXES) {
    void qc.invalidateQueries({ queryKey: key as readonly unknown[] });
  }
}

// Used by the "wipe all data" flow — drops every cache derived from user data,
// including civ/matchup/map notes which are otherwise preserved across re-link.
export function clearAllUserDataCache(qc: QueryClient): void {
  clearGameDataCache(qc);
  qc.removeQueries({ queryKey: ["notes"] });
}

export type DataCounts = {
  current_profile_id: number | null;
  games: number;
  game_notes: number;
  sync_state_rows: number;
  civ_notes: number;
  matchup_notes: number;
  map_notes: number;
};

export type Opponent = {
  key: string;
  profile_id: number | null;
  name: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  last_played_at: number;
  win_rate: number | null;
};

export type OpponentBreakdown = {
  civ_slug: string;
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
};

export type OpponentMapBreakdown = {
  map_slug: string;
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
};

export type OpponentGame = {
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
};

export type OpponentDetail = {
  opponent: {
    profile_id: number | null;
    name: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    first_played_at: number | null;
    last_played_at: number | null;
    win_rate: number | null;
  };
  by_opp_civ: OpponentBreakdown[];
  by_my_civ: OpponentBreakdown[];
  by_map: OpponentMapBreakdown[];
  games: OpponentGame[];
};

// Response types (loose because server is single source of truth)
export type UserPreferences = {
  auto_save_notes: boolean;
};

export type Me = {
  id: number;
  slug: string;
  display_name: string;
  aoe4world_profile_id: number | null;
};

export type Civ = {
  slug: string;
  name: string;
  parent_slug: string | null;
  is_variant: boolean;
  flag_image_url: string | null;
};

export type ParticipantDto = {
  id: number;
  game_id: number;
  team: number;
  is_self: boolean;
  profile_id: number | null;
  name: string;
  civ_slug: string;
  civ_randomized: boolean | null;
  result: "win" | "loss" | "draw" | "unknown";
  rating: number | null;
  rating_diff: number | null;
  mmr: number | null;
};

export type GameDto = {
  id: number;
  source: "aoe4world" | "manual";
  aoe4world_game_id: number | null;
  started_at: number;
  duration_seconds: number | null;
  map_slug: string | null;
  kind: string;
  leaderboard: string | null;
  my_civ_slug: string;
  my_civ_randomized: boolean | null;
  my_result: "win" | "loss" | "draw" | "unknown";
  my_rating: number | null;
  my_rating_diff: number | null;
  participants: ParticipantDto[];
};

export type GameNoteBatchEntry = {
  game_id: number;
  body_md: string;
  excerpt: string;
  updated_at: number;
};

export function syncRun(full = false): Promise<{ ok: true }> {
  return api.post("/sync/run", { full });
}

export type SyncStatus = {
  rows: Array<{
    leaderboard: string;
    last_seen_game_id: number | null;
    last_polled_at: number | null;
    last_success_at: number | null;
    last_error: string | null;
  }>;
  in_flight: boolean;
};

export type RatingInfo =
  | {
      unranked: true;
      leaderboard: string;
      country: string | null;
    }
  | {
      unranked: false;
      leaderboard: string;
      profile_id: number;
      country: string | null;
      rating: number | null;
      max_rating: number | null;
      rank: number | null;
      rank_total: number | null;
      rank_level: string | null;
      country_rank: number | null;
      country_total: number | null;
      streak: number | null;
      games_count: number | null;
      wins_count: number | null;
      losses_count: number | null;
      win_rate: number | null;
    };

export type RatingHistory = {
  leaderboard: string;
  points: Array<{ at: number; rating: number }>;
};

export type SearchResult = {
  profile_id: number;
  name: string;
  country: string | null;
  avatar_url: string | null;
  last_game_at: string | null;
};
