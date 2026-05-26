use crate::error::{AppError, AppResult};
use crate::services::aoe4world;
use serde::Serialize;

#[derive(Serialize)]
pub struct SearchPlayer {
    pub profile_id: i64,
    pub name: String,
    pub country: Option<String>,
    pub avatar_url: Option<String>,
    pub last_game_at: Option<String>,
}

#[tauri::command]
pub async fn aoe4world_search(query: String) -> AppResult<serde_json::Value> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(serde_json::json!({ "players": [] }));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let res = aoe4world::search_players(&q)?;
        let players: Vec<SearchPlayer> = res
            .players
            .into_iter()
            .take(20)
            .map(|p| SearchPlayer {
                profile_id: p.profile_id,
                name: p.name,
                country: p.country,
                avatar_url: p.avatars.and_then(|a| a.small),
                last_game_at: p.last_game_at,
            })
            .collect();
        Ok::<_, crate::error::AppError>(serde_json::json!({ "players": players }))
    })
    .await
    .map_err(|e| AppError::msg(format!("join: {e}")))?
}
