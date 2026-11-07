// Art ids → display size in world px (map is 2048×2048) and placeholder look.
// Heights are the on-map height of the visible object. See docs/art-list.md.

export type ArtKind = 'unit' | 'building' | 'keep' | 'pad' | 'proj' | 'ui' | 'icon' | 'portrait' | 'background';

export interface ArtSpec {
  kind: ArtKind;
  /** display height in world px */
  h: number;
  color: number;
  label: string;
}

const u = (h: number, color: number, label: string): ArtSpec => ({ kind: 'unit', h, color, label });
const b = (h: number, color: number, label: string): ArtSpec => ({ kind: 'building', h, color, label });

export const ART: Record<string, ArtSpec> = {
  map_valley: { kind: 'background', h: 2048, color: 0x5d8a3a, label: 'map' },
  keep_1: { kind: 'keep', h: 240, color: 0x8a8f9c, label: 'K1' },
  keep_2: { kind: 'keep', h: 270, color: 0x9aa0ae, label: 'K2' },
  keep_3: { kind: 'keep', h: 300, color: 0xb0b6c4, label: 'K3' },
  pad_empty: { kind: 'pad', h: 70, color: 0x9c9a90, label: '' },
  rubble: { kind: 'pad', h: 80, color: 0x5b4a3a, label: 'x' },

  building_archer_1: b(130, 0xb5793a, 'A1'),
  building_archer_2: b(150, 0xb5793a, 'A2'),
  building_archer_3: b(170, 0xb5793a, 'A3'),
  building_mage_1: b(130, 0x7a5cc9, 'M1'),
  building_mage_2: b(150, 0x7a5cc9, 'M2'),
  building_mage_3: b(175, 0x7a5cc9, 'M3'),
  building_barracks_1: b(105, 0x3f6fb5, 'B1'),
  building_barracks_2: b(120, 0x3f6fb5, 'B2'),
  building_barracks_3: b(135, 0x3f6fb5, 'B3'),
  building_catapult_1: b(100, 0x8a6a45, 'C1'),
  building_catapult_2: b(115, 0x8a6a45, 'C2'),
  building_catapult_3: b(135, 0x8a6a45, 'C3'),

  hero_knight: u(62, 0x3d7bd9, 'Kn'),
  hero_knight_attack: u(62, 0x3d7bd9, 'Kn!'),
  hero_ranger: u(60, 0x3aa65a, 'Ra'),
  hero_ranger_attack: u(60, 0x3aa65a, 'Ra!'),
  hero_priest: u(60, 0xe8d27a, 'Pr'),
  hero_priest_attack: u(60, 0xe8d27a, 'Pr!'),
  soldier_footman: u(44, 0x5a86c4, 'S'),
  soldier_footman_attack: u(44, 0x5a86c4, 'S!'),

  enemy_sugar_grunt: u(40, 0xd9363e, 'g'),
  enemy_sugar_runner: u(36, 0xf07aa0, 'r'),
  enemy_sugar_brute: u(70, 0x6b3a1e, 'B'),
  enemy_sugar_flyer: u(44, 0xc79be8, 'f'),
  enemy_sugar_siege: u(84, 0xf3d9b1, 'S'),
  boss_sugar_wraith: u(160, 0xe0589e, 'BOSS'),
  boss_sugar_wraith_attack: u(160, 0xe0589e, 'BOSS!'),

  enemy_sloth_grunt: u(40, 0x6b8e4e, 'g'),
  enemy_sloth_runner: u(36, 0x9ab87a, 'r'),
  enemy_sloth_brute: u(70, 0x4a5d3a, 'B'),
  enemy_sloth_flyer: u(44, 0x8fa8b8, 'f'),
  enemy_sloth_siege: u(84, 0x5c5242, 'S'),
  boss_sloth: u(160, 0x3f6b3a, 'BOSS'),
  boss_sloth_attack: u(160, 0x3f6b3a, 'BOSS!'),

  enemy_doom_grunt: u(40, 0x4a6fa5, 'g'),
  enemy_doom_runner: u(36, 0x5ad2f0, 'r'),
  enemy_doom_brute: u(70, 0x2f3e5c, 'B'),
  enemy_doom_flyer: u(44, 0x8a6be8, 'f'),
  enemy_doom_siege: u(84, 0x3d4856, 'S'),
  boss_doom: u(160, 0x6a3de8, 'BOSS'),
  boss_doom_attack: u(160, 0x6a3de8, 'BOSS!'),

  enemy_ember_grunt: u(40, 0xd95a2b, 'g'),
  enemy_ember_runner: u(36, 0xff9a2e, 'r'),
  enemy_ember_brute: u(70, 0x5c2c1e, 'B'),
  enemy_ember_flyer: u(44, 0xe86a3a, 'f'),
  enemy_ember_siege: u(84, 0x8a3a22, 'S'),
  boss_ember: u(160, 0xff451a, 'BOSS'),
  boss_ember_attack: u(160, 0xff451a, 'BOSS!'),

  proj_arrow: { kind: 'proj', h: 6, color: 0xeadbb5, label: '' },
  proj_rock: { kind: 'proj', h: 16, color: 0x77736a, label: '' },
};

export const MANIFEST_IDS: readonly string[] = [
  'map_valley',
  'keyart_title',
  'keyart_victory',
  'keyart_defeat',
  'app_icon',
  'keep_1',
  'keep_2',
  'keep_3',
  'pad_empty',
  'rubble',
  'building_archer_1',
  'building_archer_2',
  'building_archer_3',
  'building_mage_1',
  'building_mage_2',
  'building_mage_3',
  'building_barracks_1',
  'building_barracks_2',
  'building_barracks_3',
  'building_catapult_1',
  'building_catapult_2',
  'building_catapult_3',
  'hero_knight',
  'hero_knight_attack',
  'hero_ranger',
  'hero_ranger_attack',
  'hero_priest',
  'hero_priest_attack',
  'soldier_footman',
  'soldier_footman_attack',
  'enemy_sugar_grunt',
  'enemy_sugar_runner',
  'enemy_sugar_brute',
  'enemy_sugar_flyer',
  'enemy_sugar_siege',
  'boss_sugar_wraith',
  'boss_sugar_wraith_attack',
  'proj_arrow',
  'proj_rock',
  'portrait_knight',
  'portrait_ranger',
  'portrait_priest',
  'portrait_boss_sugar',
  'ui_panel',
  'ui_button',
  'ui_button_gold',
  'ui_banner',
  'ui_ribbon',
  'icon_gold',
  'icon_star',
  'icon_star_empty',
  'icon_heart',
  'icon_physical',
  'icon_magic',
  'icon_armor',
  'icon_flying',
  'icon_siege',
  'icon_streak',
  'icon_rally',
  'icon_repair',
  'icon_check',
];

const BOSS_ART: Record<string, string> = {
  sugar: 'boss_sugar_wraith',
  sloth: 'boss_sloth',
  doom: 'boss_doom',
  ember: 'boss_ember',
};

export function enemyArtId(theme: string, role: string): string {
  return role === 'boss' ? BOSS_ART[theme] ?? `boss_${theme}` : `enemy_${theme}_${role}`;
}
