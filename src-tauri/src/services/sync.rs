use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::events::{emit_sync, unix_secs_now, SyncEvent};
use crate::services::aoe4world::{
    get_games_page, get_player, GamesQueryArgs, RawAoe4WorldGame,
};
use crate::services::normalize::{
    ensure_map, iso_to_unix, normalize_civ_slug, normalize_kind, normalize_map_slug,
    normalize_result,
};
use rusqlite::{params, OptionalExtension};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Instant;

const SYNC_KEY: &str = "all";

static IN_FLIGHT_USERS: Mutex<Option<HashSet<i64>>> = Mutex::new(None);

fn try_acquire(user_id: i64) -> bool {
    let mut g = IN_FLIGHT_USERS.lock().expect("sync set poisoned");
    let set = g.get_or_insert_with(HashSet::new);
    set.insert(user_id)
}

fn release(user_id: i64) {
    let mut g = IN_FLIGHT_USERS.lock().expect("sync set poisoned");
    if let Some(set) = g.as_mut() {
        set.remove(&user_id);
    }
}

pub fn is_sync_running(user_id: i64) -> bool {
    let g = IN_FLIGHT_USERS.lock().expect("sync set poisoned");
    g.as_ref().is_some_and(|s| s.contains(&user_id))
}

struct SyncStateRow {
    last_seen_game_id: Option<i64>,
}

fn read_sync_state(db: &Db, user_id: i64) -> AppResult<SyncStateRow> {
    let conn = db.0.lock().expect("db poisoned");
    let row: Option<Option<i64>> = conn
        .query_row(
            "SELECT last_seen_game_id FROM sync_state WHERE user_id = ?1 AND leaderboard = ?2",
            params![user_id, SYNC_KEY],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()?;
    Ok(SyncStateRow {
        last_seen_game_id: row.flatten(),
    })
}

#[derive(Default)]
struct StatePatch {
    last_seen_game_id: Option<Option<i64>>,
    last_polled_at: Option<Option<i64>>,
    last_success_at: Option<Option<i64>>,
    last_error: Option<Option<String>>,
}

fn upsert_sync_state(db: &Db, user_id: i64, patch: StatePatch) -> AppResult<()> {
    let conn = db.0.lock().expect("db poisoned");
    let exists: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM sync_state WHERE user_id = ?1 AND leaderboard = ?2",
            params![user_id, SYNC_KEY],
            |r| r.get(0),
        )
        .optional()?;
    if exists.is_none() {
        conn.execute(
            "INSERT INTO sync_state (user_id, leaderboard, last_seen_game_id, last_polled_at, last_success_at, last_error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                user_id,
                SYNC_KEY,
                patch.last_seen_game_id.unwrap_or(None),
                patch.last_polled_at.unwrap_or(None),
                patch.last_success_at.unwrap_or(None),
                patch.last_error.unwrap_or(None),
            ],
        )?;
        return Ok(());
    }
    let mut sets: Vec<&str> = Vec::new();
    let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(v) = patch.last_seen_game_id {
        sets.push("last_seen_game_id = ?");
        vals.push(Box::new(v));
    }
    if let Some(v) = patch.last_polled_at {
        sets.push("last_polled_at = ?");
        vals.push(Box::new(v));
    }
    if let Some(v) = patch.last_success_at {
        sets.push("last_success_at = ?");
        vals.push(Box::new(v));
    }
    if let Some(v) = patch.last_error {
        sets.push("last_error = ?");
        vals.push(Box::new(v));
    }
    if sets.is_empty() {
        return Ok(());
    }
    vals.push(Box::new(user_id));
    vals.push(Box::new(SYNC_KEY));
    let sql = format!(
        "UPDATE sync_state SET {} WHERE user_id = ? AND leaderboard = ?",
        sets.join(", ")
    );
    conn.execute(
        &sql,
        rusqlite::params_from_iter(vals.iter().map(|b| b.as_ref())),
    )?;
    Ok(())
}

pub fn run_sync(app: &tauri::AppHandle, db: &Db, user_id: i64, full: bool) -> AppResult<()> {
    if !try_acquire(user_id) {
        return Ok(());
    }
    let result = do_run_sync(app, db, user_id, full);
    release(user_id);
    result
}

