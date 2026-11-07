//! Every minute: evening reminders for missing check-ins and "Dawn is ready" notifications.
use crate::{api::now_ms, calendar, push::SendResult, AppState};
use chrono::NaiveTime;
use rusqlite::params;
use serde_json::{json, Value};

const REMIND_AT: (u32, u32) = (20, 0);
/// Dawn notifications are only sent if the scheduler notices within this window
const DAWN_GRACE_MS: i64 = 6 * 3600 * 1000;

pub(crate) struct Job {
    pub challenge_id: String,
    pub user_id: String,
    pub day: u32,
    pub kind: &'static str,
    pub payload: Value,
}

pub async fn run(state: AppState) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        tick.tick().await;
        if state.push.is_none() {
            continue;
        }
        let jobs = match collect_at(&state, now_ms()) {
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
                    json!({ "title": format!("☀ Dawn {} — {}", w.day, title), "body": "The battle has been fought. See how your sector held!", "url": format!("/c/{cid}") })
                } else {
                    json!({ "title": format!("{} — your sector needs you", title), "body": format!("Report day {} before Dawn to earn gold and send your hero.", w.day), "url": format!("/c/{cid}") })
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
                let _ = state.db.lock().unwrap().execute("DELETE FROM push_subs WHERE endpoint = ?1", params![endpoint]);
            }
            SendResult::Failed(e) => tracing::warn!("push failed: {e}"),
        }
    }
}
