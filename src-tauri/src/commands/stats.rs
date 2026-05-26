use crate::db::{self, Db};
use crate::error::AppResult;
use rusqlite::{params, params_from_iter, ToSql};
use serde::{Deserialize, Serialize};
use tauri::State;

fn win_rate(games: i64, wins: i64) -> Option<f64> {
    if games > 0 {
        Some(wins as f64 / games as f64)
    } else {
        None
    }
}

#[derive(Serialize)]
pub struct ByCivRow {
    pub opp_civ_slug: String,
    pub games: i64,
    pub wins: i64,
    pub losses: i64,
    pub draws: i64,
    pub win_rate: Option<f64>,
}

#[derive(Serialize)]
pub struct ByCivResp {
    pub my_civ: String,
    pub rows: Vec<ByCivRow>,
}

#[derive(Deserialize)]
pub struct StatsByCivQuery {
    pub my_civ: String,
    pub kind: Option<String>,
    pub exclude_randomized: Option<bool>,
}

#[tauri::command]
pub fn stats_by_civ(
    state: State<'_, Db>,
    query: StatsByCivQuery,
) -> AppResult<ByCivResp> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let kind_clause = if query.kind.is_some() { "AND g.kind = ?" } else { "" };
    let rand_clause = if query.exclude_randomized.unwrap_or(false) {
        "AND (g.my_civ_randomized IS NULL OR g.my_civ_randomized = 0)"
    } else {
        ""
    };
    let sql = format!(
        "SELECT
           p.civ_slug,
           COUNT(*) AS games,
           SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END) AS losses,
           SUM(CASE WHEN g.my_result = 'draw' THEN 1 ELSE 0 END) AS draws
         FROM games g
         JOIN game_participants p ON p.game_id = g.id AND p.is_self = 0
         WHERE g.user_id = ? AND g.my_civ_slug = ? {} {}
         GROUP BY p.civ_slug
         ORDER BY games DESC",
        kind_clause, rand_clause
    );
    let mut params: Vec<Box<dyn ToSql>> = vec![Box::new(user_id), Box::new(query.my_civ.clone())];
    if let Some(k) = &query.kind {
        params.push(Box::new(k.clone()));
    }
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<ByCivRow> = stmt
        .query_map(params_from_iter(params.iter().map(|b| b.as_ref())), |r| {
            let games: i64 = r.get(1)?;
            let wins: i64 = r.get(2)?;
            Ok(ByCivRow {
                opp_civ_slug: r.get(0)?,
                games,
                wins,
                losses: r.get(3)?,
                draws: r.get(4)?,
                win_rate: win_rate(games, wins),
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(ByCivResp { my_civ: query.my_civ, rows })
}

#[derive(Serialize)]
pub struct MatchupRow {
    pub my_civ_slug: String,
    pub opp_civ_slug: String,
    pub games: i64,
    pub wins: i64,
    pub losses: i64,
    pub draws: i64,
    pub win_rate: Option<f64>,
}

#[tauri::command]
pub fn stats_matchups(state: State<'_, Db>) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let mut stmt = conn.prepare(
        "SELECT
           g.my_civ_slug, p.civ_slug,
           COUNT(*) AS games,
           SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END),
           SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END),
           SUM(CASE WHEN g.my_result = 'draw' THEN 1 ELSE 0 END)
         FROM games g
         JOIN game_participants p ON p.game_id = g.id AND p.is_self = 0
         WHERE g.user_id = ?1
         GROUP BY g.my_civ_slug, p.civ_slug",
    )?;
    let rows: Vec<MatchupRow> = stmt
        .query_map(params![user_id], |r| {
            let games: i64 = r.get(2)?;
            let wins: i64 = r.get(3)?;
            Ok(MatchupRow {
                my_civ_slug: r.get(0)?,
                opp_civ_slug: r.get(1)?,
                games,
                wins,
                losses: r.get(4)?,
                draws: r.get(5)?,
                win_rate: win_rate(games, wins),
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(serde_json::json!({ "rows": rows }))
}

#[derive(Serialize)]
pub struct ByMapRow {
    pub map_slug: String,
    pub games: i64,
    pub wins: i64,
    pub losses: i64,
    pub win_rate: Option<f64>,
}

#[tauri::command]
pub fn stats_by_map(state: State<'_, Db>) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let mut stmt = conn.prepare(
        "SELECT map_slug, COUNT(*) AS games,
           SUM(CASE WHEN my_result = 'win' THEN 1 ELSE 0 END),
           SUM(CASE WHEN my_result = 'loss' THEN 1 ELSE 0 END)
         FROM games
         WHERE user_id = ?1 AND map_slug IS NOT NULL
         GROUP BY map_slug
         ORDER BY games DESC",
    )?;
    let rows: Vec<ByMapRow> = stmt
        .query_map(params![user_id], |r| {
            let games: i64 = r.get(1)?;
            let wins: i64 = r.get(2)?;
            Ok(ByMapRow {
                map_slug: r.get(0)?,
                games,
                wins,
                losses: r.get(3)?,
                win_rate: win_rate(games, wins),
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(serde_json::json!({ "rows": rows }))
}

#[derive(Deserialize)]
pub struct RatingHistoryQuery {
    pub leaderboard: Option<String>,
    pub limit: Option<i64>,
}

#[tauri::command]
pub fn stats_rating_history(
    state: State<'_, Db>,
    query: Option<RatingHistoryQuery>,
) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let q = query.unwrap_or(RatingHistoryQuery { leaderboard: None, limit: None });
    let leaderboard = q.leaderboard.unwrap_or_else(|| "rm_solo".to_string());
    let limit = q.limit.unwrap_or(60).clamp(2, 20000);

    let mut stmt = conn.prepare(
        "SELECT started_at, my_rating
         FROM games
         WHERE user_id = ?1 AND leaderboard = ?2 AND my_rating IS NOT NULL
         ORDER BY started_at DESC LIMIT ?3",
    )?;
    let mut points: Vec<serde_json::Value> = stmt
        .query_map(params![user_id, leaderboard, limit], |r| {
            Ok(serde_json::json!({ "at": r.get::<_, i64>(0)?, "rating": r.get::<_, i64>(1)? }))
        })?
        .collect::<Result<_, _>>()?;
    points.reverse();
    Ok(serde_json::json!({ "leaderboard": leaderboard, "points": points }))
}

#[tauri::command]
pub fn stats_recent(state: State<'_, Db>) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;

    // Recent 10 games - return full row via SELECT *.
    let mut stmt = conn.prepare("SELECT * FROM games WHERE user_id = ?1 ORDER BY started_at DESC LIMIT 10")?;
    let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let recent: Vec<serde_json::Value> = stmt
        .query_map(params![user_id], |row| {
            let mut obj = serde_json::Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let v: rusqlite::types::Value = row.get(i)?;
                obj.insert(name.clone(), value_to_json(v));
            }
            Ok(serde_json::Value::Object(obj))
        })?
        .collect::<Result<_, _>>()?;

    let cutoff = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64)
        - 30 * 24 * 60 * 60;

    let (games_30d, wins_30d, losses_30d): (i64, i64, i64) = conn
        .query_row(
            "SELECT COUNT(*),
                SUM(CASE WHEN my_result = 'win' THEN 1 ELSE 0 END),
                SUM(CASE WHEN my_result = 'loss' THEN 1 ELSE 0 END)
             FROM games WHERE user_id = ?1 AND started_at >= ?2",
            params![user_id, cutoff],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                ))
            },
        )
        .unwrap_or((0, 0, 0));

    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM games WHERE user_id = ?1",
            params![user_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let top_civ: Option<String> = conn
        .query_row(
            "SELECT my_civ_slug FROM (
                SELECT my_civ_slug FROM games
                WHERE user_id = ?1 AND my_civ_slug IS NOT NULL
                ORDER BY started_at DESC LIMIT 30
             ) GROUP BY my_civ_slug ORDER BY COUNT(*) DESC LIMIT 1",
            params![user_id],
            |r| r.get(0),
        )
        .ok();

    Ok(serde_json::json!({
        "recent": recent,
        "total_games": total,
        "last_30d": {
            "games": games_30d,
            "wins": wins_30d,
            "losses": losses_30d,
            "win_rate": win_rate(games_30d, wins_30d),
        },
        "top_civ_slug": top_civ,
    }))
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
