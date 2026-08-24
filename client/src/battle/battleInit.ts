import type { MonsterInstance } from '@shared/types';

// Single-player MVP: the team is handed to the scene through this small
// mutable holder rather than Phaser's scene-data plumbing, since there is
// only ever one battle running at a time. A multiplayer server-authoritative
// version replaces this with a real network handshake in a later phase.
export const battleInit: { team: MonsterInstance[] } = { team: [] };
