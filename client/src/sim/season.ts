// Season fold: state(d) = resolveDay(state(d-1), inputs(d)). design.md §1, §10
import { BATTLE, BUILDING_HP, ECON, KEEP, STARS } from '../content/stats';
import { Battle } from './battle';
import { dayGold, heroLevel, heroStatus, ratio, xpGain } from './economy';
import { assignSectors, sectorById, sectorsPerPlayer } from './map';
import { applyOrders } from './orders';
import type {
  BattleBuilding,
  BattleHero,
  BattleSetup,
  DayInputs,
  DayReport,
  PlayerDayReport,
  PlayerId,
  Pt,
  SeasonSetup,
  SeasonState,
  SectorId,
} from './types';
import { generateIntent } from './waves';

export function ownedSectors(setup: SeasonSetup): SectorId[] {
  const a = assignSectors(setup.players);
  return setup.players.flatMap((p) => a[p.id]);
}

function intentFor(setup: SeasonSetup, day: number) {
  const c = setup.config;
  return generateIntent(setup.seed, day, c.days, c.difficulty, ownedSectors(setup), setup.players.length);
}

export function createInitialState(setup: SeasonSetup): SeasonState {
  const assigned = assignSectors(setup.players);
  const spp = sectorsPerPlayer(setup.players.length);
  const state: SeasonState = {
    day: 1,
    keep: { level: 1, hp: KEEP.hp[0], fund: 0 },
    players: {},
    pads: {},
    stars: [],
    bonusStars: 0,
    intent: null,
  };
  for (const s of setup.map.sectors) for (const pad of s.pads) state.pads[pad.id] = { owner: null, building: null, rubble: false };
  for (const p of setup.players) {
    state.players[p.id] = { gold: ECON.startGold * spp, xp: 0, missStreak: 0, stance: { mode: 'own' }, sectors: assigned[p.id] };
    for (const sid of assigned[p.id]) {
      const sec = sectorById(setup.map, sid);
      if (sec) for (const pad of sec.pads) state.pads[pad.id].owner = p.id;
    }
  }
  state.intent = intentFor(setup, 1);
  return state;
}

export function heroPost(setup: SeasonSetup, state: SeasonState, pid: PlayerId): Pt {
  const ps = state.players[pid];
  const st = ps.stance;
  if (st.mode === 'keep') return { x: setup.map.keep.x, y: setup.map.keep.y + BATTLE.keepPostOffset };
  const sid = st.mode === 'neighbor' && st.sector ? st.sector : ps.sectors[0];
  const sec = sectorById(setup.map, sid) ?? sectorById(setup.map, ps.sectors[0]);
  return sec ? { ...sec.heroSpawn } : { ...setup.map.keep };
}

export function buildBattleSetup(setup: SeasonSetup, state: SeasonState, statuses: Record<PlayerId, PlayerDayReport['status']>, rally: boolean): BattleSetup {
  const buildings: BattleBuilding[] = [];
  for (const sec of setup.map.sectors) {
    for (const pad of sec.pads) {
      const ps = state.pads[pad.id];
      if (!ps || !ps.building || ps.building.hp <= 0) continue;
      buildings.push({ padId: pad.id, owner: ps.owner, type: ps.building.type, level: ps.building.level, hp: ps.building.hp, x: pad.x, y: pad.y, rally: sec.rally });
    }
  }
  const heroes: BattleHero[] = setup.players.map((p) => ({
    owner: p.id,
    heroClass: p.heroClass,
    level: heroLevel(state.players[p.id].xp),
    status: statuses[p.id] ?? 'absent',
    post: heroPost(setup, state, p.id),
  }));
  return {
    seed: setup.seed,
    day: state.day,
    map: setup.map,
    theme: setup.config.theme,
    intent: state.intent!,
    keep: { level: state.keep.level, hp: state.keep.hp },
    buildings,
    heroes,
    rally,
  };
}

export interface DayResolution {
  next: SeasonState;
  battle: BattleSetup;
  report: DayReport;
}

