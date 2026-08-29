import { SPECIES, type Rarity } from '../creatures/species';

/**
 * Summoning.
 *
 * This is a single-player game with no payments of any kind: cogs are earned
 * by playing and cannot be bought. The gacha is a pacing and surprise
 * mechanic, not a monetisation one. Two consequences follow, and both are
 * deliberate:
 *
 *  - the real odds are published in the UI rather than hidden, and
 *  - pity is generous, because there is no revenue reason to make it stingy.
 */

export type Currency = 'cogs' | 'shards';

const RARITY_ORDER: Rarity[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

export const SUMMON_COST = 100;
export const MULTI_COST = 900; // ten pulls for the price of nine

/** Guaranteed Rare-or-better at least this often. */
export const PITY_RARE = 10;
/** Guaranteed Epic-or-better at least this often. */
export const PITY_EPIC = 50;

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  Common: 600,
  Uncommon: 270,
  Rare: 100,
  Epic: 27,
  Legendary: 3,
};

/**
 * Shards a duplicate is worth, expressed as an average per pull.
 *
 * Duplicate value is derived from how often a species actually drops, not
 * from a flat per-rarity table. A flat table double-taxes rarity: a Rare
 * costs more shards per star AND hands them over six times less often, so
 * the same "one more star" took 51 full runs at Rare against 9 at Common.
 * Deriving it means every species in the pool earns shards at the same rate
 * per pull, and the rarity tax lands only on time-to-acquire -- which is
 * what the design says it is for.
 *
 * It also survives the pool changing: add a species and the rates re-derive
 * instead of silently skewing.
 */
export const TARGET_SHARDS_PER_PULL = 3;

let ratesCache: { key: string; rates: Record<string, number> } | null = null;
/**
 * True while the rate measurement is running.
 *
 * A ten-pull can repeat a species within its own batch, which makes the
 * second one a duplicate and asks what a duplicate is worth -- the very
 * question the measurement exists to answer. Shard value is irrelevant to
 * the tally, so during measurement the question is answered with zero
 * instead of re-entering.
 */
let measuring = false;

/**
 * Effective per-species pull rates, measured by running the real roller.
 *
 * Not derived from RARITY_WEIGHTS. The weights are the base rates; what a
 * player actually sees is bent by pity and by the ten-pull Rare guarantee,
 * and for this pool that gap is large -- a 10.3% base Rare lands at about
 * 15% observed. Sizing duplicate value off the base rate therefore overpays
 * the rarest species by half again.
 *
 * Deriving it by simulation rather than by algebra is deliberate. A formula
 * would have to restate the pity rules, and a restatement drifts from the
 * rules it copies; this cannot, because it calls them. It is seeded, so the
 * numbers are identical on every run, and cached against the pool's identity
 * so a changed pool re-measures instead of serving a stale answer.
 *
 * Nothing is owned in the simulation, so every pull is new, no duplicate
 * shard value is ever looked up, and this cannot recurse into itself.
 */
export function effectivePullRates(): Record<string, number> {
  const pool = summonPool();
  const key = pool.join(',');
  if (ratesCache && ratesCache.key === key) return ratesCache.rates;

  const BATCHES = 2000; // ten pulls each, so 20,000 samples
  measuring = true;
  const sim = new Gacha(0x9e3779b9, emptyGachaState(), true);
  sim.addCogs(BATCHES * MULTI_COST);

  const counts: Record<string, number> = {};
  for (const id of pool) counts[id] = 0;
  const nothingOwned = new Set<string>();
  let total = 0;
  for (let i = 0; i < BATCHES; i++) {
    const results = sim.summon(10, nothingOwned);
    if (!results) break;
    for (const r of results) {
      counts[r.speciesId] = (counts[r.speciesId] ?? 0) + 1;
      total++;
    }
  }

  measuring = false;

  const rates: Record<string, number> = {};
  for (const id of pool) rates[id] = total > 0 ? counts[id] / total : 0;
  ratesCache = { key, rates };
  return rates;
}

/** Probability that one pull yields exactly this species, pity included. */
export function pullRate(speciesId: string): number {
  return effectivePullRates()[speciesId] ?? 0;
}

/** Shards awarded when a summon produces a species already owned. */
export function duplicateShards(speciesId: string): number {
  if (measuring) return 0;
  const rate = pullRate(speciesId);
  // A species outside the pool can still be owned (evolutions are earned, not
  // pulled) and can never be duplicated, so its rate is zero. One shard keeps
  // the value defined rather than infinite.
  if (rate <= 0) return 1;
  return Math.max(1, Math.round(TARGET_SHARDS_PER_PULL / rate));
}

function atLeast(r: Rarity, floor: Rarity): boolean {
  return RARITY_ORDER.indexOf(r) >= RARITY_ORDER.indexOf(floor);
}

/**
 * The summon pool is stage-1 species only. Evolved forms are earned by
 * levelling a creature you already own, so pulling one directly would make the
 * evolution mechanic pointless.
 */
export function summonPool(): string[] {
  return Object.values(SPECIES).filter((s) => s.stage === 1).map((s) => s.id);
}

