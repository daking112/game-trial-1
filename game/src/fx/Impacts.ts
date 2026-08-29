import * as THREE from 'three';
import type { BurstSpec, Particles } from './Particles';
import type { DamageKind, EnemyTier } from '../combat/Enemy';

/**
 * What each element looks like when it lands.
 *
 * Every hit used to be seven orange sparks regardless of what fired the shot,
 * so a Verdant tower and a Storm tower were indistinguishable once the
 * projectile disappeared. These five profiles differ on the three axes a
 * player can actually read at speed — colour, spread and how the debris
 * falls — rather than on count alone:
 *
 *   seed   green, heavy, falls    a lobbed thing that thumps and drops
 *   ember  orange, rises, lingers fire goes up
 *   jet    cyan, wide fan, falls  water sprays sideways and rains down
 *   bolt   violet, instant, flat  electricity has no debris, only a flash
 *   shard  white, tight cone      metal keeps going the way it was travelling
 */
export interface ImpactProfile {
  /** Main debris burst. */
  burst: BurstSpec;
  /** Optional second, brighter, shorter flash burst layered on top. */
  flash?: BurstSpec;
  /** Screen shake per hit. Small: hits are frequent. */
  shake: number;
  /** How strongly the burst is thrown along the projectile's travel. */
  focus: number;
}

export const IMPACTS: Record<DamageKind, ImpactProfile> = {
  seed: {
    burst: { count: 9, color: '#8ee63c', speed: [2.2, 5.5], life: [0.3, 0.62], size: 8.5, gravity: 16 },
    flash: { count: 4, color: '#e8ffc0', speed: [0.4, 1.6], life: [0.07, 0.12], size: 9, gravity: 0 },
    shake: 0.012, focus: 0.25,
  },
  ember: {
    // Negative gravity: embers climb. Nothing else in the game rises.
    burst: { count: 13, color: '#ff8a2e', speed: [1.6, 4.6], life: [0.34, 0.7], size: 9, gravity: -3.2 },
    flash: { count: 6, color: '#ffc24a', speed: [3, 8], life: [0.06, 0.12], size: 10, gravity: 0 },
    shake: 0.02, focus: 0.15,
  },
  jet: {
    burst: { count: 16, color: '#4fd8ff', speed: [3.5, 8.5], life: [0.22, 0.46], size: 7, gravity: 22 },
    flash: { count: 5, color: '#a8f0ff', speed: [0.5, 2], life: [0.06, 0.11], size: 9, gravity: 0 },
    shake: 0.014, focus: 0.55,
  },
  bolt: {
    // No debris and no gravity: a flat, instant crack of light.
    burst: { count: 10, color: '#d9a8ff', speed: [9, 17], life: [0.07, 0.13], size: 6, gravity: 0 },
    flash: { count: 3, color: '#ffffff', speed: [0.2, 0.9], life: [0.04, 0.08], size: 13, gravity: 0 },
    shake: 0.03, focus: 0,
  },
  shard: {
    // Tight cone along travel: shrapnel carries the shot's momentum through.
    burst: { count: 11, color: '#e6f0ff', speed: [7, 14], life: [0.14, 0.3], size: 6.5, gravity: 12 },
    flash: { count: 4, color: '#dce8ff', speed: [1, 3], life: [0.05, 0.09], size: 9, gravity: 0 },
    shake: 0.026, focus: 0.85,
  },
};

/** Hit on an intact shield: a cyan ripple, regardless of what fired. */
const SHIELD_HIT: ImpactProfile = {
  burst: { count: 14, color: '#6ff0ff', speed: [4, 9], life: [0.16, 0.32], size: 8, gravity: 0 },
  flash: { count: 5, color: '#c8f8ff', speed: [0.3, 1.2], life: [0.05, 0.1], size: 11, gravity: 0 },
  shake: 0.016, focus: 0,
};

/** Hit swallowed by armour: dull grey chips and almost no light. */
const DEFLECT: ImpactProfile = {
  burst: { count: 7, color: '#b9c6d8', speed: [4, 9], life: [0.16, 0.34], size: 5.5, gravity: 20 },
  shake: 0.018, focus: 0.7,
};

export interface HitContext {
  kind?: DamageKind;
  shielded?: boolean;
  deflected?: boolean;
}

export function impactProfile(ctx: HitContext): ImpactProfile {
  if (ctx.shielded) return SHIELD_HIT;
  if (ctx.deflected) return DEFLECT;
  return IMPACTS[ctx.kind ?? 'shard'];
}

