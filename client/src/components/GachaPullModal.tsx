import type { PullResult } from '@shared/types';
import { MONSTERS_BY_ID } from '@shared/monsterData';
import { RARITY_CONFIG } from '@shared/constants';

function toCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

interface Props {
  results: PullResult[];
  onClose: () => void;
}

export function GachaPullModal({ results, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card gacha-results" onClick={(e) => e.stopPropagation()}>
        <h2>PULL RESULTS</h2>
        <h1>{results.length === 1 ? 'You got...' : `${results.length} Monsters!`}</h1>
        <div className="gacha-result-grid">
          {results.map((r, i) => {
            const species = MONSTERS_BY_ID[r.speciesId];
            const rarity = RARITY_CONFIG[r.rarity];
            return (
              <div key={i} className="gacha-result-card" style={{ borderColor: rarity.color }}>
                <div className="monster-card-icon" style={{ background: toCss(species.color), borderColor: toCss(species.accentColor) }}>
                  {species.name.slice(0, 1)}
                </div>
                <div className="monster-card-name">{species.name}</div>
                <span className="rarity-tag" style={{ background: rarity.color + '33', color: rarity.color }}>
                  {rarity.label}
                </span>
                {r.isNew ? <span className="gacha-new-tag">NEW</span> : <span className="gacha-star-tag">★{r.starsAfter}</span>}
              </div>
            );
          })}
        </div>
        <button className="btn btn-primary btn-large" onClick={onClose}>
          Continue
        </button>
      </div>
    </div>
  );
}
