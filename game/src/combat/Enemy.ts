import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '../world/Track';

/**
 * Enemy tiers.
 *
 * The set is a *language*, not a list. Each tier owns one silhouette family,
 * one hue and one rule, and nothing shares two of the three:
 *
 *   husk      round      orange    plain, dies easily
 *   dart      wedge      magenta   very fast, very fragile
 *   brute     box        steel     armoured: flat reduction on every hit
 *   warden    tower+ring brass     shielded: a cyan ring eats damage, then pops
 *   colossus  crowned    violet    boss: armoured, shielded, splits three ways
 *
 * Hue matters more than shape at the `overview` camera, where an enemy is
 * fifteen pixels tall. Not one tier is green: the board is a green forest, and
 * anything green on it disappears.
 */
export type EnemyTier = 'husk' | 'dart' | 'brute' | 'warden' | 'colossus';

/** Which creature element hit it. Drives impact colour, particles and sound. */
export type DamageKind = 'seed' | 'ember' | 'jet' | 'bolt' | 'shard';

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
  /** Flat damage subtracted from every hit. A minimum of 1 always lands. */
  armour?: number;
  /** Absorbing shell soaked before health is touched. Pops visibly. */
  shield?: number;
  /** Tier this one breaks into when destroyed, Bloons-style. */
  splitsInto?: { tier: EnemyTier; count: number };
  boss?: boolean;
}

export const ARCHETYPES: Record<EnemyTier, EnemyArchetype> = {
  husk: {
    tier: 'husk', name: 'Cog Husk',
    maxHealth: 10, speed: 4.9, bounty: 4, leak: 1, scale: 1.38,
    shell: '#ff5a12', trim: '#ffe24a',
  },
  dart: {
    tier: 'dart', name: 'Sparkdart',
    maxHealth: 12, speed: 8.4, bounty: 6, leak: 1, scale: 1.24,
    shell: '#ff1a86', trim: '#ffd0ec',
  },
  brute: {
    tier: 'brute', name: 'Iron Brute',
    maxHealth: 34, speed: 3.5, bounty: 10, leak: 2, scale: 1.9,
    shell: '#cfe2ff', trim: '#1d2b45', armour: 2,
    splitsInto: { tier: 'husk', count: 2 },
  },
  warden: {
    tier: 'warden', name: 'Brass Warden',
    maxHealth: 66, speed: 2.8, bounty: 22, leak: 3, scale: 2.15,
    shell: '#ffb61f', trim: '#39f0ff', shield: 30,
    splitsInto: { tier: 'brute', count: 2 },
  },
  colossus: {
    tier: 'colossus', name: 'Gearwood Colossus',
    maxHealth: 700, speed: 2.0, bounty: 160, leak: 12, scale: 3.9,
    shell: '#8b3ce0', trim: '#ff7a10', armour: 4, shield: 260, boss: true,
    splitsInto: { tier: 'warden', count: 3 },
  },
};

/** Impact tint per element, used for the body flash. Mirrors `fx/Impacts`. */
const KIND_FLASH: Record<DamageKind, THREE.Color> = {
  seed: new THREE.Color('#b6ff5e'),
  ember: new THREE.Color('#ff8a2e'),
  jet: new THREE.Color('#57e6ff'),
  bolt: new THREE.Color('#e8c4ff'),
  shard: new THREE.Color('#ffffff'),
};

// --- geometry kit ---------------------------------------------------------

interface Part {
  geo: THREE.BufferGeometry;
  color: THREE.ColorRepresentation;
  /** 0 = lit surface, 1 = self-lit. Drives the emissive injection below. */
  emit?: number;
}

/**
 * Stamp colour and emissive weight onto a part, then merge the lot into one
 * buffer. One draw call per enemy is the whole point: thirty enemies with four
 * meshes each is a hundred and twenty draw calls of nothing but overhead.
 */
