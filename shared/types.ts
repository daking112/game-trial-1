// ---------------------------------------------------------------------------
// Core cross-cutting types for the game. Shared between client and (in a
// later phase) an authoritative server, so nothing in here should depend on
// Phaser, React, or any client-only library.
// ---------------------------------------------------------------------------

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

// The 8 diep.io-style stats a player allocates points into during a run.
export type StatKey =
  | 'healthRegen'
  | 'maxHealth'
  | 'bodyDamage'
  | 'bulletSpeed'
  | 'bulletPenetration'
  | 'bulletDamage'
  | 'reload'
  | 'movementSpeed';

export type StatBlock = Record<StatKey, number>;

// A single gun barrel on a monster's body. Angle is relative to the aim
// direction (degrees, 0 = straight ahead, 180 = straight back).
export interface BarrelDef {
  angleOffset: number;
  damageMult: number;
  speedMult?: number;
  sizeMult?: number;
  cooldownMult?: number;
}

// Multipliers a species/loadout applies on top of the player's run-time
// (level + allocated points) stats. Anything omitted defaults to 1 (or 0
// for bulletPenetrationBonus).
export interface LoadoutStatMults {
  maxHealth?: number;
  healthRegen?: number;
  bodyDamage?: number;
  bulletDamage?: number;
  bulletSpeed?: number;
  reload?: number;
  movementSpeed?: number;
  bulletPenetrationBonus?: number;
}

export interface MonsterSpecies {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  color: number; // hex 0xRRGGBB, used for body fill in the arena + UI
  accentColor: number; // barrel/turret color
  barrels: BarrelDef[];
  statMults: LoadoutStatMults;
}

// ---------------------------------------------------------------------------
// Persisted collection data (an owned monster species + how many copies).
// ---------------------------------------------------------------------------

export interface CollectionEntry {
  speciesId: string;
  stars: number; // 1-5, +1 per duplicate pull beyond the first
  copies: number;
  obtainedAt: number; // epoch ms of first pull
}

export interface PullResult {
  speciesId: string;
  rarity: Rarity;
  isNew: boolean;
  starsAfter: number;
}

// ---------------------------------------------------------------------------
// Arena shapes & bots (world-side, not persisted).
// ---------------------------------------------------------------------------

export type ShapeKind = 'square' | 'triangle' | 'pentagon';

export interface ShapeDef {
  kind: ShapeKind;
  health: number;
  xp: number;
  bodyDamage: number;
  color: number;
  size: number;
  spinSpeed: number; // radians/sec, purely visual
}

export interface RunResult {
  score: number;
  level: number;
  kills: number;
  survivedMs: number;
  gearsEarned: number;
}
