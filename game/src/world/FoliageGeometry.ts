import * as THREE from 'three';

/**
 * Procedural geometry for the Gearwood Thicket.
 *
 * Everything here returns *non-indexed* geometry carrying position / normal /
 * uv / color, so a set of parts can be merged with `mergeGeos` into a single
 * buffer and driven by one InstancedMesh. Colour lives in the vertex stream
 * rather than in a texture: it costs nothing to author, survives instancing,
 * and lets one material carry bark, leaf and moss in the same draw call.
 *
 * Colours written into the `color` attribute are taken from THREE.Color, which
 * is already linear-space under ColorManagement, so they land in the shader
 * with no double conversion.
 */

/** Deterministic PRNG (same construction as core/Textures). */
export function rand32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rnd = () => number;

export const range = (r: Rnd, lo: number, hi: number) => lo + r() * (hi - lo);

/** Stable hash of a quantised position, so welded vertices displace together. */
function hash3(x: number, y: number, z: number) {
  const xi = Math.round(x * 512) | 0;
  const yi = Math.round(y * 512) | 0;
  const zi = Math.round(z * 512) | 0;
  let h = Math.imul(xi, 374761393) ^ Math.imul(yi, 668265263) ^ Math.imul(zi, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const ATTRS = ['position', 'normal', 'uv', 'color'] as const;
const ATTR_SIZE: Record<string, number> = { position: 3, normal: 3, uv: 2, color: 3 };

/** Merge non-indexed geometries that all carry position/normal/uv/color. */
export function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.filter((g) => g.attributes.position && g.attributes.position.count > 0);
  const out = new THREE.BufferGeometry();
  if (!parts.length) {
    out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    return out;
  }
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;

  for (const name of ATTRS) {
    const size = ATTR_SIZE[name];
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of parts) {
      const count = g.attributes.position.count;
      const a = g.attributes[name] as THREE.BufferAttribute | undefined;
      if (a) {
        arr.set(a.array as Float32Array, off);
      } else if (name === 'color') {
        arr.fill(1, off, off + count * size);
      }
      off += count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of parts) g.dispose();
  out.computeBoundingSphere();
  return out;
}

/** Flatten to non-indexed and recompute per-face normals for a faceted look. */
export function facet(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  flat.computeVertexNormals();
  if (!flat.attributes.uv) {
    flat.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(flat.attributes.position.count * 2), 2));
  }
  return flat;
}