function assemble(parts: Part[]): THREE.BufferGeometry {
  const prepared: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    // Polyhedra come out of three non-indexed and the primitives come out
    // indexed; mergeGeometries refuses a mixture, so everything is flattened.
    // Flat shading wants the duplicated vertices anyway.
    let g = p.geo;
    if (g.index) { const flat = g.toNonIndexed(); g.dispose(); g = flat; }
    // mergeGeometries demands identical attribute sets across inputs.
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const emit = new Float32Array(n);
    const c = new THREE.Color(p.color);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      emit[i] = p.emit ?? 0;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aEmit', new THREE.BufferAttribute(emit, 1));
    g.deleteAttribute('tangent');
    prepared.push(g);
  }
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  if (!merged) throw new Error('enemy geometry merge failed');
  merged.computeBoundingSphere();
  return merged;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/**
 * Tier geometry. Everything is authored facing **-Z**, because `lookAt` points
 * an object's -Z at its target and enemies look down the track.
 *
 * Every body sits with its feet at y=0 so the ground marker, the shadow and
 * the mesh all agree about where the road is. Floating blobs were the single
 * biggest reason the old enemies read as decals rather than as things.
 */
function buildTier(tier: EnemyTier, a: EnemyArchetype): THREE.BufferGeometry {
  const shell = a.shell, trim = a.trim;
  const parts: Part[] = [];

  if (tier === 'husk') {
    // Round. The baseline everything else is read against.
    const b = new THREE.IcosahedronGeometry(0.46, 1); b.scale(1, 0.9, 1.06);
    parts.push({ geo: at(b, 0, 0.5, 0), color: shell });
    // Waist gear: the steampunk tell, and it widens the silhouette.
    parts.push({ geo: at(new THREE.TorusGeometry(0.44, 0.075, 5, 12), 0, 0.48, 0, Math.PI / 2), color: trim });
    // Two forward horns break the circle so it is not a bare ball.
    for (const s of [-1, 1]) {
      parts.push({ geo: at(new THREE.ConeGeometry(0.1, 0.34, 5), s * 0.24, 0.86, -0.1, -0.5, 0, s * 0.42), color: trim });
    }
    // Stub feet: contact with the road.
    for (const s of [-1, 1]) parts.push({ geo: at(box(0.16, 0.2, 0.24), s * 0.2, 0.1, 0), color: '#3a2418' });
    // Eye core, front and centre.
    parts.push({ geo: at(new THREE.SphereGeometry(0.15, 10, 8), 0, 0.54, -0.36), color: trim, emit: 1 });
  }

  if (tier === 'dart') {
    // Wedge. Nose down the track, everything swept backwards: reads as speed
    // even in a still frame.
    const hull = new THREE.ConeGeometry(0.3, 1.15, 6);
    parts.push({ geo: at(hull, 0, 0.52, -0.12, -Math.PI / 2), color: shell });
    for (const s of [-1, 1]) {
      const fin = box(0.05, 0.42, 0.5); fin.translate(0, 0.1, 0);
      parts.push({ geo: at(fin, s * 0.22, 0.52, 0.3, 0, 0, s * 0.5), color: trim });
    }
    // Dorsal blade.
    parts.push({ geo: at(box(0.05, 0.34, 0.44), 0, 0.78, 0.22, 0.35), color: trim });
    // Rear thruster: the bright end is at the back, so the dark nose leads.
    parts.push({ geo: at(new THREE.SphereGeometry(0.19, 10, 8), 0, 0.52, 0.44), color: trim, emit: 1 });
    parts.push({ geo: at(cyl(0.06, 0.14, 0.5, 6), 0, 0.16, 0.1, 0, 0, 0), color: '#4a1030' });
  }

  if (tier === 'brute') {
    // Box. Wide, flat-topped, plainly heavier than anything round.
    parts.push({ geo: at(box(0.86, 0.66, 0.74), 0, 0.62, 0), color: shell });
    // Shoulder plates in the dark trim: the armour read.
    for (const s of [-1, 1]) parts.push({ geo: at(box(0.22, 0.5, 0.66), s * 0.53, 0.7, 0.02), color: trim });
    // Angled brow slab over the face.
    parts.push({ geo: at(box(0.8, 0.26, 0.3), 0, 0.86, -0.3, -0.42), color: trim });
    // Rivets. Four is enough to say "bolted plate" at this size.
    for (const s of [-1, 1]) for (const z of [-0.22, 0.22]) {
      parts.push({ geo: at(new THREE.SphereGeometry(0.06, 6, 5), s * 0.44, 0.92, z), color: '#e9f2ff' });
    }
    // Legs.
    for (const s of [-1, 1]) for (const z of [-0.22, 0.24]) {
      parts.push({ geo: at(box(0.18, 0.3, 0.2), s * 0.3, 0.15, z), color: '#1a2438' });
    }
    // Visor slot rather than an eye: a machine, not a creature.
    parts.push({ geo: at(box(0.52, 0.1, 0.06), 0, 0.62, -0.4), color: '#ff4d3d', emit: 1 });
  }

  if (tier === 'warden') {
    // Tower. Tall and narrow, the opposite of the brute at the same distance.
    parts.push({ geo: at(cyl(0.34, 0.42, 1.0, 8), 0, 0.62, 0), color: shell });
    parts.push({ geo: at(cyl(0.46, 0.46, 0.14, 8), 0, 1.14, 0), color: '#7a4d12' });
    parts.push({ geo: at(cyl(0.5, 0.5, 0.12, 8), 0, 0.2, 0), color: '#7a4d12' });
    // Crown spikes.
    for (let i = 0; i < 6; i++) {
      const th = (i / 6) * Math.PI * 2;
      parts.push({
        geo: at(new THREE.ConeGeometry(0.07, 0.3, 4), Math.cos(th) * 0.34, 1.3, Math.sin(th) * 0.34),
        color: '#7a4d12',
      });
    }
    // Vertical core bar: at overview this is the brightest pixel on the tier.
    parts.push({ geo: at(box(0.16, 0.62, 0.1), 0, 0.68, -0.36), color: trim, emit: 1 });
  }

  if (tier === 'colossus') {
    // Crowned. Every other tier is one mass; the boss is a stack of three.
    const core = new THREE.DodecahedronGeometry(0.62, 0);
    parts.push({ geo: at(core, 0, 0.86, 0), color: shell });
    parts.push({ geo: at(cyl(0.62, 0.8, 0.4, 8), 0, 0.24, 0), color: '#3d2260' });
    // Pauldrons.
    for (const s of [-1, 1]) {
      parts.push({ geo: at(new THREE.IcosahedronGeometry(0.34, 0), s * 0.72, 1.0, 0), color: '#3d2260' });
    }
    // Crown of hot spikes: the boss silhouette, visible over any crowd.
    for (let i = 0; i < 8; i++) {
      const th = (i / 8) * Math.PI * 2;
      const tall = i % 2 === 0 ? 0.78 : 0.5;
      parts.push({
        geo: at(new THREE.ConeGeometry(0.11, tall, 4), Math.cos(th) * 0.44, 1.5 + tall * 0.4, Math.sin(th) * 0.44,
          0, 0, -Math.cos(th) * 0.22),
        color: trim, emit: 0.55,
      });
    }
    // Furnace eye.
    parts.push({ geo: at(new THREE.SphereGeometry(0.3, 12, 10), 0, 0.9, -0.5), color: trim, emit: 1 });
    // Feet.
    for (const s of [-1, 1]) parts.push({ geo: at(box(0.36, 0.26, 0.5), s * 0.42, 0.13, 0), color: '#241040' });
  }

  const g = assemble(parts);
  g.scale(a.scale, a.scale, a.scale);
  return g;
}

