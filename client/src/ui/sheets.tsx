import { useState } from 'react';
import { BUILD_COST, BUILDING_HP, ENEMIES, HEROES, TOWERS, BARRACKS, ECON, KEEP } from '../content/stats';
import { enemyArtId } from '../content/artSpec';
import { getTheme } from '../content/themes';
import { ratio, dayGold, heroLevel } from '../sim/economy';
import { sectorsPerPlayer } from '../sim/map';
import { repairCost, upgradeCost } from '../sim/orders';
import { seasonRank } from '../sim/season';
import type { BuildingType, Checkin, DayReport, Dir, EnemyRole, Order, PadId, PlayerId } from '../sim/types';
import { DIRS } from '../sim/types';
import type { SeasonView } from '../state/useSeason';
import { Gold, HERO_INFO, Icon, Sheet, Stars, cssColor, portraitUrl, PLAYER_COLORS } from './common';

const BUILDING_INFO: Record<BuildingType, { name: string; text: string; icons: string[] }> = {
  archer: { name: 'Archer Tower', text: 'Fast arrows. Hits flyers.', icons: ['physical', 'flying'] },
  barracks: { name: 'Barracks', text: 'Soldiers block the road.', icons: ['armor'] },
  mage: { name: 'Mage Tower', text: 'Magic bolts pierce armour.', icons: ['magic', 'flying'] },
  catapult: { name: 'Catapult', text: 'Slow, heavy splash. Ground only.', icons: ['siege'] },
};

export const ROAD_NAME: Record<Dir, string> = { N: 'North-west road', E: 'North-east road', S: 'South-east road', W: 'South-west road' };

function enemyImg(theme: string, role: EnemyRole) {
  return `/assets/${enemyArtId(theme, role)}.webp`;
}

function towerLine(type: BuildingType, level: number) {
  if (type === 'barracks') return `${BARRACKS.soldiers[level - 1]} soldiers · ${BARRACKS.hp[level - 1]} HP each`;
  const t = TOWERS[type];
  return `${t.dmg[level - 1]} dmg · range ${t.range[level - 1]}`;
}

// ---------------------------------------------------------------------------

