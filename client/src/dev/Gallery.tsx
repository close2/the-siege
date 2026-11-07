// /dev/gallery — every manifest id on a checkerboard and on a dark background, with missing ones highlighted in red (tasks.md T2.3).
import { useEffect, useState } from 'react';
import { ART, MANIFEST_IDS } from '../content/artSpec';

const CHECKERBOARD = 'repeating-conic-gradient(#d8d2c4 0% 25%, #ebe6da 0% 50%) 50% / 16px 16px';

export function Gallery() {
  const [gen, setGen] = useState<Record<string, { w: number; h: number; anchorX: number; anchorY: number }> | null>(null);
  useEffect(() => {
    fetch('/assets/assets.gen.json')
      .then((r) => r.json())
      .then(setGen)
      .catch(() => setGen({}));
  }, []);

  if (!gen) return <div style={{ padding: 12, color: '#ccc' }}>Loading gallery…</div>;

  const allIds = Array.from(new Set([...MANIFEST_IDS, ...Object.keys(gen)]));
  return (
    <div style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {allIds.map((id) => {
        const g = gen[id];
        const spec = ART[id];
        const missing = !g;
        return (
          <div key={id} style={{ width: 170, fontSize: 11, color: missing ? '#ff6b6b' : '#ccc', border: missing ? '1px solid #c0392b' : '1px solid #333', borderRadius: 4, padding: 4 }}>
            <div style={{ display: 'flex', height: 120 }}>
              {[CHECKERBOARD, '#1a2233'].map((bg, i) => (
                <div key={i} style={{ flex: 1, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  {missing ? (
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 6,
                        background: '#c0392b',
                        color: '#fff',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '2px solid #ff8a8a',
                      }}
                    >
                      {spec?.label || '?'}
                    </div>
                  ) : (
                    <img src={`/assets/${id}.webp`} style={{ maxWidth: '95%', maxHeight: '95%' }} alt="" />
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 4, fontWeight: missing ? 700 : 400 }}>
              {id} · {g ? `${g.w}×${g.h} · a ${g.anchorX},${g.anchorY}` : 'MISSING (placeholder)'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
