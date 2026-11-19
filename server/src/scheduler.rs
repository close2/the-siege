//! Every minute: prune in-memory rate limits, periodically purge 14-day challenge-less
//! orphan users, and send evening reminders + "Dawn is ready" Web Push notifications.
use crate::{api::now_ms, calendar, db, push::SendResult, AppState};
use chrono::NaiveTime;
use rusqlite::params;
use serde_json::{json, Value};

const REMIND_AT: (u32, u32) = (20, 0);
/// Dawn notifications are only sent if the scheduler notices within this window
const DAWN_GRACE_MS: i64 = 6 * 3600 * 1000;
const DEFAULT_PURGE_USER_DAYS: i64 = 14;
const PURGE_INTERVAL_MS: i64 = 3600 * 1000;
const PURGE_BATCH_SIZE: usize = 500;
const PURGE_MAX_BATCHES_PER_PASS: usize = 5;

pub(crate) struct Job {
    pub challenge_id: String,
    pub user_id: String,
    pub day: u32,
    pub kind: &'static str,
    pub payload: Value,
}

fn configured_purge_age_ms() -> i64 {
    let days = std::env::var("PURGE_USER_DAYS").ok().and_then(|v| v.trim().parse::<i64>().ok()).unwrap_or(DEFAULT_PURGE_USER_DAYS);
    if days <= 0 {
        0
    } else {
        days.saturating_mul(24 * 3600 * 1000)
    }
}

pub(crate) fn run_purge_pass(state: &AppState, now: i64, max_age_ms: i64) -> usize {
    if max_age_ms <= 0 {
        let _ = state.db.lock().unwrap().execute("DELETE FROM transfer_codes WHERE expires_at < ?1", params![now]);
        return 0;
    }
    let mut total_deleted = 0usize;
    for _ in 0..PURGE_MAX_BATCHES_PER_PASS {
        let batch = {
            let mut db = state.db.lock().unwrap();
            db::purge_orphan_users(&mut db, now, max_age_ms, PURGE_BATCH_SIZE)
        };
        match batch {
            Ok(n) => {
                total_deleted += n;
                if n < PURGE_BATCH_SIZE {
                    break;
                }
            }
            Err(e) => {
                tracing::error!("orphan user purge failed: {e}");
                break;
            }
        }
    }
    if total_deleted > 0 {
        tracing::info!(deleted = total_deleted, "purged stale challenge-less users");
    }
    total_deleted
}

pub async fn run(state: AppState) {
    let purge_age_ms = configured_purge_age_ms();
    let mut last_purge_ms: Option<i64> = None;
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        tick.tick().await;
        let now = now_ms();
        state.limiter.prune(now);
        if last_purge_ms.map(|last| now.saturating_sub(last) >= PURGE_INTERVAL_MS).unwrap_or(true) {
            run_purge_pass(&state, now, purge_age_ms);
            last_purge_ms = Some(now);
        }
        if state.push.is_none() {
            continue;
        }
        let jobs = match collect_at(&state, now) {
            Ok(j) => j,
            Err(e) => {
                tracing::error!("scheduler: {e}");
                continue;
            }
        };
        for job in jobs {
            send_to_user(&state, &job).await;
        }
    }
}

pub(crate) fn collect_at(state: &AppState, now: i64) -> anyhow::Result<Vec<Job>> {
    let db = state.db.lock().unwrap();
    let mut jobs = Vec::new();
    let mut stmt = db.prepare("SELECT id, config_json FROM challenges")?;
    let challenges: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    for (cid, cfg) in challenges {
        let cfg: Value = serde_json::from_str(&cfg).unwrap_or(Value::Null);
        let Ok(cal) = calendar::parse_config(&cfg) else { continue };
        let title = cfg["title"].as_str().unwrap_or("The Siege").to_string();
        let windows = calendar::day_windows(&cal);
        if windows.last().map(|w| now > w.dawn + DAWN_GRACE_MS).unwrap_or(true) {
            continue;
        }
        let members: Vec<String> =
            db.prepare("SELECT user_id FROM members WHERE challenge_id = ?1")?.query_map(params![cid], |r| r.get(0))?.collect::<Result<_, _>>()?;
        let remind_time = NaiveTime::from_hms_opt(REMIND_AT.0, REMIND_AT.1, 0).unwrap();
        for w in &windows {
            let remind_at = calendar::zoned_to_utc(w.date, remind_time, cal.tz);
            let remind_due = now >= remind_at && now < w.dawn;
            let dawn_due = now >= w.dawn && now < w.dawn + DAWN_GRACE_MS;
            if !remind_due && !dawn_due {
                continue;
            }
            for uid in &members {
                let kind = if dawn_due { "dawn" } else { "remind" };
                let sent = db
                    .query_row(
                        "SELECT 1 FROM sent_notifications WHERE challenge_id = ?1 AND user_id = ?2 AND day = ?3 AND kind = ?4",
                        params![cid, uid, w.day, kind],
                        |_| Ok(()),
                    )
                    .is_ok();
                if sent {
                    continue;
                }
                if kind == "remind" {
                    let has: bool = db
                        .query_row(
                            "SELECT 1 FROM events WHERE challenge_id = ?1 AND user_id = ?2 AND day = ?3 AND kind = 'checkin'",
                            params![cid, uid, w.day],
                            |_| Ok(()),
                        )
                        .is_ok();
                    if has {
                        continue;
                    }
                }
                db.execute(
                    "INSERT OR IGNORE INTO sent_notifications (challenge_id, user_id, day, kind) VALUES (?1, ?2, ?3, ?4)",
                    params![cid, uid, w.day, kind],
                )?;
                let payload = if kind == "dawn" {
                    json!({
                        "kind": "dawn",
                        "day": w.day,
                        "challengeTitle": title,
                        "title": format!("☀ Dawn {} — {}", w.day, title),
                        "body": "The battle has been fought. See how your sector held!",
                        "url": format!("/c/{cid}")
                    })
                } else {
                    json!({
                        "kind": "remind",
                        "day": w.day,
                        "challengeTitle": title,
                        "title": format!("{} — your sector needs you", title),
                        "body": format!("Report day {} before Dawn to earn gold and send your hero.", w.day),
                        "url": format!("/c/{cid}")
                    })
                };
                jobs.push(Job { challenge_id: cid.clone(), user_id: uid.clone(), day: w.day, kind, payload });
            }
        }
    }
    Ok(jobs)
}

async fn send_to_user(state: &AppState, job: &Job) {
    let subs: Vec<(String, String, String)> = {
        let db = state.db.lock().unwrap();
        let mut stmt = match db.prepare("SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?1") {
            Ok(s) => s,
            Err(_) => return,
        };
        stmt.query_map(params![job.user_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map(|rows| rows.filter_map(Result::ok).collect()).unwrap_or_default()
    };
    let push = state.push.as_ref().unwrap();
    for (endpoint, p256dh, auth) in subs {
        match push.send(&endpoint, &p256dh, &auth, &job.payload).await {
            SendResult::Ok => tracing::debug!("push {} day {} → {}", job.kind, job.day, job.challenge_id),
            SendResult::Gone => {
                let _ = state.db.lock().unwrap().execute("DELETE FROM push_subs WHERE user_id = ?1 AND endpoint = ?2", params![job.user_id, endpoint]);
            }
            SendResult::Failed(e) => tracing::warn!("push failed: {e}"),
        }
    }
}
