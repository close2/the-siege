import type { ChallengeConfig, HeroClass } from '../sim/types';

export interface User {
  id: string;
  name: string;
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
  ) {
    super(message);
  }
}

export const DRY_RUN_ID = 'dryrun';

export interface Backend {
  readonly mode: 'local' | 'http';
  /** server-corrected time (ms); pass challengeId to include any per-challenge demo offset */
  now(challengeId?: string): number;
  me(): Promise<User | null>;
  register(name: string): Promise<User>;
  rename(name: string): Promise<void>;
  transferCode(): Promise<{ code: string; expiresAt: number }>;
  claim(code: string): Promise<User>;
  listChallenges(): Promise<Challenge[]>;
  createChallenge(config: ChallengeConfig, heroClass: HeroClass, opts?: { bots?: number }): Promise<Challenge>;
  /** create or reset the local 3-day guided dry-run challenge with bot teammates */
  startDryRun(heroClass?: HeroClass): Promise<Challenge>;
  inviteInfo(code: string): Promise<ChallengeSummary>;
  join(code: string, heroClass: HeroClass): Promise<Challenge>;
  getChallenge(id: string): Promise<Challenge>;
  putEvent(id: string, day: number, kind: EventKind, payload: unknown): Promise<void>;
  events(id: string, since: number): Promise<GameEvent[]>;
  pushKey(): Promise<string | null>;
  pushSubscribe(sub: PushSubscriptionJSON): Promise<void>;
  pushUnsubscribe(endpoint: string): Promise<void>;
  /** local / dry-run mode: jump the clock just past the next Dawn */
  skipToNextDawn?(id: string): Promise<void>;
  /** pop any queued offline-sync notice (e.g. write dropped because Dawn passed) */
  popNotice?(): string | null;
}
