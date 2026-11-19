import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../App';
import { formatDateTime } from '../i18n/format';
import type { DeviceSession } from '../net/types';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../pwa/push';
import { sound } from '../render/Sound';
import { shortAccountTag } from '../state/seasonHelpers';
import { LanguageSelect, useNow } from './common';
import { QrCode } from './QrCode';

export function Settings() {
  const { t } = useTranslation();
  const { backend, user, setUser, navigate } = useApp();
  const [name, setName] = useState(user.name);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [claimCode, setClaimCode] = useState('');
  const [devices, setDevices] = useState<DeviceSession[] | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [muted, setMuted] = useState(sound.muted);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000, backend.now.bind(backend));

  useEffect(() => {
    setName(user.name);
  }, [user.name]);

  useEffect(() => {
    currentSubscription().then((s) => setPushOn(!!s));
  }, []);

  const loadDevices = useCallback(async () => {
    if (backend.mode !== 'http' || !backend.devices) return;
    try {
      setDevices(await backend.devices());
    } catch {
      /* ignore transient fetch errors */
    }
  }, [backend]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices, user.id]);

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

  const pairingLink = code && code.expiresAt > now ? `${location.origin}/link#${code.code}` : null;
  const accountTag = shortAccountTag(user.id);

  const sharePairingLink = async () => {
    if (!pairingLink || !code) return;
    if (navigator.share) {
      await navigator
        .share({ title: t('app.title'), text: t('settings.shareLinkText', { code: code.code }), url: pairingLink })
        .catch(() => undefined);
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(pairingLink);
      setMsg(t('settings.linkCopied'));
    }
  };

  const claimFromSettings = async () => {
    const count = user.challengeCount ?? 0;
    if (count > 0) {
      const ok = confirm(t('settings.confirmSwitchAccount', { name: user.name, tag: accountTag, count }));
      if (!ok) return;
    }
    await run(async () => {
      const u = await backend.claim(claimCode);
      setUser(u);
      setName(u.name);
      setClaimCode('');
      setCode(null);
      await loadDevices();
      setMsg(t('settings.switchedTo', { name: u.name }));
    });
  };

  const removeDevice = async (d: DeviceSession) => {
    const prompt = d.current
      ? t('settings.confirmSignOutThisDevice')
      : t('settings.confirmRemoveDevice', { label: d.label ?? t('settings.unknownDevice') });
    if (!confirm(prompt)) return;
    await run(async () => {
      await backend.revokeDevice?.(d.id);
      if (!d.current) {
        await loadDevices();
        setMsg(t('settings.deviceRemoved'));
      }
    });
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
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 style={{ margin: 0 }}>{t('settings.yourName')}</h3>
          <span className="muted selectable" style={{ fontSize: 12, fontFamily: 'monospace' }}>
            {t('settings.accountId', { tag: accountTag })}
          </span>
        </div>
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
          {code && code.expiresAt > now && pairingLink ? (
            <div className="col center" style={{ gap: 8 }}>
              <QrCode value={pairingLink} size={176} label={t('settings.qrCodeAlt')} />
              <div className="title selectable" style={{ fontSize: 28, letterSpacing: '0.16em', margin: 0 }}>
                {code.code}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {t('settings.validFor', { time: fmtCountdown(code.expiresAt - now) })}
              </div>
              <button className="btn gold block" onClick={() => void sharePairingLink()}>
                {t('settings.sharePairingLink')}
              </button>
            </div>
          ) : (
            <button className="btn gold" onClick={() => run(async () => setCode(await backend.transferCode()))}>
              {t('settings.showTransferCode')}
            </button>
          )}

          {devices && devices.length > 0 && (
            <div className="col" style={{ marginTop: 8, gap: 6 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{t('settings.linkedDevicesTitle', { count: devices.length })}</div>
              {devices.map((d) => (
                <div
                  key={d.id}
                  className="row"
                  style={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: 'rgba(20, 28, 44, 0.08)',
                  }}
                >
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {d.label ?? t('settings.unknownDevice')}{' '}
                      {d.current && (
                        <span className="muted" style={{ fontWeight: 600, fontSize: 12 }}>
                          ({t('settings.thisDevice')})
                        </span>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {t('settings.lastActive', { time: formatDateTime(d.lastUsedAt) })}
                    </div>
                  </div>
                  <button className="btn small" onClick={() => void removeDevice(d)}>
                    {d.current ? t('settings.signOut') : t('settings.removeDevice')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 14, marginTop: 8 }}>{t('settings.useCodeFromOther')}</div>
          <div className="row">
            <input value={claimCode} onChange={(e) => setClaimCode(e.target.value.toUpperCase())} maxLength={12} placeholder={t('onboarding.codePlaceholder')} />
            <button className="btn small" disabled={claimCode.trim().length < 6} onClick={() => void claimFromSettings()}>
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
