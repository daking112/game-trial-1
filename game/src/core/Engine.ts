import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GradePass } from './GradePass';

/**
 * Core render engine. Owns the renderer, scene, camera and the post chain.
 *
 * Frame stepping is deliberately split from wall-clock time: `step(dt)` advances
 * the world by an exact amount so the screenshot harness can produce identical
 * frames every run. `start()` drives it from rAF for interactive play.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;

  /** Seconds of simulated time since start. Advanced only by step(). */
  elapsed = 0;

  private readonly updaters: Array<(dt: number, elapsed: number) => void> = [];
  private raf = 0;
  private lastTime = 0;
  private disposed = false;

  constructor(container: HTMLElement) {
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // SMAA in the post chain handles this
      powerPreference: 'high-performance',
      stencil: false,
      // Required so the screenshot harness can read the backbuffer after a
      // frame has been presented.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);

    // Filmic response + correct sRGB output. Without these the whole image
    // reads flat and washed out no matter how good the assets are.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      500,
    );

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.45, // strength
      0.7, // radius
      0.85, // threshold
    );
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradePass);
    this.composer.addPass(this.grade);

    const smaa = new SMAAPass(container.clientWidth, container.clientHeight);
    this.composer.addPass(smaa);

    this.setSize(container.clientWidth, container.clientHeight);
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    const el = this.renderer.domElement.parentElement;
    if (!el) return;
    this.setSize(el.clientWidth, el.clientHeight);
  };

  setSize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
    const u = this.grade.uniforms as Record<string, { value: unknown }>;
    if (u.resolution) u.resolution.value = new THREE.Vector2(width, height);
  }

  /** Register a per-frame update. Returns an unsubscribe function. */
  onUpdate(fn: (dt: number, elapsed: number) => void): () => void {
    this.updaters.push(fn);
    return () => {
      const i = this.updaters.indexOf(fn);
      if (i >= 0) this.updaters.splice(i, 1);
    };
  }

  /**
   * Advance simulation state without drawing.
   *
   * The screenshot harness uses this to fast-forward to a pose: under software
   * rasterisation a full post-processed frame is expensive, so rendering every
   * intermediate step would make each capture take minutes for no benefit.
   */
  stepLogic(dt: number) {
    this.elapsed += dt;
    for (const fn of this.updaters) fn(dt, this.elapsed);
  }

  /** Draw one frame from the current state. */
  render() {
    const u = this.grade.uniforms as Record<string, { value: unknown }>;
    if (u.time) u.time.value = this.elapsed;
    this.composer.render();
  }

  /** Advance the world by exactly `dt` seconds and render one frame. */
  step(dt: number) {
    this.stepLogic(dt);
    this.render();
  }

  start() {
    this.lastTime = performance.now();
    const tick = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      // Clamp so a background tab or a long GC pause cannot teleport the sim.
      const dt = Math.min((now - this.lastTime) / 1000, 1 / 15);
      this.lastTime = now;
      this.step(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose() {
    this.disposed = true;
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.composer.dispose();
    this.renderer.dispose();
  }
}
