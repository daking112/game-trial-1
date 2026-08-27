import * as THREE from 'three';

export interface CameraRigOptions {
  minDistance?: number;
  maxDistance?: number;
  minPolar?: number;
  maxPolar?: number;
  bounds?: number;
}

/**
 * Orbit/pan/zoom rig with damping.
 *
 * Written rather than pulled from OrbitControls because the game needs the
 * focus point clamped to the playfield and the pitch limited so the player can
 * never get under the terrain -- both of which fight the stock controls.
 */
export class CameraRig {
  target = new THREE.Vector3(0, 0, -6);

  private distance = 46;
  private azimuth = Math.PI * 0.5;
  private polar = THREE.MathUtils.degToRad(52);

  private readonly desired = { distance: 46, azimuth: Math.PI * 0.5, polar: THREE.MathUtils.degToRad(52) };
  private readonly desiredTarget = new THREE.Vector3(0, 0, -6);

  private dragging: 'orbit' | 'pan' | null = null;
  private lastX = 0;
  private lastY = 0;
  private moved = 0;

  private readonly opts: Required<CameraRigOptions>;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    opts: CameraRigOptions = {},
  ) {
    this.opts = {
      minDistance: opts.minDistance ?? 12,
      maxDistance: opts.maxDistance ?? 80,
      minPolar: opts.minPolar ?? THREE.MathUtils.degToRad(16),
      maxPolar: opts.maxPolar ?? THREE.MathUtils.degToRad(74),
      bounds: opts.bounds ?? 40,
    };

    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** True if the last pointer gesture was a drag rather than a click. */
  get wasDrag(): boolean {
    return this.moved > 6;
  }

  private onDown = (e: PointerEvent) => {
    // Left-drag orbits, right/middle-drag pans. Matches what players expect
    // from every strategy game.
    this.dragging = e.button === 0 ? 'orbit' : 'pan';
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved = 0;
  };

  private onUp = () => { this.dragging = null; };

  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);

    if (this.dragging === 'orbit') {
      this.desired.azimuth -= dx * 0.005;
      this.desired.polar = THREE.MathUtils.clamp(
        this.desired.polar - dy * 0.005,
        this.opts.minPolar,
        this.opts.maxPolar,
      );
    } else {
      // Pan along the ground plane in screen-relative directions, scaled by
      // distance so the drag feels the same at every zoom level.
      const k = this.distance * 0.0016;
      const forward = new THREE.Vector3(Math.cos(this.azimuth), 0, Math.sin(this.azimuth));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      this.desiredTarget.addScaledVector(right, -dx * k);
      this.desiredTarget.addScaledVector(forward, -dy * k);
      const b = this.opts.bounds;
      this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, -b, b);
      this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, -b, b);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.desired.distance = THREE.MathUtils.clamp(
      this.desired.distance * (1 + Math.sign(e.deltaY) * 0.12),
      this.opts.minDistance,
      this.opts.maxDistance,
    );
  };

  update(dt: number) {
    // Frame-rate independent damping.
    const k = 1 - Math.exp(-dt * 11);
    this.distance += (this.desired.distance - this.distance) * k;
    this.azimuth += (this.desired.azimuth - this.azimuth) * k;
    this.polar += (this.desired.polar - this.polar) * k;
    this.target.lerp(this.desiredTarget, k);

    const sinP = Math.sin(this.polar);
    this.camera.position.set(
      this.target.x + this.distance * sinP * Math.cos(this.azimuth),
      this.target.y + this.distance * Math.cos(this.polar),
      this.target.z + this.distance * sinP * Math.sin(this.azimuth),
    );
    this.camera.lookAt(this.target);
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this.onDown);
    this.dom.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.dom.removeEventListener('wheel', this.onWheel);
  }
}
