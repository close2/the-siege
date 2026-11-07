// Local-mode walkthrough with screenshots: node scripts/e2e-local.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
import fs from 'fs';

const [base = 'http://localhost:5199', out = '/tmp/e2e'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
let n = 0;
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` });
  console.log('shot', name);
};

await page.goto(base + '/?backend=local');
await page.evaluate(() => localStorage.clear());
await page.goto(base + '/?backend=local');
await page.waitForSelector('input');
await shot('onboarding');
await page.fill('input', 'Anna');
await page.click('text=Begin');
await page.waitForSelector('text=New challenge');
await shot('home');
await page.click('text=New challenge');
await page.click('text=No sugar');
await shot('create-1');
await page.click('button:has-text("Next")');
await page.waitForSelector('text=When?');
await page.click('button:has-text("Next")');
await page.waitForSelector('text=Choose your hero');
await shot('create-3');
await page.click('text=Raise the banners');
await page.waitForTimeout(2500);
await shot('game-or-lobby');
if (await page.locator('text=Start now').count()) {
  await page.click('text=Start now');
  await page.waitForTimeout(2000);
}
await page.waitForTimeout(3000);
await shot('valley');
await page.click('text=Report');
await page.waitForTimeout(400);
await shot('checkin');
await page.click('.sheet .option');
await page.click('.sheet button.gold:has-text("Report")');
await page.waitForTimeout(800);
await page.click('text=Plan');
await page.waitForTimeout(400);
await shot('plan');
await page.click('.sheet .close');
await page.click('text=Scout');
await page.waitForTimeout(400);
await shot('scout');
await page.click('.sheet .close');
// tap a glowing pad: use the game's own pad list via window hook
const padPos = await page.evaluate(() => (window).__siegeDebug?.myPadScreen?.());
if (padPos) {
  await page.mouse.click(padPos.x, padPos.y);
  await page.waitForTimeout(400);
  await shot('build');
  await page.click('.sheet .option:not([disabled])');
  await page.waitForTimeout(1200);
  await shot('built');
}
await page.click('text=☰');
await page.click('text=Skip to next Dawn');
await page.waitForTimeout(2500);
await shot('dawn-ready');
await page.click('text=Watch Dawn', { force: true });
await page.waitForTimeout(6000);
await shot('battle-1');
await page.waitForTimeout(6000);
await shot('battle-2');
await page.click('text=Skip ⏭');
await page.waitForTimeout(2500);
await shot('report');
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
