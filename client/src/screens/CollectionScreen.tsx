import { useState } from 'react';
import { MONSTERS, MONSTERS_BY_ID } from '@shared/monsterData';
import { RARITY_CONFIG } from '@shared/constants';
import { useGameStore } from '../state/store';
import { MonsterCard } from '../components/MonsterCard';

export function CollectionScreen() {
  const collection = useGameStore((s) => s.collection);
  const equippedSpeciesId = useGameStore((s) => s.equippedSpeciesId);
  const equip = useGameStore((s) => s.equip);
  const [selectedId, setSelectedId] = useState<string | null>(equippedSpeciesId);

  const selected = selectedId ? MONSTERS_BY_ID[selectedId] : null;
  const selectedEntry = selectedId ? collection[selectedId] : null;
  const ownedCount = Object.keys(collection).length;

  return (
    <div className="screen">
      <div className="panel collection-grid-panel">
        <h2>Collection</h2>
        <p className="panel-hint">
          {ownedCount} / {MONSTERS.length} monsters discovered. Pull duplicates in Gacha to raise star rank.
        </p>
        <div className="monster-grid">
          {MONSTERS.map((species) => {
            const entry = collection[species.id];
            return (
              <MonsterCard
                key={species.id}
                speciesId={species.id}
                stars={entry?.stars}
                selected={species.id === selectedId}
                locked={!entry}
                onClick={() => setSelectedId(species.id)}
              />
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="panel detail-panel">
          <div className="detail-hero">
            <div
              className="monster-card-icon"
              style={{
                width: 84,
                height: 84,
                fontSize: 32,
                background: '#' + selected.color.toString(16).padStart(6, '0'),
                borderColor: '#' + selected.accentColor.toString(16).padStart(6, '0'),
              }}
            >
              {selected.name.slice(0, 1)}
            </div>
          </div>
          <h2>{selected.name}</h2>
          <span className="rarity-tag" style={{ background: RARITY_CONFIG[selected.rarity].color + '33', color: RARITY_CONFIG[selected.rarity].color }}>
            {RARITY_CONFIG[selected.rarity].label}
          </span>
          <p className="blurb">{selected.description}</p>

          {selectedEntry ? (
            <>
              <div className="stat-row">
                <span>Stars</span>
                <b>{'★'.repeat(selectedEntry.stars)}{'☆'.repeat(5 - selectedEntry.stars)}</b>
              </div>
              <div className="stat-row">
                <span>Copies owned</span>
                <b>{selectedEntry.copies}</b>
              </div>
              <div className="stat-row">
                <span>Barrels</span>
                <b>{selected.barrels.length}</b>
              </div>
              <div className="detail-actions">
                {selected.id === equippedSpeciesId ? (
                  <button className="btn btn-primary" disabled>
                    Equipped
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={() => equip(selected.id)}>
                    Equip
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="blurb">Not yet discovered. Try your luck in the Gacha!</p>
          )}
        </div>
      )}
    </div>
  );
}
