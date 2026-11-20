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
    let limiter = Arc::new(crate::security::RateLimiter::new(false));
    let state = AppState { db, push, limiter };
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

    // Bad name -> 400 with structured error code + params
    let (st, bad_name) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "A" }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(bad_name["code"], "invalid_name");
    assert_eq!(bad_name["params"]["min"], 2);
    assert_eq!(bad_name["params"]["max"], 24);

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
    assert_eq!(code.len(), 8);

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

    // Valid allow-listed https subscription + unsubscribe
    let (st, _) = req(
        &app,
        "POST",
        "/api/push/subscribe",
        Some(tok1),
        Some(json!({ "endpoint": "https://fcm.googleapis.com/fcm/send/sub1", "keys": { "p256dh": "abc", "auth": "def" } })),
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);

    let (st, _) = req(&app, "DELETE", "/api/push/subscribe", Some(tok1), Some(json!({ "endpoint": "https://fcm.googleapis.com/fcm/send/sub1" }))).await;
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
    assert_eq!(jobs[0].payload["kind"], "remind");
    assert_eq!(jobs[0].payload["day"], 1);
    assert_eq!(jobs[0].payload["challengeTitle"], "No Sugar Siege");

    // Second pass at 20:06 UTC -> deduplicated (0 jobs)
    let jobs_again = crate::scheduler::collect_at(&state, evening + 60_000).unwrap();
    assert!(jobs_again.is_empty());

    // At Dawn_1 + 1 min: both Anna and Brin get Dawn notifications
    let dawn_jobs = crate::scheduler::collect_at(&state, w1.dawn + 60_000).unwrap();
    assert_eq!(dawn_jobs.len(), 2);
    assert!(dawn_jobs.iter().all(|j| j.kind == "dawn" && j.day == 1));
    assert!(crate::scheduler::collect_at(&state, w1.dawn + 120_000).unwrap().is_empty());
}

async fn req_ext(
    app: &Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    cf_ip: Option<&str>,
    peer: Option<std::net::SocketAddr>,
    body: Option<Value>,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let mut b = Request::builder().method(method).uri(uri).header("content-type", "application/json");
    if let Some(t) = token {
        b = b.header("authorization", format!("Bearer {t}"));
    }
    if let Some(ip) = cf_ip {
        b = b.header("cf-connecting-ip", ip);
    }
    let body = match body {
        Some(v) => Body::from(v.to_string()),
        None => Body::empty(),
    };
    let mut request = b.body(body).unwrap();
    if let Some(addr) = peer {
        request.extensions_mut().insert(axum::extract::ConnectInfo(addr));
    }
    let res = app.clone().oneshot(request).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let val = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
    (status, headers, val)
}

