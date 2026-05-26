use crate::db::{self, Db};
use crate::error::{AppError, AppResult};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize)]
pub struct Me {
    pub id: i64,
    pub slug: String,
    pub display_name: String,
    pub aoe4world_profile_id: Option<i64>,
}

#[tauri::command]
pub fn me_get(state: State<'_, Db>) -> AppResult<Me> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let me = conn.query_row(
        "SELECT id, slug, display_name, aoe4world_profile_id FROM users WHERE id = ?1",
        params![user_id],
        |r| {
            Ok(Me {
                id: r.get(0)?,
                slug: r.get(1)?,
                display_name: r.get(2)?,
                aoe4world_profile_id: r.get(3)?,
            })
        },
    )?;
    Ok(me)
}

#[derive(Serialize)]
pub struct Preferences {
    pub auto_save_notes: bool,
}

#[tauri::command]
pub fn preferences_get(state: State<'_, Db>) -> AppResult<Preferences> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let row: Option<i64> = conn
        .query_row(
            "SELECT auto_save_notes FROM user_preferences WHERE user_id = ?1",
            params![user_id],
            |r| r.get(0),
        )
        .ok();
    Ok(Preferences {
        auto_save_notes: row.map(|v| v != 0).unwrap_or(true),
    })
}

#[derive(Deserialize)]
pub struct PreferencesPatch {
    pub auto_save_notes: Option<bool>,
}

#[tauri::command]
pub fn preferences_set(
    state: State<'_, Db>,
    patch: PreferencesPatch,
) -> AppResult<Preferences> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT auto_save_notes FROM user_preferences WHERE user_id = ?1",
            params![user_id],
            |r| r.get(0),
        )
        .ok();
    let auto_save_notes = patch
        .auto_save_notes
        .or(existing.map(|v| v != 0))
        .unwrap_or(true);
    conn.execute(
        "INSERT INTO user_preferences (user_id, auto_save_notes) VALUES (?1, ?2)
         ON CONFLICT(user_id) DO UPDATE SET
            auto_save_notes = excluded.auto_save_notes,
            updated_at = unixepoch()",
        params![user_id, auto_save_notes as i64],
    )?;
    Ok(Preferences { auto_save_notes })
}

#[derive(Serialize)]
pub struct DataCounts {
    pub current_profile_id: Option<i64>,
    pub games: i64,
    pub game_notes: i64,
    pub sync_state_rows: i64,
}

pub fn count_user_game_data(conn: &rusqlite::Connection, user_id: i64) -> AppResult<(i64, i64, i64)> {
    let games: i64 = conn.query_row(
        "SELECT COUNT(*) FROM games WHERE user_id = ?1",
        params![user_id],
        |r| r.get(0),
    )?;
    let game_notes: i64 = conn.query_row(
        "SELECT COUNT(*) FROM game_notes WHERE user_id = ?1",
        params![user_id],
        |r| r.get(0),
    )?;
    let sync_rows: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sync_state WHERE user_id = ?1",
        params![user_id],
        |r| r.get(0),
    )?;
    Ok((games, game_notes, sync_rows))
}

pub fn wipe_user_game_data(conn: &mut rusqlite::Connection, user_id: i64) -> AppResult<(i64, i64, i64)> {
    let before = count_user_game_data(conn, user_id)?;
    let tx = conn.transaction()?;
    // game_participants + game_notes cascade via FK ON DELETE CASCADE.
    tx.execute("DELETE FROM games WHERE user_id = ?1", params![user_id])?;
    tx.execute("DELETE FROM sync_state WHERE user_id = ?1", params![user_id])?;
    tx.commit()?;
    Ok(before)
}

