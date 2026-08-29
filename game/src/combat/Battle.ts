import * as THREE from 'three';
import type { Track } from '../world/Track';
import { Enemy, EnemyMarkers, ARCHETYPES, type EnemyTier, type DamageKind, type DamageResult } from './Enemy';
import { WAVES, scheduleWave, type ScheduledSpawn } from './Waves';
import { ProjectilePool, type ProjectileSpec } from './Projectile';
import { Particles } from '../fx/Particles';
import { playImpact, playDeath, playShieldBreak, playTrail, playMuzzle, DEATHS } from '../fx/Impacts';

/**
 * Minimal contract a placed creature must satisfy to act as a tower.
 *
 * Kept structural rather than importing the concrete Creature class so the
 * combat layer and the creature-art layer can evolve independently.
 */
export interface TowerVisual {
  group: THREE.Object3D;
  update(dt: number, elapsed: number): void;
  playAttack?(): void;
  faceTarget?(worldPos: THREE.Vector3): void;
  dispose?(): void;
  /**
   * Read structurally so combat can tint impacts by element without the
   * wiring layer having to pass it down. Optional on purpose: a tower that
   * does not declare one still fights, it just impacts as generic metal.
   */
  creature?: { species?: { stats?: { projectile?: string } } };
}

export interface TowerStats {
  damage: number;
  range: number;
  /** Attacks per second. */
  rate: number;
  projectile: ProjectileSpec;
}

export const MAX_TOWER_TIER = 4;

const KINDS: readonly string[] = ['seed', 'ember', 'jet', 'bolt', 'shard'];

/** Element of a tower's shots, from its spec or, failing that, its creature. */
function towerKind(t: Tower): DamageKind | undefined {
  if (t.stats.projectile.kind) return t.stats.projectile.kind;
  const p = t.visual.creature?.species?.stats?.projectile;
  return p && KINDS.includes(p) ? (p as DamageKind) : undefined;
}

export class Tower {
  cooldown = 0;
  /** Upgrade tier, 1..MAX_TOWER_TIER. */
  tier = 1;
  /** Total scrap sunk in, for computing sell value. */
  invested: number;

  constructor(
    readonly visual: TowerVisual,
    readonly stats: TowerStats,
    readonly position: THREE.Vector3,
    readonly baseCost: number = 0,
  ) {
    this.invested = baseCost;
  }

  /** Cost of the next tier, or null at max. */
  get upgradeCost(): number | null {
    if (this.tier >= MAX_TOWER_TIER) return null;
    // Each tier costs progressively more than the last so late upgrades
    // compete with simply placing another creature.
    return Math.round(this.baseCost * (0.85 + this.tier * 0.55));
  }

  /** Refund on sell. Deliberately lossy so placement stays a real decision. */
  get sellValue(): number {
    return Math.floor(this.invested * 0.6);
  }

  applyUpgrade(cost: number) {
    this.tier++;
    this.invested += cost;
    this.stats.damage *= 1.42;
    this.stats.range *= 1.1;
    this.stats.rate *= 1.16;
    this.stats.projectile.damage = this.stats.damage;
    this.visual.group.scale.multiplyScalar(1.07);
  }
}

const _aim = new THREE.Vector3();

export type BattlePhase = 'idle' | 'running' | 'won' | 'lost';

/** Everything the presentation layer needs to know about one landed shot. */
export interface HitReport {
  at: THREE.Vector3;
  heading: THREE.Vector3;
  spec: ProjectileSpec;
  kind?: DamageKind;
  enemy: Enemy;
  result: DamageResult;
}

