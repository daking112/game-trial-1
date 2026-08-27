import * as THREE from 'three';
import { Engine } from './core/Engine';
import { installDebugApi } from './core/Debug';
import { CameraRig } from './core/CameraRig';
import { Environment } from './world/Environment';
import { Track } from './world/Track';
import { Terrain } from './world/Terrain';
import { Battle, Tower, type TowerVisual } from './combat/Battle';
import { WAVES } from './combat/Waves';
import { Hud, type HudSpecies } from './ui/Hud';

const container = document.getElementById('app');
if (!container) throw new Error('#app missing');

const engine = new Engine(container);
const debug = installDebugApi(engine);

const environment = new Environment(engine.scene, { sunAzimuth: 128, sunElevation: 52 });
environment.buildEnvironment(engine.renderer, engine.scene);

// A serpentine route with enough direction changes to give tower placement
// real decisions -- a straight line makes every position equivalent.
const track = new Track([
  new THREE.Vector3(-38, 0, -14),
  new THREE.Vector3(-22, 0, -16),
  new THREE.Vector3(-8, 0, -8),
  new THREE.Vector3(2, 0, 6),
  new THREE.Vector3(16, 0, 10),
  new THREE.Vector3(24, 0, 0),
  new THREE.Vector3(16, 0, -12),
  new THREE.Vector3(2, 0, -18),
  new THREE.Vector3(-6, 0, -26),
  new THREE.Vector3(6, 0, -32),
  new THREE.Vector3(26, 0, -30),
  new THREE.Vector3(38, 0, -22),
], 3.2);

const terrain = new Terrain(track, { size: 90, resolution: 176, amplitude: 2.2 });
engine.scene.add(terrain.mesh);
engine.scene.add(track.mesh);

// --- Roster ---------------------------------------------------------------
// Placeholder stats and colours until the creature system lands; the ids are
// stable so swapping in real species is a visual change only.
const ROSTER: Array<HudSpecies & { damage: number; range: number; rate: number }> = [
  { id: 'sprout',  name: 'Bramblet',  element: 'Verdant', cost: 40,  accent: '#7ad06a', damage: 5,  range: 11, rate: 1.7 },
  { id: 'ember',   name: 'Cindercub', element: 'Ember',   cost: 65,  accent: '#ff8a4d', damage: 11, range: 9.5, rate: 1.1 },
  { id: 'tide',    name: 'Rillfin',   element: 'Tide',    cost: 55,  accent: '#5ac8e8', damage: 7,  range: 13, rate: 1.3 },
  { id: 'storm',   name: 'Voltling',  element: 'Storm',   cost: 90,  accent: '#c69bff', damage: 9,  range: 15, rate: 2.2 },
  { id: 'iron',    name: 'Cogsworth', element: 'Iron',    cost: 120, accent: '#d8b45c', damage: 24, range: 8.5, rate: 0.7 },
];
const COSTS = Object.fromEntries(ROSTER.map((r) => [r.id, r.cost]));

// --- Battle ---------------------------------------------------------------
const hudHost = document.createElement('div');
hudHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
container.appendChild(hudHost);

const battle = new Battle(track, {
  onWaveStart: (i, name) => hud.banner(`Wave ${i} — ${name}`, 'info'),
  onWaveEnd: (i, reward) => hud.banner(`Wave ${i} cleared  +${reward}`, 'good'),
  onPhase: (p) => {
    if (p === 'won') hud.banner('Gearwood holds!', 'good', 99);
    if (p === 'lost') hud.banner('The Thicket falls', 'bad', 99);
  },
});
engine.scene.add(battle.group);

/**
 * Stand-in tower visual until the creature system lands. Deliberately simple
 * and clearly placeholder so it is never mistaken for finished art.
 */
