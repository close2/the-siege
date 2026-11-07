// All balancing numbers. Never hard-code these elsewhere. See docs/design.md.
import type { BuildingType, DamageType, Difficulty, EnemyRole, HeroClass } from '../sim/types';

export const SIM_VERSION = 1;
export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

export const ECON = {
  startGold: 30,
  missBase: 4,
  missPerR: 6,
  hitGold: 12,
  overGold: 14,
  overR: 1.5,
  rCap: 4,
  incomeMultMin: 0.5,
  incomeMultMax: 3,
  incomeRefDays: 30,
  rallyFireRate: 1.15,
  xpHit: 2,
  xpMiss: 1,
  levelXp: [0, 4, 10, 18, 28],
  levelBonus: 0.12,
  dormantAfter: 3,
  wearyDmg: 0.8,
  inspiredDmg: 1.2,
  inspiredHp: 1.2,
  minDonate: 5,
  bossBonusGold: 10,
  repairFull: 10,
} as const;

export const BUILD_COST: Record<BuildingType, number> = { archer: 20, barracks: 20, mage: 30, catapult: 35 };
/** cost to reach L2, L3 */
export const UPGRADE_COST: Record<BuildingType, [number, number]> = {
  archer: [30, 50],
  barracks: [30, 50],
  mage: [30, 50],
  catapult: [35, 55],
};
export const BUILDING_HP = [300, 450, 600] as const;

export interface TowerStats {
  dtype: DamageType;
  range: [number, number, number];
  dmg: [number, number, number];
  /** attacks per second */
  rate: number;
  hitsFlying: boolean;
  /** projectile travel time in seconds */
  delay: number;
  splash?: number;
  minRange?: number;
  projectile: 'arrow' | 'bolt' | 'rock';
}

export const TOWERS: Record<Exclude<BuildingType, 'barracks'>, TowerStats> = {
  archer: { dtype: 'physical', range: [140, 155, 170], dmg: [10, 15, 22], rate: 1.0, hitsFlying: true, delay: 0.3, projectile: 'arrow' },
  mage: { dtype: 'magic', range: [120, 130, 140], dmg: [25, 38, 55], rate: 0.6, hitsFlying: true, delay: 0.25, projectile: 'bolt' },
  catapult: { dtype: 'physical', range: [180, 180, 180], dmg: [30, 45, 65], rate: 0.33, hitsFlying: false, delay: 0.8, splash: 40, minRange: 40, projectile: 'rock' },
};

export const BARRACKS = {
  soldiers: [2, 2, 3],
  hp: [100, 150, 200],
  dmg: [6, 9, 12],
  rate: 1,
  respawn: 8,
  aggro: 100,
  speed: 70,
  block: 1,
} as const;

export interface HeroStats {
  hp: number;
  dmg: number;
  rate: number;
  /** 0 = melee */
  range: number;
  dtype: DamageType;
  hitsFlying: boolean;
  block: number;
  heal?: number;
  healRadius?: number;
}

export const HEROES: Record<HeroClass, HeroStats> = {
  knight: { hp: 400, dmg: 15, rate: 1, range: 0, dtype: 'physical', hitsFlying: false, block: 2 },
  ranger: { hp: 220, dmg: 14, rate: 1.25, range: 130, dtype: 'physical', hitsFlying: true, block: 0 },
  priest: { hp: 200, dmg: 12, rate: 1, range: 110, dtype: 'magic', hitsFlying: true, block: 0, heal: 8, healRadius: 80 },
};
export const HERO_COMMON = { respawn: 10, speed: 70, aggro: 90, projectileDelay: 0.25 } as const;

export interface EnemyStats {
  hp: number;
  speed: number;
  armor: number;
  mr: number;
  flying: boolean;
  leak: number;
  cost: number;
  unlockP: number;
  /** melee damage per second vs defenders */
  melee: number;
  /** damage per second vs buildings (siege only) */
  siegeDps?: number;
  siegeRange?: number;
}

export const ENEMIES: Record<EnemyRole, EnemyStats> = {
  grunt: { hp: 60, speed: 30, armor: 0, mr: 0, flying: false, leak: 1, cost: 1, unlockP: 0, melee: 8 },
  runner: { hp: 40, speed: 55, armor: 0, mr: 0, flying: false, leak: 1, cost: 1.2, unlockP: 0.1, melee: 8 },
  brute: { hp: 220, speed: 22, armor: 0.5, mr: 0, flying: false, leak: 3, cost: 3, unlockP: 0.2, melee: 20 },
  flyer: { hp: 70, speed: 40, armor: 0, mr: 0, flying: true, leak: 2, cost: 2, unlockP: 0.3, melee: 0 },
  siege: { hp: 320, speed: 18, armor: 0.3, mr: 0, flying: false, leak: 5, cost: 4, unlockP: 0.4, melee: 15, siegeDps: 15, siegeRange: 60 },
  boss: { hp: 2500, speed: 15, armor: 0.3, mr: 0.3, flying: false, leak: 20, cost: 0, unlockP: 2, melee: 60 },
};
export const BOSS_AURA = { radius: 100, speedMult: 1.2 } as const;

export const KEEP = {
  hp: [100, 130, 160],
  fund: [150, 400],
  archer: { range: 160, dmg: [8, 12, 16], rate: 1.5, delay: 0.3 },
  regen: 5,
  fallRestore: 0.5,
} as const;

export const WAVES = {
  basePerSector: 6,
  ramp: 5.5,
  featuredShare: 0.4,
  bossBudgetFactor: 0.5,
  spawnWindow: 30,
  groupMin: 3,
  groupMax: 5,
  bossSpawnAt: 10,
  bossEvery: 7,
  bossMinDays: 14,
  difficulty: { very_easy: 0.6, easy: 0.8, normal: 1.05, hard: 1.35 } as Record<Difficulty, number>,
} as const;

export const BATTLE = {
  maxSeconds: 120,
  meleeRange: 16,
  laneSpread: 14,
  keepPostOffset: 90,
} as const;

export const STARS = { twoStarKeepLoss: 0.1 } as const;
