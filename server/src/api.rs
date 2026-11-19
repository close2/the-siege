//! HTTP API. See docs/tasks.md (M4) for the contract.
use crate::{
    calendar,
    security::{
        apply_retry_after, validate_push_endpoint, ClientIp, Scope, RL_API_GLOBAL_IP, RL_CLAIM_IP, RL_CREATE_CHALLENGE_IP, RL_CREATE_CHALLENGE_TOKEN,
        RL_CREATE_USER_IP, RL_INVITE_IP, RL_INVITE_TOKEN, RL_MINT_TRANSFER_IP, RL_MINT_TRANSFER_TOKEN, RL_PUSH_SUB_IP, RL_PUSH_SUB_TOKEN,
    },
    AppState,
};
use axum::{
    extract::{DefaultBodyLimit, FromRequestParts, Path, Query, Request, State},
    http::{request::Parts, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use rand::Rng;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const SIM_VERSION: i64 = 1;
const MAX_MEMBERS: i64 = 8;
const MAX_PAYLOAD: usize = 8 * 1024;
const TRANSFER_CODE_LEN: usize = 8;
const MAX_TOKENS_PER_USER: i64 = 20;
const MAX_PUSH_SUBS_PER_USER: i64 = 10;
const TOKEN_TOUCH_INTERVAL_MS: i64 = 60 * 60 * 1000;
const MAX_DEVICE_LABEL_LEN: usize = 48;
const DEFAULT_EVENTS_LIMIT: usize = 500;
const MAX_EVENTS_LIMIT: usize = 1000;
/// Themes whose art is complete (mirror of `ready` in client/src/content/themes.ts).
const THEMES: &[&str] = &["sugar"];
const CODE_CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub params: Option<Value>,
    pub retry_after: Option<u64>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut body = json!({
            "error": self.message,
            "code": self.code,
        });
        if let Some(p) = self.params {
            body["params"] = p;
        }
        let res = (self.status, Json(body)).into_response();
        apply_retry_after(res, self.retry_after)
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        tracing::error!("db error: {e}");
        err(StatusCode::INTERNAL_SERVER_ERROR, "database_error", "database error")
    }
}

type ApiResult<T> = Result<T, ApiError>;

fn err(status: StatusCode, code: &'static str, msg: &str) -> ApiError {
    ApiError { status, code, message: msg.to_string(), params: None, retry_after: None }
}

fn err_params(status: StatusCode, code: &'static str, msg: &str, params: Value) -> ApiError {
    ApiError { status, code, message: msg.to_string(), params: Some(params), retry_after: None }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn random_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    rand::thread_rng().fill(&mut b[..]);
    hex::encode(b)
}

fn random_code(len: usize) -> String {
    let mut r = rand::thread_rng();
    (0..len).map(|_| CODE_CHARS[r.gen_range(0..CODE_CHARS.len())] as char).collect()
}

fn hash_token(t: &str) -> String {
    hex::encode(Sha256::digest(t.as_bytes()))
}

// ---------- auth ----------

pub struct AuthUser {
    pub id: String,
    pub name: String,
    pub token_hash: String,
    pub device_id: String,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let header = parts.headers.get("authorization").and_then(|h| h.to_str().ok()).unwrap_or("");
        let token = header.strip_prefix("Bearer ").ok_or_else(|| err(StatusCode::UNAUTHORIZED, "missing_token", "missing token"))?;
        let token_hash = hash_token(token);
        let db = state.db.lock().unwrap();
        let row = db
            .query_row(
                "SELECT u.id, u.name, COALESCE(t.id, substr(t.token_hash, 1, 16)), t.last_used_at
                 FROM tokens t JOIN users u ON u.id = t.user_id
                 WHERE t.token_hash = ?1",
                params![token_hash],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<i64>>(3)?)),
            )
            .optional()?;
        let Some((id, name, device_id, last_used_at)) = row else {
            return Err(err(StatusCode::UNAUTHORIZED, "invalid_token", "invalid token"));
        };
        let now = now_ms();
        if last_used_at.map(|ts| now.saturating_sub(ts) >= TOKEN_TOUCH_INTERVAL_MS).unwrap_or(true) {
            let _ = db.execute("UPDATE tokens SET last_used_at = ?1 WHERE token_hash = ?2", params![now, token_hash]);
        }
        Ok(AuthUser { id, name, token_hash, device_id })
    }
}

