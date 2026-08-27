import * as THREE from 'three';
import { Engine } from './core/Engine';
import { installDebugApi } from './core/Debug';
import { Creature } from './creatures/Creature';
import { SPECIES, SPECIES_ORDER } from './creatures/species';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Creature showcase.
 *
 * A neutral studio backdrop for judging creature art on its own terms. The
 * in-game view is a poor place to evaluate a creature: it is green-on-green,
 * half-occluded by foliage and lit for the environment rather than the subject.
 * Here every creature gets a clean value-separated background and a three-point
 * rig, which is how the reference artwork is presented too -- comparing against
 * it from inside the game would be comparing lighting setups, not designs.
 */
const container = document.getElementById('app');
if (!container) throw new Error('#app missing');

const engine = new Engine(container);
const debug = installDebugApi(engine);

// Mid-value neutral backdrop: light enough to read dark silhouettes, dark
// enough to read light ones.
engine.scene.background = new THREE.Color('#8d9aa6');
engine.scene.fog = null;

// Neutral studio IBL. Without it these PBR materials have no indirect light
// to sample and every creature renders as a near-silhouette regardless of how
// strong the key is.
{
  const pmrem = new THREE.PMREMGenerator(engine.renderer);
  engine.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  engine.scene.environmentIntensity = 0.78;
  pmrem.dispose();
}

const floor = new THREE.Mesh(
  new THREE.CylinderGeometry(24, 24, 0.2, 64),
  new THREE.MeshStandardMaterial({ color: '#7e8892', roughness: 0.95, metalness: 0 }),
);
floor.position.y = -0.1;
floor.receiveShadow = true;
engine.scene.add(floor);

