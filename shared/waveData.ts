import type { WaveDefinition } from './types';

// ---------------------------------------------------------------------------
// Data-driven wave table for the Gearwood Thicket MVP map. 10 waves, boss
// on wave 10. Health/damage multipliers scale gradually; new enemy kinds
// are introduced progressively rather than all at once.
// ---------------------------------------------------------------------------

export const WAVES: WaveDefinition[] = [
  { wave: 1, healthMult: 1.0, damageMult: 1.0, enemies: [{ enemyId: 'grunt', count: 6, intervalMs: 600 }] },
  { wave: 2, healthMult: 1.1, damageMult: 1.0, enemies: [{ enemyId: 'grunt', count: 8, intervalMs: 550 }] },
  {
    wave: 3,
    healthMult: 1.2,
    damageMult: 1.05,
    enemies: [
      { enemyId: 'grunt', count: 6, intervalMs: 550 },
      { enemyId: 'runner', count: 4, intervalMs: 450 },
    ],
  },
  {
    wave: 4,
    healthMult: 1.35,
    damageMult: 1.1,
    enemies: [
      { enemyId: 'grunt', count: 6, intervalMs: 500 },
      { enemyId: 'brute', count: 2, intervalMs: 900 },
    ],
  },
  {
    wave: 5,
    healthMult: 1.5,
    damageMult: 1.15,
    enemies: [
      { enemyId: 'runner', count: 6, intervalMs: 400 },
      { enemyId: 'brute', count: 3, intervalMs: 800 },
    ],
  },
  {
    wave: 6,
    healthMult: 1.7,
    damageMult: 1.2,
    enemies: [
      { enemyId: 'grunt', count: 8, intervalMs: 450 },
      { enemyId: 'runner', count: 5, intervalMs: 400 },
      { enemyId: 'brute', count: 2, intervalMs: 900 },
    ],
  },
  {
    wave: 7,
    healthMult: 1.9,
    damageMult: 1.25,
    enemies: [
      { enemyId: 'brute', count: 4, intervalMs: 750 },
      { enemyId: 'runner', count: 6, intervalMs: 400 },
    ],
  },
  {
    wave: 8,
    healthMult: 2.15,
    damageMult: 1.3,
    enemies: [
      { enemyId: 'grunt', count: 10, intervalMs: 400 },
      { enemyId: 'brute', count: 4, intervalMs: 700 },
    ],
  },
  {
    wave: 9,
    healthMult: 2.4,
    damageMult: 1.35,
    enemies: [
      { enemyId: 'runner', count: 8, intervalMs: 350 },
      { enemyId: 'brute', count: 5, intervalMs: 650 },
      { enemyId: 'grunt', count: 6, intervalMs: 400 },
    ],
  },
  {
    wave: 10,
    healthMult: 2.6,
    damageMult: 1.4,
    enemies: [
      { enemyId: 'grunt', count: 6, intervalMs: 400 },
      { enemyId: 'brute', count: 3, intervalMs: 700 },
      { enemyId: 'boss', count: 1, intervalMs: 0 },
    ],
  },
];
