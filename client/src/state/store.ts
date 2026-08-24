import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CollectionEntry, PullResult, Rarity, RunResult } from '@shared/types';
import { MONSTERS, MONSTERS_BY_ID, STARTER_SPECIES_ID } from '@shared/monsterData';
import {
  MAX_STARS,
  PITY_PULLS_FOR_GUARANTEED_EPIC,
  PULL_COST_SINGLE,
  PULL_COST_TEN,
  RARITY_CONFIG,
  RARITY_ORDER,
  STARTING_GEARS,
} from '@shared/constants';

function weightedRarity(guaranteedEpicPlus: boolean): Rarity {
  const pool = guaranteedEpicPlus ? (['epic', 'legendary'] as Rarity[]) : RARITY_ORDER;
  const total = pool.reduce((sum, r) => sum + RARITY_CONFIG[r].weight, 0);
  let roll = Math.random() * total;
  for (const rarity of pool) {
    roll -= RARITY_CONFIG[rarity].weight;
    if (roll <= 0) return rarity;
  }
  return pool[pool.length - 1];
}

function rollSpeciesOfRarity(rarity: Rarity): string {
  const candidates = MONSTERS.filter((m) => m.rarity === rarity);
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

interface GameState {
  gears: number;
  collection: Record<string, CollectionEntry>;
  equippedSpeciesId: string;
  pityCounter: number;
  bestScore: number;
  totalPulls: number;
  log: string[];

  pull: (count: 1 | 10) => PullResult[];
  equip: (speciesId: string) => void;
  recordRunResult: (result: RunResult) => void;
  addLog: (msg: string) => void;
  resetGame: () => void;
}

function starterCollection(): Record<string, CollectionEntry> {
  return {
    [STARTER_SPECIES_ID]: { speciesId: STARTER_SPECIES_ID, stars: 1, copies: 1, obtainedAt: Date.now() },
  };
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      gears: STARTING_GEARS,
      collection: starterCollection(),
      equippedSpeciesId: STARTER_SPECIES_ID,
      pityCounter: 0,
      bestScore: 0,
      totalPulls: 0,
      log: ['Welcome. Snubnose is ready to deploy — head to the Arena or try a Gacha pull.'],

      pull: (count) => {
        const state = get();
        const cost = count === 1 ? PULL_COST_SINGLE : PULL_COST_TEN;
        if (state.gears < cost) return [];

        let pity = state.pityCounter;
        const results: PullResult[] = [];
        const collection = { ...state.collection };

        for (let i = 0; i < count; i++) {
          const guaranteed = pity >= PITY_PULLS_FOR_GUARANTEED_EPIC - 1;
          const rarity = weightedRarity(guaranteed);
          pity = rarity === 'epic' || rarity === 'legendary' ? 0 : pity + 1;

          const speciesId = rollSpeciesOfRarity(rarity);
          const existing = collection[speciesId];
          const isNew = !existing;
          const stars = existing ? Math.min(MAX_STARS, existing.stars + 1) : 1;
          collection[speciesId] = {
            speciesId,
            stars,
            copies: (existing?.copies ?? 0) + 1,
            obtainedAt: existing?.obtainedAt ?? Date.now(),
          };
          results.push({ speciesId, rarity, isNew, starsAfter: stars });
        }

        set({
          gears: state.gears - cost,
          collection,
          pityCounter: pity,
          totalPulls: state.totalPulls + count,
        });
        return results;
      },

      equip: (speciesId) => {
        if (!get().collection[speciesId]) return;
        set({ equippedSpeciesId: speciesId });
      },

      recordRunResult: (result) => {
        set((s) => ({
          gears: s.gears + result.gearsEarned,
          bestScore: Math.max(s.bestScore, result.score),
          log: [...s.log.slice(-49), `Run ended: level ${result.level}, ${result.kills} kills, +${result.gearsEarned} gears.`],
        }));
      },

      addLog: (msg) => set((s) => ({ log: [...s.log.slice(-49), msg] })),

      resetGame: () =>
        set({
          gears: STARTING_GEARS,
          collection: starterCollection(),
          equippedSpeciesId: STARTER_SPECIES_ID,
          pityCounter: 0,
          bestScore: 0,
          totalPulls: 0,
          log: ['Welcome. Snubnose is ready to deploy — head to the Arena or try a Gacha pull.'],
        }),
    }),
    { name: 'monster-arena-save-v1' },
  ),
);

export function speciesName(speciesId: string): string {
  return MONSTERS_BY_ID[speciesId]?.name ?? speciesId;
}