// Three-point rig: warm key, cool fill, rim to separate from the backdrop.
const key = new THREE.DirectionalLight('#fff3e0', 2.7);
key.position.set(5, 8, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -10;
key.shadow.camera.right = 10;
key.shadow.camera.top = 10;
key.shadow.camera.bottom = -10;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.02;
engine.scene.add(key);

const fill = new THREE.DirectionalLight('#bcd8ff', 0.80);
fill.position.set(-6, 3, 4);
engine.scene.add(fill);

const rim = new THREE.DirectionalLight('#ffffff', 1.6);
rim.position.set(-3, 5, -8);
engine.scene.add(rim);

engine.scene.add(new THREE.HemisphereLight('#cfe3ff', '#7b7365', 0.42));

// Lay the roster out in a line. Spacing is proportional to how much room
// each creature actually needs, so the 3.4m stag does not stand on the 0.95m
// sprout, and the row still reads as one composition.
const ids = SPECIES_ORDER;
const creatures: Creature[] = [];
// Three-quarter view, as the reference artwork is presented. A serpent's
// S-curve and a quadruped's length simply do not exist head-on.
const YAW = -0.62;

// Measured, not guessed. A creature's *drawn* width is what has to be
// packed -- a raptor with a 3m wingspan needs more room than a 3.4m stag --
// and the only reliable source for that is the built mesh's own bounds.
interface Built {
  c: Creature;
  half: number;
  cx: number;
  stage: number;
  /** Index of this creature's evolved form in `built`, if it has one. */
  evo: number;
}

const built: Built[] = ids.map((id, i) => {
  const c = new Creature(id, { phase: i * 0.37 });
  c.group.rotation.y = YAW;
  c.group.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(c.group);
  const evoId = SPECIES[id].evolvesTo;
  return {
    c,
    // Idle animation swings limbs past the measured rest bounds, so every
    // creature gets a little slack to swing into.
    half: Math.max(0.5, (b.max.x - b.min.x) * 0.5) + 0.16,
    cx: (b.max.x + b.min.x) * 0.5,
    stage: SPECIES[id].stage,
    evo: evoId ? ids.indexOf(evoId) : -1,
  };
});

/*
 * Two ranks, not one row.
 *
 * Eight creatures shoulder to shoulder in a 2:1 plate makes every one of
 * them a thumbnail and leaves the bottom half of the frame empty. Staging
 * the four heavies as a back rank and standing each stage 1 in front of its
 * own evolved form does three things at once: it halves the width that has
 * to be packed, so everything is nearer and bigger; it puts the small
 * creatures where their size is an asset rather than a handicap; and it
 * makes each evolution line legible as a line.
 */
const CAM_Z = 12;
const FOV = 42;
const PLATE_ASPECT = 2.0;
const halfW = Math.tan((FOV * Math.PI) / 360) * PLATE_ASPECT;
const GAP = 0.34;

const allIdx = built.map((_, i) => i);
const backIdx = allIdx.filter((i) => built[i].stage === 2);
const frontIdx = allIdx.filter((i) => built[i].stage === 1);

/** Pack a rank left to right, returning centre offsets and the total width. */
function pack(indices: number[]) {
  const centres: number[] = [];
  let cursor = 0;
  for (const i of indices) {
    cursor += built[i].half;
    centres.push(cursor);
    cursor += built[i].half + GAP;
  }
  return { centres, width: Math.max(0.001, cursor - GAP) };
}

const back = pack(backIdx);
const front = pack(frontIdx);
const depthFor = (w: number) => CAM_Z - (w * 0.5) / (halfW * 0.93);

// The back rank sets the depth of the whole staging; the front rank stands a
// fixed step nearer, or further if it is too wide to fit that close.
const zBack = Math.min(depthFor(back.width), depthFor(front.width) - 2.9);
const zFront = zBack + 2.9;

backIdx.forEach((i, k) => {
  built[i].c.group.position.set(back.centres[k] - back.width * 0.5 - built[i].cx, 0, zBack);
});
// How far off-centre anything at the front rank may stand before the fixed
// lineup camera starts cropping it.
const frontLimit = (CAM_Z - zFront) * halfW * 0.95;

// The front rank is spread evenly and then shifted half a body to the left,
// which lands each stage 1 just off its own evolution's shoulder rather than
// dead in front of it -- the pair still reads as a pair, and neither one is
// hidden behind the other.
const frontStep = (frontLimit * 1.76) / frontIdx.length;
frontIdx.forEach((i, k) => {
  const b = built[i];
  const x = -frontLimit * 0.88 + frontStep * (k + 0.5) - frontStep * 0.40;
  b.c.group.position.set(
    THREE.MathUtils.clamp(x, -frontLimit + b.half, frontLimit - b.half) - b.cx,
    0,
    zFront,
  );
});

// Two stage 1s can both want the same gap between two heavies. Relax the
// front rank apart along x until nobody is standing inside anybody.
for (let pass = 0; pass < 24; pass++) {
  const order = [...frontIdx].sort(
    (a, b) => built[a].c.group.position.x - built[b].c.group.position.x,
  );
  let moved = false;
  for (let k = 1; k < order.length; k++) {
    const a = built[order[k - 1]];
    const b = built[order[k]];
    const need = a.half + b.half + 0.22;
    const gap = b.c.group.position.x + b.cx - (a.c.group.position.x + a.cx);
    if (gap < need) {
      const push = (need - gap) * 0.5;
      a.c.group.position.x -= push;
      b.c.group.position.x += push;
      moved = true;
    }
  }
  if (!moved) break;
}
for (const i of frontIdx) {
  const b = built[i];
  const x = THREE.MathUtils.clamp(b.c.group.position.x + b.cx, -frontLimit + b.half, frontLimit - b.half);
  b.c.group.position.x = x - b.cx;
}

for (const b of built) {
  engine.scene.add(b.c.group);
  creatures.push(b.c);
}

engine.onUpdate((dt, elapsed) => {
  for (const c of creatures) c.update(dt, elapsed);
});

// The art direction is bright and high-key; a dark plate flattens every
// palette into the same muddy mid-band and hides the value blocking entirely.
engine.renderer.toneMappingExposure = 1.06;

engine.camera.position.set(0, 2.6, 12);
engine.camera.lookAt(0, 1.1, 0);

engine.start();

// Focus a single species by index, for tight portrait shots.
(window as unknown as { __focus: (i: number) => void }).__focus = (i: number) => {
  const c = creatures[i];
  if (!c) return;
  const p = c.group.position;
  // Frame to the creature's own size rather than a fixed distance, so a
  // 0.95m sprout and a 3.4m stag both fill the portrait.
  const d = c.height * 1.85 + 0.9;
  engine.camera.position.set(p.x + d * 0.30, c.height * 0.66, p.z + d);
  engine.camera.lookAt(p.x, c.height * 0.52, p.z);
  engine.camera.updateMatrixWorld(true);
};
(window as unknown as { __species: string[] }).__species = ids.map((i) => SPECIES[i].name);

debug.ready = true;
