import { env } from "../env.ts";

const BASE = "https://aoe4world.com/api/v0";

export type RawAoe4WorldGame = {
  game_id: number;
  started_at: string;
  updated_at?: string;
  duration?: number | null;
  map?: string | null;
  kind?: string | null;
  leaderboard?: string | null;
  mmr_leaderboard?: string | null;
  season?: number | null;
  server?: string | null;
  patch?: number | null;
  average_rating?: number | null;
  average_mmr?: number | null;
  ongoing?: boolean;
  just_finished?: boolean;
  teams: Array<
    Array<{
      player: {
        result?: "win" | "loss" | "noresult" | null;
        civilization?: string | null;
        civilization_randomized?: boolean | null;
        rating?: number | null;
        rating_diff?: number | null;
        mmr?: number | null;
        mmr_diff?: number | null;
        input_type?: string | null;
        profile_id: number;
        name: string;
        steam_id?: string | null;
        country?: string | null;
      };
    }>
  >;
};

export type RawAoe4WorldPlayer = {
  name: string;
  profile_id: number;
  steam_id?: string | null;
  country?: string | null;
  avatars?: { small?: string; medium?: string; full?: string } | null;
  last_game_at?: string | null;
  leaderboards?: Record<string, unknown>;
};

export type RawSearchResponse = {
  total_count: number;
  page: number;
  per_page: number;
  count: number;
  offset: number;
  players: RawAoe4WorldPlayer[];
};

export type RawGamesResponse = {
  total_count: number;
  page: number;
  per_page: number;
  count: number;
  offset: number;
  filters: unknown;
  games: RawAoe4WorldGame[];
};

// --- Rate limiter ---
const MIN_GAP_MS = 250;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

let lastCallAt = 0;
const callTimes: number[] = [];
let inFlight: Promise<unknown> | undefined;

function nowMs(): number {
  return Date.now();
}

async function pace(): Promise<void> {
  while (true) {
    const now = nowMs();
    while (callTimes.length > 0 && now - (callTimes[0] ?? 0) > WINDOW_MS) {
      callTimes.shift();
    }
    const sinceLast = now - lastCallAt;
    if (sinceLast < MIN_GAP_MS) {
      await wait(MIN_GAP_MS - sinceLast);
      continue;
    }
    if (callTimes.length >= MAX_PER_WINDOW) {
      const earliest = callTimes[0] ?? now;
      await wait(WINDOW_MS - (now - earliest) + 50);
      continue;
    }
    break;
  }
  const t = nowMs();
  lastCallAt = t;
  callTimes.push(t);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function rateLimitedFetch(url: string, init?: RequestInit): Promise<Response> {
  const ua = env().AOE4_ALMANAC_USER_AGENT;
  await pace();
  const headers = new Headers(init?.headers);
  headers.set("user-agent", ua);
  headers.set("accept", "application/json");
  return fetch(url, { ...init, headers });
}

async function fetchJsonWithBackoff<T>(url: string): Promise<T> {
  let delay = 5_000;
  const max = 5 * 60_000;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await rateLimitedFetch(url);
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 0) * 1000;
      const sleep = retryAfter > 0 ? retryAfter : delay;
      await wait(sleep);
      delay = Math.min(delay * 2, max);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`aoe4world ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }
  throw new Error(`aoe4world: retry budget exhausted for ${url}`);
}

// Serializes upstream calls so the rate limiter sees one in-flight request at a time.
// `wrapped` (not `p`) is what gets stored in `inFlight`, and the cleanup must compare
// against `wrapped` — comparing against `p` left `inFlight` stuck and spun callers
// in an unbounded microtask loop.
async function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  while (inFlight) {
    try {
      await inFlight;
    } catch {
      // predecessor errored; we still proceed
    }
  }
  const p = fn();
  const wrapped = p.finally(() => {
    if (inFlight === wrapped) inFlight = undefined;
  });
  inFlight = wrapped;
  return p;
}

export function isInFlight(): boolean {
  return inFlight !== undefined;
}

// --- Endpoints ---

export async function searchPlayers(query: string): Promise<RawSearchResponse> {
  const url = `${BASE}/players/search?query=${encodeURIComponent(query)}`;
  return withMutex(() => fetchJsonWithBackoff<RawSearchResponse>(url));
}

export async function getPlayer(profileId: number): Promise<RawAoe4WorldPlayer> {
  const url = `${BASE}/players/${profileId}`;
  return withMutex(() => fetchJsonWithBackoff<RawAoe4WorldPlayer>(url));
}

export async function getLastGame(profileId: number): Promise<RawAoe4WorldGame | null> {
  const url = `${BASE}/players/${profileId}/games/last`;
  try {
    return await withMutex(() => fetchJsonWithBackoff<RawAoe4WorldGame>(url));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("aoe4world 404")) return null;
    throw e;
  }
}

export type GamesQueryArgs = {
  leaderboard?: string;
  since?: string; // ISO
  page?: number;
  limit?: number;
};

export async function getGamesPage(
  profileId: number,
  args: GamesQueryArgs = {},
): Promise<RawGamesResponse> {
  const params = new URLSearchParams();
  if (args.leaderboard) params.set("leaderboard", args.leaderboard);
  if (args.since) params.set("since", args.since);
  if (args.page) params.set("page", String(args.page));
  if (args.limit) params.set("limit", String(args.limit));
  const qs = params.toString();
  const url = `${BASE}/players/${profileId}/games${qs ? `?${qs}` : ""}`;
  return withMutex(() => fetchJsonWithBackoff<RawGamesResponse>(url));
}
