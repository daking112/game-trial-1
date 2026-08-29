import * as THREE from 'three';
import { buildCreature, type BuiltCreature, type CreatureRig } from './CreatureBuilder';
import { getSpecies, type Species } from './species';

/**
 * A live creature: mesh, rig and the animation state that keeps it alive.
 *
 * The animation budget here is deliberately tiny -- a dozen quaternion sets
 * per creature per frame, no skinning, no morph targets -- because a tower
 * defence map holds thirty of these at once. Everything that reads as life
 * comes from phase offsets and overlapping frequencies rather than from
 * expensive machinery.
 */

export interface CreatureOptions {
  /** Extra phase offset so a row of the same species does not pulse in sync. */
  phase?: number;
  /** Facing in radians about Y. 0 faces +Z. */
  facing?: number;
  position?: THREE.Vector3 | [number, number, number];
  /** Soft contact shadow disc under the feet. */
  contactShadow?: boolean;
}

const ATTACK_DURATION = 0.62;

/** Smooth 0..1 -> 0..1. */
const ease = (x: number) => x * x * (3 - 2 * x);
/** Overshooting ease used for the snap, so the follow-through carries past. */
const back = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.3 * Math.pow(x - 1, 2);

let contactShadowTexture: THREE.Texture | null = null;
function getContactShadowTexture(): THREE.Texture {
  if (contactShadowTexture) return contactShadowTexture;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.34)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  contactShadowTexture = new THREE.CanvasTexture(c);
  contactShadowTexture.colorSpace = THREE.SRGBColorSpace;
  return contactShadowTexture;
}

export class Creature {
  readonly species: Species;
  readonly group: THREE.Group;
  readonly rig: CreatureRig;

  /** 0 = idle, >0 = attack timeline in seconds. */
  private attackT = -1;
  private readonly phase: number;
  private readonly built: BuiltCreature;
  private readonly shadow: THREE.Mesh | null = null;
  private readonly glowBase: number[];
  private disposed = false;

