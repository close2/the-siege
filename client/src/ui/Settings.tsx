import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../App';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../pwa/push';
import { sound } from '../render/Sound';
import { LanguageSelect, useNow } from './common';

export function Settings() {
  const { t } = useTranslation();
  const { backend, user, setUser, navigate } = useApp();
  const [name, setName] = useState(user.name);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [claimCode, setClaimCode] = useState('');
  const [pushOn, setPushOn] = useState(false);
  const [muted, setMuted] = useState(sound.muted);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000, backend.now.bind(backend));

  useEffect(() => {
    currentSubscription().then((s) => setPushOn(!!s));
  }, []);

  const fmtCountdown = (ms: number): string => {
    if (ms <= 0) return t('settings.transferExpired');
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const run = async (f: () => Promise<void>) => {
    setError(null);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="screen bg-art col">
      <div className="row">
        <button className="btn small" onClick={() => navigate('/')}>
          {t('common.home')}
        </button>
        <h2 className="grow" style={{ margin: 0 }}>
          {t('settings.title')}
        </h2>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="chip">{msg}</div>}

      <div className="panel col">
        <h3>{t('settings.yourName')}</h3>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
          <button
            className="btn small"
            disabled={name.trim().length < 2 || name.trim() === user.name}
            onClick={() =>
              run(async () => {
                await backend.rename(name.trim());
                setUser({ ...user, name: name.trim() });
                setMsg(t('common.saved'));
              })
            }
          >
            {t('common.save')}
          </button>
        </div>
      </div>

      <div className="panel col">
        <h3>{t('settings.languageTitle')}</h3>
        <LanguageSelect />
      </div>

      <div className="panel col">
        <h3>{t('settings.soundAndNotifications')}</h3>
        <label className="row" style={{ fontWeight: 700 }}>
          <input
            type="checkbox"
            style={{ width: 22, height: 22 }}
            checked={!muted}
            onChange={(e) => {
              sound.setMuted(!e.target.checked);
              setMuted(!e.target.checked);
              if (e.target.checked) sound.play('coin');
            }}
          />
          {t('settings.soundEffects')}
        </label>
        <label className="row" style={{ fontWeight: 700 }}>
          <input
            type="checkbox"
            style={{ width: 22, height: 22 }}
            checked={pushOn}
            disabled={backend.mode === 'local'}
            onChange={(e) =>
              run(async () => {
                if (e.target.checked) {
                  await enablePush(backend);
                  setPushOn(true);
                  setMsg(t('settings.notificationsOn'));
                } else {
                  await disablePush(backend);
                  setPushOn(false);
                }
              })
            }
          />
          {t('settings.remindersAndDawn')}
        </label>
        {!pushSupported() && <div className="muted" style={{ fontSize: 13 }}>{t('settings.pushUnsupportedHint')}</div>}
      </div>

      {backend.mode === 'http' && (
        <div className="panel col">
          <h3>{t('settings.otherDeviceTitle')}</h3>
          <div style={{ fontSize: 14 }}>{t('settings.otherDeviceInstructions')}</div>
          {code && code.expiresAt > now ? (
            <div className="center">
              <div className="title selectable" style={{ fontSize: 30, letterSpacing: '0.16em' }}>
                {code.code}
              </div>
              <div className="muted">{t('settings.validFor', { time: fmtCountdown(code.expiresAt - now) })}</div>
            </div>
          ) : (
            <button className="btn" onClick={() => run(async () => setCode(await backend.transferCode()))}>
              {t('settings.showTransferCode')}
            </button>
          )}
          <div style={{ fontSize: 14, marginTop: 6 }}>{t('settings.useCodeFromOther')}</div>
          <div className="row">
            <input value={claimCode} onChange={(e) => setClaimCode(e.target.value.toUpperCase())} maxLength={12} placeholder={t('onboarding.codePlaceholder')} />
            <button
              className="btn small"
              disabled={claimCode.trim().length < 6}
              onClick={() =>
                run(async () => {
                  const u = await backend.claim(claimCode);
                  setUser(u);
                  setName(u.name);
                  setClaimCode('');
                  setMsg(t('settings.switchedTo', { name: u.name }));
                })
              }
            >
              {t('settings.useCode')}
            </button>
          </div>
        </div>
      )}

      <div className="panel col">
        <h3>{t('settings.about')}</h3>
        <div style={{ fontSize: 14 }}>
          {t('settings.modeLabel')} <b>{backend.mode === 'http' ? t('settings.modeOnline') : t('settings.modeOffline')}</b>
        </div>
        {backend.mode === 'local' && (
          <button
            className="btn small"
            onClick={() => {
              if (confirm(t('settings.confirmReset'))) {
                localStorage.removeItem('siege.local.v1');
                try {
                  indexedDB.deleteDatabase('siege-local');
                } catch {
                  /* ignore */
                }
                location.href = '/';
              }
            }}
          >
            {t('settings.resetDemoData')}
          </button>
        )}
      </div>
    </div>
  );
}
