import * as THREE from 'three';
import type { Track } from './Track';
import { createTerrainMaterial } from './GroundMaterial';
import { fbm2, ridged2, mulberry32, smoothstep } from './GroundNoise';

export interface TerrainOptions {
  size?: number;
  resolution?: number;
  amplitude?: number;
  seed?: number;
}

interface Outcrop {
  x: number;
  z: number;
  radius: number;
  height: number;
}

/**
 * The playfield.
 *
 * Shape, not just texture, is what makes ground read. The heightfield is built
 * from four separable layers so each can be reasoned about on its own:
 *
 *  1. a domain-warped fbm at low amplitude — gentle rolling across the open
 *     middle, enough to catch light but never enough to hide a creature;
 *  2. a ridged rim that lifts only in the outer band, so the map is a shallow
 *     basin framed by hills rather than the dome it used to be;
 *  3. a handful of seeded rock outcrops with flat tops and steep flanks, placed
 *     clear of the path — these are what give the material's rock layer
 *     somewhere to appear and put verticals in the silhouette;
 *  4. the road cut: a flattened corridor with a worn trough and spoil berms,
 *     with the rim locally suppressed so the path leaves through a saddle
 *     instead of climbing a wall.
 *
 * An apron of coarse rings is extruded outward from the map boundary sharing
 * exactly the border vertices, so the horizon is receding hills dissolving into
 * fog rather than the world ending on a cut edge.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  /** Distant land beyond the playable square. Parented to `mesh`. */
  readonly apron: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly size: number;
  private readonly res: number;
  private readonly heights: Float32Array;

  private readonly seed: number;
  private readonly amp: number;
  private readonly outcrops: Outcrop[] = [];
  private readonly pathPts: THREE.Vector3[] = [];

  constructor(track: Track | null, opts: TerrainOptions = {}) {
    this.size = opts.size ?? 80;
    this.res = opts.resolution ?? 192;
    this.amp = opts.amplitude ?? 2.4;
    this.seed = opts.seed ?? 24601;

    // One polyline sample of the path, reused for every vertex. Calling
    // track.distanceToPath per vertex would re-sample the curve 30k times.
    if (track) {
      const N = 512;
      for (let i = 0; i <= N; i++) this.pathPts.push(track.curve.getPoint(i / N));
    }

    this.placeOutcrops();

    const geo = new THREE.PlaneGeometry(this.size, this.size, this.res - 1, this.res - 1);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    this.heights = new Float32Array(this.res * this.res);
    const road = new Float32Array(pos.count);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = this.pathDistance(x, z);
      const h = this.sampleHeight(x, z, d);
      pos.setY(i, h);
      this.heights[i] = h;
      road[i] = d;
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.setAttribute('aRoad', new THREE.BufferAttribute(road, 1));
    geo.setAttribute('aOcc', new THREE.BufferAttribute(this.bakeOcclusion(), 1));

    this.material = createTerrainMaterial({ roadInner: 1.75, roadOuter: 4.8 });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain';

    this.apron = new THREE.Mesh(this.buildApron(), this.material);
    this.apron.name = 'terrain-apron';
    this.apron.receiveShadow = false;
    this.apron.castShadow = false;
    this.mesh.add(this.apron);
  }

  /* ------------------------------------------------------------- generation */

  /** Seeded rock outcrops, rejected if they would sit on or beside the path. */
  private placeOutcrops() {
    const rnd = mulberry32(this.seed ^ 0x5f3a);
    const half = this.size * 0.5;
    let tries = 0;
    while (this.outcrops.length < 6 && tries < 500) {
      tries++;
      const x = (rnd() * 2 - 1) * half * 0.82;
      const z = (rnd() * 2 - 1) * half * 0.82;
      const radius = 5.5 + rnd() * 7.0;
      // Keep the play area readable: nothing on the road, nothing overlapping.
      if (this.pathDistance(x, z) < radius + 5.0) continue;
      let clash = false;
      for (const o of this.outcrops) {
        if (Math.hypot(o.x - x, o.z - z) < o.radius + radius + 2.0) { clash = true; break; }
      }
      if (clash) continue;
      this.outcrops.push({ x, z, radius, height: 1.6 + rnd() * 3.2 });
    }
  }

  /** Shortest distance from (x,z) to the cached path polyline. */
  private pathDistance(x: number, z: number): number {
    if (this.pathPts.length === 0) return 1e6;
    let best = Infinity;
    for (let i = 0; i < this.pathPts.length; i++) {
      const p = this.pathPts[i];
      const dx = p.x - x;
      const dz = p.z - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /**
   * Natural ground height before the road is cut into it.
   * Defined for all x/z, including outside the playfield, so the apron can use it.
   */
  private baseHeight(x: number, z: number): number {
    const s = this.seed;
    const half = this.size * 0.5;

    // Domain warp: offsetting the sample point by another noise field turns
    // fbm's isotropic blobs into folded, flowing landforms.
    const wx = fbm2(x * 0.024 + 3.1, z * 0.024 - 7.2, s + 11, 3) - 0.5;
    const wz = fbm2(x * 0.024 - 5.6, z * 0.024 + 2.4, s + 29, 3) - 0.5;
    const px = x * 0.040 + wx * 2.4;
    const pz = z * 0.040 + wz * 2.4;

    let h = (fbm2(px, pz, s, 5) - 0.5) * 2.0 * this.amp * 0.52;
    h += (fbm2(x * 0.135, z * 0.135, s + 91, 3) - 0.5) * 0.45;

    // Rock outcrops: flat crown, steep flank. Pow < 1 fattens the plateau.
    for (const o of this.outcrops) {
      const d = Math.hypot(o.x - x, o.z - z);
      const f = 1 - smoothstep(o.radius * 0.30, o.radius, d);
      if (f > 0) h += o.height * Math.pow(f, 0.55);
    }

    // Framing rim. A squircle radius keeps the usable square large instead of
    // pinching the corners the way a circular falloff would.
    const rx = Math.abs(x) / half;
    const rz = Math.abs(z) / half;
    const r = Math.pow(rx * rx * rx * rx + rz * rz * rz * rz, 0.25);
    const rWobble = (fbm2(x * 0.05, z * 0.05, s + 77, 3) - 0.5) * 0.20;
    const ridge = ridged2(x * 0.042, z * 0.042, s + 53, 4);
    const rim = smoothstep(0.76, 1.06, r + rWobble);

    h += rim * (2.4 + 6.2 * ridge);

    return h;
  }

  /** Final height including the road cut. `d` is distance to the path. */
  private sampleHeight(x: number, z: number, d: number): number {
    let h = this.baseHeight(x, z);

    if (this.pathPts.length === 0) return h;

    // Flatten the rim where the road runs through it so the path leaves the
    // basin through a saddle rather than butting into a hillside.
    const saddle = 1 - smoothstep(7.0, 22.0, d);
    if (saddle > 0) {
      const half = this.size * 0.5;
      const rx = Math.abs(x) / half;
      const rz = Math.abs(z) / half;
      const r = Math.pow(rx * rx * rx * rx + rz * rz * rz * rz, 0.25);
      const rim = smoothstep(0.70, 1.04, r);
      const ridge = ridged2(x * 0.042, z * 0.042, this.seed + 53, 4);
      h -= rim * (2.2 + 5.6 * ridge) * saddle * 0.88;
    }

    // The corridor itself: level, with a shallow worn trough and spoil berms
    // pushed up either side.
    const flatten = 1 - smoothstep(2.2, 7.5, d);
    h = h + (-0.05 - h) * flatten;
    h -= (1 - smoothstep(0.0, 2.4, d)) * 0.09;
    h += (smoothstep(1.7, 2.7, d) - smoothstep(2.7, 5.0, d)) * 0.20;

    return h;
  }

  /**
   * Cheap cavity bake.
   *
   * Compares each sample against the average of a ring of neighbours: below the
   * local mean is a hollow, above it is a shoulder. It is not a real AO solve,
   * but it is the term that keeps the large forms legible in areas where the
   * sun is at grazing incidence and N.L carries no information.
   */
  private bakeOcclusion(): Float32Array {
    const n = this.res;
    const raw = new Float32Array(n * n);
    const step = this.size / (n - 1);
    const rings = [2, 5, 10];
    const dirs = 8;

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const h = this.heights[y * n + x];
        let acc = 0;
        let count = 0;
        for (const ring of rings) {
          for (let a = 0; a < dirs; a++) {
            const ang = (a / dirs) * Math.PI * 2;
            const sx = Math.round(x + Math.cos(ang) * ring);
            const sy = Math.round(y + Math.sin(ang) * ring);
            if (sx < 0 || sy < 0 || sx >= n || sy >= n) continue;
            // Weight closer rings more: they carry the small-scale cavity.
            const w = 1 / ring;
            acc += (this.heights[sy * n + sx] - h) * w;
            count += w;
          }
        }
        const mean = count > 0 ? acc / count : 0;
        // mean > 0 => neighbours are higher => we are in a hollow.
        raw[y * n + x] = 1 - THREE.MathUtils.clamp(mean / (step * 2.6) + 0.14, 0, 1);
      }
    }

    // One box blur pass so the term does not carry the grid frequency.
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let s = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sy < 0 || sx >= n || sy >= n) continue;
            s += raw[sy * n + sx];
            c++;
          }
        }
        out[y * n + x] = s / c;
      }
    }
    return out;
  }

  /**
   * Rings extruded outward from the exact border vertices of the playfield, so
   * the seam is watertight by construction. Ring spacing grows geometrically:
   * near rings need to hold the silhouette, far rings only need to fill fog.
   */
  private buildApron(): THREE.BufferGeometry {
    const half = this.size * 0.5;
    const n = this.res;
    const scales = [1.0, 1.07, 1.18, 1.38, 1.72, 2.3, 3.3, 4.8, 6.6];

    // Border of the plane, walked once in order.
    const border: Array<[number, number]> = [];
    for (let i = 0; i < n - 1; i++) border.push([-half + (i / (n - 1)) * this.size, -half]);
    for (let i = 0; i < n - 1; i++) border.push([half, -half + (i / (n - 1)) * this.size]);
    for (let i = n - 1; i > 0; i--) border.push([-half + (i / (n - 1)) * this.size, half]);
    for (let i = n - 1; i > 0; i--) border.push([-half, -half + (i / (n - 1)) * this.size]);

    // Decimate: the apron does not need playfield resolution.
    const stride = Math.max(1, Math.floor((n - 1) / 40));
    const loop: Array<[number, number]> = [];
    for (let i = 0; i < border.length; i += stride) loop.push(border[i]);

    const ringCount = scales.length;
    const loopCount = loop.length;
    const pos: number[] = [];
    const idx: number[] = [];
    const roadAttr: number[] = [];
    const occAttr: number[] = [];

    for (let r = 0; r < ringCount; r++) {
      const k = scales[r];
      for (let i = 0; i < loopCount; i++) {
        const bx = loop[i][0];
        const bz = loop[i][1];
        const x = bx * k;
        const z = bz * k;
        let h: number;
        if (r === 0) {
          // Exactly the playfield's own height so the seam does not crack.
          h = this.sampleHeight(x, z, this.pathDistance(x, z));
        } else {
          h = this.baseHeight(x, z);
          // Let the far rings sink so the land reads as falling away, not as a
          // wall ringing the map.
          h -= (k - 1.0) * 1.4;
        }
        pos.push(x, h, z);
        roadAttr.push(1e6);
        occAttr.push(1.0);
      }
    }

    for (let r = 0; r < ringCount - 1; r++) {
      for (let i = 0; i < loopCount; i++) {
        const j = (i + 1) % loopCount;
        const a = r * loopCount + i;
        const b = r * loopCount + j;
        const c = (r + 1) * loopCount + i;
        const d = (r + 1) * loopCount + j;
        idx.push(a, c, b, b, c, d);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(roadAttr, 1));
    g.setAttribute('aOcc', new THREE.Float32BufferAttribute(occAttr, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /* --------------------------------------------------------------- sampling */

  /** Sample terrain height at a world x/z via bilinear lookup. */
  heightAt(x: number, z: number): number {
    const half = this.size * 0.5;
    const u = ((x + half) / this.size) * (this.res - 1);
    const v = ((z + half) / this.size) * (this.res - 1);
    const x0 = THREE.MathUtils.clamp(Math.floor(u), 0, this.res - 2);
    const y0 = THREE.MathUtils.clamp(Math.floor(v), 0, this.res - 2);
    const tx = u - x0;
    const ty = v - y0;
    const h = (gx: number, gy: number) => this.heights[gy * this.res + gx] ?? 0;
    const top = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * tx;
    const bot = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * tx;
    return top + (bot - top) * ty;
  }

  /** Surface normal at a world x/z, from the sampled heightfield. */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.size / (this.res - 1);
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.apron.geometry.dispose();
    this.material.dispose();
  }
}