export interface BattleEvents {
  onKill?(enemy: Enemy, at: THREE.Vector3): void;
  onFire?(tower: Tower): void;
  onLeak?(enemy: Enemy): void;
  onHit?(at: THREE.Vector3, spec: ProjectileSpec, report?: HitReport): void;
  onWaveStart?(index: number, name: string, brief?: string): void;
  onWaveEnd?(index: number, reward: number): void;
  onPhase?(phase: BattlePhase): void;
  /** Fired the frame the boss enters, for a banner and a horn. */
  onBoss?(enemy: Enemy): void;
  /** Fired when a shielded enemy's shield collapses. */
  onShieldBreak?(enemy: Enemy, at: THREE.Vector3): void;
  /** Screen-shake request, already scaled by what caused it. */
  onShake?(amount: number): void;
  /** Hit-stop request in seconds; zero means none. */
  onHitStop?(seconds: number): void;
}

export interface BattleOptions {
  /**
   * Shared particle system. Combat drives all of its own impact, death and
   * shield FX through it, because only combat knows what element hit what
   * armour. If omitted a private one is created and parented to `group`.
   */
  particles?: Particles;
}

/**
 * Battle orchestrator: spawning, targeting, damage, economy and win/loss.
 *
 * Targeting defaults to "furthest along the track", which is the standard
 * tower-defense rule because it maximises the value of a kill — an enemy two
 * steps from the exit is worth far more dead than one that just spawned.
 */
export class Battle {
  readonly group = new THREE.Group();
  readonly projectiles = new ProjectilePool(200);
  readonly enemies: Enemy[] = [];
  readonly towers: Tower[] = [];
  /** Dead bodies still playing their pop. Not targetable, not counted. */
  readonly corpses: Enemy[] = [];
  readonly markers = new EnemyMarkers(96);
  readonly particles: Particles;

  phase: BattlePhase = 'idle';
  lives = 55;
  gold = 300;
  waveIndex = 0;

  private schedule: ScheduledSpawn[] = [];
  private scheduleCursor = 0;
  private waveClock = 0;
  private seed = 0;
  private betweenWaves = 0;
  private ownsParticles = false;
  private readonly trail = (at: THREE.Vector3, color: THREE.ColorRepresentation) =>
    playTrail(this.particles, at, color);

  constructor(
    private readonly track: Track,
    private readonly events: BattleEvents = {},
    options: BattleOptions = {},
  ) {
    this.group.add(this.projectiles.group);
    this.group.add(this.markers.mesh);
    if (options.particles) {
      this.particles = options.particles;
    } else {
      this.particles = new Particles(11);
      this.ownsParticles = true;
      this.group.add(this.particles.points);
    }
  }

  startWave(index = this.waveIndex + 1) {
    const wave = WAVES[index - 1];
    if (!wave) return;
    this.waveIndex = index;
    this.schedule = scheduleWave(wave);
    this.scheduleCursor = 0;
    this.waveClock = 0;
    this.setPhase('running');
    this.events.onWaveStart?.(wave.index, wave.name, wave.brief);
  }

  addTower(tower: Tower) {
    this.towers.push(tower);
    this.group.add(tower.visual.group);
  }

  /** Upgrade a tower if it is affordable and not maxed. Returns success. */
  upgrade(tower: Tower): boolean {
    const cost = tower.upgradeCost;
    if (cost === null || this.gold < cost) return false;
    this.gold -= cost;
    tower.applyUpgrade(cost);
    return true;
  }

  /** Sell a tower for a partial refund. */
  sell(tower: Tower): boolean {
    const i = this.towers.indexOf(tower);
    if (i < 0) return false;
    this.gold += tower.sellValue;
    this.towers.splice(i, 1);
    this.group.remove(tower.visual.group);
    tower.visual.dispose?.();
    return true;
  }

  /** Nearest tower to a world point within `radius`, or null. */
  towerAt(point: THREE.Vector3, radius = 1.6): Tower | null {
    let best: Tower | null = null;
    let bestD = radius;
    for (const t of this.towers) {
      const d = t.position.distanceTo(point);
      if (d < bestD) { best = t; bestD = d; }
    }
    return best;
  }

