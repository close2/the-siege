import { describe, expect, it } from 'vitest';
import { Battle } from '../battle';
import { botCheckin, botOrders } from '../bot';
import { demoSetup } from '../fixtures';
import { stateHash } from '../hash';
import { applyOrders } from '../orders';
import { createInitialState, replaySeason, resolveDay, seasonRank } from '../season';
import type { DayInputs, PlayerDayReport, SeasonSetup, SeasonState } from '../types';
import { generateIntent, isBossNight } from '../waves';

function botInputs(setup: SeasonSetup, state: SeasonState, q: number): DayInputs {
  const inputs: DayInputs = { checkins: {}, orders: {} };
  for (const p of setup.players) {
    const c = botCheckin(setup, p.id, state.day, q);
    inputs.checkins[p.id] = c;
    inputs.orders[p.id] = botOrders(setup, state, p.id, c);
  }
  return inputs;
}

function botSeason(setup: SeasonSetup, q: number) {
  let state = createInitialState(setup);
  const hashes: string[] = [];
  const reports = [];
  while (state.day <= setup.config.days) {
    const res = resolveDay(setup, state, botInputs(setup, state, q));
    state = res.next;
    reports.push(res.report);
    hashes.push(stateHash(state));
  }
  return { state, hashes, reports };
}

const emptyReport = (): PlayerDayReport => ({ r: 1, goldEarned: 0, status: 'normal', dormant: false, spent: 0, donated: 0, skipped: [] });

describe('orders', () => {
  it('builds, upgrades, rejects foreign pads and insufficient gold', () => {
    const setup = demoSetup(4);
    const s = createInitialState(setup);
    const rep = emptyReport();
    applyOrders(setup, s, 'p1', [
      { kind: 'build', pad: 'N-out-1', type: 'archer' },
      { kind: 'build', pad: 'E-out-1', type: 'archer' },
      { kind: 'upgrade', pad: 'N-out-1' },
    ], rep);
    expect(s.pads['N-out-1'].building).toEqual({ type: 'archer', level: 1, hp: 300 });
    expect(s.players.p1.gold).toBe(10);
    expect(rep.skipped.map((x) => x.reason)).toEqual(['not your pad', 'not enough gold']);
  });

  it('keep fund levels up', () => {
    const setup = demoSetup(4);
    const s = createInitialState(setup);
    s.players.p1.gold = 200;
    applyOrders(setup, s, 'p1', [{ kind: 'donate', to: 'keep', amount: 160 }], emptyReport());
    expect(s.keep.level).toBe(2);
    expect(s.keep.hp).toBe(130);
  });

  it('repairs, donates to teammates, enforces the donation minimum and sets stance', () => {
    const setup = demoSetup(4);
    const s = createInitialState(setup);
    s.players.p1.gold = 100;
    s.pads['N-out-1'].building = { type: 'archer', level: 1, hp: 150 };
    const rep = emptyReport();
    applyOrders(setup, s, 'p1', [
      { kind: 'repair', pad: 'N-out-1' },
      { kind: 'repair', pad: 'N-out-1' },
      { kind: 'donate', to: 'p2', amount: 20 },
      { kind: 'donate', to: 'p2', amount: 2 },
      { kind: 'donate', to: 'p1', amount: 10 },
      { kind: 'stance', mode: 'neighbor', sector: 'E-out' },
    ], rep);
    // repair cost = ceil(10 * 150 / 300) = 5
    expect(s.pads['N-out-1'].building?.hp).toBe(300);
    expect(s.players.p1.gold).toBe(100 - 5 - 20);
    expect(s.players.p2.gold).toBe(30 + 20);
    expect(rep.spent).toBe(5);
    expect(rep.donated).toBe(20);
    expect(s.players.p1.stance).toEqual({ mode: 'neighbor', sector: 'E-out' });
    expect(rep.skipped.map((x) => x.reason)).toEqual(['not damaged', 'minimum 5', 'unknown player']);
  });

  it('rebuilds on rubble', () => {
    const setup = demoSetup(4);
    const s = createInitialState(setup);
    s.pads['N-out-1'].rubble = true;
    applyOrders(setup, s, 'p1', [{ kind: 'build', pad: 'N-out-1', type: 'barracks' }], emptyReport());
    expect(s.pads['N-out-1']).toEqual({ owner: 'p1', building: { type: 'barracks', level: 1, hp: 300 }, rubble: false });
  });
});

describe('waves', () => {
  it('intent deterministic and boss nights', () => {
    const a = generateIntent('seed', 5, 30, 'normal', ['N-out', 'E-out'], 2);
    const b = generateIntent('seed', 5, 30, 'normal', ['N-out', 'E-out'], 2);
    expect(a).toEqual(b);
    expect(Object.keys(a.roads)).toEqual(['N', 'E']);
    expect(isBossNight(7, 30)).toBe(true);
    expect(isBossNight(7, 7)).toBe(true);
    expect(isBossNight(6, 30)).toBe(false);
    expect(isBossNight(7, 10)).toBe(false);
  });
});

describe('battle', () => {
  it('runs to completion', () => {
    const setup = demoSetup(4);
    const s = createInitialState(setup);
    const res = resolveDay(setup, s, botInputs(setup, s, 1));
    const b = new Battle(res.battle);
    const r = b.runToEnd();
    expect(b.done).toBe(true);
    expect(r.ticks).toBeGreaterThan(100);
    expect(r).toEqual(res.report.battle);
  });
});

