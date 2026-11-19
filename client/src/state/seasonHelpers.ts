import type { Member, PendingEvent, GameEvent } from '../net/types';

export const ekey = (day: number, user: string, kind: string) => `${day}|${user}|${kind}`;

/**
 * Picks the best default day when opening CheckInSheet.
 * Between midnight and Dawn, two days are open (`[d, d+1]`); prioritize the earliest open day
 * the player hasn't checked in for yet so they don't accidentally report tomorrow while today resolves as missed.
 */
export function pickDefaultCheckinDay(openDays: readonly number[], hasCheckin: (day: number) => boolean): number | null {
  if (openDays.length === 0) return null;
  const firstUnchecked = openDays.find((d) => !hasCheckin(d));
  return firstUnchecked ?? openDays[openDays.length - 1];
}

/**
 * Formats member display names, appending a short `#xxxx` suffix only when two or more members
 * in the same challenge share an identical display name (e.g. duplicate accounts).
 */
export function disambiguateMemberNames(members: readonly Pick<Member, 'userId' | 'name'>[]): Record<string, string> {
  const counts = new Map<string, number>();
  for (const m of members) {
    const norm = m.name.trim().toLowerCase();
    counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }
  const out: Record<string, string> = {};
  for (const m of members) {
    const norm = m.name.trim().toLowerCase();
    out[m.userId] = (counts.get(norm) ?? 0) > 1 ? `${m.name} #${m.userId.slice(-4)}` : m.name;
  }
  return out;
}

/**
 * Merges server-confirmed events with offline-queued pending writes and currently in-flight optimistic writes.
 * Keeping these layers separate ensures rejected or dropped writes never remain stuck in UI state.
 */
export function mergeEventLayers(
  serverEvents: ReadonlyMap<string, GameEvent>,
  pending: readonly PendingEvent[],
  inFlight: ReadonlyMap<string, GameEvent>,
  me: string,
  now: number,
): Map<string, GameEvent> {
  const merged = new Map(serverEvents);
  for (const p of pending) {
    merged.set(ekey(p.day, me, p.kind), {
      seq: -1,
      day: p.day,
      userId: me,
      kind: p.kind,
      payload: p.payload,
      updatedAt: now,
    });
  }
  for (const [k, v] of inFlight) {
    merged.set(k, v);
  }
  return merged;
}

/** Short human-readable account tag derived from a user ID (e.g. `#2dfc5af` -> `#dfc5af`). */
export function shortAccountTag(userId: string): string {
  const clean = userId.replace(/^u/, '');
  return `#${clean.slice(-6)}`;
}
