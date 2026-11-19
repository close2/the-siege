// Season state from the event log (event sourcing) + polling.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import valley from '../content/maps/valley.json';
import { SIM_VERSION } from '../content/stats';
import { ApiError, type Backend, type Challenge, type GameEvent, type PendingEvent, type PutEventResult } from '../net/types';
import { botCheckin, botOrders } from '../sim/bot';
import { seasonClock, type SeasonClock } from '../sim/calendar';
import { stateHash } from '../sim/hash';
import { createInitialState, previewDay, resolveDay } from '../sim/season';
import type { BattleSetup, Checkin, DayInputs, DayReport, MapDef, Order, PlayerDayReport, PlayerId, SeasonSetup, SeasonState } from '../sim/types';
import { disambiguateMemberNames, ekey, mergeEventLayers } from './seasonHelpers';

export const BOT_HIT_RATE = 0.8;

export function setupFromChallenge(c: Challenge): SeasonSetup {
  const members = [...c.members].sort((a, b) => a.joinOrder - b.joinOrder);
  const labels = disambiguateMemberNames(members);
  return {
    config: c.config,
    seed: c.seed,
    simVersion: c.simVersion,
    players: members.map((m) => ({ id: m.userId, name: labels[m.userId] ?? m.name, heroClass: m.heroClass })),
    map: valley as unknown as MapDef,
  };
}

type EventIndex = Map<string, GameEvent>;

function inputsFor(setup: SeasonSetup, idx: EventIndex, bots: Set<string>, day: number, state: SeasonState): DayInputs {
  const inputs: DayInputs = { checkins: {}, orders: {} };
  for (const p of setup.players) {
    if (bots.has(p.id)) {
      const c = botCheckin(setup, p.id, day, BOT_HIT_RATE);
      inputs.checkins[p.id] = c;
      inputs.orders[p.id] = botOrders(setup, state, p.id, c);
      continue;
    }
    const c = idx.get(ekey(day, p.id, 'checkin'));
    const o = idx.get(ekey(day, p.id, 'orders'));
    inputs.checkins[p.id] = (c?.payload as Checkin | undefined) ?? null;
    inputs.orders[p.id] = (o?.payload as Order[] | undefined) ?? [];
  }
  return inputs;
}

export interface SeasonView {
  challenge: Challenge;
  setup: SeasonSetup;
  me: PlayerId;
  now: number;
  clock: SeasonClock;
  states: SeasonState[];
  reports: DayReport[];
  battles: BattleSetup[];
  /** state at the start of the next day to resolve */
  state: SeasonState;
  planDay: number | null;
  planInputs: DayInputs | null;
  preview: { state: SeasonState; players: Record<PlayerId, PlayerDayReport>; rally: boolean } | null;
  myCheckin: (day: number) => Checkin | null;
  checkedIn: (day: number, user: PlayerId) => boolean;
  myOrders: Order[];
  desyncDay: number | null;
  /** the challenge was created with different game rules than this app version runs */
  simVersionMismatch: boolean;
  /** number of offline-queued writes waiting to reach the server for this challenge */
  pendingCount: number;
}

