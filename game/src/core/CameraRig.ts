import * as THREE from 'three';
import { registerRig } from './Debug';

export interface CameraRigOptions {
  minDistance?: number;
  maxDistance?: number;
  minPolar?: number;
  maxPolar?: number;
  bounds?: number;
  /** Screen-edge band, in CSS px, that drives edge-pan. */
  edgeMargin?: number;
  /** Edge-pan speed at the far zoom, in world units per second. */
  edgeSpeed?: number;
  /** How fast flick momentum bleeds off. Higher stops sooner. */
  momentumDamping?: number;
}

/**
 * Orbit / pan / zoom rig with damping, flick momentum and edge-pan.
 *
 * Written rather than pulled from OrbitControls because the game needs the
 * focus point clamped to the playfield and the pitch limited so the player can
 * never get under the terrain -- both of which fight the stock controls.
 *
 * Touch is the primary input, which drives most of what looks fussy below:
 *
 * - Every change in finger count re-seeds the gesture baseline. Without that,
 *   lifting one finger out of a pinch left the remaining finger dead until it
 *   was lifted and re-pressed, because the pinch branch had cleared `dragging`
 *   and nothing ever set it again. That is a dropped gesture, and on a phone it
 *   reads as the game ignoring you.
 * - Drags take a pointer capture, so a gesture that leaves the canvas keeps
 *   being delivered instead of freezing mid-orbit.
 * - Release hands the drag velocity to a momentum term, because a map that
 *   stops dead the instant your thumb leaves the glass feels broken on touch
 *   even though it is perfectly correct.
 */
export class CameraRig {
  target = new THREE.Vector3(0, 0, -6);

  private distance = 46;
  private azimuth = Math.PI * 0.5;
  private polar = THREE.MathUtils.degToRad(52);

  private readonly desired = {
    distance: 46,
    azimuth: Math.PI * 0.5,
    polar: THREE.MathUtils.degToRad(52),
  };
  private readonly desiredTarget = new THREE.Vector3(0, 0, -6);

  private dragging: 'orbit' | 'pan' | null = null;
  private activeId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private moved = 0;

  /** Live touch points, keyed by pointerId, for pinch and two-finger pan. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private gesture: 'none' | 'single' | 'multi' = 'none';

  /** Flick momentum, in the same units as the desired.* deltas. */
  private velAzimuth = 0;
  private velPolar = 0;
  private readonly velTarget = new THREE.Vector3();
  /** Exponentially smoothed recent motion, sampled at release. */
  private flickAzimuth = 0;
  private flickPolar = 0;
  private readonly flickTarget = new THREE.Vector3();
  private lastMoveAt = 0;

