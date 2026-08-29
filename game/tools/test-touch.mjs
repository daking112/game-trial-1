#!/usr/bin/env node
/**
 * Camera rig behaviour tests, driven through synthetic pointer events.
 *
 * This file used to print a JSON blob and exit 0 no matter what it found,
 * which meant "test-touch passes" carried no information. Every check below
 * now asserts, and the process exits non-zero if any of them fail.
 *
 * Usage: node tools/test-touch.mjs [--url http://127.0.0.1:5173]
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? dflt : v;
};
const url = arg('url', argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ready === true, { timeout: 60000 });
// Stop the rAF loop: the tests step the rig themselves so results are exact.
await page.evaluate(() => window.__game.engine.stop());

const out = await page.evaluate(async () => {
  const g = window.__game;
  const rig = g.rig || window.__rig;
  const cam = g.engine.camera;
  const el = g.engine.renderer.domElement;

  const dist = () => Math.hypot(cam.position.x, cam.position.y, cam.position.z);
  const pos = () => cam.position.clone();
  const fire = (type, id, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: id, pointerType: 'touch', clientX: x, clientY: y,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, ...extra,
  }));
  const mouse = (type, id, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: id, pointerType: 'mouse', clientX: x, clientY: y,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, ...extra,
  }));
  // Settle drives the rig only -- no scene logic -- so a test cannot be moved
  // by a creature walking past.
  const settle = (frames = 90) => { for (let i = 0; i < frames; i++) rig.update(1 / 60); };
  const lift = (ids, x, y) => ids.forEach((id, i) => fire('pointerup', id, x + i * 10, y));

  const r = {};

  // --- pinch -----------------------------------------------------------
  const before = dist();
  fire('pointerdown', 1, 300, 300); fire('pointerdown', 2, 500, 300);
  fire('pointermove', 1, 360, 300); fire('pointermove', 2, 440, 300);
  settle();
  r.pinchIn = { before: +before.toFixed(2), after: +dist().toFixed(2) };
  lift([1, 2], 360, 300);

  const beforeOut = dist();
  fire('pointerdown', 11, 380, 300); fire('pointerdown', 12, 420, 300);
  fire('pointermove', 11, 250, 300); fire('pointermove', 12, 550, 300);
  settle();
  r.pinchOut = { before: +beforeOut.toFixed(2), after: +dist().toFixed(2) };
  lift([11, 12], 250, 300);

  // --- single-finger orbit ---------------------------------------------
  settle(180);                       // let the pinch fully settle first
  const orbitFrom = pos();
  const radiusFrom = rig.currentDistance;
  fire('pointerdown', 3, 400, 300);
  fire('pointermove', 3, 520, 300);
  settle();
  fire('pointerup', 3, 520, 300);
  settle();
  r.orbitMoved = +orbitFrom.distanceTo(pos()).toFixed(3);
  // Radius is measured from the orbit target, not the world origin: the target
  // sits off-origin, so origin-distance changes with azimuth even at a fixed
  // radius. Measuring that instead is how this check first "failed".
  r.orbitRadiusDrift = +Math.abs(radiusFrom - rig.currentDistance).toFixed(3);

  // --- REGRESSION: pinch, then lift ONE finger --------------------------
  // The surviving finger must still orbit. The old rig cleared `dragging` when
  // the second finger landed and never restored it, so the remaining finger
  // was dead until it was lifted and pressed again.
  fire('pointerdown', 4, 300, 300); fire('pointerdown', 5, 500, 300);
  fire('pointermove', 4, 320, 300);
  settle();
  fire('pointerup', 5, 500, 300);           // one finger left, id 4 still down
  const afterLift = pos();
  fire('pointermove', 4, 460, 300);          // drag the survivor
  settle();
  r.survivingFingerMoved = +afterLift.distanceTo(pos()).toFixed(3);
  fire('pointerup', 4, 460, 300);
  settle();

  // --- momentum ---------------------------------------------------------
  // A quick flick must keep moving after release; the camera should still be
  // travelling a few frames later and then come to rest.
  fire('pointerdown', 6, 400, 300);
  for (let x = 400; x <= 520; x += 30) fire('pointermove', 6, x, 300);
  fire('pointerup', 6, 520, 300);
  const atRelease = pos();
  for (let i = 0; i < 6; i++) rig.update(1 / 60);
  const shortlyAfter = pos();
  settle(240);
  const atRest = pos();
  r.momentumGlide = +atRelease.distanceTo(shortlyAfter).toFixed(3);
  r.momentumSettles = +shortlyAfter.distanceTo(atRest).toFixed(3);
  const afterRest = pos();
  settle(120);
  r.momentumStops = +afterRest.distanceTo(pos()).toFixed(4);

  // --- no momentum after a held release ---------------------------------
  // Drag, pause, then release: the camera must stop where it was put.
  fire('pointerdown', 7, 400, 300);
  for (let x = 400; x <= 520; x += 30) fire('pointermove', 7, x, 300);
  settle(30);
  await new Promise((res) => setTimeout(res, 200)); // exceed the flick window
  fire('pointerup', 7, 520, 300);
  const heldRelease = pos();
  settle(60);
  r.noFlickAfterPause = +heldRelease.distanceTo(pos()).toFixed(3);

  // --- clamps -----------------------------------------------------------
  // Hammer zoom-in and zoom-out well past the limits and check we stay inside
  // them, and that the camera never drops to or below the ground.
  for (let i = 0; i < 40; i++) {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
  }
  settle(240);
  const near = { d: rig.currentDistance, y: cam.position.y };
  for (let i = 0; i < 60; i++) {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
  }
  settle(240);
  const far = { d: rig.currentDistance, y: cam.position.y };
  r.clampNear = +near.d.toFixed(2);
  r.clampFar = +far.d.toFixed(2);
  r.aboveGroundNear = near.y;
  r.aboveGroundFar = far.y;

  // --- no gimbal flip ---------------------------------------------------
  // Drag far past vertical in both directions; pitch must stay clamped and the
  // camera must stay above its target rather than tumbling under the terrain.
  let minY = Infinity, maxTilt = 0;
  for (const dir of [-1, 1]) {
    fire('pointerdown', 20, 400, 300);
    for (let i = 1; i <= 30; i++) {
      fire('pointermove', 20, 400, 300 + dir * i * 40);
      rig.update(1 / 60);
      minY = Math.min(minY, cam.position.y - rig.target.y);
      maxTilt = Math.max(maxTilt, Math.abs(cam.position.y - rig.target.y));
    }
    fire('pointerup', 20, 400, 300 + dir * 1200);
    settle(120);
    minY = Math.min(minY, cam.position.y - rig.target.y);
  }
  r.minHeightAboveTarget = +minY.toFixed(3);
  r.upVectorSane = Math.abs(cam.up.y - 1) < 1e-6;

  // --- edge-pan ---------------------------------------------------------
  rig.setEdgePan(false);
  mouse('pointermove', 30, 4, 300);      // hard against the left edge
  const edgeOffFrom = rig.target.clone();
  settle(120);
  r.edgePanOffDrift = +edgeOffFrom.distanceTo(rig.target).toFixed(4);

  rig.setEdgePan(true);
  mouse('pointermove', 30, 4, 300);
  const edgeOnFrom = rig.target.clone();
  settle(120);
  r.edgePanOnMove = +edgeOnFrom.distanceTo(rig.target).toFixed(3);

  // Centre of the screen must not pan even with edge-pan on. Settle first:
  // otherwise this samples the tail of the previous edge-pan still damping in,
  // which is what made this check first "fail".
  mouse('pointermove', 30, 400, 300);
  settle(240);
  const centreFrom = rig.target.clone();
  settle(120);
  r.edgePanCentreDrift = +centreFrom.distanceTo(rig.target).toFixed(4);
  rig.setEdgePan(false);

  // --- target bounds ----------------------------------------------------
  // Two-finger pan hard in one direction for a long time; the focus point must
  // stay on the playfield.
  fire('pointerdown', 40, 200, 200); fire('pointerdown', 41, 240, 200);
  for (let i = 0; i < 120; i++) {
    fire('pointermove', 40, 200 + i * 6, 200 + i * 6);
    fire('pointermove', 41, 240 + i * 6, 200 + i * 6);
  }
  settle(180);
  lift([40, 41], 900, 900);
  settle(60);
  r.targetInBounds = Math.abs(rig.target.x) <= 40.5 && Math.abs(rig.target.z) <= 40.5;
  r.targetX = +rig.target.x.toFixed(2);
  r.targetZ = +rig.target.z.toFixed(2);

  // --- drag that leaves the canvas --------------------------------------
  // With a pointer capture the move is still delivered; without one the drag
  // freezes the moment the pointer crosses the element boundary.
  const outFrom = pos();
  mouse('pointerdown', 50, 400, 300);
  mouse('pointermove', 50, 900, 300);   // beyond the 800px-wide viewport
  settle();
  mouse('pointerup', 50, 900, 300);
  settle(120);
  r.dragOffCanvasMoved = +outFrom.distanceTo(pos()).toFixed(3);

  r.touchAction = el.style.touchAction;
  r.fingersReleased = rig.touchCount;
  return r;
});

await browser.close();

const checks = [
  ['pinch inward zooms out', out.pinchIn.after > out.pinchIn.before + 1,
    `${out.pinchIn.before} -> ${out.pinchIn.after}`],
  ['pinch outward zooms in', out.pinchOut.after < out.pinchOut.before - 1,
    `${out.pinchOut.before} -> ${out.pinchOut.after}`],
  ['one-finger drag orbits', out.orbitMoved > 0.5, `moved ${out.orbitMoved}`],
  ['orbit holds its radius', out.orbitRadiusDrift < 0.5, `drift ${out.orbitRadiusDrift}`],
  ['finger surviving a pinch still orbits', out.survivingFingerMoved > 0.5,
    `moved ${out.survivingFingerMoved} (0 = dropped gesture)`],
  ['flick carries momentum', out.momentumGlide > 0.05, `glided ${out.momentumGlide}`],
  ['momentum comes to rest', out.momentumStops < 0.01, `residual ${out.momentumStops}`],
  ['no flick after a paused release', out.noFlickAfterPause < 0.05,
    `drifted ${out.noFlickAfterPause}`],
  ['zoom clamps near', out.clampNear >= 11.99, `distance ${out.clampNear}`],
  ['zoom clamps far', out.clampFar <= 80.01, `distance ${out.clampFar}`],
  ['camera stays above ground when zoomed in', out.aboveGroundNear > 0,
    `y ${out.aboveGroundNear?.toFixed?.(2)}`],
  ['pitch never flips under the target', out.minHeightAboveTarget > 0.5,
    `min height ${out.minHeightAboveTarget}`],
  ['up vector never tumbles', out.upVectorSane, 'up.y == 1'],
  ['edge-pan is off by default', out.edgePanOffDrift < 0.001, `drift ${out.edgePanOffDrift}`],
  ['edge-pan moves when enabled', out.edgePanOnMove > 0.5, `moved ${out.edgePanOnMove}`],
  ['edge-pan ignores the screen centre', out.edgePanCentreDrift < 0.001,
    `drift ${out.edgePanCentreDrift}`],
  ['pan target stays in bounds', out.targetInBounds, `(${out.targetX}, ${out.targetZ})`],
  ['drag keeps working off-canvas', out.dragOffCanvasMoved > 0.5,
    `moved ${out.dragOffCanvasMoved}`],
  ['touch-action is none', out.touchAction === 'none', out.touchAction || '(unset)'],
  ['no fingers left stuck down', out.fingersReleased === 0, `${out.fingersReleased} tracked`],
  ['no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none'],
];

console.log('\n--- camera rig / touch ---');
let failed = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${detail}`);
}
if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.\n');
process.exit(0);
