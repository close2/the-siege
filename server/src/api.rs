//! HTTP API. See docs/tasks.md (M4) for the contract.
use crate::{calendar, AppState};
use axum::{
    extract::{FromRequestParts, Path, Query, State},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
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
/// Themes whose art is complete (mirror of `ready` in client/src/content/themes.ts).
const THEMES: &[&str] = &["sugar"];
const CODE_CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

pub struct ApiError(pub StatusCode, pub String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        tracing::error!("db error: {e}");
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, "database error".into())
    }
}

type ApiResult<T> = Result<T, ApiError>;

fn err(code: StatusCode, msg: &str) -> ApiError {
    ApiError(code, msg.to_string())
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
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let header = parts.headers.get("authorization").and_then(|h| h.to_str().ok()).unwrap_or("");
        let token = header.strip_prefix("Bearer ").ok_or_else(|| err(StatusCode::UNAUTHORIZED, "missing token"))?;
        let db = state.db.lock().unwrap();
        let row = db
            .query_row(
                "SELECT u.id, u.name FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?1",
                params![hash_token(token)],
                |r| Ok(AuthUser { id: r.get(0)?, name: r.get(1)? }),
            )
            .optional()?;
        row.ok_or_else(|| err(StatusCode::UNAUTHORIZED, "invalid token"))
    }
}

fn issue_token(db: &rusqlite::Connection, user_id: &str) -> ApiResult<String> {
    let token = {
        let mut b = [0u8; 32];
        rand::thread_rng().fill(&mut b);
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, b)
    };
    db.execute("INSERT INTO tokens (token_hash, user_id, created_at) VALUES (?1, ?2, ?3)", params![hash_token(&token), user_id, now_ms()])?;
    Ok(token)
}

fn clean_name(n: &str) -> ApiResult<String> {
    let n = n.trim();
    if n.chars().count() < 2 || n.chars().count() > 24 {
        return Err(err(StatusCode::BAD_REQUEST, "name must be 2–24 characters"));
    }
    Ok(n.to_string())
}

// ---------- router ----------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/time", get(time))
        .route("/api/users", post(create_user))
        .route("/api/users/claim", post(claim))
        .route("/api/me", get(me).put(rename))
        .route("/api/me/transfer-code", post(transfer_code))
        .route("/api/challenges", get(list_challenges).post(create_challenge))
        .route("/api/challenges/by-invite/{code}", get(by_invite))
        .route("/api/challenges/join", post(join))
        .route("/api/challenges/{id}", get(get_challenge))
        .route("/api/challenges/{id}/days/{day}/{kind}", put(put_event))
        .route("/api/challenges/{id}/events", get(events))
        .route("/api/push/key", get(push_key))
        .route("/api/push/subscribe", post(push_subscribe).delete(push_unsubscribe))
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

async fn time() -> Json<Value> {
    Json(json!({ "now": now_ms() }))
}

#[derive(Deserialize)]
struct NameBody {
    name: String,
}

async fn create_user(State(s): State<AppState>, Json(b): Json<NameBody>) -> ApiResult<Json<Value>> {
    let name = clean_name(&b.name)?;
    let id = format!("u{}", random_hex(8));
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    tx.execute("INSERT INTO users (id, name, created_at) VALUES (?1, ?2, ?3)", params![id, name, now_ms()])?;
    let token = issue_token(&tx, &id)?;
    tx.commit()?;
    Ok(Json(json!({ "userId": id, "token": token })))
}

async fn me(u: AuthUser) -> Json<Value> {
    Json(json!({ "id": u.id, "name": u.name }))
}

async fn rename(State(s): State<AppState>, u: AuthUser, Json(b): Json<NameBody>) -> ApiResult<StatusCode> {
    let name = clean_name(&b.name)?;
    s.db.lock().unwrap().execute("UPDATE users SET name = ?1 WHERE id = ?2", params![name, u.id])?;
    Ok(StatusCode::NO_CONTENT)
}

