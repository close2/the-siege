// Deterministic 20 Hz battle simulation. design.md §9
// Rules: only + - * / sqrt floor min max; stable iteration order; no Date / Math.random.
import {
  BARRACKS,
  BATTLE,
  BOSS_AURA,
  BUILDING_HP,
  DT,
  ENEMIES,
  HERO_COMMON,
  HEROES,
  KEEP,
  TICK_RATE,
  TOWERS,
  WAVES,
  ECON,
} from '../content/stats';
import { heroMultipliers } from './economy';
import { dist2, makePath, pointAt, type Path } from './map';
import { rngFor } from './rng';
import type {
  BattleResult,
  BattleSetup,
  BuildingType,
  DamageType,
  Dir,
  EnemyRole,
  HeroClass,
  Level,
  PadId,
  PlayerBattleStats,
  PlayerId,
  Pt,
} from './types';
import { DIRS } from './types';

export type EntityId = number;

export interface EnemyE {
  id: EntityId;
  role: EnemyRole;
  road: Dir;
  s: number;
  off: number;
  x: number;
  y: number;
  /** path direction, for facing */
  dirX: number;
  hp: number;
  maxHp: number;
  speed: number;
  armor: number;
  mr: number;
  flying: boolean;
  leak: number;
  melee: number;
  blockedBy: EntityId | null;
  siegeTarget: PadId | null;
  state: 'walk' | 'fight' | 'siege';
  atkTimer: number;
  alive: boolean;
  killedBy: PlayerId | null;
}

export interface DefenderE {
  id: EntityId;
  kind: 'soldier' | 'hero';
  heroClass?: HeroClass;
  owner: PlayerId | null;
  padId?: PadId;
  home: Pt;
  spawn: Pt;
  x: number;
  y: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  dmg: number;
  cooldown: number;
  cd: number;
  range: number;
  dtype: DamageType;
  hitsFlying: boolean;
  block: number;
  blocking: EntityId[];
  heal: number;
  healRadius: number;
  healTimer: number;
  aggro: number;
  speed: number;
  respawn: number;
  alive: boolean;
  respawnAt: number;
  noRespawn: boolean;
  level: number;
}

export interface BuildingE {
  padId: PadId;
  owner: PlayerId | null;
  type: BuildingType;
  level: Level;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  cd: number;
  alive: boolean;
}

export interface KeepE {
  x: number;
  y: number;
  level: Level;
  hp: number;
  maxHp: number;
  cd: number;
}

export type ProjectileKind = 'arrow' | 'bolt' | 'rock' | 'holy';

export type BattleEvent =
  | { t: 'spawn'; id: EntityId }
  | { t: 'shot'; src: EntityId | PadId | 'keep'; kind: ProjectileKind; x: number; y: number; target: EntityId; tx: number; ty: number; flight: number }
  | { t: 'hit'; id: EntityId; amount: number; dtype: DamageType }
  | { t: 'splash'; x: number; y: number; r: number }
  | { t: 'melee'; id: EntityId; target: EntityId | PadId }
  | { t: 'hurt'; id: EntityId | PadId; amount: number }
  | { t: 'death'; id: EntityId }
  | { t: 'leak'; id: EntityId; dmg: number }
  | { t: 'destroyed'; padId: PadId }
  | { t: 'heal'; id: EntityId };

export interface TickFrame {
  tick: number;
  events: BattleEvent[];
}

interface Pending {
  due: number;
  target: EntityId;
  x: number;
  y: number;
  amount: number;
  dtype: DamageType;
  owner: PlayerId | null;
  splash: number;
}

interface Spawn {
  tick: number;
  role: EnemyRole;
  road: Dir;
  off: number;
}

const ROLE_ORDER: EnemyRole[] = ['grunt', 'runner', 'brute', 'flyer', 'siege'];

export class Battle {
  readonly setup: BattleSetup;
  tick = 0;
  done = false;
  enemies: EnemyE[] = [];
  defenders: DefenderE[] = [];
  buildings: BuildingE[] = [];
  keep: KeepE;
  readonly paths: Record<Dir, Path>;
  readonly stats: Record<PlayerId, PlayerBattleStats> = {};
  leaks = 0;
  leakDamage = 0;
  bossSpawned = false;
  bossKilled = false;
  readonly totalSpawns: number;

