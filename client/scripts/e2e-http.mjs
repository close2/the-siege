// Full-stack E2E test against the Rust server: multi-user join flow + device transfer code.
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:8099';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});

const errors = [];
function track(page, label) {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(`${label}: ${m.text()}`));
}

// 1. User 1 (Anna) creates a challenge starting tomorrow
const ctx1 = await browser.newContext({ viewport: { width: 400, height: 820 } });
const p1 = await ctx1.newPage();
track(p1, 'p1');
await p1.goto(base);
await p1.waitForSelector('input');
await p1.fill('input', 'Anna');
await p1.click('text=Begin');
await p1.waitForSelector('text=New challenge');
await p1.click('text=New challenge');
await p1.click('text=No sugar');
await p1.click('button:has-text("Next")');
await p1.waitForSelector('text=When?');
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
await p1.locator('input[type="date"]').first().fill(tomorrow);
await p1.click('button:has-text("Next")');
await p1.waitForSelector('text=Choose your hero');
await p1.click('text=Raise the banners');
await p1.waitForSelector('text=Gathering the defenders');

const codeEl = p1.locator('.panel .title.center');
const inviteCode = (await codeEl.textContent()).trim();
console.log('Created challenge with inviteCode:', inviteCode);
if (inviteCode.length !== 6) throw new Error(`Bad invite code: ${inviteCode}`);

// 2. User 2 (Brin) joins via /join/:code
const ctx2 = await browser.newContext({ viewport: { width: 400, height: 820 } });
const p2 = await ctx2.newPage();
track(p2, 'p2');
await p2.goto(`${base}/join/${inviteCode}`);
await p2.waitForSelector('input');
await p2.fill('input', 'Brin');
await p2.click('text=Begin');
await p2.waitForSelector('text=Choose your hero');
await p2.click('text=Ranger');
await p2.click('text=Join the siege');
await p2.waitForSelector('text=Gathering the defenders');
const membersText = await p2.locator('.panel').textContent();
if (!membersText.includes('Anna') || !membersText.includes('Brin')) {
  throw new Error(`Expected both Anna and Brin in lobby, got: ${membersText}`);
}
console.log('User 2 joined successfully; lobby has Anna & Brin');

// 3. User 1 generates a transfer code in Settings, and Device 3 claims it
await p1.goto(`${base}/settings`);
await p1.waitForSelector('text=Show transfer code');
await p1.click('text=Show transfer code');
const transferCode = (await p1.locator('.panel .center .title').textContent()).trim();
console.log('Generated transferCode:', transferCode);

const ctx3 = await browser.newContext({ viewport: { width: 400, height: 820 } });
const p3 = await ctx3.newPage();
track(p3, 'p3');
await p3.goto(base);
await p3.click('text=I already play on another device');
await p3.fill('input[placeholder="ABC123"]', transferCode);
await p3.click('text=Continue');
await p3.waitForSelector('text=No sugar');
console.log('Device 3 claimed Anna account and sees challenge on Home screen');

if (errors.length) {
  console.error('Errors:', errors);
  process.exit(1);
}
console.log('Full-stack HTTP E2E passed with 0 errors!');
await browser.close();
