//! The Siege — minimal storage server: users, challenges, append-only day events, Web Push.
//! The game itself runs deterministically on the clients; the server only stores inputs and enforces deadlines.
mod api;
mod calendar;
mod db;
mod push;
mod scheduler;
mod security;

use axum::{
    extract::Request,
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::Response,
    Router,
};
use std::{net::SocketAddr, sync::Arc};
use tower_http::services::{ServeDir, ServeFile};

const CACHE_NO_CACHE: &str = "no-cache, must-revalidate";
const CACHE_IMMUTABLE: &str = "public, max-age=31536000, immutable";
const CACHE_SHORT: &str = "public, max-age=86400";

fn has_version_query(query: Option<&str>) -> bool {
    query.is_some_and(|q| q.split('&').any(|pair| pair.strip_prefix("v=").is_some_and(|v| !v.is_empty())))
}

pub(crate) fn static_cache_control(path: &str, query: Option<&str>, content_type: Option<&str>) -> &'static str {
    if matches!(
        path,
        "/" | "/index.html" | "/sw.js" | "/registerSW.js" | "/push-sw.js" | "/manifest.webmanifest" | "/assets/assets.gen.json"
    ) || content_type.is_some_and(|ct| ct.starts_with("text/html"))
    {
        return CACHE_NO_CACHE;
    }
    let is_hashed_workbox = path.starts_with("/workbox-") && path.ends_with(".js");
    let is_hashed_asset = path.starts_with("/assets/")
        && (path.ends_with(".js")
            || path.ends_with(".css")
            || path.ends_with(".woff")
            || path.ends_with(".woff2")
            || (path.ends_with(".webp") && has_version_query(query)));
    if is_hashed_workbox || is_hashed_asset {
        CACHE_IMMUTABLE
    } else {
        CACHE_SHORT
    }
}

async fn static_cache_headers(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_owned();
    let query = req.uri().query().map(str::to_owned);
    let mut res = next.run(req).await;
    if matches!(res.status(), StatusCode::OK | StatusCode::NOT_MODIFIED) && !res.headers().contains_key(header::CACHE_CONTROL) {
        let ct = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_owned);
        let value = static_cache_control(&path, query.as_deref(), ct.as_deref());
        res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    }
    res
}

#[derive(Clone)]
pub struct AppState {
    pub db: db::Db,
    pub push: Option<Arc<push::Push>>,
    pub limiter: Arc<security::RateLimiter>,
}

pub fn app(state: AppState, static_dir: Option<&str>) -> Router {
    let trust_private_proxy = state.limiter.trust_private_proxy;
    let mut r = api::router(state.clone()).with_state(state);
    if let Some(dir) = static_dir {
        let index = format!("{dir}/index.html");
        let static_router = Router::new()
            .fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)))
            .layer(middleware::from_fn(static_cache_headers));
        r = r.fallback_service(static_router);
    }
    r.layer(security::http_trace_layer(trust_private_proxy))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info,tower_http=info".into())).init();
    let db_path = std::env::var("DB_PATH").unwrap_or_else(|_| "siege.db".into());
    let bind = std::env::var("BIND").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let static_dir = std::env::var("STATIC_DIR").ok();
    let vapid_path = std::env::var("VAPID_PRIVATE_KEY_PATH").unwrap_or_else(|_| "vapid_private.pem".into());
    let vapid_subject = std::env::var("VAPID_SUBJECT").unwrap_or_else(|_| "mailto:admin@example.com".into());

    let db = db::open(&db_path)?;
    let push = match push::Push::load_or_create(&vapid_path, vapid_subject) {
        Ok(p) => Some(Arc::new(p)),
        Err(e) => {
            tracing::warn!("push disabled: {e}");
            None
        }
    };
    let limiter = Arc::new(security::RateLimiter::from_env());
    let state = AppState { db, push, limiter };
    tokio::spawn(scheduler::run(state.clone()));
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("listening on http://{bind} (static: {static_dir:?}, db: {db_path})");
    axum::serve(listener, app(state, static_dir.as_deref()).into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
