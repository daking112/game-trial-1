import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Low-level geometry construction kit for creatures.
 *
 * There are no model files in this project, so every creature is assembled
 * from these primitives. The two rules that keep the results readable:
 *
 *  1. Big smooth forms first, small detail last. A creature reads at a
 *     hundred pixels or it does not read at all.
 *  2. Geometry is built in a canonical local space then baked into merged
 *     meshes per rig node, so a creature costs a handful of draw calls
 *     instead of sixty.
 */

/** Deterministic PRNG. Screenshots must be reproducible, so nothing uses Math.random. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

export interface Transform {
  pos?: [number, number, number];
  /** Euler XYZ in radians. */
  rot?: [number, number, number];
  scale?: [number, number, number] | number;
}

/** Apply a transform to a geometry in place and return it. */
export function xf(geo: THREE.BufferGeometry, t: Transform): THREE.BufferGeometry {
  _v.set(...(t.pos ?? [0, 0, 0]));
  _e.set(...(t.rot ?? [0, 0, 0]));
  _q.setFromEuler(_e);
  const sc = t.scale ?? 1;
  if (typeof sc === 'number') _s.set(sc, sc, sc);
  else _s.set(...sc);
  _m.compose(_v, _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}

/** Spherical UVs derived from the direction of each vertex from the origin. */
function sphericalUV(geo: THREE.BufferGeometry, from?: Float32Array) {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    let x: number, y: number, z: number;
    if (from) {
      x = from[i * 3];
      y = from[i * 3 + 1];
      z = from[i * 3 + 2];
    } else {
      x = pos.getX(i);
      y = pos.getY(i);
      z = pos.getZ(i);
    }
    const len = Math.hypot(x, y, z) || 1;
    uv[i * 2] = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = Math.asin(THREE.MathUtils.clamp(y / len, -1, 1)) / Math.PI + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export interface BlobOpts {
  /** Icosphere subdivision. 3 = 320 tris, 4 = 1280. */
  detail?: number;
  radius?: number;
  /**
   * Per-height cross-section modifier. `y` runs -1..1 up the unit sphere.
   * `w` scales X, `d` scales Z, `dz`/`dx` shift the section sideways.
   */
  profile?: (y: number) => { w?: number; d?: number; dz?: number; dx?: number; dy?: number };
  scaleY?: number;
  /** Flatten the -Z side, e.g. for a back that sits against a shell. */
  squashBack?: number;
}

/**
 * A deformed icosphere: the workhorse for torsos, heads, cheeks and haunches.
 *
 * An icosphere rather than a UV sphere because the triangles stay uniform
 * under heavy deformation and there is no pole pinch to fight.
 */
export function blob(opts: BlobOpts = {}): THREE.BufferGeometry {
  const raw = new THREE.IcosahedronGeometry(1, opts.detail ?? 3);
  raw.deleteAttribute('uv');
  raw.deleteAttribute('normal');
  const geo = mergeVertices(raw, 1e-5);
  raw.dispose();

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const original = new Float32Array(pos.array as Float32Array);
  const r = opts.radius ?? 1;
  const sy = opts.scaleY ?? 1;
  const profile = opts.profile;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    if (profile) {
      const p = profile(y);
      x *= p.w ?? 1;
      z *= p.d ?? 1;
      x += p.dx ?? 0;
      z += p.dz ?? 0;
      y += p.dy ?? 0;
    }
    if (opts.squashBack && z < 0) z *= 1 - opts.squashBack;
    pos.setXYZ(i, x * r, y * sy * r, z * r);
  }
  pos.needsUpdate = true;
  sphericalUV(geo, original);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Tube swept along a curve with a per-t radius. Tails, horns, necks, vines.
 * Radius is expected to reach ~0 at t=1 so the tip closes without a cap.
 */
export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  radiusAt: (t: number) => number,
  tubular = 24,
  radial = 10,
  capStart = true,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubular, false);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const p = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = Math.max(radiusAt(t), 1e-4);
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      positions.push(
        p.x + r * (cos * N.x + sin * B.x),
        p.y + r * (cos * N.y + sin * B.y),
        p.z + r * (cos * N.z + sin * B.z),
      );
      uvs.push(t, j / radial);
    }
  }
  for (let i = 1; i <= tubular; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = (radial + 1) * (i - 1) + (j - 1);
      const b = (radial + 1) * i + (j - 1);
      const c = (radial + 1) * i + j;
      const d = (radial + 1) * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }
  if (capStart) {
    const p = curve.getPointAt(0);
    const centre = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    uvs.push(0, 0);
    for (let j = 1; j <= radial; j++) indices.push(centre, j, j - 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Convenience: a curved horn / claw / quill lying along +Y, bending toward +Z. */
export function spike(
  length: number,
  baseRadius: number,
  bend = 0.3,
  tubular = 12,
  radial = 8,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, length * 0.34, bend * length * 0.06),
    new THREE.Vector3(0, length * 0.68, bend * length * 0.3),
    new THREE.Vector3(0, length, bend * length * 0.72),
  ]);
  return taperedTube(curve, (t) => baseRadius * Math.pow(1 - t, 0.72), tubular, radial);
}