  private schedule: Spawn[] = [];
  private schedIdx = 0;
  private pending: Pending[] = [];
  private nextId = 1;
  private readonly maxTicks = BATTLE.maxSeconds * TICK_RATE;
  private readonly fireMult: number;
  private events: BattleEvent[] = [];

  constructor(setup: BattleSetup) {
    this.setup = setup;
    this.fireMult = setup.rally ? ECON.rallyFireRate : 1;
    const m = setup.map;
    this.paths = {
      N: makePath(m.roads.N),
      E: makePath(m.roads.E),
      S: makePath(m.roads.S),
      W: makePath(m.roads.W),
    };
    const kl = setup.keep.level;
    this.keep = { x: m.keep.x, y: m.keep.y, level: kl, hp: setup.keep.hp, maxHp: KEEP.hp[kl - 1], cd: 0 };

    for (const b of setup.buildings) {
      const maxHp = BUILDING_HP[b.level - 1];
      this.buildings.push({ padId: b.padId, owner: b.owner, type: b.type, level: b.level, x: b.x, y: b.y, hp: b.hp, maxHp, cd: 0, alive: b.hp > 0 });
      if (b.owner) this.ensureStats(b.owner);
      if (b.type === 'barracks' && b.hp > 0) {
        const n = BARRACKS.soldiers[b.level - 1];
        for (let i = 0; i < n; i++) {
          const home = { x: b.rally.x + (i - (n - 1) / 2) * 22, y: b.rally.y + (i % 2) * 10 };
          this.defenders.push(this.makeDefender('soldier', b.owner, home, { x: b.x, y: b.y }, b.level, undefined, b.padId));
        }
      }
    }
    for (const h of setup.heroes) {
      this.ensureStats(h.owner);
      if (h.status === 'absent') continue;
      const d = this.makeDefender('hero', h.owner, h.post, h.post, h.level, h.heroClass);
      const mult = heroMultipliers(h.level, h.status);
      d.maxHp = d.hp = d.maxHp * mult.hp;
      d.dmg *= mult.dmg;
      d.heal *= mult.dmg;
      this.defenders.push(d);
    }
    this.buildSchedule();
    this.totalSpawns = this.schedule.length;
  }

  private ensureStats(p: PlayerId) {
    if (!this.stats[p]) this.stats[p] = { damage: 0, kills: 0, blocks: 0 };
  }

  private makeDefender(
    kind: 'soldier' | 'hero',
    owner: PlayerId | null,
    home: Pt,
    spawn: Pt,
    level: number,
    heroClass?: HeroClass,
    padId?: PadId,
  ): DefenderE {
    const base = {
      id: this.nextId++,
      kind,
      owner,
      home: { x: home.x, y: home.y },
      spawn: { x: spawn.x, y: spawn.y },
      x: home.x,
      y: home.y,
      facing: 1 as const,
      blocking: [] as EntityId[],
      alive: true,
      respawnAt: 0,
      noRespawn: false,
      cd: 0,
      healTimer: 0,
      level,
    };
    if (kind === 'soldier') {
      const hp = BARRACKS.hp[level - 1];
      return {
        ...base,
        padId,
        hp,
        maxHp: hp,
        dmg: BARRACKS.dmg[level - 1],
        cooldown: 1 / BARRACKS.rate,
        range: 0,
        dtype: 'physical',
        hitsFlying: false,
        block: BARRACKS.block,
        heal: 0,
        healRadius: 0,
        aggro: BARRACKS.aggro,
        speed: BARRACKS.speed,
        respawn: BARRACKS.respawn,
      };
    }
    const hs = HEROES[heroClass!];
    return {
      ...base,
      heroClass,
      hp: hs.hp,
      maxHp: hs.hp,
      dmg: hs.dmg,
      cooldown: 1 / hs.rate,
      range: hs.range,
      dtype: hs.dtype,
      hitsFlying: hs.hitsFlying,
      block: hs.block,
      heal: hs.heal ?? 0,
      healRadius: hs.healRadius ?? 0,
      aggro: HERO_COMMON.aggro,
      speed: HERO_COMMON.speed,
      respawn: HERO_COMMON.respawn,
    };
  }

