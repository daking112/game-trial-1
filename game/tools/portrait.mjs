#!/usr/bin/env node
// Portrait capture for the showcase rig: calls window.__focus(i) then reads
// the WebGL backbuffer, same determinism contract as tools/shoot.mjs.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = args.url || 'http://127.0.0.1:5211/showcase.html';
const outDir = resolve(args.out || 'shots/portraits');
const width = Number(args.width || 700);
const height = Number(args.height || 900);
const idx = String(args.i || '0,1,2,3,4,5').split(',').map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game && window.__game.ready === true, { timeout: 60000 });
await page.evaluate(() => window.__game.engine.stop());
mkdirSync(outDir, { recursive: true });

const names = await page.evaluate(() => window.__species);
for (const i of idx) {
  await page.evaluate((n) => {
    window.__game.reset();
    window.__game.advance(2.5);
    window.__focus(n);
    window.__game.draw();
  }, i);
  const dataUrl = await page.evaluate(() => window.__game.engine.renderer.domElement.toDataURL('image/png'));
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  const file = resolve(outDir, `${i}-${String(names[i]).toLowerCase()}.png`);
  writeFileSync(file, buf);
  console.log(file, buf.length);
}
if (errors.length) { console.error(`${errors.length} console error(s):`); for (const e of errors.slice(0, 10)) console.error(' ', e); }
await browser.close();
process.exit(0);
