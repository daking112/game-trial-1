import type { MonsterSpecies } from './types';

// ---------------------------------------------------------------------------
// The gacha pool. Each species is a "loadout": a barrel pattern (diep.io-
// style tank class) plus stat multipliers layered on top of the player's
// run-time (level + allocated points) stats. Pure data, no client/Phaser
// dependency, so the arena scene and the collection/gacha UI both read from
// this single source of truth.
// ---------------------------------------------------------------------------

export const MONSTERS: MonsterSpecies[] = [
  {
    id: 'snubnose',
    name: 'Snubnose',
    description: 'A balanced starter with a single steady cannon. No weaknesses, no surprises.',
    rarity: 'common',
    color: 0x7bd88f,
    accentColor: 0x4a9e5c,
    barrels: [{ angleOffset: 0, damageMult: 1, cooldownMult: 1 }],
    statMults: { movementSpeed: 1.05 },
  },
  {
    id: 'twinfang',
    name: 'Twinfang',
    description: 'Fires two parallel bolts at once for a rattling burst of damage.',
    rarity: 'common',
    color: 0xff9d5c,
    accentColor: 0xc26a2e,
    barrels: [
      { angleOffset: -6, damageMult: 0.65 },
      { angleOffset: 6, damageMult: 0.65 },
    ],
    statMults: { bodyDamage: 0.95 },
  },
  {
    id: 'skitterling',
    name: 'Skitterling',
    description: 'Skittish and quick, spraying a fast triple spread while darting around.',
    rarity: 'common',
    color: 0xf2d43f,
    accentColor: 0xb89a1f,
    barrels: [
      { angleOffset: -14, damageMult: 0.5, speedMult: 1.1, cooldownMult: 0.75 },
      { angleOffset: 0, damageMult: 0.5, speedMult: 1.1, cooldownMult: 0.75 },
      { angleOffset: 14, damageMult: 0.5, speedMult: 1.1, cooldownMult: 0.75 },
    ],
    statMults: { movementSpeed: 1.25, maxHealth: 0.85 },
  },
  {
    id: 'bramblehide',
    name: 'Bramblehide',
    description: 'Thorny and slow, built to tank hits and shove enemies aside.',
    rarity: 'common',
    color: 0x8a6b3a,
    accentColor: 0x5c481f,
    barrels: [{ angleOffset: 0, damageMult: 1.3, sizeMult: 1.2, cooldownMult: 1.3 }],
    statMults: { maxHealth: 1.35, bodyDamage: 1.4, movementSpeed: 0.85, bulletSpeed: 0.9 },
  },
  {
    id: 'driftmoth',
    name: 'Driftmoth',
    description: 'A long-range sniper that trades survivability for reach and punch.',
    rarity: 'common',
    color: 0xbfe8ff,
    accentColor: 0x7ab8d6,
    barrels: [{ angleOffset: 0, damageMult: 1.6, speedMult: 1.5, sizeMult: 0.9, cooldownMult: 1.6 }],
    statMults: { bulletSpeed: 1.3, maxHealth: 0.85 },
  },
  {
    id: 'voltapup',
    name: 'Voltapup',
    description: 'Crackling with static, it unloads a rapid three-barrel volley.',
    rarity: 'rare',
    color: 0x7fe8ff,
    accentColor: 0xf2d43f,
    barrels: [
      { angleOffset: -10, damageMult: 0.55, cooldownMult: 0.55 },
      { angleOffset: 0, damageMult: 0.55, cooldownMult: 0.55 },
      { angleOffset: 10, damageMult: 0.55, cooldownMult: 0.55 },
    ],
    statMults: { movementSpeed: 1.1, bulletSpeed: 1.1 },
  },
  {
    id: 'cindermaw',
    name: 'Cindermaw',
    description: 'A close-range brawler that breathes a wide fan of short, fast embers.',
    rarity: 'rare',
    color: 0xff6a3d,
    accentColor: 0xc23e17,
    barrels: [
      { angleOffset: -20, damageMult: 0.3, sizeMult: 0.8, speedMult: 0.8, cooldownMult: 0.4 },
      { angleOffset: -10, damageMult: 0.3, sizeMult: 0.8, speedMult: 0.8, cooldownMult: 0.4 },
      { angleOffset: 0, damageMult: 0.3, sizeMult: 0.8, speedMult: 0.8, cooldownMult: 0.4 },
      { angleOffset: 10, damageMult: 0.3, sizeMult: 0.8, speedMult: 0.8, cooldownMult: 0.4 },
      { angleOffset: 20, damageMult: 0.3, sizeMult: 0.8, speedMult: 0.8, cooldownMult: 0.4 },
    ],
    statMults: { bodyDamage: 1.1 },
  },
  {
    id: 'glacefin',
    name: 'Glacefin',
    description: 'Slow and heavy, its bolts punch clean through anything in a line.',
    rarity: 'rare',
    color: 0xa8e4ff,
    accentColor: 0x5c9ec2,
    barrels: [{ angleOffset: 0, damageMult: 1.8, sizeMult: 1.4, speedMult: 0.8, cooldownMult: 1.8 }],
    statMults: { maxHealth: 1.2, movementSpeed: 0.8, bulletPenetrationBonus: 2 },
  },
  {
    id: 'duskrend',
    name: 'Duskrend',
    description: 'Four barrels fanned wide, laying down a screen of shadow bolts.',
    rarity: 'epic',
    color: 0x9d7bd8,
    accentColor: 0x5f4790,
    barrels: [
      { angleOffset: -24, damageMult: 0.5, cooldownMult: 0.85 },
      { angleOffset: -8, damageMult: 0.5, cooldownMult: 0.85 },
      { angleOffset: 8, damageMult: 0.5, cooldownMult: 0.85 },
      { angleOffset: 24, damageMult: 0.5, cooldownMult: 0.85 },
    ],
    statMults: { bulletDamage: 1.1, maxHealth: 1.05 },
  },
  {
    id: 'aurospine',
    name: 'Aurospine',
    description: 'Twin forward cannons and a rear-facing barrel to cover its own back.',
    rarity: 'epic',
    color: 0xffd76a,
    accentColor: 0xc29a2e,
    barrels: [
      { angleOffset: -6, damageMult: 0.85 },
      { angleOffset: 6, damageMult: 0.85 },
      { angleOffset: 178, damageMult: 0.5, cooldownMult: 1.2 },
    ],
    statMults: { maxHealth: 1.1, bodyDamage: 1.05, movementSpeed: 1.05 },
  },
  {
    id: 'voidmaul',
    name: 'Voidmaul',
    description: 'The apex of the gacha pool: twin heavy cannons and a rear guard, built to dominate.',
    rarity: 'legendary',
    color: 0x4a2e6b,
    accentColor: 0xd59bff,
    barrels: [
      { angleOffset: -10, damageMult: 1.4, sizeMult: 1.2 },
      { angleOffset: 10, damageMult: 1.4, sizeMult: 1.2 },
      { angleOffset: 180, damageMult: 1.0, sizeMult: 1.1, cooldownMult: 1.1 },
    ],
    statMults: { maxHealth: 1.4, bodyDamage: 1.5, bulletDamage: 1.3, movementSpeed: 0.95 },
  },
];

export const MONSTERS_BY_ID: Record<string, MonsterSpecies> = Object.fromEntries(
  MONSTERS.map((m) => [m.id, m]),
);

export const STARTER_SPECIES_ID = 'snubnose';
