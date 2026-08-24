import type { MonsterDefinition, PassiveDefinition } from './types';
import { ABILITIES } from './abilityData';
import { ELEMENT_COLORS, RARITY_CONFIG } from './constants';

// ---------------------------------------------------------------------------
// Monsterfall's original creatures: the Verdant Forest has been half-claimed
// by a collapsed airship works, so its wildlife has fused with clockwork,
// steam, and brass over generations. Every design below is original —
// no names, silhouettes, or lore borrowed from any existing franchise.
// ---------------------------------------------------------------------------

function passive(p: PassiveDefinition): PassiveDefinition {
  return p;
}

export const MONSTERS: MonsterDefinition[] = [
  {
    id: 'cogling',
    name: 'Cogling',
    description:
      'A fist-sized clockwork rodent that scavenges loose gears from the ruined works and bolts them to its own hide. Warms up as it fights, ticking faster and faster.',
    element: 'earth',
    rarity: 'common',
    habitat: 'Gearwood Thicket',
    baseHealth: 60,
    baseDamage: 9,
    attackSpeed: 1.3,
    range: 130,
    movementSpeed: 90,
    ability: ABILITIES.gearBarrage,
    passive: passive({
      id: 'cogling-warmup',
      name: 'Warming Gears',
      description: 'Attack speed climbs the longer a battle runs.',
      kind: 'attack_speed_ramp',
      value: 0.02,
    }),
    evolution: { intoId: 'gearhide', intoName: 'Gearhide', atLevel: 8, statMultiplier: 1.6 },
    spriteKey: 'cogling',
    color: ELEMENT_COLORS.earth,
  },
  {
    id: 'boilerback',
    name: 'Boilerback',
    description:
      'A slow tortoise that fused with a runaway coal boiler decades ago. Its shell hisses and glows faintly orange along old rivet seams.',
    element: 'fire',
    rarity: 'common',
    habitat: 'Gearwood Thicket',
    baseHealth: 110,
    baseDamage: 11,
    attackSpeed: 0.8,
    range: 110,
    movementSpeed: 40,
    ability: ABILITIES.cinderBurst,
    passive: passive({
      id: 'boilerback-stoked',
      name: 'Stoked Furnace',
      description: 'Deals bonus damage to Nature-aligned foes.',
      kind: 'elemental_bonus',
      value: 0.2,
      vsElement: 'nature',
    }),
    evolution: { intoId: 'furnacetusk', intoName: 'Furnacetusk', atLevel: 8, statMultiplier: 1.6 },
    spriteKey: 'boilerback',
    color: ELEMENT_COLORS.fire,
  },
  {
    id: 'sparkmoth',
    name: 'Sparkmoth',
    description:
      'A moth whose wing-veins are strung with hair-thin copper wire. Static crackles between its wingtips whenever it takes flight.',
    element: 'electric',
    rarity: 'common',
    habitat: 'Gearwood Thicket',
    baseHealth: 45,
    baseDamage: 8,
    attackSpeed: 1.6,
    range: 140,
    movementSpeed: 120,
    ability: ABILITIES.arcChain,
    passive: passive({
      id: 'sparkmoth-conduit',
      name: 'Live Conduit',
      description: 'Deals bonus damage to Water-aligned foes.',
      kind: 'elemental_bonus',
      value: 0.2,
      vsElement: 'water',
    }),
    evolution: { intoId: 'voltwing', intoName: 'Voltwing', atLevel: 8, statMultiplier: 1.6 },
    spriteKey: 'sparkmoth',
    color: ELEMENT_COLORS.electric,
  },
  {
    id: 'pistonhog',
    name: 'Pistonhog',
    description:
      'A stocky boar whose legs were replaced with salvaged pneumatic pistons after an old mining accident. Charges with surprising force.',
    element: 'earth',
    rarity: 'uncommon',
    habitat: 'Gearwood Thicket',
    baseHealth: 140,
    baseDamage: 16,
    attackSpeed: 0.9,
    range: 100,
    movementSpeed: 70,
    ability: ABILITIES.pistonSlam,
    passive: passive({
      id: 'pistonhog-reach',
      name: 'Extended Piston',
      description: 'Flat range increase from its long piston arm.',
      kind: 'range_boost',
      value: 20,
    }),
    evolution: null,
    spriteKey: 'pistonhog',
    color: ELEMENT_COLORS.earth,
  },
  {
    id: 'mistgull',
    name: 'Mistgull',
    description:
      'A shorebird fitted with condenser-pipe wings that draw moisture from the air and fire it back out as pressurized jets.',
    element: 'water',
    rarity: 'uncommon',
    habitat: 'Gearwood Thicket',
    baseHealth: 70,
    baseDamage: 10,
    attackSpeed: 1.2,
    range: 135,
    movementSpeed: 100,
    ability: ABILITIES.condensingMist,
    passive: passive({
      id: 'mistgull-quench',
      name: 'Quenching Spray',
      description: 'Deals bonus damage to Fire-aligned foes.',
      kind: 'elemental_bonus',
      value: 0.2,
      vsElement: 'fire',
    }),
    evolution: { intoId: 'squallpipe', intoName: 'Squallpipe', atLevel: 10, statMultiplier: 1.7 },
    spriteKey: 'mistgull',
    color: ELEMENT_COLORS.water,
  },
  {
    id: 'thornwisp',
    name: 'Thornwisp',
    description:
      'A drifting sprite of woven vine and copper tubing. Small pressure gauges glow chlorophyll-green along its thorny frame.',
    element: 'nature',
    rarity: 'uncommon',
    habitat: 'Gearwood Thicket',
    baseHealth: 65,
    baseDamage: 7,
    attackSpeed: 1.1,
    range: 120,
    movementSpeed: 80,
    ability: ABILITIES.sporeVent,
    passive: passive({
      id: 'thornwisp-rootgrip',
      name: 'Root Grip',
      description: 'Deals bonus damage to Earth-aligned foes.',
      kind: 'elemental_bonus',
      value: 0.2,
      vsElement: 'earth',
    }),
    evolution: null,
    spriteKey: 'thornwisp',
    color: ELEMENT_COLORS.nature,
  },
  {
    id: 'gustrotor',
    name: 'Gustrotor',
    description:
      'A hollow-boned glider with a brass propeller grafted where its tail should be. Rides thermal drafts above the ruined works.',
    element: 'wind',
    rarity: 'rare',
    habitat: 'Gearwood Thicket',
    baseHealth: 90,
    baseDamage: 13,
    attackSpeed: 1.5,
    range: 150,
    movementSpeed: 130,
    ability: ABILITIES.cycloneBarrage,
    passive: passive({
      id: 'gustrotor-tailwind',
      name: 'Tailwind',
      description: 'Attack speed climbs the longer a battle runs.',
      kind: 'attack_speed_ramp',
      value: 0.025,
    }),
    evolution: { intoId: 'cyclonaut', intoName: 'Cyclonaut', atLevel: 12, statMultiplier: 1.8 },
    spriteKey: 'gustrotor',
    color: ELEMENT_COLORS.wind,
  },
  {
    id: 'frostvalve',
    name: 'Frostvalve',
    description:
      'A crystalline automaton built around a leaking cryo-boiler. Every valve along its spine hisses out plumes of supercooled steam.',
    element: 'ice',
    rarity: 'rare',
    habitat: 'Gearwood Thicket',
    baseHealth: 100,
    baseDamage: 14,
    attackSpeed: 1.0,
    range: 125,
    movementSpeed: 60,
    ability: ABILITIES.cryoVent,
    passive: passive({
      id: 'frostvalve-permafrost',
      name: 'Permafrost Core',
      description: 'Deals bonus damage to Wind-aligned foes.',
      kind: 'elemental_bonus',
      value: 0.2,
      vsElement: 'wind',
    }),
    evolution: null,
    spriteKey: 'frostvalve',
    color: ELEMENT_COLORS.ice,
  },
  {
    id: 'shadowgear',
    name: 'Shadowgear',
    description:
      'A phantom hound stitched together from loose smoke and cast-off brass cogs. Nobody has ever heard it approach — only the ticking, after.',
    element: 'shadow',
    rarity: 'epic',
    habitat: 'Gearwood Thicket (rare, nocturnal)',
    baseHealth: 120,
    baseDamage: 22,
    attackSpeed: 1.1,
    range: 115,
    movementSpeed: 110,
    ability: ABILITIES.umbralChain,
    passive: passive({
      id: 'shadowgear-dread',
      name: 'Dread Ticking',
      description: 'Its ultimate meter fills faster than normal.',
      kind: 'ultimate_charge_boost',
      value: 0.3,
    }),
    evolution: { intoId: 'duskchronos', intoName: 'Duskchronos', atLevel: 15, statMultiplier: 1.9 },
    spriteKey: 'shadowgear',
    color: ELEMENT_COLORS.shadow,
  },
  {
    id: 'aetherwing',
    name: 'Aetherwing',
    description:
      'A legendary sky-behemoth of brass and lightning-glass, said to have powered the very first airship before it broke free. Rarely seen, never forgotten.',
    element: 'wind',
    rarity: 'legendary',
    habitat: 'Gearwood Thicket (legendary, seasonal)',
    baseHealth: 220,
    baseDamage: 30,
    attackSpeed: 0.95,
    range: 160,
    movementSpeed: 100,
    ability: ABILITIES.aetherStorm,
    passive: passive({
      id: 'aetherwing-ascendant',
      name: 'Ascendant Core',
      description: 'Its ultimate meter fills significantly faster.',
      kind: 'ultimate_charge_boost',
      value: 0.5,
    }),
    evolution: null,
    spriteKey: 'aetherwing',
    color: ELEMENT_COLORS.wind,
  },
];

export const MONSTERS_BY_ID: Record<string, MonsterDefinition> = Object.fromEntries(
  MONSTERS.map((m) => [m.id, m]),
);

// Rarity-weighted random species pick, used for wild encounters after a win.
export function pickWeightedRandomSpecies(excludeIds: string[] = []): MonsterDefinition {
  const pool = MONSTERS.filter((m) => !excludeIds.includes(m.id));
  const total = pool.reduce((sum, m) => sum + RARITY_CONFIG[m.rarity].weight, 0);
  let roll = Math.random() * total;
  for (const m of pool) {
    roll -= RARITY_CONFIG[m.rarity].weight;
    if (roll <= 0) return m;
  }
  return pool[pool.length - 1];
}