  /** True if a tower may be placed here: on land, off the road, not stacked. */
  canPlace(point: THREE.Vector3, radius = 1.1): boolean {
    if (this.track.distanceToPath(point) < 2.2) return false;
    for (const t of this.towers) {
      if (t.position.distanceTo(point) < radius * 2) return false;
    }
    return true;
  }

  private setPhase(p: BattlePhase) {
    if (this.phase === p) return;
    this.phase = p;
    this.events.onPhase?.(p);
  }

  private spawn(tier: EnemyTier, distance = 0) {
    const e = new Enemy(ARCHETYPES[tier], distance, this.seed++);
    this.enemies.push(e);
    this.group.add(e.group);
    if (ARCHETYPES[tier].boss) {
      this.events.onBoss?.(e);
      this.events.onShake?.(0.3);
    }
  }

  update(dt: number, elapsed: number) {
    // Only when the pool is ours. A shared pool is stepped by whoever owns it;
    // stepping it twice ages every particle at double rate.
    if (this.ownsParticles) this.particles.update(dt);

    if (this.phase !== 'running') {
      this.stepCorpses(dt, elapsed);
      // Brief breather between waves so the player can spend and reposition.
      if (this.phase === 'idle' && this.betweenWaves > 0) {
        this.betweenWaves -= dt;
        if (this.betweenWaves <= 0 && this.waveIndex < WAVES.length) this.startWave();
      }
      for (const t of this.towers) t.visual.update(dt, elapsed);
      this.markers.sync(this.enemies);
      return;
    }

    this.waveClock += dt;

    // Spawning.
    while (
      this.scheduleCursor < this.schedule.length &&
      this.schedule[this.scheduleCursor].at <= this.waveClock
    ) {
      this.spawn(this.schedule[this.scheduleCursor].tier);
      this.scheduleCursor++;
    }

    // Enemies.
    for (const e of this.enemies) {
      const wasAlive = e.alive;
      e.update(dt, elapsed, this.track);
      if (wasAlive && !e.alive && e.leaked) {
        e.leaked = false;
        this.lives -= e.archetype.leak;
        this.events.onLeak?.(e);
        this.events.onShake?.(0.3);
        if (this.lives <= 0) {
          this.lives = 0;
          this.setPhase('lost');
          return;
        }
      }
    }
    this.stepCorpses(dt, elapsed);

    // Towers acquire and fire.
    for (const t of this.towers) {
      t.cooldown -= dt;
      t.visual.update(dt, elapsed);
      if (t.cooldown > 0) continue;

      const target = this.acquire(t);
      if (!target) continue;

      t.visual.faceTarget?.(target.position);
      const origin = t.position.clone().setY(t.position.y + 0.9);
      // Stamp the element once, here, rather than resolving it per impact.
      if (!t.stats.projectile.kind) {
        const k = towerKind(t);
        if (k) t.stats.projectile.kind = k;
      }
      if (this.projectiles.fire(origin, target, t.stats.projectile)) {
        t.cooldown = 1 / Math.max(0.05, t.stats.rate);
        t.visual.playAttack?.();
        // Muzzle flash: the other half of making a shot traceable. Without it
        // a projectile appears from nowhere a metre in front of the creature.
        _aim.subVectors(target.position, origin).normalize();
        playMuzzle(this.particles, origin, t.stats.projectile.kind, _aim);
        this.events.onFire?.(t);
      }
    }

    // Projectile hits. The trail is laid here so every shot in the air draws
    // a visible line from the tower that fired it to the enemy it is chasing.
    for (const hit of this.projectiles.update(dt, this.trail)) {
      this.applyDamage(hit.enemy, hit.spec, hit.at, hit.heading);
    }

    this.reap();
    this.markers.sync(this.enemies);

    // Wave complete once the schedule is drained and the field is clear.
    if (this.scheduleCursor >= this.schedule.length && this.enemies.length === 0) {
      const wave = WAVES[this.waveIndex - 1];
      this.gold += wave.reward;
      this.events.onWaveEnd?.(wave.index, wave.reward);
      if (this.waveIndex >= WAVES.length) {
        this.setPhase('won');
      } else {
        this.setPhase('idle');
        this.betweenWaves = 4.0;
      }
    }
  }

