use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const CIVS_INDEX_URL: &str =
    "https://raw.githubusercontent.com/aoe4world/data/main/civilizations/civs-index.json";

// Mirror of packages/shared/src/civSlugs.ts VARIANT_PARENTS. Kept in sync by
// hand; the TS file is the source of truth, but it's small enough that a
// duplicate here beats pulling in a JS runtime.
fn variant_parents() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("ayyubids", "abbasid_dynasty"),
        ("golden_horde", "mongols"),
        ("jeanne_darc", "french"),
        ("jin_dynasty", "chinese"),
        ("house_of_lancaster", "english"),
        ("macedonian_dynasty", "byzantines"),
        ("order_of_the_dragon", "holy_roman_empire"),
        ("sengoku_daimyo", "japanese"),
        ("knights_templar", "french"),
        ("tughlaq_dynasty", "delhi_sultanate"),
        ("zhu_xis_legacy", "chinese"),
    ])
}

#[derive(Deserialize, Serialize, Debug)]
struct RawCiv {
    id: Option<String>,
    slug: Option<String>,
    name: Option<String>,
    abbr: Option<String>,
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

fn pick_str(s: &Option<String>) -> Option<&str> {
    s.as_deref().filter(|v| !v.is_empty())
}

fn fetch_civs() -> AppResult<Vec<RawCiv>> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("aoe4-almanac-seed/0.1")
        .build()?;
    let res = client.get(CIVS_INDEX_URL).send()?.error_for_status()?;
    let json: serde_json::Value = res.json()?;
    match json {
        serde_json::Value::Array(arr) => Ok(arr
            .into_iter()
            .map(serde_json::from_value)
            .collect::<Result<Vec<_>, _>>()?),
        serde_json::Value::Object(map) => Ok(map
            .into_values()
            .map(serde_json::from_value)
            .collect::<Result<Vec<_>, _>>()?),
        _ => Err(AppError::msg("civs-index.json: unrecognized shape")),
    }
}

// Returns the number of civs upserted. Skips network fetch (and returns 0)
// when the table already has rows.
pub fn seed(conn: &Connection) -> AppResult<usize> {
    let existing: i64 =
        conn.query_row("SELECT COUNT(*) FROM civilizations", [], |r| r.get(0))?;
    if existing > 0 {
        log::info!("civs already seeded ({} rows); skipping fetch", existing);
        return Ok(0);
    }

    log::info!("fetching civs index from {}", CIVS_INDEX_URL);
    let raw = fetch_civs()?;
    log::info!("fetched {} civ entries", raw.len());

    let parents = variant_parents();
    let mut inserted = 0;

    for c in &raw {
        let slug = pick_str(&c.id).or_else(|| pick_str(&c.slug));
        let name = pick_str(&c.name).or(slug);
        let (Some(slug), Some(name)) = (slug, name) else {
            log::warn!("skipping civ without id/name: {:?}", c);
            continue;
        };
        let parent = parents.get(slug).copied();
        let is_variant = parent.is_some();
        let data_json = serde_json::to_string(c)?;

        conn.execute(
            "INSERT INTO civilizations (slug, name, parent_slug, is_variant, flag_image_url, data_json)
             VALUES (?1, ?2, ?3, ?4, NULL, ?5)
             ON CONFLICT(slug) DO UPDATE SET
                name = excluded.name,
                parent_slug = excluded.parent_slug,
                is_variant = excluded.is_variant,
                flag_image_url = excluded.flag_image_url,
                data_json = excluded.data_json,
                updated_at = unixepoch()",
            params![slug, name, parent, is_variant as i64, data_json],
        )?;
        inserted += 1;

        let mut aliases: Vec<&str> = Vec::new();
        if let Some(short) = pick_str(&c.slug) {
            if short != slug {
                aliases.push(short);
            }
        }
        if let Some(abbr) = pick_str(&c.abbr) {
            if abbr != slug && !aliases.contains(&abbr) {
                aliases.push(abbr);
            }
        }
        for alias in aliases {
            conn.execute(
                "INSERT INTO civ_slug_aliases (alias, civ_slug) VALUES (?1, ?2)
                 ON CONFLICT(alias) DO UPDATE SET civ_slug = excluded.civ_slug",
                params![alias, slug],
            )?;
        }
    }

    log::info!("upserted {} civs", inserted);
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::migrations;

    // Hits the network. Run with: `cargo test seeds_civs -- --ignored`.
    #[test]
    #[ignore]
    fn seeds_civs_from_network() {
        let dir = std::env::temp_dir().join(format!(
            "aoe4-almanac-seedtest-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("data.db");
        let mut conn = db::open(&path).unwrap();
        migrations::run(&mut conn, &path).unwrap();
        crate::seed::ensure_local_user(&conn).unwrap();
        let inserted = seed(&conn).unwrap();
        assert!(inserted > 20, "expected at least 20 civs, got {}", inserted);

        let aliases: i64 = conn
            .query_row("SELECT COUNT(*) FROM civ_slug_aliases", [], |r| r.get(0))
            .unwrap();
        assert!(aliases > 0, "expected at least some aliases");

        let variants: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM civilizations WHERE is_variant = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(variants >= 10, "expected at least 10 variants, got {}", variants);
    }
}
