# The Siege v2

A cooperative 2D habit-challenge base-defense PWA. Every player guards a sector of the valley; daily check-ins earn gold and send your hero to the road, while orders placed during the day build and upgrade towers before the nightly assault at **Dawn**.

- **Deterministic client simulation (`client/src/sim/`)**: 20 Hz tick engine (`sfc32` PRNG, restricted float math — only `+ - * / sqrt floor min max`, no trig/`Date`/`Math.random` — and canonical FNV-1a state hashing). Every client replays the season from the shared append-only event log and verifies state hashes after Dawn.
- **2D PixiJS v8 renderer (`client/src/render/`)**: Painted 2048×2048 valley map, depth-sorted sprites, procedural squash/stretch/lunge animations, pooled particle VFX, and synthesized WebAudio SFX.
- **Minimal Rust backend (`server/`)**: Single binary (`axum` + bundled `rusqlite` in WAL mode + `web-push` VAPID) that stores users, challenges, and day events, enforces timezone-aware day windows, and sends evening/Dawn Web Push notifications. Zero external services required.

---

## Directory Layout

- `art/` — `manifest.json` and raw 2D artwork (`art/raw/*.png`).
- `tools/` — Art pipeline (`process_art.py`) and map generator/overlay utilities.
- `client/` — Vite + React 18 + TypeScript + PixiJS v8 PWA.
- `server/` — Rust (`axum` + `rusqlite` + `web-push`) storage and notification server.
- `deploy/` — `siege.service` (systemd), `Caddyfile`, and `backup.sh`.
- `docs/` — Game design (`design.md`), architecture plan (`plan.md`), art spec (`art-list.md`), tasks (`tasks.md`), and shared calendar test vectors (`calendar-vectors.json`).

---

## Development & Testing

### 1. Process Artwork
Requires Python 3 with `Pillow` and `numpy`:
```bash
python3 tools/process_art.py
```
Outputs transparent `@2x` WebP sprites and `assets.gen.json` into `client/public/assets/`, plus `icon-192.png` and `icon-512.png` in `client/public/`.

### 2. Client (Dev Server, Tests, Production Build)
```bash
cd client
npm install
npm test          # Vitest unit + determinism + calendar vector tests
npm run dev       # Vite dev server (use ?backend=local for offline bot mode)
npm run build     # TypeScript check + Vite PWA production bundle in client/dist/
```

Developer routes (available in dev and build):
- `/?backend=local` — Full game in offline IndexedDB mode with bot teammates and a "Skip to next Dawn" demo button.
- `/dev/sandbox` — Battle sandbox. URL params: `p` (players 2–8), `day`, `days` (7–90), `q` (bot hit rate 0–1), `diff` (`very_easy|easy|normal|hard`), `seed`, `ff` (fast-forward ticks), `x`/`y`/`z` (camera), e.g. `?p=4&day=14&diff=normal&q=0.8&ff=240`.
- `/dev/gallery` — Every manifest id on checkerboard and dark backgrounds; missing art highlighted in red.
- `/dev/map-editor` — Drag keep, road points, pads, rally and hero-spawn points; add/delete road points; export/import `valley.json`.
- `/dev/vfx` — One button per particle effect.

Dev tools are lazy-loaded chunks, so they don't add to the player bundle.

### Tests that guard cross-implementation contracts
- `docs/calendar-vectors.json` is the contract between `client/src/sim/calendar.ts` and `server/src/calendar.rs`. Both test suites check against it. Regenerate it only on purpose: `UPDATE_VECTORS=1 npx vitest run src/sim/__tests__/calendar.test.ts`, then run `cargo test`.
- The golden season hash in `season.test.ts` changes whenever the rules or stats change. Update it deliberately and bump `SIM_VERSION` (in `content/stats.ts` and `server/src/api.rs`) if running seasons would be affected.
- Balance report (200 bot seasons): `BALANCE=1 npx vitest run src/sim/__tests__/season.test.ts`.

### Themes
Enemy themes live in `client/src/content/themes.ts`. Only themes with `ready: true` (currently `sugar`) can be chosen; the server mirrors this list in `THEMES` (`server/src/api.rs`). To ship `sloth`, `doom` or `ember`, deliver its art (`enemy_<theme>_<role>`, `boss_<theme>`, `portrait_boss_<theme>`, see `docs/art-list.md`), add the ids to `art/manifest.json`, run `tools/process_art.py`, then flip `ready` and add the id on the server.

### 3. Server (Tests & Run)
```bash
cd server
cargo test
STATIC_DIR=../client/dist BIND=127.0.0.1:8080 cargo run --release
```

Environment variables:
| Variable | Default | Description |
|---|---|---|
| `BIND` | `127.0.0.1:8080` | Listen address |
| `DB_PATH` | `siege.db` | SQLite database file path |
| `STATIC_DIR` | *(none)* | Path to built `client/dist` directory (enables SPA fallback) |
| `VAPID_PRIVATE_KEY_PATH` | `vapid_private.pem` | EC P-256 PEM file (auto-generated on first start if missing) |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Contact URI for Web Push VAPID claims |

---

## Production Deployment

1. Build the client and server:
   ```bash
   (cd client && npm ci && npm run build)
   (cd server && cargo build --release)
   ```
2. Copy files to `/opt/siege`:
   ```bash
   sudo useradd --system --home /var/lib/siege --create-home siege
   sudo mkdir -p /opt/siege
   sudo cp server/target/release/siege-server /opt/siege/
   sudo cp -r client/dist /opt/siege/client
   ```
3. Install and enable the systemd unit (`deploy/siege.service`), configure HTTPS reverse proxy (`deploy/Caddyfile`), and install the daily hot backup script (`deploy/backup.sh` → `/etc/cron.daily/siege-backup`).

---

## License

Copyright 2026 Christian Loitsch

Licensed under the [Apache License, Version 2.0](LICENSE). This covers the code as well as the artwork in `art/` and `client/public/`.