describe('season', () => {
  it('is deterministic', () => {
    const setup = demoSetup(4);
    const a = botSeason(setup, 0.8);
    const b = botSeason(setup, 0.8);
    expect(a.hashes).toEqual(b.hashes);
  });

  it('replaySeason equals incremental resolution', () => {
    const setup = demoSetup(3, { days: 7 });
    let state = createInitialState(setup);
    const inputs: DayInputs[] = [];
    while (state.day <= 7) {
      const inp = botInputs(setup, state, 0.7);
      inputs.push(inp);
      state = resolveDay(setup, state, inp).next;
    }
    const rep = replaySeason(setup, inputs, 7);
    expect(stateHash(rep.states[7])).toBe(stateHash(state));
  });

  it('bot season on normal keeps the keep alive (balance smoke test)', () => {
    const setup = demoSetup(4);
    const { state, reports } = botSeason(setup, 0.8);
    const summary = reports.map((r) => `${r.day}:${r.stars}${r.keepFell ? '!' : ''}`).join(' ');
    console.log('bot season', summary, seasonRank(state, 30), 'keep', state.keep);
    expect(state.day).toBe(31);
    expect(state.keep.hp).toBeGreaterThan(0);
    expect(reports.some((r) => r.keepFell)).toBe(false);
  });

  it('golden hash (update intentionally when rules change)', () => {
    const { hashes } = botSeason(demoSetup(4), 0.8);
    console.log('golden', hashes[hashes.length - 1]);
    expect(hashes).toHaveLength(30);
    expect(hashes[29]).toBe('6473104f');
  });

  it.skipIf(!process.env.BALANCE)('200-season balance distribution across difficulties', () => {
    const diffs = ['very_easy', 'easy', 'normal', 'hard'] as const;
    const N = 25;
    for (const q of [0.8, 0.6]) {
      console.log(`\n=== q=${q} (${N} seasons/difficulty, 4 players, 30 days) ===`);
      for (const d of diffs) {
        let pct = 0;
        let falls = 0;
        const ranks: Record<string, number> = { bronze: 0, silver: 0, gold: 0, legendary: 0 };
        for (let i = 0; i < N; i++) {
          const setup = demoSetup(4, { difficulty: d }, `bal-${d}-${q}-${i}`);
          const { state, reports } = botSeason(setup, q);
          const r = seasonRank(state, 30);
          pct += r.pct;
          falls += reports.filter((x) => x.keepFell).length;
          ranks[r.rank] = (ranks[r.rank] ?? 0) + 1;
        }
        console.log(`${d.padEnd(10)} | stars: ${((pct / N) * 100).toFixed(1)}% | falls/season: ${(falls / N).toFixed(2)} |`, ranks);
      }
    }
  }, 120000);
});

describe('feedback fixes', () => {
  it('a hero defending the Keep actually fights (knight blocks, ranger shoots)', async () => {
    const { buildBattleSetup } = await import('../season');
    for (const [idx, cls] of [[0, 'knight'], [1, 'ranger']] as const) {
      const setup = demoSetup(4);
      const s = createInitialState(setup);
      const me = setup.players[idx].id;
      expect(setup.players[idx].heroClass).toBe(cls);
      s.players[me].stance = { mode: 'keep' };
      const statuses = Object.fromEntries(setup.players.map((p) => [p.id, p.id === me ? 'normal' : 'absent'] as const));
      const res = new Battle(buildBattleSetup(setup, s, statuses, false)).runToEnd();
      const st = res.stats[me];
      expect(st.damage + st.blocks).toBeGreaterThan(0);
    }
  });

  it('every pad covers about the same length of its own road, for every tower type and level', async () => {
    const { VALLEY } = await import('../fixtures');
    const { TOWERS } = await import('../../content/stats');
    const { padRange } = await import('../map');
    const samples: Record<string, { x: number; y: number; w: number }[]> = {};
    for (const [road, pts] of Object.entries(VALLEY.roads)) {
      const list: { x: number; y: number; w: number }[] = (samples[road] = []);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
        const n = Math.max(1, Math.round(len / 2));
        for (let k = 0; k < n; k++) list.push({ x: a.x + ((b.x - a.x) * (k + 0.5)) / n, y: a.y + ((b.y - a.y) * (k + 0.5)) / n, w: len / n });
      }
    }
    const bases = [...new Set(Object.values(TOWERS).flatMap((t) => t.range))];
    for (const base of bases) {
      const covs = VALLEY.sectors.flatMap((s) =>
        s.pads.map((p) => {
          expect(p.ranges?.[String(base)], `${p.id} has no entry for range ${base} — run tools/pad-ranges.mjs`).toBeDefined();
          const r = padRange(p.ranges, base);
          return samples[s.road].reduce((acc, q) => acc + ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= r * r ? q.w : 0), 0);
        }),
      );
      expect(Math.min(...covs), `range ${base}`).toBeGreaterThan(0.85 * Math.max(...covs));
    }
  });

  it('reports enemies that retreat at sunrise', () => {
    const setup = demoSetup(4);
    const s = createInitialState(setup);
    const res = resolveDay(setup, s, undefined);
    expect(Array.isArray(res.report.battle.escaped)).toBe(true);
  });
});
