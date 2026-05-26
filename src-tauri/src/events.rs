use serde::Serialize;
use tauri::Emitter;

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum SyncEvent {
    #[serde(rename = "link.player_fetched")]
    LinkPlayerFetched {
        user_id: i64,
        profile_id: i64,
        display_name: String,
        ts: i64,
    },
    #[serde(rename = "sync.started")]
    SyncStarted {
        user_id: i64,
        profile_id: i64,
        full: bool,
        ts: i64,
    },
    #[serde(rename = "sync.page")]
    SyncPage {
        user_id: i64,
        page: u32,
        games_in_page: usize,
        imported_so_far: usize,
        scanned_so_far: usize,
        total_count: Option<i64>,
        full: bool,
        ts: i64,
    },
    #[serde(rename = "sync.completed")]
    SyncCompleted {
        user_id: i64,
        imported: usize,
        last_seen_game_id: Option<i64>,
        duration_ms: u64,
        ts: i64,
    },
    #[serde(rename = "sync.error")]
    SyncError {
        user_id: i64,
        message: String,
        ts: i64,
    },
}

pub fn emit_sync(app: &tauri::AppHandle, event: SyncEvent) {
    if let Err(e) = app.emit("sync", event) {
        log::warn!("emit sync event failed: {e}");
    }
}

pub fn unix_secs_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
