// Test fixtures shared by sim tests, sandbox and local mode.
import valley from '../content/maps/valley.json';
import { SIM_VERSION } from '../content/stats';
import type { ChallengeConfig, HeroClass, MapDef, SeasonSetup } from './types';

export const VALLEY = valley as unknown as MapDef;

export function demoConfig(over: Partial<ChallengeConfig> = {}): ChallengeConfig {
  return {
    title: 'No sugar',
    type: 'binary',
    rules: ['No sugar today'],
    startDate: '2026-11-09',
    days: 30,
    timeZone: 'Europe/Berlin',
    dawnTime: '11:00',
    difficulty: 'normal',
    theme: 'sugar',
    inactiveDates: [],
    ...over,
  };
}

const CLASSES: HeroClass[] = ['knight', 'ranger', 'priest'];

export function demoSetup(players = 4, over: Partial<ChallengeConfig> = {}, seed = 'c0ffee1234567890'): SeasonSetup {
  return {
    config: demoConfig(over),
    seed,
    simVersion: SIM_VERSION,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, heroClass: CLASSES[i % 3] })),
    map: VALLEY,
  };
}
