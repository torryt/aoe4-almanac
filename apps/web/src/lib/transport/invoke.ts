import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  EventBus,
  HttpMethod,
  SyncEventPayload,
  Transport,
  Unsubscribe,
} from "./types.ts";
import { TransportError } from "./types.ts";

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function camelizeKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(camelizeKeys);
  if (typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[snakeToCamel(k)] = camelizeKeys(v);
  }
  return out;
}

type Resolver = (
  m: RegExpMatchArray,
  qs: URLSearchParams,
  body: Record<string, unknown> | undefined,
) => { cmd: string; args: Record<string, unknown> };

const routes: Array<{ method: HttpMethod; pattern: RegExp; resolve: Resolver }> = [
  // civs
  { method: "GET", pattern: /^\/civs$/, resolve: () => ({ cmd: "civs_list", args: {} }) },
  { method: "GET", pattern: /^\/civs\/([^/]+)$/, resolve: (m) => ({ cmd: "civs_get", args: { slug: m[1] } }) },
  // me
  { method: "GET", pattern: /^\/me$/, resolve: () => ({ cmd: "me_get", args: {} }) },
  { method: "GET", pattern: /^\/me\/preferences$/, resolve: () => ({ cmd: "preferences_get", args: {} }) },
  { method: "PUT", pattern: /^\/me\/preferences$/, resolve: (_m, _qs, body) => ({ cmd: "preferences_set", args: { patch: body ?? {} } }) },
  { method: "GET", pattern: /^\/me\/data-counts$/, resolve: () => ({ cmd: "data_counts", args: {} }) },
  {
    method: "GET",
    pattern: /^\/me\/rating-info$/,
    resolve: (_m, qs) => ({ cmd: "rating_info", args: { leaderboard: qs.get("leaderboard") ?? undefined } }),
  },
  {
    method: "POST",
    pattern: /^\/me\/link-aoe4world$/,
    resolve: (_m, _qs, body) => ({ cmd: "link_aoe4world", args: { profileId: Number((body as { profile_id?: number })?.profile_id) } }),
  },
  { method: "DELETE", pattern: /^\/me\/link-aoe4world$/, resolve: () => ({ cmd: "unlink_aoe4world", args: {} }) },
  // games
  {
    method: "GET",
    pattern: /^\/games$/,
    resolve: (_m, qs) => {
      const q: Record<string, unknown> = {};
      const civ = qs.get("civ"); if (civ) q.civ = civ;
      const map = qs.get("map"); if (map) q.map = map;
      const result = qs.get("result"); if (result) q.result = result;
      const kind = qs.get("kind"); if (kind) q.kind = kind;
      const leaderboard = qs.get("leaderboard"); if (leaderboard) q.leaderboard = leaderboard;
      const since = qs.get("since"); if (since) q.since = Number(since);
      const cursor = qs.get("cursor"); if (cursor) q.cursor = Number(cursor);
      const oppCiv = qs.get("opp_civ"); if (oppCiv) q.oppCiv = oppCiv;
      const limit = qs.get("limit"); if (limit) q.limit = Number(limit);
      return { cmd: "games_list", args: { query: q } };
    },
  },
  { method: "GET", pattern: /^\/games\/(\d+)$/, resolve: (m) => ({ cmd: "games_get", args: { id: Number(m[1]!) } }) },
  // sync
  { method: "GET", pattern: /^\/sync\/status$/, resolve: () => ({ cmd: "sync_status", args: {} }) },
  {
    method: "POST",
    pattern: /^\/sync\/run$/,
    resolve: (_m, _qs, body) => ({ cmd: "sync_run", args: { full: Boolean((body as { full?: boolean })?.full) } }),
  },
  // notes - civ
  { method: "GET", pattern: /^\/notes\/civs$/, resolve: () => ({ cmd: "civ_notes_list", args: {} }) },
  { method: "GET", pattern: /^\/notes\/civs\/([^/]+)$/, resolve: (m) => ({ cmd: "civ_note_get", args: { slug: decodeURIComponent(m[1]!) } }) },
  {
    method: "PUT",
    pattern: /^\/notes\/civs\/([^/]+)$/,
    resolve: (m, _qs, body) => ({
      cmd: "civ_note_put",
      args: { slug: decodeURIComponent(m[1]!), bodyMd: String((body as { body_md?: string })?.body_md ?? "") },
    }),
  },
  // notes - matchup
  {
    method: "GET",
    pattern: /^\/notes\/matchups$/,
    resolve: (_m, qs) => ({ cmd: "matchup_notes_list", args: { myCiv: qs.get("my_civ") ?? undefined } }),
  },
  {
    method: "GET",
    pattern: /^\/notes\/matchups\/([^/]+)\/([^/]+)$/,
    resolve: (m) => ({
      cmd: "matchup_note_get",
      args: { myCiv: decodeURIComponent(m[1]!), oppCiv: decodeURIComponent(m[2]!) },
    }),
  },
  {
    method: "PUT",
    pattern: /^\/notes\/matchups\/([^/]+)\/([^/]+)$/,
    resolve: (m, _qs, body) => ({
      cmd: "matchup_note_put",
      args: {
        myCiv: decodeURIComponent(m[1]!),
        oppCiv: decodeURIComponent(m[2]!),
        bodyMd: String((body as { body_md?: string })?.body_md ?? ""),
      },
    }),
  },
  // notes - map
  { method: "GET", pattern: /^\/notes\/maps$/, resolve: () => ({ cmd: "map_notes_list", args: {} }) },
  { method: "GET", pattern: /^\/notes\/maps\/([^/]+)$/, resolve: (m) => ({ cmd: "map_note_get", args: { slug: decodeURIComponent(m[1]!) } }) },
  {
    method: "PUT",
    pattern: /^\/notes\/maps\/([^/]+)$/,
    resolve: (m, _qs, body) => ({
      cmd: "map_note_put",
      args: { slug: decodeURIComponent(m[1]!), bodyMd: String((body as { body_md?: string })?.body_md ?? "") },
    }),
  },
  // notes - games
  {
    method: "GET",
    pattern: /^\/notes\/games$/,
    resolve: (_m, qs) => {
      const ids = (qs.get("ids") ?? "")
        .split(",")
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0);
      return { cmd: "game_notes_batch", args: { ids } };
    },
  },
  { method: "GET", pattern: /^\/notes\/games\/(\d+)$/, resolve: (m) => ({ cmd: "game_note_get", args: { gameId: Number(m[1]!) } }) },
  {
    method: "PUT",
    pattern: /^\/notes\/games\/(\d+)$/,
    resolve: (m, _qs, body) => ({
      cmd: "game_note_put",
      args: { gameId: Number(m[1]!), bodyMd: String((body as { body_md?: string })?.body_md ?? "") },
    }),
  },
  // notes - export
  { method: "GET", pattern: /^\/notes\/export$/, resolve: () => ({ cmd: "notes_export_all", args: {} }) },
  // opponents
  {
    method: "GET",
    pattern: /^\/opponents$/,
    resolve: (_m, qs) => {
      const q: Record<string, unknown> = {};
      const civ = qs.get("my_civ"); if (civ) q.myCiv = civ;
      const limit = qs.get("limit"); if (limit) q.limit = Number(limit);
      const since = qs.get("since"); if (since) q.since = Number(since);
      return { cmd: "opponents_list", args: { query: q } };
    },
  },
  { method: "GET", pattern: /^\/opponents\/([^/]+)$/, resolve: (m) => ({ cmd: "opponents_get", args: { key: decodeURIComponent(m[1]!) } }) },
  // stats
  {
    method: "GET",
    pattern: /^\/stats\/by-civ$/,
    resolve: (_m, qs) => ({ cmd: "stats_by_civ", args: { myCiv: qs.get("my_civ") ?? "" } }),
  },
  { method: "GET", pattern: /^\/stats\/matchups$/, resolve: () => ({ cmd: "stats_matchups", args: {} }) },
  { method: "GET", pattern: /^\/stats\/by-map$/, resolve: () => ({ cmd: "stats_by_map", args: {} }) },
  {
    method: "GET",
    pattern: /^\/stats\/rating-history$/,
    resolve: (_m, qs) => ({
      cmd: "stats_rating_history",
      args: {
        leaderboard: qs.get("leaderboard") ?? "rm_solo",
        limit: qs.get("limit") ? Number(qs.get("limit")) : undefined,
      },
    }),
  },
  { method: "GET", pattern: /^\/stats\/recent$/, resolve: () => ({ cmd: "stats_recent", args: {} }) },
  // aoe4world
  {
    method: "GET",
    pattern: /^\/aoe4world\/search$/,
    resolve: (_m, qs) => ({ cmd: "aoe4world_search", args: { query: qs.get("q") ?? "" } }),
  },
];

