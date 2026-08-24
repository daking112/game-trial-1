import { MONSTERS_BY_ID } from '@shared/monsterData';
import { RARITY_CONFIG } from '@shared/constants';

function toCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

interface Props {
  speciesId: string;
  stars?: number;
  selected?: boolean;
  locked?: boolean;
  onClick?: () => void;
}

export function MonsterCard({ speciesId, stars, selected, locked, onClick }: Props) {
  const species = MONSTERS_BY_ID[speciesId];
  if (!species) return null;
  const rarity = RARITY_CONFIG[species.rarity];

  return (
    <button
      className={`monster-card${selected ? ' selected' : ''}${locked ? ' locked' : ''}`}
      style={{ borderColor: rarity.color }}
      onClick={onClick}
      disabled={locked}
    >
      <div className="monster-card-icon" style={{ background: toCss(species.color), borderColor: toCss(species.accentColor) }}>
        {species.name.slice(0, 1)}
      </div>
      <div className="monster-card-name">{species.name}</div>
      <span className="rarity-tag" style={{ background: rarity.color + '33', color: rarity.color }}>
        {rarity.label}
      </span>
      {stars !== undefined && (
        <div className="monster-card-stars" aria-label={`${stars} stars`}>
          {'★'.repeat(stars)}
          <span className="stars-empty">{'★'.repeat(Math.max(0, 5 - stars))}</span>
        </div>
      )}
      {locked && <div className="monster-card-locked">Not owned</div>}
    </button>
  );
}
