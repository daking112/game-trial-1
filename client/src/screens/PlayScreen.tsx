import { useRef, useState } from 'react';
import { MONSTERS_BY_ID, pickWeightedRandomSpecies } from '@shared/monsterData';
import { PhaserGame } from '../battle/PhaserGame';
import { BattleHud } from '../components/BattleHud';
import { CaptureModal } from '../components/CaptureModal';
import { MonsterCard } from '../components/MonsterCard';
import { useGameStore } from '../state/store';
import type { BattleResultPayload } from '../battle/battleTypes';

type Phase = 'team-select' | 'battle' | 'result';

export function PlayScreen() {
  const collection = useGameStore((s) => s.collection);
  const team = useGameStore((s) => s.team);
  const toggleTeamMember = useGameStore((s) => s.toggleTeamMember);
  const grantXp = useGameStore((s) => s.grantXp);
  const addCurrency = useGameStore((s) => s.addCurrency);
  const markSeen = useGameStore((s) => s.markSeen);

  const [phase, setPhase] = useState<Phase>('team-select');
  const [runToken, setRunToken] = useState(0);
  const [result, setResult] = useState<{ victory: boolean; payload: BattleResultPayload; leveledUp: string[] } | null>(null);
  const [captureSpeciesId, setCaptureSpeciesId] = useState<string | null>(null);
  const settled = useRef(false);

  const teamInstances = team.map((id) => collection.find((m) => m.instanceId === id)!).filter(Boolean);

  function beginBattle() {
    settled.current = false;
    setResult(null);
    setPhase('battle');
    setRunToken((t) => t + 1);
  }

  function onBattleEnd(victory: boolean, payload: BattleResultPayload) {
    if (settled.current) return;
    settled.current = true;
    const leveledUp = grantXp(payload.xpByInstance);
    addCurrency(payload.gold, payload.crystals);
    setResult({ victory, payload, leveledUp });
    setPhase('result');
    if (victory) {
      const species = pickWeightedRandomSpecies();
      markSeen(species.id);
      setCaptureSpeciesId(species.id);
    }
  }

  if (phase === 'battle') {
    return (
      <div className="battle-viewport">
        <PhaserGame team={teamInstances} runToken={runToken} />
        <BattleHud team={teamInstances} onBattleEnd={onBattleEnd} />
      </div>
    );
  }

  if (phase === 'result' && result) {
    return (
      <div className="screen result-screen">
        <div className="panel overlay-card">
          <h1>{result.victory ? 'The Thicket Holds!' : 'The Core Has Fallen'}</h1>
          <p className="blurb">
            {result.victory
              ? 'You repelled every wave of the Rustfall Swarm, including The Foreman.'
              : `You held out until wave ${result.payload.waveReached ?? '?'} of 10.`}
          </p>
          <div className="stat-row"><span>Gold earned</span><b>+{result.payload.gold}</b></div>
          <div className="stat-row"><span>Crystals earned</span><b>+{result.payload.crystals}</b></div>
          {result.leveledUp.length > 0 && (
            <div className="stat-row"><span>Leveled up</span><b>{result.leveledUp.length} warden(s)</b></div>
          )}
          <div className="detail-actions">
            <button className="btn btn-primary" onClick={beginBattle}>Battle Again</button>
            <button className="btn btn-secondary" onClick={() => setPhase('team-select')}>Back to Team Select</button>
          </div>
        </div>
        {captureSpeciesId && (
          <CaptureModal species={MONSTERS_BY_ID[captureSpeciesId]} onClose={() => setCaptureSpeciesId(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="panel team-select-panel">
        <h2>Choose Your Team</h2>
        <p className="panel-hint">Select up to 6 wardens to bring into the Gearwood Thicket. Deploy them to open tiles during battle.</p>
        <div className="monster-grid">
          {collection.map((m) => (
            <MonsterCard key={m.instanceId} instance={m} selected={team.includes(m.instanceId)} onClick={() => toggleTeamMember(m.instanceId)} />
          ))}
        </div>
        <button className="btn btn-primary btn-large" disabled={team.length === 0} onClick={beginBattle}>
          {team.length === 0 ? 'Select at least one warden' : `Begin Battle (${team.length}/6)`}
        </button>
      </div>
    </div>
  );
}
