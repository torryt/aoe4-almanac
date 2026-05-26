pub mod civs;

use crate::error::AppResult;
use rusqlite::Connection;

pub fn ensure_local_user(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "INSERT INTO users (slug, display_name) VALUES ('local', 'Me')
         ON CONFLICT(slug) DO NOTHING",
        [],
    )?;
    Ok(())
}

// Default user agent for outbound HTTP. Mirrors the TS server's default; can
// be overridden at runtime via AOE4_ALMANAC_USER_AGENT (mostly useful for dev).
#[allow(dead_code)]
pub const DEFAULT_USER_AGENT: &str =
    "aoe4-almanac/0.1 (+https://github.com/torryt/aoe4-almanac)";

#[allow(dead_code)]
pub fn user_agent() -> String {
    std::env::var("AOE4_ALMANAC_USER_AGENT").unwrap_or_else(|_| DEFAULT_USER_AGENT.to_string())
}
