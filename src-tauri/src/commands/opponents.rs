use crate::db::{self, Db};
use crate::error::{AppError, AppResult};
use rusqlite::{params_from_iter, ToSql};
use serde::{Deserialize, Serialize};
use tauri::State;

fn win_rate(games: i64, wins: i64) -> Option<f64> {
    if games > 0 { Some(wins as f64 / games as f64) } else { None }
}

#[derive(Deserialize)]
pub struct OpponentsQuery {
    pub search: Option<String>,
    pub sort: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Serialize)]
pub struct OpponentRow {
    pub key: String,
    pub profile_id: Option<i64>,
    pub name: String,
    pub games: i64,
    pub wins: i64,
    pub losses: i64,
    pub draws: i64,
    pub last_played_at: i64,
    pub win_rate: Option<f64>,
}

#[tauri::command]
pub fn opponents_list(
    state: State<'_, Db>,
    query: Option<OpponentsQuery>,
) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let q = query.unwrap_or(OpponentsQuery {
        search: None,
        sort: None,
        limit: None,
    });
    let sort = q.sort.unwrap_or_else(|| "matches".into());
    let order_by = match sort.as_str() {
        "name" => "name COLLATE NOCASE ASC",
        "recent" => "last_played_at DESC",
        _ => "games DESC, last_played_at DESC",
    };
    let limit = q.limit.unwrap_or(200).clamp(1, 500);

    let search = q.search.and_then(|s| {
        let t = s.trim();
        if t.is_empty() { None } else { Some(t.to_string()) }
    });

    let mut params_vec: Vec<Box<dyn ToSql>> = vec![Box::new(user_id)];
    let search_clause = if let Some(s) = &search {
        params_vec.push(Box::new(format!("%{}%", s)));
        "AND p.name LIKE ? COLLATE NOCASE"
    } else {
        ""
    };
    params_vec.push(Box::new(limit));

    let sql = format!(
        "SELECT
           COALESCE(CAST(p.profile_id AS TEXT), 'n:' || p.name) AS key,
           p.profile_id,
           MAX(p.name) AS name,
           COUNT(*) AS games,
           SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END),
           SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END),
           SUM(CASE WHEN g.my_result = 'draw' THEN 1 ELSE 0 END),
           MAX(g.started_at) AS last_played_at
         FROM games g
         JOIN game_participants p ON p.game_id = g.id AND p.is_self = 0
         WHERE g.user_id = ? {}
         GROUP BY key
         ORDER BY {}
         LIMIT ?",
        search_clause, order_by
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<OpponentRow> = stmt
        .query_map(params_from_iter(params_vec.iter().map(|b| b.as_ref())), |r| {
            let games: i64 = r.get(3)?;
            let wins: i64 = r.get(4)?;
            Ok(OpponentRow {
                key: r.get(0)?,
                profile_id: r.get(1)?,
                name: r.get(2)?,
                games,
                wins,
                losses: r.get(5)?,
                draws: r.get(6)?,
                last_played_at: r.get(7)?,
                win_rate: win_rate(games, wins),
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(serde_json::json!({ "opponents": rows }))
}

fn parse_key(raw: &str) -> (Option<i64>, Option<String>) {
    if let Some(name) = raw.strip_prefix("n:") {
        return (None, Some(name.to_string()));
    }
    if let Ok(n) = raw.parse::<i64>() {
        if n > 0 {
            return (Some(n), None);
        }
    }
    (None, None)
}

#[tauri::command]
pub fn opponents_get(state: State<'_, Db>, key: String) -> AppResult<serde_json::Value> {
    let conn = state.0.lock().expect("db poisoned");
    let user_id = db::local_user_id(&conn)?;
    let (profile_id, name) = parse_key(&key);
    if profile_id.is_none() && name.is_none() {
        return Err(AppError::msg("bad key"));
    }

    let match_clause = if profile_id.is_some() {
        "p.is_self = 0 AND p.profile_id = ?"
    } else {
        "p.is_self = 0 AND p.profile_id IS NULL AND p.name = ?"
    };
    let match_value: Box<dyn ToSql> = match (&profile_id, &name) {
        (Some(p), _) => Box::new(*p),
        (_, Some(n)) => Box::new(n.clone()),
        _ => unreachable!(),
    };

    let summary_sql = format!(
        "SELECT p.profile_id, MAX(p.name), COUNT(*),
           SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END),
           SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END),
           SUM(CASE WHEN g.my_result = 'draw' THEN 1 ELSE 0 END),
           MIN(g.started_at), MAX(g.started_at)
         FROM games g
         JOIN game_participants p ON p.game_id = g.id
         WHERE g.user_id = ? AND {}",
        match_clause
    );
    let (sum_profile_id, sum_name, games, wins, losses, draws, first_at, last_at): (
        Option<i64>, Option<String>, i64, i64, i64, i64, Option<i64>, Option<i64>,
    ) = conn.query_row(
        &summary_sql,
        params_from_iter([&user_id as &dyn ToSql, match_value.as_ref()]),
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
    )?;
    if games == 0 {
        return Err(AppError::msg("not found"));
    }

    let by_opp_civ = aggregate_civ(&conn, user_id, match_clause, match_value.as_ref(), "p.civ_slug")?;
    let by_my_civ = aggregate_civ(&conn, user_id, match_clause, match_value.as_ref(), "g.my_civ_slug")?;
    let by_map = aggregate_map(&conn, user_id, match_clause, match_value.as_ref())?;
    let games_list = list_games(&conn, user_id, match_clause, match_value.as_ref())?;

    Ok(serde_json::json!({
        "opponent": {
            "profile_id": sum_profile_id,
            "name": sum_name,
            "games": games,
            "wins": wins,
            "losses": losses,
            "draws": draws,
            "first_played_at": first_at,
            "last_played_at": last_at,
            "win_rate": win_rate(games, wins),
        },
        "by_opp_civ": by_opp_civ,
        "by_my_civ": by_my_civ,
        "by_map": by_map,
        "games": games_list,
    }))
}

fn aggregate_civ(
    conn: &rusqlite::Connection,
    user_id: i64,
    match_clause: &str,
    match_value: &dyn ToSql,
    civ_col: &str,
) -> AppResult<Vec<serde_json::Value>> {
    let sql = format!(
        "SELECT {} AS civ_slug, COUNT(*) AS games,
           SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END),
           SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END)
         FROM games g
         JOIN game_participants p ON p.game_id = g.id
         WHERE g.user_id = ? AND {}
         GROUP BY {}
         ORDER BY games DESC",
        civ_col, match_clause, civ_col
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<serde_json::Value> = stmt
        .query_map(params_from_iter([&user_id as &dyn ToSql, match_value]), |r| {
            let games: i64 = r.get(1)?;
            let wins: i64 = r.get(2)?;
            Ok(serde_json::json!({
                "civ_slug": r.get::<_, String>(0)?,
                "games": games,
                "wins": wins,
                "losses": r.get::<_, i64>(3)?,
                "win_rate": win_rate(games, wins),
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

fn aggregate_map(
    conn: &rusqlite::Connection,
    user_id: i64,
    match_clause: &str,
    match_value: &dyn ToSql,
) -> AppResult<Vec<serde_json::Value>> {
    let sql = format!(
        "SELECT g.map_slug, COUNT(*) AS games,
           SUM(CASE WHEN g.my_result = 'win' THEN 1 ELSE 0 END),
           SUM(CASE WHEN g.my_result = 'loss' THEN 1 ELSE 0 END)
         FROM games g
         JOIN game_participants p ON p.game_id = g.id
         WHERE g.user_id = ? AND {} AND g.map_slug IS NOT NULL
         GROUP BY g.map_slug
         ORDER BY games DESC",
        match_clause
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<serde_json::Value> = stmt
        .query_map(params_from_iter([&user_id as &dyn ToSql, match_value]), |r| {
            let games: i64 = r.get(1)?;
            let wins: i64 = r.get(2)?;
            Ok(serde_json::json!({
                "map_slug": r.get::<_, String>(0)?,
                "games": games,
                "wins": wins,
                "losses": r.get::<_, i64>(3)?,
                "win_rate": win_rate(games, wins),
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

fn list_games(
    conn: &rusqlite::Connection,
    user_id: i64,
    match_clause: &str,
    match_value: &dyn ToSql,
) -> AppResult<Vec<serde_json::Value>> {
    let sql = format!(
        "SELECT g.id, g.started_at, g.duration_seconds, g.map_slug, g.kind,
           g.my_civ_slug, g.my_result, g.my_rating, g.my_rating_diff,
           p.civ_slug AS opp_civ_slug, p.rating AS opp_rating
         FROM games g
         JOIN game_participants p ON p.game_id = g.id
         WHERE g.user_id = ? AND {}
         ORDER BY g.started_at DESC, g.id DESC",
        match_clause
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<serde_json::Value> = stmt
        .query_map(params_from_iter([&user_id as &dyn ToSql, match_value]), |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, i64>(0)?,
                "started_at": r.get::<_, i64>(1)?,
                "duration_seconds": r.get::<_, Option<i64>>(2)?,
                "map_slug": r.get::<_, Option<String>>(3)?,
                "kind": r.get::<_, String>(4)?,
                "my_civ_slug": r.get::<_, String>(5)?,
                "my_result": r.get::<_, String>(6)?,
                "my_rating": r.get::<_, Option<i64>>(7)?,
                "my_rating_diff": r.get::<_, Option<i64>>(8)?,
                "opp_civ_slug": r.get::<_, String>(9)?,
                "opp_rating": r.get::<_, Option<i64>>(10)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}
