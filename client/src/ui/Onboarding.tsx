import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Backend, User } from '../net/types';
import { LanguageSelect, Sheet } from './common';
import { TutorialContent } from './Tutorial';

export function Onboarding({
  backend,
  onDone,
  initialCode = '',
  notice = null,
}: {
  backend: Backend;
  onDone: (u: User) => void;
  initialCode?: string;
  notice?: string | null;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode);
  const [mode, setMode] = useState<'new' | 'code'>(initialCode ? 'code' : 'new');
  const [showTutorial, setShowTutorial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
      setMode('code');
    }
  }, [initialCode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(mode === 'new' ? await backend.register(name.trim()) : await backend.claim(code));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen bg-art" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <LanguageSelect compact />
      </div>
      <div className="center" style={{ marginBottom: 'auto', paddingTop: '5vh' }}>
        <h1 style={{ fontSize: 44, textShadow: '0 4px 16px #000' }}>{t('app.title')}</h1>
        <div style={{ fontWeight: 700, textShadow: '0 2px 6px #000' }}>{t('app.tagline')}</div>
      </div>
      <form className="panel col" onSubmit={submit}>
        {notice && <div className="chip">{notice}</div>}
        {backend.mode === 'http' && (
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className={'btn small grow' + (mode === 'new' ? ' gold' : '')}
              onClick={() => {
                setMode('new');
                setError(null);
              }}
            >
              {t('onboarding.tabNewPlayer')}
            </button>
            <button
              type="button"
              className={'btn small grow' + (mode === 'code' ? ' gold' : '')}
              onClick={() => {
                setMode('code');
                setError(null);
              }}
            >
              {t('onboarding.tabLinkDevice')}
            </button>
          </div>
        )}
        {mode === 'new' ? (
          <>
            <h2>{t('onboarding.whoAreYou')}</h2>
            <label className="field">
              {t('onboarding.yourName')}
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder={t('onboarding.namePlaceholder')} autoFocus />
            </label>
            <button className="btn gold block" disabled={busy || name.trim().length < 2}>
              {t('onboarding.begin')}
            </button>
            <button type="button" className="linkbtn" style={{ color: '#7a4a10' }} onClick={() => setShowTutorial(true)}>
              {t('onboarding.howItWorks')}
            </button>
          </>
        ) : (
          <>
            <h2>{t('onboarding.otherDeviceTitle')}</h2>
            <div className="muted" style={{ fontSize: 14 }}>
              {t('onboarding.otherDeviceHint')}
            </div>
            <label className="field">
              {t('onboarding.transferCode')}
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} placeholder={t('onboarding.codePlaceholder')} autoFocus />
            </label>
            <button className="btn gold block" disabled={busy || code.trim().length < 6}>
              {t('onboarding.continue')}
            </button>
          </>
        )}
        {error && <div className="error">{error}</div>}
        {backend.mode === 'local' && <div className="muted" style={{ fontSize: 12 }}>{t('onboarding.offlineNote')}</div>}
      </form>
      {showTutorial && (
        <Sheet wide onClose={() => setShowTutorial(false)}>
          <h2>{t('onboarding.howToPlay')}</h2>
          <TutorialContent />
        </Sheet>
      )}
    </div>
  );
}