async fn transfer_code(State(s): State<AppState>, u: AuthUser) -> ApiResult<Json<Value>> {
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    tx.execute("DELETE FROM transfer_codes WHERE expires_at < ?1 OR user_id = ?2", params![now_ms(), u.id])?;
    let code = random_code(6);
    let expires = now_ms() + 10 * 60 * 1000;
    tx.execute("INSERT INTO transfer_codes (code, user_id, expires_at) VALUES (?1, ?2, ?3)", params![code, u.id, expires])?;
    tx.commit()?;
    Ok(Json(json!({ "code": code, "expiresAt": expires })))
}

#[derive(Deserialize)]
struct CodeBody {
    code: String,
}

async fn claim(State(s): State<AppState>, Json(b): Json<CodeBody>) -> ApiResult<Json<Value>> {
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    let code = b.code.trim().to_uppercase();
    let row: Option<(String, String)> = tx
        .query_row(
            "SELECT t.user_id, u.name FROM transfer_codes t JOIN users u ON u.id = t.user_id WHERE t.code = ?1 AND t.expires_at >= ?2",
            params![code, now_ms()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (user_id, name) = row.ok_or_else(|| err(StatusCode::NOT_FOUND, "code invalid or expired"))?;
    tx.execute("DELETE FROM transfer_codes WHERE code = ?1", params![code])?;
    let token = issue_token(&tx, &user_id)?;
    tx.commit()?;
    Ok(Json(json!({ "userId": user_id, "token": token, "name": name })))
}

// ---------- challenges ----------

fn validate_config(c: &Value, now: i64) -> ApiResult<calendar::CalConfig> {
    let bad = |m: &str| err(StatusCode::BAD_REQUEST, m);
    let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if title.chars().count() < 2 || title.chars().count() > 60 {
        return Err(bad("title must be 2–60 characters"));
    }
    let typ = c.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let rules = c.get("rules").and_then(|v| v.as_array()).ok_or_else(|| bad("rules missing"))?;
    if rules.iter().any(|r| r.as_str().map(|s| s.trim().is_empty() || s.len() > 120).unwrap_or(true)) {
        return Err(bad("invalid rule text"));
    }
    match typ {
        "binary" if rules.len() == 1 => {}
        "checklist" if (2..=8).contains(&rules.len()) => {}
        "numeric" if rules.is_empty() => {
            let t = c.get("target").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if t <= 0.0 || !t.is_finite() {
                return Err(bad("target must be > 0"));
            }
            match c.get("direction").and_then(|v| v.as_str()) {
                Some("higher") | Some("lower") => {}
                _ => return Err(bad("direction must be higher or lower")),
            }
        }
        _ => return Err(bad("invalid type / rules")),
    }
    match c.get("difficulty").and_then(|v| v.as_str()) {
        Some("very_easy") | Some("easy") | Some("normal") | Some("hard") => {}
        _ => return Err(bad("invalid difficulty")),
    }
    if !c.get("theme").and_then(|v| v.as_str()).is_some_and(|t| THEMES.contains(&t)) {
        return Err(bad("invalid theme"));
    }
    let cal = calendar::parse_config(c).map_err(|e| bad(&e))?;
    if !(7..=90).contains(&cal.days) {
        return Err(bad("days must be 7–90"));
    }
    if cal.inactive.len() > 90 {
        return Err(bad("too many inactive dates"));
    }
    let today = calendar::local_date(now, cal.tz);
    if cal.start_date < today {
        return Err(bad("start date is in the past"));
    }
    Ok(cal)
}

fn challenge_json(db: &rusqlite::Connection, id: &str) -> ApiResult<Value> {
    let row = db
        .query_row(
            "SELECT config_json, seed, sim_version, invite_code, creator FROM challenges WHERE id = ?1",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?)),
        )
        .optional()?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "challenge not found"))?;
    let mut stmt = db.prepare("SELECT m.user_id, u.name, m.hero_class, m.join_order FROM members m JOIN users u ON u.id = m.user_id WHERE m.challenge_id = ?1 ORDER BY m.join_order")?;
    let members: Vec<Value> = stmt
        .query_map(params![id], |r| {
            Ok(json!({ "userId": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "heroClass": r.get::<_, String>(2)?, "joinOrder": r.get::<_, i64>(3)? }))
        })?
        .collect::<Result<_, _>>()?;
    let config: Value = serde_json::from_str(&row.0).unwrap_or(Value::Null);
    Ok(json!({ "id": id, "config": config, "seed": row.1, "simVersion": row.2, "inviteCode": row.3, "creatorId": row.4, "members": members }))
}

