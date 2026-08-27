#!/usr/bin/env node
/**
 * Screenshot harness.
 *
 * Boots the dev server build in headless Chromium, waits for the game to
 * report ready, advances the sim a fixed amount, poses the camera and writes
 * a PNG. Deterministic by construction so two runs of the same shot differ
 * only where the render actually changed.
 *
 * Usage: node tools/shoot.mjs --out shots/ --shot overview [--url http://127.0.0.1:5173]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);

/** Named camera setups. Keep these stable -- critics compare across runs. */
export const SHOTS = {
  overview:  { position: [0, 22, 52],   target: [0, 2, -10],  fov: 46, advance: 2.0 },
  hero:      { position: [10, 6, 18],   target: [2, 1.4, 2],  fov: 38, advance: 2.0 },
  low:       { position: [-14, 2.2, 8], target: [4, 1.2, -4], fov: 50, advance: 2.0 },
  topdown:   { position: [0, 62, 0.1],  target: [0, 0, 0],    fov: 40, advance: 2.0 },
  closeup:   { position: [4, 2.6, 8],   target: [2, 1.2, 2],  fov: 34, advance: 2.0 },
};

const url = args.url || 'http://127.0.0.1:5173';
const outDir = resolve(args.out || 'shots');
const width = Number(args.width || 1600);
const height = Number(args.height || 900);
const shotNames = args.shot && args.shot !== true ? String(args.shot).split(',') : Object.keys(SHOTS);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

try {
  await page.waitForFunction(() => window.__game && window.__game.ready === true, { timeout: 60000 });
} catch {
  console.error('GAME NEVER BECAME READY');
  for (const e of errors.slice(0, 20)) console.error('  console error:', e);
  await browser.close();
  process.exit(1);
}

// Stop the rAF loop so only our explicit steps advance the world.
await page.evaluate(() => window.__game.engine.stop());

mkdirSync(outDir, { recursive: true });
const results = [];

for (const name of shotNames) {
  const shot = SHOTS[name];
  if (!shot) { console.error(`unknown shot: ${name}`); continue; }
  await page.evaluate((s) => {
    window.__game.reset();
    window.__game.pose({ position: s.position, target: s.target, fov: s.fov });
    window.__game.advance(s.advance);
    // Re-pose after advancing in case gameplay code moved the camera.
    window.__game.pose({ position: s.position, target: s.target, fov: s.fov });
    window.__game.draw();
  }, shot);

  const file = resolve(outDir, `${name}.png`);
  mkdirSync(dirname(file), { recursive: true });
  // Read the WebGL backbuffer directly. page.screenshot() waits for a
  // compositor commit that never arrives while the rAF loop is stopped.
  const dataUrl = await page.evaluate(
    () => window.__game.engine.renderer.domElement.toDataURL('image/png'),
  );
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(file, buf);
  const stats = await page.evaluate(() => window.__game.stats());
  results.push({ name, file, bytes: buf.length, ...stats });
  console.log(`${name}: ${file} (${buf.length}b, ${stats.drawCalls} calls, ${stats.triangles} tris)`);
}

writeFileSync(resolve(outDir, 'stats.json'), JSON.stringify({ results, errors }, null, 2));
if (errors.length) {
  console.error(`\n${errors.length} console error(s):`);
  for (const e of errors.slice(0, 20)) console.error('  ', e);
}
await browser.close();
process.exit(0);
