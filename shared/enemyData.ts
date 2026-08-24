import type { EnemyDefinition } from './types';
import { ELEMENT_COLORS } from './constants';

// ---------------------------------------------------------------------------
// The Rustfall Swarm: machinery from the collapsed airship works that kept
// running long after everyone left, now scavenging the forest on its own.
// ---------------------------------------------------------------------------

export const ENEMIES: Record<string, EnemyDefinition> = {
  grunt: {
    id: 'grunt',
    kind: 'grunt',
    name: 'Rustling',
    description: 'A skittering scrap-crab, quick and disposable.',
    element: 'earth',
    baseHealth: 32,
    baseDamage: 4,
    moveSpeed: 55,
    reward: { gold: 4, crystals: 0 },
    coreDamage: 1,
    spriteKey: 'rustling',
    color: '#8a8f7a',
  },
  brute: {
    id: 'brute',
    kind: 'brute',
    name: 'Hullcrusher',
    description: 'A lumbering salvage-hauler frame, slow but heavily plated.',
    element: 'earth',
    baseHealth: 130,
    baseDamage: 10,
    moveSpeed: 30,
    reward: { gold: 10, crystals: 0 },
    coreDamage: 2,
    spriteKey: 'hullcrusher',
    color: '#6b5a45',
  },
  runner: {
    id: 'runner',
    kind: 'runner',
    name: 'Sprocketail',
    description: 'A whip-fast courier-drone chassis, fragile but relentless.',
    element: 'wind',
    baseHealth: 20,
    baseDamage: 3,
    moveSpeed: 100,
    reward: { gold: 5, crystals: 0 },
    coreDamage: 1,
    spriteKey: 'sprocketail',
    color: ELEMENT_COLORS.wind,
  },
  boss: {
    id: 'boss',
    kind: 'boss',
    name: 'The Foreman',
    description: 'A towering repair-golem that once oversaw the airship works. It still thinks it does.',
    element: 'shadow',
    baseHealth: 1400,
    baseDamage: 30,
    moveSpeed: 22,
    reward: { gold: 120, crystals: 5 },
    coreDamage: 6,
    spriteKey: 'foreman',
    color: '#b23b3b',
  },
};
