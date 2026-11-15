#!/usr/bin/env node
// Validates locale catalogs (en, de, fr): key parity, placeholders, rich-text tags, and source usage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const localesDir = path.join(rootDir, 'src', 'locales');
const srcDir = path.join(rootDir, 'src');

const LOCALES = ['en', 'de', 'fr'];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, next, out);
    } else {
      out[next] = String(v);
    }
  }
  return out;
}

function placeholders(str) {
  return [...new Set([...str.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();
}

function checkBalancedTags(str) {
  const tags = [...str.matchAll(/<\/?([a-zA-Z0-9]+)>/g)];
  const stripped = str.replace(/<\/?(bold|i)>/g, '');
  if (stripped.includes('<') || stripped.includes('>')) {
    return `contains stray '<' or '>' outside <bold>/<i> tags`;
  }
  const stack = [];
  for (const m of tags) {
    const full = m[0];
    const name = m[1];
    if (full.startsWith('</')) {
      if (stack.pop() !== name) return `mismatched closing tag ${full}`;
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) return `unclosed tag <${stack[0]}>`;
  return null;
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'locales' || entry.name === '__tests__') continue;
      walkFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const catalogs = {};
for (const loc of LOCALES) {
  const raw = fs.readFileSync(path.join(localesDir, `${loc}.json`), 'utf8');
  catalogs[loc] = flatten(JSON.parse(raw));
}

const enMap = catalogs.en;
const enKeys = Object.keys(enMap).sort();
const errors = [];

for (const [key, val] of Object.entries(enMap)) {
  if (!val.trim()) errors.push(`[en] empty value for "${key}"`);
  const tagErr = checkBalancedTags(val);
  if (tagErr) errors.push(`[en] "${key}": ${tagErr}`);
}

for (const loc of LOCALES.filter((l) => l !== 'en')) {
  const map = catalogs[loc];
  const keys = Object.keys(map).sort();
  for (const k of enKeys) {
    if (!(k in map)) {
      errors.push(`[${loc}] missing key "${k}"`);
      continue;
    }
    if (!map[k].trim()) errors.push(`[${loc}] empty value for "${k}"`);
    const enPh = placeholders(enMap[k]);
    const locPh = placeholders(map[k]);
    if (enPh.join(',') !== locPh.join(',')) {
      errors.push(`[${loc}] placeholder mismatch in "${k}": expected {${enPh.join(', ')}}, got {${locPh.join(', ')}}`);
    }
    const tagErr = checkBalancedTags(map[k]);
    if (tagErr) errors.push(`[${loc}] "${k}": ${tagErr}`);
  }
  for (const k of keys) {
    if (!(k in enMap)) errors.push(`[${loc}] extra unknown key "${k}"`);
  }
}

// Check static key usage in client/src
const DYNAMIC_PREFIXES = [
  'themes.',
  'heroes.',
  'buildings.',
  'roads.',
  'errors.',
  'skipReasons.',
  'plan.heroStatus.',
  'plan.stanceHelp.',
  'report.ranks.',
];

const sourceText = walkFiles(srcDir)
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

const usedStatic = new Set();
for (const m of sourceText.matchAll(/\b(?:i18n\.)?t\(\s*['"]([^'"`$]+)['"]/g)) {
  usedStatic.add(m[1]);
}
for (const m of sourceText.matchAll(/\bi18nKey=["']([^"']+)["']/g)) {
  usedStatic.add(m[1]);
}

for (const used of usedStatic) {
  if (!(used in enMap) && !(`${used}_one` in enMap)) {
    errors.push(`[src] references missing translation key "${used}"`);
  }
}

for (const k of enKeys) {
  if (DYNAMIC_PREFIXES.some((p) => k.startsWith(p))) continue;
  const baseKey = k.replace(/_(one|other)$/, '');
  if (!usedStatic.has(k) && !usedStatic.has(baseKey)) {
    errors.push(`[en] unused key "${k}"`);
  }
}

if (errors.length > 0) {
  console.error(`i18n check failed with ${errors.length} issue(s):\n` + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log(`i18n check passed: ${enKeys.length} keys verified across ${LOCALES.join(', ')}.`);
