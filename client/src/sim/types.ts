// Core sim types. See docs/design.md.

export type PlayerId = string;
export type PadId = string;
export type SectorId = string;
export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'];

export type BuildingType = 'archer' | 'mage' | 'barracks' | 'catapult';
export const BUILDING_TYPES: readonly BuildingType[] = ['archer', 'barracks', 'mage', 'catapult'];
export type HeroClass = 'knight' | 'ranger' | 'priest';
export type EnemyRole = 'grunt' | 'runner' | 'brute' | 'flyer' | 'siege' | 'boss';
export type DamageType = 'physical' | 'magic';
export type Difficulty = 'very_easy' | 'easy' | 'normal' | 'hard';
export type ChallengeType = 'binary' | 'checklist' | 'numeric';
export type ThemeId = 'sugar' | 'sloth' | 'doom' | 'ember';
export type Level = 1 | 2 | 3;

export interface Pt {
  x: number;
  y: number;
}

// ---------- Config & setup ----------

export interface ChallengeConfig {
  title: string;
  type: ChallengeType;
  /** checklist rule texts (binary: exactly one) */
  rules: string[];
  /** numeric only */
  target?: number;
  unit?: string;
  direction?: 'higher' | 'lower';
  /** YYYY-MM-DD */
  startDate: string;
  /** number of active days D (7..90) */
  days: number;
  /** IANA time zone */
  timeZone: string;
  /** HH:MM */
  dawnTime: string;
  difficulty: Difficulty;
  theme: ThemeId;
  /** YYYY-MM-DD dates that are inactive */
  inactiveDates: string[];
}

export interface SetupPlayer {
  id: PlayerId;
  name: string;
  heroClass: HeroClass;
}

export interface SeasonSetup {
  config: ChallengeConfig;
  /** hex seed from server */
  seed: string;
  simVersion: number;
  /** in join order */
  players: SetupPlayer[];
  map: MapDef;
}

// ---------- Map ----------

export interface PadDef extends Pt {
  id: PadId;
}

export interface SectorDef {
  id: SectorId;
  road: Dir;
  ring: 'outer' | 'inner';
  pads: PadDef[];
  rally: Pt;
  heroSpawn: Pt;
}

export interface MapDef {
  id: string;
  width: number;
  height: number;
  keep: Pt;
  /** polyline from map edge to keep */
  roads: Record<Dir, Pt[]>;
  sectors: SectorDef[];
}

// ---------- Inputs ----------

export type Checkin = { kept: boolean[] } | { value: number };

export type StanceMode = 'own' | 'neighbor' | 'keep';
export interface Stance {
  mode: StanceMode;
  sector?: SectorId;
}

export type Order =
  | { kind: 'build'; pad: PadId; type: BuildingType }
  | { kind: 'upgrade'; pad: PadId }
  | { kind: 'repair'; pad: PadId }
  | { kind: 'donate'; to: PlayerId | 'keep'; amount: number }
  | { kind: 'stance'; mode: StanceMode; sector?: SectorId };

export interface DayInputs {
  checkins: Record<PlayerId, Checkin | null | undefined>;
  orders: Record<PlayerId, Order[] | undefined>;
}

// ---------- State ----------

export interface BuildingState {
  type: BuildingType;
  level: Level;
  hp: number;
}

export interface PadState {
  owner: PlayerId | null;
  building: BuildingState | null;
  rubble: boolean;
}

export type HeroStatus = 'absent' | 'weary' | 'normal' | 'inspired';

export interface PlayerState {
  gold: number;
  xp: number;
  missStreak: number;
  stance: Stance;
  sectors: SectorId[];
}

export interface KeepState {
  level: Level;
  hp: number;
  /** cumulative gold donated */
  fund: number;
}

export interface RoadIntent {
  counts: Partial<Record<EnemyRole, number>>;
  featured: EnemyRole;
  boss: boolean;
}

export interface Intent {
  day: number;
  roads: Partial<Record<Dir, RoadIntent>>;
  bossNight: boolean;
  bossScale: number;
}

export interface SeasonState {
  /** next day to resolve (1..D+1) */
  day: number;
  keep: KeepState;
  players: Record<PlayerId, PlayerState>;
  pads: Record<PadId, PadState>;
  /** stars per resolved day */
  stars: number[];
  bonusStars: number;
  /** intent for `day` (null after the season) */
  intent: Intent | null;
}

// ---------- Battle ----------

export interface BattleHero {
  owner: PlayerId;
  heroClass: HeroClass;
  level: number;
  status: HeroStatus;
  /** position the hero defends */
  post: Pt;
}

export interface BattleBuilding {
  padId: PadId;
  owner: PlayerId | null;
  type: BuildingType;
  level: Level;
  hp: number;
  x: number;
  y: number;
  /** barracks rally point */
  rally: Pt;
}

export interface BattleSetup {
  seed: string;
  day: number;
  map: MapDef;
  theme: ThemeId;
  intent: Intent;
  keep: { level: Level; hp: number };
  buildings: BattleBuilding[];
  heroes: BattleHero[];
  rally: boolean;
}

export interface PlayerBattleStats {
  damage: number;
  kills: number;
  blocks: number;
}

export interface BattleResult {
  keepHp: number;
  leaks: number;
  leakDamage: number;
  buildingHp: Record<PadId, number>;
  bossSpawned: boolean;
  bossKilled: boolean;
  stats: Record<PlayerId, PlayerBattleStats>;
  ticks: number;
}

// ---------- Reports ----------

export interface SkippedOrder {
  order: Order;
  reason: string;
}

export interface PlayerDayReport {
  r: number | null;
  goldEarned: number;
  status: HeroStatus;
  dormant: boolean;
  spent: number;
  donated: number;
  skipped: SkippedOrder[];
}

export interface DayReport {
  day: number;
  rally: boolean;
  players: Record<PlayerId, PlayerDayReport>;
  battle: BattleResult;
  keepBefore: number;
  keepAfter: number;
  keepFell: boolean;
  stars: number;
  bossKilled: boolean;
  mvp: { damage: PlayerId | null; wall: PlayerId | null; patron: PlayerId | null };
}
