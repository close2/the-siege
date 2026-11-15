import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../App';
import { formatDate } from '../i18n/format';
import type { ChallengeSummary } from '../net/types';
import type { HeroClass } from '../sim/types';
import { HeroPicker } from './common';

export function Join({ code }: { code: string }) {
  const { t } = useTranslation();
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
        {t('common.home')}
      </button>
      {error && <div className="error">{error}</div>}
      {info && (
        <div className="panel col">
          <h2 className="selectable">{info.title}</h2>
          <div className="selectable">
            {t('join.inviteSummary', {
              creator: info.creatorName,
              count: info.memberCount,
              days: info.days,
              startDate: formatDate(info.startDate),
            })}
          </div>
          {info.joinable ? (
            <>
              <h3>{t('join.chooseHero')}</h3>
              <HeroPicker value={heroClass} onChange={setHeroClass} />
              <button className="btn gold block" disabled={busy} onClick={join}>
                {t('join.joinButton')}
              </button>
            </>
          ) : (
            <div className="error">{t('join.notJoinable')}</div>
          )}
        </div>
      )}
    </div>
  );
}
