# Tasks: The Siege v2

**Status:** All milestones M1–M7 complete (2026-11-06).

**Legend:**
- **[S]** = strong model (architecture or tricky logic).
- **[B]** = basic LLM. Each [B] task is self-contained: do exactly what it says, change only the listed files, and finish with the acceptance check.

Every task ends with: `npm run build && npm test` (client) or `cargo test` (server) passing.

**Rules for every implementer:**
- Read `docs/design.md` sections referenced by the task.
- Never use `Math.random`, `Date` or trig functions in `client/src/sim/`.
- All numbers come from `client/src/content/stats.ts`. Never hard-code them elsewhere.
- Don't add dependencies unless the task names them.

---

## M1: Sim core and sandbox

| id | who | deps | task |
|---|---|---|---|
| ✅ T1.1 | B | – | **Scaffold client.** `v2/client`: Vite + React 18 + TS strict + vitest + `pixi.js@^8` + `pixi-viewport`. Folders as in the plan §3. `App.tsx` renders "The Siege v2". **Accept:** `npm run dev` shows the text, and `npm test` runs one dummy test. |
| ✅ T1.2 | B | T1.1 | **Copy docs.** Copy the four plan documents into `v2/docs/` (design.md, art-list.md, plan.md, tasks.md). |
| ✅ T1.3 | S | T1.1 | **sim/types.ts + rng.ts + content/stats.ts.** Types from design §11. PRNG: sfc32 on uint32 with `nextInt(n)` and `nextFloat()`. All stat tables from design §3–§9. |
| ✅ T1.4 | B | T1.3 | **sim/economy.ts.** `ratio(config, checkin)` and `dayGold(config, r, sectorsPerPlayer)`, plus hero status, XP, Rally and dormancy exactly as in design §3. **Accept:** tests covering every row of the gold table, the numeric "lower is better" case including value 0, and *m* clamping for D = 7 / 30 / 90. |
| ✅ T1.5 | S | T1.3 | **sim/map.ts + sector assignment** (design §2). Load the map JSON and implement `assignSectors(players)`. Write a placeholder `content/maps/valley.json` with simple straight roads. |
| ✅ T1.6 | S | T1.4, T1.5 | **sim/orders.ts**: apply orders with validation (design §4). Skipped orders are recorded with a reason. **Accept:** tests for each order type, insufficient gold, a foreign pad, and Keep level-ups. |
| ✅ T1.7 | S | T1.5 | **sim/waves.ts**: intent generation (design §8). Same seed and day must give an identical intent. |
| ✅ T1.8 | S | T1.3, T1.5 | **sim/battle.ts**: tick sim (design §9). `createBattle(setup)`, `step(): TickFrame`, `runToEnd()`. |
| ✅ T1.9 | S | T1.6–T1.8 | **sim/season.ts**: `resolveDay` and `replaySeason(config, inputsByDay)`, plus `hash.ts` (FNV-1a over canonical JSON). **Accept:** a determinism test (run twice → same hashes) and a 30-day golden-hash snapshot test. |
| ✅ T1.10 | B | T1.8 | **sim/bot.ts**: bot player. The check-in hits with probability *q* (seeded). Orders: build the cheapest tower that counters the featured role (armour → mage, flying → archer or mage, otherwise archer or barracks), else upgrade, else repair. **Accept:** a 30-day bot season ends with Keep HP > 0 on normal for 4 bots with *q* = 0.8 (if not, report the numbers; don't change stats). |
| ✅ T1.11 | S | T1.8 | **render/ core:** `GameView` (Pixi Application plus pixi-viewport, pinch and drag), depth sorting by y, `PlaceholderTextures` (a coloured circle or rectangle with the id label per asset id), `ReplayPlayer` (steps the sim, interpolates frames, speed 1/2/4, skip, restart). |
| ✅ T1.12 | S | T1.11 | **render/UnitSprite + BuildingSprite + procedural animation:** walk bob and squash, mirroring by movement direction, attack lunge or pose swap, hit flash, death fade, flyer hover, build pop, ellipse shadows, health bars. |
| ✅ T1.13 | B | T1.11 | **render/Vfx.ts:** particle helpers drawn with Pixi `Graphics`-generated textures: `sparks(x, y)`, `dust(x, y)`, `smoke(emitterOn: building)`, `fire(...)`, `magicBolt(from, to, t)`, `healGlow(x, y)`, `coinBurst(x, y)`, `floatingText(x, y, text, color)`. Use a simple pooled particle array; no extra libraries. **Accept:** `/dev/vfx` route has a button per effect. |
| ✅ T1.14 | B | T1.11, T1.12 | **dev/Sandbox.tsx** (route `/dev/sandbox`): a bot-driven season up to day N (players, day, D, hit rate, difficulty, seed), then the battle with ReplayPlayer (1/2/4×, pause, skip). URL params for headless screenshots: `?ff=<ticks>&x=&y=&z=`. |

## M2: Art pipeline (parallel with M1; also see art_list.md)

| id | who | deps | task |
|---|---|---|---|
| ✅ T2.1 | B | – | **art/manifest.json:** one entry per id in art-list.md: `{ id, kind: "sprite"\|"background"\|"ui9"\|"icon", targetHeight, anchor: "bottom"\|"center", slice?: [l, t, r, b] }`. Sizes come from the art list. Anchor is bottom for buildings, units and keep, and center otherwise. |
| ✅ T2.2 | B | T2.1 | **tools/process-art.mjs** (dependency: `sharp`). For each `art/raw/<id>.png` (or `<id>_g.png`): <br>1. Detect the key colour as the median colour of the outer 8 px border of the image (the generated backgrounds are never exactly #FF00FF, e.g. (251, 35, 248)). The `_g` filename suffix is just a hint and needs no special handling. <br>2. Set alpha = 0 for pixels within RGB distance ≤ 60 of the key colour. Feather the edge 60–120 linearly. <br>3. Despill on semi-transparent pixels: if the key is magenta-ish (R and B > G), clamp R and B to ≤ G + 40; if green-ish, clamp G to ≤ max(R, B) + 40. <br>4. Trim transparent borders and add 4 px padding. <br>5. Resize to `targetHeight` ×2 (the @2x asset). <br>6. Write `client/public/assets/<id>.webp` (quality 90). <br>7. Write `client/public/assets/assets.gen.json` (the renderer fetches it at runtime) with {id: {w, h, anchorX, anchorY}}. <br>Backgrounds skip steps 2–4. Missing raw files are listed as warnings. **Accept:** run on a test PNG with a magenta background → a transparent WebP, with no pink fringe visible on a dark background. |
| ✅ T2.3 | B | T2.2, T1.11 | **dev/Gallery.tsx** (`/dev/gallery`): shows every manifest id on a checkerboard and on a dark background with its size. Missing ones show the placeholder in red. |
| ✅ T2.4 | S | T2.2 | **Texture loading:** `render/assets.ts` loads `assets.gen.json` and falls back to placeholders per id, so the art can arrive in any order. |
| ✅ T2.5 | B | T1.11 | **dev/MapEditor.tsx** (`/dev/map-editor`): shows `map_valley`. Modes: place the keep, draw road polylines (click points, Enter to finish, one road per direction N/E/S/W), place 4 pads per sector (sectors listed in a sidebar), place the rally point and hero spawn per sector. Points can be dragged; Delete removes the selected point. Export or import as JSON in the format of `content/maps/valley.json` (copy to clipboard and download). |

## M3: Local vertical slice

| id | who | deps | task |
|---|---|---|---|
| ✅ T3.1 | S | T1.9 | **net/Backend.ts** interface plus **LocalBackend** (IndexedDB via the small `idb` package): users, challenges, events, `serverTime()` with a debug time offset (a "skip to Dawn" button for testing). Bot teammates' inputs are written automatically. |
| ✅ T3.2 | S | T3.1 | **state/useSeason.ts:** loads events, runs `replaySeason`, caches per-day results in memory, and exposes current state, today's intent, open day(s), and the battle setup for the last Dawn. |
| ✅ T3.3 | B | T3.2 | **ui/Onboarding.tsx** (name input), **ui/ChallengeList.tsx**, **ui/CreateChallenge.tsx**: a form with every config field from design §1 (as a 3-step wizard) and validation (D 7–90, at least 2 checklist rules, target > 0). Styling: CSS modules using `ui_panel` / `ui_button` as `border-image` (9-slice). |
| ✅ T3.4 | S | T3.2, T1.12 | **ui/ChallengeHome.tsx:** full-screen GameView with the current valley state, plus a HUD (gold, Keep HP, day X/D, stars, team avatars with a checked-in tick). Tapping a pad opens BuildSheet; tapping an intent arrow opens IntentPanel. |
| ✅ T3.5 | B | T3.4 | **ui/CheckInSheet.tsx:** a bottom sheet. Binary: Kept / Not kept. Checklist: one toggle per rule plus "all kept". Numeric: a number input with the unit. After saving, show the gold earned using the `economy.ts` functions. It can be edited until Dawn (show a countdown). |
| ✅ T3.6 | B | T3.4 | **ui/BuildSheet.tsx:** for an own pad, list the possible actions (build 4 types / upgrade / repair) with cost, a short stat line and icons. Disable unaffordable options. Adding an action appends to today's order list (shown as a "Plan" list with remove buttons). Remaining gold = gold − planned costs. Also a hero stance picker and a donate dialog. |
| ✅ T3.7 | B | T3.4 | **ui/IntentPanel.tsx:** for each road, the enemy portrait or sprite, counts, the featured-role badge, and boss night highlighting. |
| ✅ T3.8 | S | T3.4 | **ui/DawnFlow:** after Dawn, the app opens on the replay (auto camera: an overview first, then following the player's sector during peak action), then **DawnReport.tsx** (stars animation, Keep HP change, personal stats, MVP titles, skipped orders). |
| ✅ T3.9 | B | T3.8 | **ui/DawnReport.tsx** as described in design §10: a layout with `icon_star`, portraits, a list of skipped orders with their reasons. |
| ✅ T3.10 | S | all M3 | **Playtest polish:** camera feel, timings, juice, balance numbers from bot runs. **Gate: you play 7 days on your phone.** |

## M4: Rust server (`server/`)

**Stack:** axum, tokio, rusqlite (bundled), serde, chrono, chrono-tz, rand, sha2, base64, web-push, tower-http (static files and CORS for dev).
**Config (env):** `DB_PATH`, `BIND`, `STATIC_DIR`, `VAPID_PRIVATE_KEY_PATH`, `VAPID_SUBJECT`.

**Schema:**
```sql
users(id TEXT PK, name TEXT, token_hash TEXT UNIQUE, created_at INT)
transfer_codes(code TEXT PK, user_id TEXT, expires_at INT)
challenges(id TEXT PK, creator TEXT, config_json TEXT, invite_code TEXT UNIQUE, seed TEXT, sim_version INT, created_at INT)
members(challenge_id TEXT, user_id TEXT, join_order INT, joined_at INT, PRIMARY KEY(challenge_id,user_id))
events(seq INTEGER PK AUTOINCREMENT, challenge_id TEXT, day INT, user_id TEXT, kind TEXT, payload_json TEXT, updated_at INT,
       UNIQUE(challenge_id, day, user_id, kind))   -- kind: checkin | orders | hash
push_subs(user_id TEXT, endpoint TEXT PK, p256dh TEXT, auth TEXT)
sent_notifications(challenge_id TEXT, user_id TEXT, day INT, kind TEXT, PRIMARY KEY(...))
```

**API** (JSON; `Authorization: Bearer <token>` except where marked):
| Method and path | Body → Response | Rules |
|---|---|---|
| `POST /api/users` *(no auth)* | `{name}` → `{userId, token}` | token = 32 random bytes, base64url. Store its sha256. |
| `GET /api/me` | → `{userId, name}` | |
| `POST /api/me/transfer-code` | → `{code, expiresAt}` | 6 characters from A–Z and 2–9, valid 10 min |
| `POST /api/users/claim` *(no auth)* | `{code}` → `{userId, token}` | Issues a new token; the old device stays valid |
| `GET /api/time` *(no auth)* | → `{now}` | ms since epoch |
| `POST /api/challenges` | `{config}` → `{id, inviteCode}` | Validate config. seed = 64 random bits as a hex string. The creator joins automatically. |
| `GET /api/challenges` | → list of mine | |
| `GET /api/challenges/by-invite/:code` | → public summary | |
| `POST /api/challenges/join` | `{inviteCode}` → `{id}` | Rejected after the start date or with 8 members |
| `GET /api/challenges/:id` | → `{config, seed, simVersion, members[], now}` | Members only |
| `PUT /api/challenges/:id/days/:day/:kind` | `{payload}` → `{seq}` | `kind` ∈ checkin, orders: only while open (00:00 of day *d* ≤ now < Dawn_d in the challenge's time zone, active days only). `hash`: only after Dawn_d. Payload ≤ 8 KB. The upsert deletes and re-inserts so `seq` increases. |
| `GET /api/challenges/:id/events?since=seq` | → `{events[], now}` | Members only |
| `GET /api/push/key` *(no auth)* | → `{publicKey}` | |
| `POST /api/push/subscribe` | `{endpoint, keys:{p256dh, auth}}` | |
| `DELETE /api/push/subscribe` | `{endpoint}` | |

**Day math** must exist in both TS (`client/src/sim/calendar.ts`) and Rust (`server/src/calendar.rs`) with **shared test vectors** in `docs/calendar-vectors.json`, covering DST changes and inactive days.

| id | who | deps | task |
|---|---|---|---|
| ✅ T4.1 | B | – | Scaffold the cargo project, config, SQLite migrations (schema above) and a health endpoint. Serve `STATIC_DIR` with an SPA fallback to index.html. |
| ✅ T4.2 | B | T4.1 | Users, transfer codes and the auth middleware. **Accept:** integration tests for create, me, transfer and claim, plus an invalid token returning 401. |
| ✅ T4.3 | S | – | **calendar.rs + calendar.ts + vectors:** day index for a timestamp, window for a day, Dawn_d, active-day mapping with the inactive-days list. |
| ✅ T4.4 | B | T4.2, T4.3 | Challenges: create, list, by-invite, join, get. **Accept:** tests for config validation, joining after the start, and the 9th member being rejected. |
| ✅ T4.5 | B | T4.4 | Events: put and get, with the window rules from the table. **Accept:** tests for writes before the window, inside it and after Dawn, the hash only after Dawn, oversized payloads, and non-members. |
| ✅ T4.6 | B | T4.2 | Push subscribe and unsubscribe, VAPID key loading (generated on first start if missing, and saved). |
| ✅ T4.7 | S | T4.5, T4.6 | **Scheduler** (tokio interval, 60 s). (a) 20:00 local: remind members with no check-in for the open day. (b) At Dawn_d: "The battle of day *d* is ready". Deduplicate via `sent_notifications`. Remove subscriptions that return 404 or 410. |
| ✅ T4.8 | B | T4.7 | Deployment: release build, a `systemd` unit file, a sample Caddy config, and a backup script (SQLite `.backup` once a day). README with the steps. |

## M5: Multiplayer client

| id | who | deps | task |
|---|---|---|---|
| ✅ T5.1 | S | T3.1, M4 | **HttpBackend** implementing the Backend interface, with the server time offset from `/api/time`, polling events every 30 s while visible and on focus, and an offline queue for PUTs (retried; dropped with a message if the window closed). |
| ✅ T5.2 | B | T5.1 | **Join flow:** the `/join/:code` route shows the challenge summary, then the hero class picker (3 portraits with descriptions), then join. |
| ✅ T5.3 | B | T5.1 | **ui/Settings.tsx:** name, show the transfer code (with a 10 min countdown), "use code from another device", a notifications toggle, about. |
| ✅ T5.4 | S | T5.1 | **Desync check:** after resolving a day, PUT `hash`. If teammates' hashes for the same day differ, show a warning banner with the day number. |

## M6: PWA and push

| id | who | deps | task |
|---|---|---|---|
| ✅ T6.1 | B | T1.1 | `vite-plugin-pwa` with the injectManifest strategy: manifest (name, icons from `app_icon` at 192/512/maskable, theme colour), precache of the app shell and slice assets, runtime cache for the other assets. |
| ✅ T6.2 | S | T6.1, T4.6 | SW push handler (show the notification; a click opens the challenge), the subscribe flow, and an iOS "add to home screen first" hint. |

## M7: Content and polish
- ✅ T7.1 [B] Catapult building plus `proj_rock`.
- ✅ T7.2 [S] Keep level visuals and the level-up cutscene.
- ✅ T7.3 [B] Audio: `render/Sound.ts` with Howler-free WebAudio playback of CC0 SFX (shoot, hit, death, build, coin, victory) and a mute toggle.
- ✅ T7.4 [B] Additional themes: data in `content/themes.ts` plus art ids.
- ✅ T7.5 [S] Balancing pass with 200 bot seasons (a headless script), reporting the star distribution per difficulty.

## Testing notes
- Headless screenshot: `chromium --headless=new --no-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader --window-size=420,860 --virtual-time-budget=8000 --screenshot=out.png "http://localhost:5173/dev/sandbox?ff=400&x=1060&y=330&z=1.2"`
- Don't use React StrictMode. Double-mounting the Pixi app gives blank canvases.
- `content/maps/valley.json` is a placeholder from `tools/gen-placeholder-map.mjs`. Replace it via the map editor (T2.5) once `map_valley` exists.
