import * as THREE from 'three';
import type { Engine } from './Engine';

export interface PoseRequest {
  position?: [number, number, number];
  target?: [number, number, number];
  fov?: number;
}

export interface FrameProfile {
  medianMs: number;
  meanMs: number;
  minMs: number;
  /** Worst frame in the window. This is the number a player feels as a hitch. */
  maxMs: number;
  /** 95th percentile -- worst-case that is not a one-off outlier. */
  p95Ms: number;
  frames: number;
}

export interface PassBreakdown {
  /** Full frame as the game actually runs it: stepLogic + full post chain. */
  frame: FrameProfile;
  /** Draw only, static scene, full post chain. */
  render: FrameProfile;
  /** stepLogic only, nothing drawn. */
  logic: FrameProfile;
  /**
   * Per-pass cost in ms, measured leave-one-out: disable exactly one pass and
   * subtract. Attribution, not a cumulative budget -- the parts need not sum to
   * the whole, and a value near zero means that pass is genuinely not the
   * problem.
   */
  passMs: Record<string, number>;
  /**
   * Absolute median ms for every configuration measured, keyed 'full',
   * 'no-bloom', 'main-only' and so on. The deltas above are derived from
   * these; when a delta looks impossible, read these to see why.
   */
  configMs: Record<string, number>;
  /** Composer with every post pass off: raw geometry rasterisation. */
  mainOnlyMs: number;
  /**
   * Cost of rendering the shadow map, measured by disabling it. Lit materials
   * keep their shadow-sampling code (their compiled programs are cached), so
   * this is the depth-only shadow render, not the cost of sampling shadows.
   */
  shadowMs: number;
  /** Pixel size the sweep ran at, which may be below the display size. */
  sweepWidth: number;
  sweepHeight: number;
  /**
   * True when each sample was forced to completion with a readPixels sync.
   * Without this a "frame time" measures only how fast JS handed commands to
   * the driver, which under any async GL backend is a fiction.
   */
  synced: boolean;
}

/** The subset of CameraRig the harness drives. Kept structural to avoid a
 *  circular import between the rig and this control surface. */
export interface RigHandle {
  update(dt: number): void;
  setEdgePan(enabled: boolean): void;
  readonly wasDrag: boolean;
  readonly touchCount: number;
  readonly currentDistance: number;
  target: THREE.Vector3;
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
  /** Median/min/max frame time in ms over a burst of full renders. */
  profile(frames?: number): FrameProfile;
  /** Frame time attributed to logic, geometry and each individual post pass. */
  profilePasses(opts?: {
    frames?: number;
    rounds?: number;
    warmup?: number;
    /** Render the sweep at this fraction of the display size. */
    scale?: number;
  }): PassBreakdown;
  /** Reset the sim clock so captures are reproducible. */
  reset(): void;
  stats(): Record<string, number>;
  /** The live camera rig, once one has been constructed. */
  rig?: RigHandle;
}

/**
 * Publish the camera rig on the debug surface.
 *
 * The rig is constructed in main.ts, which individual agents must not edit, so
 * it registers itself here instead. tools/test-touch.mjs needs a handle on it
 * to assert things that are not observable from the camera transform alone --
 * whether edge-pan is off by default, most obviously.
 */
export function registerRig(rig: RigHandle) {
  const w = window as unknown as { __game?: DebugApi; __rig?: RigHandle };
  w.__rig = rig;
  if (w.__game) w.__game.rig = rig;
}


/**
 * Force every queued GL command to complete.
 *
 * WebGL command submission is asynchronous: `performance.now()` around a
 * `composer.render()` measures how long JS took to hand work to the driver,
 * which is not the frame time and moves independently of it. A 1x1 readPixels
 * on the bound framebuffer is the cheapest portable full pipeline barrier --
 * `gl.finish()` is advisory and several backends treat it as a no-op.
 */
function makeSync(renderer: THREE.WebGLRenderer): () => void {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  return () => {
    try {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    } catch {
      gl.finish();
    }
  };
}

let syncGpuImpl: () => void = () => {};
function syncGpu() { syncGpuImpl(); }