fn clean_device_label(raw: Option<&str>) -> Option<String> {
    let cleaned: String = raw?.trim().chars().filter(|c| !c.is_control()).take(MAX_DEVICE_LABEL_LEN).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn issue_token(db: &rusqlite::Connection, user_id: &str, label: Option<&str>) -> ApiResult<(String, String)> {
    let token = {
        let mut b = [0u8; 32];
        rand::thread_rng().fill(&mut b);
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, b)
    };
    let device_id = format!("d{}", random_hex(8));
    let label = clean_device_label(label);
    let now = now_ms();
    db.execute(
        "INSERT INTO tokens (token_hash, user_id, created_at, id, label, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![hash_token(&token), user_id, now, device_id, label, now],
    )?;
    db.execute(
        "DELETE FROM tokens
         WHERE user_id = ?1
           AND token_hash NOT IN (
             SELECT token_hash FROM tokens
             WHERE user_id = ?1
             ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC, token_hash DESC
             LIMIT ?2
           )",
        params![user_id, MAX_TOKENS_PER_USER],
    )?;
    Ok((token, device_id))
}

fn clean_name(n: &str) -> ApiResult<String> {
    let n = n.trim();
    if n.chars().count() < 2 || n.chars().count() > 24 {
        return Err(err_params(StatusCode::BAD_REQUEST, "invalid_name", "name must be 2–24 characters", json!({ "min": 2, "max": 24 })));
    }
    Ok(n.to_string())
}

// ---------- router ----------

async fn api_ip_guard(State(s): State<AppState>, ip: ClientIp, req: Request, next: Next) -> Result<Response, ApiError> {
    s.limiter.check_ip(Scope::ApiGlobal, ip.bucket, RL_API_GLOBAL_IP, now_ms())?;
    Ok(next.run(req).await)
}

