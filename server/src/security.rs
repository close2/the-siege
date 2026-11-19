//! WAN abuse defenses: trusted `CF-Connecting-IP` extraction (/32 IPv4 & /64 IPv6),
//! bounded in-memory token-bucket rate limiters, failed-attempt lockouts, Web Push SSRF
//! host validation, and safe HTTP 4xx/5xx error logging.
use crate::{api::ApiError, AppState};
use axum::{
    body::Body,
    extract::{ConnectInfo, FromRequestParts},
    http::{header, request::Parts, HeaderMap, Request, Response, StatusCode, Uri},
};
use serde_json::json;
use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::Mutex,
    time::Duration,
};
use tower_http::trace::TraceLayer;

const MAX_IP_BUCKETS: usize = 100_000;
const MAX_TOKEN_BUCKETS: usize = 50_000;
const MAX_FAILURE_ENTRIES: usize = 100_000;

/// Canonical network bucket: IPv4 `/32` (including IPv4-mapped IPv6) or IPv6 `/64`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum IpBucket {
    V4([u8; 4]),
    V6([u16; 4]),
}

impl IpBucket {
    pub fn from_ip(ip: IpAddr) -> Self {
        match ip {
            IpAddr::V4(v4) => IpBucket::V4(v4.octets()),
            IpAddr::V6(v6) => {
                if let Some(v4) = v6.to_ipv4_mapped() {
                    IpBucket::V4(v4.octets())
                } else {
                    let s = v6.segments();
                    IpBucket::V6([s[0], s[1], s[2], s[3]])
                }
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ClientIp {
    pub ip: IpAddr,
    pub bucket: IpBucket,
}

fn is_private_proxy_peer(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private(),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                v4.is_loopback() || v4.is_private()
            } else {
                v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00
            }
        }
    }
}

/// Resolve client IP. `CF-Connecting-IP` is trusted when the immediate peer is loopback
/// (`cloudflared` on localhost, or `None` in unit-test `oneshot` calls), or when
/// `trust_private_proxy` is enabled for container-bridge `cloudflared` deployments.
pub fn resolve_client_ip(headers: &HeaderMap, peer: Option<SocketAddr>, trust_private_proxy: bool) -> ClientIp {
    let trust_cf = match peer {
        None => true,
        Some(addr) => addr.ip().is_loopback() || (trust_private_proxy && is_private_proxy_peer(addr.ip())),
    };
    let ip = if trust_cf {
        headers
            .get("cf-connecting-ip")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<IpAddr>().ok())
            .or_else(|| peer.map(|p| p.ip()))
            .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
    } else {
        peer.map(|p| p.ip()).unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
    };
    ClientIp { ip, bucket: IpBucket::from_ip(ip) }
}

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let peer = parts.extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0);
        Ok(resolve_client_ip(&parts.headers, peer, state.limiter.trust_private_proxy))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Scope {
    ApiGlobal,
    CreateUser,
    ClaimTransfer,
    MintTransfer,
    CreateChallenge,
    InviteLookup,
    PushSubscribe,
}

#[derive(Clone, Copy, Debug)]
struct Bucket {
    tokens: f64,
    last_ms: i64,
    /// Timestamp at which `tokens` refills completely to `burst` (safe to evict without state loss).
    full_at_ms: i64,
}

#[derive(Clone, Copy, Debug)]
struct FailureWindow {
    failures: u32,
    window_start_ms: i64,
    locked_until_ms: i64,
}

#[derive(Clone, Copy, Debug)]
pub struct RateSpec {
    pub burst: f64,
    /// Refill rate in tokens per millisecond.
    pub refill_per_ms: f64,
}

impl RateSpec {
    pub const fn per_window(burst: u32, count: u32, window_ms: i64) -> Self {
        Self { burst: burst as f64, refill_per_ms: (count as f64) / (window_ms as f64) }
    }
}

