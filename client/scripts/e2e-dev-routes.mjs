// Smoke test for the lazy-loaded dev tools: node scripts/e2e-dev-routes.mjs <baseUrl>
// Fails (exit 1) if any route throws a page error or logs a console error.
import { chromium } from 'playwright-core';

const [base = 'http://localhost:5199'] = process.argv.slice(2);
const routes = ['/dev/sandbox?p=3&day=14&days=30&diff=hard&q=0.6&ff=200', '/dev/gallery', '/dev/vfx', '/dev/map-editor'];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'] });
let failed = false;
for (const r of routes) {
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + r);
  await page.waitForTimeout(2500);
  let detail = '';
  if (r.startsWith('/dev/sandbox')) {
    const text = await page.locator('body').innerText();
    detail = text.split('\n').find((l) => l.startsWith('Day')) ?? '';
    // URL params must have been applied: 3 players, day 14 of 30
    if (!detail.startsWith('Day 14/30')) errors.push(`sandbox ignored URL params: "${detail}"`);
  }
  if (r === '/dev/vfx') {
    for (const b of await page.locator('button').all()) await b.click();
    await page.waitForTimeout(500);
  }
  console.log(r, errors.length ? `ERRORS: ${errors.join(' | ')}` : 'ok', detail);
  failed ||= errors.length > 0;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
