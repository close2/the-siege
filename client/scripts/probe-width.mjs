// Opens every sheet at 360px width and reports elements wider than their sheet.
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5199';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: Number(process.argv[3] ?? 360), height: 760 } });
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

const probe = async (name) => {
  await sleep(400);
  const r = await page.evaluate(() => {
    const out = [];
    const docW = document.documentElement.clientWidth;
    const pageOverflow = document.documentElement.scrollWidth - docW;
    for (const sh of document.querySelectorAll('.sheet')) {
      const over = sh.scrollWidth - sh.clientWidth;
      const box = sh.getBoundingClientRect();
      const wide = [];
      for (const el of sh.querySelectorAll('*')) {
        const b = el.getBoundingClientRect();
        if (b.right > box.right - 29) wide.push(`${el.tagName}.${el.className} w=${Math.round(b.width)} r=${Math.round(b.right)} "${(el.textContent || '').slice(0, 30)}"`);
      }
      out.push({ over, sheetW: Math.round(box.width), wide: wide.slice(0, 8) });
    }
    return { pageOverflow, out };
  });
  console.log(name, JSON.stringify(r, null, 1));
};
const close = async () => {
  await page.keyboard.press('Escape');
  await page.mouse.click(180, 20);
  await sleep(300);
};

await page.click('.hud-bottom button:has-text("Report")');
await probe('checkin');
await page.click('text=All kept');
await page.click('.sheet button.gold:has-text("Report")');
await sleep(500);
await page.click('.hud-bottom button:has-text("Plan")');
await probe('plan');
await close();
await page.click('.hud-bottom button:has-text("Scout")');
await probe('scout');
await close();
await page.click('.hud-bottom button:has-text("☰")');
await probe('menu');
await page.click('text=How to play');
await probe('tutorial');
await close();
const pt = await page.evaluate(() => window.__siegeDebug.myPadScreen());
await page.mouse.click(pt.x, pt.y);
await probe('build');
await close();
await page.click('button:has-text("Skip to Dawn")');
await sleep(800);
await page.click('button:has-text("Watch Dawn")', { force: true });
await sleep(500);
await page.click('.replay-bar button:has-text("Skip")');
await page.waitForSelector('text=Onward', { timeout: 60000 });
await probe('dawn-report');
if (process.argv[4]) await page.screenshot({ path: process.argv[4] });
await browser.close();
