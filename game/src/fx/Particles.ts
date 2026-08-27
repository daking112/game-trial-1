import * as THREE from 'three';

export interface BurstSpec {
  count: number;
  color: THREE.ColorRepresentation;
  /** Initial speed range. */
  speed: [number, number];
  /** Lifetime range in seconds. */
  life: [number, number];
  size: number;
  gravity?: number;
  /** 0 = spray in all directions, 1 = tight cone along `dir`. */
  focus?: number;
}

const MAX = 2400;

/**
 * GPU particle pool for impacts, deaths and muzzle flashes.
 *
 * One BufferGeometry with a single draw call for every particle in the game.
 * Spawning writes into free slots and the shader does the rest; the
 * alternative -- a Sprite per particle -- costs a draw call each and collapses
 * the frame rate the moment a wave dies at once.
 */
export class Particles {
  readonly points: THREE.Points;

  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly color: Float32Array;
  private readonly born: Float32Array;
  private readonly lifetime: Float32Array;
  private readonly size: Float32Array;
  private readonly gravity: Float32Array;
  private cursor = 0;
  private clock = 0;
  private rng: () => number;

  constructor(seed = 7) {
    let a = seed >>> 0;
    this.rng = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    this.position = new Float32Array(MAX * 3);
    this.velocity = new Float32Array(MAX * 3);
    this.color = new Float32Array(MAX * 3);
    this.born = new Float32Array(MAX).fill(-1e9);
    this.lifetime = new Float32Array(MAX).fill(1);
    this.size = new Float32Array(MAX);
    this.gravity = new Float32Array(MAX);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geo.setAttribute('aVelocity', new THREE.BufferAttribute(this.velocity, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    geo.setAttribute('aBorn', new THREE.BufferAttribute(this.born, 1));
    geo.setAttribute('aLifetime', new THREE.BufferAttribute(this.lifetime, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aGravity', new THREE.BufferAttribute(this.gravity, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3  aVelocity;
        attribute vec3  aColor;
        attribute float aBorn;
        attribute float aLifetime;
        attribute float aSize;
        attribute float aGravity;
        uniform   float uTime;
        uniform   float uScale;
        varying   vec3  vColor;
        varying   float vAlpha;

        void main() {
          float age = uTime - aBorn;
          float t = age / aLifetime;

          // Dead particles are collapsed to zero size rather than branched
          // around -- a discard here would still cost the vertex work.
          if (t < 0.0 || t > 1.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            vAlpha = 0.0;
            return;
          }

          vec3 pos = position + aVelocity * age;
          pos.y -= 0.5 * aGravity * age * age;

          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;

          // Shrink over life, and attenuate with distance so particles keep a
          // consistent world size instead of a constant pixel size.
          float shrink = 1.0 - t * t;
          // Clamped: without a ceiling, a burst close to the camera scales to
          // hundreds of pixels per particle and blows out to a solid disc.
          gl_PointSize = clamp(
            aSize * shrink * uScale * (300.0 / max(-mv.z, 0.001)),
            1.0, 46.0
          );

          vColor = aColor;
          vAlpha = shrink * smoothstep(0.0, 0.08, t);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3  vColor;
        varying float vAlpha;
        void main() {
          // Soft round sprite with a hot core.
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float falloff = 1.0 - smoothstep(0.0, 0.5, r);
          float core = pow(falloff, 3.0);
          gl_FragColor = vec4(vColor * (0.45 + core * 0.95), falloff * vAlpha * 0.85);
        }
      `,
    });

    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Emit a burst at a world position, optionally biased along `dir`. */
  burst(at: THREE.Vector3, spec: BurstSpec, dir?: THREE.Vector3) {
    const c = new THREE.Color(spec.color);
    const focus = spec.focus ?? 0;

    for (let i = 0; i < spec.count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;

      // Uniform point on a sphere, then bent toward `dir` by `focus`.
      const z = this.rng() * 2 - 1;
      const th = this.rng() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      let vx = r * Math.cos(th), vy = z, vz = r * Math.sin(th);
      if (dir && focus > 0) {
        vx = THREE.MathUtils.lerp(vx, dir.x, focus);
        vy = THREE.MathUtils.lerp(vy, dir.y, focus);
        vz = THREE.MathUtils.lerp(vz, dir.z, focus);
      }

      const speed = THREE.MathUtils.lerp(spec.speed[0], spec.speed[1], this.rng());
      const p3 = idx * 3;
      this.position[p3] = at.x; this.position[p3 + 1] = at.y; this.position[p3 + 2] = at.z;
      this.velocity[p3] = vx * speed;
      this.velocity[p3 + 1] = vy * speed;
      this.velocity[p3 + 2] = vz * speed;

      // Slight per-particle colour jitter so a burst does not read as one flat blob.
      const j = 0.85 + this.rng() * 0.3;
      this.color[p3] = c.r * j; this.color[p3 + 1] = c.g * j; this.color[p3 + 2] = c.b * j;

      this.born[idx] = this.clock;
      this.lifetime[idx] = THREE.MathUtils.lerp(spec.life[0], spec.life[1], this.rng());
      this.size[idx] = spec.size * (0.7 + this.rng() * 0.6);
      this.gravity[idx] = spec.gravity ?? 0;
    }

    const g = this.points.geometry;
    for (const name of ['position', 'aVelocity', 'aColor', 'aBorn', 'aLifetime', 'aSize', 'aGravity']) {
      (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  update(dt: number) {
    this.clock += dt;
    (this.points.material as THREE.ShaderMaterial).uniforms.uTime.value = this.clock;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
