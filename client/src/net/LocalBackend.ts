// Offline/demo backend backed by IndexedDB (via `idb`) with a synchronous localStorage mirror.
import { openDB, type IDBPDatabase } from 'idb';
import { SIM_VERSION } from '../content/stats';
import { isWritable, seasonClock } from '../sim/calendar';
import type { ChallengeConfig, HeroClass } from '../sim/types';
import { ApiError, type Backend, type Challenge, type ChallengeSummary, type EventKind, type GameEvent, type User } from './types';

interface LocalData {
  user: User | null;
  challenges: Challenge[];
  events: Record<string, GameEvent[]>;
  seq: number;
  timeOffset: number;
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
  return { user: null, challenges: [], events: {}, seq: 0, timeOffset: 0 };
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

  now(): number {
    return Date.now() + this.data.timeOffset;
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
    if (!this.data.user) throw new ApiError(401, 'not registered');
    this.data.user.name = name;
    for (const c of this.data.challenges) for (const m of c.members) if (m.userId === this.data.user.id) m.name = name;
    this.save();
  }

  async transferCode(): Promise<{ code: string; expiresAt: number }> {
    throw new ApiError(400, 'Device transfer needs the server (offline demo mode).');
  }

  async claim(): Promise<User> {
    throw new ApiError(400, 'Device transfer needs the server (offline demo mode).');
  }

  async listChallenges() {
    return this.data.challenges;
  }

  async createChallenge(config: ChallengeConfig, heroClass: HeroClass, opts?: { bots?: number }) {
    const u = this.data.user;
    if (!u) throw new ApiError(401, 'not registered');
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

  async inviteInfo(): Promise<ChallengeSummary> {
    throw new ApiError(404, 'Invites need the server (offline demo mode).');
  }

  async join(): Promise<Challenge> {
    throw new ApiError(404, 'Invites need the server (offline demo mode).');
  }

  async getChallenge(id: string) {
    const c = this.data.challenges.find((x) => x.id === id);
    if (!c) throw new ApiError(404, 'challenge not found');
    return c;
  }

  async putEvent(id: string, day: number, kind: EventKind, payload: unknown) {
    const c = await this.getChallenge(id);
    const u = this.data.user!;
    const now = this.now();
    if (kind === 'hash') {
      const w = seasonClock(c.config, now);
      if (day > w.resolved) throw new ApiError(409, 'day not resolved yet');
    } else if (!isWritable(c.config, day, now)) throw new ApiError(409, 'This day is closed.');
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
    const clock = seasonClock(c.config, this.now());
    const target = clock.next ? clock.windows[clock.next - 1].dawn + 1000 : null;
    if (target === null) return;
    // if the season hasn't started, jump to day 1's opening instead
    const first = clock.windows[0];
    const t = !clock.started ? first.open + 1000 : target;
    this.data.timeOffset += t - this.now();
    this.save();
  }
}
