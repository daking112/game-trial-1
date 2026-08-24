import { useState } from 'react';
import type { PullResult } from '@shared/types';
import { RARITY_CONFIG, RARITY_ORDER, PULL_COST_SINGLE, PULL_COST_TEN } from '@shared/constants';
import { useGameStore } from '../state/store';
import { GachaPullModal } from '../components/GachaPullModal';

export function GachaScreen() {
  const gears = useGameStore((s) => s.gears);
  const pull = useGameStore((s) => s.pull);
  const totalPulls = useGameStore((s) => s.totalPulls);
  const [pending, setPending] = useState<PullResult[] | null>(null);

  const doPull = (count: 1 | 10) => {
    const results = pull(count);
    if (results.length > 0) setPending(results);
  };

  return (
    <div className="screen">
      <div className="panel gacha-panel">
        <h2>Gacha</h2>
        <p className="panel-hint">
          Spend Gears earned in the Arena to pull new monster loadouts. Duplicates raise that monster's star rank,
          boosting its stats when equipped (up to 5 stars).
        </p>
        <div className="gacha-currency">
          ⚙️ <b>{gears}</b> Gears &nbsp;·&nbsp; {totalPulls} lifetime pulls
        </div>
        <div className="gacha-odds">
          {RARITY_ORDER.map((r) => (
            <div key={r} className="gacha-odds-row" style={{ color: RARITY_CONFIG[r].color }}>
              {RARITY_CONFIG[r].label}: {RARITY_CONFIG[r].weight}%
            </div>
          ))}
        </div>
        <div className="gacha-actions">
          <button className="btn btn-primary btn-large" disabled={gears < PULL_COST_SINGLE} onClick={() => doPull(1)}>
            Pull x1 — ⚙️{PULL_COST_SINGLE}
          </button>
          <button className="btn btn-primary btn-large" disabled={gears < PULL_COST_TEN} onClick={() => doPull(10)}>
            Pull x10 — ⚙️{PULL_COST_TEN}
          </button>
        </div>
        <p className="panel-hint">Pity: 10 pulls without an Epic+ guarantees your next one is Epic or better.</p>
      </div>
      {pending && <GachaPullModal results={pending} onClose={() => setPending(null)} />}
    </div>
  );
}