fn fetch_profile_id(db: &Db, user_id: i64) -> AppResult<Option<i64>> {
    let conn = db.0.lock().expect("db poisoned");
    let row: Option<Option<i64>> = conn
        .query_row(
            "SELECT aoe4world_profile_id FROM users WHERE id = ?1",
            params![user_id],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()?;
    Ok(row.flatten())
}

fn do_run_sync(app: &tauri::AppHandle, db: &Db, user_id: i64, full: bool) -> AppResult<()> {
    let start = Instant::now();
    let profile_id = fetch_profile_id(db, user_id)?
        .ok_or_else(|| AppError::msg("aoe4world profile not linked"))?;
    let started_ts = unix_secs_now();
    upsert_sync_state(
        db,
        user_id,
        StatePatch {
            last_polled_at: Some(Some(started_ts)),
            ..Default::default()
        },
    )?;
    emit_sync(
        app,
        SyncEvent::SyncStarted {
            user_id,
            profile_id,
            full,
            ts: started_ts,
        },
    );
    log::info!("sync.start user={user_id} profile={profile_id} full={full}");

    let state = read_sync_state(db, user_id)?;
    let last_seen = state.last_seen_game_id;
    let refresh_recent: usize = 5;
    let mut page: i64 = 1;
    let mut imported: usize = 0;
    let mut scanned: usize = 0;
    let mut highest = last_seen.unwrap_or(0);

    let result: AppResult<()> = (|| {
        loop {
            let res = get_games_page(
                profile_id,
                &GamesQueryArgs {
                    page: Some(page),
                    limit: Some(50),
                    ..Default::default()
                },
            )?;
            if res.games.is_empty() {
                break;
            }
            let n = res.games.len();
            let mut stop = false;
            for raw in &res.games {
                let already_seen =
                    !full && last_seen.is_some_and(|ls| raw.game_id <= ls);
                if already_seen && scanned >= refresh_recent {
                    stop = true;
                    break;
                }
                let was_new = ingest_game(db, user_id, profile_id, raw)?;
                if was_new {
                    imported += 1;
                }
                scanned += 1;
                if raw.game_id > highest {
                    highest = raw.game_id;
                }
            }
            emit_sync(
                app,
                SyncEvent::SyncPage {
                    user_id,
                    page: page as u32,
                    games_in_page: n,
                    imported_so_far: imported,
                    scanned_so_far: scanned,
                    total_count: None,
                    full,
                    ts: unix_secs_now(),
                },
            );
            log::info!(
                "sync.page user={user_id} page={page} games={n} imported_so_far={imported}"
            );
            if stop || n < 50 {
                break;
            }
            page += 1;
            if page > 200 {
                break;
            }
        }
        Ok(())
    })();

    match result {
        Ok(()) => {
            upsert_sync_state(
                db,
                user_id,
                StatePatch {
                    last_success_at: Some(Some(unix_secs_now())),
                    last_error: Some(None),
                    last_seen_game_id: Some(if highest > 0 { Some(highest) } else { None }),
                    ..Default::default()
                },
            )?;
            let dur_ms = start.elapsed().as_millis() as u64;
            emit_sync(
                app,
                SyncEvent::SyncCompleted {
                    user_id,
                    imported,
                    last_seen_game_id: if highest > 0 { Some(highest) } else { None },
                    duration_ms: dur_ms,
                    ts: unix_secs_now(),
                },
            );
            log::info!(
                "sync.done user={user_id} imported={imported} pages={page} duration_ms={dur_ms}"
            );
            Ok(())
        }
        Err(e) => {
            let msg = e.to_string();
            let truncated: String = msg.chars().take(1000).collect();
            let _ = upsert_sync_state(
                db,
                user_id,
                StatePatch {
                    last_error: Some(Some(truncated)),
                    ..Default::default()
                },
            );
            emit_sync(
                app,
                SyncEvent::SyncError {
                    user_id,
                    message: msg.clone(),
                    ts: unix_secs_now(),
                },
            );
            log::warn!("sync.error user={user_id} msg={msg}");
            Err(e)
        }
    }
}

fn bool_to_int(b: Option<bool>) -> Option<i64> {
    b.map(|x| if x { 1 } else { 0 })
}

fn ingest_game(
    db: &Db,
    user_id: i64,
    self_profile_id: i64,
    raw: &RawAoe4WorldGame,
) -> AppResult<bool> {
    let mut conn = db.0.lock().expect("db poisoned");
    let tx = conn.transaction()?;
    let mut is_new = false;

    // Collect (team_idx, player) for all players
    let mut all_players: Vec<(i64, &crate::services::aoe4world::RawPlayerRef)> = Vec::new();
    for (idx, team) in raw.teams.iter().enumerate() {
        for entry in team {
            all_players.push((idx as i64, &entry.player));
        }
    }
    let self_entry = all_players
        .iter()
        .find(|(_, p)| p.profile_id == self_profile_id)
        .copied();
    let Some((self_team, self_p)) = self_entry else {
        tx.commit()?;
        return Ok(false);
    };

    let map_slug = normalize_map_slug(raw.map.as_deref());
    ensure_map(&tx, map_slug.as_deref(), raw.map.as_deref())?;

    let my_civ_slug = normalize_civ_slug(&tx, self_p.civilization.as_deref())?;
    let my_result = normalize_result(self_p.result.as_deref());
    let kind = normalize_kind(raw.kind.as_deref());
    let started_at = iso_to_unix(Some(&raw.started_at));
    let raw_json = serde_json::to_string(raw)?;

    let existing_id: Option<i64> = tx
        .query_row(
            "SELECT id FROM games WHERE user_id = ?1 AND aoe4world_game_id = ?2",
            params![user_id, raw.game_id],
            |r| r.get(0),
        )
        .optional()?;

    let game_id: i64 = if let Some(id) = existing_id {
        tx.execute(
            "UPDATE games SET
                duration_seconds = ?1,
                map_slug = ?2,
                kind = ?3,
                leaderboard = ?4,
                patch = ?5,
                server = ?6,
                my_team = ?7,
                my_civ_slug = ?8,
                my_civ_randomized = ?9,
                my_result = ?10,
                my_rating = ?11,
                my_rating_diff = ?12,
                my_mmr = ?13,
                raw_payload_json = ?14,
                updated_at = unixepoch()
             WHERE id = ?15",
            params![
                raw.duration,
                map_slug,
                kind,
                raw.leaderboard,
                raw.patch,
                raw.server,
                self_team,
                my_civ_slug,
                bool_to_int(self_p.civilization_randomized),
                my_result,
                self_p.rating,
                self_p.rating_diff,
                self_p.mmr,
                raw_json,
                id,
            ],
        )?;
        id
    } else {
        tx.execute(
            "INSERT INTO games (
                user_id, source, aoe4world_game_id, started_at, duration_seconds,
                map_slug, kind, leaderboard, patch, server, my_team,
                my_civ_slug, my_civ_randomized, my_result, my_rating, my_rating_diff, my_mmr,
                raw_payload_json, imported_at, created_at, updated_at
             ) VALUES (?1, 'aoe4world', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, unixepoch(), unixepoch(), unixepoch())",
            params![
                user_id,
                raw.game_id,
                started_at,
                raw.duration,
                map_slug,
                kind,
                raw.leaderboard,
                raw.patch,
                raw.server,
                self_team,
                my_civ_slug,
                bool_to_int(self_p.civilization_randomized),
                my_result,
                self_p.rating,
                self_p.rating_diff,
                self_p.mmr,
                raw_json,
            ],
        )?;
        is_new = true;
        tx.last_insert_rowid()
    };

    tx.execute("DELETE FROM game_participants WHERE game_id = ?1", params![game_id])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO game_participants (
                game_id, team, is_self, profile_id, name, civ_slug, civ_randomized,
                result, rating, rating_diff, mmr
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )?;
        for (team_idx, p) in &all_players {
            let civ_slug = normalize_civ_slug(&tx, p.civilization.as_deref())?;
            stmt.execute(params![
                game_id,
                team_idx,
                if p.profile_id == self_profile_id { 1i64 } else { 0i64 },
                p.profile_id,
                p.name,
                civ_slug,
                bool_to_int(p.civilization_randomized),
                normalize_result(p.result.as_deref()),
                p.rating,
                p.rating_diff,
                p.mmr,
            ])?;
        }
    }

    tx.commit()?;
    Ok(is_new)
}

