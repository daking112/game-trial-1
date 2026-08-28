#!/usr/bin/env node
/**
 * Shard economy balance test.
 *
 * Star ranks are the only sink for duplicate shards, so the question that
 * decides whether the sink is fair is not "how many duplicates does a star
 * cost" but "how many PULLS". Those differ by a factor of six, because a
 * rare species hands over its duplicates six times less often than a common
 * one. A flat per-rarity shard table hides that completely: the duplicate
 * counts look balanced while the real cost in play time is not.
 *
 * So this measures pulls, over a large sample, against the live Gacha rather
 * than against a model of it. A model that agreed with the code would have
 * agreed with the bug too.
 */
import { chromium } from 'playwright';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = (process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173') + '?demo=1';

const PULLS = 20000;
/** Cogs a full ten-wave clear pays out, from the wave rewards in main.ts. */
const COGS_PER_RUN = 850;
/** Cogs per pull at the ten-pull rate. */
const COGS_PER_PULL = 90;

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

const out = await page.evaluate((pulls) => {
  const gacha = window.__gacha;

  // Discover the pool by pulling with nothing owned; every result is a pool
  // member. Probing beats hardcoding a species list that a later commit moves.
  const poolIds = new Set();
  gacha.addCogs(pulls * 200);
  for (let i = 0; i < 400; i++) poolIds.add(gacha.pull(new Set()).speciesId);

  // Own everything, so every subsequent pull is a duplicate and converts to
  // shards. That is the steady state the sink is designed for.
  const owned = new Set(poolIds);
  const before = {};
  for (const id of poolIds) before[id] = gacha.shardsFor(id);

  for (let i = 0; i < pulls; i++) gacha.pull(owned);

  const rows = [...poolIds].map((id) => {
    let fiveStarCost = 0;
    for (let s = 0; s < 5; s++) fiveStarCost += window.__starCost(id, s) ?? 0;
    return {
      id,
      perPull: (gacha.shardsFor(id) - before[id]) / pulls,
      fiveStarCost,
    };
  });
  return { rows, poolSize: poolIds.size };
}, PULLS);

const rows = out.rows.map((r) => ({
  ...r,
  pulls: r.fiveStarCost / r.perPull,
})).sort((a, b) => a.pulls - b.pulls);

console.log(`\n--- shard economy over ${PULLS.toLocaleString()} pulls (${out.poolSize} species in pool) ---`);
for (const r of rows) {
  const runs = (r.pulls * COGS_PER_PULL) / COGS_PER_RUN;
  console.log(
    `  ${r.id.padEnd(13)} shards/pull=${r.perPull.toFixed(2).padStart(6)}` +
    `  5-star cost=${String(r.fiveStarCost).padStart(4)}` +
    `  pulls=${r.pulls.toFixed(0).padStart(4)}  full runs=${runs.toFixed(1).padStart(5)}`,
  );
}

let failed = 0;
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!pass) failed++;
};

console.log('\n--- checks ---');
check('no console/page errors', errors.length === 0, errors[0] ?? '');
check('pool is not empty', rows.length >= 2, `${rows.length} species`);

const min = rows[0].pulls;
const max = rows[rows.length - 1].pulls;
const spread = max / min;
check(
  'time-to-max-stars is flat across rarities',
  spread < 1.35,
  `${min.toFixed(0)}..${max.toFixed(0)} pulls, spread x${spread.toFixed(2)} (want <1.35)`,
);

const worstRuns = (max * COGS_PER_PULL) / COGS_PER_RUN;
check(
  'max stars is reachable in a sane number of runs',
  worstRuns <= 20,
  `${worstRuns.toFixed(1)} full ten-wave runs for the slowest species (want <=20)`,
);
check(
  'max stars is not trivially cheap',
  (min * COGS_PER_PULL) / COGS_PER_RUN >= 4,
  `${((min * COGS_PER_PULL) / COGS_PER_RUN).toFixed(1)} runs for the fastest species (want >=4)`,
);

await browser.close();
console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
