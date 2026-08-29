#!/usr/bin/env node
/**
 * Statistical check on the summon system.
 *
 * Gacha bugs are invisible by inspection -- a wrong weight or an off-by-one in
 * the pity counter still "works", it just quietly makes the game worse. This
 * runs a large sample and asserts the observed behaviour matches the published
 * contract.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ready === true, { timeout: 60000 });

const out = await page.evaluate(async () => {
  const m = await import('/src/meta/Gacha.ts');
  const N = 20000;
  const g = new m.Gacha(12345, m.emptyGachaState());
  g.state.cogs = Number.MAX_SAFE_INTEGER;

  const counts = {};
  let maxGapRare = 0, gapRare = 0;
  let maxGapEpic = 0, gapEpic = 0;
  const owned = new Set();

  for (let i = 0; i < N; i++) {
    const r = g.pull(owned);
    if (r.isNew) owned.add(r.speciesId);
    counts[r.rarity] = (counts[r.rarity] ?? 0) + 1;

    const order = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    const idx = order.indexOf(r.rarity);
    gapRare = idx >= 2 ? 0 : gapRare + 1;
    gapEpic = idx >= 3 ? 0 : gapEpic + 1;
    maxGapRare = Math.max(maxGapRare, gapRare);
    maxGapEpic = Math.max(maxGapEpic, gapEpic);
  }

  // Ten-pull guarantee, across many independent multis.
  let multiWithoutRare = 0;
  for (let t = 0; t < 400; t++) {
    const g2 = new m.Gacha(9000 + t, m.emptyGachaState());
    g2.state.cogs = Number.MAX_SAFE_INTEGER;
    const res = g2.summon(10, new Set());
    if (!res.some((r) => ['Rare', 'Epic', 'Legendary'].includes(r.rarity))) multiWithoutRare++;
  }

  // Affordability must be enforced.
  const poor = new m.Gacha(7, m.emptyGachaState());
  poor.state.cogs = 10;
  const refused = poor.summon(1, new Set()) === null;

  // Duplicates must yield shards.
  const dup = new m.Gacha(8, m.emptyGachaState());
  dup.state.cogs = 1e9;
  const first = dup.pull(new Set());
  const second = dup.pull(new Set([first.speciesId]));
  const dupGivesShards = second.speciesId !== first.speciesId || second.shards > 0;

  return { N, counts, maxGapRare, maxGapEpic, multiWithoutRare, refused,
           dupGivesShards, odds: m.publishedOdds(), available: m.availableRarities(),
           // The gacha's own counters, not the test's -- an unattainable tier
           // must hold its counter at zero rather than climb forever.
           stateSinceEpic: g.state.sinceEpic, stateSinceRare: g.state.sinceRare,
           countdown: g.pityCountdown(),
           PITY_RARE: m.PITY_RARE, PITY_EPIC: m.PITY_EPIC };
});

const pct = (k) => ((out.counts[k] ?? 0) / out.N * 100);
console.log('\n--- observed vs published (20,000 pulls) ---');
for (const o of out.odds) {
  console.log(`  ${o.rarity.padEnd(10)} published ${String(o.percent).padStart(6)}%   observed ${pct(o.rarity).toFixed(2).padStart(6)}%`);
}
console.log(`\n  longest run without Rare+: ${out.maxGapRare} (pity guarantees <= ${out.PITY_RARE})`);
console.log(`  longest run without Epic+: ${out.maxGapEpic} ${out.available.includes('Epic') ? `(pity guarantees <= ${out.PITY_EPIC})` : '(no Epic in pool -- pity inactive)'}`);
console.log(`  rarities in pool: ${out.available.join(', ')}`);
console.log(`  ten-pulls with no Rare+  : ${out.multiWithoutRare} / 400`);

const checks = [];
const add = (n, p, d = '') => checks.push({ n, p, d });
add('pity floors the Rare drought', out.maxGapRare <= out.PITY_RARE, `observed ${out.maxGapRare}`);
// Only assert the Epic guarantee if the pool can actually produce an Epic.
if (out.available.includes('Epic')) {
  add('pity floors the Epic drought', out.maxGapEpic <= out.PITY_EPIC, `observed ${out.maxGapEpic}`);
} else {
  add('Epic pity counter held at zero (none in pool)', out.stateSinceEpic === 0,
      `gacha sinceEpic = ${out.stateSinceEpic}`);
  add('Epic pity reported as unavailable', out.countdown.epic === null,
      `countdown.epic = ${out.countdown.epic}`);
}
add('ten-pull always yields Rare+', !out.available.includes('Rare') || out.multiWithoutRare === 0,
    `${out.multiWithoutRare} failures`);
add('unaffordable summon refused', out.refused);
add('duplicates convert to shards', out.dupGivesShards);
// Pity lifts the real rate above the published floor, so observed >= published.
for (const o of out.odds) {

  // Published figures are BASE rates. Pity can only ever raise the observed
  // rate of the tier it floors, so the top tier is asserted as a lower bound
  // and the rest as a close match.
  const isTop = o.rarity === out.available[out.available.length - 1];
  if (isTop) {
    add(`${o.rarity} at or above published base rate`, pct(o.rarity) >= o.percent * 0.95,
        `${pct(o.rarity).toFixed(2)}% observed vs ${o.percent}% base (pity lifts this)`);
  } else {
    add(`${o.rarity} within 20% of published`,
        Math.abs(pct(o.rarity) - o.percent) <= Math.max(0.5, o.percent * 0.20),
        `${pct(o.rarity).toFixed(2)}% vs ${o.percent}%`);
  }
}
add('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log('\n--- checks ---');
let failed = 0;
for (const c of checks) {
  console.log(`  ${c.p ? 'PASS' : 'FAIL'}  ${c.n}${c.d ? `  (${c.d})` : ''}`);
  if (!c.p) failed++;
}
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
