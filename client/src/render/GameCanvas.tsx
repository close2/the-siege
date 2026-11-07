import { useEffect, useRef, useState } from 'react';
import { GameView } from './GameView';

/** Mounts a GameView into a div. `onReady` fires once the Pixi app is initialised. */
export function GameCanvas({ onReady, style }: { onReady: (v: GameView) => void; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let view: GameView | null = null;
    let cancelled = false;
    GameView.create(ref.current!)
      .then((v) => {
        if (cancelled) v.destroy();
        else {
          view = v;
          onReady(v);
        }
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      view?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none', ...style }}>
      {error && <div style={{ position: 'absolute', inset: 0, padding: 16, color: '#f88' }}>{error}</div>}
    </div>
  );
}