/** Fire one impact's particles. `dir` is the projectile's travel direction. */
export function playImpact(particles: Particles, at: THREE.Vector3, ctx: HitContext, dir?: THREE.Vector3) {
  const p = impactProfile(ctx);
  particles.burst(at, { ...p.burst, focus: p.focus }, dir);
  if (p.flash) particles.burst(at, { ...p.flash, focus: 0 });
}

// --- deaths ---------------------------------------------------------------

/**
 * Death bursts, scaled by tier so a boss dying does not look like a husk
 * dying. Three layers each: hot core, tier-coloured guts, dark shrapnel that
 * falls. The dark layer is what stops a death reading as a flashbulb.
 */
export interface DeathProfile {
  core: number; guts: number; debris: number;
  speed: number; size: number; shake: number;
  /** Seconds of hit-stop. Zero for the small tiers. */
  stop: number;
  /** A flat expanding ring on the ground. Bosses only — it earns its cost. */
  ring: boolean;
}

export const DEATHS: Record<EnemyTier, DeathProfile> = {
  husk: { core: 6, guts: 16, debris: 8, speed: 1.0, size: 1.0, shake: 0.055, stop: 0, ring: false },
  dart: { core: 8, guts: 14, debris: 5, speed: 1.5, size: 0.9, shake: 0.05, stop: 0, ring: false },
  brute: { core: 10, guts: 28, debris: 18, speed: 1.25, size: 1.3, shake: 0.13, stop: 0.035, ring: false },
  warden: { core: 16, guts: 42, debris: 26, speed: 1.5, size: 1.6, shake: 0.24, stop: 0.06, ring: false },
  colossus: { core: 40, guts: 96, debris: 60, speed: 2.3, size: 2.9, shake: 0.75, stop: 0.16, ring: true },
};

export function playDeath(
  particles: Particles,
  at: THREE.Vector3,
  tier: EnemyTier,
  shell: THREE.ColorRepresentation,
  trim: THREE.ColorRepresentation,
) {
  const d = DEATHS[tier];
  // A small, brief white centre only -- enough to say "impact", not enough to
  // become the whole event. The old 22px additive core blew out to a solid
  // disc that hid which tier had just died and where.
  particles.burst(at, {
    count: Math.max(3, Math.round(d.core * 0.4)), color: '#ffffff',
    speed: [1.2 * d.speed, 3.5 * d.speed],
    life: [0.05, 0.1], size: 9 * d.size, gravity: 0,
  });
  particles.burst(at, {
    count: Math.round(d.guts * 1.35), color: trim,
    speed: [3.5 * d.speed, 13 * d.speed],
    life: [0.3, 0.7], size: 11 * d.size, gravity: 9,
  });
  particles.burst(at, {
    count: Math.round(d.debris * 1.4), color: shell,
    speed: [2.5 * d.speed, 9 * d.speed],
    life: [0.4, 0.95], size: 9 * d.size, gravity: 17,
  });
  if (d.ring) {
    // A flat, fast, ground-hugging shock ring. Sold entirely by having almost
    // no vertical speed while everything else in the burst goes up.
    particles.burst(at, {
      count: 64, color: trim, speed: [16, 22], life: [0.3, 0.42], size: 12, gravity: 2.5,
    }, new THREE.Vector3(0, -1, 0));
  }
}

/** Shield collapsing: a bright cyan shell that blows outward and stops. */
export function playShieldBreak(particles: Particles, at: THREE.Vector3, scale = 1) {
  particles.burst(at, {
    count: Math.round(26 * scale), color: '#4fe8ff', speed: [5 * scale, 12 * scale],
    life: [0.24, 0.5], size: 11 * scale, gravity: 3,
  });
  particles.burst(at, {
    count: 8, color: '#bff4ff', speed: [1, 4], life: [0.06, 0.12], size: 13 * scale, gravity: 0,
  });
}

/**
 * One trail bead behind a shot in flight.
 *
 * A lone bright dot arriving at an enemy says nothing about where it came
 * from. A dotted line from a specific tower to a specific enemy is the whole
 * cause-and-effect read of a tower defense, and it is the cheapest possible
 * particle: one per shot per beat, no spread, no gravity, short life.
 */
export function playTrail(particles: Particles, at: THREE.Vector3, color: THREE.ColorRepresentation) {
  particles.burst(at, { count: 1, color, speed: [0, 0.3], life: [0.4, 0.52], size: 8.5, gravity: 0 });
}

/** Muzzle flash at a tower, tinted by what it shoots. */
export function playMuzzle(particles: Particles, at: THREE.Vector3, kind: DamageKind | undefined, dir: THREE.Vector3) {
  const p = IMPACTS[kind ?? 'shard'];
  particles.burst(at, {
    count: 6, color: p.burst.color, speed: [3, 8], life: [0.09, 0.17], size: 11, gravity: 0, focus: 0.85,
  }, dir);
}