export function resolveDay(setup: SeasonSetup, prev: SeasonState, inputs: DayInputs | undefined): DayResolution {
  const state: SeasonState = structuredClone(prev);
  const cfg = setup.config;
  const spp = sectorsPerPlayer(setup.players.length);
  const day = state.day;

  // 1. economy
  const reports: Record<PlayerId, PlayerDayReport> = {};
  const statuses: Record<PlayerId, PlayerDayReport['status']> = {};
  let allReported = true;
  for (const p of setup.players) {
    const ps = state.players[p.id];
    const r = ratio(cfg, inputs?.checkins[p.id]);
    if (r === null) allReported = false;
    const gold = dayGold(cfg.days, r, spp);
    ps.gold += gold;
    ps.xp += xpGain(r);
    ps.missStreak = r === null ? ps.missStreak + 1 : 0;
    const status = heroStatus(r);
    statuses[p.id] = status;
    reports[p.id] = { r, goldEarned: gold, status, dormant: ps.missStreak >= ECON.dormantAfter, spent: 0, donated: 0, skipped: [] };
  }
  const rally = allReported && setup.players.length > 0;

  // 2. orders (join order)
  for (const p of setup.players) {
    const orders = inputs?.orders[p.id];
    if (orders && orders.length) applyOrders(setup, state, p.id, orders, reports[p.id]);
  }

  // 3. battle
  const battleSetup = buildBattleSetup(setup, state, statuses, rally);
  const keepBefore = state.keep.hp;
  const result = new Battle(battleSetup).runToEnd();

  // 4. after battle
  for (const [padId, hp] of Object.entries(result.buildingHp)) {
    const pad = state.pads[padId];
    if (!pad || !pad.building) continue;
    if (hp <= 0) {
      pad.building = null;
      pad.rubble = true;
    } else {
      pad.building.hp = Math.min(BUILDING_HP[pad.building.level - 1], hp);
    }
  }
  const maxKeep = KEEP.hp[state.keep.level - 1];
  const keepAfter = result.keepHp;
  const keepFell = keepAfter <= 0;
  let stars = 0;
  if (result.leaks === 0) stars = 3;
  else if (keepBefore - keepAfter <= maxKeep * STARS.twoStarKeepLoss && !keepFell) stars = 2;
  else if (!keepFell) stars = 1;
  state.stars.push(stars);
  let nextKeep = keepFell ? Math.ceil(maxKeep * KEEP.fallRestore) : keepAfter;
  nextKeep = Math.min(maxKeep, nextKeep + KEEP.regen);
  state.keep.hp = nextKeep;
  if (result.bossKilled) {
    state.bonusStars++;
    for (const p of setup.players) state.players[p.id].gold += ECON.bossBonusGold;
  }

  const best = (score: (pid: PlayerId) => number): PlayerId | null => {
    let bestId: PlayerId | null = null;
    let bestV = 0;
    for (const p of setup.players) {
      const v = score(p.id);
      if (v > bestV) {
        bestV = v;
        bestId = p.id;
      }
    }
    return bestId;
  };
  const report: DayReport = {
    day,
    rally,
    players: reports,
    battle: result,
    keepBefore,
    keepAfter,
    keepFell,
    stars,
    bossKilled: result.bossKilled,
    mvp: {
      damage: best((id) => result.stats[id]?.damage ?? 0),
      wall: best((id) => result.stats[id]?.blocks ?? 0),
      patron: best((id) => reports[id].donated),
    },
  };

  state.day = day + 1;
  state.intent = state.day <= cfg.days ? intentFor(setup, state.day) : null;
  return { next: state, battle: battleSetup, report };
}

export interface SeasonReplay {
  /** states[i] = state at the start of day i+1 */
  states: SeasonState[];
  reports: DayReport[];
  battles: BattleSetup[];
}

/** Replays days 1..upToDay (inclusive). inputsByDay[i] = inputs of day i+1. */
export function replaySeason(setup: SeasonSetup, inputsByDay: readonly (DayInputs | undefined)[], upToDay: number): SeasonReplay {
  const states = [createInitialState(setup)];
  const reports: DayReport[] = [];
  const battles: BattleSetup[] = [];
  const last = Math.min(upToDay, setup.config.days);
  for (let d = 1; d <= last; d++) {
    const res = resolveDay(setup, states[d - 1], inputsByDay[d - 1]);
    states.push(res.next);
    reports.push(res.report);
    battles.push(res.battle);
  }
  return { states, reports, battles };
}

export function seasonRank(state: SeasonState, days: number): { pct: number; rank: 'bronze' | 'silver' | 'gold' | 'legendary' } {
  const earned = state.stars.reduce((a, b) => a + b, 0) + state.bonusStars;
  const max = 3 * days + state.bonusStars;
  const pct = max > 0 ? earned / max : 0;
  const rank = pct >= 0.85 ? 'legendary' : pct >= 0.65 ? 'gold' : pct >= 0.4 ? 'silver' : 'bronze';
  return { pct, rank };
}

/** Economy + orders for the next day without the battle (planning preview). */
export function previewDay(setup: SeasonSetup, prev: SeasonState, inputs: DayInputs | undefined): { state: SeasonState; players: Record<PlayerId, PlayerDayReport>; rally: boolean } {
  const state: SeasonState = structuredClone(prev);
  const cfg = setup.config;
  const spp = sectorsPerPlayer(setup.players.length);
  const players: Record<PlayerId, PlayerDayReport> = {};
  let allReported = true;
  for (const p of setup.players) {
    const ps = state.players[p.id];
    const r = ratio(cfg, inputs?.checkins[p.id]);
    if (r === null) allReported = false;
    const gold = dayGold(cfg.days, r, spp);
    ps.gold += gold;
    ps.xp += xpGain(r);
    players[p.id] = { r, goldEarned: gold, status: heroStatus(r), dormant: false, spent: 0, donated: 0, skipped: [] };
  }
  for (const p of setup.players) {
    const orders = inputs?.orders[p.id];
    if (orders && orders.length) applyOrders(setup, state, p.id, orders, players[p.id]);
  }
  return { state, players, rally: allReported };
}
