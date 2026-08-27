import * as THREE from 'three';

/**
 * The enemy path.
 *
 * A single Catmull-Rom curve is the source of truth for three things: the
 * ribbon mesh drawn on the ground, the height/flattening applied to the
 * terrain underneath it, and the positions enemies interpolate along. Deriving
 * all three from one curve is what keeps enemies visually planted on the road
 * instead of drifting off the side of it.
 */
export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly mesh: THREE.Mesh;
  /** Arc-length lookup so enemies move at constant speed, not constant t. */
  private readonly lengths: number[] = [];
  readonly totalLength: number;

  constructor(points: THREE.Vector3[], width = 3.0, texture?: THREE.Texture) {
    this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);

    const SEGMENTS = 400;
    // Build the arc-length table once; sampling the curve is not cheap.
    let acc = 0;
    let prev = this.curve.getPoint(0);
    this.lengths.push(0);
    for (let i = 1; i <= SEGMENTS; i++) {
      const p = this.curve.getPoint(i / SEGMENTS);
      acc += p.distanceTo(prev);
      this.lengths.push(acc);
      prev = p;
    }
    this.totalLength = acc;

    this.mesh = new THREE.Mesh(
      this.buildRibbon(SEGMENTS, width),
      new THREE.MeshStandardMaterial({
        map: texture ?? null,
        color: texture ? '#ffffff' : '#6b5334',
        roughness: 0.94,
        metalness: 0.0,
        transparent: true,
        // Lift the ribbon off the terrain to avoid z-fighting without a
        // visible gap at grazing camera angles.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.mesh.receiveShadow = true;
    this.mesh.name = 'track';
  }

  private buildRibbon(segments: number, width: number): THREE.BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const norm: number[] = [];
    const idx: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = this.curve.getPoint(t);
      const tan = this.curve.getTangent(t).setY(0).normalize();
      const side = new THREE.Vector3().crossVectors(tan, up).normalize();

      // Taper the road slightly at both ends so it fades in rather than
      // stopping at a hard rectangular edge.
      const taper = Math.min(1, THREE.MathUtils.smoothstep(t, 0, 0.03) + 0.001) *
                    Math.min(1, THREE.MathUtils.smoothstep(1 - t, 0, 0.03) + 0.001);
      const w = (width * 0.5) * (0.85 + 0.15 * Math.sin(t * 22.0)) * Math.max(taper, 0.55);

      const l = new THREE.Vector3().copy(p).addScaledVector(side, -w);
      const r = new THREE.Vector3().copy(p).addScaledVector(side, w);
      pos.push(l.x, l.y, l.z, r.x, r.y, r.z);
      norm.push(0, 1, 0, 0, 1, 0);
      const v = t * this.totalLength * 0.25;
      uv.push(0, v, 1, v);

      if (i < segments) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  /** Convert a distance travelled (world units) into a curve parameter. */
  distanceToT(distance: number): number {
    const d = THREE.MathUtils.clamp(distance, 0, this.totalLength);
    const n = this.lengths.length - 1;
    // Binary search the arc-length table.
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.lengths[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const seg = this.lengths[i] - this.lengths[i - 1];
    const frac = seg > 1e-6 ? (d - this.lengths[i - 1]) / seg : 0;
    return (i - 1 + frac) / n;
  }

  pointAtDistance(distance: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.curve.getPoint(this.distanceToT(distance)));
  }

  tangentAtDistance(distance: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.curve.getTangent(this.distanceToT(distance)));
  }

  /** Shortest distance from a world-space point to the path centreline. */
  distanceToPath(point: THREE.Vector3, samples = 160): number {
    let best = Infinity;
    const p = new THREE.Vector3();
    for (let i = 0; i <= samples; i++) {
      this.curve.getPoint(i / samples, p);
      const d = p.distanceTo(point);
      if (d < best) best = d;
    }
    return best;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
