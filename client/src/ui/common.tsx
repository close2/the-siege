import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { HeroClass } from '../sim/types';

export const PLAYER_COLORS = [0x3d7bd9, 0xd9a23d, 0x45b35a, 0xc0443a, 0x8e5bd0, 0x2fb5b0, 0xe07ab5, 0x9a9a9a];
export const cssColor = (c: number) => '#' + c.toString(16).padStart(6, '0');

export function Icon({ id, size = 20, style }: { id: string; size?: number; style?: React.CSSProperties }) {
  return <img className="icon" src={`/assets/icon_${id}.webp`} width={size} height={size} alt="" draggable={false} style={style} />;
}

export function Gold({ n, size = 18 }: { n: number; size?: number }) {
  return (
    <span className="cost">
      <Icon id="gold" size={size} />
      {n}
    </span>
  );
}

export function portraitUrl(heroClass: HeroClass) {
  return `/assets/portrait_${heroClass}.webp`;
}

export function Sheet({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  const downOnBackdrop = useRef(false);
  const downInSheet = useRef(false);
  const mountedAt = useRef(performance.now());
  return (
    <div
      className="sheet-backdrop"
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!downOnBackdrop.current && e.detail > 0 && performance.now() - mountedAt.current < 350) return;
        downOnBackdrop.current = false;
        onClose();
      }}
    >
      <div
        className="sheet panel"
        style={{ position: 'relative', maxWidth: wide ? 720 : undefined }}
        onPointerDown={() => {
          downInSheet.current = true;
        }}
        onClickCapture={(e) => {
          if (!downInSheet.current && e.detail > 0 && performance.now() - mountedAt.current < 350) {
            e.stopPropagation();
            e.preventDefault();
          }
          downInSheet.current = false;
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="close" onClick={onClose} aria-label="close">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  const cb = useRef(onDone);
  cb.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => cb.current(), 2600);
    return () => clearTimeout(t);
  }, [text]);
  return <div className="toast">{text}</div>;
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m % 60}m`;
  return `${Math.max(1, m)}m`;
}

export function useNow(intervalMs = 1000, source: () => number = Date.now) {
  const src = useRef(source);
  src.current = source;
  const [now, setNow] = useState(() => src.current());
  useEffect(() => {
    const t = setInterval(() => setNow(src.current()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Stars({ n, max = 3, size = 28 }: { n: number; max?: number; size?: number }) {
  return (
    <span className="stars row" style={{ gap: 2 }}>
      {Array.from({ length: max }, (_, i) => (
        <img key={i} className="icon" src={`/assets/icon_${i < n ? 'star' : 'star_empty'}.webp`} width={size} height={size} style={{ animationDelay: `${0.2 + i * 0.25}s` }} alt="" />
      ))}
    </span>
  );
}

export const HERO_INFO: Record<HeroClass, { name: string; text: string }> = {
  knight: { name: 'Knight', text: 'Tough melee tank. Blocks two enemies at once.' },
  ranger: { name: 'Ranger', text: 'Long-range archer. Shoots flyers.' },
  priest: { name: 'Priestess', text: 'Holy magic that ignores armour and heals nearby allies.' },
};

export function HeroPicker({ value, onChange }: { value: HeroClass; onChange: (h: HeroClass) => void }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      {(Object.keys(HERO_INFO) as HeroClass[]).map((h) => (
        <button key={h} type="button" className={'option' + (value === h ? ' selected' : '')} onClick={() => onChange(h)}>
          <img src={portraitUrl(h)} alt="" style={{ borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', background: '#c9b48a' }} />
          <div>
            <b>{HERO_INFO[h].name}</b>
            <div style={{ fontSize: 13 }}>{HERO_INFO[h].text}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
