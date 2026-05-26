use crate::db::Db;
use crate::error::{AppError, AppResult};
use rusqlite::params;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct Civ {
    pub slug: String,
    pub name: String,
    pub parent_slug: Option<String>,
    pub is_variant: bool,
    pub flag_image_url: Option<String>,
}

#[derive(Serialize)]
pub struct CivList {
    pub civs: Vec<Civ>,
}

#[tauri::command]
pub fn civs_list(state: State<'_, Db>) -> AppResult<CivList> {
    let conn = state.0.lock().expect("db poisoned");
    let mut stmt = conn.prepare(
        "SELECT slug, name, parent_slug, is_variant, flag_image_url
         FROM civilizations ORDER BY name COLLATE NOCASE",
    )?;
    let civs: Vec<Civ> = stmt
        .query_map([], |r| {
            Ok(Civ {
                slug: r.get(0)?,
                name: r.get(1)?,
                parent_slug: r.get(2)?,
                is_variant: r.get::<_, i64>(3)? != 0,
                flag_image_url: r.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(CivList { civs })
}

#[derive(Serialize)]
pub struct CivDetail {
    pub slug: String,
    pub name: String,
    pub parent_slug: Option<String>,
    pub is_variant: bool,
    pub flag_image_url: Option<String>,
    pub data: Option<serde_json::Value>,
}

#[tauri::command]
pub fn civs_get(state: State<'_, Db>, slug: String) -> AppResult<CivDetail> {
    let conn = state.0.lock().expect("db poisoned");
    let row = conn
        .query_row(
            "SELECT slug, name, parent_slug, is_variant, flag_image_url, data_json
             FROM civilizations WHERE slug = ?1",
            params![slug],
            |r| {
                let data_json: Option<String> = r.get(5)?;
                Ok(CivDetail {
                    slug: r.get(0)?,
                    name: r.get(1)?,
                    parent_slug: r.get(2)?,
                    is_variant: r.get::<_, i64>(3)? != 0,
                    flag_image_url: r.get(4)?,
                    data: data_json
                        .as_deref()
                        .map(serde_json::from_str)
                        .transpose()
                        .unwrap_or(None),
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::msg("civ not found"),
            other => AppError::from(other),
        })?;
    Ok(row)
}
