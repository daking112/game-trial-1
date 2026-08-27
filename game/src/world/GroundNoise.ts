/**
 * Deterministic noise shared by the ground system.
 *
 * Two halves that must agree conceptually but not bit-exactly: a CPU value-noise
 * stack used to build the terrain heightfield (and therefore `heightAt`), and a
 * GLSL string library injected into the ground/road materials so surface detail
 * is evaluated per-pixel in world space instead of being baked into a tiling
 * canvas texture. Everything here is a pure function of position and a seed, so
 * screenshots are reproducible.
 */

/* ------------------------------------------------------------------ CPU side */

function ihash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

/** Quintic-interpolated value noise. Smooth second derivative -> no lattice creases. */
export function valueNoise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = ihash(xi, yi, seed);
  const b = ihash(xi + 1, yi, seed);
  const c = ihash(xi, yi + 1, seed);
  const d = ihash(xi + 1, yi + 1, seed);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}

/**
 * Fractal sum. Each octave is rotated by an off-axis angle so the lattice
 * alignment of the value noise never stacks up into visible grid streaks.
 */
export function fbm2(x: number, y: number, seed: number, octaves = 5, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let px = x;
  let py = y;
  const ca = 0.8;
  const sa = 0.6;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2(px, py, seed + o * 7919) * amp;
    norm += amp;
    amp *= gain;
    // rotate + scale by 2.03 (not exactly 2) to decorrelate the octaves
    const nx = (px * ca - py * sa) * 2.03;
    const ny = (px * sa + py * ca) * 2.03;
    px = nx + 37.1;
    py = ny - 11.7;
  }
  return sum / norm;
}

/** Ridged multifractal: sharp crests, rounded valleys. Reads as eroded rock. */
export function ridged2(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let px = x;
  let py = y;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(valueNoise2(px, py, seed + o * 6151) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    const nx = (px * 0.8 - py * 0.6) * 2.11;
    const ny = (px * 0.6 + py * 0.8) * 2.11;
    px = nx + 5.3;
    py = ny + 19.9;
  }
  return sum / norm;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----------------------------------------------------------------- GLSL side */

/**
 * Shared GLSL helpers. Injected verbatim into every ground material so the road
 * and the terrain sample the *same* noise basis -- that is what lets the dirt
 * halo the terrain paints around the road line up with the road's own ragged
 * edge instead of reading as two unrelated shapes.
 */
export const GROUND_GLSL = /* glsl */ `
float gnHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float gnValue(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = gnHash(i);
  float b = gnHash(i + vec2(1.0, 0.0));
  float c = gnHash(i + vec2(0.0, 1.0));
  float d = gnHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const mat2 GN_ROT = mat2(0.80, -0.60, 0.60, 0.80);

float gnFbm2(vec2 p) {
  float v = gnValue(p) * 0.6667;
  p = GN_ROT * p * 2.03;
  v += gnValue(p) * 0.3333;
  return v;
}

float gnFbm3(vec2 p) {
  float v = gnValue(p) * 0.5714;
  p = GN_ROT * p * 2.03; v += gnValue(p) * 0.2857;
  p = GN_ROT * p * 2.03; v += gnValue(p) * 0.1429;
  return v;
}

float gnFbm5(vec2 p) {
  float v = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 5; i++) {
    v += gnValue(p) * a;
    n += a;
    a *= 0.5;
    p = GN_ROT * p * 2.03 + vec2(19.1, -7.3);
  }
  return v / n;
}

/** F1 distance + a per-cell id. Used for pebbles and cobbles. */
vec2 gnVoronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(gnHash(n + g), gnHash(n + g + vec2(17.31, 9.17)));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f1 = d; id = gnHash(n + g + vec2(3.71, 1.33)); }
    }
  }
  return vec2(sqrt(f1), id);
}
`;
