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
const built = ids.map((id, i) => {
  const c = new Creature(id, { phase: i * 0.37 });
  c.group.rotation.y = YAW;
  c.group.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(c.group);
  // Clamp against height: a wingspan may overhang a neighbour's airspace a
  // little -- that reads as a group shot -- but it must not push the row so
  // wide that every creature becomes a thumbnail.
  const edge = i === 0 || i === ids.length - 1;
  const half = edge
    ? (b.max.x - b.min.x) * 0.5
    : Math.min((b.max.x - b.min.x) * 0.5, c.height * 0.78);
  // Idle animation swings limbs and wings past the measured rest bounds, so
  // the two creatures that own the plate edges get slack to swing into.
  return { c, half: Math.max(0.5, half) + (edge ? 0.55 : 0), cx: (b.max.x + b.min.x) * 0.5 };
});

// Pack left to right with a constant air gap, then centre the row.
const GAP = 0.28;
const xs: number[] = [];
let cursor = 0;
for (const b of built) {
  cursor += b.half;
  xs.push(cursor - b.cx);
  cursor += b.half + GAP;
}
const rowWidth = cursor - GAP;

// The `lineup` camera is fixed, so the row is pushed to whatever depth makes
// it fill the plate: solve for the z where the frustum is just wide enough.
const CAM = new THREE.Vector3(0, 2.6, 12);
const FOV = 42;
const aspect = 2.0; // the lineup plate is shot 2:1
const halfW = Math.tan((FOV * Math.PI) / 360) * aspect;
const need = (rowWidth * 0.5) / (halfW * 0.985);
const rowZ = CAM.z - Math.max(8.0, need);

built.forEach((b, i) => {
  b.c.group.position.set(xs[i] - rowWidth * 0.5, 0, rowZ);
  engine.scene.add(b.c.group);
  creatures.push(b.c);
});

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