function placeholderTower(color: THREE.ColorRepresentation): TowerVisual {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.7, 6, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 }),
  );
  body.position.y = 0.85;
  body.castShadow = true;
  group.add(body);

  let recoil = 0;
  return {
    group,
    update(dt, elapsed) {
      recoil = Math.max(0, recoil - dt * 4);
      body.position.y = 0.85 + Math.sin(elapsed * 2.2) * 0.03 - recoil * 0.2;
    },
    playAttack() { recoil = 1; },
    faceTarget(worldPos) { group.lookAt(worldPos.x, group.position.y, worldPos.z); },
  };
}

// --- Placement ------------------------------------------------------------
const ghost = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1, 0.06, 40),
  new THREE.MeshBasicMaterial({ color: '#7fffc4', transparent: true, opacity: 0.35, depthWrite: false }),
);
const rangeRing = new THREE.Mesh(
  new THREE.RingGeometry(0.98, 1, 64).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }),
);
ghost.visible = rangeRing.visible = false;
engine.scene.add(ghost, rangeRing);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoverPoint: THREE.Vector3 | null = null;
let hoverValid = false;

function updateHover() {
  const id = hud.selectedSpecies;
  if (!id) { ghost.visible = rangeRing.visible = false; hoverPoint = null; return; }
  raycaster.setFromCamera(pointer, engine.camera);
  const hit = raycaster.intersectObject(terrain.mesh, false)[0];
  if (!hit) { ghost.visible = rangeRing.visible = false; hoverPoint = null; return; }

  const spec = ROSTER.find((r) => r.id === id)!;
  hoverPoint = hit.point.clone();
  hoverValid = battle.canPlace(hoverPoint) && battle.gold >= spec.cost;

  ghost.position.copy(hoverPoint).setY(hoverPoint.y + 0.05);
  rangeRing.position.copy(ghost.position);
  rangeRing.scale.setScalar(spec.range);
  const tint = hoverValid ? '#7fffc4' : '#ff7a7a';
  (ghost.material as THREE.MeshBasicMaterial).color.set(tint);
  (rangeRing.material as THREE.MeshBasicMaterial).color.set(tint);
  ghost.visible = rangeRing.visible = true;
}

container.addEventListener('pointermove', (e) => {
  const r = engine.renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
});

container.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || rig.wasDrag) return;
  const id = hud.selectedSpecies;
  if (!id || !hoverPoint || !hoverValid) return;
  const spec = ROSTER.find((r) => r.id === id)!;

  const spot = hoverPoint.clone().setY(terrain.heightAt(hoverPoint.x, hoverPoint.z));
  const visual = placeholderTower(spec.accent);
  visual.group.position.copy(spot);
  battle.addTower(new Tower(visual, {
    damage: spec.damage,
    range: spec.range,
    rate: spec.rate,
    projectile: { speed: 26, damage: spec.damage, color: spec.accent },
  }, spot));
  battle.gold -= spec.cost;
  hud.select(null);
});

// --- HUD ------------------------------------------------------------------
let speedIndex = 0;
const SPEEDS = [1, 2, 3];

const hud = new Hud(hudHost, ROSTER, {
  onSelectSpecies: () => updateHover(),
  onStartWave: () => { if (battle.phase !== 'running') battle.startWave(); },
  onToggleSpeed: () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    hud.setSpeedLabel(`${SPEEDS[speedIndex]}×`);
  },
});

const rig = new CameraRig(engine.camera, engine.renderer.domElement);

engine.onUpdate((dt, elapsed) => {
  const scaled = dt * SPEEDS[speedIndex];
  rig.update(dt);
  battle.update(scaled, elapsed);
  updateHover();
  hud.update(dt);
  hud.setStats(battle.lives, battle.gold, battle.waveIndex);
  hud.setAffordable(COSTS, battle.gold);
  const running = battle.phase === 'running';
  hud.setWaveButton(
    !running && battle.waveIndex < WAVES.length,
    running ? 'In Progress' : battle.waveIndex >= WAVES.length ? 'Complete' : 'Start Wave',
  );
});

engine.start();

(window as unknown as { __battle: Battle }).__battle = battle;
debug.ready = true;
