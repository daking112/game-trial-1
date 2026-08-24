import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CodexEntry, MonsterInstance, TraitId } from '@shared/types';
import { MONSTERS, MONSTERS_BY_ID } from '@shared/monsterData';
import { RARITY_CONFIG, STARTING_CRYSTALS, STARTING_GOLD, TRAIT_IDS, xpToNextLevel, MAX_LEVEL } from '@shared/constants';

function rollTrait(): TraitId {
  return TRAIT_IDS[Math.floor(Math.random() * TRAIT_IDS.length)];
}

function makeInstance(speciesId: string, level = 1): MonsterInstance {
  return {
    instanceId: crypto.randomUUID(),
    speciesId,
    nickname: null,
    level,
    xp: 0,
    traitId: rollTrait(),
    evolved: false,
    capturedAt: Date.now(),
  };
}

function emptyCodex(): Record<string, CodexEntry> {
  return Object.fromEntries(
    MONSTERS.map((m) => [m.id, { speciesId: m.id, seen: false, captured: false, evolvedSeen: false }]),
  );
}

interface GameState {
  gold: number;
  crystals: number;
  collection: MonsterInstance[];
  codex: Record<string, CodexEntry>;
  team: string[]; // instanceIds, max 6
  log: string[];

  addCurrency: (gold: number, crystals: number) => void;
  addLog: (msg: string) => void;
  markSeen: (speciesId: string) => void;
  attemptCapture: (speciesId: string) => boolean;
  grantXp: (xpByInstance: Record<string, number>) => string[]; // returns instanceIds that leveled up
  evolveMonster: (instanceId: string) => boolean;
  setTeam: (ids: string[]) => void;
  toggleTeamMember: (instanceId: string) => void;
  resetGame: () => void;
}

const MAX_TEAM_SIZE = 6;

function initialCollection(): MonsterInstance[] {
  return [makeInstance('cogling', 3)];
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      gold: STARTING_GOLD,
      crystals: STARTING_CRYSTALS,
      collection: initialCollection(),
      codex: (() => {
        const codex = emptyCodex();
        codex['cogling'] = { speciesId: 'cogling', seen: true, captured: true, evolvedSeen: false };
        return codex;
      })(),
      team: [],
      log: ['Welcome to Monsterfall. Your first warden, Cogling, awaits deployment.'],

      addCurrency: (gold, crystals) =>
        set((s) => ({ gold: s.gold + gold, crystals: s.crystals + crystals })),

      addLog: (msg) => set((s) => ({ log: [...s.log.slice(-49), msg] })),

      markSeen: (speciesId) =>
        set((s) => ({
          codex: { ...s.codex, [speciesId]: { ...s.codex[speciesId], seen: true } },
        })),

      attemptCapture: (speciesId) => {
        const species = MONSTERS_BY_ID[speciesId];
        const chance = RARITY_CONFIG[species.rarity].baseCaptureChance;
        const success = Math.random() < chance;
        set((s) => {
          const codexEntry = { ...s.codex[speciesId], seen: true, captured: s.codex[speciesId].captured || success };
          if (!success) {
            return { codex: { ...s.codex, [speciesId]: codexEntry } };
          }
          return {
            collection: [...s.collection, makeInstance(speciesId)],
            codex: { ...s.codex, [speciesId]: codexEntry },
          };
        });
        return success;
      },

      grantXp: (xpByInstance) => {
        const leveledUp: string[] = [];
        set((s) => ({
          collection: s.collection.map((mon) => {
            const gain = xpByInstance[mon.instanceId];
            if (!gain) return mon;
            let xp = mon.xp + gain;
            let level = mon.level;
            while (level < MAX_LEVEL && xp >= xpToNextLevel(level)) {
              xp -= xpToNextLevel(level);
              level += 1;
            }
            if (level > mon.level) leveledUp.push(mon.instanceId);
            return { ...mon, xp, level };
          }),
        }));
        return leveledUp;
      },

      evolveMonster: (instanceId) => {
        const mon = get().collection.find((m) => m.instanceId === instanceId);
        if (!mon) return false;
        const species = MONSTERS_BY_ID[mon.speciesId];
        if (!species.evolution || mon.evolved || mon.level < species.evolution.atLevel) return false;
        set((s) => ({
          collection: s.collection.map((m) => (m.instanceId === instanceId ? { ...m, evolved: true } : m)),
          codex: { ...s.codex, [mon.speciesId]: { ...s.codex[mon.speciesId], evolvedSeen: true } },
        }));
        return true;
      },

      setTeam: (ids) => set({ team: ids.slice(0, MAX_TEAM_SIZE) }),

      toggleTeamMember: (instanceId) =>
        set((s) => {
          if (s.team.includes(instanceId)) return { team: s.team.filter((id) => id !== instanceId) };
          if (s.team.length >= MAX_TEAM_SIZE) return s;
          return { team: [...s.team, instanceId] };
        }),

      resetGame: () =>
        set({
          gold: STARTING_GOLD,
          crystals: STARTING_CRYSTALS,
          collection: initialCollection(),
          codex: (() => {
            const codex = emptyCodex();
            codex['cogling'] = { speciesId: 'cogling', seen: true, captured: true, evolvedSeen: false };
            return codex;
          })(),
          team: [],
          log: ['Welcome to Monsterfall. Your first warden, Cogling, awaits deployment.'],
        }),
    }),
    { name: 'monsterfall-save-v1' },
  ),
);