pub fn link_profile_and_backfill(
    app: &tauri::AppHandle,
    db: &Db,
    user_id: i64,
    profile_id: i64,
) -> AppResult<()> {
    let player = get_player(profile_id)?;
    log::info!("link.player_fetched profile_id={profile_id} name={}", player.name);

    let previous = fetch_profile_id(db, user_id)?;
    if let Some(prev) = previous {
        if prev != profile_id {
            wipe_user_game_data(db, user_id)?;
            log::info!("link.wiped previous_profile={prev} new_profile={profile_id}");
        }
    }

    {
        let conn = db.0.lock().expect("db poisoned");
        conn.execute(
            "UPDATE users SET aoe4world_profile_id = ?1, display_name = ?2, updated_at = unixepoch() WHERE id = ?3",
            params![profile_id, player.name, user_id],
        )?;
    }

    emit_sync(
        app,
        SyncEvent::LinkPlayerFetched {
            user_id,
            profile_id,
            display_name: player.name,
            ts: unix_secs_now(),
        },
    );

    run_sync(app, db, user_id, true)
}

pub fn wipe_user_game_data(db: &Db, user_id: i64) -> AppResult<()> {
    let mut conn = db.0.lock().expect("db poisoned");
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM games WHERE user_id = ?1", params![user_id])?;
    tx.execute("DELETE FROM sync_state WHERE user_id = ?1", params![user_id])?;
    tx.commit()?;
    Ok(())
}
