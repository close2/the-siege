import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { enemyArtId } from '../content/artSpec';
import { BARRACKS, BUILD_COST, BUILDING_HP, ECON, ENEMIES, HEROES, KEEP, TOWERS } from '../content/stats';
import { getTheme } from '../content/themes';
import i18n from '../i18n';
import { formatNumber, formatWeekdayDate, translateSkipReason } from '../i18n/format';
import { dayGold, heroLevel, ratio } from '../sim/economy';
import { padById, padRange, sectorById, sectorsPerPlayer } from '../sim/map';
import { repairCost, upgradeCost } from '../sim/orders';
import { seasonRank } from '../sim/season';
import type { BuildingType, Checkin, DayReport, Dir, EnemyRole, Order, PadId, PlayerId } from '../sim/types';
import { DIRS } from '../sim/types';
import { pickDefaultCheckinDay } from '../state/seasonHelpers';
import type { SeasonView } from '../state/useSeason';
import { Gold, Icon, PLAYER_COLORS, RichText, Sheet, Stars, cssColor, getHeroInfo, portraitUrl } from './common';

const BUILDING_TYPES: readonly BuildingType[] = ['archer', 'barracks', 'mage', 'catapult'];

const BUILDING_ICONS: Record<BuildingType, string[]> = {
  archer: ['physical', 'flying'],
  barracks: ['armor'],
  mage: ['magic', 'flying'],
  catapult: ['siege'],
};

export function getBuildingInfo(type: BuildingType): { name: string; text: string; icons: string[] } {
  return {
    name: i18n.t(`buildings.${type}.name`),
    text: i18n.t(`buildings.${type}.text`),
    icons: BUILDING_ICONS[type],
  };
}

export function getRoadName(d: Dir): string {
  return i18n.t(`roads.${d}`);
}

function enemyImg(theme: string, role: EnemyRole) {
  return `/assets/${enemyArtId(theme, role)}.webp`;
}

function towerLine(type: BuildingType, level: number, ranges?: Record<string, number>) {
  if (type === 'barracks') return i18n.t('build.barracksLine', { soldiers: BARRACKS.soldiers[level - 1], hp: BARRACKS.hp[level - 1] });
  const tw = TOWERS[type];
  return i18n.t('build.towerLine', { dmg: tw.dmg[level - 1], range: padRange(ranges, tw.range[level - 1]) });
}

/** effective tower range on a pad (fairness table, see PadDef.ranges); null for barracks */
export function towerRange(view: SeasonView, padId: PadId, type: BuildingType, level: number): number | null {
  if (type === 'barracks') return null;
  return padRange(padById(view.setup.map, padId)?.pad.ranges, TOWERS[type].range[level - 1]);
}

// ---------------------------------------------------------------------------

