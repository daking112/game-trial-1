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
  engine.scene.environmentIntensity = 0.42;
  pmrem.dispose();
}

const floor = new THREE.Mesh(
  new THREE.CylinderGeometry(14, 14, 0.2, 64),
  new THREE.MeshStandardMaterial({ color: '#6f7a85', roughness: 0.95, metalness: 0 }),
);
floor.position.y = -0.1;
floor.receiveShadow = true;
engine.scene.add(floor);

// Three-point rig: warm key, cool fill, rim to separate from the backdrop.
const key = new THREE.DirectionalLight('#fff3e0', 2.0);
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

const fill = new THREE.DirectionalLight('#bcd8ff', 0.45);
fill.position.set(-6, 3, 4);
engine.scene.add(fill);

const rim = new THREE.DirectionalLight('#ffffff', 1.1);
rim.position.set(-3, 5, -8);
engine.scene.add(rim);

engine.scene.add(new THREE.HemisphereLight('#cfe3ff', '#6b6355', 0.22));

// Lay the roster out in a line, facing camera.
const ids = SPECIES_ORDER;
const spacing = 3.2;
const creatures: Creature[] = [];

ids.forEach((id, i) => {
  const c = new Creature(id, { phase: i * 0.37 });
  c.group.position.set((i - (ids.length - 1) / 2) * spacing, 0, 0);
  // Face the camera. Creature forward is +Z, and the camera looks down -Z.
  c.group.rotation.y = 0;
  engine.scene.add(c.group);
  creatures.push(c);
});

engine.onUpdate((dt, elapsed) => {
  for (const c of creatures) c.update(dt, elapsed);
});

// Slightly under 1.0 so bright creature palettes keep their top-end detail.
engine.renderer.toneMappingExposure = 0.85;

engine.camera.position.set(0, 2.6, 12);
engine.camera.lookAt(0, 1.1, 0);

engine.start();

// Focus a single species by index, for tight portrait shots.
(window as unknown as { __focus: (i: number) => void }).__focus = (i: number) => {
  const c = creatures[i];
  if (!c) return;
  const p = c.group.position;
  engine.camera.position.set(p.x + 0.9, 1.5, p.z + 3.4);
  engine.camera.lookAt(p.x, c.height * 0.55, p.z);
  engine.camera.updateMatrixWorld(true);
};
(window as unknown as { __species: string[] }).__species = ids.map((i) => SPECIES[i].name);

debug.ready = true;
