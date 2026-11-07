import { useState } from 'react';
import { useApp } from '../App';
import { SELECTABLE_THEMES, type ThemeId } from '../content/themes';
import { addDays, localDate } from '../sim/calendar';
import type { ChallengeConfig, ChallengeType, Difficulty, HeroClass } from '../sim/types';
import { HeroPicker } from './common';

const PRESETS: { title: string; type: ChallengeType; rules: string[]; target?: number; unit?: string; direction?: 'higher' | 'lower' }[] = [
  { title: 'No sugar', type: 'binary', rules: ['No added sugar today'] },
  { title: '8 000 steps', type: 'numeric', rules: [], target: 8000, unit: 'steps', direction: 'higher' },
  { title: 'Clean living', type: 'checklist', rules: ['No sugar', 'No alcohol', 'In bed by 23:00'] },
  { title: 'Less screen time', type: 'numeric', rules: [], target: 60, unit: 'min', direction: 'lower' },
];

export function CreateChallenge() {
  const { backend, navigate } = useApp();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const today = localDate(backend.now(), tz);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ChallengeType>('binary');
  const [rules, setRules] = useState<string[]>(['']);
  const [target, setTarget] = useState(8000);
  const [unit, setUnit] = useState('steps');
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

  const cleanRules = rules.map((r) => r.trim()).filter(Boolean);
  const step0Valid =
    title.trim().length >= 2 && (type === 'numeric' ? target > 0 && unit.trim().length > 0 : type === 'binary' ? cleanRules.length === 1 : cleanRules.length >= 2);
  const step1Valid = days >= 7 && days <= 90 && startDate >= today && /^\d\d:\d\d$/.test(dawnTime);

  const applyPreset = (i: number) => {
    const p = PRESETS[i];
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
          ‹ Back
        </button>
        <h2 className="grow" style={{ margin: 0, textShadow: '0 2px 6px #000' }}>
          New challenge
        </h2>
        <span className="chip">{step + 1}/3</span>
      </div>

      {step === 0 && (
        <div className="panel col">
          <h3>What's the challenge?</h3>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map((p, i) => (
              <button key={p.title} type="button" className="btn small" onClick={() => applyPreset(i)}>
                {p.title}
              </button>
            ))}
          </div>
          <label className="field">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder="No sugar for 30 days" />
          </label>
          <label className="field">
            Type
            <select
              value={type}
              onChange={(e) => {
                const t = e.target.value as ChallengeType;
                setType(t);
                if (t === 'binary') setRules([rules[0] ?? '']);
                if (t === 'checklist' && rules.length < 2) setRules([...rules, '']);
              }}
            >
              <option value="binary">Yes / no — one rule</option>
              <option value="checklist">Checklist — several rules</option>
              <option value="numeric">Number — e.g. steps, minutes</option>
            </select>
          </label>
          {type !== 'numeric' &&
            rules.map((r, i) => (
              <div key={i} className="row">
                <input value={r} onChange={(e) => setRules(rules.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Rule ${i + 1}`} maxLength={60} />
                {type === 'checklist' && rules.length > 2 && (
                  <button type="button" className="btn small" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          {type === 'checklist' && rules.length < 8 && (
            <button type="button" className="linkbtn" style={{ color: '#7a4a10', alignSelf: 'flex-start' }} onClick={() => setRules([...rules, ''])}>
              + add rule
            </button>
          )}
          {type === 'numeric' && (
            <>
              <div className="row">
                <label className="field grow">
                  Daily target
                  <input type="number" min={1} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
                </label>
                <label className="field" style={{ width: 110 }}>
                  Unit
                  <input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={12} />
                </label>
              </div>
              <label className="field">
                Better is
                <select value={direction} onChange={(e) => setDirection(e.target.value as 'higher' | 'lower')}>
                  <option value="higher">higher (at least the target)</option>
                  <option value="lower">lower (at most the target)</option>
                </select>
              </label>
            </>
          )}
          <button className="btn gold block" disabled={!step0Valid} onClick={() => setStep(1)}>
            Next
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="panel col">
          <h3>When?</h3>
          <div className="row">
            <label className="field grow">
              Start date
              <input type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="field" style={{ width: 110 }}>
              Days
              <input type="number" min={7} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </label>
          </div>
          <label className="field">
            Dawn — when each day's battle happens (next morning)
            <input type="time" value={dawnTime} onChange={(e) => setDawnTime(e.target.value)} />
          </label>
          <div className="row">
            <label className="field grow">
              Difficulty
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                <option value="very_easy">Very easy</option>
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
              </select>
            </label>
            {SELECTABLE_THEMES.length > 1 && (
              <label className="field grow">
                Enemy horde
                <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)}>
                  {SELECTABLE_THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="field">
            <span style={{ fontWeight: 700, fontSize: 14 }}>Rest / pause days (optional — skipped)</span>
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
                + Add
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
          <div className="muted" style={{ fontSize: 13 }}>
            Time zone: {tz}. You can report each day until Dawn the next morning.
          </div>
          <button className="btn gold block" disabled={!step1Valid} onClick={() => setStep(2)}>
            Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="panel col">
          <h3>Choose your hero</h3>
          <HeroPicker value={heroClass} onChange={setHeroClass} />
          {backend.mode === 'local' && (
            <label className="field">
              Bot teammates: {bots}
              <input type="range" min={1} max={7} value={bots} onChange={(e) => setBots(Number(e.target.value))} />
            </label>
          )}
          {error && <div className="error">{error}</div>}
          <button className="btn gold block" disabled={busy} onClick={create}>
            ⚔ Raise the banners
          </button>
        </div>
      )}
    </div>
  );
}
