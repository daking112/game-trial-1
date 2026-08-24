import Phaser from 'phaser';
import type { MonsterInstance, TargetingMode } from '@shared/types';
import { MONSTERS, MONSTERS_BY_ID } from '@shared/monsterData';
import { ENEMIES } from '@shared/enemyData';
import { WAVES } from '@shared/waveData';
import { computeDamage, computeEffectiveStats } from '../systems/combat';
import { pickTarget, TARGETING_MODES } from '../systems/targeting';
import { GRID, PATH_SET, cellToPixel, isBuildable, pointAtDistance, PATH_LENGTH } from '../mapConfig';
import type { EnemyRuntime, PlacedMonsterRuntime } from '../battleTypes';
import { EventBus } from '../EventBus';
import { battleInit } from '../battleInit';

const PREP_MS = 6000;
const CORE_MAX_HP = 20;
const ULTIMATE_GAIN_PER_HIT = 0.12;

let runtimeIdSeq = 1;
const nextRuntimeId = () => runtimeIdSeq++;

export class BattleScene extends Phaser.Scene {
  private team: MonsterInstance[] = [];
  private placed = new Map<number, PlacedMonsterRuntime>();
  private placedViews = new Map<number, Phaser.GameObjects.Container>();
  private enemies = new Map<number, EnemyRuntime>();
  private enemyViews = new Map<number, Phaser.GameObjects.Container>();

  private spawnQueue: { enemyId: string; healthMult: number; damageMult: number }[] = [];
  private spawnTimer = 0;

  private waveIndex = 0; // 0-based into WAVES
  private waveActive = false;
  private prepRemaining = 0;
  private ended = false;

  private coreHp = CORE_MAX_HP;
  private gold = 0;
  private crystals = 0;
  private xpByInstance = new Map<string, number>();

  private selectedForPlacementId: string | null = null;
  private selectedPlacedRuntimeId: number | null = null;
  private hoverCol = -1;
  private hoverRow = -1;
  private placementGraphics!: Phaser.GameObjects.Graphics;
  private rangeGraphics!: Phaser.GameObjects.Graphics;

  constructor() {
    super('Battle');
  }

  init() {
    this.team = battleInit.team;
    this.placed.clear();
    this.enemies.clear();
    this.waveIndex = 0;
    this.waveActive = false;
    this.ended = false;
    this.coreHp = CORE_MAX_HP;
    this.gold = 0;
    this.crystals = 0;
    this.xpByInstance.clear();
    this.prepRemaining = PREP_MS;
  }

  preload() {
    // Load real sprite art where it exists; species without art yet just
    // never get a matching texture key, and createPlacedView() falls back
    // to a colored circle + initial. A missing file logs one harmless
    // console warning per species and the loader moves on.
    this.load.on('loaderror', () => {});
    for (const species of MONSTERS) {
      this.load.image(species.spriteKey, `/monsters/${species.spriteKey}.png`);
    }
  }

