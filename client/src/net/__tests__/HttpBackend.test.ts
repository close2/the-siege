import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../types';
import { detectDeviceLabel, HttpBackend } from '../HttpBackend';

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
}

function jsonRes(status: number, body?: unknown): Response {
  if (status === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('HttpBackend multi-device & sync reliability', () => {
  const origFetch = globalThis.fetch;
  const origLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    globalThis.localStorage = makeStorage();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    globalThis.localStorage = origLocalStorage;
    vi.restoreAllMocks();
  });

  it('detectDeviceLabel produces clean browser + OS labels', () => {
    expect(detectDeviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari · iPhone');
    expect(detectDeviceLabel('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe('Chrome · Linux');
    expect(detectDeviceLabel('Mozilla/5.0 (Android 15; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0')).toBe('Firefox · Android');
    expect(detectDeviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toBe('Edge · Windows');
  });

  it('queues offline writes, notifies sync listeners, and drops expired writes cleanly on flush', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;

    fetchMock.mockResolvedValueOnce(jsonRes(200, { userId: 'u1', token: 'tok1', deviceId: 'd1' }));
    const b = new HttpBackend();
    await b.register('Christian');

    let syncTicks = 0;
    b.onSyncChange(() => syncTicks++);

    // Offline putEvent -> queued
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const res = await b.putEvent('c1', 1, 'checkin', { kept: [true] }, { expectedSeq: 0 });
    expect(res).toBe('queued');
    expect(b.pendingEvents('c1')).toHaveLength(1);
    expect(syncTicks).toBeGreaterThan(0);

    // Flush hits 409 day_closed -> dropped with notice, pendingEvents becomes empty
    fetchMock.mockResolvedValueOnce(jsonRes(409, { code: 'day_closed', error: 'this day is closed' }));
    const dropped = await b.flushQueue();
    expect(dropped).toHaveLength(1);
    expect(b.pendingEvents('c1')).toHaveLength(0);
    expect(b.popNotice()).toBeTruthy();
  });

  it('passes expectedSeq online and propagates 409 event_conflict without queueing', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;

    fetchMock.mockResolvedValueOnce(jsonRes(200, { userId: 'u1', token: 'tok1', deviceId: 'd1' }));
    const b = new HttpBackend();
    await b.register('Christian');

    fetchMock.mockResolvedValueOnce(jsonRes(409, { code: 'event_conflict', error: 'updated on another device', params: { latestSeq: 42 } }));
    await expect(b.putEvent('c1', 1, 'orders', [], { expectedSeq: 12 })).rejects.toMatchObject({
      status: 409,
      code: 'event_conflict',
    });
    expect(b.pendingEvents('c1')).toHaveLength(0);
    const sentBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(sentBody).toEqual({ payload: [], expectedSeq: 12 });
  });

  it('purges queued writes from another user when claiming a different account', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;

    fetchMock.mockResolvedValueOnce(jsonRes(200, { userId: 'u_old', token: 'tok_old', deviceId: 'd_old' }));
    const b = new HttpBackend();
    await b.register('Temp');

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await b.putEvent('c1', 1, 'checkin', { kept: [false] });
    expect(b.pendingEvents('c1')).toHaveLength(1);

    // Claim another account -> old account's queued write must be purged
    fetchMock.mockResolvedValueOnce(jsonRes(200, { userId: 'u_real', token: 'tok_real', name: 'Christian', deviceId: 'd_real' }));
    fetchMock.mockResolvedValueOnce(jsonRes(200, { id: 'u_real', name: 'Christian', deviceId: 'd_real', deviceCount: 2, challengeCount: 1 }));
    const u = await b.claim('ABCD1234');
    expect(u.id).toBe('u_real');
    expect(u.deviceCount).toBe(2);
    expect(b.pendingEvents('c1')).toHaveLength(0);
  });

  it('clears auth and notifies onAuthLost when any authenticated call returns 401 or revokes self', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;

    fetchMock.mockResolvedValueOnce(jsonRes(200, { userId: 'u1', token: 'tok1', deviceId: 'd1' }));
    const b = new HttpBackend();
    await b.register('Christian');

    let lost = 0;
    b.onAuthLost(() => lost++);

    fetchMock.mockResolvedValueOnce(jsonRes(401, { code: 'invalid_token', error: 'invalid token' }));
    await expect(b.events('c1', 0)).rejects.toBeInstanceOf(ApiError);
    expect(lost).toBe(1);
    expect(localStorage.getItem('siege.token')).toBeNull();
    expect(await b.me()).toBeNull();

    // Sign in again and revoke self
    fetchMock.mockResolvedValueOnce(jsonRes(200, { userId: 'u1', token: 'tok2', deviceId: 'd2' }));
    await b.register('Christian');
    fetchMock.mockResolvedValueOnce(jsonRes(204));
    await b.revokeDevice('d2');
    expect(lost).toBe(2);
    expect(localStorage.getItem('siege.token')).toBeNull();
  });
});
