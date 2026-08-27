// Composes the reference PNGs into one 1400x700 line-up sheet on a matching
// mid-value backdrop, so the blind comparison is sheet-vs-sheet.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REFS = '/tmp/claude-0/-home-user-game-trial-1/6192ecc6-a18d-5224-9b2f-67e084e1b23d/scratchpad/refs';
const files = ['6.png', '249.png', '384.png', '448.png', '887.png'];
const out = process.argv[2] || '/tmp/claude-0/-home-user-game-trial-1/6192ecc6-a18d-5224-9b2f-67e084e1b23d/scratchpad/refsheet.png';

const imgs = files.map((f) => 'data:image/png;base64,' + readFileSync(resolve(REFS, f)).toString('base64'));
const html = `<!doctype html><html><body style="margin:0;width:1400px;height:700px;background:#8d9aa6;display:grid;grid-template-columns:repeat(5,1fr);align-items:center;">
${imgs.map((d) => `<img src="${d}" style="width:100%;height:640px;object-fit:contain;">`).join('')}
</body></html>`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: out });
await browser.close();
console.log(out);