  private buildSchedule() {
    const { intent, seed, day } = this.setup;
    for (const d of DIRS) {
      const ri = intent.roads[d];
      if (!ri) continue;
      const rng = rngFor(seed, day, 'spawn', d);
      const list: EnemyRole[] = [];
      for (const r of ROLE_ORDER) for (let i = 0; i < (ri.counts[r] ?? 0); i++) list.push(r);
      // Fisher–Yates
      for (let i = list.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const t = list[i];
        list[i] = list[j];
        list[j] = t;
      }
      const avg = (WAVES.groupMin + WAVES.groupMax) / 2;
      const groups = Math.max(1, Math.floor((list.length + avg - 1) / avg));
      let idx = 0;
      for (let g = 0; g < groups && idx < list.length; g++) {
        const size = g === groups - 1 ? list.length - idx : Math.min(list.length - idx, rng.range(WAVES.groupMin, WAVES.groupMax));
        const start = (WAVES.spawnWindow * g) / groups + rng.float() * 1.5;
        for (let k = 0; k < size; k++) {
          const t = start + k * 0.6;
          this.schedule.push({ tick: Math.floor(t * TICK_RATE), role: list[idx++], road: d, off: (rng.float() * 2 - 1) * BATTLE.laneSpread });
        }
      }
      if (ri.boss) this.schedule.push({ tick: WAVES.bossSpawnAt * TICK_RATE, role: 'boss', road: d, off: 0 });
    }
    const roadIdx = (d: Dir) => DIRS.indexOf(d);
    this.schedule.sort((a, b) => a.tick - b.tick || roadIdx(a.road) - roadIdx(b.road));
  }

  // ---------- main step ----------

  step(): TickFrame {
    if (this.done) return { tick: this.tick, events: [] };
    this.events = [];
    this.spawnPhase();
    this.movePhase();
    this.engagePhase();
    this.attackPhase();
    this.damagePhase();
    this.deathPhase();
    this.tick++;
    if ((this.schedIdx >= this.schedule.length && this.enemies.length === 0) || this.tick >= this.maxTicks) this.done = true;
    return { tick: this.tick, events: this.events };
  }

  runToEnd(): BattleResult {
    while (!this.done) this.step();
    return this.result();
  }

  result(): BattleResult {
    const buildingHp: Record<PadId, number> = {};
    for (const b of this.buildings) buildingHp[b.padId] = Math.max(0, b.hp);
    return {
      keepHp: this.keep.hp,
      leaks: this.leaks,
      leakDamage: this.leakDamage,
      buildingHp,
      bossSpawned: this.bossSpawned,
      bossKilled: this.bossKilled,
      stats: this.stats,
      ticks: this.tick,
    };
  }

  // ---------- phases ----------

  private spawnPhase() {
    while (this.schedIdx < this.schedule.length && this.schedule[this.schedIdx].tick <= this.tick) {
      const sp = this.schedule[this.schedIdx++];
      const st = ENEMIES[sp.role];
      const isBoss = sp.role === 'boss';
      const hp = isBoss ? st.hp * this.setup.intent.bossScale : st.hp;
      const p = pointAt(this.paths[sp.road], 0);
      const e: EnemyE = {
        id: this.nextId++,
        role: sp.role,
        road: sp.road,
        s: 0,
        off: sp.off,
        x: p.x - p.dy * sp.off,
        y: p.y + p.dx * sp.off,
        dirX: p.dx,
        hp,
        maxHp: hp,
        speed: st.speed,
        armor: st.armor,
        mr: st.mr,
        flying: st.flying,
        leak: st.leak,
        melee: st.melee,
        blockedBy: null,
        siegeTarget: null,
        state: 'walk',
        atkTimer: 0,
        alive: true,
        killedBy: null,
      };
      if (isBoss) this.bossSpawned = true;
      this.enemies.push(e);
      this.events.push({ t: 'spawn', id: e.id });
    }
  }