  constructor(species: Species | string, opts: CreatureOptions = {}) {
    this.species = typeof species === 'string' ? getSpecies(species) : species;
    this.built = buildCreature(this.species);
    this.group = this.built.group;
    this.rig = this.built.rig;
    this.phase = opts.phase ?? this.species.shape.seed * 0.017;
    this.glowBase = this.built.glowMaterials.map((m) => m.emissiveIntensity);

    if (opts.position) {
      if (Array.isArray(opts.position)) this.group.position.set(...opts.position);
      else this.group.position.copy(opts.position);
    }
    if (opts.facing !== undefined) this.group.rotation.y = opts.facing;

    if (opts.contactShadow !== false) {
      const r = this.species.shape.height * 0.42;
      const geo = new THREE.PlaneGeometry(r * 2, r * 2);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        map: getContactShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
        color: 0x2a2418,
        blending: THREE.NormalBlending,
      });
      this.shadow = new THREE.Mesh(geo, mat);
      this.shadow.position.y = 0.02;
      this.shadow.renderOrder = -1;
      this.group.add(this.shadow);
    }
  }

  get height(): number {
    return this.built.height;
  }

  /** Start the wind-up. Ignored if an attack is already in flight. */
  playAttack() {
    if (this.attackT < 0) this.attackT = 0;
  }

  get attacking(): boolean {
    return this.attackT >= 0;
  }

  update(dt: number, elapsed: number) {
    if (this.disposed) return;
    const r = this.rig;
    const s = this.species.shape;
    const p = elapsed * 1.0 + this.phase;
    const crouch = s.crouch;

    /* ---- idle ---------------------------------------------------- */
    // Two breathing frequencies an octave apart stop the loop from reading
    // as a metronome; the chest leads the belly by a quarter cycle.
    const breathe = Math.sin(p * 1.9);
    const breathe2 = Math.sin(p * 0.93 + 0.7);
    r.torso.scale.set(
      1 + breathe * 0.022 + breathe2 * 0.008,
      1 + breathe * 0.016,
      1 + breathe * 0.026 + breathe2 * 0.006,
    );
    // Every rotation below is the species' baked rest pose plus the idle
    // motion, never the idle motion alone -- otherwise the first frame of
    // animation throws away the stance the creature was designed to hold.
    const rest = this.rig.rest;
    r.bob.position.y = breathe * 0.014 + breathe2 * 0.006;
    r.bob.rotation.set(
      rest.bob[0] + breathe * 0.012 * (1 - crouch),
      rest.bob[1],
      rest.bob[2] + Math.sin(p * 0.61) * 0.012,
    );

    r.chest.rotation.set(rest.chest[0] - breathe * 0.02, rest.chest[1], rest.chest[2]);

    // Head: slow scan plus a counter-rotation against the bob, which is what
    // reads as the creature holding its head steady while it breathes.
    const scan = Math.sin(p * 0.47 + 1.1);
    r.neck.rotation.set(
      rest.neck[0] - breathe * 0.03 + Math.sin(p * 0.9) * 0.012,
      rest.neck[1],
      rest.neck[2],
    );
    r.head.rotation.set(
      rest.head[0] - (r.bob.rotation.x - rest.bob[0]) * 0.8 + Math.sin(p * 0.73 + 2.0) * 0.035,
      rest.head[1] + scan * 0.16,
      rest.head[2] + scan * 0.05,
    );

    // Blink: a fast, rare squash of the head's vertical scale would look odd,
    // so the jaw does a small chew instead -- cheaper and reads as alive.
    r.jaw.rotation.x = 0.02 + Math.max(0, Math.sin(p * 0.31 - 1.4) - 0.93) * 2.4;

    const earSway = Math.sin(p * 1.35 + 0.4);
    r.earL.rotation.z = earSway * 0.09;
    r.earR.rotation.z = -earSway * 0.09;
    r.earL.rotation.x = Math.sin(p * 1.1) * 0.06;
    r.earR.rotation.x = Math.sin(p * 1.1 + 0.5) * 0.06;
    r.crest.rotation.x = Math.sin(p * 0.85 + 1.2) * 0.045;
    r.crest.rotation.z = Math.sin(p * 0.66) * 0.03;

    for (let i = 0; i < r.tail.length; i++) {
      // Travelling wave: each segment lags the one before it, so the tail
      // whips rather than swinging as a rigid bar. Amplitude and lag are
      // baked per segment at build time -- a five-link tail and a ten-link
      // serpent body need completely different numbers, and a drifter's
      // streamers each restart the phase.
      const lag = r.tailLag[i] ?? i * 0.55;
      const amp = r.tailAmp[i] ?? 0.10 + i * 0.035;
      r.tail[i].rotation.y = Math.sin(p * 1.25 - lag) * amp;
      r.tail[i].rotation.x = Math.sin(p * 0.95 - lag * 0.8) * amp * 0.45;
    }

    if (r.armL && r.armR) {
      const swing = Math.sin(p * 1.05);
      r.armL.rotation.set(rest.armL[0] + swing * 0.06, rest.armL[1], rest.armL[2] + 0.04 + swing * 0.035);
      r.armR.rotation.set(rest.armR[0] - swing * 0.06, rest.armR[1], rest.armR[2] - 0.04 - swing * 0.035);
    }
    if (r.wingL && r.wingR) {
      const flap = Math.sin(p * 0.72);
      const fx = Math.sin(p * 0.72 + 0.4) * 0.05;
      r.wingL.rotation.set(rest.wingL[0] + fx, rest.wingL[1], rest.wingL[2] + flap * 0.09);
      r.wingR.rotation.set(rest.wingR[0] + fx, rest.wingR[1], rest.wingR[2] - flap * 0.09);
    }

    // Element glow breathes on its own, slower rhythm.
    const pulse = 0.85 + 0.15 * Math.sin(p * 1.6);
    for (let i = 0; i < this.built.glowMaterials.length; i++) {
      this.built.glowMaterials[i].emissiveIntensity = this.glowBase[i] * pulse;
    }

    /* ---- attack -------------------------------------------------- */
    if (this.attackT >= 0) {
      this.attackT += dt;
      const u = this.attackT / ATTACK_DURATION;
      if (u >= 1) {
        this.attackT = -1;
      } else {
        this.applyAttack(u);
      }
    }
  }

  /**
   * Wind-up, snap, recover.
   *
   * The whole point is the anticipation: for the first 38% the creature
   * pulls *away* from its target and compresses. Without that the strike
   * has nothing to release and reads as a twitch.
   */
  private applyAttack(u: number) {
    const r = this.rig;
    let lean: number;
    let compress: number;
    let jawOpen: number;
    let armSwing: number;

    if (u < 0.38) {
      const w = ease(u / 0.38);
      lean = -0.34 * w;
      compress = 0.10 * w;
      jawOpen = 0.16 * w;
      armSwing = -0.9 * w;
    } else if (u < 0.56) {
      const w = back((u - 0.38) / 0.18);
      lean = THREE.MathUtils.lerp(-0.34, 0.46, w);
      compress = THREE.MathUtils.lerp(0.10, -0.07, w);
      jawOpen = THREE.MathUtils.lerp(0.16, 0.72, w);
      armSwing = THREE.MathUtils.lerp(-0.9, 1.15, w);
    } else {
      const w = ease((u - 0.56) / 0.44);
      lean = THREE.MathUtils.lerp(0.46, 0, w);
      compress = THREE.MathUtils.lerp(-0.07, 0, w);
      jawOpen = THREE.MathUtils.lerp(0.72, 0, w);
      armSwing = THREE.MathUtils.lerp(1.15, 0, w);
    }

    r.bob.rotation.x += lean * 0.55;
    r.bob.position.y += -compress * 0.12;
    r.torso.scale.x *= 1 + compress * 0.5;
    r.torso.scale.y *= 1 - compress * 0.8;
    r.torso.scale.z *= 1 + compress * 0.4;
    r.chest.rotation.x += lean * 0.5;
    r.neck.rotation.x += lean * 0.5;
    r.head.rotation.x += lean * 0.7;
    r.jaw.rotation.x += jawOpen;

    if (r.armL && r.armR) {
      r.armL.rotation.x += armSwing;
      r.armR.rotation.x += armSwing;
      if (r.foreL) r.foreL.rotation.x += armSwing * 0.5;
      if (r.foreR) r.foreR.rotation.x += armSwing * 0.5;
    }
    if (r.wingL && r.wingR) {
      r.wingL.rotation.z += -armSwing * 0.35;
      r.wingR.rotation.z += armSwing * 0.35;
    }
    for (let i = 0; i < r.tail.length; i++) {
      const k = (r.tailAmp[i] ?? 0.1) * 3.2;
      r.tail[i].rotation.x += -lean * Math.min(0.9, 0.35 + k);
    }
    r.crest.rotation.x += -lean * 0.5;
    r.earL.rotation.x += -lean * 0.6;
    r.earR.rotation.x += -lean * 0.6;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const g of this.built.geometries) g.dispose();
    for (const m of this.built.materials) m.dispose();
    if (this.shadow) {
      this.shadow.geometry.dispose();
      (this.shadow.material as THREE.Material).dispose();
    }
  }
}
