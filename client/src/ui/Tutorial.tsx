import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../App';
import { enemyArtId } from '../content/artSpec';
import { BARRACKS, BUILD_COST, BUILDING_HP, ECON, ENEMIES, HEROES, KEEP, TOWERS } from '../content/stats';
import { getTheme } from '../content/themes';
import { DRY_RUN_ID } from '../net/types';
import type { BuildingType, EnemyRole, HeroClass } from '../sim/types';
import { Gold, HeroPicker, Icon, RichText, Stars, getHeroInfo, portraitUrl } from './common';

type Tab = 'timeline' | 'daily' | 'defenders' | 'enemies';

export function TutorialContent({
  onStartDryRun,
  inDryRun,
}: {
  onStartDryRun?: (heroClass: HeroClass) => Promise<void> | void;
  inDryRun?: boolean;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('timeline');
  const [heroClass, setHeroClass] = useState<HeroClass>('knight');
  const [busy, setBusy] = useState(false);
  const theme = getTheme('sugar');

  const towerGuide: { type: BuildingType; name: string; role: string; details: string; icons: string[] }[] = [
    {
      type: 'archer',
      name: t('buildings.archer.name'),
      role: t('tutorial.defenders.archerRole'),
      details: t('tutorial.defenders.archerDetails', { dmg: TOWERS.archer.dmg.join('/'), range: TOWERS.archer.range.join('/'), rate: TOWERS.archer.rate }),
      icons: ['physical', 'flying'],
    },
    {
      type: 'barracks',
      name: t('buildings.barracks.name'),
      role: t('tutorial.defenders.barracksRole'),
      details: t('tutorial.defenders.barracksDetails', {
        soldiers: BARRACKS.soldiers.join('/'),
        hp: BARRACKS.hp.join('/'),
        dmg: BARRACKS.dmg.join('/'),
        respawn: BARRACKS.respawn,
      }),
      icons: ['armor'],
    },
    {
      type: 'mage',
      name: t('buildings.mage.name'),
      role: t('tutorial.defenders.mageRole'),
      details: t('tutorial.defenders.mageDetails', { dmg: TOWERS.mage.dmg.join('/'), range: TOWERS.mage.range.join('/'), rate: TOWERS.mage.rate }),
      icons: ['magic', 'flying'],
    },
    {
      type: 'catapult',
      name: t('buildings.catapult.name'),
      role: t('tutorial.defenders.catapultRole'),
      details: t('tutorial.defenders.catapultDetails', { dmg: TOWERS.catapult.dmg.join('/'), range: TOWERS.catapult.range[0], rate: TOWERS.catapult.rate }),
      icons: ['siege'],
    },
  ];

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
        <RichText i18nKey="tutorial.intro" />
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {(
          [
            ['timeline', t('tutorial.tabs.timeline')],
            ['daily', t('tutorial.tabs.daily')],
            ['defenders', t('tutorial.tabs.defenders')],
            ['enemies', t('tutorial.tabs.enemies')],
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
            <b>{t('tutorial.timeline.s1Title')}</b>
            <div>
              <RichText i18nKey="tutorial.timeline.s1Bullet1" />
            </div>
            <div>
              <RichText i18nKey="tutorial.timeline.s1Bullet2" />
            </div>
          </div>

          <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
            <b>{t('tutorial.timeline.s2Title')}</b>
            <div>
              <RichText i18nKey="tutorial.timeline.s2Intro" />
            </div>
            <div>
              <RichText i18nKey="tutorial.timeline.s2Scout" />
            </div>
            <div>
              <RichText i18nKey="tutorial.timeline.s2Report" />
            </div>
            <div>
              <RichText i18nKey="tutorial.timeline.s2Plan" />
            </div>
          </div>

          <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
            <b>{t('tutorial.timeline.s3Title')}</b>
            <div>
              {t('tutorial.timeline.s3StepsIntro')}
              <br />
              <RichText i18nKey="tutorial.timeline.s3StepsFlow" />
            </div>
            <div>
              <RichText i18nKey="tutorial.timeline.s3Watch" />
            </div>
          </div>
        </div>
      )}

      {tab === 'daily' && (
        <div className="col" style={{ gap: 10, fontSize: 14, lineHeight: 1.45 }}>
          <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
            <b>{t('tutorial.daily.s1Title')}</b>
            <div>{t('tutorial.daily.s1Intro')}</div>
            <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
              <div>
                <RichText i18nKey="tutorial.daily.inspired" values={{ gold: ECON.overGold, xp: ECON.xpHit }} />
              </div>
              <div>
                <RichText i18nKey="tutorial.daily.target" values={{ gold: ECON.hitGold, xp: ECON.xpHit }} />
              </div>
              <div>
                <RichText
                  i18nKey="tutorial.daily.miss"
                  values={{ minGold: ECON.missBase, maxGold: ECON.missBase + ECON.missPerR - 1, xp: ECON.xpMiss }}
                />
              </div>
              <div>
                <RichText i18nKey="tutorial.daily.none" values={{ dormantAfter: ECON.dormantAfter }} />
              </div>
            </div>
            <div style={{ marginTop: 4 }}>
              <Icon id="rally" size={18} /> <RichText i18nKey="tutorial.daily.rally" />
            </div>
          </div>

          <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
            <b>{t('tutorial.daily.s2Title')}</b>
            <div>
              <RichText i18nKey="tutorial.daily.s2Plots" />
            </div>
            <div>
              <RichText i18nKey="tutorial.daily.s2Hero" />
            </div>
            <div>
              <RichText i18nKey="tutorial.daily.s2Share" values={{ minDonate: ECON.minDonate, fund2: KEEP.fund[0], fund3: KEEP.fund[1] }} />
            </div>
          </div>
        </div>
      )}

      {tab === 'defenders' && (
        <div className="col" style={{ gap: 10, fontSize: 14, lineHeight: 1.4 }}>
          <h3 style={{ margin: '2px 0 0' }}>{t('tutorial.defenders.towersHeading')}</h3>
          <div style={{ fontSize: 12 }} className="muted">
            {t('tutorial.defenders.towersNote', { hpList: BUILDING_HP.join(' / ') })}
          </div>
          {towerGuide.map((tw) => (
            <div key={tw.type} className="option" style={{ cursor: 'default' }}>
              <img src={`/assets/building_${tw.type}_1.webp`} alt="" />
              <div className="grow">
                <b>{tw.name}</b>{' '}
                {tw.icons.map((ic) => (
                  <Icon key={ic} id={ic} size={15} />
                ))}
                <div style={{ fontSize: 13 }}>{tw.role}</div>
                <div style={{ fontSize: 12 }} className="muted">
                  {tw.details}
                </div>
              </div>
              <Gold n={BUILD_COST[tw.type]} />
            </div>
          ))}

          <h3 style={{ margin: '6px 0 0' }}>{t('tutorial.defenders.heroesHeading')}</h3>
          <div style={{ fontSize: 12 }} className="muted">
            {t('tutorial.defenders.heroesNote')}
          </div>
          {(['knight', 'ranger', 'priest'] as HeroClass[]).map((h) => {
            const info = getHeroInfo(h);
            return (
              <div key={h} className="option" style={{ cursor: 'default' }}>
                <img src={portraitUrl(h)} alt="" style={{ borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', background: '#c9b48a' }} />
                <div className="grow">
                  <b>{info.name}</b> · {t('tutorial.defenders.heroStatLine', { hp: HEROES[h].hp, dmg: HEROES[h].dmg })}
                  <div style={{ fontSize: 13 }}>{info.text}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'enemies' && (
        <div className="col" style={{ gap: 10, fontSize: 14, lineHeight: 1.4 }}>
          <h3 style={{ margin: '2px 0 0' }}>{t('tutorial.enemies.heading', { themeName: theme.name })}</h3>
          {(['grunt', 'runner', 'brute', 'flyer', 'siege', 'boss'] as EnemyRole[]).map((r) => {
            const roleInfo = theme.roles[r];
            return (
              <div key={r} className="option" style={{ cursor: 'default', padding: 6 }}>
                <img src={`/assets/${enemyArtId('sugar', r)}.webp`} alt="" style={{ width: 46, height: 46, flex: '0 0 46px' }} />
                <div className="grow">
                  <b>{roleInfo.name}</b> {roleInfo.icon && <Icon id={roleInfo.icon} size={15} />}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {' '}
                    · {r === 'boss' ? t('tutorial.enemies.bossNight') : t('tutorial.enemies.enemyStats', { hp: ENEMIES[r].hp, leak: ENEMIES[r].leak })}
                  </span>
                  <div style={{ fontSize: 13 }}>{roleInfo.tip}</div>
                </div>
              </div>
            );
          })}

          <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{t('tutorial.enemies.starsHeading')}</b>
              <Stars n={3} size={20} />
            </div>
            <div>
              <RichText i18nKey="tutorial.enemies.starsLine" />
            </div>
            <div>
              <RichText i18nKey="tutorial.enemies.noGameOver" />
            </div>
            <div>
              <RichText i18nKey="tutorial.enemies.bossNights" values={{ gold: ECON.bossBonusGold }} />
            </div>
          </div>
        </div>
      )}

      {onStartDryRun && !inDryRun && (
        <div className="option" style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default', borderColor: '#b8860b', background: 'rgba(255, 215, 100, 0.28)' }}>
          <h3 style={{ margin: 0 }}>{t('tutorial.dryRunCard.title')}</h3>
          <div style={{ fontSize: 13 }}>
            <RichText i18nKey="tutorial.dryRunCard.desc" />
          </div>
          <HeroPicker value={heroClass} onChange={setHeroClass} />
          <button type="button" className="btn gold block" disabled={busy} onClick={triggerDryRun}>
            {t('tutorial.dryRunCard.start')}
          </button>
        </div>
      )}
    </div>
  );
}

export function TutorialScreen() {
  const { t } = useTranslation();
  const { backend, navigate } = useApp();

  const startDryRun = async (heroClass: HeroClass) => {
    await backend.startDryRun(heroClass);
    navigate(`/c/${DRY_RUN_ID}`);
  };

  return (
    <div className="screen bg-art col">
      <div className="row">
        <button className="btn small" onClick={() => navigate('/')}>
          {t('common.home')}
        </button>
        <h2 className="grow" style={{ margin: 0, textShadow: '0 2px 6px #000' }}>
          {t('tutorial.title')}
        </h2>
      </div>
      <div className="panel col">
        <TutorialContent onStartDryRun={startDryRun} />
      </div>
    </div>
  );
}
