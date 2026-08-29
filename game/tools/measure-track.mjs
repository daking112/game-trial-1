#!/usr/bin/env node
/**
 * How much of the track can the player actually see?
 *
 * The readability bar is Bloons TD 6: the path reads at a glance. Whether the
 * forest has closed over it is measurable, so measure it rather than arguing
 * about screenshots. Raycasts from the shot's camera to points along the
 * track and reports the fraction that arrive unobstructed.
 */
import { chromium } from 'playwright';

/**
 * Poses copied rather than imported: tools/shoot.mjs runs its capture on
 * import, so importing SHOTS from it would take a full set of screenshots as
 * a side effect. Keep these in step with the matching entries there.
 */
const SHOTS = {
  overview: { position: [0, 22, 52], target: [0, 2, -10], fov: 46, advance: 2.0 },
  fight:    { position: [2, 7.5, 20], target: [1, 1.2, -2], fov: 40, advance: 14.0 },
  low:      { position: [-14, 2.2, 8], target: [4, 1.2, -4], fov: 50, advance: 2.0 },
  topdown:  { position: [0, 62, 0.1], target: [0, 0, 0], fov: 40, advance: 2.0 },
};

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = (process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173') + '?demo=1';
const shotNames = (process.argv[2] && !process.argv[2].startsWith('http')
  ? process.argv[2]
  : 'overview,fight,low').split(',');

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ready === true, { timeout: 60000 });
await page.evaluate(() => window.__game.engine.stop());

console.log('\n--- track visibility ---');
for (const name of shotNames) {
  const shot = SHOTS[name];
  if (!shot) { console.log(`  ${name}: no such shot`); continue; }
  const out = await page.evaluate(async (s) => {
    window.__game.advance(s.advance ?? 2);
    window.__game.pose({ position: s.position, target: s.target, fov: s.fov });
    window.__game.draw();
    return window.__trackVisibility(300);
  }, shot);
  const pct = (out.fraction * 100).toFixed(1);
  console.log(`  ${name.padEnd(9)} ${String(out.visible).padStart(3)} / ${String(out.onScreen).padStart(3)} on-screen samples unobstructed  = ${pct}%`);
  for (const [label, n] of out.occluders ?? []) console.log(`      blocked by ${label}: ${n}`);
}

await browser.close();
console.log('');
