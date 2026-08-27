export interface LevelState {
  level: number;
  xp: number;
  /** XP needed to reach the next level; 0 once max level. */
  toNext: number;
}

export interface CollectionEntry {
  speciesId: string;
  /** Seen in a battle. */
  seen: boolean;
  /** Placed at least once — counts as caught. */
  caught: boolean;
  level: number;
  xp: number;
  /** Total enemies this species has destroyed, across all runs. */
  kills: number;
}

export const MAX_LEVEL = 20;

/**
 * XP curve.
 *
 * Quadratic rather than exponential: exponential curves make the last few
 * levels unreachable in a session-length game, and this one is meant to be
 * completed. Level 20 lands at ~14k total XP.
 */
export function xpForLevel(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.round(28 * level * level + 42 * level + 30);
}

export function levelState(xp: number): LevelState {
  let level = 1;
  let remaining = xp;
  while (level < MAX_LEVEL) {
    const need = xpForLevel(level);
    if (remaining < need) break;
    remaining -= need;
    level++;
  }
  return { level, xp: remaining, toNext: xpForLevel(level) };
}

/**
 * Stat scaling applied on top of a species' base stats.
 *
 * Damage outpaces rate deliberately: a creature that fires faster and faster
 * eventually saturates the projectile pool and stops feeling stronger, whereas
 * damage keeps reading as progress at every level.
 */
export function statMultipliers(level: number) {
  const t = (level - 1) / (MAX_LEVEL - 1);
  return {
    damage: 1 + t * 2.4,
    range: 1 + t * 0.45,
    rate: 1 + t * 0.6,
  };
}

export interface EvolutionRule {
  /** Species this evolves into. */
  into: string;
  atLevel: number;
}

const STORAGE_KEY = 'gearwood.collection.v1';

/**
 * Persistent collection.
 *
 * Every write is wrapped: storage throws in private windows and when a browser
 * is set to block site data, and losing progress must never take the game down
 * with it.
 */
export class Collection {
  private entries = new Map<string, CollectionEntry>();

  constructor(speciesIds: string[]) {
    for (const id of speciesIds) {
      this.entries.set(id, { speciesId: id, seen: false, caught: false, level: 1, xp: 0, kills: 0 });
    }
    this.load();
  }

  get(id: string): CollectionEntry | undefined {
    return this.entries.get(id);
  }

  all(): CollectionEntry[] {
    return [...this.entries.values()];
  }

  get caughtCount(): number {
    return this.all().filter((e) => e.caught).length;
  }

  markSeen(id: string) {
    const e = this.entries.get(id);
    if (e && !e.seen) { e.seen = true; this.save(); }
  }

  markCaught(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    e.seen = true;
    if (!e.caught) { e.caught = true; this.save(); }
  }

  /** Award XP. Returns the new level if the creature levelled up, else null. */
  awardXp(id: string, amount: number): number | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const before = levelState(e.xp).level;
    e.xp += amount;
    const after = levelState(e.xp).level;
    e.level = after;
    this.save();
    return after > before ? after : null;
  }

  recordKill(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    e.kills++;
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as CollectionEntry[];
      if (!Array.isArray(parsed)) return;
      for (const saved of parsed) {
        const e = this.entries.get(saved.speciesId);
        if (!e) continue; // species removed since the save was written
        e.seen = !!saved.seen;
        e.caught = !!saved.caught;
        e.xp = Number.isFinite(saved.xp) ? saved.xp : 0;
        e.kills = Number.isFinite(saved.kills) ? saved.kills : 0;
        e.level = levelState(e.xp).level;
      }
    } catch {
      // Corrupt or unavailable storage: start fresh rather than fail to boot.
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.all()));
    } catch {
      // Storage blocked or full; progress is lost but play continues.
    }
  }

  reset() {
    for (const e of this.entries.values()) {
      e.seen = e.caught = false;
      e.xp = e.kills = 0;
      e.level = 1;
    }
    this.save();
  }
}
