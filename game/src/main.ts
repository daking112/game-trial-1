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
import { Foliage } from './world/Foliage';
import { Creature } from './creatures/Creature';
import { SPECIES, SPECIES_ORDER } from './creatures/species';
import { Particles } from './fx/Particles';
import { Feel, FloatingText } from './fx/Feel';
import { GameAudio } from './audio/Audio';
import { Collection, statMultipliers, EVOLUTION_LEVEL, evolutionBonus } from './meta/Progression';
import { CollectionPanel } from './ui/CollectionPanel';
import { SummonPanel } from './ui/SummonPanel';
import { Gacha } from './meta/Gacha';
import { Stars, starMultipliers, starCost, MAX_STARS } from './meta/StarUp';
import { StarPanel } from './ui/StarPanel';
import { HealthBars } from './ui/HealthBars';
import { TowerPanel } from './ui/TowerPanel';
import { EndScreen } from './ui/EndScreen';

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

const foliage = new Foliage(terrain, track, { seed: 90210, density: 0.55 });
engine.scene.add(foliage.group);

// --- Roster ---------------------------------------------------------------
// Derived from the species table so stats, colours and costs have exactly one
// source of truth.
const ROSTER: Array<HudSpecies & { damage: number; range: number; rate: number }> =
  SPECIES_ORDER.filter((id) => SPECIES[id].stage === 1).map((id) => {
    const sp = SPECIES[id];
    return {
      id,
      name: sp.name,
      element: sp.element,
      cost: sp.stats.cost,
      accent: sp.palette.primary,
      damage: sp.stats.damage,
      range: sp.stats.range,
      rate: sp.stats.attackSpeed,
    };
  });
const COSTS = Object.fromEntries(ROSTER.map((r) => [r.id, r.cost]));

const FLAVOUR: Record<string, string> = Object.fromEntries(
  ROSTER.map((r) => [r.id, SPECIES[r.id].tagline]),
);

// --- Battle ---------------------------------------------------------------
const hudHost = document.createElement('div');
hudHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
container.appendChild(hudHost);

const audio = new GameAudio();
// The collection tracks every species, not just the summonable stage-1 ones,
// so evolved forms are recorded in the codex when they are earned.
const collection = new Collection(Object.keys(SPECIES));
// Real play seeds the summon rng from the clock, so two players do not share
// a luck sequence. The capture harness always passes ?demo=1, and a screenshot
// that shows different shard totals on every run cannot be compared against
// the last one, so demo mode pins the seed instead.
const gacha = new Gacha(
  new URLSearchParams(location.search).has('demo') ? 0x5eed1e : undefined,
);
// Star ranks are the duplicate-shard sink; they multiply on top of levels.
const stars = new Stars();

// Browsers block audio until a user gesture; the first interaction unlocks it.
for (const ev of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(ev, () => audio.resume(), { once: true });
}

const startingGold = 300;
const endScreen = new EndScreen(hudHost, () => window.location.reload());

const particles = new Particles();
engine.scene.add(particles.points);

const feel = new Feel();
const floaters = new FloatingText(hudHost);
// Enemy health, readable from the overview camera rather than only up close.
const healthBars = new HealthBars(hudHost);

