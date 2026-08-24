import type { Element, MonsterInstance, TargetingMode } from '@shared/types';

// Runtime (in-battle) entities. These live only for the duration of a
// battle and are never persisted directly — persisted state is the
// MonsterInstance in @shared/types plus the player's collection store.

export interface EnemyRuntime {
  runtimeId: number;
  enemyId: string;
  element: Element;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  reward: { gold: number; crystals: number };
  coreDamage: number;
  dist: number;
  x: number;
  y: number;
  slowUntil: number;
  slowFactor: number;
  poisonUntil: number;
  poisonDps: number;
  isBoss: boolean;
}

export interface PlacedMonsterRuntime {
  runtimeId: number;
  instance: MonsterInstance;
  col: number;
  row: number;
  x: number;
  y: number;
  hp: number; // flavor-only in MVP: towers don't take damage yet
  maxHp: number;
  damage: number;
  attackSpeed: number;
  range: number;
  cooldown: number;
  abilityCooldown: number;
  ultimateCharge: number; // 0..1
  bonusAttackSpeedUntil: number; // bloodthirsty trait burst
  targetingMode: TargetingMode;
}

export interface BattleHudState {
  wave: number;
  totalWaves: number;
  coreHp: number;
  maxCoreHp: number;
  gold: number;
  crystals: number;
  waveActive: boolean;
  enemiesRemaining: number;
  prepRemainingMs: number;
}

export interface MonsterSelectedPayload {
  runtimeId: number;
  name: string;
  element: string;
  abilityName: string;
  damage: number;
  range: number;
  attackSpeed: number;
  ultimateCharge: number;
  targetingMode: TargetingMode;
  targetingModes: TargetingMode[];
}

export interface BattleResultPayload {
  gold: number;
  crystals: number;
  xpByInstance: Record<string, number>;
  waveReached?: number;
}
