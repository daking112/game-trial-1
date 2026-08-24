import { useState } from 'react';
import { MONSTERS_BY_ID } from '@shared/monsterData';
import { TRAITS, xpToNextLevel } from '@shared/constants';
import { computeEffectiveStats } from '../battle/systems/combat';
import { useGameStore } from '../state/store';
import { MonsterCard } from '../components/MonsterCard';

export function CollectionScreen() {
  const collection = useGameStore((s) => s.collection);
  const team = useGameStore((s) => s.team);
  const toggleTeamMember = useGameStore((s) => s.toggleTeamMember);
  const evolveMonster = useGameStore((s) => s.evolveMonster);
  const [selectedId, setSelectedId] = useState<string | null>(collection[0]?.instanceId ?? null);

  const selected = collection.find((m) => m.instanceId === selectedId) ?? null;
  const species = selected ? MONSTERS_BY_ID[selected.speciesId] : null;
  const stats = selected && species ? computeEffectiveStats(species, selected) : null;

  return (
    <div className="screen collection-screen">
      <div className="panel collection-grid-panel">
        <h2>My Monsters</h2>
        <p className="panel-hint">Inventory: {collection.length} / 100 &middot; Team: {team.length} / 6</p>
        <div className="monster-grid">
          {collection.map((m) => (
            <MonsterCard key={m.instanceId} instance={m} selected={m.instanceId === selectedId} onClick={() => setSelectedId(m.instanceId)} />
          ))}
        </div>
      </div>

      <div className="panel detail-panel">
        {!selected || !species || !stats ? (
          <p className="panel-hint">Select a monster to view its details.</p>
        ) : (
          <>
            <h2>{selected.evolved && species.evolution ? species.evolution.intoName : species.name}</h2>
            <div className={`rarity-tag rarity-${species.rarity}`}>{species.element.toUpperCase()} &middot; {species.rarity}</div>
            <p className="blurb">{species.description}</p>
            <div className="stat-row"><span>Level</span><b>{selected.level}</b></div>
            <div className="stat-row"><span>XP</span><b>{selected.xp} / {xpToNextLevel(selected.level)}</b></div>
            <div className="stat-row"><span>HP</span><b>{stats.health}</b></div>
            <div className="stat-row"><span>Damage</span><b>{stats.damage}</b></div>
            <div className="stat-row"><span>Range</span><b>{Math.round(stats.range)}</b></div>
            <div className="stat-row"><span>Trait</span><b>{TRAITS[selected.traitId].name}</b></div>
            <p className="panel-hint">{TRAITS[selected.traitId].description}</p>
            <div className="stat-row"><span>Ability</span><b>{species.ability.name}</b></div>
            <p className="panel-hint">{species.ability.description}</p>
            <div className="stat-row"><span>Passive</span><b>{species.passive.name}</b></div>

            {species.evolution && !selected.evolved && (
              <div className="stat-row">
                <span>Evolution</span>
                <b>{species.evolution.intoName} (Lv.{species.evolution.atLevel})</b>
              </div>
            )}

            <div className="detail-actions">
              <button className="btn btn-primary" onClick={() => toggleTeamMember(selected.instanceId)}>
                {team.includes(selected.instanceId) ? 'Remove from Team' : 'Deploy to Team'}
              </button>
              {species.evolution && !selected.evolved && (
                <button
                  className="btn btn-secondary"
                  disabled={selected.level < species.evolution.atLevel}
                  onClick={() => evolveMonster(selected.instanceId)}
                >
                  Evolve{selected.level < species.evolution.atLevel ? ` (Lv.${species.evolution.atLevel} needed)` : ''}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