/** Fill the whole geometry with one colour. */
export function paint(g: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/**
 * Bake a two-way gradient: sky-facing vertices get `up`, downward-facing get
 * `down`, and the whole thing darkens toward the bottom of the local bounds.
 * This is a cheap stand-in for ambient occlusion and it is the single biggest
 * reason low-poly foliage reads as volume instead of as a flat green blob.
 */
export function paintShaded(
  g: THREE.BufferGeometry,
  down: THREE.Color,
  up: THREE.Color,
  opts: { yLow?: number; yHigh?: number; occlude?: number } = {},
): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const n = pos.count;
  let lo = opts.yLow ?? Infinity;
  let hi = opts.yHigh ?? -Infinity;
  if (opts.yLow === undefined || opts.yHigh === undefined) {
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  const span = Math.max(hi - lo, 1e-4);
  const occ = opts.occlude ?? 0.34;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const ny = nrm ? nrm.getY(i) : 1;
    const t = THREE.MathUtils.smoothstep(ny, -0.35, 0.85);
    c.copy(down).lerp(up, t);
    const yt = THREE.MathUtils.clamp((pos.getY(i) - lo) / span, 0, 1);
    const k = 1 - occ * (1 - yt) * (1 - yt);
    arr[i * 3] = c.r * k;
    arr[i * 3 + 1] = c.g * k;
    arr[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Displace an indexed geometry along its normals with a stable hash. */
export function roughen(g: THREE.BufferGeometry, amount: number, scale = 1): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const h = hash3(x * scale, y * scale, z * scale) - 0.5;
    const h2 = hash3(z * scale * 2.3 + 11, x * scale * 2.3 - 4, y * scale * 2.3 + 7) - 0.5;
    const d = (h * 0.75 + h2 * 0.25) * 2 * amount;
    pos.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export interface LimbOptions {
  height: number;
  radiusBottom: number;
  radiusTop: number;
  radialSeg?: number;
  heightSeg?: number;
  /** Horizontal drift of the axis at the top, quadratic in t. */
  bendX?: number;
  bendZ?: number;
  /** Root flare multiplier at the base. */
  flare?: number;
  /** Radial wobble amplitude, as a fraction of radius. */
  gnarl?: number;
  rnd?: Rnd;
  /** Close the top with a cap (branch tips). */
  capTop?: boolean;
}

/**
 * A tapered, bendable tube: trunks, branches, roots and lamp posts all come
 * out of this. Built by hand rather than from CylinderGeometry because the
 * axis has to curve and the profile has to wobble per-ring.
 */
export function limb(o: LimbOptions): THREE.BufferGeometry {
  const rs = o.radialSeg ?? 7;
  const hs = o.heightSeg ?? 6;
  const rnd = o.rnd ?? rand32(7);
  const bendX = o.bendX ?? 0;
  const bendZ = o.bendZ ?? 0;
  const flare = o.flare ?? 1.7;
  const gnarl = o.gnarl ?? 0.12;

  // Per-ring and per-column wobble tables so the surface is not a clean cone.
  const colWob: number[] = [];
  for (let i = 0; i < rs; i++) colWob.push(1 + (rnd() - 0.5) * 2 * gnarl);
  const rings: { y: number; cx: number; cz: number; r: number; k: number }[] = [];
  for (let j = 0; j <= hs; j++) {
    const t = j / hs;
    const taper = Math.pow(1 - t, 1.35);
    let r = o.radiusTop + (o.radiusBottom - o.radiusTop) * taper;
    if (t < 0.16) r *= 1 + (flare - 1) * Math.pow(1 - t / 0.16, 2.2);
    r *= 1 + (rnd() - 0.5) * 2 * gnarl * 0.6;
    rings.push({
      y: t * o.height,
      cx: bendX * t * t,
      cz: bendZ * t * t,
      r,
      k: 1 + (rnd() - 0.5) * 0.4 * gnarl,
    });
  }

  const pos: number[] = [];
  const uv: number[] = [];
  const vert = (j: number, i: number) => {
    const ring = rings[j];
    const a = (i % rs) / rs * Math.PI * 2;
    const r = ring.r * colWob[i % rs] * ring.k;
    return [ring.cx + Math.cos(a) * r, ring.y, ring.cz + Math.sin(a) * r];
  };
  const push = (j: number, i: number) => {
    const v = vert(j, i);
    pos.push(v[0], v[1], v[2]);
    uv.push((i % rs) / rs, j / hs);
  };

  for (let j = 0; j < hs; j++) {
    for (let i = 0; i < rs; i++) {
      push(j, i); push(j, i + 1); push(j + 1, i);
      push(j, i + 1); push(j + 1, i + 1); push(j + 1, i);
    }
  }
  if (o.capTop ?? true) {
    const top = rings[hs];
    for (let i = 0; i < rs; i++) {
      const a = vert(hs, i);
      const b = vert(hs, i + 1);
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], top.cx, top.y, top.cz);
      uv.push(0, 1, 1, 1, 0.5, 1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** A lumpy foliage blob: icosphere, squashed, displaced, faceted. */
export function clump(radius: number, detail: number, rnd: Rnd, lumpy = 0.22): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const sy = range(rnd, 0.6, 0.95);
  const sx = range(rnd, 0.9, 1.15);
  const sz = range(rnd, 0.9, 1.15);
  g.scale(sx, sy, sz);
  g.computeVertexNormals();
  roughen(g, radius * lumpy, range(rnd, 0.8, 1.8));
  return g;
}

/**
 * A single grass blade: a tapered strip that arcs outward and twists.
 * Blades are geometry rather than alpha-tested cards -- no sorting, no fringe
 * artefacts under the software rasteriser, and the silhouette stays crisp.
 */
export function blade(o: {
  height: number;
  width: number;
  bend: number;
  segments?: number;
  yaw: number;
  rnd: Rnd;
}): THREE.BufferGeometry {
  const seg = o.segments ?? 4;
  const pos: number[] = [];
  const uv: number[] = [];
  const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
  const twist = range(o.rnd, -0.5, 0.5);

  const pt = (t: number, s: number) => {
    const w = o.width * (1 - t) * (1 - t * 0.35) * s;
    // Arc: rises fast then falls away under its own weight.
    const fwd = o.bend * t * t;
    const y = o.height * (t - o.bend * 0.22 * t * t * t);
    const lx = fwd + w * twist * t;
    // Local frame -> world, rotated about Y by yaw.
    return [lx * cy - w * sy, y, lx * sy + w * cy];
  };

  for (let j = 0; j < seg; j++) {
    const t0 = j / seg, t1 = (j + 1) / seg;
    const a = pt(t0, -1), b = pt(t0, 1), c = pt(t1, -1), d = pt(t1, 1);
    pos.push(...a, ...b, ...c, ...b, ...d, ...c);
    uv.push(0, t0, 1, t0, 0, t1, 1, t0, 1, t1, 0, t1);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  // Grass lit by its true normals goes black on the shaded side; forcing the
  // normals upward makes every blade catch the key light like a leaf should.
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nrm.count; i++) {
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    const bx = nx * 0.35, by = Math.abs(ny) * 0.2 + 0.9, bz = nz * 0.35;
    const l = Math.hypot(bx, by, bz);
    nrm.setXYZ(i, bx / l, by / l, bz / l);
  }
  nrm.needsUpdate = true;
  return g;
}

/** A flat, arched frond leaf -- ferns and low broadleaf undergrowth. */
export function frond(o: { length: number; width: number; droop: number; yaw: number; lobes?: number }): THREE.BufferGeometry {
  const lobes = o.lobes ?? 5;
  const pos: number[] = [];
  const uv: number[] = [];
  const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
  const map = (fx: number, side: number, t: number) => {
    const y = o.length * (t * 0.9 - o.droop * t * t * 1.1) + 0.02;
    const lx = fx;
    return [lx * cy - side * sy, y, lx * sy + side * cy];
  };
  for (let j = 0; j < lobes; j++) {
    const t0 = j / lobes, t1 = (j + 1) / lobes;
    const r0 = o.length * (0.15 + t0 * 0.85);
    const r1 = o.length * (0.15 + t1 * 0.85);
    const w0 = o.width * Math.sin(Math.PI * Math.min(t0 + 0.12, 1)) ;
    const w1 = o.width * Math.sin(Math.PI * Math.min(t1 + 0.12, 1));
    for (const s of [-1, 1]) {
      const a = map(r0, 0, t0);
      const b = map(r0, s * w0, t0);
      const c = map(r1, 0, t1);
      const d = map(r1, s * w1, t1);
      if (s > 0) pos.push(...a, ...b, ...c, ...b, ...d, ...c);
      else pos.push(...a, ...c, ...b, ...b, ...c, ...d);
      uv.push(0, t0, 1, t0, 0, t1, 1, t0, 1, t1, 0, t1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nrm.count; i++) {
    const nx = nrm.getX(i), nz = nrm.getZ(i);
    const l = Math.hypot(nx * 0.3, 1, nz * 0.3);
    nrm.setXYZ(i, (nx * 0.3) / l, 1 / l, (nz * 0.3) / l);
  }
  nrm.needsUpdate = true;
  return g;
}

/** A cog: cylinder body with square teeth and a bored centre. Steampunk seasoning. */
export function cog(o: { radius: number; thickness: number; teeth: number; bore: number }): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(o.radius, o.radius, o.thickness, Math.max(10, o.teeth), 1, false);
  parts.push(facet(body));
  const hub = new THREE.CylinderGeometry(o.bore * 1.7, o.bore * 1.7, o.thickness * 1.45, 10, 1, false);
  parts.push(facet(hub));
  const tw = (Math.PI * 2 * o.radius) / (o.teeth * 2.3);
  for (let i = 0; i < o.teeth; i++) {
    const a = (i / o.teeth) * Math.PI * 2;
    const t = new THREE.BoxGeometry(o.radius * 0.3, o.thickness * 0.86, tw);
    t.translate(o.radius * 1.06, 0, 0);
    t.rotateY(-a);
    parts.push(facet(t));
  }
  return mergeGeos(parts);
}
