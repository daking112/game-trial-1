import * as THREE from 'three';
import type { Terrain } from './Terrain';
import type { Track } from './Track';
import { rand32, range, type Rnd } from './FoliageGeometry';
import { windMaterial, type WindHandle } from './FoliageMaterials';
import {
  LEAF_PALETTES, buildBush, buildFern, buildGearStone, buildLamp, buildLog, buildRock,
  buildShroom, buildSpecies, buildTuft, type Built, type SpeciesKind,
} from './FoliageSpecies';

/**
 * Foliage: the dressing pass over the terrain.
 *
 * Placement is the whole game here. A uniform scatter reads as noise no matter
 * how good the tree meshes are, so the layout is built in four passes:
 *
 *   1. a dense perimeter wall of forest that frames the playfield and hides
 *      the map edge,
 *   2. interior *stands* -- clusters with their own species mix and density,
 *      falling off from a centre, so the forest has grain and negative space,
 *   3. a fringe pass that hugs the track at a fixed standoff, which is what
 *      makes the road read as cut *through* the wood rather than painted on,
 *   4. ground cover whose density is driven by how much canopy is overhead.
 *
 * Every decision is drawn from a seeded PRNG so a screenshot taken today and
 * one taken next week differ only where the code changed.
 */

export interface FoliageOptions {
  seed?: number;
  /** Global multiplier on every population count. */
  density?: number;
  /** Furthest radius from the origin that anything is placed at. */
  extent?: number;
}

interface Placed { x: number; z: number; r: number }

/** Uniform-grid spatial hash for rejection sampling. Cell ~= typical radius. */
class Hash {
  private readonly cells = new Map<number, Placed[]>();
  constructor(private readonly cell: number) {}
  private key(cx: number, cz: number) { return cx * 73856093 ^ cz * 19349663; }
  insert(p: Placed) {
    const cx = Math.floor(p.x / this.cell), cz = Math.floor(p.z / this.cell);
    const k = this.key(cx, cz);
    const list = this.cells.get(k);
    if (list) list.push(p); else this.cells.set(k, [p]);
  }
  /** True if `p` overlaps anything already inserted (radii sum scaled by k). */
  blocked(x: number, z: number, r: number, k = 1): boolean {
    const reach = Math.ceil((r + this.cell) / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        const list = this.cells.get(this.key(cx + i, cz + j));
        if (!list) continue;
        for (const o of list) {
          const d = (r + o.r) * k;
          const dx = o.x - x, dz = o.z - z;
          if (dx * dx + dz * dz < d * d) return true;
        }
      }
    }
    return false;
  }
  /** Sum of 1 - d/radius over neighbours: a cheap canopy-cover estimate. */
  coverage(x: number, z: number, radius: number): number {
    const reach = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let sum = 0;
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        const list = this.cells.get(this.key(cx + i, cz + j));
        if (!list) continue;
        for (const o of list) {
          const d = Math.hypot(o.x - x, o.z - z);
          if (d < radius) sum += (1 - d / radius) * Math.min(o.r, 4) * 0.4;
        }
      }
    }
    return sum;
  }
}

/**
 * Bucketed nearest-point lookup against the track polyline.
 *
 * `Track.distanceToPath` walks 160 curve samples per query; with tens of
 * thousands of scatter candidates that dominates load time. Bucketing the
 * polyline once turns each query into a handful of distance tests.
 */
class PathProximity {
  private readonly cell = 4;
  private readonly cells = new Map<number, number[]>();
  private readonly px: number[] = [];
  private readonly pz: number[] = [];
  constructor(track: Track, samples = 900) {
    const p = new THREE.Vector3();
    for (let i = 0; i <= samples; i++) {
      track.curve.getPoint(i / samples, p);
      this.px.push(p.x); this.pz.push(p.z);
      const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
      const list = this.cells.get(k);
      if (list) list.push(i); else this.cells.set(k, [i]);
    }
  }
  private key(cx: number, cz: number) { return cx * 73856093 ^ cz * 19349663; }
  /** Distance to the centreline, saturating at `max` (default 3 cells). */
  distance(x: number, z: number, max = 12): number {
    const reach = Math.ceil(max / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = max * max;
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        const list = this.cells.get(this.key(cx + i, cz + j));
        if (!list) continue;
        for (const idx of list) {
          const dx = this.px[idx] - x, dz = this.pz[idx] - z;
          const d = dx * dx + dz * dz;
          if (d < best) best = d;
        }
      }
    }
    return Math.sqrt(best);
  }
}

