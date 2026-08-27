import * as THREE from 'three';
import type { Engine } from './Engine';

export interface PoseRequest {
  position?: [number, number, number];
  target?: [number, number, number];
  fov?: number;
}

export interface DebugApi {
  ready: boolean;
  engine: Engine;
  /** Advance the sim by a fixed number of frames at a fixed dt. */
  advance(seconds: number, fps?: number): void;
  /** Move the camera and look at a target. */
  pose(req: PoseRequest): void;
  /** Render a single frame from current state. */
  draw(): void;
  /** Reset the sim clock so captures are reproducible. */
  reset(): void;
  stats(): Record<string, number>;
}

/**
 * Exposes a deterministic control surface on `window.__game`.
 *
 * The screenshot harness drives the game through this rather than sleeping and
 * hoping: `advance(2)` always produces the exact same frame, so a critic
 * comparing two runs is looking at a real change in the render and not at
 * animation phase jitter.
 */
export function installDebugApi(engine: Engine): DebugApi {
  const api: DebugApi = {
    ready: false,
    engine,

    advance(seconds: number, fps = 60) {
      const dt = 1 / fps;
      const frames = Math.max(1, Math.round(seconds * fps));
      // Logic only -- the caller renders once when the pose is final.
      for (let i = 0; i < frames; i++) engine.stepLogic(dt);
    },

    draw() {
      engine.render();
    },

    pose(req: PoseRequest) {
      if (req.position) engine.camera.position.set(...req.position);
      if (req.fov !== undefined) {
        engine.camera.fov = req.fov;
        engine.camera.updateProjectionMatrix();
      }
      if (req.target) engine.camera.lookAt(new THREE.Vector3(...req.target));
      engine.camera.updateMatrixWorld(true);
    },

    reset() {
      engine.elapsed = 0;
    },

    stats() {
      const info = engine.renderer.info;
      return {
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        programs: info.programs?.length ?? 0,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        elapsed: engine.elapsed,
      };
    },
  };

  (window as unknown as { __game: DebugApi }).__game = api;
  return api;
}
