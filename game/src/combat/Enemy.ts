import * as THREE from 'three';
import type { Track } from '../world/Track';

export type EnemyTier = 'husk' | 'brute' | 'warden' | 'colossus';

export interface EnemyArchetype {
  tier: EnemyTier;
  name: string;
  maxHealth: number;
  speed: number;
  /** Reward paid to the player on kill. */
  bounty: number;
  /** Lives lost if it reaches the end of the track. */
  leak: number;
  scale: number;
  shell: THREE.ColorRepresentation;
  trim: THREE.ColorRepresentation;
  /** Tier this one breaks into when destroyed, Bloons-style. */
  splitsInto?: { tier: EnemyTier; count: number };
}

export const ARCHETYPES: Record<EnemyTier, EnemyArchetype> = {
  husk: {
    tier: 'husk', name: 'Cog Husk',
    maxHealth: 10, speed: 3.4, bounty: 4, leak: 1, scale: 0.62,
    shell: '#c86a4a', trim: '#f2c15a',
  },
  brute: {
    tier: 'brute', name: 'Iron Brute',
    maxHealth: 34, speed: 2.6, bounty: 9, leak: 2, scale: 0.86,
    shell: '#7f8fa6', trim: '#ffd76e',
    splitsInto: { tier: 'husk', count: 2 },
  },
  warden: {
    tier: 'warden', name: 'Brass Warden',
    maxHealth: 96, speed: 2.0, bounty: 22, leak: 4, scale: 1.12,
    shell: '#b8863c', trim: '#59e0d0',
    splitsInto: { tier: 'brute', count: 2 },
  },
  colossus: {
    tier: 'colossus', name: 'Gearwood Colossus',
    maxHealth: 620, speed: 1.25, bounty: 140, leak: 12, scale: 1.9,
    shell: '#4d5a6b', trim: '#ff7a4d',
    splitsInto: { tier: 'warden', count: 3 },
  },
};

/**
 * A single enemy walking the track.
 *
 * Position is driven by distance travelled rather than a curve parameter so
 * every tier moves at its stated speed in world units regardless of how the
 * curve's control points are spaced.
 */
export class Enemy {
  readonly group = new THREE.Group();
  readonly archetype: EnemyArchetype;
  health: number;
  distance: number;
  alive = true;
  /** Set when the enemy walked off the end; the battle reads and clears it. */
  leaked = false;

  private readonly body: THREE.Mesh;
  private readonly core: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly hitFlash: THREE.MeshStandardMaterial;
  private flashTimer = 0;
  private readonly spin: number;
  private readonly bobPhase: number;

  private static geoCache = new Map<string, THREE.BufferGeometry>();

  constructor(archetype: EnemyArchetype, startDistance = 0, seed = 0) {
    this.archetype = archetype;
    this.health = archetype.maxHealth;
    this.distance = startDistance;
    this.spin = 1 + (seed % 7) * 0.13;
    this.bobPhase = (seed % 13) * 0.48;

    const s = archetype.scale;

    // Shell: a faceted spheroid. Low segment counts read as deliberate
    // faceting at this scale rather than as a low-poly mistake.
    this.hitFlash = new THREE.MeshStandardMaterial({
      color: archetype.shell,
      roughness: 0.42,
      metalness: 0.55,
      flatShading: true,
    });
    this.body = new THREE.Mesh(Enemy.geo('shell', () => {
      const g = new THREE.IcosahedronGeometry(0.5, 1);
      g.scale(1, 0.92, 1.08);
      return g;
    }), this.hitFlash);
    this.body.castShadow = true;
    this.body.scale.setScalar(s);
    this.group.add(this.body);

    // Glowing core: the damage read. Emissive so it blooms.
    this.core = new THREE.Mesh(
      Enemy.geo('core', () => new THREE.SphereGeometry(0.18, 16, 12)),
      new THREE.MeshStandardMaterial({
        color: archetype.trim,
        emissive: new THREE.Color(archetype.trim),
        emissiveIntensity: 2.4,
        roughness: 0.3,
      }),
    );
    this.core.scale.setScalar(s);
    this.core.position.y = 0.02 * s;
    this.group.add(this.core);

    // Orbiting gear ring — gives the silhouette motion even when the body
    // is a simple blob, and sells the steampunk read.
    this.ring = new THREE.Mesh(
      Enemy.geo('ring', () => new THREE.TorusGeometry(0.62, 0.055, 6, 18)),
      new THREE.MeshStandardMaterial({
        color: archetype.trim,
        roughness: 0.35,
        metalness: 0.85,
        flatShading: true,
      }),
    );
    this.ring.castShadow = true;
    this.ring.scale.setScalar(s);
    this.ring.rotation.x = Math.PI * 0.5;
    this.group.add(this.ring);

    this.group.scale.setScalar(1);
  }

  private static geo(key: string, make: () => THREE.BufferGeometry) {
    let g = Enemy.geoCache.get(key);
    if (!g) { g = make(); Enemy.geoCache.set(key, g); }
    return g;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  /** Fraction of the track covered, 0..1. Used for targeting priority. */
  progress(track: Track): number {
    return this.distance / track.totalLength;
  }

  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    this.flashTimer = 0.09;
    if (this.health <= 0) {
      this.alive = false;
      return true;
    }
    return false;
  }

  update(dt: number, elapsed: number, track: Track) {
    if (!this.alive) return;

    this.distance += this.archetype.speed * dt;
    if (this.distance >= track.totalLength) {
      this.alive = false;
      this.leaked = true;
      return;
    }

    const p = track.pointAtDistance(this.distance);
    const t = track.tangentAtDistance(this.distance);
    const s = this.archetype.scale;

    // Float just above the road with a gentle bob.
    this.group.position.set(p.x, p.y + 0.62 * s + Math.sin(elapsed * 3.1 + this.bobPhase) * 0.06 * s, p.z);
    this.group.lookAt(p.x + t.x, this.group.position.y, p.z + t.z);

    this.ring.rotation.z = elapsed * this.spin * 1.6;
    this.body.rotation.y = elapsed * 0.4 * this.spin;

    // Damage flash: lerp the shell toward white briefly on hit.
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const k = this.flashTimer / 0.09;
      this.hitFlash.emissive.setRGB(k, k, k);
      this.hitFlash.emissiveIntensity = k * 1.6;
    } else if (this.hitFlash.emissiveIntensity !== 0) {
      this.hitFlash.emissiveIntensity = 0;
    }

    // Pulse the core faster as health drops — a readable "about to pop" tell.
    const hp = Math.max(0, this.health / this.archetype.maxHealth);
    const pulse = 1 + Math.sin(elapsed * (6 + (1 - hp) * 14)) * 0.12;
    this.core.scale.setScalar(s * pulse);
  }

  dispose() {
    (this.body.material as THREE.Material).dispose();
    (this.core.material as THREE.Material).dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}
