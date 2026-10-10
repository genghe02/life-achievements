// Usage: node tools/shot.mjs <url> <outPrefix> [actions.json | inline JSON]
// Takes desktop (1366x768) and phone (390x844 @3x, touch) screenshots, runs optional actions,
// and prints console errors and horizontal overflow.
// Action: { "click": css, "tap": css, "fill": [css, text], "press": key, "eval": js, "wait": ms,
//           "shot": name, "only": "desk" | "phone" }
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [url, prefix, actArg] = process.argv.slice(2);
if (!url || !prefix) { console.error('usage: node tools/shot.mjs <url> <outPrefix> [actions]'); process.exit(2); }
const actions = actArg ? JSON.parse(fs.existsSync(actArg) ? fs.readFileSync(actArg, 'utf8') : actArg) : [];
const exe = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
for (const [name, vp, dpr, touch] of [['desk', { width: 1366, height: 768 }, 1, false], ['phone', { width: 390, height: 844 }, 3, true]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => errs.push(`pageerror: ${e.message}`));
  await page.goto(url);
  await page.waitForTimeout(700);
  for (const a of actions) {
    if (a.only && a.only !== name) continue;
    try {
      if (a.click) await page.click(a.click, { timeout: 3000 });
      if (a.tap) await (touch ? page.tap(a.tap, { timeout: 3000 }) : page.click(a.tap, { timeout: 3000 }));
      if (a.fill) await page.fill(a.fill[0], a.fill[1], { timeout: 3000 });
      if (a.press) await page.keyboard.press(a.press);
      if (a.eval) { const r = await page.evaluate(a.eval); if (r !== undefined) console.log(name, 'eval:', JSON.stringify(r)); }
    } catch (e) { errs.push(`action failed ${JSON.stringify(a)}: ${String(e.message).split('\n')[0]}`); }
    if (a.wait) await page.waitForTimeout(a.wait);
    if (a.shot) await page.screenshot({ path: `${prefix}-${name}-${a.shot}.png` });
  }
  await page.screenshot({ path: `${prefix}-${name}.png` });
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(name, 'overflowX', o, 'errors:', errs.length ? '\n  ' + errs.join('\n  ') : 'none');
  await ctx.close();
}
await browser.close();