/** Extrude a closed 2D outline into a solid plate in the XY plane. */
export function plate(
  points: Array<[number, number]>,
  thickness: number,
  bevel = thickness * 0.35,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(thickness - bevel * 2, 0.002),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/** Extrude a smooth closed outline given as spline control points. */
export function splinePlate(
  points: Array<[number, number]>,
  thickness: number,
  bevel = thickness * 0.4,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const curve = new THREE.SplineCurve(points.map((p) => new THREE.Vector2(p[0], p[1])));
  const pts = curve.getPoints(Math.max(24, points.length * 6));
  shape.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(thickness - bevel * 2, 0.002),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/** A leaf: pointed tip, rounded shoulders, lying along +Y with the stem at origin. */
export function leaf(length: number, width: number, thickness: number): THREE.BufferGeometry {
  const pts: Array<[number, number]> = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const w = Math.sin(Math.pow(t, 0.62) * Math.PI) * width * 0.5;
    pts.push([w, t * length]);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const w = Math.sin(Math.pow(t, 0.62) * Math.PI) * width * 0.5;
    pts.push([-w, t * length]);
  }
  return plate(pts, thickness, thickness * 0.42);
}

/** A cog: the signature Gearwood motif. Teeth are trapezoidal, not spiky. */
export function cog(
  radius: number,
  teeth: number,
  thickness: number,
  toothDepth = 0.22,
  hole = 0.3,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const inner = radius * (1 - toothDepth);
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts: Array<[number, number]> = [
      [inner, a + step * 0.06],
      [radius, a + step * 0.2],
      [radius, a + step * 0.42],
      [inner, a + step * 0.56],
      [inner, a + step * 0.94],
    ];
    for (const [r, ang] of pts) {
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0 && r === inner && ang === a + step * 0.06) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
  }
  shape.closePath();
  if (hole > 0) {
    const h = new THREE.Path();
    h.absarc(0, 0, radius * hole, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const bevel = thickness * 0.22;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 10,
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/** Brass pipe / boiler stack, open at the top. */
export function pipe(
  radius: number,
  height: number,
  flare = 1.35,
  segments = 14,
): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [];
  profile.push(new THREE.Vector2(0.001, 0));
  profile.push(new THREE.Vector2(radius * 1.18, 0));
  profile.push(new THREE.Vector2(radius * 1.18, height * 0.08));
  profile.push(new THREE.Vector2(radius * 0.92, height * 0.13));
  profile.push(new THREE.Vector2(radius * 0.92, height * 0.72));
  profile.push(new THREE.Vector2(radius * flare, height * 0.9));
  profile.push(new THREE.Vector2(radius * flare, height));
  profile.push(new THREE.Vector2(radius * flare * 0.8, height * 0.98));
  profile.push(new THREE.Vector2(radius * 0.72, height * 0.8));
  profile.push(new THREE.Vector2(0.001, height * 0.8));
  const geo = new THREE.LatheGeometry(profile, segments);
  geo.computeVertexNormals();
  return geo;
}

/** A ring band, e.g. a brass collar or a bracer. */
export function band(radius: number, tube: number, width: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radius + tube, radius + tube, width, 20, 1, true);
  const inner = new THREE.CylinderGeometry(radius, radius, width, 20, 1, true);
  inner.scale(1, 1, 1);
  const merged = mergeGeometries([geo, inner]);
  const out = merged ?? geo;
  out.computeVertexNormals();
  return out;
}

/* ------------------------------------------------------------------ */
/* Rig + baking                                                        */
/* ------------------------------------------------------------------ */

/**
 * Collects geometry per material for one animated node, then bakes it into
 * one mesh per material. A creature ends up at roughly 20 draw calls rather
 * than the 70+ it would cost as loose meshes.
 */
export class NodeBuilder {
  readonly object: THREE.Group;
  private readonly buckets = new Map<string, THREE.BufferGeometry[]>();

  constructor(name: string, parent?: THREE.Object3D) {
    this.object = new THREE.Group();
    this.object.name = name;
    if (parent) parent.add(this.object);
  }

  add(material: string, geo: THREE.BufferGeometry, transform?: Transform): this {
    const g = transform ? xf(geo, transform) : geo;
    const list = this.buckets.get(material);
    if (list) list.push(g);
    else this.buckets.set(material, [g]);
    return this;
  }

  /** Mirror a geometry across X and add both copies. */
  addMirrored(material: string, geo: THREE.BufferGeometry, transform?: Transform): this {
    const a = transform ? xf(geo.clone(), transform) : geo.clone();
    const b = transform ? xf(geo.clone(), transform) : geo.clone();
    b.scale(-1, 1, 1);
    // Flipping one axis reverses winding; re-index so faces still face out.
    const idx = b.getIndex();
    if (idx) {
      const arr = idx.array as Uint16Array | Uint32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const t = arr[i];
        arr[i] = arr[i + 2];
        arr[i + 2] = t;
      }
      idx.needsUpdate = true;
    }
    b.computeVertexNormals();
    geo.dispose();
    this.add(material, a);
    this.add(material, b);
    return this;
  }

  bake(materials: Record<string, THREE.Material>, out: THREE.BufferGeometry[]): void {
    for (const [key, list] of this.buckets) {
      const mat = materials[key];
      if (!mat) continue;
      let geo: THREE.BufferGeometry | null;
      if (list.length === 1) {
        geo = list[0];
      } else {
        for (const g of list) stripToPositionNormalUv(g);
        geo = mergeGeometries(list, false);
        for (const g of list) g.dispose();
      }
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${this.object.name}:${key}`;
      this.object.add(mesh);
      out.push(geo);
    }
    this.buckets.clear();
  }
}

/** mergeGeometries requires identical attribute sets; normalise to pos/normal/uv. */
function stripToPositionNormalUv(g: THREE.BufferGeometry) {
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.getAttribute('uv')) {
    const count = g.getAttribute('position').count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getIndex()) {
    const count = g.getAttribute('position').count;
    const idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
}
