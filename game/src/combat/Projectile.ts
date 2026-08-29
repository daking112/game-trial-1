import * as THREE from 'three';
import type { Enemy, DamageKind } from './Enemy';

export interface ProjectileSpec {
  speed: number;
  damage: number;
  color: THREE.ColorRepresentation;
  /** Which element fired it. Drives the shot's shape, its impact and its sound. */
  kind?: DamageKind;
  /** Radius of splash damage; 0 for single target. */
  splash?: number;
  /** Arc height for lobbed shots; 0 for flat. */
  arc?: number;
}

/** Per-element shot shape. A seed and a bolt must not read as the same dot. */
interface ShotLook {
  /** Radius multiplier. */
  girth: number;
  /** Extra stretch along travel, on top of the speed-derived stretch. */
  streak: number;
  emissive: number;
  /** Spin about the travel axis. */
  spin: number;
}

const LOOKS: Record<DamageKind, ShotLook> = {
  seed: { girth: 1.25, streak: 0.6, emissive: 2.2, spin: 7 },
  ember: { girth: 1.15, streak: 1.1, emissive: 4.2, spin: 0 },
  jet: { girth: 0.95, streak: 2.0, emissive: 2.6, spin: 0 },
  bolt: { girth: 0.55, streak: 5.5, emissive: 5.5, spin: 22 },
  shard: { girth: 0.7, streak: 3.2, emissive: 3.0, spin: 14 },
};
const DEFAULT_LOOK: ShotLook = { girth: 1, streak: 1, emissive: 3, spin: 0 };

/**
 * Pooled projectile.
 *
 * Homing is deliberate rather than predictive: shots curve toward the target's
 * live position so a fast enemy can visibly outrun a slow shot. That is a
 * readable, learnable rule; perfect interception reads as the game cheating.
 */
export class Projectile {
  readonly mesh: THREE.Mesh;
  active = false;
  /** Unit vector of travel on the frame it landed; the impact fans along it. */
  readonly heading = new THREE.Vector3(0, 0, -1);
  spec: ProjectileSpec | null = null;

  private target: Enemy | null = null;
  private look: ShotLook = DEFAULT_LOOK;
  private travelled = 0;
  private readonly from = new THREE.Vector3();
  private life = 0;
  private roll = 0;

  constructor(shared: THREE.BufferGeometry) {
    this.mesh = new THREE.Mesh(
      shared,
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 3.0,
        roughness: 0.25,
        transparent: true,
        toneMapped: false,
      }),
    );
    this.mesh.visible = false;
    this.mesh.castShadow = false;
  }

  fire(origin: THREE.Vector3, target: Enemy, spec: ProjectileSpec) {
    this.active = true;
    this.target = target;
    this.spec = spec;
    this.look = spec.kind ? LOOKS[spec.kind] : DEFAULT_LOOK;
    this.travelled = 0;
    this.life = 0;
    this.roll = 0;
    this.from.copy(origin);
    this.mesh.position.copy(origin);
    this.mesh.visible = true;
    const m = this.mesh.material as THREE.MeshStandardMaterial;
    m.color.set(spec.color);
    m.emissive.set(spec.color);
    m.emissiveIntensity = this.look.emissive;
    m.opacity = 1;
    this.mesh.scale.setScalar(1);
  }

  /** Returns the enemy it struck this frame, or null. */
  update(dt: number): Enemy | null {
    if (!this.active || !this.spec) return null;

    this.life += dt;
    // Retire strays: the target died mid-flight, or the shot has been alive
    // long enough that it has clearly missed.
    if (!this.target || !this.target.alive || this.life > 4) {
      this.retire();
      return null;
    }

    // Aim at the body's mass, not its feet, so impacts land on the mesh.
    const to = _to.copy(this.target.position).setY(this.target.centreY);
    const dir = _dir.subVectors(to, this.mesh.position);
    const dist = dir.length();
    const stepLen = this.spec.speed * dt;

    if (dist <= Math.max(stepLen, 0.35)) {
      if (dist > 1e-4) this.heading.copy(dir).divideScalar(dist);
      const hit = this.target;
      this.retire();
      return hit;
    }

    dir.divideScalar(dist);
    this.heading.copy(dir);
    this.mesh.position.addScaledVector(dir, stepLen);
    this.travelled += stepLen;

    // Lob: offset upward along a parabola over the flight.
    if (this.spec.arc) {
      const total = this.travelled + dist;
      const k = total > 0 ? this.travelled / total : 0;
      this.mesh.position.y += Math.sin(k * Math.PI) * this.spec.arc * dt * 6;
    }

    // Stretch along the direction of travel — a round dot reads as a bug,
    // a streak reads as speed — and thicken or thin it by element.
    this.mesh.lookAt(to);
    if (this.look.spin) {
      this.roll += dt * this.look.spin;
      this.mesh.rotateZ(this.roll);
    }
    const g = this.look.girth;
    this.mesh.scale.set(g, g, g * (1 + Math.min(this.spec.speed * 0.06, 2.2)) * this.look.streak);
    return null;
  }

  retire() {
    this.active = false;
    this.target = null;
    this.mesh.visible = false;
  }

  dispose() {
    (this.mesh.material as THREE.Material).dispose();
  }
}

const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();

export interface ProjectileHit {
  enemy: Enemy;
  spec: ProjectileSpec;
  at: THREE.Vector3;
  /** Direction of travel, for fanning the impact the way the shot was going. */
  heading: THREE.Vector3;
}

/** Fixed-size pool so combat never allocates mid-frame. */
export class ProjectilePool {
  readonly group = new THREE.Group();
  private readonly pool: Projectile[] = [];
  private readonly geo: THREE.BufferGeometry;

  constructor(size = 160) {
    this.geo = new THREE.SphereGeometry(0.15, 10, 8);
    for (let i = 0; i < size; i++) {
      const p = new Projectile(this.geo);
      this.pool.push(p);
      this.group.add(p.mesh);
    }
  }

  fire(origin: THREE.Vector3, target: Enemy, spec: ProjectileSpec): boolean {
    for (const p of this.pool) {
      if (!p.active) { p.fire(origin, target, spec); return true; }
    }
    return false; // pool exhausted; dropping a shot beats stuttering
  }

  /** Steps every live projectile, returning the hits that landed. */
  update(dt: number): ProjectileHit[] {
    const hits: ProjectileHit[] = [];
    for (const p of this.pool) {
      if (!p.active) continue;
      const at = p.mesh.position.clone();
      const spec = p.spec!;
      const enemy = p.update(dt);
      if (enemy) hits.push({ enemy, spec, at, heading: p.heading.clone() });
    }
    return hits;
  }

  dispose() {
    for (const p of this.pool) p.dispose();
    this.geo.dispose();
  }
}
