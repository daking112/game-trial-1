#!/usr/bin/env node
/**
 * Scene cost report.
 *
 * Frame times here are software-rasterised (SwiftShader) and are NOT
 * representative of real GPU performance -- they are useful only as a relative
 * measure between changes. Draw calls and triangle counts, by contrast, are
 * exact and are what actually predict how this runs on real hardware.
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ready === true, { timeout: 60000 });
await page.evaluate(() => window.__game.engine.stop());

const out = await page.evaluate(() => {
  const g = window.__game;
  g.pose({ position: [0, 22, 52], target: [0, 2, -10], fov: 46 });
  g.advance(6);
  const idle = g.stats();
  // Push into a heavy wave so the report covers the worst case, not the calm.
  const b = window.__battle;
  b.startWave(8);
  for (let i = 0; i < 900; i++) g.engine.stepLogic(1 / 30);
  const busy = g.stats();
  return { idle, busy, enemies: b.enemies.length, towers: b.towers.length, perf: g.profile(12) };
});

console.log('\n--- scene cost (1280x720) ---');
console.log(`  idle : ${String(out.idle.drawCalls).padStart(5)} draw calls, ${out.idle.triangles.toLocaleString()} triangles`);
console.log(`  busy : ${String(out.busy.drawCalls).padStart(5)} draw calls, ${out.busy.triangles.toLocaleString()} triangles  (${out.enemies} enemies, ${out.towers} towers)`);
console.log(`  geometries ${out.busy.geometries}, textures ${out.busy.textures}, programs ${out.busy.programs}`);
console.log(`\n  software-raster frame time: median ${out.perf.medianMs}ms (min ${out.perf.minMs} / max ${out.perf.maxMs})`);
console.log('  NB: SwiftShader, not GPU -- use as a relative measure only.\n');
await browser.close();
