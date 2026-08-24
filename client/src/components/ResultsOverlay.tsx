import type { RunOverPayload } from '../arena/arenaTypes';

interface Props {
  result: RunOverPayload;
  bestScore: number;
  onPlayAgain: () => void;
  onExit: () => void;
}

export function ResultsOverlay({ result, bestScore, onPlayAgain, onExit }: Props) {
  const isNewBest = result.score >= bestScore;
  return (
    <div className="overlay result-screen">
      <div className="overlay-card">
        <h2>RUN OVER</h2>
        <h1>{isNewBest ? 'New Best Score!' : 'Defeated'}</h1>
        <div className="result-stats">
          <div className="stat-row">
            <span>Level reached</span>
            <b>{result.level}</b>
          </div>
          <div className="stat-row">
            <span>Score</span>
            <b>{result.score}</b>
          </div>
          <div className="stat-row">
            <span>Kills</span>
            <b>{result.kills}</b>
          </div>
          <div className="stat-row">
            <span>Survived</span>
            <b>{Math.round(result.survivedMs / 1000)}s</b>
          </div>
          <div className="stat-row">
            <span>Gears earned</span>
            <b className="gears-earned">⚙️ +{result.gearsEarned}</b>
          </div>
        </div>
        <button className="btn btn-primary btn-large" onClick={onPlayAgain}>
          Play Again
        </button>
        <button className="btn btn-secondary btn-large" onClick={onExit}>
          Back to Menu
        </button>
      </div>
    </div>
  );
}
