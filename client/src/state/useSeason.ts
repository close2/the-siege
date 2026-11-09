// Season state from the event log (event sourcing) + polling.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import valley from '../content/maps/valley.json';
import { SIM_VERSION } from '../content/stats';
import { botCheckin, botOrders } from '../sim/bot';
import { seasonClock, type SeasonClock } from '../sim/calendar';
import { stateHash } from '../sim/hash';
import { createInitialState, previewDay, resolveDay } from '../sim/season';
import type { BattleSetup, Checkin, DayInputs, DayReport, MapDef, Order, PlayerDayReport, PlayerId, SeasonSetup, SeasonState } from '../sim/types';
import type { Backend, Challenge, GameEvent } from '../net/types';

export const BOT_HIT_RATE = 0.8;

export function setupFromChallenge(c: Challenge): SeasonSetup {
  const members = [...c.members].sort((a, b) => a.joinOrder - b.joinOrder);
  return {
    config: c.config,
    seed: c.seed,
    simVersion: c.simVersion,
    players: members.map((m) => ({ id: m.userId, name: m.name, heroClass: m.heroClass })),
    map: valley as unknown as MapDef,
  };
}

type EventIndex = Map<string, GameEvent>;
const ekey = (day: number, user: string, kind: string) => `${day}|${user}|${kind}`;

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
}

export function useSeason(backend: Backend, id: string, me: PlayerId) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [events, setEvents] = useState<EventIndex>(new Map());
  const [now, setNow] = useState(backend.now(id));
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const sentHashesRef = useRef<Set<number>>(new Set());
  const challengeRef = useRef<Challenge | null>(null);
  challengeRef.current = challenge;

  const pull = useCallback(async () => {
    try {
      if (challengeRef.current && !seasonClock(challengeRef.current.config, backend.now(id)).started) {
        const c = await backend.getChallenge(id);
        setChallenge(c);
      }
      const evs = await backend.events(id, seqRef.current);
      if (evs.length) {
        setEvents((prev) => {
          const next = new Map(prev);
          for (const e of evs) {
            next.set(ekey(e.day, e.userId, e.kind), e);
            seqRef.current = Math.max(seqRef.current, e.seq);
          }
          return next;
        });
      }
      setNow(backend.now(id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [backend, id]);

  useEffect(() => {
    let alive = true;
    seqRef.current = 0;
    sentHashesRef.current.clear();
    setEvents(new Map());
    backend
      .getChallenge(id)
      .then((c) => alive && setChallenge(c))
      .then(pull)
      .catch((e) => alive && setError((e as Error).message));
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void pull();
    }, 30_000);
    const clock = setInterval(() => setNow(backend.now(id)), 5_000);
    const onVis = () => document.visibilityState === 'visible' && void pull();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [backend, id, pull]);

  const rawClock = challenge ? seasonClock(challenge.config, now) : null;
  const resolvedKey = rawClock ? rawClock.resolved : 0;
  const clockKey = rawClock ? `${rawClock.started}|${rawClock.resolved}|${rawClock.next}|${rawClock.finished}|${rawClock.open.join(',')}` : '';
  const clock = useMemo(() => (challenge ? seasonClock(challenge.config, now) : null), [challenge, clockKey]);

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
      const mine = events.get(ekey(d, me, 'hash'))?.payload as string | undefined;
      if (!mine) continue;
      for (const p of setup.players) {
        const theirs = events.get(ekey(d, p.id, 'hash'))?.payload as string | undefined;
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
    };
  }, [challenge, replay, clock, events, me]);

  // upload state hashes for resolved days (desync detection)
  useEffect(() => {
    if (!view || backend.mode !== 'http' || view.challenge.local) return;
    const pending: Promise<void>[] = [];
    for (let d = 1; d <= view.clock.resolved; d++) {
      if (events.has(ekey(d, me, 'hash')) || sentHashesRef.current.has(d)) continue;
      sentHashesRef.current.add(d);
      const h = stateHash(view.states[d]);
      pending.push(
        backend.putEvent(id, d, 'hash', h).catch(() => {
          sentHashesRef.current.delete(d);
        }),
      );
    }
    if (pending.length > 0) void Promise.all(pending).then(pull);
  }, [view, backend, id, me, events, pull]);

  const optimistic = (day: number, kind: 'checkin' | 'orders', payload: unknown) =>
    setEvents((prev) => {
      const next = new Map(prev);
      next.set(ekey(day, me, kind), { seq: -1, day, userId: me, kind, payload, updatedAt: backend.now(id) });
      return next;
    });

  const putCheckin = async (day: number, c: Checkin) => {
    await backend.putEvent(id, day, 'checkin', c);
    optimistic(day, 'checkin', c);
    void pull();
  };

  const putOrders = async (day: number, orders: Order[]) => {
    optimistic(day, 'orders', orders);
    await backend.putEvent(id, day, 'orders', orders);
    void pull();
  };

  const refresh = async () => {
    setNow(backend.now(id));
    await pull();
  };

  return { view, error, putCheckin, putOrders, refresh };
}