#[tokio::test]
async fn web_push_ssrf_allowlist_and_composite_key_caps() {
    let (app, state) = test_app();
    let (_, u1) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Anna" }))).await;
    let tok1 = u1["token"].as_str().unwrap();
    let uid1 = u1["userId"].as_str().unwrap();
    let (_, u2) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Brin" }))).await;
    let tok2 = u2["token"].as_str().unwrap();
    let uid2 = u2["userId"].as_str().unwrap();

    let bad_endpoints = [
        "https://127.0.0.1/push",
        "https://[::1]/push",
        "https://169.254.169.254/latest/meta-data",
        "https://push.example.com/sub/1",
        "https://fcm.googleapis.com.evil.com/sub/1",
        "https://evilnotify.windows.com/sub/1",
        "https://notify.windows.com/sub/1",
        "https://fcm.googleapis.com:8443/sub/1",
        "https://fcm.googleapis.com@evil.com/sub/1",
        "https://fcm.googleapis.com./sub/1",
        "https://FCM.GOOGLEAPIS.COM/sub/1",
        "https://fcm.googleapis.com/",
        "https://fcm.googleapis.com/sub#frag",
    ];
    for ep in bad_endpoints {
        let (st, _, err_val) = req_ext(
            &app,
            "POST",
            "/api/push/subscribe",
            Some(tok1),
            Some("198.51.100.1"),
            None,
            Some(json!({ "endpoint": ep, "keys": { "p256dh": "abc", "auth": "def" } })),
        )
        .await;
        // Spread across distinct CF-Connecting-IPs if needed; burst is 10 per token, so split across tok1/tok2
        if st == StatusCode::TOO_MANY_REQUESTS {
            let (st2, _, _) = req_ext(
                &app,
                "POST",
                "/api/push/subscribe",
                Some(tok2),
                Some("198.51.100.2"),
                None,
                Some(json!({ "endpoint": ep, "keys": { "p256dh": "abc", "auth": "def" } })),
            )
            .await;
            assert_eq!(st2, StatusCode::BAD_REQUEST, "expected 400 for {ep}");
        } else {
            assert_eq!(st, StatusCode::BAD_REQUEST, "expected 400 for {ep}, got {err_val}");
        }
    }

    // Valid allow-listed providers succeed
    let (_, u3) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Cara" }))).await;
    let tok3 = u3["token"].as_str().unwrap();
    let uid3 = u3["userId"].as_str().unwrap();
    let valid_endpoints = [
        "https://fcm.googleapis.com/fcm/send/token1",
        "https://updates.push.services.mozilla.com/wpush/v2/token2",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
        "https://web.push.apple.com/Qtoken4",
    ];
    for ep in valid_endpoints {
        let (st, _, _) = req_ext(
            &app,
            "POST",
            "/api/push/subscribe",
            Some(tok3),
            Some("198.51.100.3"),
            None,
            Some(json!({ "endpoint": ep, "keys": { "p256dh": "abc", "auth": "def" } })),
        )
        .await;
        assert_eq!(st, StatusCode::NO_CONTENT, "expected 204 for valid {ep}");
    }

    // Shared endpoint across two users stays isolated via PRIMARY KEY (user_id, endpoint)
    let shared_ep = "https://fcm.googleapis.com/fcm/send/shared_browser";
    let (_, u4) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Dara" }))).await;
    let tok4 = u4["token"].as_str().unwrap();
    let uid4 = u4["userId"].as_str().unwrap();
    let (st, _, _) = req_ext(
        &app,
        "POST",
        "/api/push/subscribe",
        Some(tok3),
        Some("198.51.100.4"),
        None,
        Some(json!({ "endpoint": shared_ep, "keys": { "p256dh": "k3", "auth": "a3" } })),
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);
    let (st, _, _) = req_ext(
        &app,
        "POST",
        "/api/push/subscribe",
        Some(tok4),
        Some("198.51.100.5"),
        None,
        Some(json!({ "endpoint": shared_ep, "keys": { "p256dh": "k4", "auth": "a4" } })),
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);

    // Unsubscribing user 3 leaves user 4's row intact
    let (st, _) = req(&app, "DELETE", "/api/push/subscribe", Some(tok3), Some(json!({ "endpoint": shared_ep }))).await;
    assert_eq!(st, StatusCode::NO_CONTENT);
    let u4_count: i64 = state
        .db
        .lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM push_subs WHERE user_id = ?1 AND endpoint = ?2", params![uid4, shared_ep], |r| r.get(0))
        .unwrap();
    assert_eq!(u4_count, 1);

    // Per-user cap (max 10): inserting 12 rows directly via API across fresh token budget keeps <= 10
    {
        let db = state.db.lock().unwrap();
        for i in 0..12 {
            db.execute(
                "INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, 'k', 'a', ?3)",
                params![uid1, format!("https://fcm.googleapis.com/fcm/send/pre_{i}"), 1000 + i],
            )
            .unwrap();
        }
    }
    let (_, u5) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Evan" }))).await;
    let tok5 = u5["token"].as_str().unwrap();
    let uid5 = u5["userId"].as_str().unwrap();
    for i in 0..10 {
        let (st, _, _) = req_ext(
            &app,
            "POST",
            "/api/push/subscribe",
            Some(tok5),
            Some("198.51.100.6"),
            None,
            Some(json!({ "endpoint": format!("https://fcm.googleapis.com/fcm/send/cap_{i}"), "keys": { "p256dh": "k", "auth": "a" } })),
        )
        .await;
        assert_eq!(st, StatusCode::NO_CONTENT);
    }
    // Also trigger cap enforcement on uid1 via one subscribe call with a fresh user's token? No, use tok1 if within budget or verify SQL cap on uid1
    let (st, _, _) = req_ext(
        &app,
        "POST",
        "/api/push/subscribe",
        Some(tok2),
        Some("198.51.100.7"),
        None,
        Some(json!({ "endpoint": "https://fcm.googleapis.com/fcm/send/final", "keys": { "p256dh": "k", "auth": "a" } })),
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);
    let _ = (uid2, uid3, uid5);

    // Seed 12 rows on uid4 and perform 1 API subscribe with tok4 -> capped to 10!
    {
        let db = state.db.lock().unwrap();
        for i in 0..12 {
            db.execute(
                "INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, 'k', 'a', ?3)",
                params![uid4, format!("https://fcm.googleapis.com/fcm/send/seed_{i}"), 100 + i],
            )
            .unwrap();
        }
    }
    let (st, _, _) = req_ext(
        &app,
        "POST",
        "/api/push/subscribe",
        Some(tok4),
        Some("198.51.100.8"),
        None,
        Some(json!({ "endpoint": "https://fcm.googleapis.com/fcm/send/newest", "keys": { "p256dh": "k", "auth": "a" } })),
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);
    let u4_total: i64 = state.db.lock().unwrap().query_row("SELECT COUNT(*) FROM push_subs WHERE user_id = ?1", params![uid4], |r| r.get(0)).unwrap();
    assert_eq!(u4_total, 10);
}

