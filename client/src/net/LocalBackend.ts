// Offline/demo backend backed by IndexedDB (via `idb`) with a synchronous localStorage mirror.
import { openDB, type IDBPDatabase } from 'idb';
import { SIM_VERSION } from '../content/stats';
import i18n from '../i18n';
import { isWritable, localDate, seasonClock } from '../sim/calendar';
import type { ChallengeConfig, HeroClass } from '../sim/types';
import { ApiError, DRY_RUN_ID, type Backend, type Challenge, type ChallengeSummary, type EventKind, type GameEvent, type User } from './types';

interface LocalData {
  user: User | null;
  challenges: Challenge[];
  events: Record<string, GameEvent[]>;
  seq: number;
  timeOffset: number;
  challengeOffsets?: Record<string, number>;
}

const KEY = 'siege.local.v1';
const DB_NAME = 'siege-local';
const STORE = 'kv';
const BOT_NAMES = ['Brin', 'Mara', 'Tobi', 'Ilka', 'Jonas', 'Fenna', 'Oskar'];
const CLASSES: HeroClass[] = ['knight', 'ranger', 'priest'];

function rid(n = 12): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function emptyData(): LocalData {
  return { user: null, challenges: [], events: {}, seq: 0, timeOffset: 0, challengeOffsets: {} };
}

export class LocalBackend implements Backend {
  readonly mode = 'local' as const;
  private data: LocalData;
  private db: IDBPDatabase | null = null;

  constructor() {
    const raw = localStorage.getItem(KEY);
    this.data = raw ? (JSON.parse(raw) as LocalData) : emptyData();
  }

