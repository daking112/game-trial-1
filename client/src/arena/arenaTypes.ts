import type { StatKey } from '@shared/types';

export interface ArenaInit {
  speciesId: string;
  runToken: number;
}

export interface HudState {
  health: number;
  maxHealth: number;
  level: number;
  xp: number;
  xpToNext: number;
  score: number;
  kills: number;
  unspentPoints: number;
  stats: Record<StatKey, number>;
}

export interface RunOverPayload {
  score: number;
  level: number;
  kills: number;
  survivedMs: number;
  gearsEarned: number;
}
