// Backend talking to the Rust server (same origin, /api).
import { translateQueuedDrop } from '../i18n/format';
import { currentSubscription } from '../pwa/push';
import type { ChallengeConfig, HeroClass } from '../sim/types';
import { LocalBackend } from './LocalBackend';
import {
  ApiError,
  DRY_RUN_ID,
  type Backend,
  type Challenge,
  type ChallengeSummary,
  type DeviceSession,
  type EventKind,
  type GameEvent,
  type PendingEvent,
  type PutEventResult,
  type User,
} from './types';

const TOKEN = 'siege.token';
const QUEUE = 'siege.queue';
const PUSH_SYNCED = 'siege.pushSynced';
const CHALLENGES_CACHE = 'siege.challenges.v1';

interface CachedChallenges {
  userId?: string;
  challenges: Challenge[];
}

interface QueuedPut {
  userId?: string;
  id: string;
  day: number;
  kind: EventKind;
  payload: unknown;
}

export function detectDeviceLabel(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (!ua) return 'Web';
  const os = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/i.test(ua)
          ? 'Mac'
          : /Windows/i.test(ua)
            ? 'Windows'
            : /Linux/i.test(ua)
              ? 'Linux'
              : '';
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Firefox|FxiOS/i.test(ua)
      ? 'Firefox'
      : /Chrome|CriOS/i.test(ua)
        ? 'Chrome'
        : /Safari/i.test(ua)
          ? 'Safari'
          : 'Browser';
  return os ? `${browser} · ${os}` : browser;
}

export class HttpBackend implements Backend {
  readonly mode = 'http' as const;
  private offset = 0;
  private token: string | null = localStorage.getItem(TOKEN);
  private user: User | null = null;
  private notices: string[] = [];
  private flushing: Promise<string[]> | null = null;
  private local = new LocalBackend();
  private syncListeners = new Set<() => void>();
  private authLostListeners = new Set<() => void>();

