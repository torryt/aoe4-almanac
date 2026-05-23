import { SpanStatusCode } from "@opentelemetry/api";
import { env } from "../env.ts";
import { tracer } from "../telemetry.ts";

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
  return tracer.startActiveSpan("aoe4world.pace", async (span) => {
    let waitedMs = 0;
    let iterations = 0;
    try {
      while (true) {
        iterations += 1;
        const now = nowMs();
        while (callTimes.length > 0 && now - (callTimes[0] ?? 0) > WINDOW_MS) {
          callTimes.shift();
        }
        const sinceLast = now - lastCallAt;
        if (sinceLast < MIN_GAP_MS) {
          const w = MIN_GAP_MS - sinceLast;
          waitedMs += w;
          await wait(w);
          continue;
        }
        if (callTimes.length >= MAX_PER_WINDOW) {
          const earliest = callTimes[0] ?? now;
          const w = WINDOW_MS - (now - earliest) + 50;
          waitedMs += w;
          await wait(w);
          continue;
        }
        break;
      }
      const t = nowMs();
      lastCallAt = t;
      callTimes.push(t);
    } finally {
      span.setAttribute("pace.waited_ms", waitedMs);
      span.setAttribute("pace.iterations", iterations);
      span.setAttribute("pace.window_calls", callTimes.length);
      span.end();
    }
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function rateLimitedFetch(url: string, init?: RequestInit): Promise<Response> {
  return tracer.startActiveSpan("aoe4world.fetch", async (span) => {
    const ua = env().AOE4_PORTAL_USER_AGENT;
    const path = safePath(url);
    span.setAttribute("url.full", url);
    span.setAttribute("url.path", path);
    span.setAttribute("http.request.method", init?.method ?? "GET");
    try {
      await pace();
      const headers = new Headers(init?.headers);
      headers.set("user-agent", ua);
      headers.set("accept", "application/json");
      const t0 = nowMs();
      const res = await fetch(url, { ...init, headers });
      const dt = nowMs() - t0;
      span.setAttribute("http.response.status_code", res.status);
      span.setAttribute("http.client.network_ms", dt);
      return res;
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
      throw e;
    } finally {
      span.end();
    }
  });
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname + new URL(url).search;
  } catch {
    return url;
  }
}

async function fetchJsonWithBackoff<T>(url: string): Promise<T> {
  return tracer.startActiveSpan("aoe4world.fetchJsonWithBackoff", async (span) => {
    span.setAttribute("url.path", safePath(url));
    let delay = 5_000;
    const max = 5 * 60_000;
    let attempts = 0;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        attempts += 1;
        const res = await rateLimitedFetch(url);
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get("retry-after") ?? 0) * 1000;
          const sleep = retryAfter > 0 ? retryAfter : delay;
          span.addEvent("retry", { status: res.status, sleep_ms: sleep });
          await wait(sleep);
          delay = Math.min(delay * 2, max);
          continue;
        }
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`aoe4world ${res.status}: ${text}`);
        }
        const text = await res.text();
        span.setAttribute("http.response.body_bytes", text.length);
        return JSON.parse(text) as T;
      }
      throw new Error(`aoe4world: retry budget exhausted for ${url}`);
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
      throw e;
    } finally {
      span.setAttribute("attempts", attempts);
      span.end();
    }
  });
}

async function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan("aoe4world.withMutex", async (span) => {
    const wasContended = inFlight !== undefined;
    span.setAttribute("mutex.contended", wasContended);
    const t0 = nowMs();
    while (inFlight) {
      try {
        await inFlight;
      } catch {
        // predecessor errored; we still proceed
      }
    }
    span.setAttribute("mutex.wait_ms", nowMs() - t0);
    const p = fn();
    // Capture `wrapped` in the closure so the cleanup compares the right
    // reference. (Earlier version compared `inFlight === p`, but `inFlight`
    // was set to the wrapped finally-promise, not p — so the cleanup never
    // cleared inFlight and every subsequent caller spun in an unbounded
    // microtask loop.)
    const wrapped = p.finally(() => {
      if (inFlight === wrapped) inFlight = undefined;
    });
    inFlight = wrapped;
    try {
      return await p;
    } finally {
      span.end();
    }
  });
}

export function isInFlight(): boolean {
  return inFlight !== undefined;
}

// --- Endpoints ---

export async function searchPlayers(query: string): Promise<RawSearchResponse> {
  return tracer.startActiveSpan("aoe4world.searchPlayers", async (span) => {
    span.setAttribute("query", query);
    try {
      const url = `${BASE}/players/search?query=${encodeURIComponent(query)}`;
      return await withMutex(() => fetchJsonWithBackoff<RawSearchResponse>(url));
    } finally {
      span.end();
    }
  });
}

export async function getPlayer(profileId: number): Promise<RawAoe4WorldPlayer> {
  return tracer.startActiveSpan("aoe4world.getPlayer", async (span) => {
    span.setAttribute("aoe4world.profile_id", profileId);
    try {
      const url = `${BASE}/players/${profileId}`;
      return await withMutex(() => fetchJsonWithBackoff<RawAoe4WorldPlayer>(url));
    } finally {
      span.end();
    }
  });
}

export async function getLastGame(profileId: number): Promise<RawAoe4WorldGame | null> {
  return tracer.startActiveSpan("aoe4world.getLastGame", async (span) => {
    span.setAttribute("aoe4world.profile_id", profileId);
    try {
      const url = `${BASE}/players/${profileId}/games/last`;
      try {
        return await withMutex(() => fetchJsonWithBackoff<RawAoe4WorldGame>(url));
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("aoe4world 404")) return null;
        throw e;
      }
    } finally {
      span.end();
    }
  });
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
  return tracer.startActiveSpan("aoe4world.getGamesPage", async (span) => {
    span.setAttribute("aoe4world.profile_id", profileId);
    if (args.leaderboard) span.setAttribute("query.leaderboard", args.leaderboard);
    if (args.page) span.setAttribute("query.page", args.page);
    if (args.since) span.setAttribute("query.since", args.since);
    try {
      const params = new URLSearchParams();
      if (args.leaderboard) params.set("leaderboard", args.leaderboard);
      if (args.since) params.set("since", args.since);
      if (args.page) params.set("page", String(args.page));
      if (args.limit) params.set("limit", String(args.limit));
      const qs = params.toString();
      const url = `${BASE}/players/${profileId}/games${qs ? `?${qs}` : ""}`;
      const res = await withMutex(() => fetchJsonWithBackoff<RawGamesResponse>(url));
      span.setAttribute("response.count", res.count ?? res.games?.length ?? 0);
      return res;
    } finally {
      span.end();
    }
  });
}
