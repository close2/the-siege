import { useState } from 'react';
import { useApp } from '../App';
import { enemyArtId } from '../content/artSpec';
import { BARRACKS, BUILD_COST, ECON, ENEMIES, HEROES, KEEP, TOWERS } from '../content/stats';
import { getTheme } from '../content/themes';
import { DRY_RUN_ID } from '../net/types';
import type { BuildingType, EnemyRole, HeroClass } from '../sim/types';
import { Gold, HERO_INFO, HeroPicker, Icon, Stars, portraitUrl } from './common';

type Tab = 'timeline' | 'daily' | 'defenders' | 'enemies';

const TOWER_GUIDE: { type: BuildingType; name: string; role: string; details: string; icons: string[] }[] = [
  {
    type: 'archer',
    name: 'Archer Tower',
    role: 'Fast single-target physical arrows · hits ground & flying',
    details: `${TOWERS.archer.dmg.join('/')} dmg · range ${TOWERS.archer.range.join('/')} · ${TOWERS.archer.rate} shot/s`,
    icons: ['physical', 'flying'],
  },
  {
    type: 'barracks',
    name: 'Barracks',
    role: 'Trains footmen who block and fight ground enemies on the road',
    details: `${BARRACKS.soldiers.join('/')} soldiers · ${BARRACKS.hp.join('/')} HP · ${BARRACKS.dmg.join('/')} dmg/s (respawn ${BARRACKS.respawn}s)`,
    icons: ['armor'],
  },
  {
    type: 'mage',
    name: 'Mage Tower',
    role: 'Magic bolts that ignore armour · hits ground & flying',
    details: `${TOWERS.mage.dmg.join('/')} dmg · range ${TOWERS.mage.range.join('/')} · ${TOWERS.mage.rate} shot/s`,
    icons: ['magic', 'flying'],
  },
  {
    type: 'catapult',
    name: 'Catapult',
    role: 'Slow, heavy splash damage vs ground clusters · cannot hit flyers',
    details: `${TOWERS.catapult.dmg.join('/')} splash dmg · range ${TOWERS.catapult.range[0]} · ${TOWERS.catapult.rate} shot/s`,
    icons: ['siege'],
  },
];

