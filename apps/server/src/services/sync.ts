import { eq, and, sql } from "drizzle-orm";
import { db, sqlite } from "../db/client.ts";
import { syncState, users } from "../db/schema.ts";
import {
  getGamesPage,
  getLastGame,
  getPlayer,
  type RawAoe4WorldGame,
} from "./aoe4world.ts";
import {
  ensureMap,
  isoToUnix,
  normalizeCivSlug,
  normalizeKind,
  normalizeMapSlug,
  normalizeResult,
} from "./normalize.ts";
import { emitSync } from "./syncEvents.ts";
import { log } from "../log.ts";

const SYNC_KEY = "all"; // single bucket; per-leaderboard slicing can be added later

let runningForUser: Map<number, Promise<void>> = new Map();

type SyncOpts = { reqId?: string };

export function isSyncRunning(userId: number): boolean {
  return runningForUser.has(userId);
}

export async function runSync(
  userId: number,
  full = false,
  opts: SyncOpts = {},
): Promise<void> {
  const existing = runningForUser.get(userId);
  if (existing) return existing;
  const p = doRunSync(userId, full, opts).finally(() => runningForUser.delete(userId));
  runningForUser.set(userId, p);
  return p;
}

async function doRunSync(
  userId: number,
  full: boolean,
  opts: SyncOpts,
): Promise<void> {
  const startWallMs = performance.now();

  const profileRow = db()
    .select({ profileId: users.aoe4worldProfileId })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  const profileId = profileRow?.profileId ?? null;
  if (!profileId) {
    throw new Error("aoe4world profile not linked");
  }

  const startedTs = Math.floor(Date.now() / 1000);
  upsertSyncState(userId, { lastPolledAt: startedTs });
  emitSync({
    type: "sync.started",
    user_id: userId,
    profile_id: profileId,
    full,
    ts: startedTs,
  });
  log(opts.reqId, `sync.start user=${userId} profile=${profileId} full=${full}`);

  try {
    const state = readSyncState(userId);
    const since = full ? undefined : sinceFromState(state);

    let page = 1;
    let importedThisRun = 0;
    let scannedThisRun = 0;
    let totalCount: number | null = null;
    let highestSeenGameId = state.lastSeenGameId ?? 0;
    let shouldStop = false;

    while (!shouldStop) {
      const res = await getGamesPage(profileId, { since, page, limit: 50 });
      if (!res.games || res.games.length === 0) break;
      if (totalCount === null && typeof res.total_count === "number") {
        totalCount = res.total_count;
      }
      const pageStart = performance.now();
      for (const raw of res.games) {
        const wasNew = ingestGame(userId, profileId, raw);
        if (wasNew) importedThisRun += 1;
        scannedThisRun += 1;
        if (raw.game_id > highestSeenGameId) highestSeenGameId = raw.game_id;
        if (
          !full &&
          state.lastSeenGameId !== null &&
          raw.game_id <= state.lastSeenGameId
        ) {
          shouldStop = true;
        }
      }
      const pageMs = performance.now() - pageStart;
      emitSync({
        type: "sync.page",
        user_id: userId,
        page,
        games_in_page: res.games.length,
        imported_so_far: importedThisRun,
        scanned_so_far: scannedThisRun,
        total_count: totalCount,
        full,
        ts: Math.floor(Date.now() / 1000),
      });
      log(
        opts.reqId,
        `sync.page user=${userId} page=${page} games=${res.games.length} imported_so_far=${importedThisRun} ingest_ms=${pageMs.toFixed(0)}`,
      );
      if (res.games.length < 50) break;
      page += 1;
      if (page > 200) break; // safety
    }

    upsertSyncState(userId, {
      lastSuccessAt: Math.floor(Date.now() / 1000),
      lastError: null,
      lastSeenGameId: highestSeenGameId || null,
    });
    const durationMs = performance.now() - startWallMs;
    emitSync({
      type: "sync.completed",
      user_id: userId,
      imported: importedThisRun,
      last_seen_game_id: highestSeenGameId || null,
      duration_ms: Math.round(durationMs),
      ts: Math.floor(Date.now() / 1000),
    });
    log(
      opts.reqId,
      `sync.done user=${userId} imported=${importedThisRun} pages=${page} duration_ms=${durationMs.toFixed(0)}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    upsertSyncState(userId, { lastError: msg.slice(0, 1000) });
    emitSync({
      type: "sync.error",
      user_id: userId,
      message: msg,
      ts: Math.floor(Date.now() / 1000),
    });
    log(opts.reqId, `sync.error user=${userId} msg=${msg}`);
    throw e;
  }
}

export async function pollLastAndSyncIfNew(userId: number): Promise<boolean> {
  const profileRow = db()
    .select({ profileId: users.aoe4worldProfileId })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  const profileId = profileRow?.profileId ?? null;
  if (!profileId) return false;

  const state = readSyncState(userId);
  const last = await getLastGame(profileId);
  upsertSyncState(userId, { lastPolledAt: Math.floor(Date.now() / 1000) });

  if (!last) return false;
  if (state.lastSeenGameId !== null && last.game_id <= state.lastSeenGameId) {
    return false;
  }
  await runSync(userId, false);
  return true;
}

function sinceFromState(state: ReturnType<typeof readSyncState>): string | undefined {
  if (!state.lastSuccessAt) return undefined;
  const cushion = 5 * 60; // 5 min
  const ts = state.lastSuccessAt - cushion;
  return new Date(ts * 1000).toISOString();
}

function readSyncState(userId: number) {
  const row = db()
    .select()
    .from(syncState)
    .where(and(eq(syncState.userId, userId), eq(syncState.leaderboard, SYNC_KEY)))
    .get();
  return {
    lastSeenGameId: row?.lastSeenGameId ?? null,
    lastPolledAt: row?.lastPolledAt ?? null,
    lastSuccessAt: row?.lastSuccessAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

function upsertSyncState(
  userId: number,
  patch: {
    lastSeenGameId?: number | null;
    lastPolledAt?: number | null;
    lastSuccessAt?: number | null;
    lastError?: string | null;
  },
): void {
  // SQLite upsert via raw sql for nullable handling
  const existing = sqlite()
    .prepare(
      "SELECT 1 FROM sync_state WHERE user_id = ? AND leaderboard = ?",
    )
    .get(userId, SYNC_KEY);
  if (!existing) {
    sqlite()
      .prepare(
        "INSERT INTO sync_state (user_id, leaderboard, last_seen_game_id, last_polled_at, last_success_at, last_error) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        userId,
        SYNC_KEY,
        patch.lastSeenGameId ?? null,
        patch.lastPolledAt ?? null,
        patch.lastSuccessAt ?? null,
        patch.lastError ?? null,
      );
    return;
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (Object.prototype.hasOwnProperty.call(patch, "lastSeenGameId")) {
    fields.push("last_seen_game_id = ?");
    values.push(patch.lastSeenGameId ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastPolledAt")) {
    fields.push("last_polled_at = ?");
    values.push(patch.lastPolledAt ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastSuccessAt")) {
    fields.push("last_success_at = ?");
    values.push(patch.lastSuccessAt ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastError")) {
    fields.push("last_error = ?");
    values.push(patch.lastError ?? null);
  }
  if (fields.length === 0) return;
  values.push(userId, SYNC_KEY);
  sqlite()
    .prepare(
      `UPDATE sync_state SET ${fields.join(", ")} WHERE user_id = ? AND leaderboard = ?`,
    )
    .run(...values);
}

export function listSyncState(userId: number) {
  return db().select().from(syncState).where(eq(syncState.userId, userId)).all();
}

function ingestGame(
  userId: number,
  selfProfileId: number,
  raw: RawAoe4WorldGame,
): boolean {
  let isNew = false;
  sqlite().transaction(() => {
    // Find self entry
    const allPlayers: Array<{
      teamIdx: number;
      p: RawAoe4WorldGame["teams"][number][number]["player"];
    }> = [];
    raw.teams.forEach((team, teamIdx) => {
      for (const entry of team) {
        allPlayers.push({ teamIdx, p: entry.player });
      }
    });
    const selfEntry = allPlayers.find((x) => x.p.profile_id === selfProfileId);
    if (!selfEntry) return; // skip games we can't find self in

    const mapSlug = normalizeMapSlug(raw.map ?? null);
    ensureMap(mapSlug, raw.map ?? null);

    const myCivSlug = normalizeCivSlug(selfEntry.p.civilization);
    const myResult = normalizeResult(selfEntry.p.result);
    const kind = normalizeKind(raw.kind ?? null);
    const startedAt = isoToUnix(raw.started_at);

    // Upsert game by (user_id, aoe4world_game_id)
    const existing = sqlite()
      .prepare(
        "SELECT id FROM games WHERE user_id = ? AND aoe4world_game_id = ?",
      )
      .get(userId, raw.game_id) as { id: number } | undefined;

    let gameId: number;
    if (existing) {
      gameId = existing.id;
      sqlite()
        .prepare(
          `UPDATE games SET
             duration_seconds = ?,
             map_slug = ?,
             kind = ?,
             leaderboard = ?,
             patch = ?,
             server = ?,
             my_team = ?,
             my_civ_slug = ?,
             my_civ_randomized = ?,
             my_result = ?,
             my_rating = ?,
             my_rating_diff = ?,
             my_mmr = ?,
             raw_payload_json = ?,
             updated_at = unixepoch()
           WHERE id = ?`,
        )
        .run(
          raw.duration ?? null,
          mapSlug,
          kind,
          raw.leaderboard ?? null,
          raw.patch ?? null,
          raw.server ?? null,
          selfEntry.teamIdx,
          myCivSlug,
          selfEntry.p.civilization_randomized === true
            ? 1
            : selfEntry.p.civilization_randomized === false
              ? 0
              : null,
          myResult,
          selfEntry.p.rating ?? null,
          selfEntry.p.rating_diff ?? null,
          selfEntry.p.mmr ?? null,
          JSON.stringify(raw),
          gameId,
        );
    } else {
      const result = sqlite()
        .prepare(
          `INSERT INTO games (
             user_id, source, aoe4world_game_id, started_at, duration_seconds,
             map_slug, kind, leaderboard, patch, server, my_team,
             my_civ_slug, my_civ_randomized, my_result, my_rating, my_rating_diff, my_mmr,
             raw_payload_json, imported_at, created_at, updated_at
           ) VALUES (?, 'aoe4world', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch(), unixepoch())`,
        )
        .run(
          userId,
          raw.game_id,
          startedAt,
          raw.duration ?? null,
          mapSlug,
          kind,
          raw.leaderboard ?? null,
          raw.patch ?? null,
          raw.server ?? null,
          selfEntry.teamIdx,
          myCivSlug,
          selfEntry.p.civilization_randomized === true
            ? 1
            : selfEntry.p.civilization_randomized === false
              ? 0
              : null,
          myResult,
          selfEntry.p.rating ?? null,
          selfEntry.p.rating_diff ?? null,
          selfEntry.p.mmr ?? null,
          JSON.stringify(raw),
        );
      gameId = Number(result.lastInsertRowid);
      isNew = true;
    }

    // Replace participants
    sqlite().prepare("DELETE FROM game_participants WHERE game_id = ?").run(gameId);
    const insertP = sqlite().prepare(
      `INSERT INTO game_participants (
         game_id, team, is_self, profile_id, name, civ_slug, civ_randomized,
         result, rating, rating_diff, mmr
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const { teamIdx, p } of allPlayers) {
      insertP.run(
        gameId,
        teamIdx,
        p.profile_id === selfProfileId ? 1 : 0,
        p.profile_id ?? null,
        p.name,
        normalizeCivSlug(p.civilization),
        p.civilization_randomized === true
          ? 1
          : p.civilization_randomized === false
            ? 0
            : null,
        normalizeResult(p.result),
        p.rating ?? null,
        p.rating_diff ?? null,
        p.mmr ?? null,
      );
    }
  })();

  return isNew;
}

