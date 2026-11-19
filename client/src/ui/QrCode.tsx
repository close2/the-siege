import { useMemo } from 'react';
import { encodeQr } from './qr';

export function QrCode({ value, size = 180, label }: { value: string; size?: number; label?: string }) {
  const qr = useMemo(() => {
    try {
      return encodeQr(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!qr) return null;
  const quiet = 4;
  const total = qr.size + quiet * 2;
  const parts: string[] = [];
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r * qr.size + c]) {
        parts.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
      }
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label={label ?? 'QR code'}
      style={{ display: 'block', margin: '0 auto', borderRadius: 10, background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#fff" />
      <path d={parts.join('')} fill="#141c2c" />
    </svg>
  );
}
