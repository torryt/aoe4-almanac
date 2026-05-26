use crate::error::AppResult;
use rusqlite::{params, Connection};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use time::OffsetDateTime;

// Embedded migration files. Order matters - oldest first.
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        0,
        "0000_far_tombstone",
        include_str!("../../migrations/0000_far_tombstone.sql"),
    ),
    (
        1,
        "0001_magical_callisto",
        include_str!("../../migrations/0001_magical_callisto.sql"),
    ),
];

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// Copy an existing DB file (plus -wal / -shm sidecars) to data.db.bak-<ISO-ts>
// before any migration runs. Skipped if the DB doesn't exist yet.
pub fn backup_if_exists(db_path: &Path) -> AppResult<Option<std::path::PathBuf>> {
    if !db_path.exists() {
        return Ok(None);
    }
    let now = OffsetDateTime::now_local()
        .unwrap_or_else(|_| OffsetDateTime::now_utc());
    let stamp = format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    );
    let bak = db_path.with_file_name(format!(
        "{}.bak-{}",
        db_path.file_name().unwrap_or_default().to_string_lossy(),
        stamp
    ));
    std::fs::copy(db_path, &bak)?;
    for ext in ["-wal", "-shm"] {
        let sidecar = db_path.with_file_name(format!(
            "{}{}",
            db_path.file_name().unwrap_or_default().to_string_lossy(),
            ext
        ));
        if sidecar.exists() {
            let bak_sidecar = bak.with_file_name(format!(
                "{}{}",
                bak.file_name().unwrap_or_default().to_string_lossy(),
                ext
            ));
            std::fs::copy(&sidecar, &bak_sidecar)?;
        }
    }
    log::info!("backed up DB to {}", bak.display());
    Ok(Some(bak))
}

pub fn run(conn: &mut Connection, db_path: &Path) -> AppResult<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS __rust_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at INTEGER NOT NULL
        )",
        [],
    )?;

    let drizzle_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if drizzle_count > 0 {
        let drizzle_applied: i64 = conn.query_row(
            "SELECT COUNT(*) FROM __drizzle_migrations",
            [],
            |r| r.get(0),
        )?;
        // Treat the first N drizzle-applied migrations as already-applied here.
        // Drizzle records one row per migration in apply order; we trust the
        // count, not the hash, since drizzle owns its own hashing.
        for (version, name, _sql) in MIGRATIONS.iter().take(drizzle_applied as usize) {
            conn.execute(
                "INSERT OR IGNORE INTO __rust_migrations (version, name, applied_at)
                 VALUES (?1, ?2, ?3)",
                params![*version, *name, now_unix_ms()],
            )?;
        }
    }

    let applied: std::collections::HashSet<i64> = conn
        .prepare("SELECT version FROM __rust_migrations")?
        .query_map([], |r| r.get::<_, i64>(0))?
        .collect::<Result<_, _>>()?;

    let unapplied: Vec<_> = MIGRATIONS
        .iter()
        .filter(|(v, _, _)| !applied.contains(v))
        .collect();

    if unapplied.is_empty() {
        log::info!("migrations: up to date ({} applied)", applied.len());
        return Ok(());
    }

    backup_if_exists(db_path)?;

    for (version, name, sql) in unapplied {
        log::info!("applying migration {} ({})", version, name);
        let tx = conn.transaction()?;
        // Drizzle uses `--> statement-breakpoint` as a separator. rusqlite's
        // execute_batch handles multi-statement SQL fine, but trip on the
        // comment-only "statement" between breakpoints, which is harmless.
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO __rust_migrations (version, name, applied_at)
             VALUES (?1, ?2, ?3)",
            params![*version, *name, now_unix_ms()],
        )?;
        tx.commit()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn temp_db_path() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aoe4-almanac-test-{}-{}",
            std::process::id(),
            now_unix_ms()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("data.db")
    }

    #[test]
    fn runs_migrations_on_fresh_db() {
        let path = temp_db_path();
        let mut conn = db::open(&path).unwrap();
        run(&mut conn, &path).unwrap();

        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN
                 ('users','civilizations','civ_slug_aliases','games','game_participants',
                  'civ_notes','matchup_notes','map_notes','game_notes','maps',
                  'sessions','sync_state','user_preferences','__rust_migrations')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 14, "expected all tables to exist");

        let applied: i64 = conn
            .query_row("SELECT COUNT(*) FROM __rust_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(applied, MIGRATIONS.len() as i64);
    }

    #[test]
    fn second_run_is_noop() {
        let path = temp_db_path();
        let mut conn = db::open(&path).unwrap();
        run(&mut conn, &path).unwrap();
        run(&mut conn, &path).unwrap();
        let applied: i64 = conn
            .query_row("SELECT COUNT(*) FROM __rust_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(applied, MIGRATIONS.len() as i64);
    }

    #[test]
    fn backs_up_existing_db_before_first_migration() {
        let path = temp_db_path();
        // Pretend a DB already exists with one byte of garbage.
        std::fs::write(&path, b"x").unwrap();
        let mut conn = db::open(&path).unwrap();
        run(&mut conn, &path).unwrap();

        let parent = path.parent().unwrap();
        let backups: Vec<_> = std::fs::read_dir(parent)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n.starts_with("data.db.bak-") && !n.ends_with("-wal") && !n.ends_with("-shm")
            })
            .collect();
        assert_eq!(backups.len(), 1, "expected one main backup file (sidecars allowed)");
    }
}