/**
 * Rarities that actually exist in the pool.
 *
 * Everything downstream is derived from this rather than from RARITY_WEIGHTS
 * directly. Weighting a rarity the pool cannot produce is not a harmless
 * no-op: it silently redistributes those rolls, it makes the published odds a
 * lie, and -- worst -- a pity floor for an unobtainable tier can never be
 * satisfied, so once its counter passes the threshold it pins every future
 * roll to that floor forever. That exact chain took the Rare rate to 99.8%.
 */
export function availableRarities(): Rarity[] {
  const present = new Set(summonPool().map((id) => SPECIES[id].rarity));
  return RARITY_ORDER.filter((r) => present.has(r));
}

/** Highest rarity the pool can actually produce. */
function ceilingRarity(): Rarity {
  const avail = availableRarities();
  return avail[avail.length - 1] ?? 'Common';
}

/** A pity floor is only meaningful if the pool can satisfy it. */
function attainable(floor: Rarity): boolean {
  return atLeast(ceilingRarity(), floor);
}

export interface SummonResult {
  speciesId: string;
  rarity: Rarity;
  /** True the first time this species is obtained. */
  isNew: boolean;
  /** Shards granted instead, when it was a duplicate. */
  shards: number;
  /** True if pity forced the rarity floor on this pull. */
  viaPity: boolean;
}

export interface GachaState {
  cogs: number;
  /** Per-species duplicate shards. */
  shards: Record<string, number>;
  /** Pulls since the last Rare-or-better. */
  sinceRare: number;
  /** Pulls since the last Epic-or-better. */
  sinceEpic: number;
  totalPulls: number;
}

const STORAGE_KEY = 'gearwood.gacha.v1';

export function emptyGachaState(): GachaState {
  return { cogs: 300, shards: {}, sinceRare: 0, sinceEpic: 0, totalPulls: 0 };
}

/** Deterministic RNG so tests and replays produce identical pulls. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Published pull rates, as percentages, for display in the UI.
 *
 * Computed over the rarities the pool can actually produce, so the number
 * shown to the player is a number they can actually observe. Advertising a
 * rate for a tier that cannot drop would be false regardless of intent.
 *
 * These are BASE rates, before pity. Pity only ever raises the observed rate
 * of the tier it floors -- measured over 20,000 pulls the Rare rate lands
 * around 15% against a 10.3% base. Label them as base rates in the UI.
 */
export function publishedOdds(): Array<{ rarity: Rarity; percent: number }> {
  const avail = availableRarities();
  const total = avail.reduce((sum, r) => sum + RARITY_WEIGHTS[r], 0);
  if (total <= 0) return [];

  const exact = avail.map((r) => ({ rarity: r, value: (RARITY_WEIGHTS[r] / total) * 100 }));

  // Rounded by largest remainder, so the published figures sum to exactly 100.
  // Rounding each independently put 61.86 + 27.84 + 10.31 on screen, which is
  // 100.01 -- a screen whose entire argument is that the odds are honest
  // cannot show odds that do not add up.
  const floors = exact.map((e) => ({ ...e, whole: Math.floor(e.value), rem: e.value % 1 }));
  let left = 100 - floors.reduce((sum, f) => sum + f.whole, 0);
  const order = [...floors].sort((a, b) => b.rem - a.rem);
  for (const f of order) {
    if (left <= 0) break;
    f.whole++;
    left--;
  }
  return floors.map((f) => ({ rarity: f.rarity, percent: f.whole }));
}

export class Gacha {
  state: GachaState;
  private rng: () => number;

  /**
   * `transient` drives a throwaway instance for rate measurement: it never
   * touches storage, so measuring cannot overwrite a real player's save.
   */
  constructor(seed = Date.now() >>> 0, state?: GachaState, private readonly transient = false) {
    this.rng = mulberry32(seed);
    this.state = state ?? emptyGachaState();
    if (!state) this.load();
  }

  get cogs() { return this.state.cogs; }

  shardsFor(speciesId: string): number {
    return this.state.shards[speciesId] ?? 0;
  }

  addCogs(n: number) {
    this.state.cogs = Math.max(0, this.state.cogs + n);
    this.save();
  }

  canAfford(count: 1 | 10): boolean {
    return this.state.cogs >= (count === 10 ? MULTI_COST : SUMMON_COST);
  }

  /** Pulls remaining until each pity floor triggers. */
  pityCountdown(): { rare: number | null; epic: number | null } {
    return {
      rare: attainable('Rare') ? Math.max(0, PITY_RARE - this.state.sinceRare) : null,
      epic: attainable('Epic') ? Math.max(0, PITY_EPIC - this.state.sinceEpic) : null,
    };
  }