#[tokio::test]
async fn cf_connecting_ip_spoofing_and_ipv6_subnet_rate_limit() {
    let (app, _) = test_app();
    let loopback_peer: std::net::SocketAddr = "127.0.0.1:44123".parse().unwrap();
    let public_peer: std::net::SocketAddr = "198.51.100.99:55123".parse().unwrap();

    // 10 user creations across rotating /128s inside the SAME IPv6 /64 succeed, 11th hits 429 + Retry-After
    for i in 1..=10 {
        let v6 = format!("2001:db8:abcd:1234::{i:x}");
        let (st, _, _) = req_ext(&app, "POST", "/api/users", None, Some(&v6), Some(loopback_peer), Some(json!({ "name": "BotUser" }))).await;
        assert_eq!(st, StatusCode::OK, "iteration {i} failed");
    }
    let (st, headers, body) =
        req_ext(&app, "POST", "/api/users", None, Some("2001:db8:abcd:1234::ffff"), Some(loopback_peer), Some(json!({ "name": "BotUser11" }))).await;
    assert_eq!(st, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["code"], "rate_limited");
    assert!(headers.get("retry-after").is_some());

    // Different IPv6 /64 still succeeds
    let (st, _, _) = req_ext(&app, "POST", "/api/users", None, Some("2001:db8:abcd:9999::1"), Some(loopback_peer), Some(json!({ "name": "LegitUser" }))).await;
    assert_eq!(st, StatusCode::OK);

    // Non-loopback peer CANNOT spoof CF-Connecting-IP to bypass rate limiting
    for i in 1..=10 {
        let spoofed = format!("203.0.113.{i}");
        let (st, _, _) = req_ext(&app, "POST", "/api/users", None, Some(&spoofed), Some(public_peer), Some(json!({ "name": "Spoofer" }))).await;
        assert_eq!(st, StatusCode::OK);
    }
    let (st, _, _) = req_ext(&app, "POST", "/api/users", None, Some("203.0.113.250"), Some(public_peer), Some(json!({ "name": "Spoofer11" }))).await;
    assert_eq!(st, StatusCode::TOO_MANY_REQUESTS);

    // /api/health remains exempt and healthy
    let (st, _, _) = req_ext(&app, "GET", "/api/health", None, Some("2001:db8:abcd:1234::ffff"), Some(loopback_peer), None).await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn transfer_code_lockout_and_invite_enumeration_lockout() {
    let (app, _) = test_app();

    // Victim creates transfer code
    let (_, _, victim) = req_ext(&app, "POST", "/api/users", None, Some("192.0.2.1"), None, Some(json!({ "name": "Victim" }))).await;
    let victim_tok = victim["token"].as_str().unwrap();
    let (_, _, tc) = req_ext(&app, "POST", "/api/me/transfer-code", Some(victim_tok), Some("192.0.2.1"), None, None).await;
    let victim_code = tc["code"].as_str().unwrap();

    // Attacker creates their own account + own transfer code to try resetting failure counter
    let (_, _, attacker) = req_ext(&app, "POST", "/api/users", None, Some("192.0.2.50"), None, Some(json!({ "name": "Attacker" }))).await;
    let attacker_tok = attacker["token"].as_str().unwrap();
    let (_, _, atc) = req_ext(&app, "POST", "/api/me/transfer-code", Some(attacker_tok), Some("192.0.2.50"), None, None).await;
    let attacker_code = atc["code"].as_str().unwrap();

    // 4 wrong guesses from attacker IP
    for i in 0..4 {
        let (st, _, _) = req_ext(&app, "POST", "/api/users/claim", None, Some("192.0.2.50"), None, Some(json!({ "code": format!("WRONG00{i}") }))).await;
        assert_eq!(st, StatusCode::NOT_FOUND);
    }

    // Attacker claims their OWN code (must NOT reset their failed attempt counter!)
    let (st, _, _) = req_ext(&app, "POST", "/api/users/claim", None, Some("192.0.2.50"), None, Some(json!({ "code": attacker_code }))).await;
    assert_eq!(st, StatusCode::OK);

    // 5th wrong guess triggers lockout; subsequent attempt from attacker IP gets 429 even with victim's real code!
    let (st, _, _) = req_ext(&app, "POST", "/api/users/claim", None, Some("192.0.2.50"), None, Some(json!({ "code": "WRONG005" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    let (st, headers, _) = req_ext(&app, "POST", "/api/users/claim", None, Some("192.0.2.50"), None, Some(json!({ "code": victim_code }))).await;
    assert_eq!(st, StatusCode::TOO_MANY_REQUESTS);
    assert!(headers.get("retry-after").is_some());

    // Meanwhile victim on their own IP claims their transfer code without issue!
    let (st, _, claimed) = req_ext(&app, "POST", "/api/users/claim", None, Some("192.0.2.2"), None, Some(json!({ "code": victim_code }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(claimed["name"], "Victim");

    // Invite lookup lockout across by-invite and join after 10 failures
    for i in 0..10 {
        let (st, _, _) = req_ext(&app, "GET", &format!("/api/challenges/by-invite/BAD{i:03}"), None, Some("192.0.2.88"), None, None).await;
        assert_eq!(st, StatusCode::NOT_FOUND);
    }
    let (st, _, _) = req_ext(&app, "GET", "/api/challenges/by-invite/BAD999", None, Some("192.0.2.88"), None, None).await;
    assert_eq!(st, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn events_keyset_pagination() {
    let (app, state) = test_app();
    let (_, u1) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Anna" }))).await;
    let tok1 = u1["token"].as_str().unwrap();
    let uid1 = u1["userId"].as_str().unwrap();

    let today = calendar::local_date(crate::api::now_ms(), chrono_tz::UTC).format("%Y-%m-%d").to_string();
    let (st, ch) = req(&app, "POST", "/api/challenges", Some(tok1), Some(json!({ "config": valid_config(&today), "heroClass": "knight" }))).await;
    assert_eq!(st, StatusCode::OK);
    let cid = ch["id"].as_str().unwrap();

    {
        let db = state.db.lock().unwrap();
        for day in 1..=12 {
            db.execute(
                "INSERT INTO events (challenge_id, day, user_id, kind, payload_json, updated_at) VALUES (?1, ?2, ?3, 'checkin', '{\"kept\":[true]}', ?4)",
                params![cid, day, uid1, 1000 + day],
            )
            .unwrap();
        }
    }

    let (st, p1) = req(&app, "GET", &format!("/api/challenges/{cid}/events?since=-10&limit=5"), Some(tok1), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(p1["events"].as_array().unwrap().len(), 5);
    assert_eq!(p1["hasMore"], true);
    let c1 = p1["nextSince"].as_i64().unwrap();

    let (st, p2) = req(&app, "GET", &format!("/api/challenges/{cid}/events?since={c1}&limit=5"), Some(tok1), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(p2["events"].as_array().unwrap().len(), 5);
    assert_eq!(p2["hasMore"], true);
    let c2 = p2["nextSince"].as_i64().unwrap();
    assert!(c2 > c1);

    let (st, p3) = req(&app, "GET", &format!("/api/challenges/{cid}/events?since={c2}&limit=5"), Some(tok1), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(p3["events"].as_array().unwrap().len(), 2);
    assert_eq!(p3["hasMore"], false);
}

#[tokio::test]
async fn legacy_migration_and_14_day_orphan_user_purge() {
    let tmp_db = format!("/tmp/siege_legacy_test_{}.db", rand::random::<u64>());
    let now = crate::api::now_ms();
    let day_ms = 24 * 3600 * 1000_i64;

    // 1. Seed a pre-0.5 legacy database schema (plaintext transfer_codes.code, endpoint-only PK on push_subs, non-cascading FKs)
    {
        let conn = rusqlite::Connection::open(&tmp_db).unwrap();
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL);
            CREATE TABLE transfer_codes (code TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
            CREATE TABLE challenges (id TEXT PRIMARY KEY, creator TEXT NOT NULL REFERENCES users(id), config_json TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE, seed TEXT NOT NULL, sim_version INTEGER NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE members (challenge_id TEXT NOT NULL REFERENCES challenges(id), user_id TEXT NOT NULL REFERENCES users(id), hero_class TEXT NOT NULL, join_order INTEGER NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (challenge_id, user_id));
            CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, challenge_id TEXT NOT NULL REFERENCES challenges(id), day INTEGER NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (challenge_id, day, user_id, kind));
            CREATE TABLE push_subs (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), p256dh TEXT NOT NULL, auth TEXT NOT NULL);
            CREATE TABLE sent_notifications (challenge_id TEXT NOT NULL, user_id TEXT NOT NULL, day INTEGER NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (challenge_id, user_id, day, kind));
            "#,
        )
        .unwrap();

        // Insert 4 users:
        // - u_orphan_old (15 days old, has token + push_sub + expired transfer_code, NO challenge) -> MUST BE PURGED
        // - u_orphan_fresh (13 days old, NO challenge, has live legacy 6-char transfer code) -> MUST BE KEPT & claimable
        // - u_creator_old (30 days old, created a challenge) -> MUST BE KEPT
        // - u_member_old (30 days old, member of challenge) -> MUST BE KEPT
        conn.execute("INSERT INTO users VALUES ('u_orphan_old', 'SpamBot', ?1)", params![now - 15 * day_ms]).unwrap();
        conn.execute("INSERT INTO tokens VALUES ('tok_orphan_old', 'u_orphan_old', ?1)", params![now - 15 * day_ms]).unwrap();
        conn.execute("INSERT INTO push_subs VALUES ('https://fcm.googleapis.com/fcm/send/old', 'u_orphan_old', 'p', 'a')", []).unwrap();
        conn.execute("INSERT INTO transfer_codes VALUES ('EXP123', 'u_orphan_old', ?1)", params![now - 1000]).unwrap();

        conn.execute("INSERT INTO users VALUES ('u_orphan_fresh', 'Newcomer', ?1)", params![now - 13 * day_ms]).unwrap();
        conn.execute("INSERT INTO transfer_codes VALUES ('leg678', 'u_orphan_fresh', ?1)", params![now + 600_000]).unwrap();

        conn.execute("INSERT INTO users VALUES ('u_creator_old', 'Founder', ?1)", params![now - 30 * day_ms]).unwrap();
        conn.execute("INSERT INTO users VALUES ('u_member_old', 'Teammate', ?1)", params![now - 30 * day_ms]).unwrap();
        conn.execute("INSERT INTO challenges VALUES ('c1', 'u_creator_old', '{}', 'INV123', 'seed', 1, ?1)", params![now - 30 * day_ms]).unwrap();
        conn.execute("INSERT INTO members VALUES ('c1', 'u_member_old', 'knight', 1, ?1)", params![now - 30 * day_ms]).unwrap();
    }

    // 2. Open with upgraded db::open -> runs migration seamlessly
    let db = db::open(&tmp_db).unwrap();
    let limiter = Arc::new(crate::security::RateLimiter::new(false));
    let state = AppState { db, push: None, limiter };
    let router = app(state.clone(), None);

    // Migrated 6-char legacy transfer code is claimable via SHA-256 lookup!
    let (st, claimed) = req(&router, "POST", "/api/users/claim", None, Some(json!({ "code": "LEG678" }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(claimed["userId"], "u_orphan_fresh");

    // 3. Run 14-day orphan user purge
    let purged = crate::scheduler::run_purge_pass(&state, now, 14 * day_ms);
    assert_eq!(purged, 1);

    let remaining: Vec<String> = {
        let conn = state.db.lock().unwrap();
        let mut s = conn.prepare("SELECT id FROM users ORDER BY id").unwrap();
        s.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    };
    assert_eq!(remaining, vec!["u_creator_old", "u_member_old", "u_orphan_fresh"]);

    let _ = std::fs::remove_file(&tmp_db);
    let _ = std::fs::remove_file(format!("{tmp_db}-wal"));
    let _ = std::fs::remove_file(format!("{tmp_db}-shm"));
}

#[test]
fn path_sanitization_blocks_secret_leaks_and_log_injection() {
    use crate::security::sanitize_path;
    assert_eq!(sanitize_path("/api/challenges/by-invite/SECRET99"), "/api/challenges/by-invite/{code}");
    assert_eq!(sanitize_path("//API/challenges/by%2dinvite/SECRET99"), "/api/challenges/by-invite/{code}");
    assert_eq!(sanitize_path("/join/SECRET99"), "/join/{code}");
    assert_eq!(sanitize_path("/api/../Join/SECRET99"), "/join/{code}");
    assert_eq!(sanitize_path("/api/challenges/join"), "/api/challenges/join");
    assert_eq!(sanitize_path("/evil\r\nINFO fake\x1b[31m\u{202e}path"), "/evilINFOfake[31mpath");
}

#[tokio::test]
async fn multi_device_play_devices_management_conflicts_and_seen() {
    let (app, state) = test_app();

    // Christian registers on Phone
    let (st, u_phone) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Christian", "deviceLabel": "Phone Safari" }))).await;
    assert_eq!(st, StatusCode::OK);
    let uid = u_phone["userId"].as_str().unwrap().to_string();
    let tok_phone = u_phone["token"].as_str().unwrap().to_string();
    let dev_phone = u_phone["deviceId"].as_str().unwrap().to_string();

    // Bruce registers and creates a challenge starting tomorrow, Christian joins, then shift to today
    let (_, u_bruce) = req(&app, "POST", "/api/users", None, Some(json!({ "name": "Bruce" }))).await;
    let tok_bruce = u_bruce["token"].as_str().unwrap().to_string();

    let tomorrow = (chrono::Utc::now().date_naive() + chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
    let (st, ch) = req(&app, "POST", "/api/challenges", Some(&tok_bruce), Some(json!({ "config": valid_config(&tomorrow), "heroClass": "knight" }))).await;
    assert_eq!(st, StatusCode::OK);
    let cid = ch["id"].as_str().unwrap().to_string();
    let invite = ch["inviteCode"].as_str().unwrap().to_string();

    let (st, _) = req(&app, "POST", "/api/challenges/join", Some(&tok_phone), Some(json!({ "inviteCode": invite, "heroClass": "ranger" }))).await;
    assert_eq!(st, StatusCode::OK);

    // Shift challenge startDate to today so Day 1 is open
    let today = calendar::local_date(crate::api::now_ms(), chrono_tz::UTC).format("%Y-%m-%d").to_string();
    state.db.lock().unwrap().execute("UPDATE challenges SET config_json = ?1 WHERE id = ?2", params![valid_config(&today).to_string(), cid]).unwrap();

    // Christian links Desktop via pairing code
    let (st, tc) = req(&app, "POST", "/api/me/transfer-code", Some(&tok_phone), None).await;
    assert_eq!(st, StatusCode::OK);
    let code = tc["code"].as_str().unwrap().to_string();

    let (st, claimed) = req(&app, "POST", "/api/users/claim", None, Some(json!({ "code": code, "deviceLabel": "Desktop Chrome" }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(claimed["userId"], uid);
    let tok_desktop = claimed["token"].as_str().unwrap().to_string();
    let dev_desktop = claimed["deviceId"].as_str().unwrap().to_string();
    assert_ne!(dev_phone, dev_desktop);

    // /api/me reports deviceCount = 2 and challengeCount = 1 on both devices
    let (st, me_desktop) = req(&app, "GET", "/api/me", Some(&tok_desktop), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(me_desktop["deviceCount"], 2);
    assert_eq!(me_desktop["challengeCount"], 1);
    assert_eq!(me_desktop["deviceId"], dev_desktop);

    // /api/me/devices lists both devices with accurate `current` flag and labels
    let (st, devs) = req(&app, "GET", "/api/me/devices", Some(&tok_desktop), None).await;
    assert_eq!(st, StatusCode::OK);
    let arr = devs.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    let d_desk = arr.iter().find(|d| d["id"] == dev_desktop).unwrap();
    let d_ph = arr.iter().find(|d| d["id"] == dev_phone).unwrap();
    assert_eq!(d_desk["label"], "Desktop Chrome");
    assert_eq!(d_desk["current"], true);
    assert_eq!(d_ph["label"], "Phone Safari");
    assert_eq!(d_ph["current"], false);

    // Phone submits Day 1 checkin; Desktop submits Day 1 orders with expectedSeq = 0
    let (st, r_ci) =
        req(&app, "PUT", &format!("/api/challenges/{cid}/days/1/checkin"), Some(&tok_phone), Some(json!({ "payload": { "kept": [true] }, "expectedSeq": 0 })))
            .await;
    assert_eq!(st, StatusCode::OK);
    let ci_seq = r_ci["seq"].as_i64().unwrap();

    let (st, r_ord1) = req(
        &app,
        "PUT",
        &format!("/api/challenges/{cid}/days/1/orders"),
        Some(&tok_desktop),
        Some(json!({ "payload": [{ "kind": "build", "pad": "E-out-1", "type": "archer" }], "expectedSeq": 0 })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let ord_seq1 = r_ord1["seq"].as_i64().unwrap();

    // Phone tries to write orders with stale expectedSeq = 0 -> 409 event_conflict, Desktop's orders preserved!
    let (st, conflict) = req(
        &app,
        "PUT",
        &format!("/api/challenges/{cid}/days/1/orders"),
        Some(&tok_phone),
        Some(json!({ "payload": [{ "kind": "build", "pad": "E-out-2", "type": "mage" }], "expectedSeq": 0 })),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(conflict["code"], "event_conflict");
    assert_eq!(conflict["params"]["latestSeq"], ord_seq1);

    // Phone updates orders with fresh expectedSeq = ord_seq1 -> 200 OK
    let (st, r_ord2) = req(
        &app,
        "PUT",
        &format!("/api/challenges/{cid}/days/1/orders"),
        Some(&tok_phone),
        Some(json!({ "payload": [{ "kind": "build", "pad": "E-out-1", "type": "archer" }, { "kind": "build", "pad": "E-out-2", "type": "mage" }], "expectedSeq": ord_seq1 })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert!(r_ord2["seq"].as_i64().unwrap() > ord_seq1);

    // Bruce observes BOTH Christian's phone checkin and updated orders under the same userId
    let (st, bruce_evs) = req(&app, "GET", &format!("/api/challenges/{cid}/events"), Some(&tok_bruce), None).await;
    assert_eq!(st, StatusCode::OK);
    let evs = bruce_evs["events"].as_array().unwrap();
    assert_eq!(evs.len(), 2);
    assert!(evs.iter().all(|e| e["userId"] == uid));
    assert!(evs.iter().any(|e| e["kind"] == "checkin" && e["seq"] == ci_seq));
    let ord_ev = evs.iter().find(|e| e["kind"] == "orders").unwrap();
    assert_eq!(ord_ev["payload"].as_array().unwrap().len(), 2);

    // Synced `seenDay` across devices: Phone marks Day 1 seen; Desktop reads seenDay = 1; lower day ignored
    let (st, seen1) = req(&app, "PUT", &format!("/api/challenges/{cid}/seen"), Some(&tok_phone), Some(json!({ "day": 1 }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(seen1["seenDay"], 1);
    let (st, seen_lower) = req(&app, "PUT", &format!("/api/challenges/{cid}/seen"), Some(&tok_desktop), Some(json!({ "day": 0 }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(seen_lower["seenDay"], 1);
    let (st, ch_desk) = req(&app, "GET", &format!("/api/challenges/{cid}"), Some(&tok_desktop), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(ch_desk["seenDay"], 1);
    let (st, ch_bruce) = req(&app, "GET", &format!("/api/challenges/{cid}"), Some(&tok_bruce), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(ch_bruce["seenDay"], 0);

    // Bruce cannot revoke Christian's device (404)
    let (st, _) = req(&app, "DELETE", &format!("/api/me/devices/{dev_phone}"), Some(&tok_bruce), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    // Desktop revokes Phone -> Phone gets 401, Desktop keeps working
    let (st, _) = req(&app, "DELETE", &format!("/api/me/devices/{dev_phone}"), Some(&tok_desktop), None).await;
    assert_eq!(st, StatusCode::NO_CONTENT);
    let (st, _) = req(&app, "GET", "/api/me", Some(&tok_phone), None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    let (st, me_after) = req(&app, "GET", "/api/me", Some(&tok_desktop), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(me_after["deviceCount"], 1);
}

#[tokio::test]
async fn v05_migration_adds_token_device_ids_and_member_seen_day() {
    use sha2::Digest;
    let tmp_db = format!("/tmp/siege_v05_mig_test_{}.db", rand::random::<u64>());
    let now = crate::api::now_ms();
    let raw_tok = "legacy-bearer-token-value-123456";
    let tok_hash = hex::encode(sha2::Sha256::digest(raw_tok.as_bytes()));
    let today = calendar::local_date(now, chrono_tz::UTC).format("%Y-%m-%d").to_string();

    {
        let conn = rusqlite::Connection::open(&tmp_db).unwrap();
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);
            CREATE TABLE transfer_codes (code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
            CREATE TABLE challenges (id TEXT PRIMARY KEY, creator TEXT NOT NULL REFERENCES users(id), config_json TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE, seed TEXT NOT NULL, sim_version INTEGER NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE members (challenge_id TEXT NOT NULL REFERENCES challenges(id), user_id TEXT NOT NULL REFERENCES users(id), hero_class TEXT NOT NULL, join_order INTEGER NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (challenge_id, user_id));
            CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, challenge_id TEXT NOT NULL REFERENCES challenges(id), day INTEGER NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (challenge_id, day, user_id, kind));
            CREATE TABLE push_subs (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, endpoint));
            CREATE TABLE sent_notifications (challenge_id TEXT NOT NULL, user_id TEXT NOT NULL, day INTEGER NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (challenge_id, user_id, day, kind));
            "#,
        )
        .unwrap();
        conn.execute("INSERT INTO users VALUES ('u_leg', 'Legacy', ?1)", params![now]).unwrap();
        conn.execute("INSERT INTO tokens VALUES (?1, 'u_leg', ?2)", params![tok_hash, now]).unwrap();
        conn.execute("INSERT INTO challenges VALUES ('c_leg', 'u_leg', ?1, 'LEG123', 'seed', 1, ?2)", params![valid_config(&today).to_string(), now]).unwrap();
        conn.execute("INSERT INTO members VALUES ('c_leg', 'u_leg', 'knight', 0, ?1)", params![now]).unwrap();
    }

    let db = db::open(&tmp_db).unwrap();
    let limiter = Arc::new(crate::security::RateLimiter::new(false));
    let state = AppState { db, push: None, limiter };
    let router = app(state, None);

    // Existing token authenticates, appears in /api/me/devices, and seen_day works
    let (st, devs) = req(&router, "GET", "/api/me/devices", Some(raw_tok), None).await;
    assert_eq!(st, StatusCode::OK);
    let arr = devs.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["current"], true);
    let dev_id = arr[0]["id"].as_str().unwrap().to_string();
    assert!(!dev_id.is_empty());

    let (st, ch) = req(&router, "GET", "/api/challenges/c_leg", Some(raw_tok), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(ch["seenDay"], 0);

    let (st, seen) = req(&router, "PUT", "/api/challenges/c_leg/seen", Some(raw_tok), Some(json!({ "day": 2 }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(seen["seenDay"], 2);

    let _ = std::fs::remove_file(&tmp_db);
    let _ = std::fs::remove_file(format!("{tmp_db}-wal"));
    let _ = std::fs::remove_file(format!("{tmp_db}-shm"));
}

#[tokio::test]
async fn static_cache_control_headers_match_pwa_best_practices() {
    let dir = std::env::temp_dir().join(format!("siege-static-test-{}", std::process::id()));
    let assets_dir = dir.join("assets");
    std::fs::create_dir_all(&assets_dir).unwrap();
    std::fs::write(dir.join("index.html"), "<!doctype html><title>Siege</title>").unwrap();
    std::fs::write(dir.join("sw.js"), "// sw").unwrap();
    std::fs::write(dir.join("registerSW.js"), "// reg").unwrap();
    std::fs::write(dir.join("push-sw.js"), "// push").unwrap();
    std::fs::write(dir.join("manifest.webmanifest"), "{}").unwrap();
    std::fs::write(dir.join("workbox-dcde9eb3.js"), "// wb").unwrap();
    std::fs::write(dir.join("icon-192.png"), [0u8; 4]).unwrap();
    std::fs::write(assets_dir.join("index-G-Ul54dN.js"), "// bundle").unwrap();
    std::fs::write(assets_dir.join("assets.gen.json"), "{}").unwrap();
    std::fs::write(assets_dir.join("map_valley.webp"), [0u8; 4]).unwrap();

    let db = db::open(":memory:").unwrap();
    let limiter = Arc::new(crate::security::RateLimiter::new(false));
    let router = app(AppState { db, push: None, limiter }, Some(dir.to_str().unwrap()));

    let fetch_cc = |uri: &str| {
        let router = router.clone();
        let uri = uri.to_string();
        async move {
            let res = router.oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap()).await.unwrap();
            let status = res.status();
            let cc = res.headers().get(axum::http::header::CACHE_CONTROL).and_then(|v| v.to_str().ok()).map(str::to_owned);
            (status, cc)
        }
    };

    // Unversioned PWA entrypoints and SPA routes must revalidate (never trapped in CDN/browser cache)
    for uri in ["/", "/index.html", "/sw.js", "/registerSW.js", "/push-sw.js", "/manifest.webmanifest", "/assets/assets.gen.json", "/c/some-challenge"] {
        let (st, cc) = fetch_cc(uri).await;
        assert_eq!(st, StatusCode::OK, "uri={uri}");
        assert_eq!(cc.as_deref(), Some("no-cache, must-revalidate"), "uri={uri}");
    }

    // Content-hashed assets are cached immutably
    for uri in ["/workbox-dcde9eb3.js", "/assets/index-G-Ul54dN.js", "/assets/map_valley.webp?v=deadbeef"] {
        let (st, cc) = fetch_cc(uri).await;
        assert_eq!(st, StatusCode::OK, "uri={uri}");
        assert_eq!(cc.as_deref(), Some("public, max-age=31536000, immutable"), "uri={uri}");
    }

    // Unversioned images get short cache (not immutable)
    for uri in ["/icon-192.png", "/assets/map_valley.webp"] {
        let (st, cc) = fetch_cc(uri).await;
        assert_eq!(st, StatusCode::OK, "uri={uri}");
        assert_eq!(cc.as_deref(), Some("public, max-age=86400"), "uri={uri}");
    }

    // API responses are unaffected by static cache middleware
    let (st, cc) = fetch_cc("/api/time").await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(cc, None);

    let _ = std::fs::remove_dir_all(&dir);
}
