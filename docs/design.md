# Game Design: The Siege v2

All numbers are **starting values**. They live in `client/src/content/stats.ts` and get tuned in the sandbox. Every unit is in **world pixels** (the map image is 2048 × 2048) and **seconds**. The sim runs at **20 ticks/s** (dt = 0.05).

## 1. Season and days
- A challenge has: type (binary / checklist / numeric), rules or target, direction (numeric), start date, **D active days (7–90)**, IANA time zone, Dawn time (default 11:00), difficulty, Force theme (v1: `sugar`), and a 64-bit seed (set by the server when the challenge is created).
- Active day *d* runs from 00:00 on that calendar day until **Dawn_d** = the next Dawn time after the day ends (normally 11:00 the next morning).
- Check-ins and orders for day *d* can be changed until Dawn_d. After that, the day's inputs are final and the day is **resolved**:
  1. economy → 2. orders → 3. battle → 4. after-battle → state for day *d*+1.
- Joining closes when the season starts. Team size: 2–8.
- Inactive days (marked by the creator ahead of time) are skipped completely. *D* counts active days only.
- Progress *p* = (d − 1) / (D − 1), which runs from 0 to 1.

## 2. Map and sectors
- The map JSON (made with the editor) contains:
  - `keep`: {x, y}
  - 4 `roads` (N, E, S, W), each a polyline from the map edge to the Keep
  - 8 `sectors`: for each road, an `outer` and an `inner` sector, each with **4 pads** {id, x, y} and a `rally` point on the road
  - `heroSpawn` per sector
- Assignment at season start, with players sorted by join order:
  - **P ≤ 3:** each player gets one whole road (outer + inner = 8 pads). `sectorsPerPlayer` = 2.
  - **P ≥ 4:** player *i* gets sector *i* from the list [N-out, E-out, S-out, W-out, N-in, E-in, S-in, W-in]. `sectorsPerPlayer` = 1.
- A road is **active** if at least one sector on it is owned. Enemies only come along active roads.

## 3. Economy (step 1 of resolution)
**Achievement ratio *r*:**
| Type | *r* |
|---|---|
| binary / checklist | rules kept ÷ number of rules |
| numeric, higher is better | value ÷ target |
| numeric, lower is better | target ÷ value (a value ≤ 0 counts as 4) |

Then *r* is capped at 4. No report means *r* is undefined.

