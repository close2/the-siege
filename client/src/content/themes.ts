// Force themes: enemy role names, tips, and boss metadata. See docs/design.md §7 & docs/art-list.md.
import type { EnemyRole, ThemeId } from '../sim/types';
export type { ThemeId };

export interface RoleThemeInfo {
  name: string;
  tip: string;
  icon?: string;
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  /** true once every enemy/boss sprite and the boss portrait for this theme exist (see docs/art-list.md "Later themes") */
  ready: boolean;
  bossName: string;
  portraitBoss: string;
  roles: Record<EnemyRole, RoleThemeInfo>;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  sugar: {
    id: 'sugar',
    ready: true,
    name: 'The Sugar Horde',
    bossName: 'The Sugar Wraith',
    portraitBoss: 'portrait_boss_sugar',
    roles: {
      grunt: { name: 'Gummy Grunt', tip: 'Basic foot soldier.' },
      runner: { name: 'Candy Imp', tip: 'Fast! Archers and soldiers catch them.' },
      brute: { name: 'Choco Brute', tip: 'Armoured — arrows barely scratch it. Use mages.', icon: 'armor' },
      flyer: { name: 'Floss Bat', tip: 'Flies over soldiers. Only archers, mages, rangers and priestesses hit it.', icon: 'flying' },
      siege: { name: 'Cake Golem', tip: 'Smashes buildings in passing. Kill it fast; repair afterwards.', icon: 'siege' },
      boss: { name: 'The Sugar Wraith', tip: 'Boss. Huge health, speeds up nearby enemies.', icon: 'magic' },
    },
  },
  sloth: {
    id: 'sloth',
    ready: false,
    name: 'The Sloth Mire',
    bossName: 'The Moss Colossus',
    portraitBoss: 'portrait_boss_sloth',
    roles: {
      grunt: { name: 'Snooze Creep', tip: 'Basic foot soldier.' },
      runner: { name: 'Pillow Sprite', tip: 'Fast! Archers and soldiers catch them.' },
      brute: { name: 'Couch Troll', tip: 'Armoured — arrows barely scratch it. Use mages.', icon: 'armor' },
      flyer: { name: 'Dream Moth', tip: 'Flies over soldiers. Only archers, mages, rangers and priestesses hit it.', icon: 'flying' },
      siege: { name: 'Peat Hulk', tip: 'Smashes buildings in passing. Kill it fast; repair afterwards.', icon: 'siege' },
      boss: { name: 'The Moss Colossus', tip: 'Boss. Huge health, speeds up nearby enemies.', icon: 'magic' },
    },
  },
  doom: {
    id: 'doom',
    ready: false,
    name: 'The Doomscroll Swarm',
    bossName: 'The Endless Feed',
    portraitBoss: 'portrait_boss_doom',
    roles: {
      grunt: { name: 'Screen Walker', tip: 'Basic foot soldier.' },
      runner: { name: 'Ping Gremlin', tip: 'Fast! Archers and soldiers catch them.' },
      brute: { name: 'Static Golem', tip: 'Armoured — arrows barely scratch it. Use mages.', icon: 'armor' },
      flyer: { name: 'Glitch Eye', tip: 'Flies over soldiers. Only archers, mages, rangers and priestesses hit it.', icon: 'flying' },
      siege: { name: 'Tower Monolith', tip: 'Smashes buildings in passing. Kill it fast; repair afterwards.', icon: 'siege' },
      boss: { name: 'The Endless Feed', tip: 'Boss. Huge health, speeds up nearby enemies.', icon: 'magic' },
    },
  },
  ember: {
    id: 'ember',
    ready: false,
    name: 'The Ember Host',
    bossName: 'The Cinder Sovereign',
    portraitBoss: 'portrait_boss_ember',
    roles: {
      grunt: { name: 'Ash Imp', tip: 'Basic foot soldier.' },
      runner: { name: 'Spark Hound', tip: 'Fast! Archers and soldiers catch them.' },
      brute: { name: 'Basalt Brute', tip: 'Armoured — arrows barely scratch it. Use mages.', icon: 'armor' },
      flyer: { name: 'Cinder Drake', tip: 'Flies over soldiers. Only archers, mages, rangers and priestesses hit it.', icon: 'flying' },
      siege: { name: 'Magma Ram', tip: 'Smashes buildings in passing. Kill it fast; repair afterwards.', icon: 'siege' },
      boss: { name: 'The Cinder Sovereign', tip: 'Boss. Huge health, speeds up nearby enemies.', icon: 'magic' },
    },
  },
};

/** Themes that can be chosen for new challenges. */
export const SELECTABLE_THEMES: readonly ThemeDef[] = Object.values(THEMES).filter((t) => t.ready);

export function getTheme(id: string): ThemeDef {
  return THEMES[id as ThemeId] ?? THEMES.sugar;
}