const battle = new Battle(track, {
  onWaveStart: (i, name) => { hud.banner(`Wave ${i} — ${name}`, 'info'); audio.fanfare(); },
  onWaveEnd: (i, reward) => {
    // Cogs are the meta currency and the only way to summon. Paying them per
    // wave ties the gacha to actually playing rather than to idling.
    const cogs = 30 + i * 10;
    gacha.addCogs(cogs);
    hud.banner(`Wave ${i} cleared  +${reward} scrap  +${cogs} cogs`, 'good');
    audio.fanfare(true);
  },

  onHit: (at, spec) => {
    // Small, sharp spark. Impacts must read instantly without burying the
    // enemy they landed on.
    particles.burst(at, {
      count: 7, color: spec.color, speed: [2.5, 7], life: [0.14, 0.3],
      size: 7, gravity: 5,
    });
    audio.hit();
  },

  onKill: (enemy, at) => {
    const a = enemy.archetype;
    const big = a.tier === 'colossus' || a.tier === 'warden';
    particles.burst(at, {
      count: big ? 46 : 20,
      color: a.trim,
      speed: big ? [4, 15] : [3, 9],
      life: [0.32, 0.72], size: big ? 13 : 8.5, gravity: 8.5,
    });
    particles.burst(at, {
      count: big ? 22 : 10, color: a.shell,
      speed: [2, 7], life: [0.35, 0.8], size: 7, gravity: 12,
    });
    floaters.spawn(at, `+${a.bounty}`, '#ffd35c');
    feel.shake(big ? 0.42 : 0.11);
    audio.pop(big);
    if (a.tier === 'colossus') feel.hitStop(0.12, 0.18);

    // Split the kill's XP across every creature that could have contributed,
    // so support placements still progress rather than only the last shooter.
    const xp = Math.max(1, Math.round(a.maxHealth * 0.5));
    for (const t of battle.towers) {
      const id = (t.visual as { speciesId?: string }).speciesId;
      if (!id) continue;
      if (t.position.distanceTo(at) > t.stats.range * 1.15) continue;
      collection.recordKill(id);
      const newLevel = collection.awardXp(id, xp);
      if (newLevel) {
        const r = ROSTER.find((x) => x.id === id);
        hud.banner(`${r?.name ?? id} reached Lv.${newLevel}`, 'good', 1.8);
        floaters.spawn(t.position, `Lv.${newLevel}`, r?.accent ?? '#fff', 1.3);
      }
      // Checked every kill, not only on the level-up frame: a creature
      // carried in above the threshold from a previous run would otherwise
      // never evolve at all.
      evolveIfPossible(t);
    }
  },

  onFire: (t) => audio.shoot(0.85 + (t.stats.rate % 0.7)),

  onLeak: (enemy) => {
    floaters.spawn(enemy.position, `-${enemy.archetype.leak}`, '#ff7a7a', 1.1);
    feel.shake(0.3);
    audio.leak();
  },

  onPhase: (p) => {
    if (p !== 'won' && p !== 'lost') return;
    hud.banner(p === 'won' ? 'Gearwood holds!' : 'The Thicket falls', p === 'won' ? 'good' : 'bad', 2.4);

    const best = collection.all()
      .filter((e) => e.kills > 0)
      .sort((a, b) => b.kills - a.kills)[0];

    endScreen.show(p === 'won', {
      wavesCleared: p === 'won' ? WAVES.length : Math.max(0, battle.waveIndex - 1),
      totalWaves: WAVES.length,
      livesLeft: battle.lives,
      goldEarned: Math.max(0, battle.gold - startingGold),
      caught: collection.caughtCount,
      totalSpecies: Object.keys(SPECIES).length,
      bestCreature: best
        ? { name: SPECIES[best.speciesId]?.name ?? best.speciesId, kills: best.kills, level: best.level }
        : undefined,
    });
  },
});
engine.scene.add(battle.group);

/**
 * Wraps a Creature as a tower.
 *
 * The combat layer only needs the structural TowerVisual contract, so the
 * creature stays unaware it is being used as a tower; turning to face a target
 * is added here rather than baked into the creature itself.
 */
/**
 * Ground pad placed under every creature.
 *
 * Creatures are small and often the same green as the undergrowth they stand
 * in; without a pad the player cannot read their own board at a glance, which
 * is the one thing a tower defense must never take away. The pad reads as a
 * cleared patch of earth ringed in the creature's element colour.
 */
function creaturePad(accent: THREE.ColorRepresentation): THREE.Group {
  const pad = new THREE.Group();

  const earth = new THREE.Mesh(
    new THREE.CircleGeometry(1.05, 40).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: '#6b5a3e', roughness: 0.98, metalness: 0,
      transparent: true, opacity: 0.92,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }),
  );
  earth.receiveShadow = true;
  pad.add(earth);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.02, 1.2, 44).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
  );
  pad.add(ring);

  pad.position.y = 0.04;
  return pad;
}

