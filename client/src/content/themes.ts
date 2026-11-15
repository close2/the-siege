// Force themes: enemy role names, tips, and boss metadata. See docs/design.md §7 & docs/art-list.md.
import i18n from '../i18n';
import type { EnemyRole, ThemeId } from '../sim/types';
export type { ThemeId };

export interface RoleThemeInfo {
  name: string;
  plural: string;
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

const ROLE_ICONS: Partial<Record<EnemyRole, string>> = {
  brute: 'armor',
  flyer: 'flying',
  siege: 'siege',
  boss: 'magic',
};

const THEME_META: Record<ThemeId, { ready: boolean; portraitBoss: string }> = {
  sugar: { ready: true, portraitBoss: 'portrait_boss_sugar' },
  sloth: { ready: false, portraitBoss: 'portrait_boss_sloth' },
  doom: { ready: false, portraitBoss: 'portrait_boss_doom' },
  ember: { ready: false, portraitBoss: 'portrait_boss_ember' },
};

const ROLES: readonly EnemyRole[] = ['grunt', 'runner', 'brute', 'flyer', 'siege', 'boss'];
const THEME_IDS: readonly ThemeId[] = ['sugar', 'sloth', 'doom', 'ember'];

export function getTheme(id: string): ThemeDef {
  const tid: ThemeId = (id in THEME_META ? id : 'sugar') as ThemeId;
  const meta = THEME_META[tid];
  const roles = {} as Record<EnemyRole, RoleThemeInfo>;
  for (const r of ROLES) {
    roles[r] = {
      name: i18n.t(`themes.${tid}.roles.${r}.name`),
      plural: i18n.t(`themes.${tid}.roles.${r}.plural`),
      tip: i18n.t(`themes.roleTips.${r}`),
      ...(ROLE_ICONS[r] ? { icon: ROLE_ICONS[r] } : {}),
    };
  }
  return {
    id: tid,
    ready: meta.ready,
    name: i18n.t(`themes.${tid}.name`),
    bossName: i18n.t(`themes.${tid}.bossName`),
    portraitBoss: meta.portraitBoss,
    roles,
  };
}

/** Themes that can be chosen for new challenges, localized to the active language. */
export function getSelectableThemes(): ThemeDef[] {
  return THEME_IDS.filter((id) => THEME_META[id].ready).map((id) => getTheme(id));
}
