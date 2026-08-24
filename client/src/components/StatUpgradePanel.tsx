import type { StatKey } from '@shared/types';
import { MAX_POINTS_PER_STAT, STAT_KEYS, STAT_LABELS } from '@shared/constants';
import { EventBus } from '../arena/EventBus';

interface Props {
  unspentPoints: number;
  stats: Record<StatKey, number>;
}

export function StatUpgradePanel({ unspentPoints, stats }: Props) {
  return (
    <div className={`stat-panel${unspentPoints > 0 ? ' has-points' : ''}`}>
      <div className="stat-panel-header">
        Upgrade points: <b>{unspentPoints}</b>
      </div>
      {STAT_KEYS.map((key: StatKey) => {
        const value = stats[key];
        const maxed = value >= MAX_POINTS_PER_STAT;
        return (
          <div className="stat-row-upgrade" key={key}>
            <span className="stat-row-label">{STAT_LABELS[key]}</span>
            <div className="stat-row-pips">
              {Array.from({ length: MAX_POINTS_PER_STAT }).map((_, i) => (
                <span key={i} className={`pip${i < value ? ' filled' : ''}`} />
              ))}
            </div>
            <button
              className="stat-row-btn"
              disabled={unspentPoints <= 0 || maxed}
              onClick={() => EventBus.emit('allocate-stat', key)}
            >
              +
            </button>
          </div>
        );
      })}
    </div>
  );
}
