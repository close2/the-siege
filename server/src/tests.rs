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