fn is_member(db: &rusqlite::Connection, cid: &str, uid: &str) -> ApiResult<bool> {
    Ok(db.query_row("SELECT 1 FROM members WHERE challenge_id = ?1 AND user_id = ?2", params![cid, uid], |_| Ok(())).optional()?.is_some())
}

fn valid_hero(h: &str) -> ApiResult<()> {
    match h {
        "knight" | "ranger" | "priest" => Ok(()),
        _ => Err(err(StatusCode::BAD_REQUEST, "invalid hero class")),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody {
    config: Value,
    hero_class: String,
}

async fn create_challenge(State(s): State<AppState>, u: AuthUser, Json(b): Json<CreateBody>) -> ApiResult<Json<Value>> {
    validate_config(&b.config, now_ms())?;
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
        params![id, u.id, b.config.to_string(), code, random_hex(8), SIM_VERSION, now_ms()],
    )?;
    tx.execute(
        "INSERT INTO members (challenge_id, user_id, hero_class, join_order, joined_at) VALUES (?1, ?2, ?3, 0, ?4)",
        params![id, u.id, b.hero_class, now_ms()],
    )?;
    tx.commit()?;
    Ok(Json(challenge_json(&db, &id)?))
}

async fn list_challenges(State(s): State<AppState>, u: AuthUser) -> ApiResult<Json<Value>> {
    let db = s.db.lock().unwrap();
    let ids: Vec<String> = db
        .prepare("SELECT c.id FROM challenges c JOIN members m ON m.challenge_id = c.id WHERE m.user_id = ?1 ORDER BY c.created_at DESC")?
        .query_map(params![u.id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let list: Vec<Value> = ids.iter().map(|id| challenge_json(&db, id)).collect::<Result<_, _>>()?;
    Ok(Json(Value::Array(list)))
}

fn started(config: &Value, now: i64) -> bool {
    calendar::parse_config(config).ok().and_then(|c| calendar::day_windows(&c).first().map(|w| now >= w.open)).unwrap_or(true)
}

async fn by_invite(State(s): State<AppState>, Path(code): Path<String>) -> ApiResult<Json<Value>> {
    let db = s.db.lock().unwrap();
    let row = db
        .query_row(
            "SELECT c.id, c.config_json, u.name, (SELECT COUNT(*) FROM members m WHERE m.challenge_id = c.id) FROM challenges c JOIN users u ON u.id = c.creator WHERE c.invite_code = ?1",
            params![code.to_uppercase()],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?)),
        )
        .optional()?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "invite code not found"))?;
    let config: Value = serde_json::from_str(&row.1).unwrap_or(Value::Null);
    let joinable = !started(&config, now_ms()) && row.3 < MAX_MEMBERS;
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

async fn join(State(s): State<AppState>, u: AuthUser, Json(b): Json<JoinBody>) -> ApiResult<Json<Value>> {
    valid_hero(&b.hero_class)?;
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    let (cid, cfg): (String, String) = tx
        .query_row("SELECT id, config_json FROM challenges WHERE invite_code = ?1", params![b.invite_code.to_uppercase()], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "invite code not found"))?;
    if is_member(&tx, &cid, &u.id)? {
        return Ok(Json(challenge_json(&tx, &cid)?));
    }
    let config: Value = serde_json::from_str(&cfg).unwrap_or(Value::Null);
    if started(&config, now_ms()) {
        return Err(err(StatusCode::CONFLICT, "the season has already started"));
    }
    let count: i64 = tx.query_row("SELECT COUNT(*) FROM members WHERE challenge_id = ?1", params![cid], |r| r.get(0))?;
    if count >= MAX_MEMBERS {
        return Err(err(StatusCode::CONFLICT, "this challenge is full"));
    }
    let order: i64 = tx.query_row("SELECT COALESCE(MAX(join_order), -1) + 1 FROM members WHERE challenge_id = ?1", params![cid], |r| r.get(0))?;
    tx.execute(
        "INSERT INTO members (challenge_id, user_id, hero_class, join_order, joined_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![cid, u.id, b.hero_class, order, now_ms()],
    )?;
    tx.commit()?;
    Ok(Json(challenge_json(&db, &cid)?))
}