  private stepCorpses(dt: number, elapsed: number) {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.update(dt, elapsed, this.track);
      if (c.expired) {
        this.group.remove(c.group);
        c.dispose();
        this.corpses.splice(i, 1);
      }
    }
  }

  /**
   * Pick a target for a tower: the enemy furthest along the track that is
   * still inside range. Ties are broken by whichever is closest, so a tower
   * never flickers between two enemies at identical progress.
   */
  private acquire(t: Tower): Enemy | null {
    let best: Enemy | null = null;
    let bestProgress = -1;
    let bestDist = Infinity;
    const r2 = t.stats.range * t.stats.range;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d2 = e.position.distanceToSquared(t.position);
      if (d2 > r2) continue;
      if (e.distance > bestProgress || (e.distance === bestProgress && d2 < bestDist)) {
        best = e;
        bestProgress = e.distance;
        bestDist = d2;
      }
    }
    return best;
  }

  private applyDamage(enemy: Enemy, spec: ProjectileSpec, at: THREE.Vector3, heading: THREE.Vector3) {
    const kind = spec.kind;
    const result = enemy.takeDamage(spec.damage, kind);

    // Impact FX are chosen from what actually happened, not from what was
    // fired: a shot that bounced off armour must not look like one that bit.
    playImpact(this.particles, at, {
      kind,
      shielded: result.shielded && !result.shieldBroke,
      deflected: result.deflected,
    }, heading);

    if (result.shieldBroke) {
      playShieldBreak(this.particles, at, enemy.archetype.scale);
      this.events.onShieldBreak?.(enemy, at);
      this.events.onShake?.(enemy.archetype.boss ? 0.4 : 0.14);
    }

    this.events.onHit?.(at, spec, { at, heading, spec, kind, enemy, result });

    if (spec.splash && spec.splash > 0) {
      for (const other of this.enemies) {
        if (other === enemy || !other.alive) continue;
        if (other.position.distanceTo(at) <= spec.splash) {
          if (other.takeDamage(spec.damage * 0.55, kind).killed) this.onKilled(other);
        }
      }
    }
    if (result.killed) this.onKilled(enemy);
  }

  private onKilled(enemy: Enemy) {
    this.gold += enemy.archetype.bounty;
    const a = enemy.archetype;
    // Burst from the body's mass, not from its feet.
    const at = enemy.position.clone().setY(enemy.centreY);

    playDeath(this.particles, at, a.tier, a.shell, a.trim);
    const d = DEATHS[a.tier];
    this.events.onShake?.(d.shake);
    if (d.stop > 0) this.events.onHitStop?.(d.stop);
    this.events.onKill?.(enemy, at);

    // Bloons-style split: children continue from the parent's position,
    // fanned slightly so they do not overlap into a single silhouette.
    const split = a.splitsInto;
    if (split) {
      for (let i = 0; i < split.count; i++) {
        this.spawn(split.tier, Math.max(0, enemy.distance - i * 1.15));
      }
    }
  }

  private reap() {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.alive) continue;
      this.enemies.splice(i, 1);
      // Killed enemies stay in the scene long enough to play their pop;
      // leaked ones are already gone and expire on the same frame.
      if (e.expired) {
        this.group.remove(e.group);
        e.dispose();
      } else {
        this.corpses.push(e);
      }
    }
  }

  dispose() {
    for (const e of this.enemies) e.dispose();
    for (const e of this.corpses) e.dispose();
    this.markers.dispose();
    if (this.ownsParticles) this.particles.dispose();
    this.projectiles.dispose();
  }
}
