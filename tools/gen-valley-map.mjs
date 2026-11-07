// Generates client/src/content/maps/valley.json for art/raw/map_valley.png.
// Roads are traced from the painting (coordinates in 2048×2048 world px).
// Direction keys: N = north-west road, E = north-east, S = south-east, W = south-west.
// Pads are placed automatically alongside each road, then individually nudged via OVERRIDES.
// Fine-tune visually in /dev/map-editor and paste the exported JSON over the output.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '../client/src/content/maps/valley.json');

const KEEP = { x: 1040, y: 990 };

const ROADS = {
  N: [[0, 40], [120, 120], [260, 220], [360, 320], [480, 420], [560, 520], [560, 640], [600, 740], [700, 790], [790, 805], [900, 880]],
  E: [[2048, 50], [1880, 160], [1800, 260], [1720, 360], [1600, 400], [1500, 460], [1460, 560], [1480, 660], [1440, 740], [1360, 785], [1290, 805], [1180, 880]],
  S: [[1950, 2048], [1860, 1860], [1760, 1760], [1640, 1720], [1580, 1660], [1540, 1560], [1500, 1480], [1440, 1400], [1400, 1320], [1380, 1240], [1340, 1180], [1280, 1150], [1160, 1080]],
  W: [[80, 2048], [220, 1840], [320, 1700], [440, 1600], [580, 1520], [640, 1440], [660, 1320], [700, 1220], [760, 1160], [830, 1150], [920, 1080]],
};

// [fraction along road, side (+1 = left of travel direction, -1 = right), distance from road centre]
const LAYOUT = {
  outer: [[0.22, 1, 105], [0.3, -1, 105], [0.4, 1, 105], [0.48, -1, 105]],
  inner: [[0.6, 1, 100], [0.68, -1, 100], [0.78, 1, 100], [0.86, -1, 100]],
};
const RALLY = { outer: 0.36, inner: 0.74 };

// manual nudges: padId → {x, y}
// coordinates picked on the 1024px preview (×2 = world px)
const PICKED = {
  'N-out': [[230, 150], [115, 175], [200, 250], [330, 215]],
  'N-in': [[230, 350], [330, 285], [345, 335], [362, 447]],
  'E-out': [[840, 120], [690, 235], [780, 175], [895, 285]],
  'E-in': [[630, 300], [690, 330], [738, 417], [800, 320]],
  'S-out': [[825, 778], [875, 823], [765, 880], [865, 938]],
  'S-in': [[642, 630], [681, 540], [585, 700], [655, 705]],
  'W-out': [[196, 888], [273, 830], [340, 780], [255, 905]],
  'W-in': [[340, 560], [412, 615], [372, 692], [395, 520]],
};
const OVERRIDES = {};
for (const [sid, pts] of Object.entries(PICKED)) pts.forEach(([x, y], i) => (OVERRIDES[`${sid}-${i + 1}`] = { x: x * 2, y: y * 2 }));

function pathInfo(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}

function at(p, frac) {
  const s = frac * p.len;
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < s) i++;
  const a = p.pts[i - 1];
  const b = p.pts[i];
  const seg = p.cum[i] - p.cum[i - 1] || 1;
  const t = (s - p.cum[i - 1]) / seg;
  const dx = (b[0] - a[0]) / seg;
  const dy = (b[1] - a[1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, dx, dy };
}

const roads = {};
const sectors = [];
for (const [d, pts] of Object.entries(ROADS)) {
  roads[d] = pts.map(([x, y]) => ({ x, y }));
  const p = pathInfo(pts);
  for (const ring of ['outer', 'inner']) {
    const id = `${d}-${ring === 'outer' ? 'out' : 'in'}`;
    const pads = LAYOUT[ring].map(([f, side, dist], i) => {
      const q = at(p, f);
      // left normal of travel direction = (dy, -dx)
      const pid = `${id}-${i + 1}`;
      const pos = OVERRIDES[pid] ?? { x: Math.round(q.x + q.dy * side * dist), y: Math.round(q.y - q.dx * side * dist) };
      return { id: pid, ...pos };
    });
    const r = at(p, RALLY[ring]);
    const rally = { x: Math.round(r.x), y: Math.round(r.y) };
    sectors.push({ id, road: d, ring, pads, rally, heroSpawn: rally });
  }
}
const order = ['N-out', 'E-out', 'S-out', 'W-out', 'N-in', 'E-in', 'S-in', 'W-in'];
sectors.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
fs.writeFileSync(out, JSON.stringify({ id: 'valley', width: 2048, height: 2048, keep: KEEP, roads, sectors }, null, 2));
console.log('wrote', out);
