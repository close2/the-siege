import { useEffect, useState } from 'react';
import { useApp } from '../App';
import type { ChallengeSummary } from '../net/types';
import type { HeroClass } from '../sim/types';
import { HeroPicker } from './common';

export function Join({ code }: { code: string }) {
  const { backend, navigate, user } = useApp();
  const [info, setInfo] = useState<ChallengeSummary | null>(null);
  const [heroClass, setHeroClass] = useState<HeroClass>('ranger');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backend
      .inviteInfo(code)
      .then(async (i) => {
        const mine = await backend.listChallenges();
        if (mine.some((c) => c.id === i.id)) navigate(`/c/${i.id}`);
        else setInfo(i);
      })
      .catch((e) => setError((e as Error).message));
  }, [backend, code, navigate, user.id]);

  const join = async () => {
    setBusy(true);
    try {
      const c = await backend.join(code, heroClass);
      navigate(`/c/${c.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="screen bg-art col">
      <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/')}>
        ‹ Home
      </button>
      {error && <div className="error">{error}</div>}
      {info && (
        <div className="panel col">
          <h2>{info.title}</h2>
          <div>
            {info.creatorName} invites you to defend the valley. {info.memberCount} defender{info.memberCount === 1 ? '' : 's'} so far · {info.days} days from {info.startDate}.
          </div>
          {info.joinable ? (
            <>
              <h3>Choose your hero</h3>
              <HeroPicker value={heroClass} onChange={setHeroClass} />
              <button className="btn gold block" disabled={busy} onClick={join}>
                ⚔ Join the siege
              </button>
            </>
          ) : (
            <div className="error">This challenge has already started or is full.</div>
          )}
        </div>
      )}
    </div>
  );
}
