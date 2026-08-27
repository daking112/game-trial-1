import * as THREE from 'three';
import { createRoadMaterial } from './GroundMaterial';
import { valueNoise2, fbm2 } from './GroundNoise';

/**
 * The enemy path.
 *
 * A single Catmull-Rom curve is the source of truth for three things: the
 * ribbon mesh drawn on the ground, the height/flattening applied to the
 * terrain underneath it, and the positions enemies interpolate along. Deriving
 * all three from one curve is what keeps enemies visually planted on the road
 * instead of drifting off the side of it.
 *
 * The ribbon is not a flat decal. It is crowned in the middle and dropped below
 * grade at the edges, so the alpha cut of the road surface happens *underneath*
 * the surrounding grass line rather than on top of it — that, plus the worn
 * dirt the terrain material independently paints along the same corridor, is
 * what makes the verge read as a real transition instead of a blend edge.
 */
export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly width: number;
  /** Arc-length lookup so enemies move at constant speed, not constant t. */
  private readonly lengths: number[] = [];
  readonly totalLength: number;

  constructor(points: THREE.Vector3[], width = 3.0, texture?: THREE.Texture) {
    this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    this.width = width;

    const SEGMENTS = 480;
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

    this.material = createRoadMaterial({ halfWidth: width * 0.5 });
    // A caller-supplied texture is honoured for compatibility, but the surface
    // is generated in the shader; the map only tints it.
    if (texture) this.material.map = texture;

    this.mesh = new THREE.Mesh(this.buildRibbon(SEGMENTS, width), this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'track';
  }

  /**
   * Ribbon geometry.
   *
   * Five spans across the width rather than two, so the road can carry a real
   * cross-section: a crowned centre, a shoulder either side, and a lip that
   * sits below grade. The extra vertices also give the verge somewhere to
   * catch light, which a two-vertex strip cannot do at all.
   */
  private buildRibbon(segments: number, width: number): THREE.BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);

    // Cross-section: fraction of half-width, and height offset in world units.
    // Centre crown at +0.04, shoulders level, lip buried under the grass line.
    const profile: Array<[number, number]> = [
      [-1.0, -0.16],
      [-0.72, -0.02],
      [-0.34, 0.025],
      [0.0, 0.045],
      [0.34, 0.025],
      [0.72, -0.02],
      [1.0, -0.16],
    ];
    const lanes = profile.length;

    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const side = new THREE.Vector3();

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      this.curve.getPoint(t, p);
      this.curve.getTangent(t, tan).setY(0).normalize();
      side.crossVectors(tan, up).normalize();

      const along = t * this.totalLength;

      // Width wanders over tens of metres so no stretch of road is a constant
      // ribbon. Deterministic: pure function of arc length.
      const wobble = (fbm2(along * 0.055, 4.7, 5501, 3) - 0.5) * 0.30
                   + (valueNoise2(along * 0.31, 1.3, 9109) - 0.5) * 0.12;
      // Ease the very ends in so the road does not stop on a hard rectangle.
      const taper = Math.min(1, 0.25 + THREE.MathUtils.smoothstep(t, 0, 0.05))
                  * Math.min(1, 0.25 + THREE.MathUtils.smoothstep(1 - t, 0, 0.05));
      const w = width * 0.5 * (1.0 + wobble) * taper;

      for (let l = 0; l < lanes; l++) {
        const [frac, dy] = profile[l];
        pos.push(
          p.x + side.x * frac * w,
          p.y + dy,
          p.z + side.z * frac * w,
        );
        uv.push((frac + 1) * 0.5, along);
      }

      if (i < segments) {
        const a = i * lanes;
        const b = (i + 1) * lanes;
        for (let l = 0; l < lanes - 1; l++) {
          idx.push(a + l, a + l + 1, b + l, a + l + 1, b + l + 1, b + l);
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
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
    this.material.dispose();
  }
}
