import * as THREE from 'three';
import { fbmGrid, normalFromHeight } from '../core/Textures';

/**
 * Procedural surface detail for creatures.
 *
 * Colour blocking does the heavy lifting on these designs -- the flat blocks
 * are what makes the silhouette read -- so these textures are deliberately
 * quiet. They exist to stop large single-colour forms from looking like
 * untextured primitives under a strong key light, nothing more.
 */

const cache = new Map<string, unknown>();
function memo<T>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const made = make();
  cache.set(key, made);
  return made;
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { c, ctx };
}

export type HideStyle = 'fur' | 'scale' | 'bark' | 'plate' | 'smooth';

/**
 * Albedo mottle + matching normal for a hide. The albedo is near-white so it
 * multiplies against the material colour rather than replacing it: one texture
 * per style serves every species that uses it.
 */
export function hideTextures(style: HideStyle, seed: number) {
  return memo(`hide:${style}:${seed}`, () => {
    const size = 256;
    const { c, ctx } = canvas(size);
    const coarse = fbmGrid(size, 4, seed);
    const fine = fbmGrid(size, 6, seed + 91);
    const img = ctx.createImageData(size, size);

    // Height field the normal map is derived from; built alongside the albedo
    // so lighting relief and colour variation agree with each other.
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        let h = 0;
        let tint = 0;
        switch (style) {
          case 'fur': {
            // Directional streaks: fine noise sheared along v.
            const s = fine[((y + Math.floor(coarse[i] * 12)) % size) * size + x];
            h = s * 0.7 + coarse[i] * 0.3;
            tint = (h - 0.5) * 0.30;
            break;
          }
          case 'scale': {
            // Overlapping rows of arcs.
            const rows = 26;
            const fy = (y / size) * rows;
            const row = Math.floor(fy);
            const off = row % 2 === 0 ? 0 : 0.5;
            const fx = (x / size) * rows + off;
            const cx = fx - Math.floor(fx) - 0.5;
            const cy = fy - row - 0.5;
            const d = Math.hypot(cx, cy * 1.15);
            h = THREE.MathUtils.smoothstep(0.5 - d, 0.0, 0.28) * 0.8 + coarse[i] * 0.2;
            tint = (h - 0.55) * 0.26;
            break;
          }
          case 'bark': {
            // Vertical fibres broken by knots.
            const v = fine[(y % size) * size + ((x + Math.floor(fine[i] * 24)) % size)];
            const ridge = Math.abs(Math.sin((x / size) * 46 + coarse[i] * 7));
            h = ridge * 0.55 + v * 0.45;
            tint = (h - 0.5) * 0.42;
            break;
          }
          case 'plate': {
            // Brushed metal: strong anisotropic streaking, very low relief.
            const v = fine[(y % size) * size + x];
            h = 0.5 + (v - 0.5) * 0.5;
            tint = (h - 0.5) * 0.18;
            break;
          }
          default: {
            h = 0.5 + (coarse[i] - 0.5) * 0.4;
            tint = (h - 0.5) * 0.14;
          }
        }
        height[i] = h;
        const l = THREE.MathUtils.clamp(1 + tint, 0.62, 1.28);
        const p = i * 4;
        img.data[p] = Math.min(255, 255 * l);
        img.data[p + 1] = Math.min(255, 255 * l);
        img.data[p + 2] = Math.min(255, 255 * l);
        img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const map = new THREE.CanvasTexture(c);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;

    const strengthByStyle: Record<HideStyle, number> = {
      fur: 1.6,
      scale: 3.4,
      bark: 3.0,
      plate: 1.0,
      smooth: 0.8,
    };
    const normalMap = normalFromHeight(height, size, strengthByStyle[style]);
    return { map, normalMap };
  });
}

/**
 * Radial iris texture for the eye lens. The bright limbal ring and the darker
 * outer edge are what stop a coloured sphere from reading as a bead.
 */
export function irisTexture(colour: THREE.ColorRepresentation, seed = 7) {
  const key = `iris:${new THREE.Color(colour).getHexString()}:${seed}`;
  return memo(key, () => {
    const size = 128;
    const { c, ctx } = canvas(size);
    const base = new THREE.Color(colour);
    const bright = base.clone().lerp(new THREE.Color('#ffffff'), 0.45);
    const deep = base.clone().multiplyScalar(0.28);

    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, `#${deep.getHexString()}`);
    g.addColorStop(0.4, `#${base.getHexString()}`);
    g.addColorStop(0.78, `#${bright.getHexString()}`);
    g.addColorStop(1, `#${deep.getHexString()}`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    // Fibre striations, seeded so the texture is identical every run.
    let a = seed >>> 0;
    const rnd = () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = `#${deep.getHexString()}`;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 56; i++) {
      const ang = (i / 56) * Math.PI * 2 + rnd() * 0.06;
      ctx.beginPath();
      ctx.moveTo(size / 2 + Math.cos(ang) * size * 0.16, size / 2 + Math.sin(ang) * size * 0.16);
      ctx.lineTo(size / 2 + Math.cos(ang) * size * 0.5, size / 2 + Math.sin(ang) * size * 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/** Release everything the cache holds. Only used when tearing the game down. */
export function disposeCreatureTextures() {
  for (const v of cache.values()) {
    const rec = v as Record<string, unknown>;
    if (rec && typeof rec === 'object') {
      for (const t of Object.values(rec)) {
        if (t instanceof THREE.Texture) t.dispose();
      }
    }
    if (v instanceof THREE.Texture) v.dispose();
  }
  cache.clear();
}
