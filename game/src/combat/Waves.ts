import type { EnemyTier } from './Enemy';

export interface SpawnGroup {
  tier: EnemyTier;
  count: number;
  /** Seconds between spawns within this group. */
  interval: number;
  /** Seconds to wait after the previous group before starting this one. */
  delay: number;
}

export interface WaveDef {
  index: number;
  name: string;
  groups: SpawnGroup[];
  /** Bonus paid for clearing the wave. */
  reward: number;
  boss?: boolean;
}

/**
 * Wave table.
 *
 * The shape here matters more than the numbers: each wave introduces exactly
 * one new idea, then the next re-uses it under time pressure. Waves that just
 * scale a count teach the player nothing.
 */
export const WAVES: WaveDef[] = [
  { index: 1,  name: 'First Cogs',      reward: 12, groups: [{ tier: 'husk', count: 6, interval: 1.05, delay: 0 }] },
  { index: 2,  name: 'Rolling In',      reward: 14, groups: [{ tier: 'husk', count: 11, interval: 0.78, delay: 0 }] },
  { index: 3,  name: 'Iron Arrives',    reward: 18, groups: [
      { tier: 'husk',  count: 8, interval: 0.7, delay: 0 },
      { tier: 'brute', count: 2, interval: 1.6, delay: 2.2 }] },
  { index: 4,  name: 'Pressure',        reward: 22, groups: [
      { tier: 'husk',  count: 14, interval: 0.5, delay: 0 },
      { tier: 'brute', count: 4,  interval: 1.2, delay: 1.5 }] },
  { index: 5,  name: 'The Warden',      reward: 34, groups: [
      { tier: 'brute',  count: 6, interval: 0.9, delay: 0 },
      { tier: 'warden', count: 1, interval: 1.0, delay: 3.0 }] },
  { index: 6,  name: 'Split Column',    reward: 40, groups: [
      { tier: 'husk',   count: 18, interval: 0.38, delay: 0 },
      { tier: 'warden', count: 2,  interval: 2.0,  delay: 2.5 }] },
  { index: 7,  name: 'Brass Tide',      reward: 52, groups: [
      { tier: 'brute',  count: 10, interval: 0.6, delay: 0 },
      { tier: 'warden', count: 4,  interval: 1.4, delay: 2.0 }] },
  { index: 8,  name: 'Overrun',         reward: 68, groups: [
      { tier: 'husk',   count: 26, interval: 0.28, delay: 0 },
      { tier: 'brute',  count: 12, interval: 0.5,  delay: 1.0 },
      { tier: 'warden', count: 5,  interval: 1.2,  delay: 2.0 }] },
  { index: 9,  name: 'Vanguard',        reward: 82, groups: [
      { tier: 'warden', count: 8, interval: 0.9, delay: 0 },
      { tier: 'brute',  count: 16, interval: 0.34, delay: 1.2 }] },
  { index: 10, name: 'Gearwood Colossus', reward: 220, boss: true, groups: [
      { tier: 'brute',    count: 12, interval: 0.42, delay: 0 },
      { tier: 'warden',   count: 6,  interval: 0.9,  delay: 1.5 },
      { tier: 'colossus', count: 1,  interval: 1.0,  delay: 4.0 }] },
];

/** Flattened spawn schedule: absolute time offsets from wave start. */
export interface ScheduledSpawn { at: number; tier: EnemyTier; }

export function scheduleWave(wave: WaveDef): ScheduledSpawn[] {
  const out: ScheduledSpawn[] = [];
  let groupStart = 0;
  for (const g of wave.groups) {
    groupStart += g.delay;
    for (let i = 0; i < g.count; i++) {
      out.push({ at: groupStart + i * g.interval, tier: g.tier });
    }
    // The next group's delay is measured from the end of this one.
    groupStart += Math.max(0, g.count - 1) * g.interval;
  }
  return out.sort((a, b) => a.at - b.at);
}