function creatureTower(speciesId: string): TowerVisual & { speciesId: string; creature: Creature } {
  const creature = new Creature(speciesId);
  let turn = creature.group.rotation.y;

  // The pad is a sibling under a wrapper so the creature can turn to face
  // targets without spinning the pad with it.
  const wrapper = new THREE.Group();
  const pad = creaturePad(SPECIES[speciesId].palette.accent);
  pad.scale.setScalar(1.35);
  wrapper.add(pad);
  const inner = new THREE.Group();
  // Creatures are authored at roughly life scale, which loses them against
  // waist-high undergrowth. The board must read at a glance, so they are
  // deliberately oversized relative to the world -- the same cheat Bloons and
  // most tower defenses use for their towers.
  inner.scale.setScalar(1.75);
  inner.add(creature.group);
  wrapper.add(inner);

  return {
    speciesId,
    creature,
    group: wrapper,
    update(dt, elapsed) {
      creature.update(dt, elapsed);
      // Ease toward the desired facing so aim reads as a turn, not a snap.
      const cur = inner.rotation.y;
      let delta = turn - cur;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      inner.rotation.y = cur + delta * (1 - Math.exp(-dt * 9));
    },
    playAttack() { creature.playAttack(); },
    faceTarget(worldPos) {
      turn = Math.atan2(worldPos.x - wrapper.position.x, worldPos.z - wrapper.position.z);
    },
    dispose() { creature.dispose(); },
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

  // Not placing: treat the click as a selection attempt on an existing tower.
  if (!id) {
    raycaster.setFromCamera(pointer, engine.camera);
    const hit = raycaster.intersectObject(terrain.mesh, false)[0];
    const picked = hit ? battle.towerAt(hit.point, 2.0) : null;
    if (picked) {
      const sid = (picked.visual as { speciesId?: string }).speciesId;
      towerPanel.show(picked, towerName(picked), sid ? SPECIES[sid].palette.accent : '#7ad0a8');
      towerPanel.refresh(battle.gold);
      selectRing.position.copy(picked.position).setY(picked.position.y + 0.06);
      selectRing.scale.setScalar(picked.stats.range);
      selectRing.visible = true;
    } else {
      towerPanel.hide();
      selectRing.visible = false;
    }
    return;
  }

  if (!hoverPoint || !hoverValid) return;
  const spec = ROSTER.find((r) => r.id === id)!;
  placeCreature(spec, hoverPoint);
  audio.place();
  hud.select(null);
});

/**
 * Build and place one creature, applying every progression multiplier the
 * player has earned for that species.
 *
 * Split out of the pointer handler so the level and star maths sit on a single
 * testable path -- `tools/test-stars.mjs` drives this directly instead of
 * synthesising clicks, so the tested path and the played path cannot drift.
 */
function placeCreature(spec: (typeof ROSTER)[number], at: THREE.Vector3): Tower {
  const spot = at.clone().setY(terrain.heightAt(at.x, at.z));
  const visual = creatureTower(spec.id);
  visual.group.position.copy(spot);

  // Carried-over levels from previous runs make a placement stronger.
  const entry = collection.get(spec.id);
  const lvl = statMultipliers(entry?.level ?? 1);
  // Levels come from play, stars from duplicates. They stack multiplicatively,
  // so investing in both beats maxing either alone.
  const star = starMultipliers(stars.effective(spec.id));
  const damage = spec.damage * lvl.damage * star.damage;
  const tower = new Tower(visual, {
    damage,
    range: spec.range * lvl.range * star.range,
    rate: spec.rate * lvl.rate * star.rate,
    projectile: { speed: 26, damage, color: spec.accent },
  }, spot, spec.cost);
  battle.addTower(tower);

  battle.gold -= spec.cost;
  collection.markCaught(spec.id);
  // A creature carried in above the threshold evolves the moment it lands.
  evolveIfPossible(tower);
  return tower;
}

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
  onOpenCodex: () => codex.toggle(),
  onOpenSummon: () => summon.toggle(),
});

const codex = new CollectionPanel(hudHost, ROSTER.map((r) => ({
  id: r.id, name: r.name, element: r.element, accent: r.accent,
  flavour: FLAVOUR[r.id] ?? '',
})), collection);

const selectRing = new THREE.Mesh(
  new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.42, depthWrite: false }),
);
selectRing.visible = false;
engine.scene.add(selectRing);

const towerPanel = new TowerPanel(hudHost, {
  onUpgrade: (t) => {
    if (!battle.upgrade(t)) return;
    audio.place();
    floaters.spawn(t.position, `Tier ${t.tier}`, '#9effd0', 1.1);
    towerPanel.rerender(towerName(t));
    towerPanel.refresh(battle.gold);
    selectRing.scale.setScalar(t.stats.range);
  },
  onSell: (t) => {
    const refund = t.sellValue;
    floaters.spawn(t.position, `+${refund}`, '#ffd35c');
    battle.sell(t);
    audio.leak();
    towerPanel.hide();
    selectRing.visible = false;
  },
  onClose: () => { towerPanel.hide(); selectRing.visible = false; },
});

