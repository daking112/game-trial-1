import type { MonsterInstance } from '@shared/types';
import { MONSTERS_BY_ID } from '@shared/monsterData';

interface Props {
  instance: MonsterInstance;
  selected?: boolean;
  onClick?: () => void;
}

export function MonsterCard({ instance, selected, onClick }: Props) {
  const species = MONSTERS_BY_ID[instance.speciesId];
  const displayName = instance.evolved && species.evolution ? species.evolution.intoName : species.name;
  return (
    <button className={`monster-card ${selected ? 'selected' : ''}`} onClick={onClick} style={{ borderColor: species.color }}>
      <div className="monster-card-icon" style={{ background: `${species.color}33` }}>{displayName[0]}</div>
      <div className="monster-card-name">{displayName}</div>
      <div className={`rarity-tag rarity-${species.rarity}`}>{species.rarity}</div>
      <div className="monster-card-level">Lv.{instance.level}</div>
    </button>
  );
}
