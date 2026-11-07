import { useState } from 'react';
import type { Backend, User } from '../net/types';

export function Onboarding({ backend, onDone }: { backend: Backend; onDone: (u: User) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'new' | 'code'>('new');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      <div className="center" style={{ marginBottom: 'auto', paddingTop: '8vh' }}>
        <h1 style={{ fontSize: 44, textShadow: '0 4px 16px #000' }}>The Siege</h1>
        <div style={{ fontWeight: 700, textShadow: '0 2px 6px #000' }}>Keep your habits. Hold the line. Together.</div>
      </div>
      <form className="panel col" onSubmit={submit}>
        {mode === 'new' ? (
          <>
            <h2>Who are you, defender?</h2>
            <label className="field">
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="e.g. Anna" autoFocus />
            </label>
            <button className="btn gold block" disabled={busy || name.trim().length < 2}>
              Begin
            </button>
            {backend.mode === 'http' && (
              <button type="button" className="linkbtn" style={{ color: '#7a4a10' }} onClick={() => setMode('code')}>
                I already play on another device
              </button>
            )}
          </>
        ) : (
          <>
            <h2>Use another device</h2>
            <div className="muted">On your other device open Settings → "Use on another device" and enter the code here.</div>
            <label className="field">
              Transfer code
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" autoFocus />
            </label>
            <button className="btn gold block" disabled={busy || code.length !== 6}>
              Continue
            </button>
            <button type="button" className="linkbtn" style={{ color: '#7a4a10' }} onClick={() => setMode('new')}>
              Back
            </button>
          </>
        )}
        {error && <div className="error">{error}</div>}
        {backend.mode === 'local' && <div className="muted" style={{ fontSize: 12 }}>Offline demo mode: progress is stored on this device; teammates are bots.</div>}
      </form>
    </div>
  );
}
