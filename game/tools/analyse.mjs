#!/usr/bin/env node
/**
 * Measures mean luma of horizontal bands in a screenshot.
 *
 * Art critiques make claims about value structure ("the ground is the dullest
 * plane in the frame"); this checks them against pixels instead of impressions.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.argv[2]);
const b64 = readFileSync(file).toString('base64');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
const out = await page.evaluate(async (data) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + data;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;

  const bands = [
    ['sky        (top 18%)', 0.00, 0.18],
    ['far range  (18-32%)',  0.18, 0.32],
    ['mid ground (32-52%)',  0.32, 0.52],
    ['playfield  (52-84%)',  0.52, 0.84],
  ];

  return bands.map(([name, a, bEnd]) => {
    const y0 = Math.floor(a * c.height), y1 = Math.floor(bEnd * c.height);
    let L = 0, S = 0, n = 0, hueSum = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        const r = px[i] / 255, g = px[i + 1] / 255, bl = px[i + 2] / 255;
        L += 0.2126 * r + 0.7152 * g + 0.0722 * bl;
        const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
        S += mx === 0 ? 0 : (mx - mn) / mx;
        // crude hue angle for monochrome detection
        hueSum += Math.atan2(Math.sqrt(3) * (g - bl), 2 * r - g - bl);
        n++;
      }
    }
    return { band: name, luma: +(L / n).toFixed(3), sat: +(S / n).toFixed(3), hue: +(hueSum / n).toFixed(2) };
  });
}, b64);

console.log(`\n${file.split('/').pop()}`);
for (const r of out) {
  const bar = '#'.repeat(Math.round(r.luma * 40));
  console.log(`  ${r.band}  luma ${String(r.luma).padEnd(6)} sat ${String(r.sat).padEnd(6)} ${bar}`);
}
await browser.close();
