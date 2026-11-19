//! The Siege — minimal storage server: users, challenges, append-only day events, Web Push.
//! The game itself runs deterministically on the clients; the server only stores inputs and enforces deadlines.
mod api;
mod calendar;
mod db;
mod push;
mod scheduler;
mod security;

use axum::Router;
use std::{net::SocketAddr, sync::Arc};
use tower_http::services::{ServeDir, ServeFile};

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
        r = r.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)));
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