async fn get_challenge(State(s): State<AppState>, u: AuthUser, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let db = s.db.lock().unwrap();
    if !is_member(&db, &id, &u.id)? {
        return Err(err(StatusCode::NOT_FOUND, "challenge not found"));
    }
    let mut v = challenge_json(&db, &id)?;
    v["now"] = json!(now_ms());
    Ok(Json(v))
}

#[derive(Deserialize)]
struct EventBody {
    payload: Value,
}

async fn put_event(State(s): State<AppState>, u: AuthUser, Path((id, day, kind)): Path<(String, u32, String)>, Json(b): Json<EventBody>) -> ApiResult<Json<Value>> {
    if !matches!(kind.as_str(), "checkin" | "orders" | "hash") {
        return Err(err(StatusCode::BAD_REQUEST, "invalid kind"));
    }
    let payload = b.payload.to_string();
    if payload.len() > MAX_PAYLOAD {
        return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "payload too large"));
    }
    let db = s.db.lock().unwrap();
    let tx = db.unchecked_transaction()?;
    if !is_member(&tx, &id, &u.id)? {
        return Err(err(StatusCode::NOT_FOUND, "challenge not found"));
    }
    let cfg: String = tx.query_row("SELECT config_json FROM challenges WHERE id = ?1", params![id], |r| r.get(0))?;
    let cfg: Value = serde_json::from_str(&cfg).unwrap_or(Value::Null);
    let cal = calendar::parse_config(&cfg).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
    let windows = calendar::day_windows(&cal);
    let w = windows.get(day.wrapping_sub(1) as usize).ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid day"))?;
    let now = now_ms();
    if kind == "hash" {
        if now < w.dawn {
            return Err(err(StatusCode::CONFLICT, "day not resolved yet"));
        }
    } else if now < w.open {
        return Err(err(StatusCode::CONFLICT, "this day has not started yet"));
    } else if now >= w.dawn {
        return Err(err(StatusCode::CONFLICT, "this day is closed — Dawn has passed"));
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
}

async fn events(State(s): State<AppState>, u: AuthUser, Path(id): Path<String>, Query(q): Query<SinceQuery>) -> ApiResult<Json<Value>> {
    let db = s.db.lock().unwrap();
    if !is_member(&db, &id, &u.id)? {
        return Err(err(StatusCode::NOT_FOUND, "challenge not found"));
    }
    let mut stmt = db.prepare("SELECT seq, day, user_id, kind, payload_json, updated_at FROM events WHERE challenge_id = ?1 AND seq > ?2 ORDER BY seq")?;
    let list: Vec<Value> = stmt
        .query_map(params![id, q.since.unwrap_or(0)], |r| {
            let payload: String = r.get(4)?;
            Ok(json!({
                "seq": r.get::<_, i64>(0)?, "day": r.get::<_, i64>(1)?, "userId": r.get::<_, String>(2)?, "kind": r.get::<_, String>(3)?,
                "payload": serde_json::from_str::<Value>(&payload).unwrap_or(Value::Null), "updatedAt": r.get::<_, i64>(5)?
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(Json(json!({ "events": list, "now": now_ms() })))
}

// ---------- push ----------

async fn push_key(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    match &s.push {
        Some(p) => Ok(Json(json!({ "publicKey": p.public_key }))),
        None => Err(err(StatusCode::NOT_FOUND, "push disabled")),
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

async fn push_subscribe(State(s): State<AppState>, u: AuthUser, Json(b): Json<SubBody>) -> ApiResult<StatusCode> {
    if !b.endpoint.starts_with("https://") || b.endpoint.len() > 1000 {
        return Err(err(StatusCode::BAD_REQUEST, "invalid endpoint"));
    }
    s.db.lock().unwrap().execute(
        "INSERT OR REPLACE INTO push_subs (endpoint, user_id, p256dh, auth) VALUES (?1, ?2, ?3, ?4)",
        params![b.endpoint, u.id, b.keys.p256dh, b.keys.auth],
    )?;
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