export function CheckInSheet({ view, onSave, onClose }: { view: SeasonView; onSave: (day: number, c: Checkin) => Promise<void>; onClose: () => void }) {
  const cfg = view.setup.config;
  const days = view.clock.open;
  const [day, setDay] = useState(days[days.length - 1]);
  const existing = view.myCheckin(day);
  const [kept, setKept] = useState<boolean[]>(() => (existing && 'kept' in existing ? existing.kept : cfg.rules.map(() => false)));
  const [value, setValue] = useState<string>(existing && 'value' in existing ? String(existing.value) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spp = sectorsPerPlayer(view.setup.players.length);

  const switchDay = (d: number) => {
    setDay(d);
    const ex = view.myCheckin(d);
    setKept(ex && 'kept' in ex ? ex.kept : cfg.rules.map(() => false));
    setValue(ex && 'value' in ex ? String(ex.value) : '');
  };

  const checkin: Checkin | null = cfg.type === 'numeric' ? (value.trim() === '' || !Number.isFinite(Number(value)) ? null : { value: Number(value) }) : { kept };
  const r = checkin ? ratio(cfg, checkin) : null;
  const gold = dayGold(cfg.days, r, spp);

  const save = async () => {
    if (!checkin) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(day, checkin);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const w = view.clock.windows[day - 1];
  return (
    <Sheet onClose={onClose}>
      <h2>Check in</h2>
      {days.length > 1 && (
        <div className="row" style={{ marginBottom: 8 }}>
          {days.map((d) => (
            <button key={d} className={'btn small' + (d === day ? ' gold' : '')} onClick={() => switchDay(d)}>
              Day {d}
              {view.myCheckin(d) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
      <div className="muted" style={{ marginBottom: 8 }}>
        Day {day} · {new Date(w.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })} — editable until Dawn.
      </div>
      <div className="col">
        {cfg.type !== 'numeric' && (
          <>
            {cfg.rules.map((rule, i) => (
              <button key={i} className={'option' + (kept[i] ? ' selected' : '')} onClick={() => setKept(kept.map((k, j) => (j === i ? !k : k)))}>
                <span style={{ fontSize: 28 }}>{kept[i] ? '✅' : '⬜'}</span>
                <b>{rule}</b>
              </button>
            ))}
            {cfg.type === 'checklist' && (
              <button className="linkbtn" style={{ color: '#7a4a10', alignSelf: 'flex-start' }} onClick={() => setKept(cfg.rules.map(() => true))}>
                All kept
              </button>
            )}
          </>
        )}
        {cfg.type === 'numeric' && (
          <label className="field">
            {cfg.direction === 'lower' ? `How much? (target: at most ${cfg.target} ${cfg.unit})` : `How much? (target: ${cfg.target} ${cfg.unit})`}
            <input type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </label>
        )}
        <div className="row" style={{ justifyContent: 'space-between', fontWeight: 800 }}>
          <span>{r === null ? '—' : r >= 1.5 ? '🔥 Inspired!' : r >= 1 ? '✔ Target reached' : 'Honest report — still pays'}</span>
          <Gold n={gold} />
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Honesty pays: a missed day still earns {dayGold(cfg.days, 0, spp)}+ gold. Not reporting earns nothing and your hero stays home.
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn gold block" disabled={!checkin || busy} onClick={save}>
          Report
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function BuildSheet({ view, padId, onOrders, onClose }: { view: SeasonView; padId: PadId; onOrders: (o: Order[]) => void; onClose: () => void }) {
  const pv = view.preview!;
  const me = view.me;
  const gold = pv.state.players[me].gold;
  const pad = pv.state.pads[padId];
  const before = view.state.pads[padId];
  const b = pad.building;
  const planned = view.myOrders.filter((o) => 'pad' in o && o.pad === padId);
  const add = (o: Order) => {
    onOrders([...view.myOrders, o]);
    onClose();
  };
  const cancel = () => {
    onOrders(view.myOrders.filter((o) => !('pad' in o && o.pad === padId)));
    onClose();
  };

  return (
    <Sheet onClose={onClose}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{b ? `${BUILDING_INFO[b.type].name} · Level ${b.level}` : before.rubble ? 'Ruins' : 'Empty plot'}</h2>
        <Gold n={gold} />
      </div>
      {b && (
        <div className="muted" style={{ marginBottom: 6 }}>
          {towerLine(b.type, b.level)} · HP {Math.round(b.hp)}/{BUILDING_HP[b.level - 1]}
        </div>
      )}
      <div className="col" style={{ marginTop: 8 }}>
        {!b &&
          (Object.keys(BUILDING_INFO) as BuildingType[]).map((t) => (
            <button key={t} className="option" disabled={gold < BUILD_COST[t]} onClick={() => add({ kind: 'build', pad: padId, type: t })}>
              <img src={`/assets/building_${t}_1.webp`} alt="" />
              <div>
                <b>{BUILDING_INFO[t].name}</b>{' '}
                {BUILDING_INFO[t].icons.map((i) => (
                  <Icon key={i} id={i} size={16} />
                ))}
                <div style={{ fontSize: 13 }}>{BUILDING_INFO[t].text}</div>
                <div style={{ fontSize: 12 }} className="muted">
                  {towerLine(t, 1)}
                </div>
              </div>
              <Gold n={BUILD_COST[t]} />
            </button>
          ))}
        {b && b.level < 3 && (
          <button className="option" disabled={gold < (upgradeCost(b.type, b.level) ?? 1e9)} onClick={() => add({ kind: 'upgrade', pad: padId })}>
            <img src={`/assets/building_${b.type}_${b.level + 1}.webp`} alt="" />
            <div>
              <b>Upgrade to level {b.level + 1}</b>
              <div style={{ fontSize: 13 }}>{towerLine(b.type, b.level + 1)}</div>
            </div>
            <Gold n={upgradeCost(b.type, b.level)!} />
          </button>
        )}
        {b && b.hp < BUILDING_HP[b.level - 1] && (
          <button className="option" disabled={gold < repairCost(b.hp, BUILDING_HP[b.level - 1])} onClick={() => add({ kind: 'repair', pad: padId })}>
            <Icon id="repair" size={54} />
            <div>
              <b>Repair</b>
              <div style={{ fontSize: 13 }}>Restore full health before Dawn.</div>
            </div>
            <Gold n={repairCost(b.hp, BUILDING_HP[b.level - 1])} />
          </button>
        )}
        {b && b.level === 3 && b.hp >= BUILDING_HP[2] && <div className="center muted">Fully upgraded and in top shape.</div>}
        {planned.length > 0 && (
          <button className="btn small" onClick={cancel}>
            ↺ Undo today's plans for this plot
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function orderLabel(o: Order, view: SeasonView): string {
  const name = (pid: string) => view.setup.players.find((p) => p.id === pid)?.name ?? pid;
  switch (o.kind) {
    case 'build':
      return `Build ${BUILDING_INFO[o.type].name}`;
    case 'upgrade':
      return 'Upgrade building';
    case 'repair':
      return 'Repair building';
    case 'donate':
      return o.to === 'keep' ? `Donate ${o.amount} gold to the Keep` : `Give ${o.amount} gold to ${name(o.to)}`;
    case 'stance':
      return o.mode === 'own' ? 'Hero defends own sector' : o.mode === 'keep' ? 'Hero defends the Keep' : `Hero reinforces ${o.sector}`;
  }
}

export function PlanSheet({ view, onOrders, onClose }: { view: SeasonView; onOrders: (o: Order[]) => void; onClose: () => void }) {
  const pv = view.preview!;
  const me = view.me;
  const gold = pv.state.players[me].gold;
  const myClass = view.setup.players.find((p) => p.id === me)!.heroClass;
  const stance = pv.state.players[me].stance;
  const [donateTo, setDonateTo] = useState<string>('keep');
  const [amount, setAmount] = useState(10);
  const skipped = pv.players[me].skipped;
  const owners = new Map<string, PlayerId>();
  for (const p of view.setup.players) for (const s of view.state.players[p.id].sectors) owners.set(s, p.id);
  const nameOf = (pid: PlayerId) => view.setup.players.find((p) => p.id === pid)?.name ?? pid;
  const keep = pv.state.keep;

  const setStance = (o: Order) => onOrders([...view.myOrders.filter((x) => x.kind !== 'stance'), o]);

  return (
    <Sheet onClose={onClose}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Plans for Dawn</h2>
        <Gold n={gold} />
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
        Tap your glowing plots on the map to build. Plans can be changed until Dawn.
      </div>
      <div className="col">
        {view.myOrders.length === 0 && <div className="muted">No plans yet.</div>}
        {view.myOrders.map((o, i) => (
          <div key={i} className="row option" style={{ cursor: 'default' }}>
            <span className="grow">{orderLabel(o, view)}</span>
            <button className="btn small" onClick={() => onOrders(view.myOrders.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        {skipped.length > 0 && <div className="error">{skipped.map((s) => `${orderLabel(s.order, view)}: ${s.reason}`).join(' · ')}</div>}

        <h3 style={{ marginTop: 10 }}>Your hero</h3>
        <div className="row">
          <img src={portraitUrl(myClass)} width={56} height={56} style={{ borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', background: '#c9b48a' }} alt="" />
          <div style={{ fontSize: 13 }}>
            <b>{HERO_INFO[myClass].name}</b> · Lv {heroLevel(pv.state.players[me].xp)} · {HEROES[myClass].hp} HP base
            <div>Status tonight: {pv.players[me].status === 'absent' ? 'stays home (no report yet)' : pv.players[me].status}</div>
          </div>
        </div>
        <select
          value={stance.mode === 'neighbor' ? `n:${stance.sector}` : stance.mode}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'own' || v === 'keep') setStance({ kind: 'stance', mode: v });
            else setStance({ kind: 'stance', mode: 'neighbor', sector: v.slice(2) });
          }}
        >
          <option value="own">Defend my own sector</option>
          <option value="keep">Defend the Keep</option>
          {[...owners.entries()]
            .filter(([, pid]) => pid !== me)
            .map(([sid, pid]) => (
              <option key={sid} value={`n:${sid}`}>
                Reinforce {nameOf(pid)} ({ROAD_NAME[sid.split('-')[0] as Dir]})
              </option>
            ))}
        </select>

        <h3 style={{ marginTop: 10 }}>Share gold</h3>
        <div style={{ fontSize: 13 }}>
          Keep level {keep.level} · fund {keep.fund}
          {keep.level < 3 ? ` / ${KEEP.fund[keep.level - 1]} for the next level (more HP, stronger keep archers)` : ' (max level)'}
        </div>
        <div className="row">
          <select value={donateTo} onChange={(e) => setDonateTo(e.target.value)} style={{ flex: 2 }}>
            <option value="keep">The Keep</option>
            {view.setup.players
              .filter((p) => p.id !== me)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <input type="number" min={ECON.minDonate} value={amount} onChange={(e) => setAmount(Math.floor(Number(e.target.value)))} style={{ flex: 1 }} />
          <button className="btn small" disabled={amount < ECON.minDonate || amount > gold} onClick={() => onOrders([...view.myOrders, { kind: 'donate', to: donateTo, amount }])}>
            Give
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function IntentSheet({ view, onClose }: { view: SeasonView; onClose: () => void }) {
  const intent = view.state.intent;
  const theme = getTheme(view.setup.config.theme);
  const roles = theme.roles;
  const owners = new Map<Dir, string[]>();
  for (const p of view.setup.players) for (const s of view.state.players[p.id].sectors) owners.set(s.split('-')[0] as Dir, [...(owners.get(s.split('-')[0] as Dir) ?? []), p.name]);
  return (
    <Sheet onClose={onClose}>
      <h2>Scout report · Dawn {intent?.day}</h2>
      {!intent && <div>The season is over.</div>}
      {intent?.bossNight && (
        <div className="row" style={{ background: 'rgba(180,30,60,0.2)', borderRadius: 10, padding: 6, marginBottom: 8 }}>
          <img
            src={`/assets/${theme.portraitBoss}.webp`}
            width={64}
            height={64}
            alt=""
          />
          <div>
            <b>Boss night!</b> {theme.bossName} marches. Slay the boss for a bonus star and +{ECON.bossBonusGold} gold each.
          </div>
        </div>
      )}
      <div className="col">
        {intent &&
          DIRS.filter((d) => intent.roads[d]).map((d) => {
            const ri = intent.roads[d]!;
            return (
              <div key={d} className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>{ROAD_NAME[d]}</b>
                  <span style={{ fontSize: 12 }}>{owners.get(d)?.join(', ')}</span>
                </div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
                  {(Object.keys(ri.counts) as EnemyRole[]).map((r) => (
                    <span key={r} className="row" style={{ gap: 2, fontWeight: 800 }}>
                      <img
                        src={enemyImg(theme.id, r)}
                        width={40}
                        height={40}
                        style={{ objectFit: 'contain' }}
                        alt=""
                      />
                      ×{ri.counts[r]}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 13 }}>
                  {roles[ri.featured].icon && <Icon id={roles[ri.featured].icon!} size={16} />} <b>{roles[ri.featured].name}s:</b> {roles[ri.featured].tip}
                </div>
              </div>
            );
          })}
      </div>
      <h3 style={{ marginTop: 12 }}>Bestiary ({theme.name})</h3>
      <div className="col" style={{ gap: 4 }}>
        {(Object.keys(roles) as EnemyRole[]).map((r) => (
          <div key={r} className="row" style={{ fontSize: 13 }}>
            <img
              src={enemyImg(theme.id, r)}
              width={36}
              height={36}
              style={{ objectFit: 'contain' }}
              alt=""
            />
            <div>
              <b>{roles[r].name}</b> · {r === 'boss' ? 'huge' : ENEMIES[r].hp} HP — {roles[r].tip}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function DawnReport({ view, report, onClose, onReplay }: { view: SeasonView; report: DayReport; onClose: () => void; onReplay: () => void }) {
  const me = view.me;
  const mine = report.players[me];
  const stats = report.battle.stats[me] ?? { damage: 0, kills: 0, blocks: 0 };
  const name = (pid: PlayerId | null) => (pid ? view.setup.players.find((p) => p.id === pid)?.name ?? '?' : '—');
  const last = report.day === view.setup.config.days;
  const final = last ? seasonRank(view.states[report.day], view.setup.config.days) : null;
  const theme = getTheme(view.setup.config.theme);
  return (
    <Sheet onClose={onClose}>
      {(last || report.keepFell) && (
        <img
          src={`/assets/keyart_${report.keepFell ? 'defeat' : 'victory'}.webp`}
          alt=""
          style={{ width: '100%', borderRadius: 10, marginBottom: 8, maxHeight: 220, objectFit: 'cover' }}
        />
      )}
      <div className="center">
        <h2>{report.keepFell ? 'The Keep has fallen…' : report.stars === 3 ? 'Flawless defence!' : 'The line held'}</h2>
        <Stars n={report.stars} size={48} />
        <div style={{ marginTop: 6 }}>
          Dawn {report.day} · <Icon id="heart" size={18} /> Keep {Math.round(report.keepBefore)} → {Math.round(report.keepAfter)} · {report.battle.leaks} got through
        </div>
        {report.bossKilled && <div style={{ fontWeight: 900, marginTop: 4 }}>⚔ {theme.bossName} was slain! Bonus star and +{ECON.bossBonusGold} gold each.</div>}
        {report.rally && (
          <div style={{ marginTop: 4 }}>
            <Icon id="rally" size={18} /> Rally! Everyone reported — towers fired faster.
          </div>
        )}
        {report.keepFell && <div style={{ marginTop: 4 }}>It will be rebuilt at half strength. Regroup and repair!</div>}
      </div>
      <div className="col" style={{ marginTop: 10, gap: 4, fontSize: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Your report</span>
          <b>{mine.r === null ? 'none — hero stayed home' : mine.r >= 1 ? 'target reached' : 'honest miss'}</b>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Gold earned</span>
          <Gold n={mine.goldEarned} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Your damage · kills · blocks</span>
          <b>
            {Math.round(stats.damage)} · {stats.kills} · {stats.blocks}
          </b>
        </div>
        {mine.skipped.length > 0 && <div className="error">Not carried out: {mine.skipped.map((s) => s.reason).join(', ')}</div>}
        <h3 style={{ marginTop: 8 }}>Heroes of the night</h3>
        <div>🏹 Top damage: <b>{name(report.mvp.damage)}</b></div>
        <div>🛡 The Wall: <b>{name(report.mvp.wall)}</b></div>
        <div>💰 Patron: <b>{name(report.mvp.patron)}</b></div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {view.setup.players.map((p, i) => {
            const pr = report.players[p.id];
            return (
              <span key={p.id} className="chip" style={{ borderColor: cssColor(PLAYER_COLORS[i % 8]), color: '#fff' }}>
                {p.name}: {pr.r === null ? '—' : pr.r >= 1 ? '✔' : '✗'}
              </span>
            );
          })}
        </div>
      </div>
      {final && (
        <div className="center" style={{ marginTop: 12 }}>
          <h2>Season complete!</h2>
          <div style={{ fontSize: 18 }}>
            Rank: <b style={{ textTransform: 'capitalize' }}>{final.rank}</b> · {Math.round(final.pct * 100)} % of stars
          </div>
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn grow" onClick={onReplay}>
          ↻ Watch again
        </button>
        <button className="btn gold grow" onClick={onClose}>
          Onward
        </button>
      </div>
    </Sheet>
  );
}