pub fn router(state: AppState) -> Router<AppState> {
    let guarded = Router::new()
        .route("/api/time", get(time))
        .route("/api/users", post(create_user))
        .route("/api/users/claim", post(claim))
        .route("/api/me", get(me).put(rename))
        .route("/api/me/devices", get(list_devices))
        .route("/api/me/devices/{id}", delete(revoke_device))
        .route("/api/me/transfer-code", post(transfer_code))
        .route("/api/challenges", get(list_challenges).post(create_challenge))
        .route("/api/challenges/by-invite/{code}", get(by_invite))
        .route("/api/challenges/join", post(join))
        .route("/api/challenges/{id}", get(get_challenge))
        .route("/api/challenges/{id}/seen", put(put_seen))
        .route("/api/challenges/{id}/days/{day}/{kind}", put(put_event))
        .route("/api/challenges/{id}/events", get(events))
        .route("/api/push/key", get(push_key))
        .route("/api/push/subscribe", post(push_subscribe).delete(push_unsubscribe))
        .route_layer(middleware::from_fn_with_state(state, api_ip_guard));
    Router::new().route("/api/health", get(health)).merge(guarded).layer(DefaultBodyLimit::max(32 * 1024))
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

async fn time() -> Json<Value> {
    Json(json!({ "now": now_ms() }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NameBody {
    name: String,
    device_label: Option<String>,
}

async fn create_user(State(s): State<AppState>, ip: ClientIp, Json(b): Json<NameBody>) -> ApiResult<Json<Value>> {
    let now = now_ms();
    s.limiter.check_ip(Scope::CreateUser, ip.bucket, RL_CREATE_USER_IP, now)?;
    let name = clean_name(&b.name)?;
    let id = format!("u{}", random_hex(8));
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    tx.execute("INSERT INTO users (id, name, created_at) VALUES (?1, ?2, ?3)", params![id, name, now])?;
    let (token, device_id) = issue_token(&tx, &id, b.device_label.as_deref())?;
    tx.commit()?;
    Ok(Json(json!({ "userId": id, "token": token, "deviceId": device_id })))
}

async fn me(State(s): State<AppState>, u: AuthUser) -> ApiResult<Json<Value>> {
    let db = s.db.lock().unwrap();
    let device_count: i64 = db.query_row("SELECT COUNT(*) FROM tokens WHERE user_id = ?1", params![u.id], |r| r.get(0))?;
    let challenge_count: i64 = db.query_row("SELECT COUNT(*) FROM members WHERE user_id = ?1", params![u.id], |r| r.get(0))?;
    Ok(Json(json!({
        "id": u.id,
        "name": u.name,
        "deviceId": u.device_id,
        "deviceCount": device_count,
        "challengeCount": challenge_count
    })))
}

async fn list_devices(State(s): State<AppState>, u: AuthUser) -> ApiResult<Json<Value>> {
    let db = s.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT COALESCE(id, substr(token_hash, 1, 16)), label, created_at, COALESCE(last_used_at, created_at), token_hash
         FROM tokens
         WHERE user_id = ?1
         ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC",
    )?;
    let list: Vec<Value> = stmt
        .query_map(params![u.id], |r| {
            let token_hash: String = r.get(4)?;
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "label": r.get::<_, Option<String>>(1)?,
                "createdAt": r.get::<_, i64>(2)?,
                "lastUsedAt": r.get::<_, i64>(3)?,
                "current": token_hash == u.token_hash
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(Json(Value::Array(list)))
}

async fn revoke_device(State(s): State<AppState>, u: AuthUser, Path(device_id): Path<String>) -> ApiResult<StatusCode> {
    let changed =
        s.db.lock().unwrap().execute("DELETE FROM tokens WHERE user_id = ?1 AND COALESCE(id, substr(token_hash, 1, 16)) = ?2", params![u.id, device_id])?;
    if changed == 0 {
        return Err(err(StatusCode::NOT_FOUND, "device_not_found", "device not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn rename(State(s): State<AppState>, u: AuthUser, Json(b): Json<NameBody>) -> ApiResult<StatusCode> {
    let name = clean_name(&b.name)?;
    s.db.lock().unwrap().execute("UPDATE users SET name = ?1 WHERE id = ?2", params![name, u.id])?;
    Ok(StatusCode::NO_CONTENT)
}

async fn transfer_code(State(s): State<AppState>, ip: ClientIp, u: AuthUser) -> ApiResult<Json<Value>> {
    let now = now_ms();
    s.limiter.check_ip(Scope::MintTransfer, ip.bucket, RL_MINT_TRANSFER_IP, now)?;
    s.limiter.check_token(Scope::MintTransfer, &u.id, RL_MINT_TRANSFER_TOKEN, now)?;
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    tx.execute("DELETE FROM transfer_codes WHERE expires_at < ?1 OR user_id = ?2", params![now, u.id])?;
    let mut code = random_code(TRANSFER_CODE_LEN);
    while tx.query_row("SELECT 1 FROM transfer_codes WHERE code_hash = ?1", params![hash_token(&code)], |_| Ok(())).optional()?.is_some() {
        code = random_code(TRANSFER_CODE_LEN);
    }
    let expires = now + 10 * 60 * 1000;
    tx.execute("INSERT INTO transfer_codes (code_hash, user_id, expires_at) VALUES (?1, ?2, ?3)", params![hash_token(&code), u.id, expires])?;
    tx.commit()?;
    Ok(Json(json!({ "code": code, "expiresAt": expires })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeBody {
    code: String,
    device_label: Option<String>,
}

async fn claim(State(s): State<AppState>, ip: ClientIp, Json(b): Json<CodeBody>) -> ApiResult<Json<Value>> {
    let now = now_ms();
    s.limiter.check_claim_lockout(ip.bucket, now)?;
    s.limiter.check_ip(Scope::ClaimTransfer, ip.bucket, RL_CLAIM_IP, now)?;
    let trimmed = b.code.trim();
    if trimmed.is_empty() || trimmed.len() > 32 || !trimmed.is_ascii() {
        s.limiter.record_claim_failure(ip.bucket, now);
        return Err(err(StatusCode::NOT_FOUND, "invalid_transfer_code", "code invalid or expired"));
    }
    let code_hash = hash_token(&trimmed.to_uppercase());
    let claimed = {
        let db = s.db.lock().unwrap();
        let tx = db.unchecked_transaction()?;
        let row: Option<(String, String)> = tx
            .query_row(
                "SELECT t.user_id, u.name FROM transfer_codes t JOIN users u ON u.id = t.user_id WHERE t.code_hash = ?1 AND t.expires_at >= ?2",
                params![code_hash, now],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        match row {
            Some((user_id, name)) => {
                tx.execute("DELETE FROM transfer_codes WHERE code_hash = ?1", params![code_hash])?;
                let (token, device_id) = issue_token(&tx, &user_id, b.device_label.as_deref())?;
                tx.commit()?;
                Some((user_id, token, name, device_id))
            }
            None => None,
        }
    };
    match claimed {
        Some((user_id, token, name, device_id)) => Ok(Json(json!({ "userId": user_id, "token": token, "name": name, "deviceId": device_id }))),
        None => {
            s.limiter.record_claim_failure(ip.bucket, now);
            Err(err(StatusCode::NOT_FOUND, "invalid_transfer_code", "code invalid or expired"))
        }
    }
}

// ---------- challenges ----------

fn validate_config(c: &Value, now: i64) -> ApiResult<calendar::CalConfig> {
    let bad = |code: &'static str, m: &str| err(StatusCode::BAD_REQUEST, code, m);
    let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if title.chars().count() < 2 || title.chars().count() > 60 {
        return Err(err_params(StatusCode::BAD_REQUEST, "invalid_title", "title must be 2–60 characters", json!({ "min": 2, "max": 60 })));
    }
    let typ = c.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let rules = c.get("rules").and_then(|v| v.as_array()).ok_or_else(|| bad("rules_missing", "rules missing"))?;
    if rules.iter().any(|r| r.as_str().map(|s| s.trim().is_empty() || s.len() > 120).unwrap_or(true)) {
        return Err(bad("invalid_rule_text", "invalid rule text"));
    }
    match typ {
        "binary" if rules.len() == 1 => {}
        "checklist" if (2..=8).contains(&rules.len()) => {}
        "numeric" if rules.is_empty() => {
            let t = c.get("target").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if t <= 0.0 || !t.is_finite() {
                return Err(bad("invalid_target", "target must be > 0"));
            }
            match c.get("direction").and_then(|v| v.as_str()) {
                Some("higher") | Some("lower") => {}
                _ => return Err(bad("invalid_direction", "direction must be higher or lower")),
            }
        }
        _ => return Err(bad("invalid_type_rules", "invalid type / rules")),
    }
    match c.get("difficulty").and_then(|v| v.as_str()) {
        Some("very_easy") | Some("easy") | Some("normal") | Some("hard") => {}
        _ => return Err(bad("invalid_difficulty", "invalid difficulty")),
    }
    if !c.get("theme").and_then(|v| v.as_str()).is_some_and(|t| THEMES.contains(&t)) {
        return Err(bad("invalid_theme", "invalid theme"));
    }
    let cal = calendar::parse_config(c).map_err(|e| bad("invalid_calendar", &e))?;
    if !(7..=90).contains(&cal.days) {
        return Err(err_params(StatusCode::BAD_REQUEST, "invalid_days", "days must be 7–90", json!({ "min": 7, "max": 90 })));
    }
    if cal.inactive.len() > 90 {
        return Err(bad("too_many_inactive_dates", "too many inactive dates"));
    }
    let today = calendar::local_date(now, cal.tz);
    if cal.start_date < today {
        return Err(bad("start_date_past", "start date is in the past"));
    }
    if cal.start_date > today + chrono::Duration::days(365) {
        return Err(bad("start_date_too_far", "start date cannot be more than 365 days in the future"));
    }
    Ok(cal)
}

fn challenge_json(db: &rusqlite::Connection, id: &str, viewer_uid: &str) -> ApiResult<Value> {
    let row = db
        .query_row("SELECT config_json, seed, sim_version, invite_code, creator FROM challenges WHERE id = ?1", params![id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?))
        })
        .optional()?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "challenge_not_found", "challenge not found"))?;
    let mut stmt = db.prepare(
        "SELECT m.user_id, u.name, m.hero_class, m.join_order FROM members m JOIN users u ON u.id = m.user_id WHERE m.challenge_id = ?1 ORDER BY m.join_order",
    )?;
    let members: Vec<Value> = stmt
        .query_map(params![id], |r| {
            Ok(json!({ "userId": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "heroClass": r.get::<_, String>(2)?, "joinOrder": r.get::<_, i64>(3)? }))
        })?
        .collect::<Result<_, _>>()?;
    let seen_day: i64 =
        db.query_row("SELECT seen_day FROM members WHERE challenge_id = ?1 AND user_id = ?2", params![id, viewer_uid], |r| r.get(0)).optional()?.unwrap_or(0);
    let config: Value = serde_json::from_str(&row.0).unwrap_or(Value::Null);
    Ok(
        json!({ "id": id, "config": config, "seed": row.1, "simVersion": row.2, "inviteCode": row.3, "creatorId": row.4, "members": members, "seenDay": seen_day }),
    )
}

fn is_member(db: &rusqlite::Connection, cid: &str, uid: &str) -> ApiResult<bool> {
    Ok(db.query_row("SELECT 1 FROM members WHERE challenge_id = ?1 AND user_id = ?2", params![cid, uid], |_| Ok(())).optional()?.is_some())
}

fn valid_hero(h: &str) -> ApiResult<()> {
    match h {
        "knight" | "ranger" | "priest" => Ok(()),
        _ => Err(err(StatusCode::BAD_REQUEST, "invalid_hero_class", "invalid hero class")),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody {
    config: Value,
    hero_class: String,
}

async fn create_challenge(State(s): State<AppState>, ip: ClientIp, u: AuthUser, Json(b): Json<CreateBody>) -> ApiResult<Json<Value>> {
    let now = now_ms();
    s.limiter.check_ip(Scope::CreateChallenge, ip.bucket, RL_CREATE_CHALLENGE_IP, now)?;
    s.limiter.check_token(Scope::CreateChallenge, &u.id, RL_CREATE_CHALLENGE_TOKEN, now)?;
    validate_config(&b.config, now)?;
    valid_hero(&b.hero_class)?;
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    let id = format!("c{}", random_hex(8));
    let mut code = random_code(6);
    while tx.query_row("SELECT 1 FROM challenges WHERE invite_code = ?1", params![code], |_| Ok(())).optional()?.is_some() {
        code = random_code(6);
    }
    tx.execute(
        "INSERT INTO challenges (id, creator, config_json, invite_code, seed, sim_version, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, u.id, b.config.to_string(), code, random_hex(8), SIM_VERSION, now],
    )?;
    tx.execute(
        "INSERT INTO members (challenge_id, user_id, hero_class, join_order, joined_at) VALUES (?1, ?2, ?3, 0, ?4)",
        params![id, u.id, b.hero_class, now],
    )?;
    tx.commit()?;
    Ok(Json(challenge_json(&db, &id, &u.id)?))
}

async fn list_challenges(State(s): State<AppState>, u: AuthUser) -> ApiResult<Json<Value>> {
    let db = s.db.lock().unwrap();
    let ids: Vec<String> = db
        .prepare("SELECT c.id FROM challenges c JOIN members m ON m.challenge_id = c.id WHERE m.user_id = ?1 ORDER BY c.created_at DESC")?
        .query_map(params![u.id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let list: Vec<Value> = ids.iter().map(|id| challenge_json(&db, id, &u.id)).collect::<Result<_, _>>()?;
    Ok(Json(Value::Array(list)))
}

fn started(config: &Value, now: i64) -> bool {
    calendar::parse_config(config).ok().and_then(|c| calendar::day_windows(&c).first().map(|w| now >= w.open)).unwrap_or(true)
}

async fn by_invite(State(s): State<AppState>, ip: ClientIp, Path(code): Path<String>) -> ApiResult<Json<Value>> {
    let now = now_ms();
    s.limiter.check_invite_lockout(ip.bucket, None, now)?;
    s.limiter.check_ip(Scope::InviteLookup, ip.bucket, RL_INVITE_IP, now)?;
    let row = {
        let db = s.db.lock().unwrap();
        db.query_row(
            "SELECT c.id, c.config_json, u.name, (SELECT COUNT(*) FROM members m WHERE m.challenge_id = c.id) FROM challenges c JOIN users u ON u.id = c.creator WHERE c.invite_code = ?1",
            params![code.trim().to_uppercase()],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?)),
        )
        .optional()?
    };
    let Some(row) = row else {
        s.limiter.record_invite_failure(ip.bucket, None, now);
        return Err(err(StatusCode::NOT_FOUND, "invite_not_found", "invite code not found"));
    };
    let config: Value = serde_json::from_str(&row.1).unwrap_or(Value::Null);
    let joinable = !started(&config, now) && row.3 < MAX_MEMBERS;
    Ok(Json(json!({
        "id": row.0, "title": config["title"], "startDate": config["startDate"], "days": config["days"],
        "memberCount": row.3, "creatorName": row.2, "joinable": joinable
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinBody {
    invite_code: String,
    hero_class: String,
}

async fn join(State(s): State<AppState>, ip: ClientIp, u: AuthUser, Json(b): Json<JoinBody>) -> ApiResult<Json<Value>> {
    let now = now_ms();
    s.limiter.check_invite_lockout(ip.bucket, Some(&u.id), now)?;
    s.limiter.check_ip(Scope::InviteLookup, ip.bucket, RL_INVITE_IP, now)?;
    s.limiter.check_token(Scope::InviteLookup, &u.id, RL_INVITE_TOKEN, now)?;
    valid_hero(&b.hero_class)?;
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    let found: Option<(String, String)> = tx
        .query_row("SELECT id, config_json FROM challenges WHERE invite_code = ?1", params![b.invite_code.trim().to_uppercase()], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    let Some((cid, cfg)) = found else {
        drop(tx);
        drop(db);
        s.limiter.record_invite_failure(ip.bucket, Some(&u.id), now);
        return Err(err(StatusCode::NOT_FOUND, "invite_not_found", "invite code not found"));
    };
    if is_member(&tx, &cid, &u.id)? {
        return Ok(Json(challenge_json(&tx, &cid, &u.id)?));
    }
    let config: Value = serde_json::from_str(&cfg).unwrap_or(Value::Null);
    if started(&config, now) {
        return Err(err(StatusCode::CONFLICT, "season_already_started", "the season has already started"));
    }
    let count: i64 = tx.query_row("SELECT COUNT(*) FROM members WHERE challenge_id = ?1", params![cid], |r| r.get(0))?;
    if count >= MAX_MEMBERS {
        return Err(err(StatusCode::CONFLICT, "challenge_full", "this challenge is full"));
    }
    let order: i64 = tx.query_row("SELECT COALESCE(MAX(join_order), -1) + 1 FROM members WHERE challenge_id = ?1", params![cid], |r| r.get(0))?;
    tx.execute(
        "INSERT INTO members (challenge_id, user_id, hero_class, join_order, joined_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![cid, u.id, b.hero_class, order, now],
    )?;
    tx.commit()?;
    Ok(Json(challenge_json(&db, &cid, &u.id)?))
}

async fn get_challenge(State(s): State<AppState>, u: AuthUser, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let db = s.db.lock().unwrap();
    if !is_member(&db, &id, &u.id)? {
        return Err(err(StatusCode::NOT_FOUND, "challenge_not_found", "challenge not found"));
    }
    let mut v = challenge_json(&db, &id, &u.id)?;
    v["now"] = json!(now_ms());
    Ok(Json(v))
}

#[derive(Deserialize)]
struct SeenBody {
    day: u32,
}

async fn put_seen(State(s): State<AppState>, u: AuthUser, Path(id): Path<String>, Json(b): Json<SeenBody>) -> ApiResult<Json<Value>> {
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    if !is_member(&tx, &id, &u.id)? {
        return Err(err(StatusCode::NOT_FOUND, "challenge_not_found", "challenge not found"));
    }
    let cfg: String = tx.query_row("SELECT config_json FROM challenges WHERE id = ?1", params![id], |r| r.get(0))?;
    let cfg: Value = serde_json::from_str(&cfg).unwrap_or(Value::Null);
    let cal = calendar::parse_config(&cfg).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "invalid_calendar", &e))?;
    if b.day > cal.days {
        return Err(err(StatusCode::BAD_REQUEST, "invalid_day", "invalid day"));
    }
    tx.execute("UPDATE members SET seen_day = MAX(seen_day, ?1) WHERE challenge_id = ?2 AND user_id = ?3", params![b.day as i64, id, u.id])?;
    let seen_day: i64 = tx.query_row("SELECT seen_day FROM members WHERE challenge_id = ?1 AND user_id = ?2", params![id, u.id], |r| r.get(0))?;
    tx.commit()?;
    Ok(Json(json!({ "seenDay": seen_day })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventBody {
    payload: Value,
    expected_seq: Option<i64>,
}

async fn put_event(
    State(s): State<AppState>,
    u: AuthUser,
    Path((id, day, kind)): Path<(String, u32, String)>,
    Json(b): Json<EventBody>,
) -> ApiResult<Json<Value>> {
    if !matches!(kind.as_str(), "checkin" | "orders" | "hash") {
        return Err(err(StatusCode::BAD_REQUEST, "invalid_event_kind", "invalid kind"));
    }
    let payload = b.payload.to_string();
    if payload.len() > MAX_PAYLOAD {
        return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "payload_too_large", "payload too large"));
    }
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    if !is_member(&tx, &id, &u.id)? {
        return Err(err(StatusCode::NOT_FOUND, "challenge_not_found", "challenge not found"));
    }
    let cfg: String = tx.query_row("SELECT config_json FROM challenges WHERE id = ?1", params![id], |r| r.get(0))?;
    let cfg: Value = serde_json::from_str(&cfg).unwrap_or(Value::Null);
    let cal = calendar::parse_config(&cfg).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "invalid_calendar", &e))?;
    let windows = calendar::day_windows(&cal);
    let w = windows.get(day.wrapping_sub(1) as usize).ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid_day", "invalid day"))?;
    let now = now_ms();
    if kind == "hash" {
        if now < w.dawn {
            return Err(err(StatusCode::CONFLICT, "day_not_resolved", "day not resolved yet"));
        }
    } else if now < w.open {
        return Err(err(StatusCode::CONFLICT, "day_not_started", "this day has not started yet"));
    } else if now >= w.dawn {
        return Err(err(StatusCode::CONFLICT, "day_closed", "this day is closed — Dawn has passed"));
    }
    if let Some(expected_seq) = b.expected_seq {
        let current_seq: i64 = tx
            .query_row("SELECT seq FROM events WHERE challenge_id = ?1 AND day = ?2 AND user_id = ?3 AND kind = ?4", params![id, day, u.id, kind], |r| r.get(0))
            .optional()?
            .unwrap_or(0);
        if current_seq != expected_seq {
            return Err(err_params(StatusCode::CONFLICT, "event_conflict", "updated on another device", json!({ "latestSeq": current_seq })));
        }
    }
    tx.execute("DELETE FROM events WHERE challenge_id = ?1 AND day = ?2 AND user_id = ?3 AND kind = ?4", params![id, day, u.id, kind])?;
    tx.execute(
        "INSERT INTO events (challenge_id, day, user_id, kind, payload_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, day, u.id, kind, payload, now],
    )?;
    let seq = tx.last_insert_rowid();
    tx.commit()?;
    Ok(Json(json!({ "seq": seq })))
}

#[derive(Deserialize)]
struct SinceQuery {
    since: Option<i64>,
    limit: Option<usize>,
}

async fn events(State(s): State<AppState>, u: AuthUser, Path(id): Path<String>, Query(q): Query<SinceQuery>) -> ApiResult<Json<Value>> {
    let since = q.since.unwrap_or(0).max(0);
    let limit = q.limit.unwrap_or(DEFAULT_EVENTS_LIMIT).clamp(1, MAX_EVENTS_LIMIT);
    let fetch_limit = (limit + 1) as i64;
    let mut list: Vec<Value> = {
        let db = s.db.lock().unwrap();
        if !is_member(&db, &id, &u.id)? {
            return Err(err(StatusCode::NOT_FOUND, "challenge_not_found", "challenge not found"));
        }
        let mut stmt = db.prepare(
            "SELECT seq, day, user_id, kind, payload_json, updated_at
             FROM events
             WHERE challenge_id = ?1 AND seq > ?2
             ORDER BY seq ASC
             LIMIT ?3",
        )?;
        let rows = stmt
            .query_map(params![id, since, fetch_limit], |r| {
                let payload: String = r.get(4)?;
                Ok(json!({
                    "seq": r.get::<_, i64>(0)?, "day": r.get::<_, i64>(1)?, "userId": r.get::<_, String>(2)?, "kind": r.get::<_, String>(3)?,
                    "payload": serde_json::from_str::<Value>(&payload).unwrap_or(Value::Null), "updatedAt": r.get::<_, i64>(5)?
                }))
            })?
            .collect::<Result<_, _>>()?;
        rows
    };
    let has_more = list.len() > limit;
    if has_more {
        list.truncate(limit);
    }
    let next_since = list.last().and_then(|e| e["seq"].as_i64());
    Ok(Json(json!({ "events": list, "now": now_ms(), "hasMore": has_more, "nextSince": next_since })))
}

// ---------- push ----------

async fn push_key(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    match &s.push {
        Some(p) => Ok(Json(json!({ "publicKey": p.public_key }))),
        None => Err(err(StatusCode::NOT_FOUND, "push_disabled", "push disabled")),
    }
}

#[derive(Deserialize)]
struct SubKeys {
    p256dh: String,
    auth: String,
}

#[derive(Deserialize)]
struct SubBody {
    endpoint: String,
    keys: SubKeys,
}

async fn push_subscribe(State(s): State<AppState>, ip: ClientIp, u: AuthUser, Json(b): Json<SubBody>) -> ApiResult<StatusCode> {
    let now = now_ms();
    s.limiter.check_ip(Scope::PushSubscribe, ip.bucket, RL_PUSH_SUB_IP, now)?;
    s.limiter.check_token(Scope::PushSubscribe, &u.id, RL_PUSH_SUB_TOKEN, now)?;
    if !validate_push_endpoint(&b.endpoint, &s.limiter.extra_push_hosts) {
        return Err(err(StatusCode::BAD_REQUEST, "invalid_endpoint", "invalid or disallowed push endpoint"));
    }
    let valid_key = |k: &str, max_len: usize| !k.is_empty() && k.len() <= max_len && k.bytes().all(|c| c.is_ascii_graphic());
    if !valid_key(&b.keys.p256dh, 200) || !valid_key(&b.keys.auth, 100) {
        return Err(err(StatusCode::BAD_REQUEST, "invalid_push_keys", "invalid push keys"));
    }
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(user_id, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at",
        params![u.id, b.endpoint, b.keys.p256dh, b.keys.auth, now],
    )?;
    tx.execute(
        "DELETE FROM push_subs
         WHERE user_id = ?1
           AND endpoint NOT IN (
             SELECT endpoint FROM push_subs
             WHERE user_id = ?1
             ORDER BY created_at DESC, endpoint DESC
             LIMIT ?2
           )",
        params![u.id, MAX_PUSH_SUBS_PER_USER],
    )?;
    tx.commit()?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct UnsubBody {
    endpoint: String,
}

async fn push_unsubscribe(State(s): State<AppState>, u: AuthUser, Json(b): Json<UnsubBody>) -> ApiResult<StatusCode> {
    s.db.lock().unwrap().execute("DELETE FROM push_subs WHERE endpoint = ?1 AND user_id = ?2", params![b.endpoint, u.id])?;
    Ok(StatusCode::NO_CONTENT)
}