function resolveRoute(method: HttpMethod, path: string, body: unknown) {
  const url = new URL(path, "http://x");
  const pathname = url.pathname;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.pattern);
    if (m) {
      return r.resolve(m, url.searchParams, body as Record<string, unknown> | undefined);
    }
  }
  return null;
}

export const invokeTransport: Transport = {
  async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const resolved = resolveRoute(method, path, body);
    if (!resolved) {
      throw new TransportError(404, `no Tauri route for ${method} ${path}`, null);
    }
    try {
      const out = await invoke<unknown>(resolved.cmd, resolved.args);
      // Rust returns snake_case keys; web code expects snake_case too, so don't
      // mangle response shape. (camelizeKeys is for outgoing arg names only.)
      return out as T;
    } catch (e) {
      // Rust commands serialize AppError as {code, message}.
      if (e && typeof e === "object") {
        const err = e as { code?: string; message?: string };
        throw new TransportError(
          err.code === "app" ? 400 : 500,
          err.message ?? String(e),
          null,
        );
      }
      throw new TransportError(500, String(e), null);
    }
  },
};

// camelizeKeys is reserved for future per-arg conversion; not used currently
// because the route table already builds args with the correct casing.
export { camelizeKeys };

export const invokeEventBus: EventBus = {
  subscribeSync(handler: (event: SyncEventPayload) => void): Unsubscribe {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listen<SyncEventPayload>("sync", (e) => {
      handler(e.payload);
    }).then((un) => {
      if (cancelled) {
        un();
      } else {
        unlisten = un;
      }
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  },
};