/**
 * Swap a tower's creature for its evolved form in place.
 *
 * The Tower keeps its identity -- position, tier and invested scrap all carry
 * over -- because an evolution that reset the player's upgrades would read as
 * a punishment for succeeding.
 */
function evolveIfPossible(t: Tower) {
  const vis = t.visual as { speciesId?: string; creature?: Creature };
  const id = vis.speciesId;
  if (!id) return;
  const next = SPECIES[id]?.evolvesTo;
  if (!next || !SPECIES[next]) return;
  if ((collection.get(id)?.level ?? 1) < EVOLUTION_LEVEL) return;

  const evolved = creatureTower(next);
  evolved.group.position.copy(t.visual.group.position);
  evolved.group.rotation.copy(t.visual.group.rotation);
  evolved.group.scale.copy(t.visual.group.scale);

  battle.group.remove(t.visual.group);
  vis.creature?.dispose();

  // Rebind the tower to the new visual. Stats take the evolved species' base
  // plus a bonus, then re-apply the tiers already bought.
  (t as unknown as { visual: TowerVisual }).visual = evolved;
  battle.group.add(evolved.group);

  const sp = SPECIES[next];
  const bonus = evolutionBonus();
  const tierMult = 1.42 ** (t.tier - 1);
  // Rebuilding stats from the species base drops everything that was layered
  // on top of it, so the level and star multipliers have to be re-applied
  // here. Without this, evolving quietly deleted a player's star investment
  // -- around a dozen full runs of shards -- at the exact moment the game
  // told them they had succeeded.
  const lvl = statMultipliers(collection.get(id)?.level ?? 1);
  const star = starMultipliers(stars.effective(next));
  t.stats.damage = sp.stats.damage * bonus.damage * tierMult * lvl.damage * star.damage;
  t.stats.range = sp.stats.range * bonus.range * 1.1 ** (t.tier - 1) * lvl.range * star.range;
  t.stats.rate = sp.stats.attackSpeed * bonus.rate * 1.16 ** (t.tier - 1) * lvl.rate * star.rate;
  t.stats.projectile.damage = t.stats.damage;
  t.stats.projectile.color = sp.palette.glow;

  collection.markCaught(next);
  hud.banner(`${SPECIES[id].name} evolved into ${sp.name}!`, 'good', 3.0);
  floaters.spawn(t.position, sp.name, sp.palette.accent, 1.8);
  particles.burst(t.position.clone().setY(t.position.y + 0.8), {
    count: 54, color: sp.palette.glow, speed: [2, 9],
    life: [0.4, 0.95], size: 11, gravity: -1.5,
  });
  feel.shake(0.22);
  audio.fanfare(true);
}

function towerName(t: Tower): string {
  const id = (t.visual as { speciesId?: string }).speciesId;
  return id ? SPECIES[id].name : 'Creature';
}

const ownedSpecies = () =>
  new Set(collection.all().filter((e) => e.caught).map((e) => e.speciesId));

/** Species holding enough shards to buy their next star right now. */
const starsReady = () =>
  [...ownedSpecies()].filter((id) => stars.canAfford(id, gacha)).length;

const starPanel = new StarPanel(hudHost, gacha, stars, {
  owned: ownedSpecies,
  onUpgrade: (_id, rank) => {
    audio.fanfare(rank >= MAX_STARS);
    hud.banner(`Star rank ${rank}`, 'good');
  },
  onClose: () => starPanel.toggle(),
});

const summon = new SummonPanel(hudHost, gacha, {
  owned: ownedSpecies,
  onNewSpecies: (id) => {
    collection.markCaught(id);
    audio.fanfare(true);
  },
  onClose: () => summon.toggle(),
  onOpenStars: () => {
    // One screen at a time: the star screen is a step out of the summoning
    // screen, not a layer on top of it.
    if (summon.isOpen) summon.toggle();
    starPanel.toggle();
  },
  starsReady,
});

const rig = new CameraRig(engine.camera, engine.renderer.domElement);

