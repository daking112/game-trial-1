import { useState } from 'react';
import type { MonsterDefinition } from '@shared/types';
import { RARITY_CONFIG } from '@shared/constants';
import { useGameStore } from '../state/store';
import { MonsterSprite } from './MonsterSprite';

interface Props {
  species: MonsterDefinition;
  onClose: () => void;
}

// Modular, deliberately simple post-battle capture: matches the design doc's
// mock exactly (defeated wild monster, a displayed capture chance, a single
// CAPTURE action). This is the seam a full encounter mechanic replaces later.
export function CaptureModal({ species, onClose }: Props) {
  const attemptCapture = useGameStore((s) => s.attemptCapture);
  const [result, setResult] = useState<'success' | 'fail' | null>(null);
  const chance = RARITY_CONFIG[species.rarity].baseCaptureChance;

  function capture() {
    const success = attemptCapture(species.id);
    setResult(success ? 'success' : 'fail');
  }

  return (
    <div className="overlay">
      <div className="overlay-card capture-card">
        <div className="capture-icon" style={{ borderColor: species.color, background: `${species.color}22` }}>
          <MonsterSprite species={species} size={64} />
        </div>
        <h2>WILD MONSTER DEFEATED</h2>
        <div className="capture-name">{species.name}</div>
        <div className={`rarity-tag rarity-${species.rarity}`}>{species.rarity.toUpperCase()}</div>
        <p className="blurb">{species.description}</p>

        {result === null && (
          <>
            <div className="capture-chance">Capture Chance: {Math.round(chance * 100)}%</div>
            <button className="btn btn-primary" onClick={capture}>CAPTURE</button>
            <button className="btn btn-secondary" onClick={onClose}>Let it go</button>
          </>
        )}
        {result === 'success' && (
          <>
            <div className="capture-result success">CAPTURE SUCCESS!</div>
            <p>{species.name} joined your collection!</p>
            <button className="btn btn-primary" onClick={onClose}>Continue</button>
          </>
        )}
        {result === 'fail' && (
          <>
            <div className="capture-result fail">{species.name} escaped!</div>
            <button className="btn btn-primary" onClick={onClose}>Continue</button>
          </>
        )}
      </div>
    </div>
  );
}