  async init() {
    try {
      this.db = await openDB(DB_NAME, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        },
      });
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        const stored = (await this.db.get(STORE, KEY)) as LocalData | undefined;
        if (stored) {
          this.data = stored;
          localStorage.setItem(KEY, JSON.stringify(this.data));
        }
      } else {
        await this.db.put(STORE, this.data, KEY);
      }
    } catch {
      // IndexedDB unavailable in restricted context; localStorage mirror still works
    }
  }

  private save() {
    localStorage.setItem(KEY, JSON.stringify(this.data));
    if (this.db) void this.db.put(STORE, this.data, KEY).catch(() => undefined);
  }

  now(challengeId?: string): number {
    if (challengeId && this.data.challengeOffsets && challengeId in this.data.challengeOffsets) {
      return Date.now() + this.data.challengeOffsets[challengeId];
    }
    return Date.now() + this.data.timeOffset;
  }

  ensureUser(u: User) {
    const prevId = this.data.user?.id;
    this.data.user = { ...u };
    if (prevId && prevId !== u.id) {
      for (const c of this.data.challenges) {
        if (c.creatorId === prevId) c.creatorId = u.id;
        for (const m of c.members) {
          if (m.userId === prevId) {
            m.userId = u.id;
            m.name = u.name;
          }
        }
      }
    } else {
      for (const c of this.data.challenges) {
        for (const m of c.members) if (m.userId === u.id) m.name = u.name;
      }
    }
    this.save();
  }

  getDryRun(): Challenge | null {
    return this.data.challenges.find((c) => c.id === DRY_RUN_ID) ?? null;
  }

  async me() {
    return this.data.user;
  }

  async register(name: string) {
    this.data.user = { id: 'u' + rid(6), name };
    this.save();
    return this.data.user;
  }

  async rename(name: string) {
    if (!this.data.user) throw ApiError.fromCode(401, 'not_registered');
    this.data.user.name = name;
    for (const c of this.data.challenges) for (const m of c.members) if (m.userId === this.data.user.id) m.name = name;
    this.save();
  }

  async transferCode(): Promise<{ code: string; expiresAt: number }> {
    throw ApiError.fromCode(400, 'transfer_needs_server');
  }

  async claim(): Promise<User> {
    throw ApiError.fromCode(400, 'transfer_needs_server');
  }

  async listChallenges() {
    return this.data.challenges;
  }

  async createChallenge(config: ChallengeConfig, heroClass: HeroClass, opts?: { bots?: number }) {
    const u = this.data.user;
    if (!u) throw ApiError.fromCode(401, 'not_registered');
    const c: Challenge = {
      id: 'c' + rid(6),
      config,
      seed: rid(8),
      simVersion: SIM_VERSION,
      inviteCode: 'LOCAL',
      creatorId: u.id,
      members: [{ userId: u.id, name: u.name, heroClass, joinOrder: 0 }],
      local: true,
    };
    const bots = Math.max(1, Math.min(7, opts?.bots ?? 2));
    for (let i = 0; i < bots; i++) {
      c.members.push({ userId: `bot${i + 1}`, name: BOT_NAMES[i], heroClass: CLASSES[(i + 1) % 3], joinOrder: i + 1, bot: true });
    }
    this.data.challenges.push(c);
    this.data.events[c.id] = [];
    this.save();
    return c;
  }

  async startDryRun(heroClass: HeroClass = 'knight') {
    const u = this.data.user;
    if (!u) throw ApiError.fromCode(401, 'not_registered');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const today = localDate(Date.now(), tz);
    const otherClasses = CLASSES.filter((hc) => hc !== heroClass);
    const c: Challenge = {
      id: DRY_RUN_ID,
      config: {
        title: i18n.t('dryRun.defaultTitle'),
        type: 'checklist',
        rules: [i18n.t('dryRun.rule1'), i18n.t('dryRun.rule2'), i18n.t('dryRun.rule3')],
        startDate: today,
        days: 3,
        timeZone: tz,
        dawnTime: '11:00',
        difficulty: 'easy',
        theme: 'sugar',
        inactiveDates: [],
      },
      seed: 'dryrun01',
      simVersion: SIM_VERSION,
      inviteCode: 'DRYRUN',
      creatorId: u.id,
      members: [
        { userId: u.id, name: u.name, heroClass, joinOrder: 0 },
        { userId: 'bot1', name: BOT_NAMES[0], heroClass: otherClasses[0] ?? 'ranger', joinOrder: 1, bot: true },
        { userId: 'bot2', name: BOT_NAMES[1], heroClass: otherClasses[1] ?? 'priest', joinOrder: 2, bot: true },
      ],
      local: true,
    };
    const idx = this.data.challenges.findIndex((x) => x.id === DRY_RUN_ID);
    if (idx >= 0) this.data.challenges[idx] = c;
    else this.data.challenges.unshift(c);
    this.data.events[DRY_RUN_ID] = [];
    this.data.challengeOffsets ??= {};
    this.data.challengeOffsets[DRY_RUN_ID] = 0;
    try {
      localStorage.removeItem(`siege.seen.${DRY_RUN_ID}`);
    } catch {
      /* ignore */
    }
    this.save();
    return c;
  }

  async inviteInfo(): Promise<ChallengeSummary> {
    throw ApiError.fromCode(404, 'invites_need_server');
  }

  async join(): Promise<Challenge> {
    throw ApiError.fromCode(404, 'invites_need_server');
  }

  async getChallenge(id: string) {
    const c = this.data.challenges.find((x) => x.id === id);
    if (!c) throw ApiError.fromCode(404, 'challenge_not_found');
    return c;
  }

  async putEvent(id: string, day: number, kind: EventKind, payload: unknown) {
    const c = await this.getChallenge(id);
    const u = this.data.user!;
    const now = this.now(id);
    if (kind === 'hash') {
      const w = seasonClock(c.config, now);
      if (day > w.resolved) throw ApiError.fromCode(409, 'day_not_resolved');
    } else if (!isWritable(c.config, day, now)) throw ApiError.fromCode(409, 'day_closed');
    const list = (this.data.events[id] ??= []);
    const i = list.findIndex((e) => e.day === day && e.userId === u.id && e.kind === kind);
    if (i >= 0) list.splice(i, 1);
    list.push({ seq: ++this.data.seq, day, userId: u.id, kind, payload, updatedAt: now });
    this.save();
  }

  async events(id: string, since: number) {
    return (this.data.events[id] ?? []).filter((e) => e.seq > since);
  }

  async pushKey() {
    return null;
  }

  async pushSubscribe() {}

  async pushUnsubscribe() {}

  async skipToNextDawn(id: string) {
    const c = await this.getChallenge(id);
    const now = this.now(id);
    const clock = seasonClock(c.config, now);
    const target = clock.next ? clock.windows[clock.next - 1].dawn + 1000 : null;
    if (target === null) return;
    // if the season hasn't started, jump to day 1's opening instead
    const first = clock.windows[0];
    const t = !clock.started ? first.open + 1000 : target;
    if (id === DRY_RUN_ID) {
      this.data.challengeOffsets ??= {};
      this.data.challengeOffsets[DRY_RUN_ID] = (this.data.challengeOffsets[DRY_RUN_ID] ?? 0) + (t - now);
    } else {
      this.data.timeOffset += t - now;
    }
    this.save();
  }
}