  /** Last known pointer position in CSS px, for edge-pan. */
  private pointerX = -1;
  private pointerY = -1;
  private pointerInside = false;
  private edgePanEnabled = false;
  /** Guards onUp against the re-entry that releasePointerCapture triggers. */
  private ending = false;

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
      edgeMargin: opts.edgeMargin ?? 56,
      edgeSpeed: opts.edgeSpeed ?? 26,
      momentumDamping: opts.momentumDamping ?? 5.5,
    };

    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('pointerleave', this.onLeave);
    dom.addEventListener('lostpointercapture', this.onUp);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContextMenu);

    // Without this the browser claims the gesture and scrolls the page
    // instead of delivering pointermove, which makes touch input dead.
    dom.style.touchAction = 'none';

    registerRig(this);
  }

  /** True if the last pointer gesture was a drag rather than a click. */
  get wasDrag(): boolean {
    return this.moved > 6;
  }

  /** Number of fingers currently down. Exposed for tests and for the HUD. */
  get touchCount(): number {
    return this.touches.size;
  }

  /** Current orbit distance, after damping. */
  get currentDistance(): number {
    return this.distance;
  }

  /**
   * Turn edge-pan on while the player is dragging something to the edge of the
   * screen -- placing a creature, most obviously. Off by default: a camera that
   * drifts whenever the cursor rests near an edge is worse than no edge-pan.
   */
  setEdgePan(enabled: boolean) {
    this.edgePanEnabled = enabled;
  }

  /** Frame the given world point without changing pitch or heading. */
  focus(point: THREE.Vector3, distance?: number) {
    this.desiredTarget.set(point.x, 0, point.z);
    this.clampTarget();
    if (distance !== undefined) {
      this.desired.distance = THREE.MathUtils.clamp(
        distance, this.opts.minDistance, this.opts.maxDistance,
      );
    }
    this.stopMomentum();
  }

  private onContextMenu = (e: Event) => e.preventDefault();

  private stopMomentum() {
    this.velAzimuth = 0;
    this.velPolar = 0;
    this.velTarget.set(0, 0, 0);
    this.flickAzimuth = 0;
    this.flickPolar = 0;
    this.flickTarget.set(0, 0, 0);
  }

  private clampTarget() {
    const b = this.opts.bounds;
    this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, -b, b);
    this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, -b, b);
  }

  /** Screen-relative ground basis, used by every pan path. */
  private panBasis(): { forward: THREE.Vector3; right: THREE.Vector3; k: number } {
    const forward = new THREE.Vector3(Math.cos(this.azimuth), 0, Math.sin(this.azimuth));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    // Scaled by distance so a drag covers the same amount of screen at any
    // zoom level.
    return { forward, right, k: this.distance * 0.0016 };
  }

  private panBy(dxPx: number, dyPx: number) {
    const { forward, right, k } = this.panBasis();
    const move = new THREE.Vector3();
    move.addScaledVector(right, -dxPx * k);
    move.addScaledVector(forward, -dyPx * k);
    this.desiredTarget.add(move);
    this.clampTarget();
    this.flickTarget.lerp(move, 0.45);
  }

  private onDown = (e: PointerEvent) => {
    this.stopMomentum();
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.pointerInside = true;

    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        // Second finger down: switch from orbit to pinch/pan and re-seed the
        // baseline separation. Re-seeding on EVERY count change is what stops
        // the camera jumping when a third finger lands or one is lifted.
        this.dragging = null;
        this.activeId = null;
        this.gesture = 'multi';
        this.pinchDist = this.touchSeparation();
        return;
      }
      this.gesture = 'single';
    }

    // Left-drag orbits, right/middle-drag pans. Matches what players expect
    // from every strategy game.
    this.dragging = e.button === 0 ? 'orbit' : 'pan';
    this.activeId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved = 0;
    // Keep receiving moves even if the gesture wanders off the canvas; without
    // this a drag that leaves the element freezes until it comes back.
    try { this.dom.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  };

  private onUp = (e: PointerEvent) => {
    // releasePointerCapture() below fires `lostpointercapture`, which is bound
    // to this same handler; without the guard every release runs twice.
    if (this.ending) return;
    this.ending = true;
    try { this.endPointer(e); } finally { this.ending = false; }
  };

  private endPointer(e: PointerEvent) {
    const wasTouch = this.touches.delete(e.pointerId);
    if (this.activeId === e.pointerId) this.activeId = null;
    try { this.dom.releasePointerCapture(e.pointerId); } catch { /* already gone */ }

    if (wasTouch && this.touches.size === 1) {
      // Dropping from a pinch back to one finger. The old code left `dragging`
      // null here, so the surviving finger did nothing at all until it was
      // lifted and pressed again. Hand it back to orbit, re-seeded at the
      // finger's current position so the view does not snap.
      const [id, pt] = [...this.touches.entries()][0];
      this.dragging = 'orbit';
      this.activeId = id;
      this.lastX = pt.x;
      this.lastY = pt.y;
      this.gesture = 'single';
      this.pinchDist = 0;
      this.stopMomentum();
      return;
    }

    if (this.touches.size === 0) {
      this.gesture = 'none';
      this.pinchDist = 0;
      this.pointerInside = e.pointerType !== 'touch' && this.pointerInside;
    }

    if (this.dragging) this.releaseMomentum();
    this.dragging = null;
  }

  /**
   * Hand the tail of the drag to the momentum term.
   *
   * Only if the gesture was still moving when it ended: releasing after a pause
   * should stop where it is, not lurch off in whatever direction the finger
   * last happened to travel.
   */
  private releaseMomentum() {
    const idle = performance.now() - this.lastMoveAt;
    if (idle > 120 || !this.wasDrag) { this.stopMomentum(); return; }
    this.velAzimuth = this.flickAzimuth;
    this.velPolar = this.flickPolar;
    this.velTarget.copy(this.flickTarget);
    this.flickAzimuth = 0;
    this.flickPolar = 0;
    this.flickTarget.set(0, 0, 0);
  }

  private onLeave = (e: PointerEvent) => {
    // Only clear hover state; a captured drag keeps running.
    if (this.activeId === null) this.pointerInside = false;
    else if (e.pointerType === 'touch') this.pointerInside = true;
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
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.pointerInside = true;
    this.lastMoveAt = performance.now();

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
        if (prevCentre) this.panBy(centre.x - prevCentre.x, centre.y - prevCentre.y);
        this.moved += 12; // a pinch is never a tap
        return;
      }
    }

    if (!this.dragging) return;
    // Ignore a second mouse button's moves while another drag owns the rig.
    if (this.activeId !== null && e.pointerId !== this.activeId) return;

    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);

    if (this.dragging === 'orbit') {
      const dAz = -dx * 0.005;
      const dPol = -dy * 0.005;
      this.desired.azimuth += dAz;
      this.desired.polar = THREE.MathUtils.clamp(
        this.desired.polar + dPol,
        this.opts.minPolar,
        this.opts.maxPolar,
      );
      // Smoothed, so one jittery final event cannot define the whole flick.
      this.flickAzimuth += (dAz - this.flickAzimuth) * 0.45;
      this.flickPolar += (dPol - this.flickPolar) * 0.45;
    } else {
      this.panBy(dx, dy);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.stopMomentum();
    // Respect the magnitude, not just the sign: a trackpad sends many small
    // deltas and a mouse wheel sends few large ones, and sign-only zoom makes
    // the first feel violent and the second feel stuck. deltaMode 1 is lines,
    // 2 is pages; normalise both to something pixel-ish first.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const notches = THREE.MathUtils.clamp((e.deltaY * unit) / 100, -3, 3);
    this.desired.distance = THREE.MathUtils.clamp(
      this.desired.distance * Math.exp(notches * 0.12),
      this.opts.minDistance,
      this.opts.maxDistance,
    );
  };

  /**
   * Pan when a drag is held near the edge of the viewport.
   *
   * Speed ramps with how far into the margin the pointer is, so grazing the
   * edge nudges and pinning against it moves properly. Scaled by zoom for the
   * same reason drag-pan is.
   */
  private updateEdgePan(dt: number) {
    if (!this.edgePanEnabled || !this.pointerInside) return;
    if (this.gesture === 'multi' || this.dragging === 'pan') return;

    const r = this.dom.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const x = this.pointerX - r.left;
    const y = this.pointerY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return;

    const m = Math.min(this.opts.edgeMargin, r.width * 0.25, r.height * 0.25);
    let ex = 0, ey = 0;
    if (x < m) ex = -(1 - x / m);
    else if (x > r.width - m) ex = 1 - (r.width - x) / m;
    if (y < m) ey = -(1 - y / m);
    else if (y > r.height - m) ey = 1 - (r.height - y) / m;
    if (ex === 0 && ey === 0) return;

    // Square the ramp so the dead-ish zone near the inner edge of the margin
    // stays calm and the outer edge is where the speed actually lives.
    const speed = this.opts.edgeSpeed * dt * (this.distance / this.opts.maxDistance + 0.35);
    const { forward, right } = this.panBasis();
    this.desiredTarget.addScaledVector(right, ex * Math.abs(ex) * speed);
    this.desiredTarget.addScaledVector(forward, ey * Math.abs(ey) * speed);
    this.clampTarget();
  }

  update(dt: number) {
    // Momentum, applied to the desired pose so the existing damping still
    // smooths it. Decay is exponential in dt, so it is frame-rate independent.
    if (!this.dragging && this.gesture !== 'multi') {
      const decay = Math.exp(-dt * this.opts.momentumDamping);
      // 60 is the reference rate the per-event deltas were captured at.
      const steps = dt * 60;
      if (this.velAzimuth || this.velPolar) {
        this.desired.azimuth += this.velAzimuth * steps;
        this.desired.polar = THREE.MathUtils.clamp(
          this.desired.polar + this.velPolar * steps,
          this.opts.minPolar,
          this.opts.maxPolar,
        );
        this.velAzimuth *= decay;
        this.velPolar *= decay;
        if (Math.abs(this.velAzimuth) < 1e-5) this.velAzimuth = 0;
        if (Math.abs(this.velPolar) < 1e-5) this.velPolar = 0;
      }
      if (this.velTarget.lengthSq() > 0) {
        this.desiredTarget.addScaledVector(this.velTarget, steps);
        this.clampTarget();
        this.velTarget.multiplyScalar(decay);
        if (this.velTarget.lengthSq() < 1e-8) this.velTarget.set(0, 0, 0);
      }
    }

    this.updateEdgePan(dt);

    // Frame-rate independent damping.
    const k = 1 - Math.exp(-dt * 11);
    this.distance += (this.desired.distance - this.distance) * k;
    this.azimuth += (this.desired.azimuth - this.azimuth) * k;
    this.polar += (this.desired.polar - this.polar) * k;
    this.target.lerp(this.desiredTarget, k);

    // Keep the angle from growing without bound over a long session; shift the
    // live and desired values together so the damping above sees no step.
    if (this.azimuth > Math.PI * 4 || this.azimuth < -Math.PI * 4) {
      const turns = Math.round(this.azimuth / (Math.PI * 2)) * Math.PI * 2;
      this.azimuth -= turns;
      this.desired.azimuth -= turns;
    }

    // Polar is clamped away from both poles, so `lookAt` never has to resolve
    // a camera sitting on its own up vector.
    this.polar = THREE.MathUtils.clamp(this.polar, this.opts.minPolar, this.opts.maxPolar);
    this.distance = THREE.MathUtils.clamp(
      this.distance, this.opts.minDistance, this.opts.maxDistance,
    );

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
    this.dom.removeEventListener('pointerleave', this.onLeave);
    this.dom.removeEventListener('lostpointercapture', this.onUp);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
  }
}
