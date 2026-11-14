#!/usr/bin/env node
// Computes a per-pad `rangeBonus` so that an L1 archer tower (base range REF_RANGE) covers the same
// length of road from every pad, and writes it into the map JSON.
//   node tools/pad-ranges.mjs [client/src/content/maps/valley.json] [--dry]
// Coverage counts every road (sampled every STEP px). Target = 75th percentile of the coverage at REF_RANGE.
import fs from 'node:fs';

const file = process.argv.find((a) => a.endsWith('.json')) ?? 'client/src/content/maps/valley.json';
const dry = process.argv.includes('--dry');
const REF_RANGE = 140; // TOWERS.archer.range[0]
const STEP = 2;
const MIN_BONUS = -30;
const MAX_BONUS = 160;

const map = JSON.parse(fs.readFileSync(file, 'utf8'));
const samples = [];
for (const pts of Object.values(map.roads)) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    const n = Math.max(1, Math.round(len / STEP));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: len / n });
    }
  }
}
const coverage = (p, r) => samples.reduce((s, q) => s + ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= r * r ? q.w : 0), 0);

const pads = map.sectors.flatMap((s) => s.pads);
const base = pads.map((p) => coverage(p, REF_RANGE)).sort((a, b) => a - b);
const target = base[Math.floor(base.length * 0.75)];
console.log(`target coverage ${target.toFixed(0)} px of road (75th percentile at range ${REF_RANGE})`);

for (const p of pads) {
  let lo = REF_RANGE + MIN_BONUS;
  let hi = REF_RANGE + MAX_BONUS;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (coverage(p, mid) < target) lo = mid;
    else hi = mid;
  }
  const bonus = Math.round(hi - REF_RANGE);
  console.log(`${p.id.padEnd(8)} cov@${REF_RANGE}=${coverage(p, REF_RANGE).toFixed(0).padStart(4)}  bonus ${String(bonus).padStart(4)}  → cov ${coverage(p, REF_RANGE + bonus).toFixed(0)}`);
  if (bonus === 0) delete p.rangeBonus;
  else p.rangeBonus = bonus;
}
if (!dry) {
  fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
  console.log(`wrote ${file}`);
}