interface InstanceSpec {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  depthMaterial?: THREE.Material;
  castShadow: boolean;
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
}

const SPECIES_HEIGHT: Record<SpeciesKind, [number, number]> = {
  spire: [6.0, 9.5],
  bough: [4.2, 6.6],
  cogcap: [2.8, 4.2],
  twist: [3.4, 5.2],
  sapling: [1.4, 2.6],
};

interface Variant { kind: SpeciesKind; built: Built; palette: number }

export class Foliage {
  readonly group = new THREE.Group();

  private readonly winds: WindHandle[] = [];
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly rnd: Rnd;

  /** Populated during construction; useful for debugging placement. */
  readonly counts: Record<string, number> = {};

  constructor(terrain: Terrain, track: Track, opts: FoliageOptions = {}) {
    const seed = opts.seed ?? 90210;
    const density = opts.density ?? 1;
    const extent = opts.extent ?? 42;
    this.rnd = rand32(seed);
    this.group.name = 'foliage';

    const path = new PathProximity(track);
    const trees = new Hash(4);
    const clutter = new Hash(1.2);

    // ---- materials -------------------------------------------------------
    const treeWind = windMaterial(
      { vertexColors: true, roughness: 0.95, metalness: 0.0 },
      { pivotY: 0.12, spanY: 0.88, curve: 1.9, speed: 1.15, amplitude: 0.028, flutter: 0.006 },
    );
    const metalMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.34, metalness: 0.85,
    });
    const grassWind = windMaterial(
      { vertexColors: true, roughness: 0.72, metalness: 0.0, side: THREE.DoubleSide },
      { pivotY: 0.02, spanY: 0.95, curve: 1.35, speed: 1.9, amplitude: 0.19, flutter: 0.05 },
    );
    const bushWind = windMaterial(
      { vertexColors: true, roughness: 0.84, metalness: 0.0, side: THREE.DoubleSide },
      { pivotY: 0.15, spanY: 0.85, curve: 1.6, speed: 1.5, amplitude: 0.07, flutter: 0.02 },
    );
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
    const glowMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.35, metalness: 0.0,
      emissive: new THREE.Color('#8ff2dd'), emissiveIntensity: 2.2,
    });
    const lampGlowMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.3, metalness: 0.0,
      emissive: new THREE.Color('#ffc36a'), emissiveIntensity: 3.4,
    });
    this.winds.push(treeWind, grassWind, bushWind);
    this.materials.push(treeWind.material, treeWind.depthMaterial, grassWind.material, grassWind.depthMaterial,
      bushWind.material, bushWind.depthMaterial, metalMat, rockMat, glowMat, lampGlowMat);

    // ---- species variants ------------------------------------------------
    const variants: Variant[] = [];
    const addVariants = (kind: SpeciesKind, n: number, palettes: number[]) => {
      for (let i = 0; i < n; i++) {
        const palette = palettes[i % palettes.length];
        variants.push({ kind, built: buildSpecies(kind, seed + variants.length * 1013 + 17, LEAF_PALETTES[palette]), palette });
      }
    };
    // Green species get the green palettes; the two accent hues are reserved
    // for the two rarest species so they punctuate rather than compete.
    addVariants('spire', 3, [0, 1, 2]);
    addVariants('bough', 3, [0, 2, 1]);
    addVariants('cogcap', 2, [3, 0]);
    addVariants('twist', 2, [4, 1]);
    addVariants('sapling', 2, [0, 2]);

    const byKind = (k: SpeciesKind) => variants.map((v, i) => ({ v, i })).filter((e) => e.v.kind === k).map((e) => e.i);
    const kindIndex: Record<SpeciesKind, number[]> = {
      spire: byKind('spire'), bough: byKind('bough'), cogcap: byKind('cogcap'),
      twist: byKind('twist'), sapling: byKind('sapling'),
    };

    const treeInstances: { matrices: THREE.Matrix4[]; colors: THREE.Color[] }[] =
      variants.map(() => ({ matrices: [], colors: [] }));

    // ---- placement helpers ----------------------------------------------
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v3 = new THREE.Vector3();
    const scl = new THREE.Vector3();

    const slopeAt = (x: number, z: number) => {
      const d = 0.7;
      const hx = terrain.heightAt(x + d, z) - terrain.heightAt(x - d, z);
      const hz = terrain.heightAt(x, z + d) - terrain.heightAt(x, z - d);
      return Math.hypot(hx, hz) / (2 * d);
    };

    // The map faces the default camera from the south, so the forest is
    // authored like a stage set: a heavy wall upstage, thinning to an open
    // apron downstage. Without this the near treeline simply occludes the
    // playfield from every default view.
    const apron = (x: number, z: number) => {
      const open = THREE.MathUtils.smoothstep(z, 14, 30);
      const corner = THREE.MathUtils.smoothstep(Math.abs(x), 26, 38);
      return THREE.MathUtils.lerp(1, 0.12 + 0.5 * corner, open);
    };

    const tint = (warm: number, spread: number) => {
      const t = (this.rnd() - 0.5) * 2 * spread;
      return new THREE.Color(1 + t * warm, 1 + t * 0.35, 1 - t * warm * 0.75).multiplyScalar(range(this.rnd, 0.88, 1.12));
    };

    const plantTree = (x: number, z: number, kind: SpeciesKind, scaleBias = 1): boolean => {
      if (Math.hypot(x, z) > extent) return false;
      if (Math.abs(x) > extent || Math.abs(z) > extent) return false;
      if (this.rnd() > apron(x, z)) return false;
      const pool = kindIndex[kind];
      const vi = pool[Math.floor(this.rnd() * pool.length) % pool.length];
      const [h0, h1] = SPECIES_HEIGHT[kind];
      const height = range(this.rnd, h0, h1) * scaleBias;
      const canopy = variants[vi].built.radius * height;
      // Trunks stay well clear of the road; canopies are allowed to lean in a
      // little, which is what stops the treeline looking like a hedge.
      // Wide enough that the canopy never overhangs the road. In a tower
      // defense the player must be able to read the whole path at a glance;
      // an occluded lane is a lost run they cannot see coming.
      const clear = 5.4 + canopy * 0.16;
      if (path.distance(x, z, clear + 1) < clear) return false;
      if (slopeAt(x, z) > 0.62) return false;
      if (trees.blocked(x, z, canopy, 0.52)) return false;

      trees.insert({ x, z, r: canopy });
      const y = terrain.heightAt(x, z) - 0.12;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * Math.PI * 2);
      // A degree or two of tilt off vertical: perfectly upright trees are the
      // classic tell that a forest was placed by a loop.
      const tiltA = range(this.rnd, 0, Math.PI * 2);
      const tiltM = range(this.rnd, 0, 0.045);
      q.multiply(new THREE.Quaternion().setFromEuler(
        new THREE.Euler(Math.cos(tiltA) * tiltM, 0, Math.sin(tiltA) * tiltM),
      ));
      scl.set(height * range(this.rnd, 0.9, 1.1), height, height * range(this.rnd, 0.9, 1.1));
      m.compose(v3.set(x, y, z), q, scl);
      treeInstances[vi].matrices.push(m.clone());
      treeInstances[vi].colors.push(tint(0.06, 0.14));
      return true;
    };

    // ---- pass 1: perimeter wall -----------------------------------------
    // A ring of heavy conifers around the playfield. Density falls off inward
    // so it blends into the interior stands instead of ending in a hard line.
    const ringTarget = Math.round(430 * density);
    for (let i = 0; i < ringTarget; i++) {
      const a = this.rnd() * Math.PI * 2;
      // Biased to the outer edge: the wall is two or three trees deep and then
      // breaks up into scattered stragglers reaching inward.
      const t = Math.pow(this.rnd(), 2.1);
      const r = THREE.MathUtils.lerp(extent, 27.0, t);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const roll = this.rnd();
      const kind: SpeciesKind = roll < 0.6 ? 'spire' : roll < 0.86 ? 'bough' : roll < 0.96 ? 'twist' : 'cogcap';
      plantTree(x, z, kind, r > extent - 5 ? 1.1 : 1.0);
    }

    // ---- pass 2: interior stands ----------------------------------------
    const standCount = Math.round(11 * density);
    const stands: { x: number; z: number; r: number; kind: SpeciesKind; d: number }[] = [];
    for (let i = 0; i < standCount * 6 && stands.length < standCount; i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = Math.sqrt(this.rnd()) * 25;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (path.distance(x, z, 9) < 5.0) continue;
      let tooClose = false;
      for (const s of stands) if (Math.hypot(s.x - x, s.z - z) < 8) { tooClose = true; break; }
      if (tooClose) continue;
      const roll = this.rnd();
      const kind: SpeciesKind = roll < 0.3 ? 'spire' : roll < 0.62 ? 'bough' : roll < 0.8 ? 'cogcap' : 'twist';
      stands.push({ x, z, r: range(this.rnd, 3.5, 8.0), kind, d: range(this.rnd, 0.35, 0.8) });
    }
    for (const s of stands) {
      const n = Math.round(s.d * density * (Math.PI * s.r * s.r) / 16);
      for (let i = 0; i < n; i++) {
        // Gaussian-ish falloff: dense core, ragged edge.
        const a = this.rnd() * Math.PI * 2;
        const rr = s.r * Math.pow(this.rnd(), 0.62);
        const x = s.x + Math.cos(a) * rr, z = s.z + Math.sin(a) * rr;
        const edge = rr / s.r;
        const roll = this.rnd();
        // The species mix shifts toward saplings at the edge of a stand, so
        // stands read as having grown outward rather than been stamped.
        const kind: SpeciesKind = roll < 0.55 - edge * 0.35 ? s.kind
          : roll < 0.78 ? (this.rnd() < 0.5 ? 'bough' : 'twist')
          : 'sapling';
        plantTree(x, z, kind, kind === s.kind ? range(this.rnd, 0.92, 1.06) : 1);
      }
    }

    // ---- pass 3: track fringe -------------------------------------------
    // Saplings and small trees hugging the road edge, plus the occasional big
    // trunk right on the verge for foreground framing.
    const fringeSteps = Math.round(90 * density);
    for (let i = 0; i < fringeSteps; i++) {
      const t = i / fringeSteps;
      const p = track.curve.getPoint(t);
      const tan = track.curve.getTangent(t).setY(0).normalize();
      const side = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
      const sgn = this.rnd() < 0.5 ? -1 : 1;
      const off = range(this.rnd, 3.1, 5.4);
      const x = p.x + side.x * off * sgn, z = p.z + side.z * off * sgn;
      const roll = this.rnd();
      const kind: SpeciesKind = roll < 0.5 ? 'sapling' : roll < 0.75 ? 'cogcap' : roll < 0.9 ? 'twist' : 'bough';
      plantTree(x, z, kind, 0.95);
    }
    this.counts.trees = treeInstances.reduce((a, b) => a + b.matrices.length, 0);

    // ---- instanced tree meshes ------------------------------------------
    const specs: InstanceSpec[] = [];
    variants.forEach((v, i) => {
      const inst = treeInstances[i];
      if (!inst.matrices.length) return;
      if (v.built.organic.attributes.position.count) {
        specs.push({
          geometry: v.built.organic, material: treeWind.material, depthMaterial: treeWind.depthMaterial,
          castShadow: true, matrices: inst.matrices, colors: inst.colors,
        });
      }
      if (v.built.metal.attributes.position.count) {
        specs.push({
          geometry: v.built.metal, material: metalMat,
          castShadow: true, matrices: inst.matrices, colors: inst.colors,
        });
      }
    });

    // ---- rocks -----------------------------------------------------------
    const rockGeos = [0, 1, 2, 3].map((i) => buildRock(seed + 4400 + i * 91));
    const rockInst = rockGeos.map(() => ({ matrices: [] as THREE.Matrix4[], colors: [] as THREE.Color[] }));
    const outcrops = 9;
    const rockSpots: { x: number; z: number; r: number }[] = [];
    for (let i = 0; i < outcrops * 5 && rockSpots.length < outcrops; i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = Math.sqrt(this.rnd()) * 30;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (path.distance(x, z, 8) < 3.2) continue;
      rockSpots.push({ x, z, r: range(this.rnd, 2.5, 6) });
    }
    const placeRock = (x: number, z: number, big: boolean) => {
      if (Math.hypot(x, z) > extent + 1) return;
      const s = big ? range(this.rnd, 0.9, 2.1) : range(this.rnd, 0.28, 0.72);
      if (path.distance(x, z, s + 3) < 2.15 + s * 0.5) return;
      if (clutter.blocked(x, z, s * 0.8, 0.9)) return;
      clutter.insert({ x, z, r: s * 0.8 });
      const gi = Math.floor(this.rnd() * rockGeos.length) % rockGeos.length;
      q.setFromEuler(new THREE.Euler(range(this.rnd, -0.25, 0.25), this.rnd() * Math.PI * 2, range(this.rnd, -0.25, 0.25)));
      scl.set(s * range(this.rnd, 0.85, 1.2), s * range(this.rnd, 0.7, 1.15), s * range(this.rnd, 0.85, 1.2));
      m.compose(v3.set(x, terrain.heightAt(x, z) - s * 0.28, z), q, scl);
      rockInst[gi].matrices.push(m.clone());
      rockInst[gi].colors.push(tint(0.03, 0.16));
    };
    for (const s of rockSpots) {
      const n = Math.round(range(this.rnd, 4, 11));
      for (let i = 0; i < n; i++) {
        const a = this.rnd() * Math.PI * 2;
        const rr = s.r * Math.pow(this.rnd(), 0.7);
        placeRock(s.x + Math.cos(a) * rr, s.z + Math.sin(a) * rr, this.rnd() < 0.35);
      }
    }
    for (let i = 0; i < Math.round(200 * density); i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = Math.sqrt(this.rnd()) * extent;
      placeRock(Math.cos(a) * rr, Math.sin(a) * rr, this.rnd() < 0.12);
    }
    this.counts.rocks = rockInst.reduce((a, b) => a + b.matrices.length, 0);
    rockGeos.forEach((g, i) => {
      if (rockInst[i].matrices.length) {
        specs.push({ geometry: g, material: rockMat, castShadow: true, matrices: rockInst[i].matrices, colors: rockInst[i].colors });
      }
    });

    // ---- logs & gear stones ---------------------------------------------
    const logGeos = [0, 1, 2].map((i) => buildLog(seed + 5100 + i * 37));
    const logInst = logGeos.map(() => ({ matrices: [] as THREE.Matrix4[], colors: [] as THREE.Color[] }));
    for (let i = 0; i < Math.round(90 * density); i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = Math.sqrt(this.rnd()) * (extent - 3);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (path.distance(x, z, 8) < 3.6) continue;
      if (clutter.blocked(x, z, 2.0, 0.9)) continue;
      if (slopeAt(x, z) > 0.4) continue;
      clutter.insert({ x, z, r: 2.0 });
      const gi = Math.floor(this.rnd() * logGeos.length) % logGeos.length;
      const s = range(this.rnd, 0.75, 1.15);
      q.setFromEuler(new THREE.Euler(range(this.rnd, -0.1, 0.1), this.rnd() * Math.PI * 2, range(this.rnd, -0.08, 0.08)));
      m.compose(v3.set(x, terrain.heightAt(x, z) - 0.08, z), q, scl.set(s, s, s));
      logInst[gi].matrices.push(m.clone());
      logInst[gi].colors.push(tint(0.05, 0.12));
    }
    this.counts.logs = logInst.reduce((a, b) => a + b.matrices.length, 0);
    logGeos.forEach((g, i) => {
      if (logInst[i].matrices.length) {
        specs.push({ geometry: g, material: treeWind.material, depthMaterial: treeWind.depthMaterial, castShadow: true, matrices: logInst[i].matrices, colors: logInst[i].colors });
      }
    });

    const gears = [0, 1, 2].map((i) => buildGearStone(seed + 6200 + i * 53));
    const gearMats: THREE.Matrix4[][] = gears.map(() => []);
    const gearCols: THREE.Color[][] = gears.map(() => []);
    for (let i = 0; i < Math.round(46 * density); i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = Math.sqrt(this.rnd()) * (extent - 4);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (path.distance(x, z, 8) < 2.9) continue;
      if (clutter.blocked(x, z, 1.6, 0.9)) continue;
      clutter.insert({ x, z, r: 1.6 });
      const gi = Math.floor(this.rnd() * gears.length) % gears.length;
      const s = range(this.rnd, 0.55, 1.25);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * Math.PI * 2);
      m.compose(v3.set(x, terrain.heightAt(x, z) - s * 0.3, z), q, scl.set(s, s, s));
      gearMats[gi].push(m.clone());
      gearCols[gi].push(tint(0.04, 0.1));
    }
    this.counts.gears = gearMats.reduce((a, b) => a + b.length, 0);
    gears.forEach((g, i) => {
      if (!gearMats[i].length) return;
      specs.push({ geometry: g.metal, material: metalMat, castShadow: true, matrices: gearMats[i], colors: gearCols[i] });
      if (g.organic.attributes.position.count) {
        specs.push({ geometry: g.organic, material: bushWind.material, depthMaterial: bushWind.depthMaterial, castShadow: false, matrices: gearMats[i], colors: gearCols[i] });
      }
    });

    // ---- bushes & ferns --------------------------------------------------
    const bushGeos = [0, 1, 2, 3].map((i) => buildBush(seed + 7000 + i * 71, LEAF_PALETTES[[0, 2, 1, 3][i]]));
    const fernGeos = [0, 1, 2].map((i) => buildFern(seed + 7700 + i * 61, LEAF_PALETTES[[0, 2, 1][i]]));
    const bushInst = bushGeos.map(() => ({ matrices: [] as THREE.Matrix4[], colors: [] as THREE.Color[] }));
    const fernInst = fernGeos.map(() => ({ matrices: [] as THREE.Matrix4[], colors: [] as THREE.Color[] }));

    const scatterSmall = (
      tries: number,
      minPath: number,
      radiusFn: () => number,
      onPlace: (x: number, z: number, y: number, cover: number) => void,
      coverBias: number,
    ) => {
      for (let i = 0; i < tries; i++) {
        const a = this.rnd() * Math.PI * 2;
        const rr = Math.sqrt(this.rnd()) * extent;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (Math.hypot(x, z) > extent) continue;
        const pd = path.distance(x, z, minPath + 2);
        if (pd < minPath) continue;
        const cover = trees.coverage(x, z, 7);
        // Undergrowth wants shelter: accept much more readily under canopy.
        const p = THREE.MathUtils.clamp(0.12 + cover * coverBias, 0, 1);
        if (this.rnd() > p) continue;
        const r = radiusFn();
        if (clutter.blocked(x, z, r, 0.85)) continue;
        clutter.insert({ x, z, r });
        onPlace(x, z, terrain.heightAt(x, z), cover);
      }
    };

    scatterSmall(1400 * density, 2.35, () => range(this.rnd, 0.5, 0.9), (x, z, y) => {
      const gi = Math.floor(this.rnd() * bushGeos.length) % bushGeos.length;
      const s = range(this.rnd, 0.75, 1.7);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * Math.PI * 2);
      m.compose(v3.set(x, y - 0.08, z), q, scl.set(s * range(this.rnd, 0.9, 1.2), s * range(this.rnd, 0.75, 1.15), s * range(this.rnd, 0.9, 1.2)));
      bushInst[gi].matrices.push(m.clone());
      bushInst[gi].colors.push(tint(0.07, 0.18));
    }, 0.55);

    scatterSmall(1600 * density, 2.15, () => range(this.rnd, 0.35, 0.6), (x, z, y) => {
      const gi = Math.floor(this.rnd() * fernGeos.length) % fernGeos.length;
      const s = range(this.rnd, 0.55, 1.15);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * Math.PI * 2);
      m.compose(v3.set(x, y - 0.04, z), q, scl.set(s, s * range(this.rnd, 0.85, 1.2), s));
      fernInst[gi].matrices.push(m.clone());
      fernInst[gi].colors.push(tint(0.05, 0.16));
    }, 0.8);

    this.counts.bushes = bushInst.reduce((a, b) => a + b.matrices.length, 0);
    this.counts.ferns = fernInst.reduce((a, b) => a + b.matrices.length, 0);
    bushGeos.forEach((g, i) => {
      if (bushInst[i].matrices.length) specs.push({ geometry: g, material: bushWind.material, depthMaterial: bushWind.depthMaterial, castShadow: true, matrices: bushInst[i].matrices, colors: bushInst[i].colors });
    });
    fernGeos.forEach((g, i) => {
      if (fernInst[i].matrices.length) specs.push({ geometry: g, material: bushWind.material, depthMaterial: bushWind.depthMaterial, castShadow: false, matrices: fernInst[i].matrices, colors: fernInst[i].colors });
    });

    // ---- grass -----------------------------------------------------------
    const tuftGeos = [0, 1, 2, 3].map((i) => buildTuft(seed + 8100 + i * 43, LEAF_PALETTES[[0, 2, 0, 1][i]], 5 + (i % 2)));
    const tuftInst = tuftGeos.map(() => ({ matrices: [] as THREE.Matrix4[], colors: [] as THREE.Color[] }));
    const grassTries = Math.round(9000 * density);
    for (let i = 0; i < grassTries; i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = Math.sqrt(this.rnd()) * extent;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (Math.hypot(x, z) > extent) continue;
      const pd = path.distance(x, z, 6);
      if (pd < 1.85) continue;
      const cover = trees.coverage(x, z, 8);
      // Verge grass: a bright band right along the road edge reads as the path
      // being worn, and it hides the seam between ribbon and terrain.
      const verge = 1 - THREE.MathUtils.smoothstep(pd, 1.9, 4.2);
      const p = THREE.MathUtils.clamp(0.16 + cover * 0.42 + verge * 0.75, 0, 1);
      if (this.rnd() > p) continue;
      if (clutter.blocked(x, z, 0.3, 0.55)) continue;
      clutter.insert({ x, z, r: 0.3 });
      const gi = Math.floor(this.rnd() * tuftGeos.length) % tuftGeos.length;
      const s = range(this.rnd, 0.45, 1.0) * (verge > 0.4 ? 1.15 : 1);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * Math.PI * 2);
      m.compose(v3.set(x, terrain.heightAt(x, z) - 0.03, z), q, scl.set(s * range(this.rnd, 0.85, 1.25), s * range(this.rnd, 0.8, 1.35), s * range(this.rnd, 0.85, 1.25)));
      tuftInst[gi].matrices.push(m.clone());
      tuftInst[gi].colors.push(tint(0.09, 0.2));
    }
    this.counts.grass = tuftInst.reduce((a, b) => a + b.matrices.length, 0);
    tuftGeos.forEach((g, i) => {
      if (tuftInst[i].matrices.length) specs.push({ geometry: g, material: grassWind.material, castShadow: false, matrices: tuftInst[i].matrices, colors: tuftInst[i].colors });
    });

    // ---- glowing toadstools ---------------------------------------------
    const shrooms = [0, 1, 2].map((i) => buildShroom(seed + 9100 + i * 29));
    const shroomMats: THREE.Matrix4[][] = shrooms.map(() => []);
    const shroomCols: THREE.Color[][] = shrooms.map(() => []);
    for (let i = 0; i < Math.round(700 * density); i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = Math.sqrt(this.rnd()) * extent;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (path.distance(x, z, 6) < 2.3) continue;
      const cover = trees.coverage(x, z, 6);
      if (this.rnd() > THREE.MathUtils.clamp(cover * 0.5 - 0.05, 0, 1)) continue;
      if (clutter.blocked(x, z, 0.4, 0.9)) continue;
      clutter.insert({ x, z, r: 0.4 });
      const gi = Math.floor(this.rnd() * shrooms.length) % shrooms.length;
      const s = range(this.rnd, 0.7, 1.5);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * Math.PI * 2);
      m.compose(v3.set(x, terrain.heightAt(x, z) - 0.02, z), q, scl.set(s, s, s));
      shroomMats[gi].push(m.clone());
      shroomCols[gi].push(new THREE.Color(1, 1, 1));
    }
    this.counts.shrooms = shroomMats.reduce((a, b) => a + b.length, 0);
    shrooms.forEach((s, i) => {
      if (!shroomMats[i].length) return;
      specs.push({ geometry: s.body, material: bushWind.material, castShadow: false, matrices: shroomMats[i], colors: shroomCols[i] });
      specs.push({ geometry: s.glow, material: glowMat, castShadow: false, matrices: shroomMats[i], colors: shroomCols[i] });
    });

    // ---- track-side lamps ------------------------------------------------
    const lamp = buildLamp(seed + 9900);
    const lampMats: THREE.Matrix4[] = [];
    const lampCols: THREE.Color[] = [];
    const lampCount = 14;
    for (let i = 0; i < lampCount; i++) {
      const t = (i + 0.5) / lampCount;
      const p = track.curve.getPoint(t);
      const tan = track.curve.getTangent(t).setY(0).normalize();
      const side = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
      const sgn = i % 2 === 0 ? 1 : -1;
      const off = 2.45;
      const x = p.x + side.x * off * sgn, z = p.z + side.z * off * sgn;
      if (Math.hypot(x, z) > extent) continue;
      const s = range(this.rnd, 0.9, 1.1);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * Math.PI * 2);
      m.compose(v3.set(x, terrain.heightAt(x, z) - 0.05, z), q, scl.set(s, s, s));
      lampMats.push(m.clone());
      lampCols.push(new THREE.Color(1, 1, 1));
    }
    this.counts.lamps = lampMats.length;
    if (lampMats.length) {
      specs.push({ geometry: lamp.metal, material: metalMat, castShadow: true, matrices: lampMats, colors: lampCols });
      specs.push({ geometry: lamp.glow, material: lampGlowMat, castShadow: false, matrices: lampMats, colors: lampCols });
    }

    // ---- realise -----------------------------------------------------------
    for (const spec of specs) this.realise(spec);
  }

  private realise(spec: InstanceSpec) {
    const n = spec.matrices.length;
    const mesh = new THREE.InstancedMesh(spec.geometry, spec.material, n);
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, spec.matrices[i]);
      mesh.setColorAt(i, spec.colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = spec.castShadow;
    mesh.receiveShadow = true;
    if (spec.depthMaterial) mesh.customDepthMaterial = spec.depthMaterial;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    this.meshes.push(mesh);
    if (!this.geometries.includes(spec.geometry)) this.geometries.push(spec.geometry);
  }

  update(_dt: number, elapsed: number) {
    for (const w of this.winds) w.uniforms.uTime.value = elapsed;
  }

  dispose() {
    for (const m of this.meshes) {
      m.dispose();
      this.group.remove(m);
    }
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.meshes.length = 0;
  }
}
