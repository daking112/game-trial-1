import { useCallback, useEffect, useState } from 'react';
import { ArenaGame } from '../arena/ArenaGame';
import { EventBus } from '../arena/EventBus';
import type { HudState, RunOverPayload } from '../arena/arenaTypes';
import { useGameStore } from '../state/store';
import { StatUpgradePanel } from '../components/StatUpgradePanel';
import { ResultsOverlay } from '../components/ResultsOverlay';
import { MonsterCard } from '../components/MonsterCard';
import { MONSTERS_BY_ID } from '@shared/monsterData';

type Phase = 'idle' | 'running' | 'over';

const EMPTY_HUD: HudState = {
  health: 100,
  maxHealth: 100,
  level: 1,
  xp: 0,
  xpToNext: 20,
  score: 0,
  kills: 0,
  unspentPoints: 0,
  stats: {
    healthRegen: 0,
    maxHealth: 0,
    bodyDamage: 0,
    bulletSpeed: 0,
    bulletPenetration: 0,
    bulletDamage: 0,
    reload: 0,
    movementSpeed: 0,
  },
};

export function ArenaScreen() {
  const equippedSpeciesId = useGameStore((s) => s.equippedSpeciesId);
  const collection = useGameStore((s) => s.collection);
  const equip = useGameStore((s) => s.equip);
  const bestScore = useGameStore((s) => s.bestScore);
  const recordRunResult = useGameStore((s) => s.recordRunResult);

  const [phase, setPhase] = useState<Phase>('idle');
  const [runToken, setRunToken] = useState(0);
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [runResult, setRunResult] = useState<RunOverPayload | null>(null);

  useEffect(() => {
    const onHud = (payload: HudState) => setHud(payload);
    const onRunOver = (payload: RunOverPayload) => {
      recordRunResult(payload);
      setRunResult(payload);
      setPhase('over');
    };
    EventBus.on('hud-update', onHud);
    EventBus.on('run-over', onRunOver);
    return () => {
      EventBus.off('hud-update', onHud);
      EventBus.off('run-over', onRunOver);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRun = useCallback(() => {
    setHud(EMPTY_HUD);
    setRunResult(null);
    setRunToken((t) => t + 1);
    setPhase('running');
  }, []);

  const exitToMenu = useCallback(() => {
    EventBus.emit('request-exit');
    setPhase('idle');
  }, []);

  const owned = Object.values(collection);
  const stars = collection[equippedSpeciesId]?.stars ?? 1;
  const species = MONSTERS_BY_ID[equippedSpeciesId];

  if (phase === 'idle') {
    return (
      <div className="screen">
        <div className="panel loadout-panel">
          <h2>Enter the Arena</h2>
          <p className="panel-hint">
            Move with WASD, aim with the mouse, hold left click to fire. Kill shapes and rival tanks to level up and
            spend points on stats. Survive as long as you can — Gears earned carry over to Gacha pulls.
          </p>
          <div className="loadout-preview">
            <MonsterCard speciesId={equippedSpeciesId} stars={stars} selected />
            {species && <p className="blurb">{species.description}</p>}
          </div>
          <h3>Choose your loadout</h3>
          <div className="monster-grid">
            {owned.map((entry) => (
              <MonsterCard
                key={entry.speciesId}
                speciesId={entry.speciesId}
                stars={entry.stars}
                selected={entry.speciesId === equippedSpeciesId}
                onClick={() => equip(entry.speciesId)}
              />
            ))}
          </div>
          <button className="btn btn-primary btn-large" onClick={startRun}>
            Enter Arena
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="arena-viewport">
      <ArenaGame speciesId={equippedSpeciesId} stars={stars} runToken={runToken} />
      {phase === 'running' && (
        <div className="arena-hud">
          <div className="arena-topbar">
            <button className="btn btn-small" onClick={exitToMenu}>
              Exit
            </button>
            <div className="arena-level">Lv {hud.level}</div>
            <div className="xp-bar-wrap">
              <div className="xp-bar-fg" style={{ width: `${Math.min(100, (hud.xp / hud.xpToNext) * 100)}%` }} />
            </div>
            <div className="arena-score">Score {hud.score}</div>
          </div>
          <div className="health-bar-wrap">
            <div className="health-bar-fg" style={{ width: `${Math.max(0, (hud.health / hud.maxHealth) * 100)}%` }} />
            <span className="health-bar-text">
              {hud.health} / {hud.maxHealth}
            </span>
          </div>
          {hud.unspentPoints > 0 && <StatUpgradePanel unspentPoints={hud.unspentPoints} stats={hud.stats} />}
        </div>
      )}
      {phase === 'over' && runResult && (
        <ResultsOverlay result={runResult} bestScore={bestScore} onPlayAgain={startRun} onExit={() => setPhase('idle')} />
      )}
    </div>
  );
}
