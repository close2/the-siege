import type { ParseKeys } from 'i18next';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import i18n, { LOCALE_LABELS, SUPPORTED_LOCALES, getLanguage, setLanguage, type Locale } from '../i18n';
import { formatNumber } from '../i18n/format';
import type { HeroClass } from '../sim/types';

export const PLAYER_COLORS = [0x3d7bd9, 0xd9a23d, 0x45b35a, 0xc0443a, 0x8e5bd0, 0x2fb5b0, 0xe07ab5, 0x9a9a9a];
export const cssColor = (c: number) => '#' + c.toString(16).padStart(6, '0');

const RICH_COMPONENTS = { bold: <b />, i: <i /> } as const;

export function RichText({ i18nKey, values }: { i18nKey: ParseKeys; values?: Record<string, unknown> }) {
  return <Trans i18nKey={i18nKey as never} values={values} components={RICH_COMPONENTS} />;
}

export function LanguageSelect({ compact, style }: { compact?: boolean; style?: CSSProperties }) {
  const { t, i18n: inst } = useTranslation();
  const current = getLanguage();
  void inst.language;
  return (
    <select
      aria-label={t('common.language')}
      value={current}
      onChange={(e) => void setLanguage(e.target.value as Locale)}
      style={
        compact
          ? {
              width: 'auto',
              padding: '4px 8px',
              fontSize: 13,
              fontWeight: 800,
              background: 'rgba(20, 28, 44, 0.82)',
              color: 'var(--text)',
              borderColor: 'rgba(244, 198, 78, 0.5)',
              ...style,
            }
          : style
      }
    >
      {SUPPORTED_LOCALES.map((loc) => (
        <option key={loc} value={loc}>
          {LOCALE_LABELS[loc]}
        </option>
      ))}
    </select>
  );
}

export function Icon({ id, size = 20, style }: { id: string; size?: number; style?: CSSProperties }) {
  return <img className="icon" src={`/assets/icon_${id}.webp`} width={size} height={size} alt="" draggable={false} style={style} />;
}

export function Gold({ n, size = 18 }: { n: number; size?: number }) {
  const { i18n: inst } = useTranslation();
  void inst.language;
  return (
    <span className="cost">
      <Icon id="gold" size={size} />
      {formatNumber(n)}
    </span>
  );
}

export function portraitUrl(heroClass: HeroClass) {
  return `/assets/portrait_${heroClass}.webp`;
}

export function Sheet({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
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
        <button className="close" onClick={onClose} aria-label={t('common.close')}>
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
  if (ms <= 0) return i18n.t('common.durationNow');
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return i18n.t('common.durationDaysHours', { d, h: h % 24 });
  if (h >= 1) return i18n.t('common.durationHoursMinutes', { h, m: m % 60 });
  return i18n.t('common.durationMinutes', { m: Math.max(1, m) });
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

const HERO_CLASSES: readonly HeroClass[] = ['knight', 'ranger', 'priest'];

export function getHeroInfo(h: HeroClass): { name: string; text: string } {
  return {
    name: i18n.t(`heroes.${h}.name`),
    text: i18n.t(`heroes.${h}.text`),
  };
}

export function HeroPicker({ value, onChange }: { value: HeroClass; onChange: (h: HeroClass) => void }) {
  const { i18n: inst } = useTranslation();
  void inst.language;
  return (
    <div className="col" style={{ gap: 6 }}>
      {HERO_CLASSES.map((h) => {
        const info = getHeroInfo(h);
        return (
          <button key={h} type="button" className={'option' + (value === h ? ' selected' : '')} onClick={() => onChange(h)}>
            <img src={portraitUrl(h)} alt="" style={{ borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', background: '#c9b48a' }} />
            <div>
              <b>{info.name}</b>
              <div style={{ fontSize: 13 }}>{info.text}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
