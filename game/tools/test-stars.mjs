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

/**
 * Boot with a given star rank already saved, then place and read the stats.
 *
 * `seedId` is the species the rank is SAVED against, which is not always the
 * species placed: only stage-1 forms are summonable, so an evolved form's rank
 * lives on its lineage root.
 */
async function statsAt(speciesId, stars, seedId = speciesId) {
  await page.addInitScript(([id, s]) => {
    try {
      localStorage.clear();
      if (s > 0) localStorage.setItem('gearwood.stars.v1', JSON.stringify({ stars: { [id]: s } }));
    } catch { /* storage blocked; the test will fail loudly below */ }
  }, [seedId, stars]);
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
      effectiveStars: window.__stars.effective(id),
    };
  }, speciesId);
  return out;
}

/**
 * Boot with a rank saved against `seedId`, then read the star record straight
 * off `window.__stars`. No placement: `__place` only knows the summonable
 * roster, which is stage-1 forms, so placing an evolved form returns null.
 */
async function starsOf(speciesId, stars, seedId = speciesId) {
  await page.addInitScript(([id, s]) => {
    try {
      localStorage.clear();
      if (s > 0) localStorage.setItem('gearwood.stars.v1', JSON.stringify({ stars: { [id]: s } }));
    } catch { /* storage blocked; the test will fail loudly below */ }
  }, [seedId, stars]);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.ready === true || !!window.__place, null, { timeout: 90000 });
  return page.evaluate((id) => ({
    savedStars: window.__stars.get(id),
    effectiveStars: window.__stars.effective(id),
  }), speciesId);
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

// Stars follow the evolution LINE, not the form. Only stage-1 species are in
// the summon pool, so an evolved form can never earn a shard of its own; if
// its rank did not come from its lineage root, evolving would silently delete
// an investment worth about a dozen full runs.
const LINES = [['fernlet', 'thornwarden'], ['rillspout', 'sluicewyrm']];
const [ROOT, EVOLVED] = LINES[0];
for (const [root, evolved] of LINES) {
  const seeded = await starsOf(evolved, 5, root);
  ok(
    `${evolved} inherits ${root}'s stars`,
    seeded?.effectiveStars === 5 && seeded?.savedStars === 0,
    `effective=${seeded?.effectiveStars} own=${seeded?.savedStars} (want effective 5, own 0)`,
  );
}

// And the inherited rank must survive an actual evolution. Placing an evolved
// form directly is not the same test: `__place` only knows the placeable
// roster, and more importantly the bug lived in the evolution path itself,
// which rebuilds stats from the species base and so dropped every multiplier
// layered on top. So level the root past the evolution threshold, place it,
// and let it evolve on placement the way it does in play.
async function evolvedDamage(root, stars) {
  await page.addInitScript(([rootId, s, lvl]) => {
    try {
      localStorage.clear();
      if (s > 0) localStorage.setItem('gearwood.stars.v1', JSON.stringify({ stars: { [rootId]: s } }));
      // Collection.load() ignores the saved `level` and recomputes it from xp,
      // so the level has to be bought with xp (clamped to MAX_LEVEL) instead.
      localStorage.setItem('gearwood.collection.v1', JSON.stringify([
        { speciesId: rootId, seen: true, caught: true, level: lvl, xp: 99999, kills: 0 },
      ]));
    } catch { /* storage blocked; the test fails loudly below */ }
  }, [root, stars, EVOLUTION_LEVEL]);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.ready === true || !!window.__place, null, { timeout: 90000 });
  return page.evaluate((id) => {
    const t = window.__place(id, -20, 10);
    if (!t) return null;
    return { damage: t.stats.damage, species: t.visual.speciesId };
  }, root);
}

const EVOLUTION_LEVEL = 4;
const evoBase = await evolvedDamage(ROOT, 0);
const evoStarred = await evolvedDamage(ROOT, 5);

ok(
  `${ROOT} evolves on placement at level ${EVOLUTION_LEVEL}`,
  evoBase?.species === EVOLVED,
  `placed as ${evoBase?.species}, want ${EVOLVED}`,
);

if (evoBase && evoStarred) {
  const ratio = evoStarred.damage / evoBase.damage;
  ok(
    'evolution keeps the star bonus',
    Math.abs(ratio - EXPECT.damage) < 1e-6,
    `${evoBase.damage.toFixed(3)} -> ${evoStarred.damage.toFixed(3)} (x${ratio.toFixed(4)}, want x${EXPECT.damage})`,
  );
} else {
  ok('evolution keeps the star bonus', false, 'placement returned null');
}

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
