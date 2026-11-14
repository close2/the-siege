#!/usr/bin/env node
// Fair tower ranges: for every pad and every base tower range, computes the effective range at which the
// tower covers the same length of its OWN sector's road as a "typical" pad (75th percentile) does at the
// base range. Written into the map JSON as `pad.ranges = { "<base>": <effective>, ... }`.
//   node tools/pad-ranges.mjs [client/src/content/maps/valley.json] [--dry]
// BASE_RANGES must contain every value of TOWERS[*].range in client/src/content/stats.ts
// (a unit test fails otherwise). Re-run after moving pads or changing tower ranges.
import fs from 'node:fs';

const file = process.argv.find((a) => a.endsWith('.json')) ?? 'client/src/content/maps/valley.json';
const dry = process.argv.includes('--dry');
const BASE_RANGES = [120, 130, 140, 155, 170, 180];
const STEP = 2;
const MAX_EXTRA = 220;

const map = JSON.parse(fs.readFileSync(file, 'utf8'));
const samples = {};
for (const [road, pts] of Object.entries(map.roads)) {
  const list = (samples[road] = []);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    const n = Math.max(1, Math.round(len / STEP));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      list.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: len / n });
    }
  }
}
const coverage = (p, road, r) => samples[road].reduce((s, q) => s + ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= r * r ? q.w : 0), 0);

const pads = map.sectors.flatMap((s) => s.pads.map((p) => ({ p, road: s.road })));
for (const { p } of pads) {
  delete p.rangeBonus;
  p.ranges = {};
}
for (const base of BASE_RANGES) {
  const covs = pads.map(({ p, road }) => coverage(p, road, base)).sort((a, b) => a - b);
  const target = covs[Math.floor(covs.length * 0.75)];
  console.log(`base ${base}: target ${target.toFixed(0)} px of own road`);
  for (const { p, road } of pads) {
    let lo = 1;
    let hi = base + MAX_EXTRA;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (coverage(p, road, mid) < target) lo = mid;
      else hi = mid;
    }
    p.ranges[String(base)] = Math.round(hi);
  }
}
for (const { p, road } of pads) {
  const line = BASE_RANGES.map((b) => `${b}→${p.ranges[b]} (${coverage(p, road, p.ranges[b]).toFixed(0)})`).join('  ');
  console.log(`${p.id.padEnd(8)} ${line}`);
}
if (!dry) {
  fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
  console.log(`wrote ${file}`);
}
