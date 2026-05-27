mod commands;
mod db;
mod error;
mod events;
mod seed;
mod services;

use tauri::Manager;

use db::Db;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
fn db_path_get(state: tauri::State<'_, AppPath>) -> String {
    state.db_path.to_string_lossy().to_string()
}

pub struct AppPath {
    pub db_path: std::path::PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info,aoe4_almanac_lib=debug"),
    )
    .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let db_path = db::resolve_db_path()?;
            log::info!("opening db at {}", db_path.display());
            let mut conn = db::open(&db_path)?;
            db::migrations::run(&mut conn, &db_path)?;
            seed::ensure_local_user(&conn)?;
            if let Err(e) = seed::civs::seed(&conn) {
                log::warn!("civs seed failed (continuing): {e}");
            }
            app.manage(Db::new(conn));
            app.manage(AppPath { db_path });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            db_path_get,
            // civs
            commands::civs_list,
            commands::civs_get,
            // me
            commands::me_get,
            commands::preferences_get,
            commands::preferences_set,
            commands::data_counts,
            commands::unlink_aoe4world,
            commands::rating_info,
            // games
            commands::games_list,
            commands::games_get,
            // notes
            commands::civ_notes_list,
            commands::civ_note_get,
            commands::civ_note_put,
            commands::matchup_notes_list,
            commands::matchup_note_get,
            commands::matchup_note_put,
            commands::map_notes_list,
            commands::map_note_get,
            commands::map_note_put,
            commands::game_notes_batch,
            commands::game_note_get,
            commands::game_note_put,
            commands::notes_export_all,
            // opponents
            commands::opponents_list,
            commands::opponents_get,
            // stats
            commands::stats_by_civ,
            commands::stats_matchups,
            commands::stats_by_map,
            commands::stats_rating_history,
            commands::stats_recent,
            // sync (stubs)
            commands::sync_status,
            commands::sync_run,
            commands::link_aoe4world,
            // aoe4world (stubs)
            commands::aoe4world_search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
