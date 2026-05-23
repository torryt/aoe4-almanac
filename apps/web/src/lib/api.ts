import type { QueryClient } from "@tanstack/react-query";

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public reqId: string | null,
  ) {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    const idStr = reqId ? ` [reqId=${reqId}]` : "";
    super(`API ${status}${idStr}: ${bodyStr}`);
  }
}

function newReqId(): string {
  // 8-char id; matches server-side default length.
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2);
  return uuid.replace(/-/g, "").slice(0, 8);
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const reqId = newReqId();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-request-id": reqId,
      ...(init?.headers ?? {}),
    },
  });
  // Server echoes x-request-id (and may override with its own if FE id was rejected).
  const serverReqId = res.headers.get("x-request-id") ?? reqId;
  if (!res.ok) {
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new ApiError(res.status, body, serverReqId);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
};

// Query keys
export const qk = {
  me: ["me"] as const,
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

export type DataCounts = {
  current_profile_id: number | null;
  games: number;
  game_notes: number;
  sync_state_rows: number;
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
