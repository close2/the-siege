use rusqlite::{params, Connection, TransactionBehavior};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};

pub type Db = Arc<Mutex<Connection>>;

const PRAGMAS: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
"#;

const TABLES: &str = r#"
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  id TEXT,
  label TEXT,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS transfer_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  creator TEXT NOT NULL REFERENCES users(id),
  config_json TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  seed TEXT NOT NULL,
  sim_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  hero_class TEXT NOT NULL,
  join_order INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  seen_day INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  day INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (challenge_id, day, user_id, kind)
);
CREATE TABLE IF NOT EXISTS push_subs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, endpoint)
);
CREATE TABLE IF NOT EXISTS sent_notifications (
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (challenge_id, user_id, day, kind)
);
"#;

const INDEXES: &str = r#"
CREATE INDEX IF NOT EXISTS users_by_created_at ON users (created_at);
CREATE INDEX IF NOT EXISTS tokens_by_user ON tokens (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS tokens_by_user_id ON tokens (user_id, id);
CREATE INDEX IF NOT EXISTS transfer_codes_by_user ON transfer_codes (user_id);
CREATE INDEX IF NOT EXISTS transfer_codes_by_expires ON transfer_codes (expires_at);
CREATE INDEX IF NOT EXISTS challenges_by_creator ON challenges (creator);
CREATE INDEX IF NOT EXISTS members_by_user ON members (user_id);
CREATE INDEX IF NOT EXISTS events_by_challenge ON events (challenge_id, seq);
CREATE INDEX IF NOT EXISTS push_subs_by_user_created ON push_subs (user_id, created_at);
"#;

pub fn open(path: &str) -> anyhow::Result<Db> {
    let mut conn = Connection::open(path)?;
    init(&mut conn)?;
    Ok(Arc::new(Mutex::new(conn)))
}

pub(crate) fn init(conn: &mut Connection) -> anyhow::Result<()> {
    conn.execute_batch(PRAGMAS)?;
    conn.execute_batch(TABLES)?;
    migrate_legacy_tables(conn)?;
    conn.execute_batch(INDEXES)?;
    Ok(())
}

fn migrate_legacy_tables(conn: &mut Connection) -> anyhow::Result<()> {
    // Migrate pre-0.5 `push_subs` (PRIMARY KEY (endpoint), no `created_at`) -> PRIMARY KEY (user_id, endpoint)
    let mut user_id_pk: i64 = 0;
    let mut endpoint_pk: i64 = 0;
    let mut has_created_at = false;
    {
        let mut stmt = conn.prepare("PRAGMA table_info(push_subs)")?;
        let cols = stmt.query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, i64>(5)?)))?;
        for col in cols {
            let (name, pk) = col?;
            if name == "user_id" {
                user_id_pk = pk;
            } else if name == "endpoint" {
                endpoint_pk = pk;
            } else if name == "created_at" {
                has_created_at = true;
            }
        }
    }
    if user_id_pk != 1 || endpoint_pk != 2 || !has_created_at {
        let tx = conn.transaction()?;
        tx.execute_batch(
            r#"
            DROP TABLE IF EXISTS push_subs_new;
            CREATE TABLE push_subs_new (
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              endpoint TEXT NOT NULL,
              p256dh TEXT NOT NULL,
              auth TEXT NOT NULL,
              created_at INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (user_id, endpoint)
            );
            INSERT OR REPLACE INTO push_subs_new (user_id, endpoint, p256dh, auth, created_at)
              SELECT user_id, endpoint, p256dh, auth, 0
              FROM push_subs
              WHERE user_id IN (SELECT id FROM users);
            DROP TABLE push_subs;
            ALTER TABLE push_subs_new RENAME TO push_subs;
            "#,
        )?;
        tx.commit()?;
    }

    // Migrate pre-0.5 `transfer_codes` (`code` plaintext PK) -> `code_hash` SHA-256 PK
    let has_code_hash = {
        let mut stmt = conn.prepare("PRAGMA table_info(transfer_codes)")?;
        let mut cols = stmt.query_map([], |r| r.get::<_, String>(1))?;
        cols.any(|c| c.as_deref() == Ok("code_hash"))
    };
    if !has_code_hash {
        let tx = conn.transaction()?;
        let legacy_rows: Vec<(String, String, i64)> = {
            let mut stmt = tx.prepare("SELECT code, user_id, expires_at FROM transfer_codes WHERE user_id IN (SELECT id FROM users)")?;
            let mapped = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            mapped.collect::<Result<_, _>>()?
        };
        tx.execute_batch(
            r#"
            DROP TABLE IF EXISTS transfer_codes_new;
            CREATE TABLE transfer_codes_new (
              code_hash TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              expires_at INTEGER NOT NULL
            );
            "#,
        )?;
        for (code, user_id, expires_at) in legacy_rows {
            let normalized = code.trim().to_uppercase();
            let code_hash = hex::encode(Sha256::digest(normalized.as_bytes()));
            tx.execute(
                "INSERT OR REPLACE INTO transfer_codes_new (code_hash, user_id, expires_at) VALUES (?1, ?2, ?3)",
                params![code_hash, user_id, expires_at],
            )?;
        }
        tx.execute_batch(
            r#"
            DROP TABLE transfer_codes;
            ALTER TABLE transfer_codes_new RENAME TO transfer_codes;
            "#,
        )?;
        tx.commit()?;
    }

    // Migrate pre-0.6 `tokens` (add `id`, `label`, `last_used_at` and backfill `id`)
    {
        let mut has_id = false;
        let mut has_label = false;
        let mut has_last_used_at = false;
        {
            let mut stmt = conn.prepare("PRAGMA table_info(tokens)")?;
            let cols = stmt.query_map([], |r| r.get::<_, String>(1))?;
            for col in cols {
                match col?.as_str() {
                    "id" => has_id = true,
                    "label" => has_label = true,
                    "last_used_at" => has_last_used_at = true,
                    _ => {}
                }
            }
        }
        if !has_id || !has_label || !has_last_used_at {
            let tx = conn.transaction()?;
            if !has_id {
                tx.execute("ALTER TABLE tokens ADD COLUMN id TEXT", [])?;
            }
            if !has_label {
                tx.execute("ALTER TABLE tokens ADD COLUMN label TEXT", [])?;
            }
            if !has_last_used_at {
                tx.execute("ALTER TABLE tokens ADD COLUMN last_used_at INTEGER", [])?;
            }
            tx.execute("UPDATE tokens SET id = substr(token_hash, 1, 16) WHERE id IS NULL", [])?;
            tx.commit()?;
        } else {
            conn.execute("UPDATE tokens SET id = substr(token_hash, 1, 16) WHERE id IS NULL", [])?;
        }
    }

    // Migrate pre-0.6 `members` (add `seen_day`)
    let has_seen_day = {
        let mut stmt = conn.prepare("PRAGMA table_info(members)")?;
        let mut cols = stmt.query_map([], |r| r.get::<_, String>(1))?;
        cols.any(|c| c.as_deref() == Ok("seen_day"))
    };
    if !has_seen_day {
        conn.execute("ALTER TABLE members ADD COLUMN seen_day INTEGER NOT NULL DEFAULT 0", [])?;
    }

    Ok(())
}