// --- material -------------------------------------------------------------

interface EnemyUniforms {
  uFlash: { value: number };
  uFlashColor: { value: THREE.Color };
  uCore: { value: number };
}

/**
 * Defined once at module scope so every enemy material stringifies to the same
 * `onBeforeCompile`, and three therefore compiles and caches one program for
 * all of them instead of one per enemy.
 */
const patch = (u: EnemyUniforms) => (shader: THREE.WebGLProgramParametersWithUniforms) => {
  shader.uniforms.uFlash = u.uFlash;
  shader.uniforms.uFlashColor = u.uFlashColor;
  shader.uniforms.uCore = u.uCore;
  shader.vertexShader = 'attribute float aEmit;\nvarying float vEmit;\n' +
    shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vEmit = aEmit;');
  shader.fragmentShader =
    'uniform float uFlash;\nuniform vec3 uFlashColor;\nuniform float uCore;\nvarying float vEmit;\n' +
    shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       totalEmissiveRadiance += vColor * vEmit * uCore;
       // Floor: the board is a shadowed forest and an unlit enemy on it is a
       // dark blob. This lifts every tier's own colour out of shade without
       // touching its shading, so silhouette and hue survive the canopy.
       totalEmissiveRadiance += vColor * 0.17;
       totalEmissiveRadiance += uFlashColor * uFlash;`,
    );
};

function enemyMaterial(): THREE.MeshStandardMaterial {
  const u: EnemyUniforms = {
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color('#ffffff') },
    uCore: { value: 2.2 },
  };
  const m = new THREE.MeshStandardMaterial({
    color: '#ffffff', vertexColors: true, roughness: 0.44, metalness: 0.5, flatShading: true,
  });
  m.onBeforeCompile = patch(u);
  m.userData.u = u;
  return m;
}

// --- ground markers -------------------------------------------------------

/**
 * Every live enemy's tier ring, in one instanced draw call.
 *
 * A saturated ring on the dark road is what makes thirty enemies countable
 * from the `overview` camera: the bodies are fifteen pixels of shaded mesh, but
 * the rings are flat, unshaded and unambiguous, and they say tier by colour
 * before the shape resolves at all.
 */
export class EnemyMarkers {
  readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();

  constructor(capacity = 96) {
    const geo = new THREE.RingGeometry(0.6, 0.95, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: false, transparent: true, opacity: 1.0,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.count = 0;
  }

  sync(enemies: Enemy[]) {
    const cap = this.mesh.instanceMatrix.count;
    let i = 0;
    for (const e of enemies) {
      if (i >= cap) break;
      if (!e.alive) continue;
      const s = e.markerRadius;
      this.dummy.position.set(e.group.position.x, e.groundY + 0.09, e.group.position.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(s, 1, s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, e.markerColor);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// --- enemy ----------------------------------------------------------------

export interface DamageResult {
  killed: boolean;
  /** Damage that landed on the shield rather than on health. */
  shielded: boolean;
  /** The shield ran out on this hit. */
  shieldBroke: boolean;
  /** Armour swallowed most of the hit. Drives the "clank" read. */
  deflected: boolean;
  dealt: number;
}

export class Enemy {
  readonly group = new THREE.Group();
  readonly archetype: EnemyArchetype;
  health: number;
  shield: number;
  distance: number;
  alive = true;
  /** Set when the enemy walked off the end; the battle reads and clears it. */
  leaked = false;
  /** Counts down while the corpse plays its pop. */
  deathAge = -1;

  /** Road height under the enemy, for markers and the death burst. */
  groundY = 0;
  readonly markerColor = new THREE.Color();
  markerRadius = 1;

  private readonly chassis: THREE.Mesh;
  private readonly shieldMesh: THREE.Mesh | null = null;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly u: EnemyUniforms;
  private flashTimer = 0;
  private flashLen = 0.1;
  private readonly gait: number;
  private readonly phase: number;
  private hoverBase: number;

  private static geoCache = new Map<EnemyTier, THREE.BufferGeometry>();
  private static shieldGeo: THREE.BufferGeometry | null = null;

  constructor(archetype: EnemyArchetype, startDistance = 0, seed = 0) {
    this.archetype = archetype;
    this.health = archetype.maxHealth;
    this.shield = archetype.shield ?? 0;
    this.distance = startDistance;
    this.gait = 1 + ((seed * 7) % 11) * 0.06;
    this.phase = ((seed * 13) % 17) * 0.37;
    this.markerColor.set(archetype.shell);
    this.markerRadius = archetype.scale * (archetype.boss ? 1.15 : 0.86);
    // Darts skim; everything else walks.
    this.hoverBase = archetype.tier === 'dart' ? 0.34 * archetype.scale : 0;

    let geo = Enemy.geoCache.get(archetype.tier);
    if (!geo) { geo = buildTier(archetype.tier, archetype); Enemy.geoCache.set(archetype.tier, geo); }

    this.mat = enemyMaterial();
    this.u = this.mat.userData.u as EnemyUniforms;
    this.chassis = new THREE.Mesh(geo, this.mat);
    this.chassis.castShadow = true;
    this.group.add(this.chassis);

    if (archetype.shield) {
      if (!Enemy.shieldGeo) {
        // An octagonal band, not a smooth torus: facets catch the key light
        // and flicker as it turns, which is what says "energy" at distance.
        const g = new THREE.TorusGeometry(0.78, 0.1, 4, 8);
        g.rotateX(Math.PI / 2);
        Enemy.shieldGeo = g;
      }
      this.shieldMesh = new THREE.Mesh(Enemy.shieldGeo, new THREE.MeshStandardMaterial({
        color: archetype.trim,
        emissive: new THREE.Color(archetype.trim),
        emissiveIntensity: 1.9,
        transparent: true, opacity: 0.78, roughness: 0.2, metalness: 0.1,
        flatShading: true, depthWrite: false,
      }));
      this.shieldMesh.scale.setScalar(archetype.scale);
      this.shieldMesh.position.y = (archetype.boss ? 0.95 : 0.66) * archetype.scale;
      this.shieldMesh.renderOrder = 4;
      this.group.add(this.shieldMesh);
    }
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  /** Fraction of the track covered, 0..1. Used for targeting priority. */
  progress(track: Track): number {
    return this.distance / track.totalLength;
  }

  /** Height of the body's centre of mass — where impacts should land. */
  get centreY(): number {
    return this.group.position.y + 0.62 * this.archetype.scale;
  }

  get healthFraction(): number {
    return Math.max(0, this.health / this.archetype.maxHealth);
  }

  /** Remaining shield as 0..1, or 0 for a tier that never had one. */
  get shieldFraction(): number {
    const max = this.archetype.shield ?? 0;
    return max > 0 ? Math.max(0, this.shield / max) : 0;
  }

  /**
   * World height just above the tallest point of the body, in world units.
   *
   * The anchor a UI layer should project for a health bar: it already accounts
   * for tier scale and for the dart's hover, so a bar pinned here clears the
   * head of a Colossus and does not float over a Husk.
   */
  get topY(): number {
    return this.group.position.y + (this.archetype.boss ? 2.4 : 1.55) * this.archetype.scale;
  }

  takeDamage(amount: number, kind?: DamageKind): DamageResult {
    const out: DamageResult = { killed: false, shielded: false, shieldBroke: false, deflected: false, dealt: 0 };
    if (!this.alive) return out;

    // Armour is flat, not proportional, so it punishes fast weak shots and
    // barely troubles a heavy one. That is a rule a player can learn by
    // watching two towers shoot the same brute.
    let dmg = amount;
    const armour = this.archetype.armour ?? 0;
    if (armour > 0) {
      const reduced = Math.max(amount * 0.15, amount - armour);
      out.deflected = reduced < amount * 0.55;
      dmg = reduced;
    }

    if (this.shield > 0) {
      out.shielded = true;
      this.shield -= dmg;
      if (this.shield <= 0) {
        // Overkill carries through, so a big hit is never wasted on the last
        // point of shield.
        dmg = -this.shield;
        this.shield = 0;
        out.shieldBroke = true;
        if (this.shieldMesh) this.shieldMesh.visible = false;
      } else {
        dmg = 0;
      }
    }

    this.health -= dmg;
    out.dealt = dmg;
    this.flash(kind, out.shielded && !out.shieldBroke);

    if (this.health <= 0) {
      this.alive = false;
      this.deathAge = 0;
      out.killed = true;
    }
    return out;
  }

  private flash(kind: DamageKind | undefined, onShield: boolean) {
    this.flashTimer = onShield ? 0.07 : 0.11;
    this.flashLen = this.flashTimer;
    const c = onShield
      ? KIND_FLASH.jet
      : (kind ? KIND_FLASH[kind] : KIND_FLASH.shard);
    this.u.uFlashColor.value.copy(c);
  }

  update(dt: number, elapsed: number, track: Track) {
    if (!this.alive) { this.updateDeath(dt); return; }

    this.distance += this.archetype.speed * dt;
    if (this.distance >= track.totalLength) {
      this.alive = false;
      this.deathAge = 1e9; // reaped immediately, no pop
      this.leaked = true;
      return;
    }

    const p = track.pointAtDistance(this.distance);
    const t = track.tangentAtDistance(this.distance);
    const s = this.archetype.scale;
    this.groundY = p.y;

    // Planted, not floating: the mesh's feet are at group y, so the enemy
    // stands on the road it is walking down.
    const step = elapsed * this.gait * (this.archetype.speed * 0.9) + this.phase;
    const bob = Math.abs(Math.sin(step)) * 0.07 * s;
    this.group.position.set(p.x, p.y + this.hoverBase + bob, p.z);
    this.group.lookAt(p.x + t.x, this.group.position.y, p.z + t.z);

    // A waddle roll and a forward lean. Both are tiny; both are the difference
    // between a walking thing and a sliding decal.
    this.chassis.rotation.z = Math.sin(step) * (this.archetype.tier === 'brute' ? 0.11 : 0.055);
    this.chassis.rotation.x = this.archetype.tier === 'dart' ? -0.22 : Math.sin(step * 2) * 0.03;

    if (this.shieldMesh && this.shield > 0) {
      this.shieldMesh.rotation.y = elapsed * 1.9;
      this.shieldMesh.rotation.z = Math.sin(elapsed * 1.3 + this.phase) * 0.22;
      const frac = this.shield / (this.archetype.shield || 1);
      // The shield thins visibly as it is spent, so "nearly through" is a
      // thing the player sees rather than infers.
      const m = this.shieldMesh.material as THREE.MeshStandardMaterial;
      m.opacity = 0.28 + frac * 0.55;
      m.emissiveIntensity = 0.7 + frac * 1.6;
    }

    // Hit flash.
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      this.u.uFlash.value = (this.flashTimer / this.flashLen) * 2.6;
    } else if (this.u.uFlash.value !== 0) {
      this.u.uFlash.value = 0;
    }

    // Core brightens and beats faster as health drops: the "about to pop" tell.
    const hp = this.healthFraction;
    this.u.uCore.value = 1.6 + (1 - hp) * 1.9 + Math.sin(elapsed * (7 + (1 - hp) * 16) + this.phase) * 0.5;
  }

  /**
   * Corpse pop. Enemies used to vanish on the frame they died, which threw
   * away the single most satisfying moment in a tower defense. Now the body
   * expands and washes out over a fifth of a second.
   */
  private updateDeath(dt: number) {
    if (this.deathAge < 0) return;
    this.deathAge += dt;
    const k = Math.min(1, this.deathAge / 0.22);
    this.chassis.scale.setScalar(1 + k * 0.85);
    this.chassis.rotation.y += dt * 9;
    this.u.uFlash.value = (1 - k) * 4.0;
    this.u.uCore.value = 1 + (1 - k) * 6;
    this.mat.opacity = 1 - k * k;
    this.mat.transparent = true;
    if (this.shieldMesh) this.shieldMesh.visible = false;
  }

  /** True once the corpse has finished its pop and can be removed. */
  get expired(): boolean {
    return !this.alive && this.deathAge >= 0.22;
  }

  dispose() {
    this.mat.dispose();
    if (this.shieldMesh) (this.shieldMesh.material as THREE.Material).dispose();
  }
}
