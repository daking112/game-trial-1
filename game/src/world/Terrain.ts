import * as THREE from 'three';
import { fbmGrid, groundTextures } from '../core/Textures';
import type { Track } from './Track';

export interface TerrainOptions {
  size?: number;
  resolution?: number;
  amplitude?: number;
  seed?: number;
}

/**
 * Displaced ground plane.
 *
 * The heightfield is flattened in a band around the track so the road never
 * clips through a hill, with a smooth falloff either side that reads as the
 * path having been worn into the slope.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly size: number;
  private readonly res: number;
  private readonly heights: Float32Array;

  constructor(track: Track | null, opts: TerrainOptions = {}) {
    this.size = opts.size ?? 80;
    this.res = opts.resolution ?? 192;
    const amplitude = opts.amplitude ?? 2.4;
    const seed = opts.seed ?? 24601;

    const geo = new THREE.PlaneGeometry(this.size, this.size, this.res - 1, this.res - 1);
    geo.rotateX(-Math.PI / 2);

    const noise = fbmGrid(this.res, 5, seed);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    this.heights = new Float32Array(this.res * this.res);
    const world = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      world.set(pos.getX(i), 0, pos.getZ(i));
      let h = (noise[i % noise.length] - 0.5) * 2 * amplitude;

      // Roll the edges of the map upward into a shallow bowl so the player
      // never sees the terrain end in mid-air.
      const edge = Math.max(Math.abs(world.x), Math.abs(world.z)) / (this.size * 0.5);
      h += THREE.MathUtils.smoothstep(edge, 0.86, 1.0) * 2.0;

      if (track) {
        // Flatten toward path height near the road.
        const d = track.distanceToPath(world, 90);
        const flatten = 1 - THREE.MathUtils.smoothstep(d, 2.0, 6.5);
        h = THREE.MathUtils.lerp(h, -0.06, flatten);
      }

      pos.setY(i, h);
      this.heights[i] = h;
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const { map, normalMap } = groundTextures({ seed });
    map.repeat.set(10, 10);
    normalMap.repeat.set(14, 14);

    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        map,
        normalMap,
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: 0.96,
        metalness: 0.0,
      }),
    );
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain';
  }

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

  dispose() {
    this.mesh.geometry.dispose();
    const m = this.mesh.material as THREE.MeshStandardMaterial;
    m.map?.dispose();
    m.normalMap?.dispose();
    m.dispose();
  }
}
