import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../App';
import { shortAccountTag } from '../state/seasonHelpers';

export function LinkDevice({ initialCode, onClearCode }: { initialCode: string; onClearCode: () => void }) {
  const { t } = useTranslation();
  const { backend, user, setUser, navigate } = useApp();
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const challengeCount = user.challengeCount ?? 0;

  const confirmLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await backend.claim(code);
      setUser(u);
      onClearCode();
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="screen bg-art col">
      <div className="row">
        <button
          className="btn small"
          onClick={() => {
            onClearCode();
            navigate('/');
          }}
        >
          {t('common.home')}
        </button>
        <h2 className="grow" style={{ margin: 0 }}>
          {t('link.title')}
        </h2>
      </div>
      <form className="panel col" onSubmit={confirmLink}>
        <div style={{ fontSize: 14 }}>{t('link.description')}</div>
        <div className="muted" style={{ fontSize: 13 }}>
          {t('link.currentAccount', { name: user.name, tag: shortAccountTag(user.id) })}
        </div>
        {challengeCount > 0 && (
          <div className="error" style={{ fontSize: 13 }}>
            {t('link.switchWarning', { name: user.name, tag: shortAccountTag(user.id), count: challengeCount })}
          </div>
        )}
        <label className="field">
          {t('onboarding.transferCode')}
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} placeholder={t('onboarding.codePlaceholder')} />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn gold block" disabled={busy || code.trim().length < 6}>
          {t('link.confirmButton')}
        </button>
      </form>
    </div>
  );
}
