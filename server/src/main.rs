//! The Siege — minimal storage server: users, challenges, append-only day events, Web Push.
//! The game itself runs deterministically on the clients; the server only stores inputs and enforces deadlines.
mod api;
mod calendar;
mod db;
mod push;
mod scheduler;

use axum::Router;
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};

#[derive(Clone)]
pub struct AppState {
    pub db: db::Db,
    pub push: Option<Arc<push::Push>>,
}

pub fn app(state: AppState, static_dir: Option<&str>) -> Router {
    let mut r = api::router().with_state(state);
    if let Some(dir) = static_dir {
        let index = format!("{dir}/index.html");
        r = r.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)));
    }
    r.layer(tower_http::trace::TraceLayer::new_for_http())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info,tower_http=warn".into())).init();
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
    let state = AppState { db, push };
    tokio::spawn(scheduler::run(state.clone()));
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("listening on http://{bind} (static: {static_dir:?}, db: {db_path})");
    axum::serve(listener, app(state, static_dir.as_deref())).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
