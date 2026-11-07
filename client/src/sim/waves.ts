// Wave intent generation. design.md §8
import { ENEMIES, WAVES } from '../content/stats';
import { rngFor } from './rng';
import type { Difficulty, Dir, EnemyRole, Intent, RoadIntent, SectorId } from './types';
import { DIRS } from './types';

export function progress(day: number, days: number): number {
  return days <= 1 ? 1 : (day - 1) / (days - 1);
}

export function isBossNight(day: number, days: number): boolean {
  if (day === days) return true;
  return days >= WAVES.bossMinDays && day % WAVES.bossEvery === 0;
}

export function unlockedRoles(p: number): EnemyRole[] {
  const roles: EnemyRole[] = ['grunt', 'runner', 'brute', 'flyer', 'siege'];
  return roles.filter((r) => p >= ENEMIES[r].unlockP);
}

/**
 * @param ownedSectors all sectors that have an owner
 */
export function generateIntent(
  seed: string,
  day: number,
  days: number,
  difficulty: Difficulty,
  ownedSectors: readonly SectorId[],
  playerCount: number,
): Intent {
  const p = progress(day, days);
  const bossNight = isBossNight(day, days);
  const sectorsOnRoad: Partial<Record<Dir, number>> = {};
  for (const s of ownedSectors) {
    const d = s.split('-')[0] as Dir;
    sectorsOnRoad[d] = (sectorsOnRoad[d] ?? 0) + 1;
  }
  const activeRoads = DIRS.filter((d) => (sectorsOnRoad[d] ?? 0) > 0);
  const bossRng = rngFor(seed, day, 'boss');
  const bossRoad: Dir | null = bossNight && activeRoads.length > 0 ? bossRng.pick(activeRoads) : null;

  const unlocked = unlockedRoles(p);
  const featuredPool = unlocked.length > 1 ? unlocked.filter((r) => r !== 'grunt') : unlocked;
  const fillers: EnemyRole[] = unlocked.includes('runner') ? ['grunt', 'runner'] : ['grunt'];

  const roads: Partial<Record<Dir, RoadIntent>> = {};
  for (const d of activeRoads) {
    const rng = rngFor(seed, day, 'wave', d);
    let budget = WAVES.basePerSector * (1 + WAVES.ramp * p) * WAVES.difficulty[difficulty] * (sectorsOnRoad[d] ?? 0);
    if (d === bossRoad) budget *= WAVES.bossBudgetFactor;
    const featured = rng.pick(featuredPool);
    const counts: Partial<Record<EnemyRole, number>> = {};
    const add = (r: EnemyRole) => {
      counts[r] = (counts[r] ?? 0) + 1;
    };
    let featuredBudget = budget * WAVES.featuredShare;
    budget -= featuredBudget;
    const fc = ENEMIES[featured].cost;
    let placedFeatured = 0;
    while (featuredBudget >= fc || (placedFeatured === 0 && budget + featuredBudget >= fc)) {
      add(featured);
      placedFeatured++;
      if (featuredBudget >= fc) featuredBudget -= fc;
      else {
        budget -= fc - featuredBudget;
        featuredBudget = 0;
      }
    }
    budget += featuredBudget;
    while (budget >= 1) {
      const r = rng.pick(fillers);
      const c = ENEMIES[r].cost;
      if (c > budget) {
        add('grunt');
        budget -= 1;
      } else {
        add(r);
        budget -= c;
      }
    }
    if (d === bossRoad) counts.boss = 1;
    roads[d] = { counts, featured, boss: d === bossRoad };
  }
  const bossScale = 0.5 + 0.5 * playerCount * (0.6 + 0.4 * p);
  return { day, roads, bossNight, bossScale };
}

export function intentEnemyTotal(intent: Intent): number {
  let n = 0;
  for (const d of DIRS) {
    const r = intent.roads[d];
    if (!r) continue;
    for (const c of Object.values(r.counts)) n += c ?? 0;
  }
  return n;
}
