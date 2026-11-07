// /dev/sandbox — run any day of a bot-driven season and watch the battle. tasks.md T1.14
import { useRef, useState } from 'react';
import { GameCanvas } from '../render/GameCanvas';
import type { GameView, ReplayPlayer } from '../render/GameView';
import { botCheckin, botOrders } from '../sim/bot';
import { demoSetup } from '../sim/fixtures';
import { createInitialState, resolveDay, type DayResolution } from '../sim/season';
import type { DayInputs, Difficulty, SeasonSetup, SeasonState } from '../sim/types';
import { intentEnemyTotal } from '../sim/waves';

function simulateTo(setup: SeasonSetup, day: number, q: number): { before: SeasonState; res: DayResolution } {
  let state = createInitialState(setup);
  let res: DayResolution | null = null;
  let before = state;
  while (state.day <= day) {
    const inputs: DayInputs = { checkins: {}, orders: {} };
    for (const p of setup.players) {
      const c = botCheckin(setup, p.id, state.day, q);
      inputs.checkins[p.id] = c;
      inputs.orders[p.id] = botOrders(setup, state, p.id, c);
    }
    before = state;
    res = resolveDay(setup, state, inputs);
    state = res.next;
  }
  return { before, res: res! };
}

const DIFFICULTIES: readonly Difficulty[] = ['very_easy', 'easy', 'normal', 'hard'];

/** Initial values from the URL (for headless screenshots): ?p=4&day=10&days=30&q=0.8&diff=normal&seed=…&ff=…&x=&y=&z= */
function urlDefaults() {
  const qs = new URLSearchParams(window.location.search);
  const num = (k: string, def: number, min: number, max: number) => {
    const v = Number(qs.get(k));
    return qs.has(k) && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  };
  const diff = qs.get('diff') as Difficulty | null;
  return {
    players: Math.round(num('p', 4, 2, 8)),
    days: Math.round(num('days', 30, 7, 90)),
    day: Math.round(num('day', 10, 1, 90)),
    q: num('q', 0.8, 0, 1),
    difficulty: diff && DIFFICULTIES.includes(diff) ? diff : 'normal',
    seed: qs.get('seed') || 'c0ffee1234567890',
  };
}

export function Sandbox() {
  const viewRef = useRef<GameView | null>(null);
  const playerRef = useRef<ReplayPlayer | null>(null);
  const [init] = useState(urlDefaults);
  const [players, setPlayers] = useState(init.players);
  const [day, setDay] = useState(init.day);
  const [days, setDays] = useState(init.days);
  const [q, setQ] = useState(init.q);
  const [difficulty, setDifficulty] = useState<Difficulty>(init.difficulty);
  const [seed, setSeed] = useState(init.seed);
  const [speed, setSpeed] = useState(1);
  const [info, setInfo] = useState('');
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState<DayResolution | null>(null);

  const run = () => {
    const view = viewRef.current;
    if (!view) return;
    const setup = demoSetup(players, { days, difficulty }, seed);
    const d = Math.min(day, days);
    const { before, res } = simulateTo(setup, d, q);
    setResult(res);
    const p = view.playBattle(res.battle, before.pads);
    p.speed = speed;
    p.onTick = (t) => setTick(t);
    p.onEnd = () => setInfo((s) => s + ' — finished');
    playerRef.current = p;
    const qs = new URLSearchParams(window.location.search);
    const ff = Number(qs.get('ff') ?? 0);
    if (ff > 0) p.fastForward(ff);
    if (qs.has('x')) {
      view.viewport.setZoom(Number(qs.get('z') ?? 1), true);
      view.viewport.moveCenter(Number(qs.get('x')), Number(qs.get('y')));
    }
    const intent = res.battle.intent;
    setInfo(`Day ${d}/${days} · enemies ${intentEnemyTotal(intent)}${intent.bossNight ? ' · BOSS NIGHT' : ''} · buildings ${res.battle.buildings.length} · rally ${res.battle.rally ? 'yes' : 'no'}`);
  };

  const setSp = (s: number) => {
    setSpeed(s);
    if (playerRef.current) playerRef.current.speed = s;
  };

  const r = result?.report;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, alignItems: 'center', fontSize: 13 }}>
        <label>
          players <input type="number" min={2} max={8} value={players} onChange={(e) => setPlayers(+e.target.value)} style={{ width: 44 }} />
        </label>
        <label>
          day <input type="number" min={1} max={days} value={day} onChange={(e) => setDay(+e.target.value)} style={{ width: 50 }} />
        </label>
        <label>
          of <input type="number" min={7} max={90} value={days} onChange={(e) => setDays(+e.target.value)} style={{ width: 50 }} />
        </label>
        <label>
          hit rate <input type="number" step={0.1} min={0} max={1} value={q} onChange={(e) => setQ(+e.target.value)} style={{ width: 50 }} />
        </label>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
          <option value="very_easy">very easy</option>
          <option value="easy">easy</option>
          <option value="normal">normal</option>
          <option value="hard">hard</option>
        </select>
        <input value={seed} onChange={(e) => setSeed(e.target.value)} style={{ width: 150 }} />
        <button onClick={run}>▶ Run</button>
        {[1, 2, 4].map((s) => (
          <button key={s} onClick={() => setSp(s)} style={{ borderColor: speed === s ? '#f2c14e' : undefined }}>
            {s}×
          </button>
        ))}
        <button onClick={() => playerRef.current && (playerRef.current.paused = !playerRef.current.paused)}>⏯</button>
        <button onClick={() => playerRef.current?.skip()}>⏭ Skip</button>
      </div>
      <div style={{ padding: '0 8px 6px', fontSize: 12, color: '#a9a08c' }}>
        {info} {tick ? `· t=${(tick / 20).toFixed(1)}s` : ''}
        {r && ` · result: ${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)} leaks ${r.battle.leaks} keep ${r.keepBefore}→${r.keepAfter}${r.bossKilled ? ' · boss slain' : ''}`}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <GameCanvas
          onReady={(v) => {
            viewRef.current = v;
            run();
          }}
        />
      </div>
    </div>
  );
}
