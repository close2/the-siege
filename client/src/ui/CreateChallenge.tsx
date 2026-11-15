import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../App';
import { getSelectableThemes, type ThemeId } from '../content/themes';
import { addDays, localDate } from '../sim/calendar';
import type { ChallengeConfig, ChallengeType, Difficulty, HeroClass } from '../sim/types';
import { HeroPicker } from './common';

export function CreateChallenge() {
  const { t } = useTranslation();
  const { backend, navigate } = useApp();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const today = localDate(backend.now(), tz);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ChallengeType>('binary');
  const [rules, setRules] = useState<string[]>(['']);
  const [target, setTarget] = useState(8000);
  const [unit, setUnit] = useState(() => t('create.presets.stepsUnit'));
  const [direction, setDirection] = useState<'higher' | 'lower'>('higher');
  const [startDate, setStartDate] = useState(backend.mode === 'local' ? today : addDays(today, 1));
  const [days, setDays] = useState(30);
  const [dawnTime, setDawnTime] = useState('11:00');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [theme, setTheme] = useState<ThemeId>('sugar');
  const [inactiveDates, setInactiveDates] = useState<string[]>([]);
  const [restInput, setRestInput] = useState('');
  const [heroClass, setHeroClass] = useState<HeroClass>('knight');
  const [bots, setBots] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const presets: { title: string; type: ChallengeType; rules: string[]; target?: number; unit?: string; direction?: 'higher' | 'lower' }[] = [
    { title: t('create.presets.noSugarTitle'), type: 'binary', rules: [t('create.presets.noSugarRule1')] },
    { title: t('create.presets.stepsTitle'), type: 'numeric', rules: [], target: 8000, unit: t('create.presets.stepsUnit'), direction: 'higher' },
    {
      title: t('create.presets.cleanTitle'),
      type: 'checklist',
      rules: [t('create.presets.cleanRule1'), t('create.presets.cleanRule2'), t('create.presets.cleanRule3')],
    },
    { title: t('create.presets.screenTitle'), type: 'numeric', rules: [], target: 60, unit: t('create.presets.screenUnit'), direction: 'lower' },
  ];

  const selectableThemes = getSelectableThemes();
  const cleanRules = rules.map((r) => r.trim()).filter(Boolean);
  const step0Valid =
    title.trim().length >= 2 && (type === 'numeric' ? target > 0 && unit.trim().length > 0 : type === 'binary' ? cleanRules.length === 1 : cleanRules.length >= 2);
  const step1Valid = days >= 7 && days <= 90 && startDate >= today && /^\d\d:\d\d$/.test(dawnTime);

  const applyPreset = (i: number) => {
    const p = presets[i];
    setTitle(p.title);
    setType(p.type);
    setRules(p.rules.length ? p.rules : ['']);
    if (p.target) setTarget(p.target);
    if (p.unit) setUnit(p.unit);
    if (p.direction) setDirection(p.direction);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    const config: ChallengeConfig = {
      title: title.trim(),
      type,
      rules: type === 'numeric' ? [] : cleanRules,
      ...(type === 'numeric' ? { target, unit: unit.trim(), direction } : {}),
      startDate,
      days,
      timeZone: tz,
      dawnTime,
      difficulty,
      theme,
      inactiveDates,
    };
    try {
      const c = await backend.createChallenge(config, heroClass, { bots });
      navigate(`/c/${c.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="screen bg-art col">
      <div className="row">
        <button className="btn small" onClick={() => (step ? setStep(step - 1) : navigate('/'))}>
          {t('common.back')}
        </button>
        <h2 className="grow" style={{ margin: 0, textShadow: '0 2px 6px #000' }}>
          {t('create.title')}
        </h2>
        <span className="chip">{step + 1}/3</span>
      </div>

      {step === 0 && (
        <div className="panel col">
          <h3>{t('create.stepWhat')}</h3>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {presets.map((p, i) => (
              <button key={i} type="button" className="btn small" onClick={() => applyPreset(i)}>
                {p.title}
              </button>
            ))}
          </div>
          <label className="field">
            {t('create.titleLabel')}
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder={t('create.titlePlaceholder')} />
          </label>
          <label className="field">
            {t('create.typeLabel')}
            <select
              value={type}
              onChange={(e) => {
                const nextType = e.target.value as ChallengeType;
                setType(nextType);
                if (nextType === 'binary') setRules([rules[0] ?? '']);
                if (nextType === 'checklist' && rules.length < 2) setRules([...rules, '']);
              }}
            >
              <option value="binary">{t('create.typeBinary')}</option>
              <option value="checklist">{t('create.typeChecklist')}</option>
              <option value="numeric">{t('create.typeNumeric')}</option>
            </select>
          </label>
          {type !== 'numeric' &&
            rules.map((r, i) => (
              <div key={i} className="row">
                <input value={r} onChange={(e) => setRules(rules.map((x, j) => (j === i ? e.target.value : x)))} placeholder={t('create.rulePlaceholder', { n: i + 1 })} maxLength={60} />
                {type === 'checklist' && rules.length > 2 && (
                  <button type="button" className="btn small" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          {type === 'checklist' && rules.length < 8 && (
            <button type="button" className="linkbtn" style={{ color: '#7a4a10', alignSelf: 'flex-start' }} onClick={() => setRules([...rules, ''])}>
              {t('create.addRule')}
            </button>
          )}
          {type === 'numeric' && (
            <>
              <div className="row">
                <label className="field grow">
                  {t('create.dailyTarget')}
                  <input type="number" min={1} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
                </label>
                <label className="field" style={{ width: 110 }}>
                  {t('create.unit')}
                  <input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={12} />
                </label>
              </div>
              <label className="field">
                {t('create.betterIs')}
                <select value={direction} onChange={(e) => setDirection(e.target.value as 'higher' | 'lower')}>
                  <option value="higher">{t('create.directionHigher')}</option>
                  <option value="lower">{t('create.directionLower')}</option>
                </select>
              </label>
            </>
          )}
          <button className="btn gold block" disabled={!step0Valid} onClick={() => setStep(1)}>
            {t('common.next')}
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="panel col">
          <h3>{t('create.stepWhen')}</h3>
          <div className="row">
            <label className="field grow">
              {t('create.startDate')}
              <input type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="field" style={{ width: 110 }}>
              {t('create.days')}
              <input type="number" min={7} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </label>
          </div>
          <label className="field">
            {t('create.dawnLabel')}
            <input type="time" value={dawnTime} onChange={(e) => setDawnTime(e.target.value)} />
          </label>
          <div className="row">
            <label className="field grow">
              {t('create.difficulty')}
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                <option value="very_easy">{t('create.diff_very_easy')}</option>
                <option value="easy">{t('create.diff_easy')}</option>
                <option value="normal">{t('create.diff_normal')}</option>
                <option value="hard">{t('create.diff_hard')}</option>
              </select>
            </label>
            {selectableThemes.length > 1 && (
              <label className="field grow">
                {t('create.enemyHorde')}
                <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)}>
                  {selectableThemes.map((th) => (
                    <option key={th.id} value={th.id}>
                      {th.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="field">
            <span style={{ fontWeight: 700, fontSize: 14 }}>{t('create.restDays')}</span>
            <div className="row">
              <input type="date" min={startDate} value={restInput} onChange={(e) => setRestInput(e.target.value)} />
              <button
                type="button"
                className="btn small"
                disabled={!restInput || inactiveDates.includes(restInput) || inactiveDates.length >= 90}
                onClick={() => {
                  setInactiveDates([...inactiveDates, restInput].sort());
                  setRestInput('');
                }}
              >
                {t('create.addRestDay')}
              </button>
            </div>
            {inactiveDates.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {inactiveDates.map((d) => (
                  <span key={d} className="chip">
                    {d}{' '}
                    <button type="button" className="linkbtn" style={{ padding: '0 2px', textDecoration: 'none' }} onClick={() => setInactiveDates(inactiveDates.filter((x) => x !== d))}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="muted selectable" style={{ fontSize: 13 }}>
            {t('create.timeZoneHint', { tz })}
          </div>
          <button className="btn gold block" disabled={!step1Valid} onClick={() => setStep(2)}>
            {t('common.next')}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="panel col">
          <h3>{t('create.chooseHero')}</h3>
          <HeroPicker value={heroClass} onChange={setHeroClass} />
          {backend.mode === 'local' && (
            <label className="field">
              {t('create.botTeammates', { count: bots })}
              <input type="range" min={1} max={7} value={bots} onChange={(e) => setBots(Number(e.target.value))} />
            </label>
          )}
          {error && <div className="error">{error}</div>}
          <button className="btn gold block" disabled={busy} onClick={create}>
            {t('create.submit')}
          </button>
        </div>
      )}
    </div>
  );
}