/// Purge expired transfer codes and up to `batch_limit` users older than `max_age_ms`
/// who neither created nor joined any challenge. Uses RAII `TransactionBehavior::Immediate`
/// so failed commits or panics cleanly roll back without wedging the shared `Connection`.
pub fn purge_orphan_users(conn: &mut Connection, now_ms: i64, max_age_ms: i64, batch_limit: usize) -> rusqlite::Result<usize> {
    if max_age_ms <= 0 || batch_limit == 0 {
        return Ok(0);
    }
    let cutoff = now_ms.saturating_sub(max_age_ms);
    let limit = i64::try_from(batch_limit.min(10_000)).unwrap_or(500);
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute("DELETE FROM transfer_codes WHERE expires_at < ?1", params![now_ms])?;
    let ids: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT u.id FROM users u
             WHERE u.created_at < ?1
               AND NOT EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id)
               AND NOT EXISTS (SELECT 1 FROM challenges c WHERE c.creator = u.id)
             ORDER BY u.created_at ASC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![cutoff, limit], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    if ids.is_empty() {
        tx.commit()?;
        return Ok(0);
    }
    let mut deleted = 0usize;
    {
        let mut del_tokens = tx.prepare("DELETE FROM tokens WHERE user_id = ?1")?;
        let mut del_codes = tx.prepare("DELETE FROM transfer_codes WHERE user_id = ?1")?;
        let mut del_subs = tx.prepare("DELETE FROM push_subs WHERE user_id = ?1")?;
        let mut del_user = tx.prepare(
            "DELETE FROM users WHERE id = ?1
               AND NOT EXISTS (SELECT 1 FROM members m WHERE m.user_id = ?1)
               AND NOT EXISTS (SELECT 1 FROM challenges c WHERE c.creator = ?1)",
        )?;
        for uid in &ids {
            del_tokens.execute(params![uid])?;
            del_codes.execute(params![uid])?;
            del_subs.execute(params![uid])?;
            deleted += del_user.execute(params![uid])?;
        }
    }
    tx.commit()?;
    Ok(deleted)
}
