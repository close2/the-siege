import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { activeDates, dayWindows, seasonClock, zonedToUtc } from '../calendar';

const vectorsPath = path.resolve(__dirname, '../../../../docs/calendar-vectors.json');

describe('calendar', () => {
  it('zoned conversion incl. DST', () => {
    expect(new Date(zonedToUtc('2026-11-09', '11:00', 'Europe/Berlin')).toISOString()).toBe('2026-11-09T10:00:00.000Z');
    expect(new Date(zonedToUtc('2026-07-01', '11:00', 'Europe/Berlin')).toISOString()).toBe('2026-07-01T09:00:00.000Z');
    // spring-forward gap: 02:30 does not exist on 2026-03-29 in Berlin
    expect(new Date(zonedToUtc('2026-03-29', '02:30', 'Europe/Berlin')).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(new Date(zonedToUtc('2026-11-09', '00:00', 'America/New_York')).toISOString()).toBe('2026-11-09T05:00:00.000Z');
  });

  it('active days skip inactive dates', () => {
    const c = { startDate: '2026-11-09', days: 3, timeZone: 'Europe/Berlin', dawnTime: '11:00', inactiveDates: ['2026-11-10'] };
    expect(activeDates(c)).toEqual(['2026-11-09', '2026-11-11', '2026-11-12']);
    const w = dayWindows(c);
    expect(new Date(w[0].dawn).toISOString()).toBe('2026-11-10T10:00:00.000Z');
    const clock = seasonClock(c, Date.parse('2026-11-10T09:00:00Z'));
    expect(clock.resolved).toBe(0);
    expect(clock.open).toEqual([1]);
    const clock2 = seasonClock(c, Date.parse('2026-11-11T12:00:00Z'));
    expect(clock2.resolved).toBe(1);
    expect(clock2.open).toEqual([2]);
  });

  // The vectors file is the contract with server/src/calendar.rs. It is only rewritten on purpose
  // (UPDATE_VECTORS=1 npx vitest run); normally the TS implementation must reproduce it exactly.
  it('matches the shared vectors used by the Rust implementation', () => {
    const configs = [
      { startDate: '2026-03-27', days: 5, timeZone: 'Europe/Berlin', dawnTime: '11:00', inactiveDates: ['2026-03-28'] },
      { startDate: '2026-10-30', days: 4, timeZone: 'America/New_York', dawnTime: '07:30', inactiveDates: [] },
      { startDate: '2026-12-30', days: 3, timeZone: 'Asia/Tokyo', dawnTime: '00:00', inactiveDates: [] },
      { startDate: '2026-10-23', days: 3, timeZone: 'Europe/Berlin', dawnTime: '02:30', inactiveDates: [] },
      { startDate: '2026-03-27', days: 3, timeZone: 'Europe/Berlin', dawnTime: '02:30', inactiveDates: [] },
    ];
    const vectors = configs.map((c) => ({ config: c, windows: dayWindows(c) }));
    if (process.env.UPDATE_VECTORS) fs.writeFileSync(vectorsPath, JSON.stringify(vectors, null, 1));
    const stored = JSON.parse(fs.readFileSync(vectorsPath, 'utf8')) as typeof vectors;
    expect(vectors).toEqual(stored);
    expect(vectors[0].windows).toHaveLength(5);
  });
});
