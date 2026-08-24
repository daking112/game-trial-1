import type { TargetingMode } from '@shared/types';
import type { EnemyRuntime, PlacedMonsterRuntime } from '../battleTypes';

// Centralized targeting so no combat code duplicates "closest enemy" logic.
// Supported modes match the guide: first (furthest along the path), last
// (least progress), strongest (highest current HP), closest (nearest to
// the monster in world space).
export function pickTarget(
  monster: PlacedMonsterRuntime,
  enemies: EnemyRuntime[],
): EnemyRuntime | null {
  const inRange = enemies.filter(
    (e) => Math.hypot(e.x - monster.x, e.y - monster.y) <= monster.range,
  );
  if (inRange.length === 0) return null;

  switch (monster.targetingMode) {
    case 'first':
      return inRange.reduce((a, b) => (b.dist > a.dist ? b : a));
    case 'last':
      return inRange.reduce((a, b) => (b.dist < a.dist ? b : a));
    case 'strongest':
      return inRange.reduce((a, b) => (b.hp > a.hp ? b : a));
    case 'closest':
    default:
      return inRange.reduce((a, b) => {
        const da = Math.hypot(a.x - monster.x, a.y - monster.y);
        const db = Math.hypot(b.x - monster.x, b.y - monster.y);
        return db < da ? b : a;
      });
  }
}

export const TARGETING_MODES: TargetingMode[] = ['closest', 'first', 'last', 'strongest'];