// Endpoint rate-limit specifications
pub const RL_API_GLOBAL_IP: RateSpec = RateSpec::per_window(150, 300, 60_000);
pub const RL_CREATE_USER_IP: RateSpec = RateSpec::per_window(10, 15, 3_600_000);
pub const RL_CLAIM_IP: RateSpec = RateSpec::per_window(10, 10, 15 * 60_000);
pub const RL_MINT_TRANSFER_TOKEN: RateSpec = RateSpec::per_window(5, 10, 15 * 60_000);
pub const RL_MINT_TRANSFER_IP: RateSpec = RateSpec::per_window(10, 20, 15 * 60_000);
pub const RL_CREATE_CHALLENGE_TOKEN: RateSpec = RateSpec::per_window(5, 10, 3_600_000);
pub const RL_CREATE_CHALLENGE_IP: RateSpec = RateSpec::per_window(10, 20, 3_600_000);
pub const RL_INVITE_IP: RateSpec = RateSpec::per_window(15, 30, 15 * 60_000);
pub const RL_INVITE_TOKEN: RateSpec = RateSpec::per_window(12, 25, 15 * 60_000);
pub const RL_PUSH_SUB_TOKEN: RateSpec = RateSpec::per_window(10, 20, 3_600_000);
pub const RL_PUSH_SUB_IP: RateSpec = RateSpec::per_window(15, 30, 3_600_000);

// Lockout specifications
const CLAIM_MAX_FAILURES: u32 = 5;
const CLAIM_WINDOW_MS: i64 = 15 * 60_000;
const CLAIM_LOCKOUT_MS: i64 = 15 * 60_000;

const INVITE_MAX_FAILURES: u32 = 10;
const INVITE_WINDOW_MS: i64 = 15 * 60_000;
const INVITE_LOCKOUT_MS: i64 = 15 * 60_000;

#[derive(Default)]
struct LimiterInner {
    ip_buckets: HashMap<(Scope, IpBucket), Bucket>,
    token_buckets: HashMap<(Scope, String), Bucket>,
    claim_failures: HashMap<IpBucket, FailureWindow>,
    invite_failures_ip: HashMap<IpBucket, FailureWindow>,
    invite_failures_user: HashMap<String, FailureWindow>,
}

pub struct RateLimiter {
    pub trust_private_proxy: bool,
    pub extra_push_hosts: Vec<String>,
    inner: Mutex<LimiterInner>,
}

impl RateLimiter {
    pub fn new(trust_private_proxy: bool) -> Self {
        Self { trust_private_proxy, extra_push_hosts: Vec::new(), inner: Mutex::new(LimiterInner::default()) }
    }