/** Time `body` over `n` iterations, discarding `drop` warm-up iterations. */
function sample(n: number, drop: number, body: () => void, gpu = true): number[] {
  const out: number[] = [];
  for (let i = 0; i < n + drop; i++) {
    const t0 = performance.now();
    body();
    if (gpu) syncGpu();
    const ms = performance.now() - t0;
    if (i >= drop) out.push(ms);
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function summarise(xs: number[]): FrameProfile {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    medianMs: +median(s).toFixed(2),
    meanMs: +mean.toFixed(2),
    minMs: +s[0].toFixed(2),
    maxMs: +s[s.length - 1].toFixed(2),
    p95Ms: +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(2),
    frames: s.length,
  };
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
  syncGpuImpl = makeSync(engine.renderer);

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
      // renderer.info reflects only the most recent draw, which after a
      // composer run is the final fullscreen post quad -- hence the useless
      // "1 call, 1 triangle" it reported before. Rendering the scene once
      // directly gives the real geometry cost.
      engine.renderer.setRenderTarget(null);
      engine.renderer.render(engine.scene, engine.camera);
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

    /** Median frame time in ms over `frames` full composer renders. */
    profile(frames = 24) {
      return summarise(sample(frames, 3, () => {
        engine.stepLogic(1 / 60);
        engine.render();
      }));
    },

    profilePasses(opts = {}) {
      const frames = opts.frames ?? 6;
      const rounds = opts.rounds ?? 3;
      const warmup = opts.warmup ?? 3;
      const scale = opts.scale ?? 1;
      const list = engine.passes;
      const was = list.map((p) => p.pass.enabled);
      const wasToScreen = engine.composer.renderToScreen;
      const wasShadow = engine.renderer.shadowMap.enabled;
      const size = engine.renderer.getSize(new THREE.Vector2());

      try {
        // --- headline numbers, at the real display resolution ---------------
        for (let i = 0; i < warmup; i++) { engine.render(); syncGpu(); }
        const frame = summarise(sample(frames * rounds, 2, () => {
          engine.stepLogic(1 / 60);
          engine.render();
        }));
        const logic = summarise(sample(frames * rounds, 2, () => {
          engine.stepLogic(1 / 60);
        }, false));
        const render = summarise(sample(frames * rounds, 2, () => engine.render()));

        // --- attribution sweep ----------------------------------------------
        // Every configuration must render into an offscreen target.
        // EffectComposer hands renderToScreen to whichever pass is LAST
        // ENABLED, so disabling a pass silently promotes its neighbour onto the
        // canvas -- a different and, with preserveDrawingBuffer on, far more
        // expensive path. Leaving that in made leave-one-out produce
        // impossibilities like one pass costing more than the whole frame.
        engine.composer.renderToScreen = false;

        const sw = Math.max(2, Math.round(size.x * scale));
        const sh = Math.max(2, Math.round(size.y * scale));
        if (scale !== 1) engine.setSize(sw, sh);
        for (let i = 0; i < warmup; i++) { engine.render(); syncGpu(); }

        const all = (on: boolean) => { for (const p of list) p.pass.enabled = on; };
        const runs: Record<string, number[]> = {};
        const take = (key: string) => {
          (runs[key] ??= []).push(median(sample(frames, 1, () => engine.render())));
        };

        // Interleaved across rounds, so a slow patch of wall-clock hits every
        // configuration equally instead of libelling whichever one happened to
        // be measured during it.
        for (let r = 0; r < rounds; r++) {
          all(true);
          take('full');

          for (const p of list) {
            p.pass.enabled = false;
            take(`no-${p.name}`);
            p.pass.enabled = true;
          }

          for (const p of list) p.pass.enabled = p.name === 'main';
          take('main-only');
          all(true);

          engine.renderer.shadowMap.enabled = false;
          engine.render(); syncGpu();
          take('no-shadow');
          engine.renderer.shadowMap.enabled = wasShadow;
          engine.render(); syncGpu();
        }

        const configMs: Record<string, number> = {};
        for (const k of Object.keys(runs)) configMs[k] = +median(runs[k]).toFixed(2);

        const passMs: Record<string, number> = {};
        for (const p of list) passMs[p.name] = +(configMs.full - configMs[`no-${p.name}`]).toFixed(2);

        return {
          frame, render, logic, passMs, configMs,
          mainOnlyMs: configMs['main-only'],
          shadowMs: +(configMs.full - configMs['no-shadow']).toFixed(2),
          sweepWidth: sw, sweepHeight: sh,
          synced: true,
        };
      } finally {
        list.forEach((p, i) => { p.pass.enabled = was[i]; });
        engine.composer.renderToScreen = wasToScreen;
        engine.renderer.shadowMap.enabled = wasShadow;
        if (scale !== 1) engine.setSize(size.x, size.y);
        engine.render();
      }
    },
  };

  const w = window as unknown as { __game: DebugApi; __rig?: RigHandle };
  // A rig built before the api existed still gets attached.
  if (w.__rig) api.rig = w.__rig;
  w.__game = api;
  return api;
}
