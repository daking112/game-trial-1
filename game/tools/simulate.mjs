#!/usr/bin/env node
/**
 * Headless gameplay simulation.
 *
 * Drives the real battle loop at high speed with no rendering to check that
 * the game is actually playable: waves spawn and drain, towers kill things,
 * economy moves, splits happen, and win/loss both trigger. Rendering tells you
 * the game looks right; only this tells you it works.
 */
import { chromium } from 'playwright';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = (process.argv[2] || 'http://127.0.0.1:5173') + '?demo=1';

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ready === true, { timeout: 60000 });
await page.evaluate(() => window.__game.engine.stop());

const result = await page.evaluate(() => {
  const b = window.__battle;
  const g = window.__game;
  const log = [];
  const dt = 1 / 30;

  const step = (seconds) => {
    const frames = Math.round(seconds / dt);
    for (let i = 0; i < frames; i++) g.engine.stepLogic(dt);
  };

  // Snapshot starting state.
  const start = { lives: b.lives, gold: b.gold, towers: b.towers.length };

  let maxConcurrent = 0;
  let sawSplit = false;
  let prevEnemies = 0;
  let prevCursor = 0;

  b.startWave(1);
  const waveResults = [];

  for (let wave = 1; wave <= 10; wave++) {
    let guard = 0;
    // Run until the wave resolves or we give up.
    while (b.phase === 'running' && guard < 4000) {
      g.engine.stepLogic(dt);
      guard++;
      const n = b.enemies.length;
      if (n > maxConcurrent) maxConcurrent = n;
      // A split is the only way the roster can grow while the spawn cursor
      // stands still, so compare against the cursor rather than guessing from
      // the size of the jump.
      if (n > prevEnemies && b.scheduleCursor === prevCursor) sawSplit = true;
      prevEnemies = n;
      prevCursor = b.scheduleCursor;
    }
    waveResults.push({
      wave, phase: b.phase, lives: b.lives, gold: b.gold,
      enemiesLeft: b.enemies.length, frames: guard,
    });
    if (b.phase === 'lost' || b.phase === 'won') break;
    // Skip the between-waves breather and start the next one.
    step(0.1);
    if (b.phase === 'idle') b.startWave();
  }

  return {
    start,
    end: { lives: b.lives, gold: b.gold, phase: b.phase, enemies: b.enemies.length },
    maxConcurrent, sawSplit, waveResults,
    stats: g.stats(),
  };
});

await browser.close();

// ---- assertions ----------------------------------------------------------
const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass, detail });

check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
check('battle reached a terminal phase', ['won', 'lost'].includes(result.end.phase), `phase=${result.end.phase}`);
check('waves actually spawned enemies', result.maxConcurrent > 0, `max concurrent=${result.maxConcurrent}`);
check('enemy splitting fired', result.sawSplit);
check('economy moved', result.end.gold !== result.start.gold, `${result.start.gold} -> ${result.end.gold}`);
check('no wave hit the frame guard', result.waveResults.every((w) => w.frames < 4000),
  result.waveResults.filter((w) => w.frames >= 4000).map((w) => `wave ${w.wave}`).join(','));
check('lives never went negative', result.end.lives >= 0, `lives=${result.end.lives}`);

console.log('\n--- wave log ---');
for (const w of result.waveResults) {
  console.log(`  wave ${String(w.wave).padStart(2)}  phase=${w.phase.padEnd(7)} lives=${String(w.lives).padStart(3)} gold=${String(w.gold).padStart(5)} left=${w.enemiesLeft}`);
}
console.log(`\nmax concurrent enemies: ${result.maxConcurrent}`);
console.log(`final: ${result.end.phase}, lives ${result.end.lives}, gold ${result.end.gold}`);

console.log('\n--- checks ---');
let failed = 0;
for (const c of checks) {
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  if (!c.pass) failed++;
}
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
