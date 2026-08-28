import { SPECIES, type Rarity } from '../creatures/species';
import type { Gacha } from './Gacha';

/**
 * Star ranks.
 *
 * The sink for duplicate shards. Without one, pulling a creature you already
 * own is pure disappointment -- the shards pile up and buy nothing, which
 * makes most of the gacha's output feel like a loss.
 *
 * Stars are per-species and permanent, so a long-owned starter stays
 * competitive with a freshly-pulled rare. That is deliberate: the alternative
 * is that every new pull obsoletes what you were already invested in.
 */

export const MAX_STARS = 5;

/**
 * Shard cost of the next star, per rarity.
 *
 * Rarer species cost more per star but also earn more shards per duplicate,
 * so the number of duplicates needed stays roughly flat across rarities. The
 * rarity tax is on time-to-acquire, not on time-to-upgrade.
 */
const STAR_COST_BASE: Record<Rarity, number> = {
  Common: 20,
  Uncommon: 45,
  Rare: 110,
  Epic: 260,
  Legendary: 600,
};

export function starCost(speciesId: string, currentStars: number): number | null {
  if (currentStars >= MAX_STARS) return null;
  const sp = SPECIES[speciesId];
  if (!sp) return null;
  // Escalates so the last star is a real commitment rather than a formality.
  return Math.round(STAR_COST_BASE[sp.rarity] * (1 + currentStars * 0.85));
}

/**
 * Stat multiplier from stars.
 *
 * Deliberately gentler than the level curve. Stars come from luck; levels come
 * from play. Luck should widen your options, not decide the run.
 */
export function starMultipliers(stars: number) {
  const s = Math.min(stars, MAX_STARS);
  return {
    damage: 1 + s * 0.12,
    range: 1 + s * 0.04,
    rate: 1 + s * 0.05,
  };
}

export interface StarState {
  /** speciesId -> star rank, 0..MAX_STARS. */
  stars: Record<string, number>;
}

const STORAGE_KEY = 'gearwood.stars.v1';

export class Stars {
  private state: StarState = { stars: {} };

  constructor() {
    this.load();
  }

  get(speciesId: string): number {
    return this.state.stars[speciesId] ?? 0;
  }

  /** Cost of the next star, or null if maxed. */
  nextCost(speciesId: string): number | null {
    return starCost(speciesId, this.get(speciesId));
  }

  canAfford(speciesId: string, gacha: Gacha): boolean {
    const cost = this.nextCost(speciesId);
    return cost !== null && gacha.shardsFor(speciesId) >= cost;
  }

  /**
   * Spend shards to add a star. Returns the new rank, or null if it was
   * unaffordable or already maxed.
   */
  upgrade(speciesId: string, gacha: Gacha): number | null {
    const cost = this.nextCost(speciesId);
    if (cost === null) return null;
    if (!gacha.spendShards(speciesId, cost)) return null;
    const next = this.get(speciesId) + 1;
    this.state.stars[speciesId] = next;
    this.save();
    return next;
  }

  all(): Array<{ speciesId: string; stars: number }> {
    return Object.keys(SPECIES).map((id) => ({ speciesId: id, stars: this.get(id) }));
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<StarState>;
      if (parsed && typeof parsed.stars === 'object' && parsed.stars) {
        const clean: Record<string, number> = {};
        for (const [id, v] of Object.entries(parsed.stars)) {
          // Drop unknown species and clamp, so an edited or stale save cannot
          // grant ranks the game does not support.
          if (!SPECIES[id]) continue;
          const n = Number(v);
          if (Number.isFinite(n)) clean[id] = Math.max(0, Math.min(MAX_STARS, Math.floor(n)));
        }
        this.state.stars = clean;
      }
    } catch {
      // Corrupt or unavailable storage: start fresh rather than fail to boot.
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage blocked or full; progress is lost but play continues.
    }
  }

  reset() {
    this.state = { stars: {} };
    this.save();
  }
}
