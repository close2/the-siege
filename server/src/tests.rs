use crate::{app, calendar, db, push::Push, AppState};
use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use rusqlite::params;
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

fn test_app() -> (Router, AppState) {
    let db = db::open(":memory:").unwrap();
    let tmp_pem = format!("/tmp/siege_test_vapid_{}.pem", rand::random::<u64>());
    let push = Push::load_or_create(&tmp_pem, "mailto:test@example.com".into()).ok().map(Arc::new);
    let _ = std::fs::remove_file(&tmp_pem);
    let state = AppState { db, push };
    (app(state.clone(), None), state)
}

async fn req(app: &Router, method: &str, uri: &str, token: Option<&str>, body: Option<Value>) -> (StatusCode, Value) {
    let mut b = Request::builder().method(method).uri(uri).header("content-type", "application/json");
    if let Some(t) = token {
        b = b.header("authorization", format!("Bearer {t}"));
    }
    let body = match body {
        Some(v) => Body::from(v.to_string()),
        None => Body::empty(),
    };
    let res = app.clone().oneshot(b.body(body).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let val = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
    (status, val)
}

fn valid_config(start_date: &str) -> Value {
    json!({
        "title": "No Sugar Siege",
        "type": "binary",
        "rules": ["No added sugar today"],
        "days": 30,
        "startDate": start_date,
        "timeZone": "UTC",
        "dawnTime": "06:00",
        "difficulty": "normal",
        "theme": "sugar",
        "inactiveDates": []
    })
}

#[tokio::test]
async fn users_auth_and_transfer() {
    let (app, _) = test_app();

    // Health check -> 200
    let (st, h) = req(&app, "GET", "/api/health", None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(h["ok"], true);

    // Unauthenticated /api/me -> 401
    let (st, _) = req(&app, "GET", "/api/me", None, None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);

    // Invalid token -> 401
    let (st, _) = req(&app, "GET", "/api/me", Some("bogus"), None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);

    // Bad name -> 400
    let (st, _) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "A" }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    // Create user
    let (st, u1) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Anna" }))).await;
    assert_eq!(st, StatusCode::OK);
    let tok1 = u1["token"].as_str().unwrap();
    let uid1 = u1["userId"].as_str().unwrap();

    // /api/me
    let (st, me) = req(&app, "GET", "/api/me", Some(tok1), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(me["id"], uid1);
    assert_eq!(me["name"], "Anna");

    // Rename
    let (st, _) = req(&app, "PUT", "/api/me", Some(tok1), Some(json!({ "name": "Lady Anna" }))).await;
    assert_eq!(st, StatusCode::NO_CONTENT);
    let (_, me) = req(&app, "GET", "/api/me", Some(tok1), None).await;
    assert_eq!(me["name"], "Lady Anna");

    // Transfer code -> claim on second device
    let (st, tc) = req(&app, "POST", "/api/me/transfer-code", Some(tok1), None).await;
    assert_eq!(st, StatusCode::OK);
    let code = tc["code"].as_str().unwrap();
    assert_eq!(code.len(), 6);

    let (st, claimed) = req(&app, "POST", "/api/users/claim", None, Some(json!({ "code": code.to_lowercase() }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(claimed["userId"], uid1);
    assert_eq!(claimed["name"], "Lady Anna");
    let tok2 = claimed["token"].as_str().unwrap();

    // Both tokens work; transfer code is one-time use
    let (st, _) = req(&app, "GET", "/api/me", Some(tok2), None).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = req(&app, "POST", "/api/users/claim", None, Some(json!({ "code": code }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn challenges_join_and_limits() {
    let (app, _) = test_app();
    let (_, u1) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Creator" }))).await;
    let tok1 = u1["token"].as_str().unwrap();

    // Past start date rejected
    let (st, _) = req(&app, "POST", "/api/challenges", Some(tok1), Some(json!({ "config": valid_config("2020-01-01"), "heroClass": "knight" }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    // Theme without finished art rejected
    let mut bad_theme = valid_config("2099-01-01");
    bad_theme["theme"] = json!("ember");
    let (st, _) = req(&app, "POST", "/api/challenges", Some(tok1), Some(json!({ "config": bad_theme, "heroClass": "knight" }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    // Future start date so joining is open
    let tomorrow = (chrono::Utc::now().date_naive() + chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
    let (st, ch) = req(&app, "POST", "/api/challenges", Some(tok1), Some(json!({ "config": valid_config(&tomorrow), "heroClass": "knight" }))).await;
    assert_eq!(st, StatusCode::OK);
    let cid = ch["id"].as_str().unwrap();
    let invite = ch["inviteCode"].as_str().unwrap();

    // Preview by invite (public)
    let (st, prev) = req(&app, "GET", &format!("/api/challenges/by-invite/{invite}"), None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(prev["joinable"], true);
    assert_eq!(prev["memberCount"], 1);

    // Join up to 8 members total
    for i in 2..=8 {
        let (_, u) = req(&app, "POST", "/api/users", None, Some(json!({ "name": format!("Hero{i}") }))).await;
        let tok = u["token"].as_str().unwrap();
        let (st, joined) = req(&app, "POST", "/api/challenges/join", Some(tok), Some(json!({ "inviteCode": invite, "heroClass": "ranger" }))).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(joined["members"].as_array().unwrap().len(), i);
    }

    // 9th user rejected with 409 CONFLICT
    let (_, u9) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Extra" }))).await;
    let tok9 = u9["token"].as_str().unwrap();
    let (st, _) = req(&app, "POST", "/api/challenges/join", Some(tok9), Some(json!({ "inviteCode": invite, "heroClass": "priest" }))).await;
    assert_eq!(st, StatusCode::CONFLICT);

    // Non-member cannot GET challenge or events
    let (st, _) = req(&app, "GET", &format!("/api/challenges/{cid}"), Some(tok9), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _) = req(&app, "GET", &format!("/api/challenges/{cid}/events"), Some(tok9), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn events_windows_and_sequencing() {
    let (app, state) = test_app();
    let (_, u1) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Anna" }))).await;
    let tok1 = u1["token"].as_str().unwrap();

    // Start today in UTC -> Day 1 is currently open
    let today = calendar::local_date(crate::api::now_ms(), chrono_tz::UTC).format("%Y-%m-%d").to_string();
    let (st, ch) = req(&app, "POST", "/api/challenges", Some(tok1), Some(json!({ "config": valid_config(&today), "heroClass": "knight" }))).await;
    assert_eq!(st, StatusCode::OK);
    let cid = ch["id"].as_str().unwrap();
    let invite = ch["inviteCode"].as_str().unwrap();

    // Joining after Day 1 opened is rejected
    let (_, u2) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Late" }))).await;
    let tok2 = u2["token"].as_str().unwrap();
    let (st, _) = req(&app, "POST", "/api/challenges/join", Some(tok2), Some(json!({ "inviteCode": invite, "heroClass": "ranger" }))).await;
    assert_eq!(st, StatusCode::CONFLICT);

    // Day 1 checkin + orders succeed; upsert advances seq and replaces old row
    let (st, r1) = req(&app, "PUT", &format!("/api/challenges/{cid}/days/1/checkin"), Some(tok1), Some(json!({ "payload": { "kept": [false] } }))).await;
    assert_eq!(st, StatusCode::OK);
    let seq1 = r1["seq"].as_i64().unwrap();

    let (st, r2) = req(
        &app,
        "PUT",
        &format!("/api/challenges/{cid}/days/1/orders"),
        Some(tok1),
        Some(json!({ "payload": [{ "kind": "build", "pad": "N-out-1", "type": "archer" }] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let seq2 = r2["seq"].as_i64().unwrap();
    assert!(seq2 > seq1);

    let (st, r3) = req(&app, "PUT", &format!("/api/challenges/{cid}/days/1/checkin"), Some(tok1), Some(json!({ "payload": { "kept": [true] } }))).await;
    assert_eq!(st, StatusCode::OK);
    let seq3 = r3["seq"].as_i64().unwrap();
    assert!(seq3 > seq2);

    // Events query returns 2 rows (orders + latest checkin), and ?since=seq2 returns only the updated checkin
    let (st, ev_all) = req(&app, "GET", &format!("/api/challenges/{cid}/events"), Some(tok1), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(ev_all["events"].as_array().unwrap().len(), 2);

    let (_, ev_since) = req(&app, "GET", &format!("/api/challenges/{cid}/events?since={seq2}"), Some(tok1), None).await;
    let arr = ev_since["events"].as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["payload"]["kept"][0], true);

    // Day 2 has not started yet -> 409
    let (st, _) =
        req(&app, "PUT", &format!("/api/challenges/{cid}/days/2/checkin"), Some(tok1), Some(json!({ "payload": { "kind": "binary", "done": true } }))).await;
    assert_eq!(st, StatusCode::CONFLICT);

    // Day 1 hash before Dawn -> 409
    let (st, _) = req(&app, "PUT", &format!("/api/challenges/{cid}/days/1/hash"), Some(tok1), Some(json!({ "payload": "deadbeef" }))).await;
    assert_eq!(st, StatusCode::CONFLICT);

    // Oversized payload (> 8 KB) -> 413
    let big = "x".repeat(9000);
    let (st, _) = req(&app, "PUT", &format!("/api/challenges/{cid}/days/1/orders"), Some(tok1), Some(json!({ "payload": { "junk": big } }))).await;
    assert_eq!(st, StatusCode::PAYLOAD_TOO_LARGE);

    // Shift challenge startDate back 3 days in DB to simulate Day 1 Dawn having passed
    let past = (chrono::Utc::now().date_naive() - chrono::Duration::days(3)).format("%Y-%m-%d").to_string();
    state.db.lock().unwrap().execute("UPDATE challenges SET config_json = ?1 WHERE id = ?2", params![valid_config(&past).to_string(), cid]).unwrap();

    // Now Day 1 checkin is closed (409), while Day 1 hash is allowed (200)
    let (st, _) =
        req(&app, "PUT", &format!("/api/challenges/{cid}/days/1/checkin"), Some(tok1), Some(json!({ "payload": { "kind": "binary", "done": false } }))).await;
    assert_eq!(st, StatusCode::CONFLICT);

    let (st, _) = req(&app, "PUT", &format!("/api/challenges/{cid}/days/1/hash"), Some(tok1), Some(json!({ "payload": "6473104f" }))).await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn push_endpoints() {
    let (app, _) = test_app();
    let (_, u1) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Anna" }))).await;
    let tok1 = u1["token"].as_str().unwrap();

    let (st, k) = req(&app, "GET", "/api/push/key", None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert!(k["publicKey"].as_str().unwrap().len() > 40);

    // Non-https rejected
    let (st, _) = req(
        &app,
        "POST",
        "/api/push/subscribe",
        Some(tok1),
        Some(json!({ "endpoint": "http://example.com/push", "keys": { "p256dh": "abc", "auth": "def" } })),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    // Valid https subscription + unsubscribe
    let (st, _) = req(
        &app,
        "POST",
        "/api/push/subscribe",
        Some(tok1),
        Some(json!({ "endpoint": "https://push.example.com/sub/1", "keys": { "p256dh": "abc", "auth": "def" } })),
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);

    let (st, _) = req(&app, "DELETE", "/api/push/subscribe", Some(tok1), Some(json!({ "endpoint": "https://push.example.com/sub/1" }))).await;
    assert_eq!(st, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn scheduler_reminders_and_dawn_dedup() {
    let (app, state) = test_app();
    let (_, u1) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Anna" }))).await;
    let tok1 = u1["token"].as_str().unwrap();
    let uid1 = u1["userId"].as_str().unwrap();

    let (_, u2) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Brin" }))).await;
    let tok2 = u2["token"].as_str().unwrap();
    let uid2 = u2["userId"].as_str().unwrap();

    let tomorrow = (chrono::Utc::now().date_naive() + chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
    let cfg = valid_config(&tomorrow);
    let (st, ch) = req(&app, "POST", "/api/challenges", Some(tok1), Some(json!({ "config": cfg, "heroClass": "knight" }))).await;
    assert_eq!(st, StatusCode::OK);
    let cid = ch["id"].as_str().unwrap();
    let invite = ch["inviteCode"].as_str().unwrap();

    let (st, _) = req(&app, "POST", "/api/challenges/join", Some(tok2), Some(json!({ "inviteCode": invite, "heroClass": "ranger" }))).await;
    assert_eq!(st, StatusCode::OK);

    let cal = calendar::parse_config(&cfg).unwrap();
    let w1 = &calendar::day_windows(&cal)[0];

    // Simulate Anna having checked in on Day 1, while Brin has not
    state
        .db
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO events (challenge_id, day, user_id, kind, payload_json, updated_at) VALUES (?1, 1, ?2, 'checkin', '{\"kept\":[true]}', ?3)",
            params![cid, uid1, w1.open + 1000],
        )
        .unwrap();

    // At 20:05 UTC on Day 1: only Brin should get an evening reminder
    let evening = calendar::zoned_to_utc(w1.date, chrono::NaiveTime::from_hms_opt(20, 5, 0).unwrap(), cal.tz);
    let jobs = crate::scheduler::collect_at(&state, evening).unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].user_id, uid2);
    assert_eq!(jobs[0].kind, "remind");
    assert_eq!(jobs[0].day, 1);

    // Second pass at 20:06 UTC -> deduplicated (0 jobs)
    let jobs_again = crate::scheduler::collect_at(&state, evening + 60_000).unwrap();
    assert!(jobs_again.is_empty());

    // At Dawn_1 + 1 min: both Anna and Brin get Dawn notifications
    let dawn_jobs = crate::scheduler::collect_at(&state, w1.dawn + 60_000).unwrap();
    assert_eq!(dawn_jobs.len(), 2);
    assert!(dawn_jobs.iter().all(|j| j.kind == "dawn" && j.day == 1));
    assert!(crate::scheduler::collect_at(&state, w1.dawn + 120_000).unwrap().is_empty());
}
