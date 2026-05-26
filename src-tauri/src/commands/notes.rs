use crate::db::{self, Db};
use crate::error::{AppError, AppResult};
use rusqlite::{params, params_from_iter, ToSql};
use serde::Serialize;
use tauri::State;

fn excerpt(body: &str) -> String {
    let collapsed: String = body
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    collapsed.chars().take(140).collect()
}

#[derive(Serialize)]
pub struct NoteBody {
    pub body_md: String,
    pub updated_at: Option<i64>,
}

// --- civ notes ---

#[tauri::command]
pub fn civ_notes_list(state: State<'_, Db>) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let mut stmt = conn.prepare(
        "SELECT civ_slug, body_md, updated_at FROM civ_notes
         WHERE user_id = ?1 ORDER BY updated_at DESC",
    )?;
    let notes: Vec<serde_json::Value> = stmt
        .query_map(params![user_id], |r| {
            let body: String = r.get(1)?;
            Ok(serde_json::json!({
                "civ_slug": r.get::<_, String>(0)?,
                "updated_at": r.get::<_, i64>(2)?,
                "excerpt": excerpt(&body),
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(serde_json::json!({ "notes": notes }))
}

#[tauri::command]
pub fn civ_note_get(state: State<'_, Db>, slug: String) -> AppResult<NoteBody> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let row: Option<(String, i64)> = conn
        .query_row(
            "SELECT body_md, updated_at FROM civ_notes WHERE user_id = ?1 AND civ_slug = ?2",
            params![user_id, slug],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    Ok(match row {
        Some((b, u)) => NoteBody { body_md: b, updated_at: Some(u) },
        None => NoteBody { body_md: String::new(), updated_at: None },
    })
}

#[tauri::command]
pub fn civ_note_put(state: State<'_, Db>, slug: String, body_md: String) -> AppResult<()> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    conn.execute(
        "INSERT INTO civ_notes (user_id, civ_slug, body_md) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, civ_slug) DO UPDATE SET
            body_md = excluded.body_md, updated_at = unixepoch()",
        params![user_id, slug, body_md],
    )?;
    Ok(())
}

// --- matchup notes ---

#[tauri::command]
pub fn matchup_notes_list(
    state: State<'_, Db>,
    my_civ: Option<String>,
) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    // trim with explicit charset so tabs/CRs/LFs count as empty (SQLite's
    // single-arg trim only strips ASCII spaces).
    let non_empty = "trim(body_md, ' ' || x'09' || x'0a' || x'0d') != ''";
    let (sql, mut params_vec): (String, Vec<Box<dyn ToSql>>) = match my_civ.as_ref() {
        Some(c) => (
            format!(
                "SELECT my_civ_slug, opp_civ_slug, body_md, updated_at FROM matchup_notes
                 WHERE user_id = ?1 AND my_civ_slug = ?2 AND {}
                 ORDER BY updated_at DESC",
                non_empty
            ),
            vec![Box::new(user_id), Box::new(c.clone())],
        ),
        None => (
            format!(
                "SELECT my_civ_slug, opp_civ_slug, body_md, updated_at FROM matchup_notes
                 WHERE user_id = ?1 AND {}
                 ORDER BY updated_at DESC",
                non_empty
            ),
            vec![Box::new(user_id)],
        ),
    };
    let _ = &mut params_vec;
    let mut stmt = conn.prepare(&sql)?;
    let notes: Vec<serde_json::Value> = stmt
        .query_map(params_from_iter(params_vec.iter().map(|b| b.as_ref())), |r| {
            let body: String = r.get(2)?;
            Ok(serde_json::json!({
                "my_civ_slug": r.get::<_, String>(0)?,
                "opp_civ_slug": r.get::<_, String>(1)?,
                "updated_at": r.get::<_, i64>(3)?,
                "excerpt": excerpt(&body),
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(serde_json::json!({ "notes": notes }))
}

#[tauri::command]
pub fn matchup_note_get(
    state: State<'_, Db>,
    my_civ: String,
    opp_civ: String,
) -> AppResult<NoteBody> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let row: Option<(String, i64)> = conn
        .query_row(
            "SELECT body_md, updated_at FROM matchup_notes
             WHERE user_id = ?1 AND my_civ_slug = ?2 AND opp_civ_slug = ?3",
            params![user_id, my_civ, opp_civ],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    Ok(match row {
        Some((b, u)) => NoteBody { body_md: b, updated_at: Some(u) },
        None => NoteBody { body_md: String::new(), updated_at: None },
    })
}

#[tauri::command]
pub fn matchup_note_put(
    state: State<'_, Db>,
    my_civ: String,
    opp_civ: String,
    body_md: String,
) -> AppResult<()> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    conn.execute(
        "INSERT INTO matchup_notes (user_id, my_civ_slug, opp_civ_slug, body_md)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(user_id, my_civ_slug, opp_civ_slug) DO UPDATE SET
            body_md = excluded.body_md, updated_at = unixepoch()",
        params![user_id, my_civ, opp_civ, body_md],
    )?;
    Ok(())
}

// --- map notes ---

#[tauri::command]
pub fn map_notes_list(state: State<'_, Db>) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let mut stmt = conn.prepare(
        "SELECT map_slug, body_md, updated_at FROM map_notes
         WHERE user_id = ?1 ORDER BY updated_at DESC",
    )?;
    let notes: Vec<serde_json::Value> = stmt
        .query_map(params![user_id], |r| {
            let body: String = r.get(1)?;
            Ok(serde_json::json!({
                "map_slug": r.get::<_, String>(0)?,
                "updated_at": r.get::<_, i64>(2)?,
                "excerpt": excerpt(&body),
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(serde_json::json!({ "notes": notes }))
}

#[tauri::command]
pub fn map_note_get(state: State<'_, Db>, slug: String) -> AppResult<NoteBody> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let row: Option<(String, i64)> = conn
        .query_row(
            "SELECT body_md, updated_at FROM map_notes WHERE user_id = ?1 AND map_slug = ?2",
            params![user_id, slug],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    Ok(match row {
        Some((b, u)) => NoteBody { body_md: b, updated_at: Some(u) },
        None => NoteBody { body_md: String::new(), updated_at: None },
    })
}

#[tauri::command]
pub fn map_note_put(state: State<'_, Db>, slug: String, body_md: String) -> AppResult<()> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    conn.execute(
        "INSERT INTO map_notes (user_id, map_slug, body_md) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, map_slug) DO UPDATE SET
            body_md = excluded.body_md, updated_at = unixepoch()",
        params![user_id, slug, body_md],
    )?;
    Ok(())
}

// --- game notes ---

#[tauri::command]
pub fn game_notes_batch(
    state: State<'_, Db>,
    ids: Vec<i64>,
) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let ids: Vec<i64> = ids.into_iter().filter(|n| *n > 0).collect();
    if ids.is_empty() {
        return Ok(serde_json::json!({ "notes": [] }));
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT game_id, body_md, updated_at FROM game_notes
         WHERE user_id = ? AND game_id IN ({})",
        placeholders
    );
    let mut params_vec: Vec<Box<dyn ToSql>> = vec![Box::new(user_id)];
    for id in &ids {
        params_vec.push(Box::new(*id));
    }
    let mut stmt = conn.prepare(&sql)?;
    let notes: Vec<serde_json::Value> = stmt
        .query_map(params_from_iter(params_vec.iter().map(|b| b.as_ref())), |r| {
            let body: String = r.get(1)?;
            Ok(serde_json::json!({
                "game_id": r.get::<_, i64>(0)?,
                "body_md": body.clone(),
                "excerpt": excerpt(&body),
                "updated_at": r.get::<_, i64>(2)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(serde_json::json!({ "notes": notes }))
}

#[tauri::command]
pub fn game_note_get(state: State<'_, Db>, game_id: i64) -> AppResult<NoteBody> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let row: Option<(String, i64)> = conn
        .query_row(
            "SELECT body_md, updated_at FROM game_notes WHERE user_id = ?1 AND game_id = ?2",
            params![user_id, game_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    Ok(match row {
        Some((b, u)) => NoteBody { body_md: b, updated_at: Some(u) },
        None => NoteBody { body_md: String::new(), updated_at: None },
    })
}

#[tauri::command]
pub fn game_note_put(state: State<'_, Db>, game_id: i64, body_md: String) -> AppResult<()> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    // Ownership check matches the TS route.
    let owned: Option<i64> = conn
        .query_row(
            "SELECT id FROM games WHERE id = ?1 AND user_id = ?2",
            params![game_id, user_id],
            |r| r.get(0),
        )
        .ok();
    if owned.is_none() {
        return Err(AppError::msg("game not found"));
    }
    conn.execute(
        "INSERT INTO game_notes (user_id, game_id, body_md) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, game_id) DO UPDATE SET
            body_md = excluded.body_md, updated_at = unixepoch()",
        params![user_id, game_id, body_md],
    )?;
    Ok(())
}