  create() {
    this.cameras.main.setBackgroundColor('#152018');
    this.drawMap();

    this.placementGraphics = this.add.graphics();
    this.rangeGraphics = this.add.graphics();

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.hoverCol = Math.floor(p.x / GRID.cell);
      this.hoverRow = Math.floor(p.y / GRID.cell);
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));

    EventBus.on('cmd-select-for-placement', (instanceId: string | null) => {
      this.selectedForPlacementId = instanceId;
      this.selectedPlacedRuntimeId = null;
      EventBus.emit('monster-deselected');
    });
    EventBus.on('cmd-set-targeting', (payload: { runtimeId: number; mode: TargetingMode }) => {
      const m = this.placed.get(payload.runtimeId);
      if (m) {
        m.targetingMode = payload.mode;
        this.emitMonsterSelected(m);
      }
    });
    EventBus.on('cmd-activate-ultimate', (runtimeId: number) => {
      const m = this.placed.get(runtimeId);
      if (m && m.ultimateCharge >= 1) {
        this.castAbility(m, true);
        m.ultimateCharge = 0;
        this.emitMonsterSelected(m);
      }
    });
    EventBus.on('cmd-skip-prep', () => {
      if (!this.waveActive) this.prepRemaining = 0;
    });

    EventBus.emit('battle-ready');
    this.emitHud();
  }

  shutdown() {
    EventBus.off('cmd-select-for-placement');
    EventBus.off('cmd-set-targeting');
    EventBus.off('cmd-activate-ultimate');
    EventBus.off('cmd-skip-prep');
  }

  // -------------------------------------------------------------------
  // Rendering: static map
  // -------------------------------------------------------------------

  private drawMap() {
    const g = this.add.graphics();
    for (let r = 0; r < GRID.rows; r++) {
      for (let c = 0; c < GRID.cols; c++) {
        const onPath = PATH_SET.has(`${c},${r}`);
        const checker = (r + c) % 2 === 0;
        const color = onPath ? 0x6b4a2b : checker ? 0x1f3324 : 0x1a2b1f;
        g.fillStyle(color, 1);
        g.fillRect(c * GRID.cell, r * GRID.cell, GRID.cell, GRID.cell);
        if (onPath) {
          g.fillStyle(0x8a6a3f, 1);
          g.fillCircle(c * GRID.cell + GRID.cell / 2, r * GRID.cell + GRID.cell / 2, 4);
        } else if ((c * 7 + r * 13) % 11 === 0) {
          // sparse gear decoration on grass tiles
          g.lineStyle(2, 0x3a5a42, 0.6);
          g.strokeCircle(c * GRID.cell + GRID.cell / 2, r * GRID.cell + GRID.cell / 2, 10);
        }
      }
    }
    const spawn = pointAtDistance(0);
    const goal = pointAtDistance(PATH_LENGTH);
    g.fillStyle(0xb23b3b, 1);
    g.fillCircle(spawn.x, spawn.y, 12);
    g.fillStyle(0x4fd1c5, 1);
    g.fillCircle(goal.x, goal.y, 16);
    this.add.text(goal.x, goal.y, '⚙', { fontSize: '18px', color: '#0a1014' }).setOrigin(0.5);
  }

  // -------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------

  private onPointerDown(p: Phaser.Input.Pointer) {
    // hit-test placed monsters first
    for (const m of this.placed.values()) {
      if (Math.hypot(m.x - p.x, m.y - p.y) <= 20) {
        this.selectedPlacedRuntimeId = m.runtimeId;
        this.selectedForPlacementId = null;
        this.emitMonsterSelected(m);
        return;
      }
    }

    const col = Math.floor(p.x / GRID.cell);
    const row = Math.floor(p.y / GRID.cell);
    if (this.selectedForPlacementId) {
      this.tryPlace(this.selectedForPlacementId, col, row);
    } else {
      this.selectedPlacedRuntimeId = null;
      EventBus.emit('monster-deselected');
    }
  }

  private tryPlace(instanceId: string, col: number, row: number) {
    if (!isBuildable(col, row)) return;
    for (const m of this.placed.values()) {
      if (m.col === col && m.row === row) return; // occupied
    }
    const instance = this.team.find((t) => t.instanceId === instanceId);
    if (!instance) return;
    if ([...this.placed.values()].some((m) => m.instance.instanceId === instanceId)) return; // already deployed

    const species = MONSTERS_BY_ID[instance.speciesId];
    const stats = computeEffectiveStats(species, instance);
    const { x, y } = cellToPixel(col, row);

    const runtime: PlacedMonsterRuntime = {
      runtimeId: nextRuntimeId(),
      instance,
      col,
      row,
      x,
      y,
      hp: stats.health,
      maxHp: stats.health,
      damage: stats.damage,
      attackSpeed: stats.attackSpeed,
      range: stats.range,
      cooldown: 0,
      abilityCooldown: stats.abilityCooldownMs,
      ultimateCharge: 0,
      bonusAttackSpeedUntil: 0,
      targetingMode: 'first',
    };
    this.placed.set(runtime.runtimeId, runtime);
    this.createPlacedView(runtime, species);
    this.selectedForPlacementId = null;
    EventBus.emit('monster-placed', instanceId);
  }

  private createPlacedView(m: PlacedMonsterRuntime, species: { color: string; name: string; spriteKey: string }) {
    const container = this.add.container(m.x, m.y);

    if (this.textures.exists(species.spriteKey)) {
      const sprite = this.add.image(0, 0, species.spriteKey).setDisplaySize(40, 40);
      container.add(sprite);
    } else {
      const color = Phaser.Display.Color.HexStringToColor(species.color).color;
      const circle = this.add.circle(0, 0, 18, color).setStrokeStyle(2, 0x000000, 0.4);
      const label = this.add.text(0, 0, species.name[0], { fontSize: '16px', color: '#0a1014', fontStyle: 'bold' }).setOrigin(0.5);
      container.add([circle, label]);
    }

    const ultBg = this.add.rectangle(0, 26, 30, 4, 0x000000, 0.5);
    const ultFg = this.add.rectangle(-15, 26, 0, 4, 0xd99bff).setOrigin(0, 0.5);
    container.add([ultBg, ultFg]);
    container.setData('ultFg', ultFg);
    this.placedViews.set(m.runtimeId, container);
  }

  // -------------------------------------------------------------------
  // Update loop
  // -------------------------------------------------------------------

  update(_time: number, delta: number) {
    if (this.ended) return;

    if (this.waveActive) {
      this.tickSpawning(delta);
    } else if (this.waveIndex < WAVES.length) {
      this.prepRemaining -= delta;
      if (this.prepRemaining <= 0) this.beginWave();
    }

    this.updateEnemies(delta);
    this.updateMonsters(delta);
    this.redrawPlacementPreview();

    if (this.waveActive && this.spawnQueue.length === 0 && this.enemies.size === 0) {
      this.completeWave();
    }

    this.emitHud();
  }

  private beginWave() {
    const def = WAVES[this.waveIndex];
    this.spawnQueue = [];
    for (const spawn of def.enemies) {
      for (let i = 0; i < spawn.count; i++) {
        this.spawnQueue.push({ enemyId: spawn.enemyId, healthMult: def.healthMult, damageMult: def.damageMult });
      }
    }
    // Interleave spawn intervals roughly by using the first entry's interval as cadence.
    this.spawnTimer = 0;
    this.waveActive = true;
  }

  private tickSpawning(delta: number) {
    this.spawnTimer -= delta;
    while (this.waveActive && this.spawnTimer <= 0 && this.spawnQueue.length > 0) {
      const next = this.spawnQueue.shift()!;
      this.spawnEnemy(next.enemyId, next.healthMult, next.damageMult);
      const def = WAVES[this.waveIndex];
      const interval = def.enemies.find((e) => e.enemyId === next.enemyId)?.intervalMs ?? 500;
      this.spawnTimer += Math.max(150, interval);
    }
  }

  private spawnEnemy(enemyId: string, healthMult: number, damageMult: number) {
    const def = ENEMIES[enemyId];
    const start = pointAtDistance(0);
    const runtime: EnemyRuntime = {
      runtimeId: nextRuntimeId(),
      enemyId,
      element: def.element,
      hp: Math.round(def.baseHealth * healthMult),
      maxHp: Math.round(def.baseHealth * healthMult),
      speed: def.moveSpeed,
      damage: Math.round(def.baseDamage * damageMult),
      reward: def.reward,
      coreDamage: def.coreDamage,
      dist: 0,
      x: start.x,
      y: start.y,
      slowUntil: 0,
      slowFactor: 1,
      poisonUntil: 0,
      poisonDps: 0,
      isBoss: def.kind === 'boss',
    };
    this.enemies.set(runtime.runtimeId, runtime);
    this.createEnemyView(runtime, def.color, def.name);
  }

  private createEnemyView(e: EnemyRuntime, colorHex: string, name: string) {
    const color = Phaser.Display.Color.HexStringToColor(colorHex).color;
    const radius = e.isBoss ? 26 : 12;
    const container = this.add.container(e.x, e.y);
    const circle = this.add.circle(0, 0, radius, color).setStrokeStyle(2, 0x000000, 0.5);
    const label = this.add.text(0, 0, name[0], { fontSize: e.isBoss ? '20px' : '11px', color: '#0a1014' }).setOrigin(0.5);
    const barW = e.isBoss ? 40 : 22;
    const hpBg = this.add.rectangle(0, -(radius + 8), barW, 4, 0x000000, 0.6);
    const hpFg = this.add.rectangle(-barW / 2, -(radius + 8), barW, 4, 0x6bc96f).setOrigin(0, 0.5);
    container.add([circle, label, hpBg, hpFg]);
    container.setData('hpFg', hpFg);
    container.setData('barW', barW);
    this.enemyViews.set(e.runtimeId, container);
  }

  // -------------------------------------------------------------------
  // Enemy simulation
  // -------------------------------------------------------------------

  private updateEnemies(delta: number) {
    const dt = delta / 1000;
    const now = this.time.now;
    for (const e of [...this.enemies.values()]) {
      let speedMult = 1;
      if (now < e.slowUntil) speedMult = e.slowFactor;
      e.dist += e.speed * speedMult * dt;

      if (now < e.poisonUntil) e.hp -= e.poisonDps * dt;

      if (e.hp <= 0) {
        this.gold += e.reward.gold;
        this.crystals += e.reward.crystals;
        this.grantXp(Math.round(6 + e.maxHp * 0.08));
        this.destroyEnemy(e.runtimeId);
        continue;
      }

      if (e.dist >= PATH_LENGTH) {
        this.coreHp = Math.max(0, this.coreHp - e.coreDamage);
        this.destroyEnemy(e.runtimeId);
        if (this.coreHp <= 0) this.defeat();
        continue;
      }

      const p = pointAtDistance(e.dist);
      e.x = p.x;
      e.y = p.y;
      const view = this.enemyViews.get(e.runtimeId);
      if (view) {
        view.setPosition(e.x, e.y);
        const hpFg = view.getData('hpFg') as Phaser.GameObjects.Rectangle;
        const barW = view.getData('barW') as number;
        const pct = Math.max(0, e.hp / e.maxHp);
        hpFg.width = barW * pct;
        hpFg.fillColor = pct > 0.5 ? 0x6bc96f : pct > 0.25 ? 0xf2c14e : 0xe05c5c;
      }
    }
  }

  private destroyEnemy(runtimeId: number) {
    this.enemies.delete(runtimeId);
    this.enemyViews.get(runtimeId)?.destroy();
    this.enemyViews.delete(runtimeId);
  }

  // -------------------------------------------------------------------
  // Monster simulation
  // -------------------------------------------------------------------

  private updateMonsters(delta: number) {
    const now = this.time.now;
    for (const m of this.placed.values()) {
      m.cooldown -= delta;
      m.abilityCooldown -= delta;

      const enemyList = [...this.enemies.values()];
      if (m.cooldown <= 0) {
        const target = pickTarget(m, enemyList);
        if (target) {
          this.basicAttack(m, target);
          const speedBonus = now < m.bonusAttackSpeedUntil ? 1.35 : 1;
          m.cooldown = 1000 / (m.attackSpeed * speedBonus);
        } else {
          m.cooldown = 100;
        }
      }

      if (m.abilityCooldown <= 0) {
        const target = pickTarget(m, enemyList);
        if (target) {
          this.castAbility(m, false);
          const species = MONSTERS_BY_ID[m.instance.speciesId];
          m.abilityCooldown = species.ability.cooldownMs;
        }
      }
    }
  }

  private basicAttack(m: PlacedMonsterRuntime, target: EnemyRuntime) {
    const { finalDamage } = computeDamage(m.damage, MONSTERS_BY_ID[m.instance.speciesId].element, target.element);
    target.hp -= finalDamage;
    if (target.hp <= 0) this.onKillCredit(m);

    const species = MONSTERS_BY_ID[m.instance.speciesId];
    const ultBoost = species.passive.kind === 'ultimate_charge_boost' ? species.passive.value : 0;
    m.ultimateCharge = Math.min(1, m.ultimateCharge + ULTIMATE_GAIN_PER_HIT * (1 + ultBoost));
    this.refreshUltimateBar(m);
    if (this.selectedPlacedRuntimeId === m.runtimeId) this.emitMonsterSelected(m);

    this.flashShot(m.x, m.y, target.x, target.y, species.color);
  }

  private onKillCredit(m: PlacedMonsterRuntime) {
    if (m.instance.traitId === 'bloodthirsty') {
      m.bonusAttackSpeedUntil = this.time.now + 2500;
    }
  }

  private castAbility(m: PlacedMonsterRuntime, isUltimate: boolean) {
    const species = MONSTERS_BY_ID[m.instance.speciesId];
    const ability = species.ability;
    const target = pickTarget(m, [...this.enemies.values()]);
    if (!target) return;

    const power = ability.power * (isUltimate ? 2.2 : 1);
    const radius = (ability.radius ?? 60) * (isUltimate ? 1.3 : 1);

    switch (ability.kind) {
      case 'barrage': {
        const { finalDamage } = computeDamage(m.damage * power, species.element, target.element);
        target.hp -= finalDamage;
        if (target.hp <= 0) this.onKillCredit(m);
        this.flashShot(m.x, m.y, target.x, target.y, species.color);
        break;
      }
      case 'aoe_damage': {
        for (const e of this.enemies.values()) {
          if (Math.hypot(e.x - target.x, e.y - target.y) <= radius) {
            const { finalDamage } = computeDamage(m.damage * power, species.element, e.element);
            e.hp -= finalDamage;
            if (e.hp <= 0) this.onKillCredit(m);
          }
        }
        this.flashRing(target.x, target.y, radius, species.color);
        break;
      }
      case 'chain': {
        const hit = new Set<number>();
        let current = target;
        let last = { x: m.x, y: m.y };
        for (let i = 0; i <= (ability.chainCount ?? 1); i++) {
          if (!current || hit.has(current.runtimeId)) break;
          hit.add(current.runtimeId);
          const { finalDamage } = computeDamage(m.damage * power, species.element, current.element);
          current.hp -= finalDamage;
          if (current.hp <= 0) this.onKillCredit(m);
          this.flashShot(last.x, last.y, current.x, current.y, species.color);
          last = { x: current.x, y: current.y };
          const next = [...this.enemies.values()].find(
            (e) => !hit.has(e.runtimeId) && Math.hypot(e.x - current!.x, e.y - current!.y) <= radius,
          );
          if (!next) break;
          current = next;
        }
        break;
      }
      case 'slow_field': {
        for (const e of this.enemies.values()) {
          if (Math.hypot(e.x - target.x, e.y - target.y) <= radius) {
            const until = this.time.now + (ability.durationMs ?? 2000);
            if (until > e.slowUntil) {
              e.slowUntil = until;
              e.slowFactor = 1 - power;
            }
          }
        }
        this.flashRing(target.x, target.y, radius, '#a8e4ff');
        break;
      }
      case 'dot_area': {
        for (const e of this.enemies.values()) {
          if (Math.hypot(e.x - target.x, e.y - target.y) <= radius) {
            e.poisonUntil = Math.max(e.poisonUntil, this.time.now + (ability.durationMs ?? 3000));
            e.poisonDps = Math.max(e.poisonDps, m.damage * power * 0.3);
          }
        }
        this.flashRing(target.x, target.y, radius, '#5fcf6b');
        break;
      }
    }
  }

  private grantXp(amount: number) {
    for (const m of this.placed.values()) {
      const prev = this.xpByInstance.get(m.instance.instanceId) ?? 0;
      this.xpByInstance.set(m.instance.instanceId, prev + amount);
    }
  }

  // -------------------------------------------------------------------
  // Wave lifecycle
  // -------------------------------------------------------------------

  private completeWave() {
    this.waveActive = false;
    this.gold += 15 + this.waveIndex * 5;
    EventBus.emit('wave-complete', { wave: this.waveIndex + 1, totalWaves: WAVES.length });
    this.waveIndex += 1;
    if (this.waveIndex >= WAVES.length) {
      this.victory();
    } else {
      this.prepRemaining = PREP_MS;
    }
  }

  private victory() {
    this.ended = true;
    EventBus.emit('battle-victory', {
      gold: this.gold,
      crystals: this.crystals,
      xpByInstance: Object.fromEntries(this.xpByInstance),
    });
  }

  private defeat() {
    this.ended = true;
    EventBus.emit('battle-defeat', {
      gold: this.gold,
      crystals: this.crystals,
      xpByInstance: Object.fromEntries(this.xpByInstance),
      waveReached: this.waveIndex + 1,
    });
  }

  // -------------------------------------------------------------------
  // Visual FX helpers
  // -------------------------------------------------------------------

  private flashShot(x1: number, y1: number, x2: number, y2: number, colorHex: string) {
    const color = Phaser.Display.Color.HexStringToColor(colorHex).color;
    const line = this.add.line(0, 0, x1, y1, x2, y2, color).setOrigin(0, 0).setLineWidth(2);
    this.tweens.add({ targets: line, alpha: 0, duration: 140, onComplete: () => line.destroy() });
  }

  private flashRing(x: number, y: number, radius: number, colorHex: string) {
    const color = Phaser.Display.Color.HexStringToColor(colorHex).color;
    const ring = this.add.circle(x, y, radius * 0.4, color, 0).setStrokeStyle(2, color, 0.9);
    this.tweens.add({
      targets: ring,
      radius: radius,
      alpha: 0,
      duration: 260,
      onUpdate: () => ring.setRadius(ring.radius),
      onComplete: () => ring.destroy(),
    });
  }

  private refreshUltimateBar(m: PlacedMonsterRuntime) {
    const view = this.placedViews.get(m.runtimeId);
    if (!view) return;
    const ultFg = view.getData('ultFg') as Phaser.GameObjects.Rectangle;
    ultFg.width = 30 * m.ultimateCharge;
  }

  private redrawPlacementPreview() {
    this.placementGraphics.clear();
    this.rangeGraphics.clear();

    if (this.selectedPlacedRuntimeId) {
      const m = this.placed.get(this.selectedPlacedRuntimeId);
      if (m) {
        this.rangeGraphics.lineStyle(1, 0xffffff, 0.35);
        this.rangeGraphics.strokeCircle(m.x, m.y, m.range);
      }
    }

    if (!this.selectedForPlacementId) return;
    if (this.hoverCol < 0 || this.hoverRow < 0 || this.hoverCol >= GRID.cols || this.hoverRow >= GRID.rows) return;
    const buildable =
      isBuildable(this.hoverCol, this.hoverRow) &&
      ![...this.placed.values()].some((m) => m.col === this.hoverCol && m.row === this.hoverRow);
    this.placementGraphics.fillStyle(buildable ? 0x4fd1c5 : 0xe05c5c, 0.25);
    this.placementGraphics.fillRect(this.hoverCol * GRID.cell, this.hoverRow * GRID.cell, GRID.cell, GRID.cell);

    if (buildable) {
      const instance = this.team.find((t) => t.instanceId === this.selectedForPlacementId);
      if (instance) {
        const species = MONSTERS_BY_ID[instance.speciesId];
        const stats = computeEffectiveStats(species, instance);
        const { x, y } = cellToPixel(this.hoverCol, this.hoverRow);
        this.rangeGraphics.lineStyle(1, Phaser.Display.Color.HexStringToColor(species.color).color, 0.5);
        this.rangeGraphics.strokeCircle(x, y, stats.range);
      }
    }
  }

  // -------------------------------------------------------------------
  // HUD sync
  // -------------------------------------------------------------------

  private emitHud() {
    EventBus.emit('hud-update', {
      wave: Math.min(this.waveIndex + 1, WAVES.length),
      totalWaves: WAVES.length,
      coreHp: this.coreHp,
      maxCoreHp: CORE_MAX_HP,
      gold: this.gold,
      crystals: this.crystals,
      waveActive: this.waveActive,
      enemiesRemaining: this.enemies.size + this.spawnQueue.length,
      prepRemainingMs: this.waveActive ? 0 : Math.max(0, this.prepRemaining),
    });
  }

  private emitMonsterSelected(m: PlacedMonsterRuntime) {
    const species = MONSTERS_BY_ID[m.instance.speciesId];
    EventBus.emit('monster-selected', {
      runtimeId: m.runtimeId,
      name: species.name,
      element: species.element,
      abilityName: species.ability.name,
      damage: m.damage,
      range: Math.round(m.range),
      attackSpeed: m.attackSpeed,
      ultimateCharge: m.ultimateCharge,
      targetingMode: m.targetingMode,
      targetingModes: TARGETING_MODES,
    });
  }
}
