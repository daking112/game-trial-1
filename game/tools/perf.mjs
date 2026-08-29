#!/usr/bin/env node
/**
 * Scene cost and frame-time report, with a hard budget guard.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE QUOTING A NUMBER FROM THIS TOOL
 * ---------------------------------------------------------------------------
 * Rendering here is SwiftShader: a CPU software rasteriser. Every millisecond
 * printed below is a software-render figure. It is NOT a GPU figure and it is
 * NOT what a phone or a desktop will do. Absolute times are meaningless as a
 * target; only the RATIO between two runs of this tool means anything.
 *
 * What software rasterisation over-weights, relative to a real GPU: fullscreen
 * fragment work (every post pass), overdraw, and high-resolution render
 * targets. What it under-weights: draw-call submission overhead and state
 * changes, which on real hardware are usually the thing that actually hurts.
 * So: read the millisecond columns for fill-rate work, and read the draw-call
 * column for CPU-side cost, and do not let either stand in for the other.
 *
 * Draw calls, triangles, geometry and texture counts, by contrast, are exact
 * and hardware-independent. They are what the budget guard enforces.
 *
 * Frame times are forced to completion with a readPixels barrier (see
 * core/Debug.ts). Without that barrier this tool used to report ~7.5ms median
 * for a frame that genuinely takes an order of magnitude longer -- it was
 * timing how fast JavaScript handed commands to the driver, not the frame.
 *
 * Usage:
 *   node tools/perf.mjs [--url http://127.0.0.1:5173] [--frames 6] [--rounds 3]
 *                       [--json] [--no-guard] [--quick]
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const has = (name) => argv.includes(`--${name}`);

// Accept a bare positional URL too, so the old invocation still works.
const positional = argv.find((a) => a.startsWith('http'));
const baseUrl = arg('url', positional || 'http://127.0.0.1:5173');
const quick = has('quick');
const FRAMES = Number(arg('frames', quick ? 3 : 6));
const ROUNDS = Number(arg('rounds', quick ? 1 : 3));
const WIDTH = Number(arg('width', 1280));
const HEIGHT = Number(arg('height', 720));
// The pass sweep needs many samples to beat the noise, and a full-resolution
// software frame costs ~2s. Halving the sweep resolution makes it 4x cheaper,
// which buys enough samples to make the attribution mean something. Fullscreen
// post passes and geometry raster both scale with pixel count, so the RATIOS
// survive the reduction; only per-vertex setup is slightly over-weighted.
const SWEEP_SCALE = Number(arg('sweep-scale', 0.5));
const asJson = has('json');
const guard = !has('no-guard');

// ---------------------------------------------------------------------------
// FRAME BUDGET
// ---------------------------------------------------------------------------
// Ceilings on the two numbers that are exact and hardware-independent. Exceed
// one and this tool exits non-zero, which is the point: content can grow, but
// it cannot grow silently.
//
// Set from the measured 2026-08-29 baseline (267 idle / 321 busy draw calls,
// 485k idle / 496k busy triangles) plus deliberate headroom for the six other
// agents adding content in parallel. Headroom is ~35% on calls and ~30% on
// triangles -- enough for a new creature, a UI layer or a VFX system, not
// enough for someone to add a per-blade-of-grass draw call and not notice.
//
// If you are here because the guard failed: do not raise the ceiling to make
// it pass. Run `node tools/perf.mjs` before and after your change, find the
// object that added the calls, and instance or merge it. Raising a ceiling is
// a decision for whoever owns the frame budget, and it needs a note here
// saying what was traded for what.
const BUDGET = {
  idleDrawCalls: 360,
  busyDrawCalls: 440,
  idleTriangles: 640_000,
  busyTriangles: 660_000,
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'demo=1',
  { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ready === true, { timeout: 60000 });
await page.evaluate(() => window.__game.engine.stop());

const out = await page.evaluate(({ frames, rounds, sweepScale }) => {
  const g = window.__game;
  // Fixed pose: the overview camera, which is what the player looks at most
  // and what every screenshot comparison uses.
  g.pose({ position: [0, 22, 52], target: [0, 2, -10], fov: 46 });
  g.advance(6);
  const idle = g.stats();
  const idleFrame = g.profile(frames * 2);

  // Push into a heavy wave so the report covers the worst case, not the calm.
  const b = window.__battle;
  b.startWave(8);
  for (let i = 0; i < 900; i++) g.engine.stepLogic(1 / 30);
  g.pose({ position: [0, 22, 52], target: [0, 2, -10], fov: 46 });
  const busy = g.stats();
  const breakdown = g.profilePasses({ frames, rounds, scale: sweepScale });

  return {
    idle, busy, idleFrame, breakdown,
    enemies: b.enemies.length, towers: b.towers.length,
  };
}, { frames: FRAMES, rounds: ROUNDS, sweepScale: SWEEP_SCALE });

await browser.close();

if (asJson) {
  console.log(JSON.stringify({ ...out, budget: BUDGET, errors }, null, 2));
} else {
  const n = (v) => Number(v).toLocaleString();
  const pad = (v, w) => String(v).padStart(w);
  const b = out.breakdown;

  console.log(`\n--- scene cost (${WIDTH}x${HEIGHT}) ---`);
  console.log(`  idle : ${pad(out.idle.drawCalls, 5)} draw calls, ${pad(n(out.idle.triangles), 9)} triangles`);
  console.log(`  busy : ${pad(out.busy.drawCalls, 5)} draw calls, ${pad(n(out.busy.triangles), 9)} triangles  (${out.enemies} enemies, ${out.towers} towers)`);
  console.log(`  geometries ${out.busy.geometries}, textures ${out.busy.textures}, programs ${out.busy.programs}`);

  console.log(`\n--- frame time, software raster, GPU-synced (busy scene) ---`);
  const row = (label, p) =>
    console.log(`  ${label.padEnd(22)} median ${pad(p.medianMs, 8)}  p95 ${pad(p.p95Ms, 8)}  worst ${pad(p.maxMs, 8)}  (n=${p.frames})`);
  row('full frame', b.frame);
  row('  draw only', b.render);
  row('  logic only', b.logic);
  row('idle scene, full frame', out.idleFrame);
  console.log(`  (all four rows at ${WIDTH}x${HEIGHT}; the sweep below is not)`);

  console.log(`\n--- where the draw time goes (${b.sweepWidth}x${b.sweepHeight} sweep, offscreen) ---`);
  console.log('  measured configurations:');
  for (const [k, v] of Object.entries(b.configMs)) {
    console.log(`    ${k.padEnd(12)} ${pad(v.toFixed(1), 9)}ms`);
  }
  const total = b.configMs.full || 1;
  console.log('  leave-one-out cost per pass:');
  const names = Object.keys(b.passMs);
  const width = Math.max(...names.map((x) => x.length), 10);
  for (const name of names) {
    const ms = b.passMs[name];
    const pct = (ms / total) * 100;
    const bar = '#'.repeat(Math.max(0, Math.round(pct / 2)));
    console.log(`    ${name.padEnd(width)} ${pad(ms.toFixed(1), 9)}ms  ${pad(pct.toFixed(1), 5)}%  ${bar}`);
  }
  console.log(`    ${'shadow map'.padEnd(width)} ${pad(b.shadowMs.toFixed(1), 9)}ms  ${pad(((b.shadowMs / total) * 100).toFixed(1), 5)}%  (depth render only)`);
  console.log(`  Disable one thing, subtract. Parts need not sum to the whole.`);
  console.log(`  'main-only' is the composer with every post pass off: raw geometry.`);
  console.log(`\n  NB: SwiftShader software raster, NOT GPU. Relative measure only.`);
}

if (errors.length) {
  console.error(`\n${errors.length} console error(s):`);
  for (const e of errors.slice(0, 10)) console.error('  ', e);
}

// --- budget guard ----------------------------------------------------------
if (guard) {
  const checks = [
    ['idle draw calls', out.idle.drawCalls, BUDGET.idleDrawCalls],
    ['busy draw calls', out.busy.drawCalls, BUDGET.busyDrawCalls],
    ['idle triangles', out.idle.triangles, BUDGET.idleTriangles],
    ['busy triangles', out.busy.triangles, BUDGET.busyTriangles],
  ];
  const failed = checks.filter(([, v, ceiling]) => v > ceiling);
  console.log('\n--- frame budget ---');
  for (const [label, v, ceiling] of checks) {
    const pct = Math.round((v / ceiling) * 100);
    console.log(`  ${v > ceiling ? 'FAIL' : 'ok  '} ${label.padEnd(16)} ${String(v).padStart(8)} / ${String(ceiling).padStart(8)}  (${pct}% of ceiling)`);
  }
  if (failed.length) {
    console.error(`\nFRAME BUDGET EXCEEDED (${failed.length} check(s)).`);
    console.error('Find what you added and instance or merge it. Read the note above');
    console.error('BUDGET in tools/perf.mjs before considering raising a ceiling.');
    process.exit(1);
  }
  console.log('  within budget.\n');
}
process.exit(0);