export function TutorialContent({
  onStartDryRun,
  inDryRun,
}: {
  onStartDryRun?: (heroClass: HeroClass) => Promise<void> | void;
  inDryRun?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('timeline');
  const [heroClass, setHeroClass] = useState<HeroClass>('knight');
  const [busy, setBusy] = useState(false);
  const theme = getTheme('sugar');

  const triggerDryRun = async () => {
    if (!onStartDryRun) return;
    setBusy(true);
    try {
      await onStartDryRun(heroClass);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div style={{ fontSize: 14, lineHeight: 1.45 }}>
        <b>The Siege</b> is a cooperative habit challenge and base-defence game for <b>2–8 players</b> over <b>7–90 days</b>. Each player guards a sector of the valley; your real-life daily habit reports earn gold and send your hero into battle before the enemy horde attacks at <b>Dawn</b>.
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {(
          [
            ['timeline', '⏳ When to do what'],
            ['daily', '✔ Daily loop'],
            ['defenders', '🏰 Towers & heroes'],
            ['enemies', '👾 Enemies & stars'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={'btn small' + (tab === id ? ' gold' : '')} onClick={() => setTab(id)} style={{ flex: '1 1 auto' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'timeline' && (
        <div className="col" style={{ gap: 10, fontSize: 14, lineHeight: 1.45 }}>
          <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
            <b>1. Before Day 1 · Gather the Defenders (Lobby)</b>
            <div>
              • <b>One player creates the challenge:</b> choose a habit type (<i>Yes/No</i>, <i>Checklist</i>, or <i>Numeric</i> target), start date, length (7–90 active days), difficulty, and <b>Dawn time</b> (default 11:00).
            </div>
            <div>
              • <b>Share the 6-character invite code:</b> friends join before the start date and pick their <b>Hero Class</b>. Once Day 1 opens, the team roster locks and roads/sectors are assigned.
            </div>
          </div>

          <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
            <b>2. Every Day & Evening · Report & Plan (00:00 → Dawn next morning)</b>
            <div>
              Each active day stays open from <b>00:00</b> on that calendar day until <b>Dawn the next morning</b> (e.g. 11:00 the following day — so you can report in the evening or over breakfast the next morning):
            </div>
            <div>
              • <b>👁 Scout:</b> Check which roads tonight's wave will march down and what special enemy role is featured.
            </div>
            <div>
              • <b>✔ Report:</b> Log whether you kept your habit for the day. Reporting earns gold, levels up your hero, and sends them to fight tonight.
            </div>
            <div>
              • <b>⚒ Plan & Build:</b> Tap your <b>glowing plots</b> on the map to build, upgrade, or repair towers, set your hero's stance, or share gold. <i>Everything can be edited freely until Dawn!</i>
            </div>
          </div>

          <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
            <b>3. At Dawn (Next Morning) · The Nightly Assault</b>
            <div>
              When Dawn arrives, the day closes and resolves automatically in 4 steps:
              <br />
              <b>1. Economy</b> (gold & XP paid, Rally checked) → <b>2. Orders</b> (towers built/upgraded, gold shared) → <b>3. Battle</b> (enemies march toward the Keep) → <b>4. Dawn Report</b> (0–3 ★ stars & MVPs).
            </div>
            <div>
              • Open the app anytime after Dawn and tap <b>☀ Watch Dawn</b> to watch the battle replay and start planning for the new day.
            </div>
          </div>
        </div>
      )}

      {tab === 'daily' && (
        <div className="col" style={{ gap: 10, fontSize: 14, lineHeight: 1.45 }}>
          <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
            <b>✔ Step 1: Report Your Habit (Honesty Always Pays!)</b>
            <div>Your daily report determines your gold, Hero XP, and Hero status for tonight's battle:</div>
            <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
              <div>
                🔥 <b>Inspired (150%+ numeric target):</b> Base <b>{ECON.overGold}g</b> · <b>+{ECON.xpHit} XP</b> · Hero gets <b>+20% HP & damage</b> tonight.
              </div>
              <div>
                ✅ <b>Target Reached (100%):</b> Base <b>{ECON.hitGold}g</b> · <b>+{ECON.xpHit} XP</b> · Hero fights at full strength.
              </div>
              <div>
                🤝 <b>Honest Miss (&lt;100%):</b> Base <b>{ECON.missBase}–{ECON.missBase + ECON.missPerR - 1}g</b> · <b>+{ECON.xpMiss} XP</b> · Hero still fights (<i>Weary</i>, −20% dmg). <b>Reporting a miss is always much better than silence!</b>
              </div>
              <div>
                💤 <b>No Report Submitted:</b> <b>0g</b> · <b>0 XP</b> · Hero <b>stays home</b>. After {ECON.dormantAfter} missed reports in a row, your player is marked <i>Dormant</i> until you report again.
              </div>
            </div>
            <div style={{ marginTop: 4 }}>
              <Icon id="rally" size={18} /> <b>Team Rally:</b> Whenever <b>every</b> player submits a report (even an honest miss!), a Rally banner flies on the Keep and <b>all towers fire +15% faster</b> tonight.
            </div>
          </div>

          <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
            <b>⚒ Step 2: Build Towers, Position Your Hero & Share Gold</b>
            <div>
              • <b>Tap your glowing plots</b> on the valley map to <b>Build</b> a Level 1 tower, <b>Upgrade</b> (Level 1 → 2 → 3), or <b>Repair</b> battle damage.
            </div>
            <div>
              • <b>Open ⚒ Plan</b> to choose where your <b>Hero</b> fights tonight: defend your own sector, guard the Keep, or <b>reinforce a teammate's road</b> that faces a heavy wave or Boss!
            </div>
            <div>
              • <b>Share Gold:</b> In <b>⚒ Plan</b>, you can send gold (min {ECON.minDonate}g) to a teammate who needs a key tower, or donate to the <b>Keep Fund</b> ({KEEP.fund[0]}g → Lv 2, {KEEP.fund[1]}g → Lv 3 for higher Keep HP and stronger Keep archers).
            </div>
          </div>
        </div>
      )}

      {tab === 'defenders' && (
        <div className="col" style={{ gap: 10, fontSize: 14, lineHeight: 1.4 }}>
          <h3 style={{ margin: '2px 0 0' }}>Towers (Lv 1 → Lv 3)</h3>
          <div style={{ fontSize: 12 }} className="muted">
            Towers have { [300, 450, 600].join(' / ') } HP (Lv 1/2/3). Siege enemies can damage them; if a tower hits 0 HP it turns into Ruins and must be rebuilt.
          </div>
          {TOWER_GUIDE.map((t) => (
            <div key={t.type} className="option" style={{ cursor: 'default' }}>
              <img src={`/assets/building_${t.type}_1.webp`} alt="" />
              <div className="grow">
                <b>{t.name}</b>{' '}
                {t.icons.map((ic) => (
                  <Icon key={ic} id={ic} size={15} />
                ))}
                <div style={{ fontSize: 13 }}>{t.role}</div>
                <div style={{ fontSize: 12 }} className="muted">
                  {t.details}
                </div>
              </div>
              <Gold n={BUILD_COST[t.type]} />
            </div>
          ))}

          <h3 style={{ margin: '6px 0 0' }}>Hero Classes (Lv 1 → Lv 5)</h3>
          <div style={{ fontSize: 12 }} className="muted">
            Heroes gain +12% HP & damage per level and respawn 10s after falling in battle — as long as you reported today!
          </div>
          {(['knight', 'ranger', 'priest'] as HeroClass[]).map((h) => (
            <div key={h} className="option" style={{ cursor: 'default' }}>
              <img src={portraitUrl(h)} alt="" style={{ borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', background: '#c9b48a' }} />
              <div className="grow">
                <b>{HERO_INFO[h].name}</b> · {HEROES[h].hp} HP · {HEROES[h].dmg} dmg
                <div style={{ fontSize: 13 }}>{HERO_INFO[h].text}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'enemies' && (
        <div className="col" style={{ gap: 10, fontSize: 14, lineHeight: 1.4 }}>
          <h3 style={{ margin: '2px 0 0' }}>The Sugar Horde & Counters</h3>
          {(['grunt', 'runner', 'brute', 'flyer', 'siege', 'boss'] as EnemyRole[]).map((r) => {
            const roleInfo = theme.roles[r];
            return (
              <div key={r} className="option" style={{ cursor: 'default', padding: 6 }}>
                <img src={`/assets/${enemyArtId('sugar', r)}.webp`} alt="" style={{ width: 46, height: 46, flex: '0 0 46px' }} />
                <div className="grow">
                  <b>{roleInfo.name}</b>{' '}
                  {roleInfo.icon && <Icon id={roleInfo.icon} size={15} />}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {' '}
                    · {r === 'boss' ? 'Boss night' : `${ENEMIES[r].hp} HP · leak −${ENEMIES[r].leak} Keep HP`}
                  </span>
                  <div style={{ fontSize: 13 }}>{roleInfo.tip}</div>
                </div>
              </div>
            );
          })}

          <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>Stars, Boss Nights & Keep Recovery</b>
              <Stars n={3} size={20} />
            </div>
            <div>
              • <b>★★★:</b> 0 leaks · <b>★★:</b> Keep lost ≤10% HP · <b>★:</b> Keep survived · <b>0 ★:</b> Keep fell.
            </div>
            <div>
              • <b>No Game Over:</b> If the Keep falls, it is rebuilt at <b>50% HP</b> the next morning (and heals +5 HP each day).
            </div>
            <div>
              • <b>Boss Nights:</b> Every 7th active day (in 14+ day seasons) and on the <b>final night</b>. Slaying the Boss grants <b>+1 Bonus Star</b> and <b>+{ECON.bossBonusGold} gold</b> to every defender!
            </div>
          </div>
        </div>
      )}

      {onStartDryRun && !inDryRun && (
        <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default', borderColor: '#b8860b', background: 'rgba(255, 215, 100, 0.28)' }}>
          <h3 style={{ margin: 0 }}>🎯 Interactive Dry Run (3-Day Practice)</h3>
          <div style={{ fontSize: 13 }}>
            Practice scouting, reporting, building towers, and skipping to Dawn across a guided 3-day mini-season with two bot teammates (<b>Brin</b> & <b>Mara</b>) — culminating in a Day 3 Boss fight!
          </div>
          <HeroPicker value={heroClass} onChange={setHeroClass} />
          <button type="button" className="btn gold block" disabled={busy} onClick={triggerDryRun}>
            ⚔ Start 3-Day Dry Run
          </button>
        </div>
      )}
    </div>
  );
}

export function TutorialScreen() {
  const { backend, navigate } = useApp();

  const startDryRun = async (heroClass: HeroClass) => {
    await backend.startDryRun(heroClass);
    navigate(`/c/${DRY_RUN_ID}`);
  };

  return (
    <div className="screen bg-art col">
      <div className="row">
        <button className="btn small" onClick={() => navigate('/')}>
          ‹ Home
        </button>
        <h2 className="grow" style={{ margin: 0, textShadow: '0 2px 6px #000' }}>
          How to Play
        </h2>
      </div>
      <div className="panel col">
        <TutorialContent onStartDryRun={startDryRun} />
      </div>
    </div>
  );
}
