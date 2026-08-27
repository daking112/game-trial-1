import * as THREE from 'three';
import type { Enemy } from './Enemy';

export interface ProjectileSpec {
  speed: number;
  damage: number;
  color: THREE.ColorRepresentation;
  /** Radius of splash damage; 0 for single target. */
  splash?: number;
  /** Arc height for lobbed shots; 0 for flat. */
  arc?: number;
}

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

  private target: Enemy | null = null;
  private spec: ProjectileSpec | null = null;
  private travelled = 0;
  private readonly from = new THREE.Vector3();
  private life = 0;

  constructor(shared: THREE.BufferGeometry) {
    this.mesh = new THREE.Mesh(
      shared,
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 3.0,
        roughness: 0.25,
        transparent: true,
      }),
    );
    this.mesh.visible = false;
    this.mesh.castShadow = false;
  }

  fire(origin: THREE.Vector3, target: Enemy, spec: ProjectileSpec) {
    this.active = true;
    this.target = target;
    this.spec = spec;
    this.travelled = 0;
    this.life = 0;
    this.from.copy(origin);
    this.mesh.position.copy(origin);
    this.mesh.visible = true;
    const m = this.mesh.material as THREE.MeshStandardMaterial;
    m.color.set(spec.color);
    m.emissive.set(spec.color);
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

    const to = this.target.position;
    const dir = new THREE.Vector3().subVectors(to, this.mesh.position);
    const dist = dir.length();
    const stepLen = this.spec.speed * dt;

    if (dist <= Math.max(stepLen, 0.35)) {
      const hit = this.target;
      this.retire();
      return hit;
    }

    dir.divideScalar(dist);
    this.mesh.position.addScaledVector(dir, stepLen);
    this.travelled += stepLen;

    // Lob: offset upward along a parabola over the flight.
    if (this.spec.arc) {
      const total = this.travelled + dist;
      const k = total > 0 ? this.travelled / total : 0;
      this.mesh.position.y += Math.sin(k * Math.PI) * this.spec.arc * dt * 6;
    }

    // Stretch along the direction of travel — a round dot reads as a bug,
    // a streak reads as speed.
    this.mesh.lookAt(to);
    this.mesh.scale.set(1, 1, 1 + Math.min(this.spec.speed * 0.06, 2.2));
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

/** Fixed-size pool so combat never allocates mid-frame. */
export class ProjectilePool {
  readonly group = new THREE.Group();
  private readonly pool: Projectile[] = [];
  private readonly geo: THREE.BufferGeometry;

  constructor(size = 160) {
    this.geo = new THREE.SphereGeometry(0.13, 10, 8);
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
  update(dt: number): Array<{ enemy: Enemy; spec: ProjectileSpec; at: THREE.Vector3 }> {
    const hits: Array<{ enemy: Enemy; spec: ProjectileSpec; at: THREE.Vector3 }> = [];
    for (const p of this.pool) {
      if (!p.active) continue;
      const at = p.mesh.position.clone();
      const spec = (p as unknown as { spec: ProjectileSpec }).spec;
      const enemy = p.update(dt);
      if (enemy) hits.push({ enemy, spec, at });
    }
    return hits;
  }

  dispose() {
    for (const p of this.pool) p.dispose();
    this.geo.dispose();
  }
}
