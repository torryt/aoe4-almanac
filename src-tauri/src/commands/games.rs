use crate::db::{self, Db};
use crate::error::{AppError, AppResult};
use rusqlite::{params, params_from_iter, ToSql};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Deserialize, Default)]
pub struct GamesQuery {
    pub civ: Option<String>,
    pub map: Option<String>,
    pub result: Option<String>,
    pub kind: Option<String>,
    pub leaderboard: Option<String>,
    pub since: Option<i64>,
    pub cursor: Option<i64>,
    pub opp_civ: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct Participant {
    pub id: i64,
    pub game_id: i64,
    pub team: i64,
    pub is_self: bool,
    pub profile_id: Option<i64>,
    pub name: String,
    pub civ_slug: String,
    pub civ_randomized: Option<i64>,
    pub result: String,
    pub rating: Option<i64>,
    pub rating_diff: Option<i64>,
    pub mmr: Option<i64>,
}

fn fetch_participants(
    conn: &rusqlite::Connection,
    game_ids: &[i64],
) -> AppResult<HashMap<i64, Vec<Participant>>> {
    if game_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = game_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, game_id, team, is_self, profile_id, name, civ_slug,
                civ_randomized, result, rating, rating_diff, mmr
         FROM game_participants WHERE game_id IN ({})",
        placeholders
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn ToSql> = game_ids.iter().map(|id| id as &dyn ToSql).collect();
    let parts: Vec<Participant> = stmt
        .query_map(params_from_iter(params), |r| {
            Ok(Participant {
                id: r.get(0)?,
                game_id: r.get(1)?,
                team: r.get(2)?,
                is_self: r.get::<_, i64>(3)? != 0,
                profile_id: r.get(4)?,
                name: r.get(5)?,
                civ_slug: r.get(6)?,
                civ_randomized: r.get(7)?,
                result: r.get(8)?,
                rating: r.get(9)?,
                rating_diff: r.get(10)?,
                mmr: r.get(11)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let mut by_game: HashMap<i64, Vec<Participant>> = HashMap::new();
    for p in parts {
        by_game.entry(p.game_id).or_default().push(p);
    }
    Ok(by_game)
}

fn game_to_json(row: &rusqlite::Row, col_names: &[String]) -> rusqlite::Result<serde_json::Value> {
    let mut obj = serde_json::Map::new();
    for (i, name) in col_names.iter().enumerate() {
        let v: rusqlite::types::Value = row.get(i)?;
        obj.insert(name.clone(), value_to_json(v));
    }
    Ok(serde_json::Value::Object(obj))
}

fn value_to_json(v: rusqlite::types::Value) -> serde_json::Value {
    use rusqlite::types::Value;
    match v {
        Value::Null => serde_json::Value::Null,
        Value::Integer(i) => serde_json::Value::from(i),
        Value::Real(f) => serde_json::Value::from(f),
        Value::Text(s) => serde_json::Value::String(s),
        Value::Blob(b) => serde_json::Value::String(format!("<blob:{}>", b.len())),
    }
}

#[tauri::command]
pub fn games_list(
    state: State<'_, Db>,
    query: Option<GamesQuery>,
) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let q = query.unwrap_or_default();
    let limit = q.limit.unwrap_or(50).clamp(1, 500);

    let mut where_parts = vec!["user_id = ?".to_string()];
    let mut params_vec: Vec<Box<dyn ToSql>> = vec![Box::new(user_id)];

    if let Some(v) = &q.civ {
        where_parts.push("my_civ_slug = ?".into());
        params_vec.push(Box::new(v.clone()));
    }
    if let Some(v) = &q.map {
        where_parts.push("map_slug = ?".into());
        params_vec.push(Box::new(v.clone()));
    }
    if let Some(v) = &q.result {
        where_parts.push("my_result = ?".into());
        params_vec.push(Box::new(v.clone()));
    }
    if let Some(v) = &q.kind {
        where_parts.push("kind = ?".into());
        params_vec.push(Box::new(v.clone()));
    }
    if let Some(v) = &q.leaderboard {
        where_parts.push("leaderboard = ?".into());
        params_vec.push(Box::new(v.clone()));
    }
    if let Some(v) = q.since {
        where_parts.push("started_at >= ?".into());
        params_vec.push(Box::new(v));
    }
    if let Some(v) = q.cursor {
        where_parts.push("id < ?".into());
        params_vec.push(Box::new(v));
    }

    if let Some(opp) = &q.opp_civ {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT g.id FROM games g
             JOIN game_participants p ON p.game_id = g.id
             WHERE g.user_id = ?1 AND p.is_self = 0 AND p.civ_slug = ?2",
        )?;
        let ids: Vec<i64> = stmt
            .query_map(params![user_id, opp], |r| r.get::<_, i64>(0))?
            .collect::<Result<_, _>>()?;
        drop(stmt);
        if ids.is_empty() {
            return Ok(serde_json::json!({ "games": [], "next_cursor": null }));
        }
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        where_parts.push(format!("id IN ({})", placeholders));
        for id in &ids {
            params_vec.push(Box::new(*id));
        }
    }

    params_vec.push(Box::new(limit));
    let sql = format!(
        "SELECT * FROM games WHERE {}
         ORDER BY started_at DESC, id DESC LIMIT ?",
        where_parts.join(" AND ")
    );

    let mut stmt = conn.prepare(&sql)?;
    let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows: Vec<serde_json::Value> = stmt
        .query_map(params_from_iter(params_vec.iter().map(|b| b.as_ref())), |r| {
            game_to_json(r, &col_names)
        })?
        .collect::<Result<_, _>>()?;

    let ids: Vec<i64> = rows.iter().filter_map(|r| r.get("id").and_then(|v| v.as_i64())).collect();
    let by_game = fetch_participants(&conn, &ids)?;

    let games: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|mut r| {
            if let Some(id) = r.get("id").and_then(|v| v.as_i64()) {
                let parts = by_game.get(&id).cloned().unwrap_or_default();
                if let Some(obj) = r.as_object_mut() {
                    obj.insert("participants".into(), serde_json::to_value(parts).unwrap());
                }
            }
            r
        })
        .collect();

    let next_cursor = if games.len() as i64 == limit {
        games.last().and_then(|g| g.get("id").and_then(|v| v.as_i64()))
    } else {
        None
    };

    Ok(serde_json::json!({ "games": games, "next_cursor": next_cursor }))
}

#[tauri::command]
pub fn games_get(state: State<'_, Db>, id: i64) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;

    let mut stmt = conn.prepare("SELECT * FROM games WHERE id = ?1 AND user_id = ?2")?;
    let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut row = stmt
        .query_row(params![id, user_id], |r| game_to_json(r, &col_names))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::msg("not found"),
            other => AppError::from(other),
        })?;

    let by_game = fetch_participants(&conn, &[id])?;
    if let Some(obj) = row.as_object_mut() {
        // Expose decoded raw_payload alongside the raw JSON string.
        let parsed: Option<serde_json::Value> = obj
            .get("raw_payload_json")
            .and_then(|v| v.as_str())
            .and_then(|s| serde_json::from_str(s).ok());
        obj.insert("raw_payload".into(), parsed.unwrap_or(serde_json::Value::Null));
        obj.insert(
            "participants".into(),
            serde_json::to_value(by_game.get(&id).cloned().unwrap_or_default()).unwrap(),
        );
    }
    Ok(row)
}
