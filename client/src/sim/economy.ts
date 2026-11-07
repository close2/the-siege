// Check-in → gold, hero status, XP. design.md §3
import { ECON } from '../content/stats';
import type { ChallengeConfig, Checkin, HeroStatus } from './types';

export function incomeMultiplier(days: number): number {
  return Math.min(ECON.incomeMultMax, Math.max(ECON.incomeMultMin, ECON.incomeRefDays / days));
}

/** Achievement ratio r in [0, 4], or null if not reported / invalid. */
export function ratio(config: ChallengeConfig, checkin: Checkin | null | undefined): number | null {
  if (!checkin) return null;
  let r: number;
  if ('kept' in checkin) {
    if (config.type === 'numeric' || checkin.kept.length === 0) return null;
    let kept = 0;
    for (const k of checkin.kept) if (k) kept++;
    r = kept / checkin.kept.length;
  } else {
    if (config.type !== 'numeric' || !config.target || !Number.isFinite(checkin.value)) return null;
    if (config.direction === 'lower') {
      r = checkin.value <= 0 ? ECON.rCap : config.target / checkin.value;
    } else {
      r = checkin.value / config.target;
    }
  }
  return Math.min(ECON.rCap, Math.max(0, r));
}

export function baseGold(r: number | null): number {
  if (r === null) return 0;
  if (r < 1) return ECON.missBase + ECON.missPerR * r;
  if (r < ECON.overR) return ECON.hitGold;
  return ECON.overGold;
}

export function heroStatus(r: number | null): HeroStatus {
  if (r === null) return 'absent';
  if (r < 1) return 'weary';
  if (r < ECON.overR) return 'normal';
  return 'inspired';
}

export function dayGold(days: number, r: number | null, sectorsPerPlayer: number): number {
  return Math.round(baseGold(r) * incomeMultiplier(days) * sectorsPerPlayer);
}

export function xpGain(r: number | null): number {
  if (r === null) return 0;
  return r >= 1 ? ECON.xpHit : ECON.xpMiss;
}

export function heroLevel(xp: number): number {
  let lvl = 1;
  for (let i = 0; i < ECON.levelXp.length; i++) if (xp >= ECON.levelXp[i]) lvl = i + 1;
  return lvl;
}

export function heroMultipliers(level: number, status: HeroStatus): { hp: number; dmg: number } {
  const lv = 1 + ECON.levelBonus * (level - 1);
  let hp = lv;
  let dmg = lv;
  if (status === 'weary') dmg *= ECON.wearyDmg;
  if (status === 'inspired') {
    dmg *= ECON.inspiredDmg;
    hp *= ECON.inspiredHp;
  }
  return { hp, dmg };
}