  private movePhase() {
    const bosses = this.enemies.filter((e) => e.role === 'boss' && e.alive);
    const aura2 = BOSS_AURA.radius * BOSS_AURA.radius;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.blockedBy !== null) {
        e.state = 'fight';
        continue;
      }
      const st = ENEMIES[e.role];
      if (st.siegeDps) {
        let target = e.siegeTarget ? this.buildingByPad(e.siegeTarget) : undefined;
        const r2 = st.siegeRange! * st.siegeRange!;
        if (!target || !target.alive || dist2(target, e) > r2) {
          target = undefined;
          let best = Infinity;
          for (const b of this.buildings) {
            if (!b.alive) continue;
            const d2 = dist2(b, e);
            if (d2 <= r2 && d2 < best) {
              best = d2;
              target = b;
            }
          }
          e.siegeTarget = target ? target.padId : null;
        }
        if (target) {
          e.state = 'siege';
          continue;
        }
      }
      e.state = 'walk';
      let speed = e.speed;
      if (e.role !== 'boss') for (const b of bosses) if (dist2(b, e) <= aura2) speed *= BOSS_AURA.speedMult;
      e.s += speed * DT;
      const p = pointAt(this.paths[e.road], e.s);
      e.x = p.x - p.dy * e.off;
      e.y = p.y + p.dx * e.off;
      e.dirX = p.dx;
    }

    for (const d of this.defenders) {
      if (!d.alive) {
        if (!d.noRespawn && this.tick >= d.respawnAt && this.canRespawn(d)) {
          d.alive = true;
          d.hp = d.maxHp;
          d.x = d.spawn.x;
          d.y = d.spawn.y;
          d.cd = 0;
          d.blocking = [];
          this.events.push({ t: 'spawn', id: d.id });
        }
        continue;
      }
      const target = d.blocking.length > 0 ? this.enemyById(d.blocking[0]) : undefined;
      if (target && target.alive) {
        this.moveToward(d, target.x, target.y, BATTLE.meleeRange);
      } else {
        this.moveToward(d, d.home.x, d.home.y, 1);
      }
    }
  }

  private canRespawn(d: DefenderE): boolean {
    if (d.kind === 'hero') return true;
    const b = d.padId ? this.buildingByPad(d.padId) : undefined;
    return !!b && b.alive;
  }

  private moveToward(d: DefenderE, tx: number, ty: number, stopAt: number) {
    const dx = tx - d.x;
    const dy = ty - d.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len <= stopAt) return;
    const step = Math.min(d.speed * DT, len - stopAt);
    d.x += (dx / len) * step;
    d.y += (dy / len) * step;
    if (dx > 0.5) d.facing = 1;
    else if (dx < -0.5) d.facing = -1;
  }

  private engagePhase() {
    const melee2x = BATTLE.meleeRange * 2;
    for (const d of this.defenders) {
      if (!d.alive || d.block <= 0) continue;
      d.blocking = d.blocking.filter((id) => {
        const e = this.enemyById(id);
        return !!e && e.alive && e.blockedBy === d.id;
      });
      while (d.blocking.length < d.block) {
        const primary = d.blocking.length === 0;
        const center = primary ? d.home : d;
        const radius = primary ? d.aggro : melee2x;
        const r2 = radius * radius;
        let best: EnemyE | undefined;
        let bestD = Infinity;
        for (const e of this.enemies) {
          if (!e.alive || e.flying || e.blockedBy !== null) continue;
          const d2 = dist2(e, center);
          if (d2 <= r2 && d2 < bestD) {
            bestD = d2;
            best = e;
          }
        }
        if (!best) break;
        best.blockedBy = d.id;
        best.state = 'fight';
        d.blocking.push(best.id);
        if (d.owner) this.stats[d.owner].blocks++;
      }
    }
  }

  private attackPhase() {
    // towers
    for (const b of this.buildings) {
      if (!b.alive || b.type === 'barracks') continue;
      const ts = TOWERS[b.type];
      if (b.cd > 0) b.cd -= DT;
      if (b.cd > 0) continue;
      const range = ts.range[b.level - 1];
      const target = this.findTarget(b, range, ts.minRange ?? 0, ts.hitsFlying);
      if (!target) continue;
      b.cd += 1 / (ts.rate * this.fireMult);
      this.fire(b.padId, b.x, b.y, target, ts.projectile, ts.delay, ts.dmg[b.level - 1], ts.dtype, b.owner, ts.splash ?? 0);
    }
    // keep archers
    {
      const k = this.keep;
      if (k.cd > 0) k.cd -= DT;
      if (k.cd <= 0) {
        const target = this.findTarget(k, KEEP.archer.range, 0, true);
        if (target) {
          k.cd += 1 / (KEEP.archer.rate * this.fireMult);
          this.fire('keep', k.x, k.y, target, 'arrow', KEEP.archer.delay, KEEP.archer.dmg[k.level - 1], 'physical', null, 0);
        }
      }
    }
    // defenders
    for (const d of this.defenders) {
      if (!d.alive) continue;
      if (d.cd > 0) d.cd -= DT;
      if (d.heal > 0) this.healAround(d);
      if (d.cd > 0) continue;
      if (d.range > 0) {
        const target = this.findTarget(d, d.range, 0, d.hitsFlying);
        if (!target) continue;
        d.cd += d.cooldown;
        d.facing = target.x >= d.x ? 1 : -1;
        const kind: ProjectileKind = d.heroClass === 'priest' ? 'holy' : 'arrow';
        this.fire(d.id, d.x, d.y, target, kind, HERO_COMMON.projectileDelay, d.dmg, d.dtype, d.owner, 0);
      } else if (d.blocking.length > 0) {
        const e = this.enemyById(d.blocking[0]);
        if (!e || !e.alive) continue;
        if (dist2(d, e) > (BATTLE.meleeRange + 2) * (BATTLE.meleeRange + 2)) continue;
        d.cd += d.cooldown;
        d.facing = e.x >= d.x ? 1 : -1;
        this.events.push({ t: 'melee', id: d.id, target: e.id });
        this.damageEnemy(e, d.dmg, d.dtype, d.owner);
      }
    }
    // enemies
    const reach2 = (BATTLE.meleeRange + 4) * (BATTLE.meleeRange + 4);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.state === 'fight' && e.blockedBy !== null) {
        const d = this.defenderById(e.blockedBy);
        if (!d || !d.alive) continue;
        if (dist2(d, e) > reach2) continue;
        const dmg = e.melee * DT;
        d.hp -= dmg;
        e.atkTimer -= DT;
        if (e.atkTimer <= 0) {
          e.atkTimer += 1;
          this.events.push({ t: 'melee', id: e.id, target: d.id });
          this.events.push({ t: 'hurt', id: d.id, amount: e.melee });
        }
      } else if (e.state === 'siege' && e.siegeTarget) {
        const b = this.buildingByPad(e.siegeTarget);
        if (!b || !b.alive) continue;
        const dps = ENEMIES[e.role].siegeDps!;
        b.hp -= dps * DT;
        e.atkTimer -= DT;
        if (e.atkTimer <= 0) {
          e.atkTimer += 1;
          this.events.push({ t: 'melee', id: e.id, target: b.padId });
          this.events.push({ t: 'hurt', id: b.padId, amount: dps });
        }
      }
    }
  }

  private healAround(d: DefenderE) {
    const r2 = d.healRadius * d.healRadius;
    let healed = false;
    for (const o of this.defenders) {
      if (!o.alive || o.hp >= o.maxHp) continue;
      if (dist2(o, d) > r2) continue;
      o.hp = Math.min(o.maxHp, o.hp + d.heal * DT);
      healed = true;
    }
    d.healTimer -= DT;
    if (healed && d.healTimer <= 0) {
      d.healTimer = 1;
      this.events.push({ t: 'heal', id: d.id });
    }
  }

  private fire(
    src: EntityId | PadId | 'keep',
    x: number,
    y: number,
    target: EnemyE,
    kind: ProjectileKind,
    delay: number,
    amount: number,
    dtype: DamageType,
    owner: PlayerId | null,
    splash: number,
  ) {
    const flightTicks = Math.max(1, Math.floor(delay * TICK_RATE));
    this.pending.push({ due: this.tick + flightTicks, target: target.id, x: target.x, y: target.y, amount, dtype, owner, splash });
    this.events.push({ t: 'shot', src, kind, x, y, target: target.id, tx: target.x, ty: target.y, flight: flightTicks / TICK_RATE });
  }

  private findTarget(from: Pt, range: number, minRange: number, hitsFlying: boolean): EnemyE | undefined {
    const r2 = range * range;
    const m2 = minRange * minRange;
    let best: EnemyE | undefined;
    let bestRemain = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || (e.flying && !hitsFlying)) continue;
      const d2 = dist2(e, from);
      if (d2 > r2 || d2 < m2) continue;
      const remain = this.paths[e.road].len - e.s;
      if (remain < bestRemain) {
        bestRemain = remain;
        best = e;
      }
    }
    return best;
  }

  private damagePhase() {
    if (this.pending.length === 0) return;
    const keep: Pending[] = [];
    for (const p of this.pending) {
      if (p.due > this.tick) {
        keep.push(p);
        continue;
      }
      const target = this.enemyById(p.target);
      if (p.splash > 0) {
        const cx = target && target.alive ? target.x : p.x;
        const cy = target && target.alive ? target.y : p.y;
        const r2 = p.splash * p.splash;
        this.events.push({ t: 'splash', x: cx, y: cy, r: p.splash });
        for (const e of this.enemies) {
          if (!e.alive || e.flying) continue;
          if (dist2(e, { x: cx, y: cy }) <= r2) this.damageEnemy(e, p.amount, p.dtype, p.owner);
        }
      } else if (target && target.alive) {
        this.damageEnemy(target, p.amount, p.dtype, p.owner);
      }
    }
    this.pending = keep;
  }

  private damageEnemy(e: EnemyE, amount: number, dtype: DamageType, owner: PlayerId | null) {
    const mult = dtype === 'physical' ? 1 - e.armor : 1 - e.mr;
    const dealt = Math.min(e.hp, amount * mult);
    if (dealt <= 0) return;
    e.hp -= dealt;
    if (owner) this.stats[owner].damage += dealt;
    this.events.push({ t: 'hit', id: e.id, amount: dealt, dtype });
    if (e.hp <= 0 && e.killedBy === null) e.killedBy = owner ?? '';
  }

  private deathPhase() {
    let removed = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.hp <= 0) {
        e.alive = false;
        removed = true;
        if (e.killedBy) this.stats[e.killedBy].kills++;
        if (e.role === 'boss') this.bossKilled = true;
        this.releaseEnemy(e);
        this.events.push({ t: 'death', id: e.id });
      } else if (e.s >= this.paths[e.road].len) {
        e.alive = false;
        removed = true;
        this.leaks++;
        this.leakDamage += e.leak;
        this.keep.hp = Math.max(0, this.keep.hp - e.leak);
        this.releaseEnemy(e);
        this.events.push({ t: 'leak', id: e.id, dmg: e.leak });
      }
    }
    if (removed) this.enemies = this.enemies.filter((e) => e.alive);

    for (const d of this.defenders) {
      if (!d.alive || d.hp > 0) continue;
      d.alive = false;
      d.respawnAt = this.tick + d.respawn * TICK_RATE;
      for (const id of d.blocking) {
        const e = this.enemyById(id);
        if (e && e.blockedBy === d.id) {
          e.blockedBy = null;
          e.state = 'walk';
        }
      }
      d.blocking = [];
      this.events.push({ t: 'death', id: d.id });
    }

    for (const b of this.buildings) {
      if (!b.alive || b.hp > 0) continue;
      b.alive = false;
      b.hp = 0;
      this.events.push({ t: 'destroyed', padId: b.padId });
      for (const d of this.defenders) {
        if (d.padId !== b.padId) continue;
        d.noRespawn = true;
        if (d.alive) d.hp = 0;
      }
    }
  }

  private releaseEnemy(e: EnemyE) {
    if (e.blockedBy === null) return;
    const d = this.defenderById(e.blockedBy);
    if (d) d.blocking = d.blocking.filter((id) => id !== e.id);
    e.blockedBy = null;
  }

  // ---------- lookups ----------

  enemyById(id: EntityId): EnemyE | undefined {
    // enemies are sorted by id → binary search
    const arr = this.enemies;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = arr[mid].id;
      if (v === id) return arr[mid];
      if (v < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  defenderById(id: EntityId): DefenderE | undefined {
    return this.defenders.find((d) => d.id === id);
  }

  buildingByPad(padId: PadId): BuildingE | undefined {
    return this.buildings.find((b) => b.padId === padId);
  }
}

export function createBattle(setup: BattleSetup): Battle {
  return new Battle(setup);
}