    pub fn from_env() -> Self {
        let trust = std::env::var("TRUST_PRIVATE_PROXY").map(|v| matches!(v.as_str(), "1" | "true" | "TRUE")).unwrap_or(false);
        let extra_push_hosts = std::env::var("PUSH_EXTRA_ALLOWED_HOSTS")
            .ok()
            .map(|raw| raw.split(',').map(|s| s.trim().trim_end_matches('.').to_ascii_lowercase()).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default();
        Self { trust_private_proxy: trust, extra_push_hosts, inner: Mutex::new(LimiterInner::default()) }
    }

    pub fn check_ip(&self, scope: Scope, ip: IpBucket, spec: RateSpec, now_ms: i64) -> Result<(), ApiError> {
        let mut g = self.inner.lock().unwrap();
        consume_bucket(&mut g.ip_buckets, (scope, ip), MAX_IP_BUCKETS, spec, now_ms)
    }

    pub fn check_token(&self, scope: Scope, user_id: &str, spec: RateSpec, now_ms: i64) -> Result<(), ApiError> {
        let mut g = self.inner.lock().unwrap();
        consume_bucket(&mut g.token_buckets, (scope, user_id.to_string()), MAX_TOKEN_BUCKETS, spec, now_ms)
    }

    pub fn check_claim_lockout(&self, ip: IpBucket, now_ms: i64) -> Result<(), ApiError> {
        let g = self.inner.lock().unwrap();
        check_failure_map(&g.claim_failures, &ip, now_ms)
    }

    pub fn record_claim_failure(&self, ip: IpBucket, now_ms: i64) {
        let mut g = self.inner.lock().unwrap();
        record_failure(&mut g.claim_failures, ip, now_ms, CLAIM_MAX_FAILURES, CLAIM_WINDOW_MS, CLAIM_LOCKOUT_MS);
    }

    pub fn check_invite_lockout(&self, ip: IpBucket, user_id: Option<&str>, now_ms: i64) -> Result<(), ApiError> {
        let g = self.inner.lock().unwrap();
        check_failure_map(&g.invite_failures_ip, &ip, now_ms)?;
        if let Some(uid) = user_id {
            check_failure_map(&g.invite_failures_user, uid, now_ms)?;
        }
        Ok(())
    }

    pub fn record_invite_failure(&self, ip: IpBucket, user_id: Option<&str>, now_ms: i64) {
        let mut g = self.inner.lock().unwrap();
        record_failure(&mut g.invite_failures_ip, ip, now_ms, INVITE_MAX_FAILURES, INVITE_WINDOW_MS, INVITE_LOCKOUT_MS);
        if let Some(uid) = user_id {
            record_failure(&mut g.invite_failures_user, uid.to_string(), now_ms, INVITE_MAX_FAILURES, INVITE_WINDOW_MS, INVITE_LOCKOUT_MS);
        }
    }

    pub fn prune(&self, now_ms: i64) {
        let mut g = self.inner.lock().unwrap();
        prune_buckets(&mut g.ip_buckets, now_ms);
        prune_buckets(&mut g.token_buckets, now_ms);
        prune_failure_map(&mut g.claim_failures, now_ms, CLAIM_WINDOW_MS);
        prune_failure_map(&mut g.invite_failures_ip, now_ms, INVITE_WINDOW_MS);
        prune_failure_map(&mut g.invite_failures_user, now_ms, INVITE_WINDOW_MS);
    }
}

fn consume_bucket<K: std::hash::Hash + Eq>(map: &mut HashMap<K, Bucket>, key: K, max_entries: usize, spec: RateSpec, now_ms: i64) -> Result<(), ApiError> {
    if !map.contains_key(&key) && map.len() >= max_entries {
        prune_buckets(map, now_ms);
        if map.len() >= max_entries {
            return Err(rate_limited_err(60));
        }
    }
    let b = map.entry(key).or_insert(Bucket { tokens: spec.burst, last_ms: now_ms, full_at_ms: now_ms });
    let elapsed = (now_ms - b.last_ms).max(0) as f64;
    b.tokens = (b.tokens + elapsed * spec.refill_per_ms).min(spec.burst);
    b.last_ms = now_ms;
    let res = if b.tokens >= 1.0 {
        b.tokens -= 1.0;
        Ok(())
    } else {
        let needed = 1.0 - b.tokens;
        let wait_ms = if spec.refill_per_ms > 0.0 { (needed / spec.refill_per_ms).ceil() as u64 } else { 60_000 };
        let retry_secs = wait_ms.div_ceil(1000).max(1);
        Err(rate_limited_err(retry_secs))
    };
    let deficit = (spec.burst - b.tokens).max(0.0);
    let refill_ms = if spec.refill_per_ms > 0.0 { (deficit / spec.refill_per_ms).ceil() as i64 } else { 60_000 };
    b.full_at_ms = now_ms.saturating_add(refill_ms);
    res
}

fn prune_buckets<K: std::hash::Hash + Eq>(map: &mut HashMap<K, Bucket>, now_ms: i64) {
    map.retain(|_, b| b.full_at_ms > now_ms);
}

fn check_failure_map<K, Q>(map: &HashMap<K, FailureWindow>, key: &Q, now_ms: i64) -> Result<(), ApiError>
where
    K: std::hash::Hash + Eq + std::borrow::Borrow<Q>,
    Q: std::hash::Hash + Eq + ?Sized,
{
    if let Some(fw) = map.get(key) {
        if fw.locked_until_ms > now_ms {
            let retry_secs = ((fw.locked_until_ms - now_ms) as u64).div_ceil(1000).max(1);
            return Err(rate_limited_err(retry_secs));
        }
    }
    Ok(())
}

fn record_failure<K: std::hash::Hash + Eq + Clone>(
    map: &mut HashMap<K, FailureWindow>,
    key: K,
    now_ms: i64,
    max_failures: u32,
    window_ms: i64,
    lockout_ms: i64,
) {
    if !map.contains_key(&key) && map.len() >= MAX_FAILURE_ENTRIES {
        prune_failure_map(map, now_ms, window_ms);
        if map.len() >= MAX_FAILURE_ENTRIES {
            // Evict one unlocked entry (or oldest entry) so brute-force tracking never fails open.
            if let Some(victim) = map.iter().find(|(_, fw)| fw.locked_until_ms <= now_ms).or_else(|| map.iter().next()).map(|(k, _)| k.clone()) {
                map.remove(&victim);
            }
        }
    }
    let entry = map.entry(key).or_insert(FailureWindow { failures: 0, window_start_ms: now_ms, locked_until_ms: 0 });
    let lockout_just_expired = entry.locked_until_ms > 0 && entry.locked_until_ms <= now_ms;
    let window_expired = entry.locked_until_ms <= now_ms && now_ms.saturating_sub(entry.window_start_ms) >= window_ms;
    if lockout_just_expired || window_expired {
        entry.failures = 0;
        entry.window_start_ms = now_ms;
        entry.locked_until_ms = 0;
    }
    entry.failures = entry.failures.saturating_add(1);
    if entry.failures >= max_failures {
        entry.locked_until_ms = now_ms.saturating_add(lockout_ms);
    }
}

fn prune_failure_map<K: std::hash::Hash + Eq>(map: &mut HashMap<K, FailureWindow>, now_ms: i64, window_ms: i64) {
    map.retain(|_, fw| fw.locked_until_ms > now_ms || now_ms.saturating_sub(fw.window_start_ms) < window_ms);
}

pub fn rate_limited_err(retry_after_secs: u64) -> ApiError {
    ApiError {
        status: StatusCode::TOO_MANY_REQUESTS,
        code: "rate_limited",
        message: "too many requests, please try again later".to_string(),
        params: Some(json!({ "retryAfter": retry_after_secs })),
        retry_after: Some(retry_after_secs),
    }
}

// ---------- Web Push Endpoint Allow-List (SSRF Defense) ----------

const EXACT_PUSH_HOSTS: &[&str] = &["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];

const SUFFIX_PUSH_HOSTS: &[&str] = &[".notify.windows.com", ".push.apple.com", ".push.services.mozilla.com"];

fn valid_dns_name(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 || host.starts_with('[') || host.parse::<IpAddr>().is_ok() {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    })
}

fn matches_host_rule(host: &str, rule: &str) -> bool {
    if let Some(suffix) = rule.strip_prefix("*.") {
        if !suffix.contains('.') || !valid_dns_name(suffix) {
            return false;
        }
        let dot_suffix = format!(".{suffix}");
        host.len() > dot_suffix.len() && host.ends_with(&dot_suffix)
    } else if let Some(suffix) = rule.strip_prefix('.') {
        if !suffix.contains('.') || !valid_dns_name(suffix) {
            return false;
        }
        host.len() > rule.len() && host.ends_with(rule)
    } else {
        valid_dns_name(rule) && host == rule
    }
}

/// Strictly validate a Web Push subscription endpoint using `http::Uri` (the exact parser
/// used by `HyperWebPushClient`) to eliminate parser differentials and SSRF vectors.
pub fn validate_push_endpoint(raw: &str, extra_hosts: &[String]) -> bool {
    if raw.is_empty() || raw.len() > 1000 || !raw.starts_with("https://") {
        return false;
    }
    if !raw.bytes().all(|b| b.is_ascii_graphic()) || raw.contains('@') || raw.contains('#') || raw.contains('\\') {
        return false;
    }
    let Ok(uri) = raw.parse::<Uri>() else {
        return false;
    };
    if uri.scheme_str() != Some("https") {
        return false;
    }
    let Some(authority) = uri.authority() else {
        return false;
    };
    if authority.port().is_some() || authority.as_str().contains('@') {
        return false;
    }
    if !uri.path().starts_with('/') || uri.path().len() <= 1 {
        return false;
    }
    let host = authority.host();
    if host.ends_with('.') || host.bytes().any(|b| b.is_ascii_uppercase()) || !valid_dns_name(host) {
        return false;
    }
    if EXACT_PUSH_HOSTS.contains(&host) {
        return true;
    }
    if SUFFIX_PUSH_HOSTS.iter().any(|s| host.len() > s.len() && host.ends_with(s)) {
        return true;
    }
    extra_hosts.iter().any(|rule| matches_host_rule(host, rule))
}

// ---------- Safe 4xx/5xx `tower_http` TraceLayer ----------

fn decode_percent_ascii(bytes: &[u8]) -> String {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = ((bytes[i + 1] as char).to_digit(16), (bytes[i + 2] as char).to_digit(16)) {
                out.push(((hi << 4) | lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Sanitize and redact secret-bearing path segments before logging.
/// - Normalizes `//`, `/./`, `/../`, `%XX`, and ASCII case before checking `/api/challenges/by-invite/*` and `/join/*`
/// - Retains only safe printable ASCII URI chars (blocking CRLF, ANSI escapes, and Unicode BiDi/RLO spoofing)
/// - Bounds path length to 128 bytes and omits query strings
pub fn sanitize_path(raw_path: &str) -> String {
    let bounded = &raw_path.as_bytes()[..raw_path.len().min(512)];
    let decoded = decode_percent_ascii(bounded);
    let mut resolved: Vec<&str> = Vec::new();
    for seg in decoded.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                resolved.pop();
            }
            s => resolved.push(s),
        }
    }
    if resolved.iter().any(|s| s.eq_ignore_ascii_case("by-invite")) {
        return "/api/challenges/by-invite/{code}".to_string();
    }
    if resolved.first().is_some_and(|s| s.eq_ignore_ascii_case("join")) {
        return "/join/{code}".to_string();
    }
    let mut out = String::with_capacity(raw_path.len().min(128));
    for b in bounded {
        if out.len() >= 128 {
            break;
        }
        if b.is_ascii_graphic() || *b == b'/' {
            out.push(*b as char);
        }
    }
    if out.is_empty() {
        "/".to_string()
    } else {
        out
    }
}

#[allow(clippy::type_complexity)]
pub fn http_trace_layer(
    trust_private_proxy: bool,
) -> TraceLayer<
    tower_http::classify::SharedClassifier<tower_http::classify::ServerErrorsAsFailures>,
    impl Fn(&Request<Body>) -> tracing::Span + Clone,
    (),
    impl Fn(&Response<Body>, Duration, &tracing::Span) + Clone,
    (),
    (),
    impl Fn(tower_http::classify::ServerErrorsFailureClass, Duration, &tracing::Span) + Clone,
> {
    TraceLayer::new_for_http()
        .make_span_with(move |req: &Request<Body>| {
            let peer = req.extensions().get::<ConnectInfo<SocketAddr>>().map(|c| c.0);
            let client = resolve_client_ip(req.headers(), peer, trust_private_proxy);
            let path = sanitize_path(req.uri().path());
            tracing::warn_span!(
                target: "tower_http::trace",
                "http",
                method = %req.method(),
                path = %path,
                ip = %client.ip,
            )
        })
        .on_request(())
        .on_response(|res: &Response<Body>, latency: Duration, span: &tracing::Span| {
            let status = res.status().as_u16();
            let ms = latency.as_millis();
            if status >= 500 {
                tracing::error!(target: "tower_http::trace", parent: span, status, latency_ms = ms, "server error");
            } else if status >= 400 {
                tracing::warn!(target: "tower_http::trace", parent: span, status, latency_ms = ms, "client error");
            } else {
                tracing::debug!(target: "tower_http::trace", parent: span, status, latency_ms = ms, "ok");
            }
        })
        .on_body_chunk(())
        .on_eos(())
        .on_failure(|failure: tower_http::classify::ServerErrorsFailureClass, latency: Duration, span: &tracing::Span| {
            if let tower_http::classify::ServerErrorsFailureClass::Error(err) = failure {
                tracing::error!(target: "tower_http::trace", parent: span, latency_ms = latency.as_millis(), error = %err, "transport failure");
            }
        })
}

pub fn apply_retry_after(mut res: Response<Body>, retry_after: Option<u64>) -> Response<Body> {
    if let Some(secs) = retry_after {
        if let Ok(val) = header::HeaderValue::from_str(&secs.to_string()) {
            res.headers_mut().insert(header::RETRY_AFTER, val);
        }
    }
    res
}
