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

  /** Live touch points, keyed by pointerId, for pinch and two-finger pan. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;

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
    window.addEventListener('pointercancel', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    // Without this the browser claims the gesture and scrolls the page
    // instead of delivering pointermove, which makes touch input dead.
    dom.style.touchAction = 'none';
  }

  /** True if the last pointer gesture was a drag rather than a click. */
  get wasDrag(): boolean {
    return this.moved > 6;
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        // Second finger down: switch from orbit to pinch/pan and seed the
        // baseline separation.
        this.dragging = null;
        this.pinchDist = this.touchSeparation();
        return;
      }
    }
    // Left-drag orbits, right/middle-drag pans. Matches what players expect
    // from every strategy game.
    this.dragging = e.button === 0 ? 'orbit' : 'pan';
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved = 0;
  };

  private onUp = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    this.dragging = null;
  };

  private touchSeparation(): number {
    const pts = [...this.touches.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private touchCentre(): { x: number; y: number } {
    const pts = [...this.touches.values()];
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    return { x: x / pts.length, y: y / pts.length };
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const prevCentre = this.touches.size >= 2 ? this.touchCentre() : null;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.touches.size >= 2) {
        // Pinch to zoom.
        const sep = this.touchSeparation();
        if (this.pinchDist > 0 && sep > 0) {
          this.desired.distance = THREE.MathUtils.clamp(
            this.desired.distance * (this.pinchDist / sep),
            this.opts.minDistance,
            this.opts.maxDistance,
          );
        }
        this.pinchDist = sep;

        // Two-finger drag pans, using the movement of the midpoint.
        const centre = this.touchCentre();
        if (prevCentre) {
          const k = this.distance * 0.0016;
          const forward = new THREE.Vector3(Math.cos(this.azimuth), 0, Math.sin(this.azimuth));
          const right = new THREE.Vector3(-forward.z, 0, forward.x);
          this.desiredTarget.addScaledVector(right, -(centre.x - prevCentre.x) * k);
          this.desiredTarget.addScaledVector(forward, -(centre.y - prevCentre.y) * k);
          const b = this.opts.bounds;
          this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, -b, b);
          this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, -b, b);
        }
        this.moved += 12; // a pinch is never a tap
        return;
      }
    }

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
