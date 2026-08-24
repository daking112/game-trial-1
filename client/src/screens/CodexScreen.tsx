import { MONSTERS } from '@shared/monsterData';
import { useGameStore } from '../state/store';

export function CodexScreen() {
  const codex = useGameStore((s) => s.codex);
  const collection = useGameStore((s) => s.collection);

  return (
    <div className="screen codex-screen">
      <div className="panel codex-panel">
        <h2>Codex &mdash; Gearwood Thicket</h2>
        <p className="panel-hint">Discover and capture wild wardens to fill your codex.</p>
        <div className="codex-grid">
          {MONSTERS.map((species) => {
            const entry = codex[species.id];
            const owned = collection.filter((m) => m.speciesId === species.id).length;
            if (!entry?.seen) {
              return (
                <div key={species.id} className="codex-card unseen">
                  <div className="codex-icon">???</div>
                  <div className="codex-name">Unknown creature</div>
                  <div className={`rarity-tag rarity-${species.rarity}`}>{species.rarity}</div>
                </div>
              );
            }
            return (
              <div key={species.id} className={`codex-card ${entry.captured ? 'captured' : ''}`} style={{ borderColor: species.color }}>
                <div className="codex-icon" style={{ background: `${species.color}33` }}>{species.name[0]}</div>
                <div className="codex-name">{species.name}</div>
                <div className={`rarity-tag rarity-${species.rarity}`}>{species.element} &middot; {species.rarity}</div>
                <p className="codex-desc">{species.description}</p>
                <p className="codex-habitat">Habitat: {species.habitat}</p>
                <p className="codex-status">
                  {entry.captured ? `Captured ×${owned}` : 'Seen, not captured'}
                  {entry.evolvedSeen ? ` — Evolves into ${species.evolution?.intoName}` : ''}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