engine.onUpdate((dt, elapsed) => {
  rig.update(dt);
  // Feel returns a time scale so hit-stop slows the sim without slowing the
  // camera or the UI, which would read as a frame hitch instead of impact.
  const timeScale = feel.update(dt, engine.camera);
  const scaled = dt * SPEEDS[speedIndex] * timeScale;

  battle.update(scaled, elapsed);
  foliage.update(scaled, elapsed);
  particles.update(scaled);

  const size = engine.renderer.getSize(new THREE.Vector2());
  floaters.update(dt, engine.camera, size.x, size.y);
  // Unscaled dt: hit-stop slows the sim, and a bar that froze with it would
  // read as a dropped frame rather than as impact.
  healthBars.update(dt, engine.camera, battle.enemies, size.x, size.y);

  updateHover();
  hud.update(dt);
  summon.update(dt);
  endScreen.update(dt);
  hud.setStats(battle.lives, battle.gold, battle.waveIndex);
  hud.setWaveProgress(battle.waveProgress);
  hud.setAffordable(COSTS, battle.gold);
  towerPanel.refresh(battle.gold);
  const running = battle.phase === 'running';
  hud.setWaveButton(
    !running && battle.waveIndex < WAVES.length,
    running ? 'In Progress' : battle.waveIndex >= WAVES.length ? 'Complete' : 'Start Wave',
  );
});

// Demo mode (?demo=1) seeds towers and opens a wave mid-fight so the
// screenshot harness and the headless simulation have live combat to look at.
// A real player must always get a clean board and press Start Wave themselves.
const DEMO = new URLSearchParams(location.search).has('demo');
if (DEMO) {
  const seedIds = ROSTER.map((r) => r.id);
  const seedSpots = [
    new THREE.Vector3(-14, 0, -6),
    new THREE.Vector3(6, 0, 2),
    new THREE.Vector3(-4, 0, -14),
  ];
  for (let i = 0; i < seedSpots.length; i++) {
    const spot = seedSpots[i];
    spot.y = terrain.heightAt(spot.x, spot.z);
    const visual = creatureTower(seedIds[i % seedIds.length]);
    visual.group.position.copy(spot);
    const sp = SPECIES[visual.speciesId];
    battle.addTower(new Tower(visual, {
      damage: sp.stats.damage, range: sp.stats.range, rate: sp.stats.attackSpeed,
      projectile: { speed: 26, damage: sp.stats.damage, color: sp.palette.glow },
    }, spot.clone(), sp.stats.cost));
  }
  battle.startWave(4);
}

engine.start();

(window as unknown as { __battle: Battle; __codex: CollectionPanel }).__battle = battle;
(window as unknown as { __codex: CollectionPanel }).__codex = codex;
(window as unknown as { __summon: SummonPanel }).__summon = summon;
(window as unknown as { __gacha: Gacha }).__gacha = gacha;
(window as unknown as { __stars: Stars }).__stars = stars;
(window as unknown as { __starPanel: StarPanel }).__starPanel = starPanel;
// Test hook: the star cost curve, so `tools/test-economy.mjs` measures the
// same function the star-up UI charges against.
(window as unknown as { __starCost: (id: string, s: number) => number | null }).__starCost =
  (id, s) => starCost(id, s);
// Placement driven from a tool, so tests exercise the same multiplier path a
// real click does.
(window as unknown as { __place: (id: string, x: number, z: number) => Tower | null }).__place =
  (id, x, z) => {
    const spec = ROSTER.find((r) => r.id === id);
    return spec ? placeCreature(spec, new THREE.Vector3(x, 0, z)) : null;
  };
(window as unknown as { __collection: Collection }).__collection = collection;

// Test hook: force a terminal phase so the end screen can be captured.
(window as unknown as { __forceEnd: (won: boolean) => void }).__forceEnd = (won: boolean) => {
  battle.lives = won ? battle.lives : 0;
  battle.waveIndex = won ? WAVES.length : 6;
  (battle as unknown as { setPhase(p: string): void }).setPhase(won ? 'won' : 'lost');
};

// Test hook: select the first placed tower so the inspector can be captured.
(window as unknown as { __selectFirstTower: () => void }).__selectFirstTower = () => {
  const t = battle.towers[0];
  if (!t) return;
  const sid = (t.visual as { speciesId?: string }).speciesId;
  towerPanel.show(t, towerName(t), sid ? SPECIES[sid].palette.accent : '#7ad0a8');
  towerPanel.refresh(battle.gold);
  selectRing.position.copy(t.position).setY(t.position.y + 0.06);
  selectRing.scale.setScalar(t.stats.range);
  selectRing.visible = true;
};
debug.ready = true;
