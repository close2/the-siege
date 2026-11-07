// /dev/map-editor — drag keep, road points, pads, rally and heroSpawn points over map_valley; export JSON (tasks.md T2.5).
import { useCallback, useEffect, useRef, useState } from 'react';
import valley from '../content/maps/valley.json';
import type { Dir, MapDef, Pt } from '../sim/types';
import { DIRS } from '../sim/types';

type Sel =
  | { kind: 'keep' }
  | { kind: 'road'; dir: Dir; i: number }
  | { kind: 'pad'; s: number; i: number }
  | { kind: 'rally'; s: number }
  | { kind: 'hero'; s: number };

export function MapEditor() {
  const [map, setMap] = useState<MapDef>(() => structuredClone(valley as unknown as MapDef));
  const [drag, setDrag] = useState<Sel | null>(null);
  const [selected, setSelected] = useState<Sel | null>(null);
  const [zoom, setZoom] = useState(0.45);
  const svg = useRef<SVGSVGElement>(null);

  const toWorld = (e: React.PointerEvent): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * map.width), y: Math.round(((e.clientY - r.top) / r.height) * map.height) };
  };

  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toWorld(e);
    setMap((m) => {
      const n = structuredClone(m);
      if (drag.kind === 'keep') n.keep = p;
      if (drag.kind === 'road') n.roads[drag.dir][drag.i] = p;
      if (drag.kind === 'pad') Object.assign(n.sectors[drag.s].pads[drag.i], p);
      if (drag.kind === 'rally') n.sectors[drag.s].rally = p;
      if (drag.kind === 'hero') n.sectors[drag.s].heroSpawn = p;
      return n;
    });
  };

  const deleteSelectedRoadPoint = useCallback(() => {
    if (!selected || selected.kind !== 'road') return;
    const { dir, i } = selected;
    setMap((m) => {
      if (m.roads[dir].length <= 2) return m;
      const n = structuredClone(m);
      n.roads[dir].splice(i, 1);
      return n;
    });
    setSelected(null);
  }, [selected]);

  const addRoadPoint = () => {
    const dir: Dir = selected?.kind === 'road' ? selected.dir : 'N';
    const i = selected?.kind === 'road' ? selected.i : map.roads[dir].length - 2;
    setMap((m) => {
      const n = structuredClone(m);
      const pts = n.roads[dir];
      const idx = Math.max(0, Math.min(pts.length - 2, i));
      const a = pts[idx];
      const b = pts[idx + 1];
      pts.splice(idx + 1, 0, { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
      return n;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
        deleteSelectedRoadPoint();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelectedRoadPoint]);

  const handle = (sel: Sel, p: Pt, r: number, fill: string, label?: string) => {
    const isSel = JSON.stringify(selected) === JSON.stringify(sel);
    return (
      <g
        key={JSON.stringify(sel)}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.target as Element).setPointerCapture(e.pointerId);
          setSelected(sel);
          setDrag(sel);
        }}
        style={{ cursor: 'grab' }}
      >
        <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke={isSel ? '#fff' : '#000'} strokeWidth={isSel ? 5 : 3} opacity={0.88} />
        {label && (
          <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize={14} fontWeight={800} fill="#fff" stroke="#000" strokeWidth={0.6} pointerEvents="none">
            {label}
          </text>
        )}
      </g>
    );
  };

  const json = JSON.stringify(map, null, 2);
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ flex: 1, overflow: 'auto', background: '#111' }}>
        <div style={{ position: 'relative', width: map.width * zoom, height: map.height * zoom }}>
          <img src="/assets/map_valley.webp" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} alt="" draggable={false} />
          <svg
            ref={svg}
            viewBox={`0 0 ${map.width} ${map.height}`}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            onPointerMove={move}
            onPointerUp={() => setDrag(null)}
            onPointerDown={() => setSelected(null)}
          >
            {DIRS.map((d) => (
              <polyline key={d} points={map.roads[d].map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="red" strokeWidth={6} opacity={0.7} />
            ))}
            {DIRS.flatMap((d) => map.roads[d].map((p, i) => handle({ kind: 'road', dir: d, i }, p, 10, '#f33')))}
            {map.sectors.flatMap((s, si) => [
              ...s.pads.map((p, i) => handle({ kind: 'pad', s: si, i }, p, 30, s.ring === 'outer' ? '#3af' : '#fc3', s.id.replace('-', '') + (i + 1))),
              handle({ kind: 'rally', s: si }, s.rally, 12, '#f0f', 'R'),
              handle({ kind: 'hero', s: si }, s.heroSpawn, 12, '#2d8', 'H'),
            ])}
            {handle({ kind: 'keep' }, map.keep, 26, '#fff', 'K')}
          </svg>
        </div>
      </div>
      <div style={{ width: 340, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
        <b>Map editor</b>
        <div>Drag handles. Blue = outer pads, yellow = inner pads, magenta (R) = rally, green (H) = hero spawn, red = road points.</div>
        <label>
          zoom <input type="range" min={0.2} max={1} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={addRoadPoint}>+ Add road point</button>
          <button disabled={!selected || selected.kind !== 'road' || map.roads[selected.dir].length <= 2} onClick={deleteSelectedRoadPoint}>
            Delete point (Del)
          </button>
        </div>
        <button onClick={() => navigator.clipboard.writeText(json)}>Copy JSON</button>
        <button
          onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            a.download = 'valley.json';
            a.click();
          }}
        >
          Download valley.json
        </button>
        <div>Replace client/src/content/maps/valley.json with the export. Note: changing the map changes battle results of running seasons.</div>
        <label>
          Import
          <input type="file" accept="application/json" onChange={async (e) => e.target.files?.[0] && setMap(JSON.parse(await e.target.files[0].text()))} />
        </label>
        <textarea readOnly value={json} style={{ flex: 1, fontFamily: 'monospace', fontSize: 10 }} />
      </div>
    </div>
  );
}
