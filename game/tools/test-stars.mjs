/**
 * Star ranks: does buying one actually change what a placed creature does?
 *
 * StarUp.ts shipped correct and unwired once already, so this drives the real
 * placement path (`window.__place`, the same function a click calls) rather
 * than re-deriving the maths a second time and agreeing with itself.
 */
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5173/?demo=1';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

/** Boot with a given star rank already saved, then place and read the stats. */
async function statsAt(speciesId, stars) {
  await page.addInitScript(([id, s]) => {
    try {
      localStorage.clear();
      if (s > 0) localStorage.setItem('gearwood.stars.v1', JSON.stringify({ stars: { [id]: s } }));
    } catch { /* storage blocked; the test will fail loudly below */ }
  }, [speciesId, stars]);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.ready === true || !!window.__place, null, { timeout: 90000 });
  const out = await page.evaluate((id) => {
    const t = window.__place(id, -20, 10);
    if (!t) return null;
    return {
      damage: t.stats.damage,
      range: t.stats.range,
      rate: t.stats.rate,
      projectile: t.stats.projectile.damage,
      savedStars: window.__stars.get(id),
    };
  }, speciesId);
  return out;
}

const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass, detail });

// Any summonable species will do; take the first the collection knows about.
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__place, null, { timeout: 90000 });
const SPECIES_ID = await page.evaluate(() => window.__collection.all()[0].speciesId);

const base = await statsAt(SPECIES_ID, 0);
ok('placement path reachable', base !== null, JSON.stringify(base));

const starred = await statsAt(SPECIES_ID, 5);
ok('5 stars persisted and read back', starred?.savedStars === 5, `savedStars=${starred?.savedStars}`);

// starMultipliers: damage 1+0.12s, range 1+0.04s, rate 1+0.05s
const EXPECT = { damage: 1.6, range: 1.2, rate: 1.25 };
for (const key of ['damage', 'range', 'rate']) {
  const ratio = starred[key] / base[key];
  const good = Math.abs(ratio - EXPECT[key]) < 1e-6;
  ok(`${key} scales with stars`, good, `${base[key].toFixed(3)} -> ${starred[key].toFixed(3)} (x${ratio.toFixed(4)}, want x${EXPECT[key]})`);
}

// The bug this file exists to catch: the tower gets the bonus but the thing it
// actually shoots does not, so the buff is invisible in play.
ok(
  'projectile damage matches tower damage',
  Math.abs(starred.projectile - starred.damage) < 1e-9,
  `tower=${starred.damage.toFixed(3)} projectile=${starred.projectile.toFixed(3)}`,
);

ok('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

console.log('\n--- star rank checks ---');
let failed = 0;
for (const c of checks) {
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  if (!c.pass) failed++;
}
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