export function useSeason(backend: Backend, id: string, me: PlayerId) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [serverEvents, setServerEvents] = useState<EventIndex>(new Map());
  const [inFlight, setInFlight] = useState<EventIndex>(new Map());
  const [pending, setPending] = useState<PendingEvent[]>(() => backend.pendingEvents?.(id) ?? []);
  const [now, setNow] = useState(backend.now(id));
  const [lastPullNow, setLastPullNow] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const seqRef = useRef(0);
  const hasPulledRef = useRef(false);
  const sentHashesRef = useRef<Map<number, string>>(new Map());
  const challengeRef = useRef<Challenge | null>(null);
  challengeRef.current = challenge;
  const serverEventsRef = useRef<EventIndex>(serverEvents);
  serverEventsRef.current = serverEvents;

  const syncPending = useCallback(() => {
    setPending(backend.pendingEvents?.(id) ?? []);
  }, [backend, id]);

  useEffect(() => {
    syncPending();
    return backend.onSyncChange?.(syncPending);
  }, [backend, syncPending]);

  const pull = useCallback(
    async (opts?: { refreshChallenge?: boolean }) => {
      try {
        const shouldRefreshChallenge =
          opts?.refreshChallenge || (challengeRef.current !== null && !seasonClock(challengeRef.current.config, backend.now(id)).started);
        if (shouldRefreshChallenge) {
          const c = await backend.getChallenge(id);
          setChallenge(c);
        }
        const evs = await backend.events(id, seqRef.current);
        if (evs.length) {
          setServerEvents((prev) => {
            const next = new Map(prev);
            for (const e of evs) {
              next.set(ekey(e.day, e.userId, e.kind), e);
              seqRef.current = Math.max(seqRef.current, e.seq);
            }
            return next;
          });
        }
        hasPulledRef.current = true;
        const pulledAt = backend.now(id);
        setNow(pulledAt);
        setLastPullNow(pulledAt);
        syncPending();
        setError(null);
      } catch (e) {
        syncPending();
        setError((e as Error).message);
      }
    },
    [backend, id, syncPending],
  );

  useEffect(() => {
    let alive = true;
    seqRef.current = 0;
    hasPulledRef.current = false;
    sentHashesRef.current.clear();
    setServerEvents(new Map());
    setInFlight(new Map());
    setLastPullNow(0);
    syncPending();
    backend
      .getChallenge(id)
      .then((c) => {
        if (alive) setChallenge(c);
      })
      .then(() => (alive ? pull() : undefined))
      .catch((e) => alive && setError((e as Error).message));
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void pull();
    }, 30_000);
    const clockTick = setInterval(() => setNow(backend.now(id)), 5_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void pull({ refreshChallenge: true });
    };
    const onFocus = () => void pull({ refreshChallenge: true });
    const onOnline = () => void pull({ refreshChallenge: true });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clockTick);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [backend, id, me, pull, syncPending]);

  const events = useMemo(
    () => mergeEventLayers(serverEvents, pending, inFlight, me, now),
    [serverEvents, pending, inFlight, me, now],
  );

  const rawClock = challenge ? seasonClock(challenge.config, now) : null;
  const resolvedKey = rawClock ? rawClock.resolved : 0;
  const clockKey = rawClock ? `${rawClock.started}|${rawClock.resolved}|${rawClock.next}|${rawClock.finished}|${rawClock.open.join(',')}` : '';
  const clock = useMemo(() => (challenge ? seasonClock(challenge.config, now) : null), [challenge, clockKey]);

  // Trigger an immediate pull as soon as the local clock crosses a Dawn so final pre-Dawn events are fetched before resolving/hashing.
  const prevResolvedRef = useRef(0);
  useEffect(() => {
    if (resolvedKey > prevResolvedRef.current) {
      prevResolvedRef.current = resolvedKey;
      if (hasPulledRef.current) void pull({ refreshChallenge: true });
    } else if (resolvedKey < prevResolvedRef.current) {
      prevResolvedRef.current = resolvedKey;
    }
  }, [resolvedKey, pull]);

  // heavy part: replay all resolved days (only when events or resolved count change)
  const replay = useMemo(() => {
    if (!challenge) return null;
    const setup = setupFromChallenge(challenge);
    const bots = new Set(challenge.members.filter((m) => m.bot).map((m) => m.userId));
    const states = [createInitialState(setup)];
    const reports: DayReport[] = [];
    const battles: BattleSetup[] = [];
    for (let d = 1; d <= resolvedKey; d++) {
      const res = resolveDay(setup, states[d - 1], inputsFor(setup, events, bots, d, states[d - 1]));
      states.push(res.next);
      reports.push(res.report);
      battles.push(res.battle);
    }
    return { setup, bots, states, reports, battles };
  }, [challenge, events, resolvedKey]);

  const view = useMemo<SeasonView | null>(() => {
    if (!challenge || !replay || !clock) return null;
    const { setup, bots, states, reports, battles } = replay;
    const state = states[states.length - 1];
    const planDay = clock.next !== null && clock.started ? clock.next : null;
    const planInputs = planDay ? inputsFor(setup, events, bots, planDay, state) : null;
    const preview = planDay ? previewDay(setup, state, planInputs!) : null;
    let desyncDay: number | null = null;
    for (let d = 1; d <= clock.resolved && desyncDay === null; d++) {
      const mine = serverEvents.get(ekey(d, me, 'hash'))?.payload as string | undefined;
      if (!mine) continue;
      for (const p of setup.players) {
        const theirs = serverEvents.get(ekey(d, p.id, 'hash'))?.payload as string | undefined;
        if (theirs && theirs !== mine) desyncDay = d;
      }
    }
    return {
      challenge,
      setup,
      me,
      now,
      clock,
      states,
      reports,
      battles,
      state,
      planDay,
      planInputs,
      preview,
      myCheckin: (day) => (events.get(ekey(day, me, 'checkin'))?.payload as Checkin | undefined) ?? null,
      checkedIn: (day, user) => bots.has(user) || events.has(ekey(day, user, 'checkin')),
      myOrders: planDay ? ((events.get(ekey(planDay, me, 'orders'))?.payload as Order[] | undefined) ?? []) : [],
      desyncDay,
      simVersionMismatch: challenge.simVersion !== SIM_VERSION,
      pendingCount: pending.length,
    };
  }, [challenge, replay, clock, events, serverEvents, me, now, pending.length]);

  // Upload state hashes for resolved days only AFTER completing a pull past that day's Dawn.
  // If later events arrive and change the hash, re-upload the corrected hash.
  useEffect(() => {
    if (!view || backend.mode !== 'http' || view.challenge.local) return;
    const pendingUploads: Promise<void>[] = [];
    for (let d = 1; d <= view.clock.resolved; d++) {
      const w = view.clock.windows[d - 1];
      if (!w || lastPullNow < w.dawn) continue;
      const h = stateHash(view.states[d]);
      const serverHash = serverEvents.get(ekey(d, me, 'hash'))?.payload as string | undefined;
      if (serverHash === h || sentHashesRef.current.get(d) === h) continue;
      sentHashesRef.current.set(d, h);
      pendingUploads.push(
        backend
          .putEvent(id, d, 'hash', h)
          .then(() => undefined)
          .catch(() => {
            if (sentHashesRef.current.get(d) === h) sentHashesRef.current.delete(d);
          }),
      );
    }
    if (pendingUploads.length > 0) void Promise.all(pendingUploads).then(() => pull());
  }, [view, backend, id, me, serverEvents, lastPullNow, pull]);

  const setInFlightEvent = (day: number, kind: 'checkin' | 'orders', payload: unknown | null) => {
    const k = ekey(day, me, kind);
    setInFlight((prev) => {
      const next = new Map(prev);
      if (payload === null) next.delete(k);
      else next.set(k, { seq: -1, day, userId: me, kind, payload, updatedAt: backend.now(id) });
      return next;
    });
  };

  const writeEvent = async (day: number, kind: 'checkin' | 'orders', payload: unknown): Promise<PutEventResult> => {
    const key = ekey(day, me, kind);
    const hasPendingSlot = pending.some((p) => p.day === day && p.kind === kind);
    const useConflictCheck = backend.mode === 'http' && !challengeRef.current?.local && hasPulledRef.current && !hasPendingSlot;
    const expectedSeq = useConflictCheck ? (serverEventsRef.current.get(key)?.seq ?? 0) : undefined;

    setInFlightEvent(day, kind, payload);
    try {
      const result = await backend.putEvent(id, day, kind, payload, expectedSeq !== undefined ? { expectedSeq } : undefined);
      if (result === 'synced') {
        await pull();
      } else {
        syncPending();
      }
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'event_conflict') {
        await pull();
      }
      throw e;
    } finally {
      setInFlightEvent(day, kind, null);
    }
  };

  const putCheckin = async (day: number, c: Checkin): Promise<PutEventResult> => writeEvent(day, 'checkin', c);

  const putOrders = async (day: number, orders: Order[]): Promise<PutEventResult> => writeEvent(day, 'orders', orders);

  const markSeen = useCallback(
    (day: number) => {
      const seenKey = `siege.seen.${id}`;
      try {
        localStorage.setItem(seenKey, String(Math.max(day, Number(localStorage.getItem(seenKey) ?? 0))));
      } catch {
        /* ignore */
      }
      setChallenge((prev) => (prev ? { ...prev, seenDay: Math.max(prev.seenDay ?? 0, day) } : prev));
      void backend.markSeen?.(id, day).catch(() => undefined);
    },
    [backend, id],
  );

  const refresh = async () => {
    setNow(backend.now(id));
    await pull({ refreshChallenge: true });
  };

  /** drop all cached events + challenge and refetch (e.g. after the dry run was restarted under the same id) */
  const reload = async () => {
    seqRef.current = 0;
    hasPulledRef.current = false;
    sentHashesRef.current.clear();
    setServerEvents(new Map());
    setInFlight(new Map());
    setLastPullNow(0);
    const c = await backend.getChallenge(id);
    challengeRef.current = c;
    setChallenge(c);
    setNow(backend.now(id));
    await pull();
  };

  return { view, error, putCheckin, putOrders, markSeen, refresh, reload };
}
