import * as THREE from 'three';
import { Engine } from './core/Engine';
import { installDebugApi } from './core/Debug';
import { Environment } from './world/Environment';
import { Track } from './world/Track';
import { Terrain } from './world/Terrain';
import { Battle, Tower, type TowerVisual } from './combat/Battle';

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

const battle = new Battle(track, {
  onPhase: (p) => console.info('[battle] phase', p),
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
    faceTarget(worldPos) {
      group.lookAt(worldPos.x, group.position.y, worldPos.z);
    },
  };
}

// Seed a few towers alongside the track so the battle has something to do.
const seedSpots = [
  new THREE.Vector3(-14, 0, -6),
  new THREE.Vector3(6, 0, 0),
  new THREE.Vector3(20, 0, -20),
  new THREE.Vector3(-2, 0, -24),
];
for (const spot of seedSpots) {
  spot.y = terrain.heightAt(spot.x, spot.z);
  const visual = placeholderTower('#7ad0a8');
  visual.group.position.copy(spot);
  battle.addTower(new Tower(visual, {
    damage: 6,
    range: 11,
    rate: 1.6,
    projectile: { speed: 26, damage: 6, color: '#9effd0' },
  }, spot.clone()));
}

engine.onUpdate((dt, elapsed) => battle.update(dt, elapsed));
battle.startWave(4);

engine.camera.position.set(0, 22, 52);
engine.camera.lookAt(0, 2, -10);

engine.start();

(window as unknown as { __battle: Battle }).__battle = battle;
debug.ready = true;
