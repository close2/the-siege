// Bot players for local play, tests and balancing. tasks.md T1.10
import { BUILD_COST, BUILDING_HP } from '../content/stats';
import { dayGold, ratio } from './economy';
import { sectorById, sectorsPerPlayer } from './map';
import { repairCost, upgradeCost } from './orders';
import { rngFor } from './rng';
import type { BuildingType, Checkin, Dir, EnemyRole, Order, PlayerId, SeasonSetup, SeasonState } from './types';

export function botCheckin(setup: SeasonSetup, pid: PlayerId, day: number, q: number): Checkin {
  const rng = rngFor(setup.seed, 'bot-checkin', pid, day);
  const hit = rng.float() < q;
  const c = setup.config;
  if (c.type === 'numeric') {
    const t = c.target ?? 1;
    if (c.direction === 'lower') return { value: hit ? t * (0.6 + 0.4 * rng.float()) : t * (1.2 + rng.float()) };
    return { value: hit ? t * (1 + 0.6 * rng.float()) : t * 0.9 * rng.float() };
  }
  const n = Math.max(1, c.rules.length);
  if (hit) return { kept: new Array(n).fill(true) };
  const kept = new Array(n).fill(false).map(() => rng.float() < 0.5);
  if (kept.every(Boolean)) kept[0] = false;
  return { kept };
}

const COUNTER: Record<EnemyRole, BuildingType> = {
  grunt: 'barracks',
  runner: 'archer',
  brute: 'mage',
  flyer: 'archer',
  siege: 'mage',
  boss: 'mage',
};

export function botOrders(setup: SeasonSetup, state: SeasonState, pid: PlayerId, checkin: Checkin | null): Order[] {
  const ps = state.players[pid];
  let gold = ps.gold + dayGold(setup.config.days, ratio(setup.config, checkin), sectorsPerPlayer(setup.players.length));
  const orders: Order[] = [];
  const pads = ps.sectors.flatMap((sid) => sectorById(setup.map, sid)?.pads ?? []);
  const road = ps.sectors[0]?.split('-')[0] as Dir | undefined;
  const featured = road ? state.intent?.roads[road]?.featured : undefined;
  const want: BuildingType = featured ? COUNTER[featured] : 'archer';

  // 1. repair heavily damaged
  for (const pad of pads) {
    const b = state.pads[pad.id].building;
    if (!b) continue;
    const max = BUILDING_HP[b.level - 1];
    if (b.hp < max * 0.5) {
      const cost = repairCost(b.hp, max);
      if (cost <= gold) {
        orders.push({ kind: 'repair', pad: pad.id });
        gold -= cost;
      }
    }
  }
  // 2. build on empty pads
  for (const pad of pads) {
    const st = state.pads[pad.id];
    if (st.building) continue;
    const type = BUILD_COST[want] <= gold ? want : BUILD_COST.archer <= gold ? 'archer' : null;
    if (!type) break;
    orders.push({ kind: 'build', pad: pad.id, type });
    gold -= BUILD_COST[type];
  }
  // 3. upgrade cheapest
  const upgradable = pads
    .map((pad) => ({ pad, b: state.pads[pad.id].building }))
    .filter((x) => x.b && x.b.level < 3)
    .sort((a, b) => a.b!.level - b.b!.level);
  for (const { pad, b } of upgradable) {
    const cost = upgradeCost(b!.type, b!.level);
    if (cost !== null && cost <= gold) {
      orders.push({ kind: 'upgrade', pad: pad.id });
      gold -= cost;
    }
  }
  return orders;
}