  private rollRarity(): { rarity: Rarity; viaPity: boolean } {
    // Pity is checked first and hard-floors the roll, so a run of bad luck has
    // a guaranteed end rather than an ever-shrinking probability of relief.
    let floor: Rarity | null = null;
    if (attainable('Epic') && this.state.sinceEpic + 1 >= PITY_EPIC) floor = 'Epic';
    else if (attainable('Rare') && this.state.sinceRare + 1 >= PITY_RARE) floor = 'Rare';

    const avail = availableRarities();
    const eligible = floor ? avail.filter((r) => atLeast(r, floor!)) : avail;
    if (eligible.length === 0) return { rarity: ceilingRarity(), viaPity: floor !== null };

    const total = eligible.reduce((sum, r) => sum + RARITY_WEIGHTS[r], 0);
    let roll = this.rng() * total;
    for (const r of eligible) {
      roll -= RARITY_WEIGHTS[r];
      if (roll <= 0) return { rarity: r, viaPity: floor !== null };
    }
    return { rarity: eligible[eligible.length - 1], viaPity: floor !== null };
  }

  /**
   * Pull once. `owned` is the set of species the player already has, so
   * duplicates can be converted to shards.
   */
  pull(owned: ReadonlySet<string>): SummonResult {
    const { rarity, viaPity } = this.rollRarity();

    // Candidates at the rolled rarity; if the pool has none at that rarity,
    // fall back down the ladder rather than failing the pull.
    let candidates: string[] = [];
    for (let i = RARITY_ORDER.indexOf(rarity); i >= 0 && candidates.length === 0; i--) {
      const r = RARITY_ORDER[i];
      candidates = summonPool().filter((id) => SPECIES[id].rarity === r);
    }
    if (candidates.length === 0) candidates = summonPool();

    const speciesId = candidates[Math.floor(this.rng() * candidates.length)];
    const actualRarity = SPECIES[speciesId].rarity;

    this.state.totalPulls++;
    // Counters for tiers the pool cannot produce are held at zero rather than
    // counting up toward a threshold nothing can ever clear.
    this.state.sinceRare = !attainable('Rare') || atLeast(actualRarity, 'Rare')
      ? 0 : this.state.sinceRare + 1;
    this.state.sinceEpic = !attainable('Epic') || atLeast(actualRarity, 'Epic')
      ? 0 : this.state.sinceEpic + 1;

    const isNew = !owned.has(speciesId);
    let shards = 0;
    if (!isNew) {
      shards = duplicateShards(speciesId);
      this.state.shards[speciesId] = (this.state.shards[speciesId] ?? 0) + shards;
    }

    this.save();
    return { speciesId, rarity: actualRarity, isNew, shards, viaPity };
  }

  /**
   * Spend cogs on 1 or 10 pulls. Returns null if unaffordable.
   *
   * A ten-pull guarantees at least one Rare: without it, a player spending
   * nine summons' worth of currency can walk away with ten commons, which is
   * the single most demoralising outcome the system can produce.
   */
  summon(count: 1 | 10, owned: ReadonlySet<string>): SummonResult[] | null {
    const cost = count === 10 ? MULTI_COST : SUMMON_COST;
    if (this.state.cogs < cost) return null;
    this.state.cogs -= cost;

    const seen = new Set(owned);
    const results: SummonResult[] = [];
    for (let i = 0; i < count; i++) {
      const r = this.pull(seen);
      if (r.isNew) seen.add(r.speciesId);
      results.push(r);
    }

    if (count === 10 && attainable('Rare') && !results.some((r) => atLeast(r.rarity, 'Rare'))) {
      // Upgrade the last pull rather than adding an eleventh.
      const rareIds = summonPool().filter((id) => atLeast(SPECIES[id].rarity, 'Rare'));
      if (rareIds.length) {
        const id = rareIds[Math.floor(this.rng() * rareIds.length)];
        const isNew = !seen.has(id);
        const rarity = SPECIES[id].rarity;
        let shards = 0;
        if (!isNew) {
          shards = duplicateShards(id);
          this.state.shards[id] = (this.state.shards[id] ?? 0) + shards;
        }
        results[results.length - 1] = { speciesId: id, rarity, isNew, shards, viaPity: true };
        this.state.sinceRare = 0;
      }
    }

    this.save();
    return results;
  }

  /** Spend a species' shards. Returns false if there are not enough. */
  spendShards(speciesId: string, amount: number): boolean {
    const have = this.state.shards[speciesId] ?? 0;
    if (have < amount) return false;
    this.state.shards[speciesId] = have - amount;
    this.save();
    return true;
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<GachaState>;
      const base = emptyGachaState();
      this.state = {
        cogs: Number.isFinite(parsed.cogs) ? parsed.cogs! : base.cogs,
        shards: typeof parsed.shards === 'object' && parsed.shards ? parsed.shards : {},
        sinceRare: Number.isFinite(parsed.sinceRare) ? parsed.sinceRare! : 0,
        sinceEpic: Number.isFinite(parsed.sinceEpic) ? parsed.sinceEpic! : 0,
        totalPulls: Number.isFinite(parsed.totalPulls) ? parsed.totalPulls! : 0,
      };
    } catch {
      // Corrupt or unavailable storage: start fresh rather than fail to boot.
    }
  }

  save() {
    // A measurement instance must leave no trace in storage.
    if (this.transient) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage blocked or full; progress is lost but play continues.
    }
  }

  reset() {
    this.state = emptyGachaState();
    this.save();
  }
}
