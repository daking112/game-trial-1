import { useState } from 'react';
import './App.css';
import { PlayScreen } from './screens/PlayScreen';
import { CollectionScreen } from './screens/CollectionScreen';
import { CodexScreen } from './screens/CodexScreen';
import { useGameStore } from './state/store';

type Tab = 'play' | 'collection' | 'codex';

export default function App() {
  const [tab, setTab] = useState<Tab>('play');
  const gold = useGameStore((s) => s.gold);
  const crystals = useGameStore((s) => s.crystals);

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">MONSTERFALL</div>
        <nav className="tabs">
          <button className={tab === 'play' ? 'active' : ''} onClick={() => setTab('play')}>Play</button>
          <button className={tab === 'collection' ? 'active' : ''} onClick={() => setTab('collection')}>Collection</button>
          <button className={tab === 'codex' ? 'active' : ''} onClick={() => setTab('codex')}>Codex</button>
        </nav>
        <div className="top-currencies">
          <span><span className="stat-icon">⚙️</span>{gold}</span>
          <span><span className="stat-icon">💎</span>{crystals}</span>
        </div>
      </header>
      <main className="app-main">
        {tab === 'play' && <PlayScreen />}
        {tab === 'collection' && <CollectionScreen />}
        {tab === 'codex' && <CodexScreen />}
      </main>
    </div>
  );
}
