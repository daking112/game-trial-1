import type { EnemyTier } from './Enemy';

export interface SpawnGroup {
  tier: EnemyTier;
  count: number;
  /** Seconds between spawns within this group. */
  interval: number;
  /** Absolute seconds from the start of the wave at which this group begins. */
  at: number;
}

export interface WaveDef {
  index: number;
  name: string;
  /** One line the HUD can show. Says what is new, not what is numerous. */
  brief: string;
  groups: SpawnGroup[];
  /** Bonus paid for clearing the wave. */
  reward: number;
  boss?: boolean;
}

/**
 * Wave table.
 *
 * Two rules run through all ten, and they are what make a wave read as a
 * formation rather than as a queue.
 *
 * **One new idea per wave.** 1-2 teach the loop, 3 introduces speed, 4
 * introduces armour, 6 introduces shields, and every wave after that recombines
 * those three under time pressure. A wave that only raises a count teaches
 * nothing, so there isn't one.
 *
 * **Slow tiers spawn first, fast tiers spawn last.** Brutes and Wardens are
 * released at t=0 and the Sparkdarts several seconds later, so the runners
 * visibly overtake the armour on the way down the track. The player therefore
 * sees the whole wave laid out in depth at once — heavies mid-field, runners
 * closing — instead of one dense knot crawling out of the spawn. Group start
 * times are absolute for exactly this reason: the overlap between tiers *is*
 * the design, so it is stated rather than derived.
 *
 * `tools/simulate.mjs` is the instrument for the numbers. It runs all ten
 * against a fixed three-tower defence that never upgrades and never buys —
 * deliberately far less than a real player has. The curve it should show is
 * untouched through 4, a bleed opening at 5, and the boss actually reached.
 */
export const WAVES: WaveDef[] = [
  {
    index: 1, name: 'First Cogs', reward: 12,
    brief: 'Husks. They walk, you shoot.',
    groups: [{ tier: 'husk', count: 6, interval: 1.0, at: 0 }],
  },
  {
    index: 2, name: 'Rolling In', reward: 14,
    brief: 'More of the same, closer together.',
    groups: [{ tier: 'husk', count: 12, interval: 0.7, at: 0 }],
  },
  {
    index: 3, name: 'Quick Ones', reward: 20,
    brief: 'Sparkdarts run twice as fast as anything so far.',
    groups: [
      { tier: 'husk', count: 8, interval: 0.55, at: 0 },
      { tier: 'dart', count: 4, interval: 0.8, at: 2.0 },
    ],
  },
  {
    index: 4, name: 'Iron Arrives', reward: 26,
    brief: 'Brutes are armoured — fast little hits barely scratch them.',
    groups: [
      { tier: 'brute', count: 3, interval: 1.2, at: 0 },
      { tier: 'husk', count: 10, interval: 0.5, at: 0.4 },
      { tier: 'dart', count: 3, interval: 0.7, at: 3.0 },
    ],
  },
  {
    index: 5, name: 'Runners', reward: 34,
    brief: 'A dart pack behind an iron screen.',
    groups: [
      { tier: 'brute', count: 4, interval: 1.0, at: 0 },
      { tier: 'husk', count: 10, interval: 0.45, at: 0.5 },
      { tier: 'dart', count: 8, interval: 0.4, at: 2.5 },
    ],
  },
  {
    index: 6, name: 'The Warden', reward: 46,
    brief: 'Wardens carry a shield. Break it before the body counts.',
    groups: [
      { tier: 'warden', count: 2, interval: 2.2, at: 0 },
      { tier: 'brute', count: 4, interval: 0.9, at: 0.6 },
      { tier: 'husk', count: 12, interval: 0.38, at: 1.0 },
    ],
  },
  {
    index: 7, name: 'Split Column', reward: 60,
    brief: 'Wardens break into Brutes, Brutes break into Husks.',
    groups: [
      { tier: 'warden', count: 3, interval: 1.6, at: 0 },
      { tier: 'husk', count: 14, interval: 0.32, at: 0.5 },
      { tier: 'dart', count: 6, interval: 0.4, at: 3.5 },
    ],
  },
  {
    index: 8, name: 'Brass Tide', reward: 78,
    brief: 'Armour and shields, arriving together.',
    groups: [
      { tier: 'warden', count: 3, interval: 1.4, at: 0 },
      { tier: 'brute', count: 8, interval: 0.5, at: 0.6 },
      { tier: 'dart', count: 8, interval: 0.32, at: 4.0 },
    ],
  },
  {
    index: 9, name: 'Vanguard', reward: 100,
    brief: 'No filler. Every one of these is worth killing early.',
    groups: [
      { tier: 'warden', count: 4, interval: 1.1, at: 0 },
      { tier: 'brute', count: 10, interval: 0.42, at: 1.0 },
      { tier: 'dart', count: 6, interval: 0.5, at: 4.0 },
    ],
  },
  {
    index: 10, name: 'Gearwood Colossus', reward: 260, boss: true,
    brief: 'Shielded, armoured, and it breaks into three Wardens.',
    groups: [
      { tier: 'warden', count: 3, interval: 1.0, at: 0 },
      { tier: 'brute', count: 8, interval: 0.45, at: 0.5 },
      { tier: 'dart', count: 6, interval: 0.4, at: 3.0 },
      // Late, and alone. A boss that arrives inside its own escort is a boss
      // nobody looks at.
      { tier: 'colossus', count: 1, interval: 1.0, at: 12.0 },
    ],
  },
];

/** Flattened spawn schedule: absolute time offsets from wave start. */
export interface ScheduledSpawn { at: number; tier: EnemyTier; }

export function scheduleWave(wave: WaveDef): ScheduledSpawn[] {
  const out: ScheduledSpawn[] = [];
  for (const g of wave.groups) {
    for (let i = 0; i < g.count; i++) out.push({ at: g.at + i * g.interval, tier: g.tier });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Total scheduled spawns in a wave. Used by the HUD and by pacing tools. */
export function waveSize(wave: WaveDef): number {
  return wave.groups.reduce((n, g) => n + g.count, 0);
}
