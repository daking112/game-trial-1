import Phaser from 'phaser';
import type { BarrelDef, ShapeKind, StatBlock, StatKey } from '@shared/types';
import { MONSTERS_BY_ID } from '@shared/monsterData';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BASE_STATS,
  BOT_BASE_HEALTH,
  BOT_BODY_DAMAGE,
  BOT_BULLET_DAMAGE,
  BOT_BULLET_SPEED,
  BOT_FIRE_INTERVAL_MS,
  BOT_HEALTH_PER_LEVEL,
  BOT_MOVE_SPEED,
  BOT_RESPAWN_DELAY_MS,
  BOT_SIGHT_RANGE,
  BOT_TARGET_COUNT,
  BOT_XP,
  LEVEL_CAP,
  MAX_POINTS_PER_STAT,
  SHAPE_DEFS,
  SHAPE_RESPAWN_DELAY_MS,
  SHAPE_SPAWN_WEIGHTS,
  SHAPE_TARGET_COUNT,
  STAR_BONUS_PER_STAR,
  STAT_KEYS,
  STAT_POINT_EFFECT,
  xpForNextLevel,
} from '@shared/constants';
import {
  BARREL_LENGTH,
  BARREL_THICKNESS,
  BOT_RADIUS,
  BULLET_BASE_RADIUS,
  BULLET_LIFETIME_MS,
  PLAYER_RADIUS,
} from '../arenaConfig';
import { arenaInit } from '../arenaInit';
import { EventBus } from '../EventBus';
import type { HudState, RunOverPayload } from '../arenaTypes';

interface EffectiveStats {
  maxHealth: number;
  healthRegenPerSec: number;
  bodyDamage: number;
  bulletDamage: number;
  bulletSpeed: number;
  bulletPenetration: number;
  reloadMs: number;
  movementSpeed: number;
}

interface BotEntity {
  container: Phaser.GameObjects.Container;
  body: Phaser.Physics.Arcade.Body;
  hp: number;
  maxHp: number;
  lastFired: number;
  wanderAngle: number;
  wanderChangeAt: number;
  barrels: BarrelDef[];
  alive: boolean;
}

function emptyStatBlock(): StatBlock {
  return {
    healthRegen: 0,
    maxHealth: 0,
    bodyDamage: 0,
    bulletSpeed: 0,
    bulletPenetration: 0,
    bulletDamage: 0,
    reload: 0,
    movementSpeed: 0,
  };
}

export class ArenaScene extends Phaser.Scene {
  private speciesId = '';
  private stars = 1;

  private player!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private shapes!: Phaser.Physics.Arcade.Group;
  private botsGroup!: Phaser.GameObjects.Group;
  private bots: BotEntity[] = [];

  private firing = false;
  private barrelLastFired: number[] = [];
  private points: StatBlock = emptyStatBlock();
  private unspentPoints = 0;
  private level = 1;
  private xp = 0;
  private score = 0;
  private kills = 0;
  private health = BASE_STATS.maxHealth;
  private stats: EffectiveStats = this.recomputeStats();
  private runOver = false;
  private startTime = 0;
  private hudAccumulator = 0;

  private allocateHandler = (stat: StatKey) => this.allocateStat(stat);
  private exitHandler = () => this.endRun(false);

  constructor() {
    super('Arena');
  }

