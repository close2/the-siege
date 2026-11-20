import { describe, expect, it } from 'vitest';
import type { GameEvent, PendingEvent } from '../../net/types';
import { disambiguateMemberNames, ekey, findDesyncDay, formatStateHash, mergeEventLayers, parseStateHash, pickDefaultCheckinDay, shortAccountTag } from '../seasonHelpers';

describe('seasonHelpers', () => {
  it('pickDefaultCheckinDay prioritizes earliest unchecked open day before Dawn', () => {
    expect(pickDefaultCheckinDay([2, 3], () => false)).toBe(2);
    expect(pickDefaultCheckinDay([2, 3], (d) => d === 2)).toBe(3);
    expect(pickDefaultCheckinDay([2, 3], () => true)).toBe(3);
    expect(pickDefaultCheckinDay([1], () => false)).toBe(1);
    expect(pickDefaultCheckinDay([], () => false)).toBeNull();
  });

  it('disambiguateMemberNames only tags duplicate display names', () => {
    const unique = disambiguateMemberNames([
      { userId: 'udc6ad1b9117bf976', name: 'Bruce' },
      { userId: 'ub41cdd1162dfc5af', name: 'Christian' },
    ]);
    expect(unique).toEqual({
      udc6ad1b9117bf976: 'Bruce',
      ub41cdd1162dfc5af: 'Christian',
    });

    const dupes = disambiguateMemberNames([
      { userId: 'u503fe4ee11746f56', name: 'Christian' },
      { userId: 'ub41cdd1162dfc5af', name: ' christian ' },
      { userId: 'udc6ad1b9117bf976', name: 'Bruce' },
    ]);
    expect(dupes).toEqual({
      u503fe4ee11746f56: 'Christian #6f56',
      ub41cdd1162dfc5af: ' christian  #c5af',
      udc6ad1b9117bf976: 'Bruce',
    });
  });

  it('mergeEventLayers overlays pending and in-flight writes without sticking after rollback', () => {
    const confirmed: GameEvent = { seq: 10, day: 1, userId: 'u1', kind: 'orders', payload: [{ kind: 'stance', mode: 'own' }], updatedAt: 100 };
    const server = new Map<string, GameEvent>([[ekey(1, 'u1', 'orders'), confirmed]]);
    const pending: PendingEvent[] = [{ id: 'c1', day: 1, kind: 'checkin', payload: { kept: [true] } }];
    const inFlight = new Map<string, GameEvent>([
      [ekey(1, 'u1', 'orders'), { seq: -1, day: 1, userId: 'u1', kind: 'orders', payload: [{ kind: 'stance', mode: 'keep' }], updatedAt: 200 }],
    ]);

    const merged = mergeEventLayers(server, pending, inFlight, 'u1', 200);
    expect(merged.get(ekey(1, 'u1', 'checkin'))?.payload).toEqual({ kept: [true] });
    expect(merged.get(ekey(1, 'u1', 'orders'))?.payload).toEqual([{ kind: 'stance', mode: 'keep' }]);

    // After in-flight rollback & dropped pending write, only confirmed server events remain
    const rolledBack = mergeEventLayers(server, [], new Map(), 'u1', 300);
    expect(rolledBack.has(ekey(1, 'u1', 'checkin'))).toBe(false);
    expect(rolledBack.get(ekey(1, 'u1', 'orders'))).toEqual(confirmed);
  });

  it('shortAccountTag formats short user ID tag', () => {
    expect(shortAccountTag('ub41cdd1162dfc5af')).toBe('#dfc5af');
  });

  it('findDesyncDay ignores legacy unversioned hashes and detects v2 mismatches', () => {
    expect(formatStateHash('ef984098')).toBe('v2:ef984098');
    expect(parseStateHash('v2:ef984098')).toBe('ef984098');
    expect(parseStateHash('0826196a')).toBeNull();
    expect(parseStateHash(null)).toBeNull();

    const ev = (day: number, userId: string, payload: unknown): [string, GameEvent] => [
      ekey(day, userId, 'hash'),
      { seq: day, day, userId, kind: 'hash', payload, updatedAt: 100 },
    ];

    // Legacy unversioned teammate hash (pre-v0.6.0 bug) does not trigger false desync
    const legacyOnly = new Map<string, GameEvent>([
      ev(1, 'u_me', 'v2:ef984098'),
      ev(1, 'u_old', '0826196a'),
    ]);
    expect(findDesyncDay(1, 'u_me', ['u_me', 'u_old'], legacyOnly)).toBeNull();

    // Matching v2 hashes -> no desync
    const matching = new Map<string, GameEvent>([
      ev(1, 'u_me', 'v2:ef984098'),
      ev(1, 'u_other', 'v2:ef984098'),
    ]);
    expect(findDesyncDay(1, 'u_me', ['u_me', 'u_other'], matching)).toBeNull();

    // Mismatching v2 hashes -> reports first desync day
    const mismatch = new Map<string, GameEvent>([
      ev(1, 'u_me', 'v2:ef984098'),
      ev(1, 'u_other', 'v2:ef984098'),
      ev(2, 'u_me', 'v2:db020ee9'),
      ev(2, 'u_other', 'v2:deadbeef'),
    ]);
    expect(findDesyncDay(2, 'u_me', ['u_me', 'u_other'], mismatch)).toBe(2);
  });
});
