// Generates a placeholder content/maps/valley.json (straight-ish roads, rotated per direction).
// Replace by exporting from /dev/map-editor once map_valley.png exists.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '../client/src/content/maps/valley.json');

const C = 1024;
const N = {
  road: [[1024, 0], [1130, 220], [930, 470], [1080, 700], [1024, 880]],
  outer: { pads: [[1260, 250], [990, 150], [1070, 430], [800, 430]], rally: [1050, 320] },
  inner: { pads: [[1200, 600], [890, 640], [1210, 800], [870, 820]], rally: [1041, 640] },
};

// rotate a point by k quarter turns clockwise around the center
function rot([x, y], k) {
  let vx = x - C, vy = y - C;
  for (let i = 0; i < k; i++) [vx, vy] = [-vy, vx];
  return { x: Math.round(C + vx), y: Math.round(C + vy) };
}

const dirs = ['N', 'E', 'S', 'W'];
const roads = {};
const sectors = [];
dirs.forEach((d, k) => {
  roads[d] = N.road.map((p) => rot(p, k));
  for (const ring of ['outer', 'inner']) {
    const def = N[ring];
    const id = `${d}-${ring === 'outer' ? 'out' : 'in'}`;
    const rally = rot(def.rally, k);
    sectors.push({
      id,
      road: d,
      ring,
      pads: def.pads.map((p, i) => ({ id: `${id}-${i + 1}`, ...rot(p, k) })),
      rally,
      heroSpawn: rally,
    });
  }
});

const order = ['N-out', 'E-out', 'S-out', 'W-out', 'N-in', 'E-in', 'S-in', 'W-in'];
sectors.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

const map = { id: 'valley', width: 2048, height: 2048, keep: { x: C, y: C }, roads, sectors };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(map, null, 2));
console.log('wrote', out);
