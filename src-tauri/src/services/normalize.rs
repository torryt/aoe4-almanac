use crate::error::AppResult;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

// Cached on first access; the seed never changes them at runtime so we just
// load lazily and keep them in memory. Cleared via clear() when civs are reseeded.
static ALIASES: RwLock<Option<HashMap<String, String>>> = RwLock::new(None);
static KNOWN: RwLock<Option<HashSet<String>>> = RwLock::new(None);

pub fn clear_caches() {
    *ALIASES.write().unwrap() = None;
    *KNOWN.write().unwrap() = None;
}

fn load_aliases(conn: &Connection) -> AppResult<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT alias, civ_slug FROM civ_slug_aliases")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<HashMap<_, _>, _>>()?;
    Ok(rows)
}

fn load_known(conn: &Connection) -> AppResult<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT slug FROM civilizations")?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(rows)
}

pub fn normalize_civ_slug(conn: &Connection, raw: Option<&str>) -> AppResult<String> {
    let Some(raw) = raw.filter(|s| !s.is_empty()) else {
        return Ok("unknown".to_string());
    };
    let lower: String = raw
        .to_lowercase()
        .trim()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("_");

    {
        let known = KNOWN.read().unwrap();
        if let Some(set) = known.as_ref() {
            if set.contains(&lower) {
                return Ok(lower);
            }
        }
    }

    // Cache miss — load known set.
    if KNOWN.read().unwrap().is_none() {
        *KNOWN.write().unwrap() = Some(load_known(conn)?);
    }
    if KNOWN.read().unwrap().as_ref().is_some_and(|s| s.contains(&lower)) {
        return Ok(lower);
    }

    if ALIASES.read().unwrap().is_none() {
        *ALIASES.write().unwrap() = Some(load_aliases(conn)?);
    }
    if let Some(map) = ALIASES.read().unwrap().as_ref() {
        if let Some(canon) = map.get(&lower).or_else(|| map.get(raw)) {
            return Ok(canon.clone());
        }
    }

    Ok(lower)
}

pub fn normalize_map_slug(raw: Option<&str>) -> Option<String> {
    let raw = raw.filter(|s| !s.is_empty())?;
    let lower = raw.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut prev_under = false;
    for c in lower.chars() {
        if c.is_alphanumeric() || c == '_' {
            out.push(c);
            prev_under = c == '_';
        } else if !prev_under {
            out.push('_');
            prev_under = true;
        }
    }
    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() { None } else { Some(trimmed) }
}

pub fn normalize_result(raw: Option<&str>) -> &'static str {
    match raw {
        Some("win") => "win",
        Some("loss") => "loss",
        Some("draw") => "draw",
        _ => "unknown",
    }
}

pub fn normalize_kind(raw: Option<&str>) -> String {
    match raw {
        Some(s) if !s.is_empty() => s.trim().to_lowercase(),
        _ => "unknown".to_string(),
    }
}

pub fn iso_to_unix(iso: Option<&str>) -> i64 {
    use time::format_description::well_known::Iso8601;
    use time::OffsetDateTime;
    match iso {
        Some(s) => OffsetDateTime::parse(s, &Iso8601::DEFAULT)
            .map(|t| t.unix_timestamp())
            .unwrap_or_else(|_| crate::events::unix_secs_now()),
        None => crate::events::unix_secs_now(),
    }
}

pub fn ensure_map(conn: &Connection, slug: Option<&str>, name: Option<&str>) -> AppResult<()> {
    let Some(slug) = slug else { return Ok(()) };
    conn.execute(
        "INSERT INTO maps (slug, name) VALUES (?1, ?2) ON CONFLICT(slug) DO NOTHING",
        rusqlite::params![slug, name.unwrap_or(slug)],
    )?;
    Ok(())
}
