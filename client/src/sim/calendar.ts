// Calendar math (time zones, active days, Dawn). Mirrored in server/src/calendar.rs —
// keep both in sync; shared vectors in docs/calendar-vectors.json.
import type { ChallengeConfig } from './types';

type CalConfig = Pick<ChallengeConfig, 'startDate' | 'days' | 'timeZone' | 'dawnTime' | 'inactiveDates'>;

const DAY_MS = 86_400_000;

/** offset (ms) of `tz` at instant `ts`: local wall time − UTC */
export function tzOffset(ts: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ts))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** UTC instant of a wall-clock time in `tz`. Ambiguous (DST fall-back) → earlier instant; gap → shifted forward. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const before = tzOffset(wall - 12 * 3600_000, tz);
  const after = tzOffset(wall + 12 * 3600_000, tz);
  const valid = (t: number) => tzOffset(t, tz) === wall - t;
  const c1 = wall - before;
  const c2 = wall - after;
  const v1 = valid(c1);
  const v2 = valid(c2);
  if (v1 && v2) return Math.min(c1, c2);
  if (v1) return c1;
  if (v2) return c2;
  return c1; // gap: use the offset before the transition
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return t.toISOString().slice(0, 10);
}

/** calendar date (YYYY-MM-DD) of instant `ts` in `tz` */
export function localDate(ts: number, tz: string): string {
  return new Date(ts + tzOffset(ts, tz)).toISOString().slice(0, 10);
}

/** dates of active days 1..D */
export function activeDates(c: CalConfig): string[] {
  const out: string[] = [];
  const inactive = new Set(c.inactiveDates);
  let date = c.startDate;
  let guard = 0;
  while (out.length < c.days && guard++ < 2000) {
    if (!inactive.has(date)) out.push(date);
    date = addDays(date, 1);
  }
  return out;
}

export interface DayWindow {
  day: number;
  date: string;
  /** 00:00 of the day */
  open: number;
  /** Dawn_d: first Dawn after the day ended */
  dawn: number;
}

export function dayWindows(c: CalConfig): DayWindow[] {
  return activeDates(c).map((date, i) => ({
    day: i + 1,
    date,
    open: zonedToUtc(date, '00:00', c.timeZone),
    dawn: zonedToUtc(addDays(date, 1), c.dawnTime, c.timeZone),
  }));
}

export interface SeasonClock {
  windows: DayWindow[];
  /** number of days whose Dawn has passed */
  resolved: number;
  /** days currently accepting check-ins / orders */
  open: number[];
  /** day whose Dawn comes next (resolved + 1), or null after the season */
  next: number | null;
  started: boolean;
  finished: boolean;
}

export function seasonClock(c: CalConfig, now: number): SeasonClock {
  const windows = dayWindows(c);
  let resolved = 0;
  const open: number[] = [];
  for (const w of windows) {
    if (now >= w.dawn) resolved = w.day;
    else if (now >= w.open) open.push(w.day);
  }
  return {
    windows,
    resolved,
    open,
    next: resolved < c.days ? resolved + 1 : null,
    started: windows.length > 0 && now >= windows[0].open,
    finished: resolved >= c.days,
  };
}

export function isWritable(c: CalConfig, day: number, now: number): boolean {
  const w = dayWindows(c)[day - 1];
  return !!w && now >= w.open && now < w.dawn;
}
