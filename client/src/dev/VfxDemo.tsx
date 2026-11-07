// /dev/vfx — interactive showcase with a button per VFX helper (tasks.md T1.13).
import { useRef } from 'react';
import valley from '../content/maps/valley.json';
import { GameCanvas } from '../render/GameCanvas';
import type { GameView } from '../render/GameView';
import { sound } from '../render/Sound';
import type { MapDef } from '../sim/types';

export function VfxDemo() {
  const viewRef = useRef<GameView | null>(null);
  const cx = 1024;
  const cy = 1024;

  const fireEffect = (fn: (v: GameView) => void) => {
    const v = viewRef.current;
    if (!v) return;
    sound.unlock();
    fn(v);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, alignItems: 'center', fontSize: 13 }}>
        <b>VFX Lab</b>
        <button onClick={() => fireEffect((v) => v.vfx.sparks(cx, cy - 80, 0xffd27a, 14))}>sparks</button>
        <button onClick={() => fireEffect((v) => v.vfx.dust(cx, cy, 16))}>dust</button>
        <button
          onClick={() =>
            fireEffect((v) => {
              for (let i = 0; i < 8; i++) v.vfx.smoke(cx, cy - 80);
            })
          }
        >
          smoke
        </button>
        <button
          onClick={() =>
            fireEffect((v) => {
              for (let i = 0; i < 12; i++) v.vfx.fire(cx, cy - 80);
            })
          }
        >
          fire
        </button>
        <button onClick={() => fireEffect((v) => v.vfx.magicBolt({ x: cx - 180, y: cy - 60 }, { x: cx + 120, y: cy - 40 }, 1))}>magicBolt</button>
        <button onClick={() => fireEffect((v) => v.vfx.healGlow(cx, cy - 40))}>healGlow</button>
        <button onClick={() => fireEffect((v) => v.vfx.coinBurst(cx, cy - 60))}>coinBurst</button>
        <button onClick={() => fireEffect((v) => v.vfx.splash(cx, cy, 50))}>splash</button>
        <button onClick={() => fireEffect((v) => v.vfx.floatingText(cx, cy - 100, '+42 Gold!', 0xffe48a, 24))}>floatingText</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <GameCanvas
          onReady={(v) => {
            viewRef.current = v;
            v.showValley(valley as unknown as MapDef, null, { level: 2, hp: 130 });
            v.viewport.setZoom(1, true);
            v.viewport.moveCenter(cx, cy);
          }}
        />
      </div>
    </div>
  );
}