  create() {
    this.speciesId = arenaInit.speciesId;
    this.stars = arenaInit.stars;
    this.runOver = false;
    this.startTime = this.time.now;
    this.points = emptyStatBlock();
    this.unspentPoints = 0;
    this.level = 1;
    this.xp = 0;
    this.score = 0;
    this.kills = 0;
    this.stats = this.recomputeStats();
    this.health = this.stats.maxHealth;

    this.makeTextures();

    this.physics.world.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.add.tileSprite(0, 0, ARENA_WIDTH, ARENA_HEIGHT, 'ground').setOrigin(0, 0);
    this.drawBorder();

    this.playerBullets = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();
    this.shapes = this.physics.add.group();
    this.botsGroup = this.add.group();

    this.createPlayer();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as unknown as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.firing = true;
    });
    this.input.on('pointerup', () => (this.firing = false));

    for (let i = 0; i < SHAPE_TARGET_COUNT; i++) this.spawnShape();
    for (let i = 0; i < BOT_TARGET_COUNT; i++) this.spawnBot();

    this.physics.add.overlap(this.player, this.shapes, (_p, s) => this.onPlayerHitShape(s as Phaser.Physics.Arcade.Sprite));
    this.physics.add.overlap(this.player, this.botsGroup, (_p, b) => this.onPlayerHitBot(b as Phaser.GameObjects.Container));
    this.physics.add.overlap(this.playerBullets, this.shapes, (b, s) =>
      this.onBulletHitShape(b as Phaser.Physics.Arcade.Sprite, s as Phaser.Physics.Arcade.Sprite),
    );
    this.physics.add.overlap(this.playerBullets, this.botsGroup, (b, bot) =>
      this.onBulletHitBot(b as Phaser.Physics.Arcade.Sprite, bot as Phaser.GameObjects.Container),
    );
    this.physics.add.overlap(this.enemyBullets, this.player, (b) => this.onEnemyBulletHitPlayer(b as Phaser.Physics.Arcade.Sprite));

    this.cameras.main.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.14, 0.14);

    EventBus.on('allocate-stat', this.allocateHandler);
    EventBus.on('request-exit', this.exitHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanup, this);

    this.emitHud(true);
    EventBus.emit('arena-ready');
  }

  private cleanup() {
    EventBus.off('allocate-stat', this.allocateHandler);
    EventBus.off('request-exit', this.exitHandler);
  }

  // -------------------------------------------------------------------------
  // Texture generation (no external art needed for the arena itself).
  // -------------------------------------------------------------------------

  private makeTextures() {
    if (!this.textures.exists('ground')) {
      const g = this.add.graphics();
      g.fillStyle(0x2c4a33, 1);
      g.fillRect(0, 0, 64, 64);
      g.fillStyle(0x2f5037, 1);
      g.fillRect(0, 0, 32, 32);
      g.fillRect(32, 32, 32, 32);
      g.generateTexture('ground', 64, 64);
      g.destroy();
    }
    if (!this.textures.exists('circle-tex')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(32, 32, 32);
      g.generateTexture('circle-tex', 64, 64);
      g.destroy();
    }
    if (!this.textures.exists('bullet-tex')) {
      const r = BULLET_BASE_RADIUS;
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(r, r, r);
      g.generateTexture('bullet-tex', r * 2, r * 2);
      g.destroy();
    }
    (Object.keys(SHAPE_DEFS) as ShapeKind[]).forEach((kind) => this.makeShapeTexture(kind));
  }

  private makeShapeTexture(kind: ShapeKind) {
    const key = `shape-${kind}`;
    if (this.textures.exists(key)) return;
    const def = SHAPE_DEFS[kind];
    const radius = def.size;
    const pad = 6;
    const size = radius * 2 + pad * 2;
    const cx = size / 2;
    const cy = size / 2;
    const g = this.add.graphics();
    g.fillStyle(def.color, 1);
    g.lineStyle(3, 0xffffff, 0.5);
    if (kind === 'square') {
      g.fillRect(cx - radius * 0.8, cy - radius * 0.8, radius * 1.6, radius * 1.6);
      g.strokeRect(cx - radius * 0.8, cy - radius * 0.8, radius * 1.6, radius * 1.6);
    } else {
      const sides = kind === 'triangle' ? 3 : 5;
      const pts: Phaser.Math.Vector2[] = [];
      for (let i = 0; i < sides; i++) {
        const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
        pts.push(new Phaser.Math.Vector2(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
      }
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.fillPath();
      g.strokePath();
    }
    g.generateTexture(key, size, size);
    g.destroy();
  }

  private drawBorder() {
    const g = this.add.graphics();
    g.lineStyle(8, 0x0d1a10, 1);
    g.strokeRect(4, 4, ARENA_WIDTH - 8, ARENA_HEIGHT - 8);
  }

  // -------------------------------------------------------------------------
  // Player + tanks.
  // -------------------------------------------------------------------------

  private buildBarrels(container: Phaser.GameObjects.Container, barrels: BarrelDef[], accentColor: number) {
    for (const barrel of barrels) {
      const length = BARREL_LENGTH * (barrel.sizeMult ?? 1);
      const rect = this.add.rectangle(0, 0, length, BARREL_THICKNESS, accentColor).setOrigin(0, 0.5);
      rect.rotation = Phaser.Math.DegToRad(barrel.angleOffset);
      rect.setStrokeStyle(2, 0x000000, 0.25);
      container.add(rect);
    }
  }

  private createPlayer() {
    const species = MONSTERS_BY_ID[this.speciesId];
    this.player = this.add.container(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
    this.buildBarrels(this.player, species.barrels, species.accentColor);
    const body = this.add.image(0, 0, 'circle-tex').setTint(species.color).setDisplaySize(PLAYER_RADIUS * 2, PLAYER_RADIUS * 2);
    this.player.add(body);

    this.physics.add.existing(this.player);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setCircle(PLAYER_RADIUS, -PLAYER_RADIUS, -PLAYER_RADIUS);
    this.playerBody.setCollideWorldBounds(true);
    this.barrelLastFired = species.barrels.map(() => 0);
  }

  private recomputeStats(): EffectiveStats {
    const species = MONSTERS_BY_ID[this.speciesId ?? ''];
    const mults = species?.statMults ?? {};
    const starBonus = 1 + (this.stars - 1) * STAR_BONUS_PER_STAR;
    const p = this.points;

    const maxHealth = BASE_STATS.maxHealth * (1 + p.maxHealth * STAT_POINT_EFFECT.maxHealth) * (mults.maxHealth ?? 1) * starBonus;
    const healthRegenPerSec =
      (BASE_STATS.healthRegenPerSec + p.healthRegen * STAT_POINT_EFFECT.healthRegen) * (mults.healthRegen ?? 1) * starBonus;
    const bodyDamage = BASE_STATS.bodyDamage * (1 + p.bodyDamage * STAT_POINT_EFFECT.bodyDamage) * (mults.bodyDamage ?? 1) * starBonus;
    const bulletDamage =
      BASE_STATS.bulletDamage * (1 + p.bulletDamage * STAT_POINT_EFFECT.bulletDamage) * (mults.bulletDamage ?? 1) * starBonus;
    const bulletSpeed = BASE_STATS.bulletSpeed * (1 + p.bulletSpeed * STAT_POINT_EFFECT.bulletSpeed) * (mults.bulletSpeed ?? 1);
    const bulletPenetration =
      BASE_STATS.bulletPenetration + p.bulletPenetration * STAT_POINT_EFFECT.bulletPenetration + (mults.bulletPenetrationBonus ?? 0);
    const reloadMs = Math.max(
      60,
      BASE_STATS.reloadMs * (1 - p.reload * STAT_POINT_EFFECT.reload) * (mults.reload ?? 1),
    );
    const movementSpeed = BASE_STATS.movementSpeed * (1 + p.movementSpeed * STAT_POINT_EFFECT.movementSpeed) * (mults.movementSpeed ?? 1);

    return { maxHealth, healthRegenPerSec, bodyDamage, bulletDamage, bulletSpeed, bulletPenetration, reloadMs, movementSpeed };
  }

  private allocateStat(stat: StatKey) {
    if (this.runOver) return;
    if (this.unspentPoints <= 0) return;
    if (this.points[stat] >= MAX_POINTS_PER_STAT) return;
    const wasMax = this.stats.maxHealth;
    this.points[stat] += 1;
    this.unspentPoints -= 1;
    this.stats = this.recomputeStats();
    // Growing max health also grows current health by the same delta so
    // spending a point never feels like it cost you HP.
    this.health += this.stats.maxHealth - wasMax;
    this.emitHud(true);
  }

  private gainXp(amount: number) {
    this.xp += amount;
    this.score += amount;
    while (this.level < LEVEL_CAP && this.xp >= xpForNextLevel(this.level)) {
      this.xp -= xpForNextLevel(this.level);
      this.level += 1;
      this.unspentPoints += 1;
      EventBus.emit('level-up', this.level);
    }
  }

  // -------------------------------------------------------------------------
  // Shapes.
  // -------------------------------------------------------------------------

  private rollShapeKind(): ShapeKind {
    const entries = Object.entries(SHAPE_SPAWN_WEIGHTS) as [ShapeKind, number][];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;
    for (const [kind, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return kind;
    }
    return entries[0][0];
  }

  private spawnShape() {
    const kind = this.rollShapeKind();
    const def = SHAPE_DEFS[kind];
    const x = Phaser.Math.Between(80, ARENA_WIDTH - 80);
    const y = Phaser.Math.Between(80, ARENA_HEIGHT - 80);
    const sprite = this.shapes.create(x, y, `shape-${kind}`) as Phaser.Physics.Arcade.Sprite;
    sprite.setData('kind', kind);
    sprite.setData('hp', def.health);
    sprite.setData('spin', (Math.random() > 0.5 ? 1 : -1) * def.spinSpeed);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setCircle(def.size * 0.5, -def.size * 0.1, -def.size * 0.1);
    body.setBounce(1, 1);
    body.setVelocity(Phaser.Math.Between(-20, 20), Phaser.Math.Between(-20, 20));
    body.setCollideWorldBounds(true);
  }

  private killShape(sprite: Phaser.Physics.Arcade.Sprite) {
    const kind = sprite.getData('kind') as ShapeKind;
    const def = SHAPE_DEFS[kind];
    this.gainXp(def.xp);
    this.kills += 1;
    sprite.destroy();
    this.time.delayedCall(SHAPE_RESPAWN_DELAY_MS, () => {
      if (!this.runOver) this.spawnShape();
    });
  }

  // -------------------------------------------------------------------------
  // Bots.
  // -------------------------------------------------------------------------

  private spawnBot() {
    const x = Phaser.Math.Between(200, ARENA_WIDTH - 200);
    const y = Phaser.Math.Between(200, ARENA_HEIGHT - 200);
    const container = this.add.container(x, y);
    const barrels: BarrelDef[] = [{ angleOffset: 0, damageMult: 1 }];
    this.buildBarrels(container, barrels, 0x7a2020);
    const body = this.add.image(0, 0, 'circle-tex').setTint(0xe05c5c).setDisplaySize(BOT_RADIUS * 2, BOT_RADIUS * 2);
    container.add(body);
    this.physics.add.existing(container);
    const physBody = container.body as Phaser.Physics.Arcade.Body;
    physBody.setCircle(BOT_RADIUS, -BOT_RADIUS, -BOT_RADIUS);
    physBody.setCollideWorldBounds(true);
    physBody.setBounce(1, 1);

    const maxHp = BOT_BASE_HEALTH + this.level * BOT_HEALTH_PER_LEVEL;
    const entity: BotEntity = {
      container,
      body: physBody,
      hp: maxHp,
      maxHp,
      lastFired: 0,
      wanderAngle: Math.random() * Math.PI * 2,
      wanderChangeAt: 0,
      barrels,
      alive: true,
    };
    container.setData('bot', entity);
    this.botsGroup.add(container);
    this.bots.push(entity);
  }

  private killBot(entity: BotEntity) {
    entity.alive = false;
    this.gainXp(BOT_XP);
    this.kills += 1;
    this.bots = this.bots.filter((b) => b !== entity);
    entity.container.destroy();
    this.time.delayedCall(BOT_RESPAWN_DELAY_MS, () => {
      if (!this.runOver) this.spawnBot();
    });
  }

  private updateBots(time: number, delta: number) {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const dx = this.player.x - bot.container.x;
      const dy = this.player.y - bot.container.y;
      const dist = Math.hypot(dx, dy);

      if (dist < BOT_SIGHT_RANGE) {
        const angle = Math.atan2(dy, dx);
        bot.container.rotation = angle;
        const preferredDist = 260;
        const speedScale = dist > preferredDist ? 1 : -0.4;
        bot.body.setVelocity(Math.cos(angle) * BOT_MOVE_SPEED * speedScale, Math.sin(angle) * BOT_MOVE_SPEED * speedScale);

        if (time - bot.lastFired >= BOT_FIRE_INTERVAL_MS) {
          bot.lastFired = time;
          this.fireBullet(bot.container.x, bot.container.y, angle, {
            damage: BOT_BULLET_DAMAGE,
            speed: BOT_BULLET_SPEED,
            radius: BULLET_BASE_RADIUS,
            penetration: 1,
            group: this.enemyBullets,
            tint: 0xe05c5c,
          });
        }
      } else {
        if (time > bot.wanderChangeAt) {
          bot.wanderAngle = Math.random() * Math.PI * 2;
          bot.wanderChangeAt = time + Phaser.Math.Between(1500, 3000);
        }
        bot.container.rotation = bot.wanderAngle;
        bot.body.setVelocity(Math.cos(bot.wanderAngle) * BOT_MOVE_SPEED * 0.5, Math.sin(bot.wanderAngle) * BOT_MOVE_SPEED * 0.5);
      }
    }
    void delta;
  }

  // -------------------------------------------------------------------------
  // Firing.
  // -------------------------------------------------------------------------

  private fireBullet(
    x: number,
    y: number,
    angle: number,
    opts: { damage: number; speed: number; radius: number; penetration: number; group: Phaser.Physics.Arcade.Group; tint: number },
  ) {
    const spawnX = x + Math.cos(angle) * (PLAYER_RADIUS + 6);
    const spawnY = y + Math.sin(angle) * (PLAYER_RADIUS + 6);
    const sprite = opts.group.create(spawnX, spawnY, 'bullet-tex') as Phaser.Physics.Arcade.Sprite;
    sprite.setTint(opts.tint);
    sprite.setDisplaySize(opts.radius * 2, opts.radius * 2);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    const offset = BULLET_BASE_RADIUS - opts.radius;
    body.setCircle(opts.radius, offset, offset);
    body.setVelocity(Math.cos(angle) * opts.speed, Math.sin(angle) * opts.speed);
    sprite.setData('damage', opts.damage);
    sprite.setData('penetration', opts.penetration);
    this.time.delayedCall(BULLET_LIFETIME_MS, () => sprite.destroy());
  }

  private tryPlayerFire(time: number) {
    if (!this.firing) return;
    const species = MONSTERS_BY_ID[this.speciesId];
    const angle = this.player.rotation;
    species.barrels.forEach((barrel, i) => {
      const cooldown = this.stats.reloadMs * (barrel.cooldownMult ?? 1);
      if (time - this.barrelLastFired[i] < cooldown) return;
      this.barrelLastFired[i] = time;
      const barrelAngle = angle + Phaser.Math.DegToRad(barrel.angleOffset);
      this.fireBullet(this.player.x, this.player.y, barrelAngle, {
        damage: this.stats.bulletDamage * barrel.damageMult,
        speed: this.stats.bulletSpeed * (barrel.speedMult ?? 1),
        radius: BULLET_BASE_RADIUS * (barrel.sizeMult ?? 1),
        penetration: Math.max(1, Math.round(this.stats.bulletPenetration)),
        group: this.playerBullets,
        tint: species.accentColor,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Collisions.
  // -------------------------------------------------------------------------

  private onBulletHitShape(bullet: Phaser.Physics.Arcade.Sprite, shape: Phaser.Physics.Arcade.Sprite) {
    if (!bullet.active || !shape.active) return;
    const dmg = bullet.getData('damage') as number;
    const hp = (shape.getData('hp') as number) - dmg;
    shape.setData('hp', hp);
    this.consumeBulletPenetration(bullet);
    if (hp <= 0) this.killShape(shape);
  }

  private onBulletHitBot(bullet: Phaser.Physics.Arcade.Sprite, botContainer: Phaser.GameObjects.Container) {
    if (!bullet.active) return;
    const entity = botContainer.getData('bot') as BotEntity;
    if (!entity?.alive) return;
    const dmg = bullet.getData('damage') as number;
    entity.hp -= dmg;
    this.consumeBulletPenetration(bullet);
    if (entity.hp <= 0) this.killBot(entity);
  }

  private consumeBulletPenetration(bullet: Phaser.Physics.Arcade.Sprite) {
    const remaining = (bullet.getData('penetration') as number) - 1;
    if (remaining <= 0) {
      bullet.destroy();
    } else {
      bullet.setData('penetration', remaining);
    }
  }

  private onEnemyBulletHitPlayer(bullet: Phaser.Physics.Arcade.Sprite) {
    if (!bullet.active || this.runOver) return;
    const dmg = bullet.getData('damage') as number;
    this.damagePlayer(dmg);
    bullet.destroy();
  }

  private onPlayerHitShape(shape: Phaser.Physics.Arcade.Sprite) {
    if (this.runOver || !shape.active) return;
    const kind = shape.getData('kind') as ShapeKind;
    const def = SHAPE_DEFS[kind];
    this.maybeDamagePlayer(def.bodyDamage);
    const hp = (shape.getData('hp') as number) - this.stats.bodyDamage * 0.15;
    shape.setData('hp', hp);
    if (hp <= 0) this.killShape(shape);
    this.pushApart(this.player, shape);
  }

  private onPlayerHitBot(botContainer: Phaser.GameObjects.Container) {
    if (this.runOver) return;
    const entity = botContainer.getData('bot') as BotEntity;
    if (!entity?.alive) return;
    this.maybeDamagePlayer(BOT_BODY_DAMAGE);
    entity.hp -= this.stats.bodyDamage * 0.1;
    if (entity.hp <= 0) this.killBot(entity);
    else this.pushApart(this.player, botContainer);
  }

  // Contact damage from shapes/bots is throttled (unlike bullets) so
  // standing in a cluster of shapes doesn't melt the player in one physics
  // step at ~60 ticks/sec.
  private lastContactDamageAt = 0;
  private maybeDamagePlayer(amount: number) {
    const now = this.time.now;
    if (now - this.lastContactDamageAt < 150) return;
    this.lastContactDamageAt = now;
    this.damagePlayer(amount);
  }

  private pushApart(a: Phaser.GameObjects.Container, b: Phaser.GameObjects.GameObject & { x: number; y: number }) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const push = 60;
    this.playerBody.velocity.x += (dx / dist) * push;
    this.playerBody.velocity.y += (dy / dist) * push;
  }

  private damagePlayer(amount: number) {
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0 && !this.runOver) this.endRun(true);
  }

  // -------------------------------------------------------------------------
  // Run lifecycle.
  // -------------------------------------------------------------------------

  private endRun(died: boolean) {
    if (this.runOver) return;
    this.runOver = true;
    this.firing = false;
    const survivedMs = this.time.now - this.startTime;
    const gearsEarned = Math.floor(this.score * 0.5) + this.level * 12 + this.kills;
    const payload: RunOverPayload = { score: this.score, level: this.level, kills: this.kills, survivedMs, gearsEarned };
    this.emitHud(true);
    EventBus.emit('run-over', payload);
    void died;
  }

  private emitHud(force = false) {
    const stats: Record<StatKey, number> = { ...emptyStatBlock() };
    for (const key of STAT_KEYS) stats[key] = this.points[key];
    const payload: HudState = {
      health: Math.max(0, Math.round(this.health)),
      maxHealth: Math.round(this.stats.maxHealth),
      level: this.level,
      xp: Math.round(this.xp),
      xpToNext: xpForNextLevel(this.level),
      score: Math.round(this.score),
      kills: this.kills,
      unspentPoints: this.unspentPoints,
      stats,
    };
    EventBus.emit('hud-update', payload);
    void force;
  }

  // -------------------------------------------------------------------------
  // Main loop.
  // -------------------------------------------------------------------------

  update(time: number, delta: number) {
    if (this.runOver) return;
    const dt = delta / 1000;

    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const up = this.cursors.up.isDown || this.wasd.W.isDown;
    const down = this.cursors.down.isDown || this.wasd.S.isDown;
    let vx = (right ? 1 : 0) - (left ? 1 : 0);
    let vy = (down ? 1 : 0) - (up ? 1 : 0);
    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy);
      vx /= len;
      vy /= len;
    }
    this.playerBody.setVelocity(vx * this.stats.movementSpeed, vy * this.stats.movementSpeed);

    const pointer = this.input.activePointer;
    const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    this.player.rotation = Phaser.Math.Angle.Between(this.player.x, this.player.y, worldPoint.x, worldPoint.y);

    this.tryPlayerFire(time);

    if (this.health < this.stats.maxHealth) {
      this.health = Math.min(this.stats.maxHealth, this.health + this.stats.healthRegenPerSec * dt);
    }

    this.shapes.children.each((child) => {
      const sprite = child as Phaser.Physics.Arcade.Sprite;
      sprite.rotation += (sprite.getData('spin') as number) * dt;
      return true;
    });

    this.updateBots(time, delta);

    this.hudAccumulator += delta;
    if (this.hudAccumulator >= 100) {
      this.hudAccumulator = 0;
      this.emitHud();
    }
  }
}
