// Dry-run regression: restart keeps no stale state; no "pad occupied"; screenshots of new UI.
import { chromium } from 'playwright-core';
import fs from 'fs';

const [base = 'http://localhost:5199', out = '/tmp/e2e-dry'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 400, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
let n = 0;
const shot = async (name) => page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` });
const gold = async () => Number((await page.locator('.hud-top .chip').first().innerText()).replace(/\D/g, ''));
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(base + '/?backend=local');
await page.evaluate(() => localStorage.clear());
await page.goto(base + '/?backend=local');
await page.waitForSelector('input');
await page.fill('input', 'Anna');
await page.click('text=Begin');
await page.click('text=Try a dry run');
await page.waitForSelector('.hud-bottom');
await sleep(1500);

async function report() {
  await page.click('.hud-bottom button:has-text("Report")');
  await page.click('text=All kept');
  await page.click('.sheet button.gold:has-text("Report")');
  await sleep(500);
}
async function buildFree() {
  await page.click('button.recenter');
  await sleep(900);
  const pt = await page.evaluate(() => window.__siegeDebug.myPadScreen());
  if (!pt) throw new Error('no free pad');
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('text=Archer Tower', { timeout: 5000 }).catch(async (e) => {
    await shot('FAIL-build');
    console.log('pad at', pt);
    throw e;
  });
  await sleep(300);
  await shot('build-sheet-range');
  await page.click('.sheet .option:has-text("Archer Tower")');
  await sleep(500);
}
async function skipDawn() {
  await page.click('button:has-text("Skip to Dawn")');
  await sleep(800);
}

// run 1: day 1 + day 2
await report();
const g1 = await gold();
await buildFree();
await shot('day1-built');
await skipDawn();
await page.click('button:has-text("Watch Dawn")', { force: true });
await sleep(3000);
await shot('replay-clock');
await page.click('.replay-bar button:has-text("Skip")');
await page.waitForSelector('text=Onward', { timeout: 60000 });
await page.click('text=Onward');
await report();
await buildFree();
await page.click('.hud-bottom button:has-text("Plan")');
await sleep(300);
await shot('plan-sheet');
await page.click('.sheet-backdrop', { position: { x: 5, y: 5 } }).catch(() => {});
await sleep(300);

// restart from the menu
await page.click('.hud-bottom button:has-text("☰")');
await page.click('text=Restart dry run');
await sleep(1500);
await shot('after-restart');
const coach = await page.locator('.hud-top').innerText();
const g0 = await gold();
console.log('gold after restart', g0, 'gold after first report in run 1', g1);
if (/✓ Report/.test(coach)) throw new Error('stale check-in after restart');
await report();
const g2 = await gold();
if (g2 <= g0) throw new Error(`report paid nothing after restart (${g0} -> ${g2})`);
await buildFree();
await skipDawn();
await page.click('button:has-text("Watch Dawn")', { force: true });
await sleep(500);
await page.click('.replay-bar button:has-text("Skip")');
await page.waitForSelector('text=Onward', { timeout: 60000 });
await shot('report-day1-run2');
const rep = await page.locator('.sheet').innerText();
if (rep.includes('Not carried out')) throw new Error('skipped orders: ' + rep);
await page.click('text=Onward');
// day 2 of run 2: build again -> dawn report must be clean
await report();
await buildFree();
await skipDawn();
await page.click('button:has-text("Watch Dawn")', { force: true });
await sleep(500);
await page.click('.replay-bar button:has-text("Skip")');
await page.waitForSelector('text=Onward', { timeout: 60000 });
await shot('report-day2-run2');
const rep2 = await page.locator('.sheet').innerText();
if (rep2.includes('Not carried out')) throw new Error('skipped orders day 2: ' + rep2);
await page.click('text=Onward');
await page.click('.hud-bottom button:has-text("Plan")');
await sleep(300);
await page.locator('.sheet select').first().selectOption({ index: 2 }).catch(() => {});
await sleep(300);
await shot('plan-stance');
console.log('errors', errors);
console.log('OK');
await browser.close();
