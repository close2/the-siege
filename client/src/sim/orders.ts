// Order validation & application. design.md §4
import { BUILD_COST, BUILDING_HP, ECON, KEEP, UPGRADE_COST } from '../content/stats';
import { padById, sectorById } from './map';
import type { KeepState, Level, Order, PlayerDayReport, PlayerId, SeasonSetup, SeasonState } from './types';

export const MAX_ORDERS_PER_DAY = 30;

export function repairCost(hp: number, maxHp: number): number {
  if (hp >= maxHp) return 0;
  return Math.max(1, Math.ceil((ECON.repairFull * (maxHp - hp)) / maxHp));
}

export function upgradeCost(type: keyof typeof UPGRADE_COST, level: Level): number | null {
  if (level >= 3) return null;
  return UPGRADE_COST[type][level - 1];
}

export function addKeepFund(keep: KeepState, amount: number) {
  keep.fund += amount;
  while (keep.level < 3 && keep.fund >= KEEP.fund[keep.level - 1]) {
    const oldMax = KEEP.hp[keep.level - 1];
    keep.level = (keep.level + 1) as Level;
    keep.hp += KEEP.hp[keep.level - 1] - oldMax;
  }
}

/** Mutates state. Returns nothing; skipped orders and spending are written into report. */
export function applyOrders(
  setup: SeasonSetup,
  state: SeasonState,
  pid: PlayerId,
  orders: readonly Order[],
  report: PlayerDayReport,
): void {
  const player = state.players[pid];
  if (!player) return;
  const skip = (order: Order, reason: string) => report.skipped.push({ order, reason });
  orders.slice(0, MAX_ORDERS_PER_DAY).forEach((order) => {
    switch (order.kind) {
      case 'build': {
        const pad = state.pads[order.pad];
        if (!pad || !padById(setup.map, order.pad)) return skip(order, 'unknown pad');
        if (pad.owner !== pid) return skip(order, 'not your pad');
        if (pad.building) return skip(order, 'pad occupied');
        const cost = BUILD_COST[order.type];
        if (cost === undefined) return skip(order, 'unknown building');
        if (player.gold < cost) return skip(order, 'not enough gold');
        player.gold -= cost;
        report.spent += cost;
        pad.building = { type: order.type, level: 1, hp: BUILDING_HP[0] };
        pad.rubble = false;
        return;
      }
      case 'upgrade': {
        const pad = state.pads[order.pad];
        if (!pad || pad.owner !== pid) return skip(order, 'not your pad');
        const b = pad.building;
        if (!b) return skip(order, 'nothing to upgrade');
        const cost = upgradeCost(b.type, b.level);
        if (cost === null) return skip(order, 'max level');
        if (player.gold < cost) return skip(order, 'not enough gold');
        player.gold -= cost;
        report.spent += cost;
        const oldMax = BUILDING_HP[b.level - 1];
        b.level = (b.level + 1) as Level;
        b.hp += BUILDING_HP[b.level - 1] - oldMax;
        return;
      }
      case 'repair': {
        const pad = state.pads[order.pad];
        if (!pad || pad.owner !== pid) return skip(order, 'not your pad');
        const b = pad.building;
        if (!b) return skip(order, 'nothing to repair');
        const max = BUILDING_HP[b.level - 1];
        const cost = repairCost(b.hp, max);
        if (cost === 0) return skip(order, 'not damaged');
        if (player.gold < cost) return skip(order, 'not enough gold');
        player.gold -= cost;
        report.spent += cost;
        b.hp = max;
        return;
      }
      case 'donate': {
        const amount = Math.floor(order.amount);
        if (!(amount >= ECON.minDonate)) return skip(order, `minimum ${ECON.minDonate}`);
        if (player.gold < amount) return skip(order, 'not enough gold');
        if (order.to === 'keep') {
          player.gold -= amount;
          addKeepFund(state.keep, amount);
        } else {
          const other = state.players[order.to];
          if (!other || order.to === pid) return skip(order, 'unknown player');
          player.gold -= amount;
          other.gold += amount;
        }
        report.donated += amount;
        return;
      }
      case 'stance': {
        if (order.mode === 'neighbor') {
          if (!order.sector || !sectorById(setup.map, order.sector)) return skip(order, 'unknown sector');
          player.stance = { mode: 'neighbor', sector: order.sector };
        } else if (order.mode === 'own' || order.mode === 'keep') {
          player.stance = { mode: order.mode };
        } else return skip(order, 'unknown stance');
        return;
      }
      default:
        skip(order, 'unknown order');
    }
  });
}
