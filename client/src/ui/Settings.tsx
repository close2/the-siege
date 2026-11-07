import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../pwa/push';
import { sound } from '../render/Sound';
import { useNow } from './common';

function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function Settings() {
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
          ‹ Home
        </button>
        <h2 className="grow" style={{ margin: 0 }}>
          Settings
        </h2>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="chip">{msg}</div>}

      <div className="panel col">
        <h3>Your name</h3>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
          <button
            className="btn small"
            disabled={name.trim().length < 2 || name.trim() === user.name}
            onClick={() =>
              run(async () => {
                await backend.rename(name.trim());
                setUser({ ...user, name: name.trim() });
                setMsg('Saved');
              })
            }
          >
            Save
          </button>
        </div>
      </div>

      <div className="panel col">
        <h3>Sound & notifications</h3>
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
          Sound effects
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
                  setMsg('Notifications on');
                } else {
                  await disablePush(backend);
                  setPushOn(false);
                }
              })
            }
          />
          Reminders & Dawn notifications
        </label>
        {!pushSupported() && <div className="muted" style={{ fontSize: 13 }}>Not supported in this browser. On iPhone: add the app to the home screen first.</div>}
      </div>

      {backend.mode === 'http' && (
        <div className="panel col">
          <h3>Use on another device</h3>
          <div style={{ fontSize: 14 }}>Generate a code and enter it on the other device ("I already play on another device" or below).</div>
          {code && code.expiresAt > now ? (
            <div className="center">
              <div className="title" style={{ fontSize: 34, letterSpacing: '0.2em' }}>
                {code.code}
              </div>
              <div className="muted">valid for {fmtCountdown(code.expiresAt - now)}</div>
            </div>
          ) : (
            <button className="btn" onClick={() => run(async () => setCode(await backend.transferCode()))}>
              Show transfer code
            </button>
          )}
          <div style={{ fontSize: 14, marginTop: 6 }}>Or use a code from another device:</div>
          <div className="row">
            <input value={claimCode} onChange={(e) => setClaimCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" />
            <button
              className="btn small"
              disabled={claimCode.trim().length !== 6}
              onClick={() =>
                run(async () => {
                  const u = await backend.claim(claimCode);
                  setUser(u);
                  setName(u.name);
                  setClaimCode('');
                  setMsg(`Switched to ${u.name}`);
                })
              }
            >
              Use code
            </button>
          </div>
        </div>
      )}

      <div className="panel col">
        <h3>About</h3>
        <div style={{ fontSize: 14 }}>
          Mode: <b>{backend.mode === 'http' ? 'Online' : 'Offline demo (this device only)'}</b>
        </div>
        {backend.mode === 'local' && (
          <button
            className="btn small"
            onClick={() => {
              if (confirm('Delete all local demo data?')) {
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
            Reset demo data
          </button>
        )}
      </div>
    </div>
  );
}
