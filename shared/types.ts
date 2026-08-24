// ---------------------------------------------------------------------------
// Core cross-cutting types for Monsterfall. Shared between client and (in a
// later phase) the authoritative server, so nothing in here should depend on
// Phaser, React, or any client-only library.
// ---------------------------------------------------------------------------

export type Element =
  | 'fire'
  | 'water'
  | 'nature'
  | 'electric'
  | 'earth'
  | 'wind'
  | 'ice'
  | 'shadow';

export type Rarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary'
  | 'mythic';

export type TargetingMode = 'first' | 'last' | 'strongest' | 'closest';

export type AbilityKind =
  | 'aoe_damage' // Fireball-style: burst damage in a radius around the target
  | 'slow_field' // Freeze-style: slows enemies in a radius for a duration
  | 'chain' // Chain Lightning-style: hits several enemies in sequence
  | 'dot_area' // Poison Cloud-style: damage over time in a radius
  | 'barrage'; // rapid volley of hits against the current target

export interface AbilityDefinition {
  id: string;
  name: string;
  description: string;
  kind: AbilityKind;
  cooldownMs: number;
  power: number; // damage/slow-strength multiplier relative to base damage
  radius?: number; // for area effects, in world pixels
  durationMs?: number; // for slow/dot effects
  chainCount?: number; // for chain effects, extra targets beyond the first
}

export type PassiveKind =
  | 'elemental_bonus' // bonus damage vs a specific element
  | 'attack_speed_ramp' // attack speed increases as the wave progresses
  | 'range_boost' // flat range increase
  | 'ultimate_charge_boost'; // ultimate meter fills faster

export interface PassiveDefinition {
  id: string;
  name: string;
  description: string;
  kind: PassiveKind;
  value: number;
  vsElement?: Element;
}

export interface EvolutionDefinition {
  intoId: string;
  intoName: string;
  atLevel: number;
  statMultiplier: number; // applied to base stats on evolution
}

export interface MonsterDefinition {
  id: string;
  name: string;
  description: string;
  element: Element;
  rarity: Rarity;
  habitat: string;
  baseHealth: number;
  baseDamage: number;
  attackSpeed: number; // attacks per second
  range: number; // world pixels
  movementSpeed: number; // unused for towers, reserved for future roaming
  ability: AbilityDefinition;
  passive: PassiveDefinition;
  evolution: EvolutionDefinition | null;
  spriteKey: string; // key into the sprite/portrait atlas
  color: string; // placeholder tint used until final art lands
}

export type TraitId = 'reckless' | 'guardian' | 'bloodthirsty' | 'strategist';

export interface TraitDefinition {
  id: TraitId;
  name: string;
  description: string;
  damageMult: number;
  defenseMult: number;
  attackSpeedMult: number;
  cooldownMult: number;
  onKillAttackSpeedBonus: number; // temporary attack-speed bonus after a kill
}

export type EnemyKind = 'grunt' | 'brute' | 'runner' | 'boss';

export interface EnemyDefinition {
  id: string;
  kind: EnemyKind;
  name: string;
  description: string;
  element: Element;
  baseHealth: number;
  baseDamage: number;
  moveSpeed: number; // world pixels per second
  reward: { gold: number; crystals: number };
  coreDamage: number; // life lost if it reaches the core
  spriteKey: string;
  color: string;
}

export interface WaveEnemySpawn {
  enemyId: string;
  count: number;
  intervalMs: number; // spacing between spawns of this entry
}

export interface WaveDefinition {
  wave: number;
  enemies: WaveEnemySpawn[];
  healthMult: number;
  damageMult: number;
}

// ---------------------------------------------------------------------------
// Persisted / runtime monster instance (an owned monster, not a species def).
// ---------------------------------------------------------------------------

export interface MonsterInstance {
  instanceId: string;
  speciesId: string;
  nickname: string | null;
  level: number;
  xp: number;
  traitId: TraitId;
  evolved: boolean; // whether it has evolved into its evolution's form
  capturedAt: number; // epoch ms
}

export interface CodexEntry {
  speciesId: string;
  seen: boolean;
  captured: boolean;
  evolvedSeen: boolean;
}
