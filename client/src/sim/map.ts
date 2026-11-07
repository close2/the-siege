// Map helpers, sector assignment and path geometry. design.md §2
import type { Dir, MapDef, PadDef, PadId, PlayerId, Pt, SectorDef, SectorId, SetupPlayer } from './types';

export const SECTOR_ORDER: readonly SectorId[] = ['N-out', 'E-out', 'S-out', 'W-out', 'N-in', 'E-in', 'S-in', 'W-in'];

export function sectorsPerPlayer(playerCount: number): number {
  return playerCount <= 3 ? 2 : 1;
}

/** Returns player → sectors, in deterministic order. */
export function assignSectors(players: readonly SetupPlayer[]): Record<PlayerId, SectorId[]> {
  const out: Record<PlayerId, SectorId[]> = {};
  const roads: Dir[] = ['N', 'E', 'S', 'W'];
  if (players.length <= 3) {
    players.forEach((p, i) => {
      out[p.id] = [`${roads[i]}-out`, `${roads[i]}-in`];
    });
  } else {
    players.forEach((p, i) => {
      out[p.id] = [SECTOR_ORDER[i]];
    });
  }
  return out;
}

export function sectorById(map: MapDef, id: SectorId): SectorDef | undefined {
  return map.sectors.find((s) => s.id === id);
}

export function padById(map: MapDef, id: PadId): { pad: PadDef; sector: SectorDef } | undefined {
  for (const sector of map.sectors) {
    const pad = sector.pads.find((p) => p.id === id);
    if (pad) return { pad, sector };
  }
  return undefined;
}

// ---------- path geometry ----------

export interface Path {
  pts: Pt[];
  cum: number[];
  len: number;
}

export function makePath(pts: Pt[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return { pts, cum, len: cum[cum.length - 1] };
}

/** Point at distance s along path plus unit direction (dx, dy). */
export function pointAt(path: Path, s: number): { x: number; y: number; dx: number; dy: number } {
  const { pts, cum } = path;
  if (s <= 0) s = 0;
  if (s >= path.len) s = path.len;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / segLen;
  const a = pts[i - 1];
  const b = pts[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / segLen, dy: (b.y - a.y) / segLen };
}

export function dist2(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