#[tauri::command]
pub fn data_counts(state: State<'_, Db>) -> AppResult<DataCounts> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let profile_id: Option<i64> = conn
        .query_row(
            "SELECT aoe4world_profile_id FROM users WHERE id = ?1",
            params![user_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    let (games, game_notes, sync_state_rows) = count_user_game_data(&conn, user_id)?;
    Ok(DataCounts {
        current_profile_id: profile_id,
        games,
        game_notes,
        sync_state_rows,
    })
}

#[tauri::command]
pub fn unlink_aoe4world(state: State<'_, Db>) -> AppResult<serde_json::Value> {
    let mut conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let (games, game_notes, sync_state_rows) = wipe_user_game_data(&mut conn, user_id)?;
    conn.execute(
        "UPDATE users SET aoe4world_profile_id = NULL, updated_at = unixepoch() WHERE id = ?1",
        params![user_id],
    )?;
    Ok(serde_json::json!({
        "ok": true,
        "wiped": {
            "games": games,
            "game_notes": game_notes,
            "sync_state_rows": sync_state_rows,
        }
    }))
}

use crate::services::aoe4world;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

struct RatingCacheEntry {
    at: Instant,
    data: serde_json::Value,
}

fn rating_cache() -> &'static Mutex<HashMap<String, RatingCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, RatingCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

const RATING_INFO_TTL_SECS: u64 = 10 * 60;

#[tauri::command]
pub async fn rating_info(
    state: State<'_, Db>,
    leaderboard: Option<String>,
) -> AppResult<serde_json::Value> {
    let leaderboard = leaderboard.unwrap_or_else(|| "rm_solo".to_string());
    let (user_id, profile_id) = {
        let conn = state.0.lock().expect("db poisoned");
        let user_id = db::local_user_id(&conn)?;
        let profile_id: Option<i64> = conn
            .query_row(
                "SELECT aoe4world_profile_id FROM users WHERE id = ?1",
                params![user_id],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        (user_id, profile_id)
    };
    let Some(profile_id) = profile_id else {
        return Err(AppError::msg("not linked"));
    };

    let cache_key = format!("{user_id}:{leaderboard}");
    {
        let cache = rating_cache().lock().expect("rating cache poisoned");
        if let Some(hit) = cache.get(&cache_key) {
            if hit.at.elapsed().as_secs() < RATING_INFO_TTL_SECS {
                return Ok(hit.data.clone());
            }
        }
    }

    let lb_clone = leaderboard.clone();
    let key_clone = cache_key.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let player = aoe4world::get_player(profile_id)?;
        let mode = player
            .modes
            .as_ref()
            .and_then(|m| m.get(&lb_clone))
            .cloned();
        let Some(mode) = mode else {
            let payload = serde_json::json!({
                "leaderboard": lb_clone,
                "country": player.country,
                "unranked": true,
            });
            rating_cache()
                .lock()
                .expect("rating cache poisoned")
                .insert(
                    key_clone,
                    RatingCacheEntry {
                        at: Instant::now(),
                        data: payload.clone(),
                    },
                );
            return Ok(payload);
        };

        let mut rank_total: Option<i64> = None;
        if let Ok(lb) = aoe4world::get_leaderboard_page(&lb_clone, None, Some(1)) {
            rank_total = Some(lb.total_count);
        }

        let mut country_rank: Option<i64> = None;
        let mut country_total: Option<i64> = None;
        let country = player.country.clone();
        if let (Some(c), Some(_)) = (country.as_deref(), mode.rating) {
            let max_pages = 20;
            for page in 1..=max_pages {
                let lb = match aoe4world::get_leaderboard_page(&lb_clone, Some(c), Some(page)) {
                    Ok(v) => v,
                    Err(_) => break,
                };
                if page == 1 {
                    country_total = Some(lb.total_count);
                }
                if let Some(idx) = lb.players.iter().position(|p| p.profile_id == profile_id) {
                    country_rank = Some(lb.offset + idx as i64 + 1);
                    break;
                }
                if (lb.players.len() as i64) < lb.per_page {
                    break;
                }
                if lb.offset + lb.players.len() as i64 >= lb.total_count {
                    break;
                }
            }
        }

        let payload = serde_json::json!({
            "leaderboard": lb_clone,
            "profile_id": profile_id,
            "country": country,
            "rating": mode.rating,
            "max_rating": mode.max_rating,
            "rank": mode.rank,
            "rank_total": rank_total,
            "rank_level": mode.rank_level,
            "country_rank": country_rank,
            "country_total": country_total,
            "streak": mode.streak,
            "games_count": mode.games_count,
            "wins_count": mode.wins_count,
            "losses_count": mode.losses_count,
            "win_rate": mode.win_rate,
            "unranked": false,
        });
        rating_cache()
            .lock()
            .expect("rating cache poisoned")
            .insert(
                key_clone,
                RatingCacheEntry {
                    at: Instant::now(),
                    data: payload.clone(),
                },
            );
        Ok::<_, AppError>(payload)
    })
    .await
    .map_err(|e| AppError::msg(format!("join: {e}")))?
}
