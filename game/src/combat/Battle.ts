import * as THREE from 'three';
import type { Track } from '../world/Track';
import { Enemy, ARCHETYPES, type EnemyTier } from './Enemy';
import { WAVES, scheduleWave, type ScheduledSpawn } from './Waves';
import { ProjectilePool, type ProjectileSpec } from './Projectile';

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
}

export interface TowerStats {
  damage: number;
  range: number;
  /** Attacks per second. */
  rate: number;
  projectile: ProjectileSpec;
}

export class Tower {
  cooldown = 0;
  constructor(
    readonly visual: TowerVisual,
    readonly stats: TowerStats,
    readonly position: THREE.Vector3,
  ) {}
}

export type BattlePhase = 'idle' | 'running' | 'won' | 'lost';

export interface BattleEvents {
  onKill?(enemy: Enemy, at: THREE.Vector3): void;
  onFire?(tower: Tower): void;
  onLeak?(enemy: Enemy): void;
  onHit?(at: THREE.Vector3, spec: ProjectileSpec): void;
  onWaveStart?(index: number, name: string): void;
  onWaveEnd?(index: number, reward: number): void;
  onPhase?(phase: BattlePhase): void;
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

  phase: BattlePhase = 'idle';
  lives = 40;
  gold = 120;
  waveIndex = 0;

  private schedule: ScheduledSpawn[] = [];
  private scheduleCursor = 0;
  private waveClock = 0;
  private seed = 0;
  private betweenWaves = 0;

  constructor(private readonly track: Track, private readonly events: BattleEvents = {}) {
    this.group.add(this.projectiles.group);
  }

  startWave(index = this.waveIndex + 1) {
    const wave = WAVES[index - 1];
    if (!wave) return;
    this.waveIndex = index;
    this.schedule = scheduleWave(wave);
    this.scheduleCursor = 0;
    this.waveClock = 0;
    this.setPhase('running');
    this.events.onWaveStart?.(wave.index, wave.name);
  }

  addTower(tower: Tower) {
    this.towers.push(tower);
    this.group.add(tower.visual.group);
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
  }

  update(dt: number, elapsed: number) {
    if (this.phase !== 'running') {
      // Brief breather between waves so the player can spend and reposition.
      if (this.phase === 'idle' && this.betweenWaves > 0) {
        this.betweenWaves -= dt;
        if (this.betweenWaves <= 0 && this.waveIndex < WAVES.length) this.startWave();
      }
      for (const t of this.towers) t.visual.update(dt, elapsed);
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
        if (this.lives <= 0) {
          this.lives = 0;
          this.setPhase('lost');
          return;
        }
      }
    }

    // Towers acquire and fire.
    for (const t of this.towers) {
      t.cooldown -= dt;
      t.visual.update(dt, elapsed);
      if (t.cooldown > 0) continue;

      const target = this.acquire(t);
      if (!target) continue;

      t.visual.faceTarget?.(target.position);
      const origin = t.position.clone().setY(t.position.y + 0.9);
      if (this.projectiles.fire(origin, target, t.stats.projectile)) {
        t.cooldown = 1 / Math.max(0.05, t.stats.rate);
        t.visual.playAttack?.();
        this.events.onFire?.(t);
      }
    }

    // Projectile hits.
    for (const hit of this.projectiles.update(dt)) {
      this.events.onHit?.(hit.at, hit.spec);
      this.applyDamage(hit.enemy, hit.spec, hit.at);
    }

    this.reap();

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

  private applyDamage(enemy: Enemy, spec: ProjectileSpec, at: THREE.Vector3) {
    const killed = enemy.takeDamage(spec.damage);
    if (spec.splash && spec.splash > 0) {
      for (const other of this.enemies) {
        if (other === enemy || !other.alive) continue;
        if (other.position.distanceTo(at) <= spec.splash) {
          if (other.takeDamage(spec.damage * 0.55)) this.onKilled(other);
        }
      }
    }
    if (killed) this.onKilled(enemy);
  }

  private onKilled(enemy: Enemy) {
    this.gold += enemy.archetype.bounty;
    this.events.onKill?.(enemy, enemy.position.clone());

    // Bloons-style split: children continue from the parent's position,
    // fanned slightly so they do not overlap into a single silhouette.
    const split = enemy.archetype.splitsInto;
    if (split) {
      for (let i = 0; i < split.count; i++) {
        this.spawn(split.tier, Math.max(0, enemy.distance - i * 0.85));
      }
    }
  }

  private reap() {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.alive) continue;
      this.group.remove(e.group);
      e.dispose();
      this.enemies.splice(i, 1);
    }
  }

  dispose() {
    for (const e of this.enemies) e.dispose();
    this.projectiles.dispose();
  }
}
