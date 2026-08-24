import { elementalMultiplier, levelStatMultiplier, RARITY_CONFIG, TRAITS } from '@shared/constants';
import type { Element, MonsterDefinition, MonsterInstance } from '@shared/types';

export interface EffectiveStats {
  health: number;
  damage: number;
  attackSpeed: number;
  range: number;
  abilityCooldownMs: number;
}

// Combines species base stats + rarity scaling + level curve + rolled trait
// into the final numbers a placed monster fights with. Centralized here so
// the Phaser scene, the collection UI, and (later) the server all agree.
export function computeEffectiveStats(species: MonsterDefinition, instance: MonsterInstance): EffectiveStats {
  const rarityMult = RARITY_CONFIG[species.rarity].statMult;
  const lvlMult = levelStatMultiplier(instance.level);
  const trait = TRAITS[instance.traitId];
  const evoMult = instance.evolved && species.evolution ? species.evolution.statMultiplier : 1;

  const scale = rarityMult * lvlMult * evoMult;

  return {
    health: Math.round(species.baseHealth * scale * trait.defenseMult),
    damage: Math.round(species.baseDamage * scale * trait.damageMult),
    attackSpeed: +(species.attackSpeed * trait.attackSpeedMult).toFixed(2),
    range: species.range + (species.passive.kind === 'range_boost' ? species.passive.value : 0),
    abilityCooldownMs: Math.round(species.ability.cooldownMs * trait.cooldownMult),
  };
}

export interface DamageResult {
  finalDamage: number;
  wasElementalAdvantage: boolean;
}

export function computeDamage(
  baseDamage: number,
  attackerElement: Element,
  defenderElement: Element,
  extraMult = 1,
): DamageResult {
  const mult = elementalMultiplier(attackerElement, defenderElement);
  return {
    finalDamage: Math.max(1, Math.round(baseDamage * mult * extraMult)),
    wasElementalAdvantage: mult > 1,
  };
}
