import type { Rarity, ShapeDef, ShapeKind, StatKey } from './types';

// ---------------------------------------------------------------------------
// Rarity configuration: gacha pull weight, UI color, star bonus.
// ---------------------------------------------------------------------------

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export const RARITY_CONFIG: Record<Rarity, { weight: number; color: string; label: string }> = {
  common: { weight: 58, color: '#b9bcc4', label: 'Common' },
  rare: { weight: 28, color: '#5ea8ff', label: 'Rare' },
  epic: { weight: 11, color: '#c983ff', label: 'Epic' },
  legendary: { weight: 3, color: '#ffb84d', label: 'Legendary' },
};

export const MAX_STARS = 5;
export const STAR_BONUS_PER_STAR = 0.04; // +4% to all species multipliers per star beyond the first

// ---------------------------------------------------------------------------
// Gacha economy.
// ---------------------------------------------------------------------------

export const STARTING_GEARS = 500;
export const PULL_COST_SINGLE = 100;
export const PULL_COST_TEN = 900;
export const PITY_PULLS_FOR_GUARANTEED_EPIC = 10;

// ---------------------------------------------------------------------------
// In-run leveling (diep.io-style stat point allocation).
// ---------------------------------------------------------------------------

export const LEVEL_CAP = 30;
export const MAX_POINTS_PER_STAT = 7;

export function xpForNextLevel(level: number): number {
  return Math.round(14 * Math.pow(level, 1.6));
}

export const STAT_KEYS: StatKey[] = [
  'healthRegen',
  'maxHealth',
  'bodyDamage',
  'bulletSpeed',
  'bulletPenetration',
  'bulletDamage',
  'reload',
  'movementSpeed',
];

export const STAT_LABELS: Record<StatKey, string> = {
  healthRegen: 'Health Regen',
  maxHealth: 'Max Health',
  bodyDamage: 'Body Damage',
  bulletSpeed: 'Bullet Speed',
  bulletPenetration: 'Penetration',
  bulletDamage: 'Bullet Damage',
  reload: 'Reload',
  movementSpeed: 'Movement Speed',
};

// Base (0-point) player stats before species/star multipliers.
export const BASE_STATS = {
  maxHealth: 100,
  healthRegenPerSec: 0.5,
  bodyDamage: 8,
  bulletDamage: 8,
  bulletSpeed: 480,
  bulletPenetration: 1,
  reloadMs: 420,
  movementSpeed: 230,
};

// Per-allocated-point effect on each stat.
export const STAT_POINT_EFFECT: Record<StatKey, number> = {
  healthRegen: 1.1, // + HP/sec per point
  maxHealth: 0.12, // multiplicative, +12% per point
  bodyDamage: 0.15, // multiplicative
  bulletSpeed: 0.08, // multiplicative
  bulletPenetration: 1, // + pierces per point
  bulletDamage: 0.15, // multiplicative
  reload: 0.07, // multiplicative cooldown reduction per point
  movementSpeed: 0.06, // multiplicative
};

// ---------------------------------------------------------------------------
// Arena shapes.
// ---------------------------------------------------------------------------

export const SHAPE_DEFS: Record<ShapeKind, ShapeDef> = {
  square: { kind: 'square', health: 10, xp: 3, bodyDamage: 5, color: 0xc9cdd6, size: 20, spinSpeed: 0.6 },
  triangle: { kind: 'triangle', health: 42, xp: 8, bodyDamage: 9, color: 0xffc93c, size: 27, spinSpeed: 1.4 },
  pentagon: { kind: 'pentagon', health: 150, xp: 32, bodyDamage: 16, color: 0x5ea8ff, size: 42, spinSpeed: 0.9 },
};

export const SHAPE_SPAWN_WEIGHTS: Record<ShapeKind, number> = { square: 60, triangle: 30, pentagon: 10 };
export const SHAPE_TARGET_COUNT = 55;
export const SHAPE_RESPAWN_DELAY_MS = 2500;

// ---------------------------------------------------------------------------
// AI bots.
// ---------------------------------------------------------------------------

export const BOT_TARGET_COUNT = 4;
export const BOT_RESPAWN_DELAY_MS = 4000;
export const BOT_BASE_HEALTH = 90;
export const BOT_HEALTH_PER_LEVEL = 6;
export const BOT_XP = 45;
export const BOT_BODY_DAMAGE = 11;
export const BOT_BULLET_DAMAGE = 9;
export const BOT_BULLET_SPEED = 380;
export const BOT_FIRE_INTERVAL_MS = 1300;
export const BOT_SIGHT_RANGE = 520;
export const BOT_MOVE_SPEED = 150;

// ---------------------------------------------------------------------------
// Arena world.
// ---------------------------------------------------------------------------

export const ARENA_WIDTH = 4000;
export const ARENA_HEIGHT = 4000;
