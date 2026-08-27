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

  private readonly offset = new THREE.Vector3();

  /** Add shake. `amount` is 0..1; it accumulates and clamps. */
  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Briefly slow time for impact weight. */
  hitStop(seconds: number, scale = 0.12) {
    this.stopTimer = Math.max(this.stopTimer, seconds);
    this.timeScale = scale;
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
