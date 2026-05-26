pub mod migrations;

use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct Db(pub Arc<Mutex<Connection>>);

impl Db {
    pub fn new(conn: Connection) -> Self {
        Db(Arc::new(Mutex::new(conn)))
    }
    pub fn clone_handle(&self) -> Db {
        Db(self.0.clone())
    }
}

pub fn resolve_db_path() -> AppResult<PathBuf> {
    if let Ok(s) = std::env::var("AOE4_ALMANAC_DB_PATH") {
        let expanded = if let Some(rest) = s.strip_prefix("~/") {
            dirs::home_dir()
                .ok_or_else(|| AppError::msg("no home directory"))?
                .join(rest)
        } else {
            PathBuf::from(s)
        };
        if let Some(parent) = expanded.parent() {
            std::fs::create_dir_all(parent)?;
        }
        return Ok(expanded);
    }
    let home = dirs::home_dir().ok_or_else(|| AppError::msg("no home directory"))?;
    let dir = home.join(".aoe4-almanac");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("data.db"))
}

pub fn local_user_id(conn: &Connection) -> AppResult<i64> {
    let id: i64 = conn.query_row(
        "SELECT id FROM users WHERE slug = 'local'",
        [],
        |r| r.get(0),
    )?;
    Ok(id)
}

pub fn open(path: &std::path::Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    Ok(conn)
}