**Gold for the day** is `round(base × m × sectorsPerPlayer)`, where *m* = clamp(30 / D, 0.5, 3).
| Result | base gold | hero status for tonight |
|---|---|---|
| no report | 0 | **Absent** (the hero doesn't fight) |
| r < 1 | 4 + 6·r | **Weary**: −20 % damage |
| 1 ≤ r < 1.5 | 12 | normal |
| r ≥ 1.5 | 14 | **Inspired**: +20 % damage, +20 % HP |

- **Start gold** before day 1: 30 × sectorsPerPlayer.
- **Rally:** if every active player reported (any *r*), all buildings get **+15 % fire rate** tonight and a Rally banner shows on the Keep.
- **Hero XP:** +2 for a hit (r ≥ 1), +1 for an honest miss, 0 for no report. Hero level 1–5 at XP thresholds 0 / 4 / 10 / 18 / 28. Each level gives +12 % HP and damage.
- **Dormant:** a player with 3 or more consecutive days without a report has their sectors defended by buildings only, and their hero rests. This is shown on the map; there's no penalty beyond that.

## 4. Orders (step 2)
Each player submits **one list of orders per day**. The last version before Dawn counts. Players are processed in join order, and orders in list order. An order that isn't affordable or valid is skipped (and the skip is recorded in the report).

| Order | Effect | Cost |
|---|---|---|
| `build {pad, type}` | Build a level 1 building on your own empty pad (or on a rubble pad) | Archer 20, Barracks 20, Mage 30, Catapult 35 |
| `upgrade {pad}` | Level 1 → 2 → 3 | L2: 30, L3: 50 (catapult +5 each) |
| `repair {pad}` | Restore full HP | ceil(10 × missing HP ÷ max HP), minimum 1 |
| `donate {to: playerId \| "keep", amount}` | Move gold to a teammate or into the Keep fund | amount (≥ 5) |
| `stance {mode: "own" \| "neighbor" \| "keep", sector?}` | Where your hero fights tonight | free |
| `heroClass` | Only before day 1: knight, ranger or priest | free |

**Keep fund:** at a cumulative 150 / 400 team gold the Keep goes up a level (L2 / L3), which gives more max HP and stronger Keep archers. Any surplus stays in the fund.

## 5. Buildings
Every building has HP 300 / 450 / 600 (L1 / L2 / L3). At 0 HP it becomes **rubble** and has to be rebuilt.

| Type | Damage type | Range | Damage per hit (L1/L2/L3) | Shots per second | Notes |
|---|---|---|---|---|---|
| Archer | physical | 140 / 155 / 170 | 10 / 15 / 22 | 1.0 | Can hit flyers |
| Mage | magic | 120 / 130 / 140 | 25 / 38 / 55 | 0.6 | Ignores armour. Can hit flyers. |
| Barracks | physical (soldiers) | rally within 100 | soldier deals 6 / 9 / 12 at 1/s | – | 2 / 2 / 3 soldiers. Soldier HP 100 / 150 / 200. Respawn 8 s. Soldiers block ground enemies. |
| Catapult | physical, splash radius 40 | 180 | 30 / 45 / 65 | 0.33 | Can't hit flyers. Minimum range 40. |

**Targeting** (all towers): the enemy in range that is **furthest along its path**. Ties go to the lower entity id.

## 6. Heroes
One per player. The hero spawns at its stance sector's rally point and respawns 10 s after dying.

| Class | HP | Attack | Special |
|---|---|---|---|
| Knight | 400 | melee 15 dmg / 1 s, physical | Blocks up to 2 enemies |
| Ranger | 220 | range 130, 14 dmg / 0.8 s, physical | Can hit flyers |
| Priest | 200 | range 110, 12 dmg / 1 s, magic | Heals allied soldiers and heroes within 80 by 8 HP/s |

## 7. Enemies (theme "Sugar Horde"; other themes reuse the same roles)
| Role | Name (sugar) | HP | Speed | Armour | Magic resist | Flags | Damage to Keep on leak | Budget cost | Unlocks at *p* ≥ |
|---|---|---|---|---|---|---|---|---|---|
| grunt | Gummy Grunt | 60 | 30 | 0 | 0 | – | 1 | 1 | 0 |
| runner | Candy Imp | 40 | 55 | 0 | 0 | – | 1 | 1.2 | 0.1 |
| brute | Choco Brute | 220 | 22 | 50 % | 0 | – | 3 | 3 | 0.2 |
| flyer | Floss Bat | 70 | 40 | 0 | 0 | flying | 2 | 2 | 0.3 |
| siege | Cake Golem | 320 | 18 | 30 % | 0 | attacks buildings (15 dps, range 60) | 5 | 4 | 0.4 |
| boss | The Sugar Wraith | 2500 × s | 15 | 30 % | 30 % | aura: enemies within 100 get +20 % speed | 20 | – | boss nights |

- Physical damage is multiplied by (1 − armour). Magic damage is multiplied by (1 − magic resist).
- Ground enemies that meet a soldier or knight within 20 px stop and fight (melee 8 dmg/s, brute 20, boss 60). Flyers ignore blockers.

## 8. Waves and intents
- **Intent for day *d* is generated at Dawn_{d−1}** (for day 1: at season start) and shown all day. Everyone sees the same information, whenever they open the app.
- Budget per active road = `6 × (1 + 5.5p) × difficulty × sectorsOnRoad`, where difficulty is very easy 0.6, easy 0.8, normal 1.05, hard 1.35. *(Tuned from the starting values `1 + 3p` and normal 1.0 / hard 1.25 in the 200-season balancing pass, T7.5.)*
- Composition (seeded PRNG of seed, d and road): first pick a **featured role** among the unlocked roles. Spend 40 % of the budget on it, and the rest on grunts and runners.
- **Boss nights:** every 7th active day (if D ≥ 14) and **always the last day**. The boss walks a random active road. That road's budget drops by 50 %. Boss scale *s* = 0.5 + 0.5 × P × (0.6 + 0.4p).
- Spawn timing: enemies leave the road start at intervals across 0–30 s, in groups of 3–5.
- The intent UI shows, for each road: an arrow on the map, the role icons with counts, and a badge for the featured role ("Armoured!", "Flying!").

## 9. Battle (step 3)
- Runs up to 120 s of sim time, and ends early once every enemy has died or leaked.
- Enemies follow their road polyline at their speed. When an enemy reaches the end, it **leaks**: Keep HP drops by its leak damage and the enemy is removed.
- **Keep:** HP 100 / 130 / 160 (L1–L3). Keep archers: range 160, 8 / 12 / 16 dmg per shot at 1.5 shots/s, can hit flyers.
- **Projectiles are resolved instantly in the sim,** with damage applied after a fixed travel delay: arrow 0.3 s, bolt 0.25 s, rock 0.8 s. The renderer animates the flight. This keeps the sim simple.
- **Output per tick:** positions, HP and state of every entity, plus an event list (`shot`, `hit`, `death`, `leak`, `build_destroyed`, `spawn`). The renderer interpolates between ticks.
- **Determinism:** fixed tick order:
  1. spawn
  2. move
  3. engage
  4. tower / hero / soldier attacks (sorted by entity id)
  5. apply due damage
  6. deaths / leaks

## 10. After the battle (step 4)
**Stars for the night:**
| Stars | Condition |
|---|---|
| ★★★ | 0 leaks |
| ★★ | Keep lost ≤ 10 % of max HP |
| ★ | Keep survived |
| 0 | Keep fell |

- **Keep fell:** it comes back at 50 % HP the next day. There is no game over.
- Every day the Keep regenerates +5 HP, up to its max.
- Building damage carries over until repaired.
- **Boss defeated:** +1 bonus star and +10 gold for every player.
- **Season result:** star % = stars ÷ (3·D + boss bonuses). Rank: Bronze < 40 % ≤ Silver < 65 % ≤ Gold < 85 % ≤ **Legendary**.
- **Daily report** per player: damage dealt, kills, gold earned and spent, and the night's "MVP" titles (Top Damage, Wall: most blocking, Patron: most donated).

## 11. Core types (sketch for `sim/types.ts`)
```ts
type DayInputs = { checkins: Record<PlayerId, Checkin | null>; orders: Record<PlayerId, Order[]> };
type SeasonState = {
  day: number; keep: { level: 1|2|3; hp: number; fund: number };
  players: Record<PlayerId, { gold: number; xp: number; heroClass: HeroClass; missStreak: number; sectors: SectorId[] }>;
  pads: Record<PadId, { owner: PlayerId | null; building: null | { type: BuildingType; level: 1|2|3; hp: number } | 'rubble' }>;
  stars: number[]; intent: Intent; rngState: number;
};
resolveDay(config, state, inputs): { next: SeasonState; battle: BattleSetup; report: DayReport }
createBattle(setup): Battle   // Battle.step(): TickFrame; Battle.done: boolean
```
