import * as THREE from 'three';
import type { Enemy } from '../combat/Enemy';

/**
 * Worldspace health bars, drawn into one canvas.
 *
 * A tower-defence player's whole decision loop is "is that thing going to
 * die before it reaches the end", and until now the game answered it only
 * with a core that pulses faster as health drops. That reads at close range
 * and not at all from the overview camera, which is where the game is
 * actually played from.
 *
 * One canvas, not one element per enemy. Thirty enemies is the measured
 * maximum concurrent count, and thirty DOM nodes reflowing every frame is a
 * different kind of bug -- so this projects each enemy itself and draws in
 * immediate mode. Per-enemy state (the drain, the flash) hangs off a WeakMap
 * so a dead enemy takes its state with it.
 */

interface BarState {
  /** Trails the real value, so a hit reads as a drain rather than a jump. */
  shown: number;
  /** Seconds of white flash left from the last hit taken. */
  flash: number;
  /** Health at the previous frame, to notice a hit without an event. */
  last: number;
}

/** Bar width in pixels at unit distance, per tier. Bigger things, bigger bars. */
const TIER_WIDTH: Record<string, number> = {
  husk: 26,
  brute: 34,
  warden: 44,
  colossus: 76,
};

/** Tiers that get their name printed. A boss should announce itself. */
const NAMED_TIERS = new Set(['colossus']);

export class HealthBars {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly state = new WeakMap<Enemy, BarState>();
  private readonly projected = new THREE.Vector3();
  private enabled = true;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'healthbars';
    this.canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.canvas.style.display = on ? '' : 'none';
  }

  /**
   * Draw one frame. Safe to never call -- the game runs without it.
   *
   * `dt` is unscaled wall time on purpose: hit-stop slows the simulation, and
   * a bar that froze with it would read as a dropped frame.
   */
  update(dt: number, camera: THREE.Camera, enemies: readonly Enemy[], width: number, height: number) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    for (const e of enemies) {
      const max = e.archetype.maxHealth;
      if (max <= 0) continue;
      const frac = Math.max(0, Math.min(1, e.health / max));

      let st = this.state.get(e);
      if (!st) {
        st = { shown: frac, flash: 0, last: e.health };
        this.state.set(e, st);
      }
      if (e.health < st.last - 1e-6) st.flash = 0.14;
      st.last = e.health;
      st.flash = Math.max(0, st.flash - dt);
      // Chase the real value fast enough to feel responsive, slow enough that
      // the eye reads a drain. Snapping straight to it loses the hit entirely.
      st.shown += (frac - st.shown) * Math.min(1, dt * 11);

      // An untouched trash mob needs no bar -- the screen stays quiet and the
      // damaged ones stand out. Anything tougher carries one from the moment
      // it appears, because the decision it forces ("can I kill that before
      // it lands") starts before the first hit, not after it.
      if (frac >= 1 && st.shown >= 0.999 && e.archetype.tier === 'husk') continue;

      const scale = e.archetype.scale;
      this.projected.set(e.position.x, e.position.y + 0.95 * scale + 0.35, e.position.z);
      this.projected.project(camera);
      if (this.projected.z > 1) continue; // behind the camera

      const x = (this.projected.x * 0.5 + 0.5) * width;
      const y = (-this.projected.y * 0.5 + 0.5) * height;
      if (x < -60 || x > width + 60 || y < -30 || y > height + 30) continue;

      const bw = TIER_WIDTH[e.archetype.tier] ?? 30;
      const bh = e.archetype.tier === 'colossus' ? 8 : 5;
      const left = Math.round(x - bw / 2);
      const top = Math.round(y);

      // Track, with a dark outline so the bar survives a bright background.
      ctx.fillStyle = 'rgba(0,0,0,.62)';
      this.roundRect(ctx, left - 1.5, top - 1.5, bw + 3, bh + 3, (bh + 3) / 2);
      ctx.fill();

      // Fill. Green through amber to red, so the colour alone says how close
      // this is to dying without the player reading the length.
      const hue = 8 + st.shown * 112;
      ctx.fillStyle = st.flash > 0 ? '#ffffff' : `hsl(${hue}, 82%, 52%)`;
      const fillW = Math.max(bh, bw * st.shown);
      this.roundRect(ctx, left, top, fillW, bh, bh / 2);
      ctx.fill();

      // A lit top edge, so the bar reads as an object rather than a rectangle.
      ctx.fillStyle = 'rgba(255,255,255,.34)';
      this.roundRect(ctx, left + 1, top + 1, Math.max(2, fillW - 2), Math.max(1, bh * 0.34), bh * 0.2);
      ctx.fill();

      if (NAMED_TIERS.has(e.archetype.tier)) {
        ctx.font = '700 11px ui-rounded, "Nunito", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.72)';
        ctx.strokeText(e.archetype.name, x, top - 6);
        ctx.fillStyle = '#ffd76e';
        ctx.fillText(e.archetype.name, x, top - 6);
      }
    }
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  dispose() {
    this.canvas.remove();
  }
}
