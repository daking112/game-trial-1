import * as THREE from 'three';

/**
 * Procedural texture generation.
 *
 * There is no image-generation service wired into this project, so every
 * texture in the game is synthesised here on a 2D canvas and uploaded. That
 * constraint is not purely a downside: these are tileable by construction,
 * cost nothing to download, and can be re-tinted per species from one source.
 */

/** Deterministic value-noise, so a given seed always yields the same texture. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { c, ctx };
}

/** Tileable fractal value noise as a Float32 grid in [0,1]. */
export function fbmGrid(size: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;

  for (let o = 0; o < octaves; o++) {
    const freq = 2 ** o * 4;
    const rnd = mulberry32(seed + o * 7919);
    // Lattice of random values at this frequency, wrapping for tileability.
    const lat = new Float32Array(freq * freq);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * freq;
        const fy = (y / size) * freq;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        // Smoothstep interpolation - linear lattice noise looks like diamonds.
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const i00 = (y0 % freq) * freq + (x0 % freq);
        const i10 = (y0 % freq) * freq + ((x0 + 1) % freq);
        const i01 = ((y0 + 1) % freq) * freq + (x0 % freq);
        const i11 = ((y0 + 1) % freq) * freq + ((x0 + 1) % freq);
        const top = lat[i00] + (lat[i10] - lat[i00]) * sx;
        const bot = lat[i01] + (lat[i11] - lat[i01]) * sx;
        out[y * size + x] += (top + (bot - top) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }

  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * Derive a normal map from a height grid by central differences.
 * `strength` scales the slope; higher reads as deeper relief.
 */
export function normalFromHeight(height: Float32Array, size: number, strength = 2.5): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Normalised tangent-space normal, packed to [0,255].
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export interface GroundTextureOptions {
  size?: number;
  seed?: number;
  /** Base earth colour. */
  base?: THREE.Color;
  /** Colour of the mossy overgrowth mixed on top. */
  moss?: THREE.Color;
}

/** Forest-floor albedo + matching normal map. */
export function groundTextures(opts: GroundTextureOptions = {}) {
  const size = opts.size ?? 512;
  const seed = opts.seed ?? 1337;
  const base = opts.base ?? new THREE.Color('#8a7248');
  const moss = opts.moss ?? new THREE.Color('#79b04a');

  const coarse = fbmGrid(size, 5, seed);
  const patch = fbmGrid(size, 3, seed + 501);
  const { c, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const col = new THREE.Color();

  for (let i = 0; i < size * size; i++) {
    // Blend moss over earth in broad patches, then break it up with detail.
    const m = THREE.MathUtils.smoothstep(patch[i], 0.42, 0.72);
    col.copy(base).lerp(moss, m);
    const shade = 0.72 + coarse[i] * 0.56;
    const p = i * 4;
    img.data[p] = Math.min(255, col.r * 255 * shade);
    img.data[p + 1] = Math.min(255, col.g * 255 * shade);
    img.data[p + 2] = Math.min(255, col.b * 255 * shade);
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const normalMap = normalFromHeight(coarse, size, 3.0);
  return { map, normalMap };
}