  async init() {
    await this.local.init();
    try {
      await this.syncTime();
    } catch {
      /* offline at startup; offset will sync on next /events or 'online' event */
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        void this.syncTime().catch(() => undefined);
        void this.flushQueue();
      });
    }
    void this.flushQueue();
    void this.ensurePushSyncedOnce();
  }

  onSyncChange(cb: () => void): () => void {
    this.syncListeners.add(cb);
    return () => this.syncListeners.delete(cb);
  }

  onAuthLost(cb: () => void): () => void {
    this.authLostListeners.add(cb);
    return () => this.authLostListeners.delete(cb);
  }

  private emitSync() {
    for (const cb of this.syncListeners) cb();
  }

  private emitAuthLost() {
    for (const cb of this.authLostListeners) cb();
  }

  popNotice(): string | null {
    return this.notices.shift() ?? null;
  }

  async syncTime() {
    const t0 = Date.now();
    const r = await this.req<{ now: number }>('GET', '/api/time', undefined, false);
    const t1 = Date.now();
    this.offset = r.now - (t0 + t1) / 2;
  }

  now(challengeId?: string) {
    if (challengeId === DRY_RUN_ID) return this.local.now(challengeId);
    return Date.now() + this.offset;
  }

  private clearAuthState(notify: boolean) {
    const hadAuth = Boolean(this.token || this.user);
    this.token = null;
    this.user = null;
    localStorage.removeItem(TOKEN);
    localStorage.removeItem(CHALLENGES_CACHE);
    this.saveQueue([]);
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(PUSH_SYNCED);
    } catch {
      /* ignore */
    }
    if (notify && hadAuth) this.emitAuthLost();
  }

  private async req<T>(method: string, path: string, body?: unknown, auth = true, tokenOverride?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const bearer = tokenOverride ?? (auth ? this.token : null);
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    let res: Response;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw ApiError.fromCode(0, 'network_offline');
    }
    if (!res.ok) {
      let msg = res.statusText;
      let code: string | undefined;
      let params: Record<string, unknown> | undefined;
      try {
        const data = (await res.json()) as { error?: string; code?: string; params?: Record<string, unknown> };
        msg = data.error ?? msg;
        code = data.code;
        params = data.params;
      } catch {
        /* ignore */
      }
      if (res.status === 401 && auth && !tokenOverride) {
        this.clearAuthState(true);
      }
      throw code ? ApiError.fromCode(res.status, code, params, msg) : new ApiError(res.status, msg);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async me(): Promise<User | null> {
    if (!this.token) return null;
    if (this.user) return this.user;
    return this.refreshMe(true);
  }

  async refreshMe(allowOfflineFallback = false): Promise<User | null> {
    if (!this.token) return null;
    try {
      this.user = await this.req<User>('GET', '/api/me');
      this.local.ensureUser(this.user);
      return this.user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      if (allowOfflineFallback && e instanceof ApiError && e.status === 0) {
        const cached = await this.local.me();
        if (cached) {
          this.user = cached;
          return cached;
        }
      }
      throw e;
    }
  }

  private setAuth(r: { userId: string; token: string; deviceId?: string }, name: string) {
    const prevId = this.user?.id;
    this.token = r.token;
    localStorage.setItem(TOKEN, r.token);
    this.user = { id: r.userId, name, deviceId: r.deviceId };
    this.local.ensureUser(this.user);
    // Drop queued writes and cached challenges belonging to any other account so they never leak across accounts.
    if (prevId !== r.userId) {
      const filtered = this.queue().filter((x) => x.userId === r.userId);
      if (filtered.length !== this.queue().length) this.saveQueue(filtered);
      localStorage.removeItem(CHALLENGES_CACHE);
    }
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(PUSH_SYNCED);
    } catch {
      /* ignore */
    }
  }

  private async ensurePushSyncedOnce() {
    if (!this.token || typeof sessionStorage === 'undefined') return;
    try {
      if (sessionStorage.getItem(PUSH_SYNCED) === this.token) return;
      const sub = await currentSubscription();
      if (!sub) return;
      await this.pushSubscribe(sub.toJSON());
      sessionStorage.setItem(PUSH_SYNCED, this.token);
    } catch {
      /* best-effort */
    }
  }

  private async rebindPushOnAccountSwitch(prevToken: string | null) {
    try {
      const sub = await currentSubscription();
      if (!sub) return;
      if (prevToken && prevToken !== this.token) {
        await this.req('DELETE', '/api/push/subscribe', { endpoint: sub.endpoint }, false, prevToken).catch(() => undefined);
      }
      if (this.token) {
        await this.pushSubscribe(sub.toJSON()).catch(() => undefined);
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(PUSH_SYNCED, this.token);
      }
    } catch {
      /* best-effort */
    }
  }

  async register(name: string) {
    const r = await this.req<{ userId: string; token: string; deviceId?: string }>(
      'POST',
      '/api/users',
      { name, deviceLabel: detectDeviceLabel() },
      false,
    );
    this.setAuth(r, name);
    this.user = { ...this.user!, deviceCount: 1, challengeCount: 0 };
    return this.user;
  }

  async rename(name: string) {
    await this.req('PUT', '/api/me', { name });
    if (this.user) {
      this.user = { ...this.user, name };
      this.local.ensureUser(this.user);
    }
  }

  transferCode() {
    return this.req<{ code: string; expiresAt: number }>('POST', '/api/me/transfer-code');
  }

  async claim(code: string) {
    const prevToken = this.token;
    const r = await this.req<{ userId: string; token: string; name: string; deviceId?: string }>(
      'POST',
      '/api/users/claim',
      { code: code.trim().toUpperCase(), deviceLabel: detectDeviceLabel() },
      false,
    );
    this.setAuth(r, r.name);
    await this.rebindPushOnAccountSwitch(prevToken);
    try {
      const fresh = await this.refreshMe();
      if (fresh) return fresh;
    } catch {
      /* fallback to basic user returned by claim */
    }
    return this.user!;
  }

  devices() {
    return this.req<DeviceSession[]>('GET', '/api/me/devices');
  }

  async revokeDevice(id: string) {
    const isSelf = id === this.user?.deviceId;
    if (isSelf) {
      try {
        const sub = await currentSubscription();
        if (sub) await this.pushUnsubscribe(sub.endpoint).catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
    await this.req('DELETE', `/api/me/devices/${encodeURIComponent(id)}`);
    if (isSelf) {
      this.clearAuthState(true);
    } else if (this.user && typeof this.user.deviceCount === 'number') {
      this.user = { ...this.user, deviceCount: Math.max(1, this.user.deviceCount - 1) };
    }
  }

  private readCachedChallenges(): Challenge[] | null {
    try {
      const raw = localStorage.getItem(CHALLENGES_CACHE);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedChallenges;
      if (!Array.isArray(parsed.challenges)) return null;
      if (this.user?.id && parsed.userId && parsed.userId !== this.user.id) return null;
      return parsed.challenges;
    } catch {
      return null;
    }
  }

  private writeCachedChallenges(challenges: Challenge[]) {
    try {
      const payload: CachedChallenges = { userId: this.user?.id, challenges };
      localStorage.setItem(CHALLENGES_CACHE, JSON.stringify(payload));
    } catch {
      /* ignore quota / restricted storage */
    }
  }

  async listChallenges() {
    const dry = this.local.getDryRun();
    try {
      const remote = await this.req<Challenge[]>('GET', '/api/challenges');
      this.writeCachedChallenges(remote);
      return dry ? [dry, ...remote] : remote;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        const cached = this.readCachedChallenges();
        if (cached) return dry ? [dry, ...cached] : cached;
      }
      throw e;
    }
  }

  createChallenge(config: ChallengeConfig, heroClass: HeroClass) {
    return this.req<Challenge>('POST', '/api/challenges', { config, heroClass });
  }

  async startDryRun(heroClass?: HeroClass) {
    if (this.user) this.local.ensureUser(this.user);
    return this.local.startDryRun(heroClass);
  }

  inviteInfo(code: string) {
    return this.req<ChallengeSummary>('GET', `/api/challenges/by-invite/${encodeURIComponent(code.toUpperCase())}`, undefined, false);
  }

  join(code: string, heroClass: HeroClass) {
    return this.req<Challenge>('POST', '/api/challenges/join', { inviteCode: code.toUpperCase(), heroClass });
  }

  async getChallenge(id: string) {
    if (id === DRY_RUN_ID) return this.local.getChallenge(id);
    try {
      const c = await this.req<Challenge>('GET', `/api/challenges/${id}`);
      const cached = this.readCachedChallenges();
      if (cached) {
        const idx = cached.findIndex((x) => x.id === c.id);
        const next = idx >= 0 ? cached.map((x, i) => (i === idx ? c : x)) : [c, ...cached];
        this.writeCachedChallenges(next);
      }
      return c;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        const hit = this.readCachedChallenges()?.find((x) => x.id === id);
        if (hit) return hit;
      }
      throw e;
    }
  }

  async putEvent(id: string, day: number, kind: EventKind, payload: unknown, opts?: { expectedSeq?: number }): Promise<PutEventResult> {
    if (id === DRY_RUN_ID) return this.local.putEvent(id, day, kind, payload);
    const body = opts?.expectedSeq !== undefined ? { payload, expectedSeq: opts.expectedSeq } : { payload };
    try {
      await this.req('PUT', `/api/challenges/${id}/days/${day}/${kind}`, body);
      // Remove any stale offline-queued write for the same slot now that the server has a newer write.
      const prev = this.queue();
      const next = prev.filter((x) => !(x.id === id && x.day === day && x.kind === kind));
      if (next.length !== prev.length) this.saveQueue(next);
      return 'synced';
    } catch (e) {
      if (e instanceof ApiError && e.status === 0 && kind !== 'hash') {
        this.enqueue({ userId: this.user?.id, id, day, kind, payload });
        return 'queued';
      }
      throw e;
    }
  }

  async markSeen(id: string, day: number): Promise<number> {
    if (id === DRY_RUN_ID) return this.local.markSeen(id, day);
    const r = await this.req<{ seenDay: number }>('PUT', `/api/challenges/${id}/seen`, { day });
    return r.seenDay;
  }

  pendingEvents(id: string): PendingEvent[] {
    const uid = this.user?.id;
    return this.queue()
      .filter((x) => x.id === id && (!uid || !x.userId || x.userId === uid))
      .map(({ id: cid, day, kind, payload }) => ({ id: cid, day, kind, payload }));
  }

  private saveQueue(q: QueuedPut[]) {
    localStorage.setItem(QUEUE, JSON.stringify(q));
    this.emitSync();
  }

  private enqueue(p: QueuedPut) {
    const q = this.queue().filter((x) => !(x.id === p.id && x.day === p.day && x.kind === p.kind));
    q.push(p);
    this.saveQueue(q);
  }

  private queue(): QueuedPut[] {
    try {
      return JSON.parse(localStorage.getItem(QUEUE) ?? '[]') as QueuedPut[];
    } catch {
      return [];
    }
  }

  /** Retries queued writes. Returns messages for writes that were dropped (day closed). */
  flushQueue(): Promise<string[]> {
    // one flush at a time, so concurrent callers (poll + 'online' event) can't clobber the stored queue
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<string[]> {
    if (!this.token) return [];
    const uid = this.user?.id;
    const q = this.queue();
    if (!q.length) return [];
    const done = new Set<QueuedPut>();
    const dropped: string[] = [];
    for (const p of q) {
      if (uid && p.userId && p.userId !== uid) {
        done.add(p);
        continue;
      }
      try {
        await this.req('PUT', `/api/challenges/${p.id}/days/${p.day}/${p.kind}`, { payload: p.payload });
        done.add(p);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500)) continue;
        done.add(p);
        if (e instanceof ApiError && e.status === 401) break;
        dropped.push(translateQueuedDrop(p.kind, p.day, (e as Error).message));
      }
    }
    if (done.size > 0) {
      const key = (x: QueuedPut) => `${x.userId ?? ''}|${x.id}|${x.day}|${x.kind}|${JSON.stringify(x.payload)}`;
      const doneKeys = new Set([...done].map(key));
      this.saveQueue(this.queue().filter((x) => !doneKeys.has(key(x))));
    }
    this.notices.push(...dropped);
    return dropped;
  }

  async events(id: string, since: number) {
    if (id === DRY_RUN_ID) return this.local.events(id, since);
    // retry offline writes first so they're included (or reported as dropped) on every poll
    if (this.queue().length) await this.flushQueue();
    const all: GameEvent[] = [];
    let cursor = Math.max(0, since);
    for (let page = 0; page < 20; page++) {
      const t0 = Date.now();
      const r = await this.req<{ events: GameEvent[]; now: number; hasMore?: boolean; nextSince?: number | null }>(
        'GET',
        `/api/challenges/${id}/events?since=${cursor}`,
      );
      const t1 = Date.now();
      if (typeof r.now === 'number') this.offset = r.now - (t0 + t1) / 2;
      if (!r.events.length) break;
      all.push(...r.events);
      const lastSeq = r.nextSince ?? r.events[r.events.length - 1].seq;
      if (!r.hasMore || lastSeq <= cursor) break;
      cursor = lastSeq;
    }
    return all;
  }

  async skipToNextDawn(id: string) {
    if (id === DRY_RUN_ID) await this.local.skipToNextDawn(id);
  }

  async pushKey() {
    try {
      return (await this.req<{ publicKey: string }>('GET', '/api/push/key', undefined, false)).publicKey;
    } catch {
      return null;
    }
  }

  async pushSubscribe(sub: PushSubscriptionJSON) {
    await this.req('POST', '/api/push/subscribe', sub);
    if (this.token && typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(PUSH_SYNCED, this.token);
      } catch {
        /* ignore */
      }
    }
  }

  async pushUnsubscribe(endpoint: string) {
    await this.req('DELETE', '/api/push/subscribe', { endpoint });
  }
}
