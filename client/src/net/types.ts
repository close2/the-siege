import { translateApiError } from '../i18n/format';
import type { ChallengeConfig, HeroClass } from '../sim/types';

export interface User {
  id: string;
  name: string;
  deviceId?: string;
  deviceCount?: number;
  challengeCount?: number;
}

export interface DeviceSession {
  id: string;
  label: string | null;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

export interface Member {
  userId: string;
  name: string;
  heroClass: HeroClass;
  joinOrder: number;
  bot?: boolean;
}

export interface Challenge {
  id: string;
  config: ChallengeConfig;
  seed: string;
  simVersion: number;
  inviteCode: string;
  creatorId: string;
  members: Member[];
  local?: boolean;
  seenDay?: number;
}

export interface ChallengeSummary {
  id: string;
  title: string;
  startDate: string;
  days: number;
  memberCount: number;
  creatorName: string;
  joinable: boolean;
}

export type EventKind = 'checkin' | 'orders' | 'hash';

export type PutEventResult = 'synced' | 'queued';

export interface PendingEvent {
  id: string;
  day: number;
  kind: EventKind;
  payload: unknown;
}

export interface GameEvent {
  seq: number;
  day: number;
  userId: string;
  kind: EventKind;
  payload: unknown;
  updatedAt: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly params?: Record<string, unknown>,
  ) {
    super(message);
  }

  static fromCode(status: number, code: string, params?: Record<string, unknown>, fallback?: string): ApiError {
    return new ApiError(status, translateApiError(code, params, fallback), code, params);
  }
}

export const DRY_RUN_ID = 'dryrun';

export interface Backend {
  readonly mode: 'local' | 'http';
  /** server-corrected time (ms); pass challengeId to include any per-challenge demo offset */
  now(challengeId?: string): number;
  me(): Promise<User | null>;
  refreshMe?(): Promise<User | null>;
  register(name: string): Promise<User>;
  rename(name: string): Promise<void>;
  transferCode(): Promise<{ code: string; expiresAt: number }>;
  claim(code: string): Promise<User>;
  devices?(): Promise<DeviceSession[]>;
  revokeDevice?(id: string): Promise<void>;
  listChallenges(): Promise<Challenge[]>;
  createChallenge(config: ChallengeConfig, heroClass: HeroClass, opts?: { bots?: number }): Promise<Challenge>;
  /** create or reset the local 3-day guided dry-run challenge with bot teammates */
  startDryRun(heroClass?: HeroClass): Promise<Challenge>;
  inviteInfo(code: string): Promise<ChallengeSummary>;
  join(code: string, heroClass: HeroClass): Promise<Challenge>;
  getChallenge(id: string): Promise<Challenge>;
  putEvent(id: string, day: number, kind: EventKind, payload: unknown, opts?: { expectedSeq?: number }): Promise<PutEventResult>;
  events(id: string, since: number): Promise<GameEvent[]>;
  markSeen?(id: string, day: number): Promise<number>;
  pendingEvents?(id: string): PendingEvent[];
  flushQueue?(): Promise<string[]>;
  onSyncChange?(cb: () => void): () => void;
  onAuthLost?(cb: () => void): () => void;
  pushKey(): Promise<string | null>;
  pushSubscribe(sub: PushSubscriptionJSON): Promise<void>;
  pushUnsubscribe(endpoint: string): Promise<void>;
  /** local / dry-run mode: jump the clock just past the next Dawn */
  skipToNextDawn?(id: string): Promise<void>;
  /** pop any queued offline-sync notice (e.g. write dropped because Dawn passed) */
  popNotice?(): string | null;
}