export function CheckInSheet({ view, onSave, onClose }: { view: SeasonView; onSave: (day: number, c: Checkin) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation();
  const cfg = view.setup.config;
  const days = view.clock.open;
  const [day, setDay] = useState(() => pickDefaultCheckinDay(days, (d) => Boolean(view.myCheckin(d))) ?? days[days.length - 1]);
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
      <h2>{t('checkin.title')}</h2>
      {days.length > 1 && (
        <>
          <div className="row" style={{ marginBottom: 4 }}>
            {days.map((d) => (
              <button key={d} className={'btn small' + (d === day ? ' gold' : '')} onClick={() => switchDay(d)}>
                {t('checkin.dayButton', { day: d, check: view.myCheckin(d) ? ' ✓' : '' })}
              </button>
            ))}
          </div>
          {!view.myCheckin(days[0]) && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              {t('checkin.twoDaysOpenHint', { urgentDay: days[0] })}
            </div>
          )}
        </>
      )}
      <div className="muted" style={{ marginBottom: 8 }}>
        {t('checkin.dayDateHint', { day, date: formatWeekdayDate(w.date) })}
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
                {t('checkin.allKept')}
              </button>
            )}
          </>
        )}
        {cfg.type === 'numeric' && (
          <label className="field">
            {cfg.direction === 'lower'
              ? t('checkin.howMuchLower', { target: formatNumber(cfg.target ?? 0), unit: cfg.unit })
              : t('checkin.howMuchHigher', { target: formatNumber(cfg.target ?? 0), unit: cfg.unit })}
            <input type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </label>
        )}
        <div className="row" style={{ justifyContent: 'space-between', fontWeight: 800 }}>
          <span>
            {r === null ? '—' : r >= 1.5 ? t('checkin.statusInspired') : r >= 1 ? t('checkin.statusTarget') : t('checkin.statusHonest')}
          </span>
          <Gold n={gold} />
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {t('checkin.honestyHint', { minGold: dayGold(cfg.days, 0, spp) })}
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn gold block" disabled={!checkin || busy} onClick={save}>
          {t('checkin.submit')}
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function BuildSheet({ view, padId, onOrders, onClose }: { view: SeasonView; padId: PadId; onOrders: (o: Order[]) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const pv = view.preview!;
  const me = view.me;
  const gold = pv.state.players[me].gold;
  const pad = pv.state.pads[padId];
  const before = view.state.pads[padId];
  const b = pad.building;
  const planned = view.myOrders.filter((o) => 'pad' in o && o.pad === padId);
  const bonus = padById(view.setup.map, padId)?.pad.ranges;
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
        <h2 style={{ margin: 0 }}>
          {b ? t('build.buildingHeader', { name: getBuildingInfo(b.type).name, level: b.level }) : before.rubble ? t('build.ruins') : t('build.emptyPlot')}
        </h2>
        <Gold n={gold} />
      </div>
      {b && (
        <div className="muted" style={{ marginBottom: 6 }}>
          {towerLine(b.type, b.level, bonus)} · {t('build.hpStat', { hp: Math.round(b.hp), maxHp: BUILDING_HP[b.level - 1] })}
        </div>
      )}
      <div className="col" style={{ marginTop: 8 }}>
        {!b &&
          BUILDING_TYPES.map((bt) => {
            const info = getBuildingInfo(bt);
            return (
              <button key={bt} className="option" disabled={gold < BUILD_COST[bt]} onClick={() => add({ kind: 'build', pad: padId, type: bt })}>
                <img src={`/assets/building_${bt}_1.webp`} alt="" />
                <div>
                  <b>{info.name}</b>{' '}
                  {info.icons.map((ic) => (
                    <Icon key={ic} id={ic} size={16} />
                  ))}
                  <div style={{ fontSize: 13 }}>{info.text}</div>
                  <div style={{ fontSize: 12 }} className="muted">
                    {towerLine(bt, 1, bonus)}
                  </div>
                </div>
                <Gold n={BUILD_COST[bt]} />
              </button>
            );
          })}
        {b && b.level < 3 && (
          <button className="option" disabled={gold < (upgradeCost(b.type, b.level) ?? 1e9)} onClick={() => add({ kind: 'upgrade', pad: padId })}>
            <img src={`/assets/building_${b.type}_${b.level + 1}.webp`} alt="" />
            <div>
              <b>{t('build.upgradeTo', { level: b.level + 1 })}</b>
              <div style={{ fontSize: 13 }}>{towerLine(b.type, b.level + 1, bonus)}</div>
            </div>
            <Gold n={upgradeCost(b.type, b.level)!} />
          </button>
        )}
        {b && b.hp < BUILDING_HP[b.level - 1] && (
          <button className="option" disabled={gold < repairCost(b.hp, BUILDING_HP[b.level - 1])} onClick={() => add({ kind: 'repair', pad: padId })}>
            <Icon id="repair" size={54} />
            <div>
              <b>{t('build.repair')}</b>
              <div style={{ fontSize: 13 }}>{t('build.repairDesc')}</div>
            </div>
            <Gold n={repairCost(b.hp, BUILDING_HP[b.level - 1])} />
          </button>
        )}
        {b && b.level === 3 && b.hp >= BUILDING_HP[2] && <div className="center muted">{t('build.fullyUpgraded')}</div>}
        {planned.length > 0 && (
          <button className="btn small" onClick={cancel}>
            {t('build.undoPlotPlans')}
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function sectorLabel(view: SeasonView, sid: string): string {
  const sec = sectorById(view.setup.map, sid);
  const dir = sid.split('-')[0] as Dir;
  const road = DIRS.includes(dir) ? getRoadName(dir) : sid;
  return sec ? `${road} · ${i18n.t(`roads.ring.${sec.ring}`)}` : road;
}

export function orderLabel(o: Order, view: SeasonView): string {
  const name = (pid: string) => view.setup.players.find((p) => p.id === pid)?.name ?? pid;
  switch (o.kind) {
    case 'build':
      return i18n.t('plan.orders.build', { name: getBuildingInfo(o.type).name });
    case 'upgrade':
      return i18n.t('plan.orders.upgrade');
    case 'repair':
      return i18n.t('plan.orders.repair');
    case 'donate':
      return o.to === 'keep'
        ? i18n.t('plan.orders.donateKeep', { amount: formatNumber(o.amount) })
        : i18n.t('plan.orders.donatePlayer', { amount: formatNumber(o.amount), name: name(o.to) });
    case 'stance':
      return o.mode === 'own'
        ? i18n.t('plan.orders.stanceOwn')
        : o.mode === 'keep'
          ? i18n.t('plan.orders.stanceKeep')
          : i18n.t('plan.orders.stanceNeighbor', { sector: sectorLabel(view, o.sector ?? '') });
  }
}

export function PlanSheet({ view, onOrders, onOpenPad, onClose }: { view: SeasonView; onOrders: (o: Order[]) => void; onOpenPad: (pad: PadId) => void; onClose: () => void }) {
  const { t } = useTranslation();
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
  const myPads = view.setup.map.sectors.filter((s) => view.state.players[me].sectors.includes(s.id)).flatMap((s) => s.pads);
  const heroInfo = getHeroInfo(myClass);
  const heroStatus = t(`plan.heroStatus.${pv.players[me].status}`);

  return (
    <Sheet onClose={onClose}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{t('plan.title')}</h2>
        <Gold n={gold} />
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
        {t('plan.subtitle')}
      </div>
      <div className="col">
        {view.myOrders.length === 0 && <div className="muted">{t('plan.noPlans')}</div>}
        {view.myOrders.map((o, i) => (
          <div key={i} className="row option" style={{ cursor: 'default' }}>
            <span className="grow">{orderLabel(o, view)}</span>
            <button className="btn small" onClick={() => onOrders(view.myOrders.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        {skipped.length > 0 && <div className="error">{skipped.map((s) => `${orderLabel(s.order, view)}: ${translateSkipReason(s.reason)}`).join(' · ')}</div>}

        <h3 style={{ marginTop: 10 }}>{t('plan.yourPlots')}</h3>
        <div className="muted" style={{ fontSize: 12 }}>
          {t('plan.yourPlotsHint')}
        </div>
        {myPads.map((p, i) => {
          const st = pv.state.pads[p.id];
          const b = st?.building;
          const up = b ? upgradeCost(b.type, b.level) : null;
          const rep = b ? repairCost(b.hp, BUILDING_HP[b.level - 1]) : 0;
          return (
            <div key={p.id} className="row option" style={{ cursor: 'default', padding: '4px 8px' }}>
              {b ? <img src={`/assets/building_${b.type}_${b.level}.webp`} alt="" style={{ width: 36, height: 36 }} /> : <span style={{ width: 36, textAlign: 'center', fontSize: 22 }}>＋</span>}
              <span className="grow" style={{ fontSize: 13 }}>
                <b>{b ? t('plan.buildingLv', { name: getBuildingInfo(b.type).name, level: b.level }) : st?.rubble ? t('build.ruins') : t('plan.freePlot')}</b>
                <span className="muted">{t('plan.plotIndex', { n: i + 1 })}</span>
                {b && rep > 0 && <span className="muted"> · {t('build.hpStat', { hp: Math.round(b.hp), maxHp: BUILDING_HP[b.level - 1] })}</span>}
              </span>
              {!b && (
                <button className="btn small gold" onClick={() => onOpenPad(p.id)}>
                  {t('plan.buildButton')}
                </button>
              )}
              {b && up !== null && (
                <button className="btn small" disabled={gold < up} onClick={() => onOrders([...view.myOrders, { kind: 'upgrade', pad: p.id }])}>
                  ⬆ <Gold n={up} size={14} />
                </button>
              )}
              {b && rep > 0 && (
                <button className="btn small" disabled={gold < rep} onClick={() => onOrders([...view.myOrders, { kind: 'repair', pad: p.id }])}>
                  🔧 <Gold n={rep} size={14} />
                </button>
              )}
              {b && (
                <button className="btn small" onClick={() => onOpenPad(p.id)} title={t('plan.showOnMap')}>
                  📍
                </button>
              )}
            </div>
          );
        })}

        <h3 style={{ marginTop: 10 }}>{t('plan.yourHero')}</h3>
        <div className="row">
          <img src={portraitUrl(myClass)} width={56} height={56} style={{ borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', background: '#c9b48a' }} alt="" />
          <div style={{ fontSize: 13 }}>
            <b>{heroInfo.name}</b> · {t('plan.heroStats', { level: heroLevel(pv.state.players[me].xp), hp: HEROES[myClass].hp })}
            <div>{t('plan.statusTonight', { status: heroStatus })}</div>
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
          <option value="own">{t('plan.stanceOwn')}</option>
          <option value="keep">{t('plan.stanceKeep')}</option>
          {[...owners.entries()]
            .filter(([, pid]) => pid !== me)
            .map(([sid, pid]) => (
              <option key={sid} value={`n:${sid}`}>
                {t('plan.stanceReinforce', { name: nameOf(pid), sector: sectorLabel(view, sid) })}
              </option>
            ))}
        </select>
        <div className="muted" style={{ fontSize: 12 }}>
          {t(`plan.stanceHelp.${stance.mode}`)}
        </div>

        <h3 style={{ marginTop: 10 }}>{t('plan.shareGold')}</h3>
        <div style={{ fontSize: 13 }}>
          {keep.level < 3
            ? t('plan.keepProgress', { level: keep.level, fund: formatNumber(keep.fund), nextFund: formatNumber(KEEP.fund[keep.level - 1]) })
            : t('plan.keepMax', { level: keep.level, fund: formatNumber(keep.fund) })}
        </div>
        <div className="row">
          <select value={donateTo} onChange={(e) => setDonateTo(e.target.value)} style={{ flex: 2 }}>
            <option value="keep">{t('plan.theKeep')}</option>
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
            {t('plan.give')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function IntentSheet({ view, onClose }: { view: SeasonView; onClose: () => void }) {
  const { t } = useTranslation();
  const intent = view.state.intent;
  const theme = getTheme(view.setup.config.theme);
  const roles = theme.roles;
  const owners = new Map<Dir, string[]>();
  for (const p of view.setup.players) for (const s of view.state.players[p.id].sectors) owners.set(s.split('-')[0] as Dir, [...(owners.get(s.split('-')[0] as Dir) ?? []), p.name]);
  return (
    <Sheet onClose={onClose}>
      <h2>{t('intent.title', { day: intent?.day ?? '' })}</h2>
      {!intent && <div>{t('intent.seasonOver')}</div>}
      {intent?.bossNight && (
        <div className="row" style={{ background: 'rgba(180,30,60,0.2)', borderRadius: 10, padding: 6, marginBottom: 8 }}>
          <img src={`/assets/${theme.portraitBoss}.webp`} width={64} height={64} alt="" />
          <div>
            <RichText i18nKey="intent.bossBanner" values={{ bossName: theme.bossName, gold: ECON.bossBonusGold }} />
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
                  <b>{getRoadName(d)}</b>
                  <span style={{ fontSize: 12 }}>{owners.get(d)?.join(', ')}</span>
                </div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
                  {(Object.keys(ri.counts) as EnemyRole[]).map((r) => (
                    <span key={r} className="row" style={{ gap: 2, fontWeight: 800 }}>
                      <img src={enemyImg(theme.id, r)} width={40} height={40} style={{ objectFit: 'contain' }} alt="" />
                      ×{ri.counts[r]}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 13 }}>
                  {roles[ri.featured].icon && <Icon id={roles[ri.featured].icon!} size={16} />} <b>{roles[ri.featured].plural}:</b> {roles[ri.featured].tip}
                </div>
              </div>
            );
          })}
      </div>
      <h3 style={{ marginTop: 12 }}>{t('intent.bestiaryTitle', { themeName: theme.name })}</h3>
      <div className="col" style={{ gap: 4 }}>
        {(Object.keys(roles) as EnemyRole[]).map((r) => (
          <div key={r} className="row" style={{ fontSize: 13 }}>
            <img src={enemyImg(theme.id, r)} width={36} height={36} style={{ objectFit: 'contain' }} alt="" />
            <div>
              <b>{roles[r].name}</b> · {r === 'boss' ? t('intent.bossHp') : t('intent.enemyHp', { hp: ENEMIES[r].hp })} — {roles[r].tip}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function DawnReport({ view, report, onClose, onReplay }: { view: SeasonView; report: DayReport; onClose: () => void; onReplay: () => void }) {
  const { t } = useTranslation();
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
      <div className="center selectable">
        <h2>{report.keepFell ? t('report.titleFell') : report.stars === 3 ? t('report.titleFlawless') : t('report.titleHeld')}</h2>
        <Stars n={report.stars} size={48} />
        <div style={{ marginTop: 6 }}>
          {t('report.dawnLabel', { day: report.day })} · <Icon id="heart" size={18} />{' '}
          {t('report.keepSummary', { before: Math.round(report.keepBefore), after: Math.round(report.keepAfter) })} · {t('report.leaks', { count: report.battle.leaks })}
        </div>
        {report.bossKilled && <div style={{ fontWeight: 900, marginTop: 4 }}>{t('report.bossSlain', { bossName: theme.bossName, gold: ECON.bossBonusGold })}</div>}
        {report.rally && (
          <div style={{ marginTop: 4 }}>
            <Icon id="rally" size={18} /> {t('report.rally')}
          </div>
        )}
        {report.keepFell && <div style={{ marginTop: 4 }}>{t('report.keepRebuildHint')}</div>}
      </div>
      <div className="col selectable" style={{ marginTop: 10, gap: 4, fontSize: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>{t('report.yourReport')}</span>
          <b>{mine.r === null ? t('report.reportNone') : mine.r >= 1 ? t('report.reportTarget') : t('report.reportMiss')}</b>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>{t('report.goldEarned')}</span>
          <Gold n={mine.goldEarned} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>{t('report.combatStats')}</span>
          <b>
            {formatNumber(Math.round(stats.damage))} · {formatNumber(stats.kills)} · {formatNumber(stats.blocks)}
          </b>
        </div>
        {mine.skipped.length > 0 && (
          <div className="error">
            {t('report.notCarriedOut', {
              items: mine.skipped.map((s) => `${orderLabel(s.order, view)} (${translateSkipReason(s.reason)})`).join(', '),
            })}
          </div>
        )}
        {(report.battle.escaped?.length ?? 0) > 0 && (
          <div className="muted" style={{ fontSize: 13 }}>
            {t('report.sunriseRetreat', {
              enemies: Object.entries(
                report.battle.escaped!.reduce<Record<string, { n: number; hp: number[] }>>((acc, e) => {
                  const k = theme.roles[e.role].name;
                  (acc[k] ??= { n: 0, hp: [] }).n++;
                  acc[k].hp.push(e.hpPct);
                  return acc;
                }, {}),
              )
                .map(([k, v]) => (v.n === 1 ? t('report.escapedSingle', { name: k, hp: v.hp[0] }) : t('report.escapedMultiple', { count: v.n, name: k })))
                .join(', '),
            })}
          </div>
        )}
        <h3 style={{ marginTop: 8 }}>{t('report.heroesOfNight')}</h3>
        <div>
          {t('report.mvpDamage')} <b>{name(report.mvp.damage)}</b>
        </div>
        <div>
          {t('report.mvpWall')} <b>{name(report.mvp.wall)}</b>
        </div>
        <div>
          {t('report.mvpPatron')} <b>{name(report.mvp.patron)}</b>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {view.setup.players.map((p, i) => {
            const pr = report.players[p.id];
            const mark = pr.r === null ? '—' : pr.r >= 1 ? '✔' : pr.r > 0 ? `${Math.round(pr.r * 100)}%` : '✗';
            return (
              <span key={p.id} className="chip" style={{ borderColor: cssColor(PLAYER_COLORS[i % 8]), color: '#fff' }}>
                {p.name}: {mark}
              </span>
            );
          })}
        </div>
      </div>
      {final && (
        <div className="center selectable" style={{ marginTop: 12 }}>
          <h2>{t('report.seasonComplete')}</h2>
          <div style={{ fontSize: 18 }}>
            <RichText i18nKey="report.rankSummary" values={{ rank: t(`report.ranks.${final.rank}`), pct: Math.round(final.pct * 100) }} />
          </div>
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn grow" onClick={onReplay}>
          {t('report.watchAgain')}
        </button>
        <button className="btn gold grow" onClick={onClose}>
          {t('report.onward')}
        </button>
      </div>
    </Sheet>
  );
}
