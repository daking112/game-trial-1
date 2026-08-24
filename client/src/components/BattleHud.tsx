import { useEffect, useState } from 'react';
import type { MonsterInstance, TargetingMode } from '@shared/types';
import { MONSTERS_BY_ID } from '@shared/monsterData';
import { EventBus } from '../battle/EventBus';
import type { BattleHudState, BattleResultPayload, MonsterSelectedPayload } from '../battle/battleTypes';

interface Props {
  team: MonsterInstance[];
  onBattleEnd: (victory: boolean, payload: BattleResultPayload) => void;
}

export function BattleHud({ team, onBattleEnd }: Props) {
  const [hud, setHud] = useState<BattleHudState | null>(null);
  const [selected, setSelected] = useState<MonsterSelectedPayload | null>(null);
  const [placedIds, setPlacedIds] = useState<Set<string>>(new Set());
  const [selectedForPlacement, setSelectedForPlacement] = useState<string | null>(null);

  useEffect(() => {
    const onHud = (s: BattleHudState) => setHud(s);
    const onSelected = (s: MonsterSelectedPayload) => setSelected(s);
    const onDeselected = () => setSelected(null);
    const onPlaced = (instanceId: string) => {
      setPlacedIds((prev) => new Set(prev).add(instanceId));
      setSelectedForPlacement(null);
    };
    const onVictory = (payload: BattleResultPayload) => onBattleEnd(true, payload);
    const onDefeat = (payload: BattleResultPayload) => onBattleEnd(false, payload);

    EventBus.on('hud-update', onHud);
    EventBus.on('monster-selected', onSelected);
    EventBus.on('monster-deselected', onDeselected);
    EventBus.on('monster-placed', onPlaced);
    EventBus.on('battle-victory', onVictory);
    EventBus.on('battle-defeat', onDefeat);
    return () => {
      EventBus.off('hud-update', onHud);
      EventBus.off('monster-selected', onSelected);
      EventBus.off('monster-deselected', onDeselected);
      EventBus.off('monster-placed', onPlaced);
      EventBus.off('battle-victory', onVictory);
      EventBus.off('battle-defeat', onDefeat);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectForPlacement(instanceId: string) {
    if (placedIds.has(instanceId)) return;
    const next = selectedForPlacement === instanceId ? null : instanceId;
    setSelectedForPlacement(next);
    EventBus.emit('cmd-select-for-placement', next);
  }

  function cycleTargeting() {
    if (!selected) return;
    const modes = selected.targetingModes;
    const idx = modes.indexOf(selected.targetingMode);
    const nextMode: TargetingMode = modes[(idx + 1) % modes.length];
    EventBus.emit('cmd-set-targeting', { runtimeId: selected.runtimeId, mode: nextMode });
  }

  function activateUltimate() {
    if (!selected || selected.ultimateCharge < 1) return;
    EventBus.emit('cmd-activate-ultimate', selected.runtimeId);
  }

  return (
    <div className="battle-hud">
      <div className="battle-topbar">
        <div className="stat"><span className="stat-icon">⚙️</span>{hud?.gold ?? 0}</div>
        <div className="stat"><span className="stat-icon">💎</span>{hud?.crystals ?? 0}</div>
        <div className="stat"><span className="stat-icon">🛡️</span>{hud?.coreHp ?? '-'}/{hud?.maxCoreHp ?? '-'}</div>
        <div className="stat wave-stat">WAVE {hud?.wave ?? 1} / {hud?.totalWaves ?? 10}</div>
        {hud && !hud.waveActive && hud.prepRemainingMs > 0 && (
          <div className="prep-banner">
            Next wave in {Math.ceil(hud.prepRemainingMs / 1000)}s
            <button className="btn btn-small" onClick={() => EventBus.emit('cmd-skip-prep')}>Start Now</button>
          </div>
        )}
      </div>

      {selected && (
        <div className="battle-selection-panel">
          <h3>{selected.name}</h3>
          <div className="stat-row"><span>Element</span><b>{selected.element}</b></div>
          <div className="stat-row"><span>Damage</span><b>{selected.damage}</b></div>
          <div className="stat-row"><span>Range</span><b>{selected.range}</b></div>
          <div className="stat-row"><span>Attack Speed</span><b>{selected.attackSpeed}</b></div>
          <div className="stat-row"><span>Targeting</span><b>{selected.targetingMode}</b></div>
          <button className="btn btn-small" onClick={cycleTargeting}>Cycle Targeting</button>
          <div className="ult-bar-wrap"><div className="ult-bar-fg" style={{ width: `${selected.ultimateCharge * 100}%` }} /></div>
          <button className="btn btn-primary" disabled={selected.ultimateCharge < 1} onClick={activateUltimate}>
            {selected.abilityName} Ultimate {selected.ultimateCharge < 1 ? `(${Math.round(selected.ultimateCharge * 100)}%)` : '(READY)'}
          </button>
        </div>
      )}

      <div className="battle-tray">
        {team.map((m) => {
          const species = MONSTERS_BY_ID[m.speciesId];
          const placed = placedIds.has(m.instanceId);
          const active = selectedForPlacement === m.instanceId;
          return (
            <button
              key={m.instanceId}
              className={`tray-item ${placed ? 'placed' : ''} ${active ? 'active' : ''}`}
              style={{ borderColor: species.color }}
              disabled={placed}
              onClick={() => selectForPlacement(m.instanceId)}
              title={placed ? `${species.name} (deployed)` : species.name}
            >
              <span className="tray-icon" style={{ background: `${species.color}33` }}>{species.name[0]}</span>
              <span className="tray-name">{species.name}</span>
              <span className="tray-level">Lv.{m.level}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
