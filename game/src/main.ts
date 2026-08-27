import * as THREE from 'three';
import { Engine } from './core/Engine';
import { installDebugApi } from './core/Debug';
import { Environment } from './world/Environment';
import { Track } from './world/Track';
import { Terrain } from './world/Terrain';

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

engine.camera.position.set(0, 34, 44);
engine.camera.lookAt(0, 0, -6);

engine.start();
debug.ready = true;
