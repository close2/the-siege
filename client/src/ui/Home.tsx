import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { DRY_RUN_ID, type Challenge } from '../net/types';
import { seasonClock } from '../sim/calendar';
import { fmtDuration, portraitUrl } from './common';

export function Home() {
  const { backend, user, navigate } = useApp();
  const [list, setList] = useState<Challenge[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pending = sessionStorage.getItem('siege.pendingJoin');
    if (pending) {
      sessionStorage.removeItem('siege.pendingJoin');
      navigate(`/join/${pending}`);
      return;
    }
    backend
      .listChallenges()
      .then(setList)
      .catch((e) => setError((e as Error).message));
  }, [backend, navigate]);

  const startDryRun = async () => {
    try {
      await backend.startDryRun();
      navigate(`/c/${DRY_RUN_ID}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="screen bg-art col">
      <div className="row">
        <h1 className="grow" style={{ margin: 0, textShadow: '0 2px 8px #000' }}>
          The Siege
        </h1>
        <button className="btn small" onClick={() => navigate('/tutorial')}>
          📖 Help
        </button>
        <button className="btn small" onClick={() => navigate('/settings')}>
          ⚙ {user.name}
        </button>
      </div>
      {backend.mode === 'local' && <div className="chip" style={{ alignSelf: 'flex-start' }}>Offline demo · teammates are bots</div>}
      {error && <div className="error">{error}</div>}

      {list && list.length === 0 && (
        <div className="panel center col">
          <h2>No sieges yet</h2>
          <p style={{ margin: 0 }}>Start a challenge with friends — or learn the ropes with a guided dry run.</p>
          <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <button className="btn small" onClick={() => navigate('/tutorial')}>
              📖 How to play
            </button>
            <button className="btn small gold" onClick={startDryRun}>
              🎯 Try a dry run
            </button>
          </div>
        </div>
      )}
      {list?.map((c) => {
        const cNow = backend.now(c.id);
        const clock = seasonClock(c.config, cNow);
        const me = c.members.find((m) => m.userId === user.id);
        const isDry = c.id === DRY_RUN_ID;
        const status = clock.finished
          ? 'Season over'
          : !clock.started
            ? `Starts in ${fmtDuration(clock.windows[0].open - cNow)}`
            : `Day ${Math.min(c.config.days, clock.resolved + 1)} of ${c.config.days}`;
        return (
          <button key={c.id} className="option panel" style={{ border: undefined, padding: 4 }} onClick={() => navigate(`/c/${c.id}`)}>
            {me && <img src={portraitUrl(me.heroClass)} alt="" style={{ borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', background: '#c9b48a' }} />}
            <div className="grow">
              <div className="title" style={{ fontSize: 18, margin: 0 }}>
                {c.config.title}
              </div>
              <div style={{ fontSize: 13 }}>
                {isDry ? 'Practice · ' : ''}
                {status} · {c.members.length} defenders
              </div>
            </div>
            <span style={{ fontSize: 24 }}>›</span>
          </button>
        );
      })}

      <button className="btn gold block" onClick={() => navigate('/new')}>
        ⚔ New challenge
      </button>
      {backend.mode === 'http' && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) navigate(`/join/${code.trim().toUpperCase()}`);
          }}
        >
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Invite code" maxLength={8} />
          <button className="btn" disabled={code.trim().length < 4}>
            Join
          </button>
        </form>
      )}
      {list && list.length > 0 && !list.some((c) => c.id === DRY_RUN_ID) && (
        <button className="btn block" onClick={startDryRun}>
          🎯 Practice in a 3-day dry run
        </button>
      )}
    </div>
  );
}
