import * as THREE from 'three';

/**
 * Cloud shadows on the ground.
 *
 * A sky full of cumulus over a landscape lit at one uniform brightness is the
 * single most common tell that a scene was assembled rather than observed. The
 * clouds are stated as objects with volume and then cast nothing, so the ground
 * reads as a flat carpet no matter how good the terrain material is.
 *
 * This is deliberately not a real shadow map. It is the same density field the
 * sky's cumulus deck uses, sampled on the ground plane at a coarser scale, and
 * it buys three things a shadow map would not:
 *
 *  - it costs two noise fetches and no extra draw call, on a field that is
 *    already compiled into these shaders;
 *  - it covers the whole apron out to the far ridges, which no shadow frustum
 *    sized for gameplay could ever reach;
 *  - the strength is a knob. Real cloud shadows at real contrast would swallow
 *    a third of the playfield, and readability is not negotiable here, so this
 *    sits at a value the eye reads as "broad shade" and the player never reads
 *    as "I cannot see the path".
 *
 * The sample point is pushed along the sun ray up to the deck altitude, so the
 * patch lands where a cloud at that altitude would actually block the light
 * rather than directly overhead.
 */

export interface CloudShadowConfig {
  /** Unit vector pointing at the sun. */
  sunDir: THREE.Vector3;
  /** Altitude of the casting deck, world units. */
  deckY: number;
  /** Feature size: 1 / world units. Larger = smaller, busier patches. */
  scale: number;
  /** Density threshold; matches the sky deck's `cover`. */
  cover: number;
  /** How far into shade a fully covered patch goes, 0..1. */
  strength: number;
}

const f = (n: number) => n.toFixed(5);

/**
 * GLSL declaring `float cloudShadow(vec3 worldPos)`.
 *
 * Depends on `gnFbm3` / `gnFbm5` from `GROUND_GLSL`, which must be included
 * ahead of it in the same shader.
 */
export function cloudShadowGlsl(cfg: CloudShadowConfig): string {
  const s = cfg.sunDir.clone().normalize();
  // Horizontal offset from a ground point to where its sun ray crosses the deck.
  const ox = (-s.x / Math.max(s.y, 0.08)) * cfg.deckY;
  const oz = (-s.z / Math.max(s.y, 0.08)) * cfg.deckY;

  return /* glsl */ `
    const vec2  CS_OFFSET   = vec2(${f(ox)}, ${f(oz)});
    const float CS_SCALE    = ${f(cfg.scale)};
    const float CS_COVER    = ${f(cfg.cover)};
    const float CS_STRENGTH = ${f(cfg.strength)};

    float cloudShadow(vec3 wp) {
      vec2 p = (wp.xz + CS_OFFSET * (1.0 - wp.y / ${f(Math.max(cfg.deckY, 1))})) * CS_SCALE;
      float base   = gnFbm5(p);
      float billow = 1.0 - abs(gnFbm3(p * 2.31 + vec2(7.3, -2.1)) * 2.0 - 1.0);
      float d = base * 0.66 + billow * 0.28 + 0.06;
      return 1.0 - smoothstep(CS_COVER, CS_COVER + 0.20, d) * CS_STRENGTH;
    }
  `;
}

/** The rig the ground materials compile against. Set once, before first compile. */
let current: CloudShadowConfig = {
  sunDir: new THREE.Vector3(-0.84, 0.5, -0.21).normalize(),
  deckY: 90,
  scale: 0.0165,
  cover: 0.505,
  strength: 0.19,
};

export function configureCloudShadow(cfg: Partial<CloudShadowConfig>) {
  current = { ...current, ...cfg };
}

export function cloudShadowSource(): string {
  return cloudShadowGlsl(current);
}

/** Cache-key fragment so two rigs never share a compiled program. */
export function cloudShadowKey(): string {
  const c = current;
  return `${c.sunDir.x.toFixed(2)}_${c.deckY}_${c.scale}_${c.cover}_${c.strength}`;
}