export type UserDataCounts = {
  games: number;
  game_notes: number;
  sync_state_rows: number;
};

export function countUserGameData(userId: number): UserDataCounts {
  const games = sqlite()
    .prepare("SELECT COUNT(*) AS c FROM games WHERE user_id = ?")
    .get(userId) as { c: number };
  const gameNotes = sqlite()
    .prepare("SELECT COUNT(*) AS c FROM game_notes WHERE user_id = ?")
    .get(userId) as { c: number };
  const syncRows = sqlite()
    .prepare("SELECT COUNT(*) AS c FROM sync_state WHERE user_id = ?")
    .get(userId) as { c: number };
  return {
    games: games.c,
    game_notes: gameNotes.c,
    sync_state_rows: syncRows.c,
  };
}

export function wipeUserGameData(userId: number): UserDataCounts {
  const before = countUserGameData(userId);
  sqlite().transaction(() => {
    // game_participants and game_notes cascade via FK ON DELETE CASCADE.
    sqlite().prepare("DELETE FROM games WHERE user_id = ?").run(userId);
    sqlite().prepare("DELETE FROM sync_state WHERE user_id = ?").run(userId);
  })();
  return before;
}

export async function linkProfileAndBackfill(
  userId: number,
  profileId: number,
  opts: SyncOpts = {},
): Promise<void> {
  const player = await getPlayer(profileId);
  log(opts.reqId, `link.player_fetched profile_id=${profileId} name=${player.name}`);

  // If switching to a different profile, wipe all per-user game data first.
  // Same-profile re-link or null→profile link is non-destructive.
  const existing = db()
    .select({ profileId: users.aoe4worldProfileId })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  const previousProfileId = existing?.profileId ?? null;
  if (previousProfileId !== null && previousProfileId !== profileId) {
    const wiped = wipeUserGameData(userId);
    log(
      opts.reqId,
      `link.wiped previous_profile=${previousProfileId} new_profile=${profileId} games=${wiped.games} game_notes=${wiped.game_notes} sync_rows=${wiped.sync_state_rows}`,
    );
  }

  db()
    .update(users)
    .set({
      aoe4worldProfileId: profileId,
      displayName: player.name,
      updatedAt: sql`(unixepoch())`,
    })
    .where(eq(users.id, userId))
    .run();
  emitSync({
    type: "link.player_fetched",
    user_id: userId,
    profile_id: profileId,
    display_name: player.name,
    ts: Math.floor(Date.now() / 1000),
  });
  await runSync(userId, true, opts);
}
