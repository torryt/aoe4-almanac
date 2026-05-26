use crate::db::{self, Db};
use crate::error::AppResult;
use crate::services::sync as sync_svc;
use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Serialize)]
pub struct SyncStateRow {
    pub leaderboard: String,
    pub last_seen_game_id: Option<i64>,
    pub last_polled_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
}

#[tauri::command]
pub fn sync_status(state: State<'_, Db>) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let mut stmt = conn.prepare(
        "SELECT leaderboard, last_seen_game_id, last_polled_at, last_success_at, last_error
         FROM sync_state WHERE user_id = ?1 ORDER BY leaderboard",
    )?;
    let rows: Vec<SyncStateRow> = stmt
        .query_map(params![user_id], |r| {
            Ok(SyncStateRow {
                leaderboard: r.get(0)?,
                last_seen_game_id: r.get(1)?,
                last_polled_at: r.get(2)?,
                last_success_at: r.get(3)?,
                last_error: r.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    drop(stmt);
    drop(conn);
    let in_flight = sync_svc::is_sync_running(user_id);
    Ok(serde_json::json!({ "rows": rows, "in_flight": in_flight }))
}

#[tauri::command]
pub async fn sync_run(
    app: AppHandle,
    state: State<'_, Db>,
    full: Option<bool>,
) -> AppResult<()> {
    let db = state.inner().clone_handle();
    let full = full.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let user_id = {
            let conn = db.0.lock().expect("db poisoned");
            db::local_user_id(&conn)?
        };
        sync_svc::run_sync(&app, &db, user_id, full)
    })
    .await
    .map_err(|e| crate::error::AppError::msg(format!("join: {e}")))?
}

#[tauri::command]
pub async fn link_aoe4world(
    app: AppHandle,
    state: State<'_, Db>,
    profile_id: i64,
) -> AppResult<()> {
    let db = state.inner().clone_handle();
    tauri::async_runtime::spawn_blocking(move || {
        let user_id = {
            let conn = db.0.lock().expect("db poisoned");
            db::local_user_id(&conn)?
        };
        sync_svc::link_profile_and_backfill(&app, &db, user_id, profile_id)
    })
    .await
    .map_err(|e| crate::error::AppError::msg(format!("join: {e}")))?
}
