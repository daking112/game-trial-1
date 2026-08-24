import type { Element, Rarity, TraitDefinition, TraitId } from './types';

// ---------------------------------------------------------------------------
// Elemental effectiveness. Centralized so no combat code ever hardcodes
// element matchups directly. attacker element -> defender elements it deals
// bonus damage to. Expand this table to add new matchups.
// ---------------------------------------------------------------------------

export const ELEMENT_ADVANTAGES: Record<Element, Element[]> = {
  fire: ['nature', 'ice'],
  water: ['fire', 'earth'],
  nature: ['water', 'earth'],
  electric: ['water', 'wind'],
  earth: ['electric', 'fire'],
  wind: ['earth', 'nature'],
  ice: ['wind', 'nature'],
  shadow: ['electric', 'wind'],
};

export const ELEMENT_ADVANTAGE_MULT = 1.5;
export const ELEMENT_DISADVANTAGE_MULT = 0.75;

export function elementalMultiplier(attacker: Element, defender: Element): number {
  if (ELEMENT_ADVANTAGES[attacker]?.includes(defender)) return ELEMENT_ADVANTAGE_MULT;
  if (ELEMENT_ADVANTAGES[defender]?.includes(attacker)) return ELEMENT_DISADVANTAGE_MULT;
  return 1;
}

export const ELEMENT_COLORS: Record<Element, string> = {
  fire: '#ff6a3d',
  water: '#3daaff',
  nature: '#5fcf6b',
  electric: '#f2d43f',
  earth: '#b8895a',
  wind: '#8fe0d0',
  ice: '#a8e4ff',
  shadow: '#9d7bd8',
};

// ---------------------------------------------------------------------------
// Rarity configuration: stat scaling and base capture probability.
// ---------------------------------------------------------------------------

export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export const RARITY_CONFIG: Record<Rarity, { statMult: number; baseCaptureChance: number; weight: number }> = {
  common: { statMult: 1.0, baseCaptureChance: 0.65, weight: 42 },
  uncommon: { statMult: 1.15, baseCaptureChance: 0.5, weight: 28 },
  rare: { statMult: 1.35, baseCaptureChance: 0.35, weight: 16 },
  epic: { statMult: 1.6, baseCaptureChance: 0.2, weight: 8 },
  legendary: { statMult: 2.0, baseCaptureChance: 0.1, weight: 4 },
  mythic: { statMult: 2.5, baseCaptureChance: 0.05, weight: 2 },
};

// ---------------------------------------------------------------------------
// Traits: randomly rolled on capture, layered on top of species base stats.
// ---------------------------------------------------------------------------

export const TRAITS: Record<TraitId, TraitDefinition> = {
  reckless: {
    id: 'reckless',
    name: 'Reckless',
    description: '+12% damage, -8% defense.',
    damageMult: 1.12,
    defenseMult: 0.92,
    attackSpeedMult: 1,
    cooldownMult: 1,
    onKillAttackSpeedBonus: 0,
  },
  guardian: {
    id: 'guardian',
    name: 'Guardian',
    description: '+20% defense; steadies nearby allies.',
    damageMult: 1,
    defenseMult: 1.2,
    attackSpeedMult: 1,
    cooldownMult: 1,
    onKillAttackSpeedBonus: 0,
  },
  bloodthirsty: {
    id: 'bloodthirsty',
    name: 'Bloodthirsty',
    description: 'Gains a burst of attack speed after every kill.',
    damageMult: 1,
    defenseMult: 1,
    attackSpeedMult: 1,
    cooldownMult: 1,
    onKillAttackSpeedBonus: 0.35,
  },
  strategist: {
    id: 'strategist',
    name: 'Strategist',
    description: '-15% ability cooldown.',
    damageMult: 1,
    defenseMult: 1,
    attackSpeedMult: 1,
    cooldownMult: 0.85,
    onKillAttackSpeedBonus: 0,
  },
};

export const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

// ---------------------------------------------------------------------------
// Leveling / XP curve.
// ---------------------------------------------------------------------------

export const MAX_LEVEL = 20;

export function xpToNextLevel(level: number): number {
  return Math.round(20 * Math.pow(level, 1.55));
}

export function levelStatMultiplier(level: number): number {
  return 1 + (level - 1) * 0.09;
}

// ---------------------------------------------------------------------------
// Economy.
// ---------------------------------------------------------------------------

export const STARTING_GOLD = 150;
export const STARTING_CRYSTALS = 10;
