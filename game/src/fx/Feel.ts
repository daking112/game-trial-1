import * as THREE from 'three';

/**
 * Camera shake and hit-stop.
 *
 * Shake is applied as an offset after the camera rig has positioned itself, so
 * it never fights the player's own camera input. Trauma decays quadratically:
 * linear decay reads as a mechanical slide, quadratic reads as an impact.
 */
export class Feel {
  private trauma = 0;
  private timeScale = 1;
  private stopTimer = 0;
  private seed = 1234;
  /** Field-of-view kick, in degrees, decaying back to the camera's own value. */
  private punchFov = 0;
  private baseFov = 0;

  private readonly offset = new THREE.Vector3();

  /**
   * Add shake. `amount` is 0..1; it accumulates and clamps.
   *
   * A shake always drags a short lens punch with it. Translation alone reads
   * as a bumped tripod; the frame briefly widening is what reads as force
   * arriving at the camera, and it costs nothing to ride along here so every
   * caller gets it without having to remember a second call.
   */
  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
    this.punchFov = Math.min(2.2, this.punchFov + amount * 2.6);
    // Anything genuinely heavy also earns a sliver of hit-stop. Below the
    // threshold this does nothing, so ordinary chip damage stays fluid.
    if (amount >= 0.2) this.hitStop(0.03 + amount * 0.05, 0.22);
  }

  /** Briefly slow time for impact weight. */
  hitStop(seconds: number, scale = 0.12) {
    this.stopTimer = Math.max(this.stopTimer, seconds);
    this.timeScale = Math.min(this.timeScale, scale);
  }

  private rand() {
    // Deterministic noise so replays and screenshots match.
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return (this.seed / 4294967296) * 2 - 1;
  }

  /** Returns the time scale to apply to the simulation this frame. */
  update(dt: number, camera: THREE.PerspectiveCamera): number {
    if (this.stopTimer > 0) {
      this.stopTimer -= dt;
      if (this.stopTimer <= 0) this.timeScale = 1;
    }

    // The rig may legitimately change the camera's fov between frames (a shot
    // pose, a zoom), so the resting value is re-read whenever no punch is in
    // flight rather than latched once at construction.
    if (this.punchFov <= 0.001) this.baseFov = camera.fov;
    if (this.punchFov > 0) {
      this.punchFov = Math.max(0, this.punchFov - dt * 14);
      const fov = this.baseFov + this.punchFov;
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
      if (this.punchFov === 0 && camera.fov !== this.baseFov) {
        camera.fov = this.baseFov; camera.updateProjectionMatrix();
      }
    }

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      const s = this.trauma * this.trauma;
      this.offset.set(this.rand(), this.rand(), this.rand()).multiplyScalar(s * 0.55);
      camera.position.add(this.offset);
      // Roll as well as translate -- pure translation reads as a stumble.
      camera.rotateZ(this.rand() * s * 0.02);
    }

    return this.timeScale;
  }
}

/**
 * Floating damage/reward numbers, drawn in DOM and projected from world space.
 *
 * Pooled: a wave death can spawn dozens at once and creating elements per hit
 * causes visible layout churn.
 */
export class FloatingText {
  private readonly pool: HTMLDivElement[] = [];
  private readonly live: Array<{
    el: HTMLDivElement; at: THREE.Vector3; age: number; life: number;
  }> = [];

  constructor(host: HTMLElement, size = 40) {
    for (let i = 0; i < size; i++) {
      const el = document.createElement('div');
      el.className = 'floater';
      el.style.display = 'none';
      host.appendChild(el);
      this.pool.push(el);
    }
    this.injectStyles();
  }

  spawn(at: THREE.Vector3, text: string, color = '#fff', life = 0.85) {
    const el = this.pool.pop();
    if (!el) return; // pool exhausted; dropping a number beats stuttering
    el.textContent = text;
    el.style.color = color;
    el.style.display = 'block';
    this.live.push({ el, at: at.clone(), age: 0, life });
  }

  update(dt: number, camera: THREE.PerspectiveCamera, width: number, height: number) {
    const v = new THREE.Vector3();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.age += dt;
      if (f.age >= f.life) {
        f.el.style.display = 'none';
        this.pool.push(f.el);
        this.live.splice(i, 1);
        continue;
      }
      const t = f.age / f.life;
      v.copy(f.at);
      v.y += t * 1.6; // drift upward
      v.project(camera);
      if (v.z > 1) { f.el.style.opacity = '0'; continue; }
      f.el.style.left = `${(v.x * 0.5 + 0.5) * width}px`;
      f.el.style.top = `${(-v.y * 0.5 + 0.5) * height}px`;
      f.el.style.opacity = String(1 - t * t);
      f.el.style.transform = `translate(-50%,-50%) scale(${1 + (1 - t) * 0.35})`;
    }
  }

  dispose() {
    for (const el of this.pool) el.remove();
    for (const f of this.live) f.el.remove();
  }

  private injectStyles() {
    if (document.getElementById('floater-styles')) return;
    const s = document.createElement('style');
    s.id = 'floater-styles';
    s.textContent = `
      .floater {
        position: absolute; pointer-events: none; font-weight: 900; font-size: 19px;
        font-family: ui-rounded, "Nunito", system-ui, sans-serif;
        text-shadow: 0 2px 5px rgba(0,0,0,.85), 0 0 2px rgba(0,0,0,.9);
        will-change: transform, opacity;
      }
    `;
    document.head.appendChild(s);
  }
}
