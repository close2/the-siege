// Backend talking to the Rust server (same origin, /api).
import type { ChallengeConfig, HeroClass } from '../sim/types';
import { ApiError, type Backend, type Challenge, type ChallengeSummary, type EventKind, type GameEvent, type User } from './types';

const TOKEN = 'siege.token';
const QUEUE = 'siege.queue';

interface QueuedPut {
  id: string;
  day: number;
  kind: EventKind;
  payload: unknown;
}

export class HttpBackend implements Backend {
  readonly mode = 'http' as const;
  private offset = 0;
  private token: string | null = localStorage.getItem(TOKEN);
  private user: User | null = null;
  private notices: string[] = [];
  private flushing: Promise<string[]> | null = null;

  async init() {
    await this.syncTime();
    window.addEventListener('online', () => void this.flushQueue());
    void this.flushQueue();
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

  now() {
    return Date.now() + this.offset;
  }

  private async req<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && this.token) headers.authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, 'Network error — are you offline?');
    }
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, msg);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async me() {
    if (!this.token) return null;
    if (this.user) return this.user;
    try {
      this.user = await this.req<User>('GET', '/api/me');
      return this.user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.token = null;
        localStorage.removeItem(TOKEN);
        return null;
      }
      throw e;
    }
  }

  private setAuth(r: { userId: string; token: string }, name: string) {
    this.token = r.token;
    localStorage.setItem(TOKEN, r.token);
    this.user = { id: r.userId, name };
  }

  async register(name: string) {
    const r = await this.req<{ userId: string; token: string }>('POST', '/api/users', { name }, false);
    this.setAuth(r, name);
    return this.user!;
  }

  async rename(name: string) {
    await this.req('PUT', '/api/me', { name });
    if (this.user) this.user.name = name;
  }

  transferCode() {
    return this.req<{ code: string; expiresAt: number }>('POST', '/api/me/transfer-code');
  }

  async claim(code: string) {
    const r = await this.req<{ userId: string; token: string; name: string }>('POST', '/api/users/claim', { code: code.trim().toUpperCase() }, false);
    this.setAuth(r, r.name);
    return this.user!;
  }

  listChallenges() {
    return this.req<Challenge[]>('GET', '/api/challenges');
  }

  createChallenge(config: ChallengeConfig, heroClass: HeroClass) {
    return this.req<Challenge>('POST', '/api/challenges', { config, heroClass });
  }

  inviteInfo(code: string) {
    return this.req<ChallengeSummary>('GET', `/api/challenges/by-invite/${encodeURIComponent(code.toUpperCase())}`, undefined, false);
  }

  join(code: string, heroClass: HeroClass) {
    return this.req<Challenge>('POST', '/api/challenges/join', { inviteCode: code.toUpperCase(), heroClass });
  }

  getChallenge(id: string) {
    return this.req<Challenge>('GET', `/api/challenges/${id}`);
  }

  async putEvent(id: string, day: number, kind: EventKind, payload: unknown) {
    try {
      await this.req('PUT', `/api/challenges/${id}/days/${day}/${kind}`, { payload });
    } catch (e) {
      if (e instanceof ApiError && e.status === 0 && kind !== 'hash') {
        this.enqueue({ id, day, kind, payload });
        return;
      }
      throw e;
    }
  }

  private enqueue(p: QueuedPut) {
    const q = this.queue().filter((x) => !(x.id === p.id && x.day === p.day && x.kind === p.kind));
    q.push(p);
    localStorage.setItem(QUEUE, JSON.stringify(q));
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
    const q = this.queue();
    if (!q.length) return [];
    const done = new Set<QueuedPut>();
    const dropped: string[] = [];
    for (const p of q) {
      try {
        await this.req('PUT', `/api/challenges/${p.id}/days/${p.day}/${p.kind}`, { payload: p.payload });
        done.add(p);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) continue;
        done.add(p);
        dropped.push(`Your ${p.kind} for day ${p.day} could not be saved: ${(e as Error).message}`);
      }
    }
    // keep entries that failed with a network error, plus anything enqueued while flushing
    const key = (x: QueuedPut) => `${x.id}|${x.day}|${x.kind}|${JSON.stringify(x.payload)}`;
    const doneKeys = new Set([...done].map(key));
    localStorage.setItem(QUEUE, JSON.stringify(this.queue().filter((x) => !doneKeys.has(key(x)))));
    this.notices.push(...dropped);
    return dropped;
  }

  async events(id: string, since: number) {
    // retry offline writes first so they're included (or reported as dropped) on every poll
    if (this.queue().length) await this.flushQueue();
    const r = await this.req<{ events: GameEvent[]; now: number }>('GET', `/api/challenges/${id}/events?since=${since}`);
    return r.events;
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
  }

  async pushUnsubscribe(endpoint: string) {
    await this.req('DELETE', '/api/push/subscribe', { endpoint });
  }
}
