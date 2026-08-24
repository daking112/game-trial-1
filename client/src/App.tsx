import { useState } from 'react';
import './App.css';
import { ArenaScreen } from './screens/ArenaScreen';
import { GachaScreen } from './screens/GachaScreen';
import { CollectionScreen } from './screens/CollectionScreen';
import { useGameStore } from './state/store';

type Tab = 'arena' | 'gacha' | 'collection';

export default function App() {
  const [tab, setTab] = useState<Tab>('arena');
  const gears = useGameStore((s) => s.gears);

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">SNARL.IO</div>
        <nav className="tabs">
          <button className={tab === 'arena' ? 'active' : ''} onClick={() => setTab('arena')}>Arena</button>
          <button className={tab === 'gacha' ? 'active' : ''} onClick={() => setTab('gacha')}>Gacha</button>
          <button className={tab === 'collection' ? 'active' : ''} onClick={() => setTab('collection')}>Collection</button>
        </nav>
        <div className="top-currencies">
          <span><span className="stat-icon">⚙️</span>{gears}</span>
        </div>
      </header>
      <main className="app-main">
        {tab === 'arena' && <ArenaScreen />}
        {tab === 'gacha' && <GachaScreen />}
        {tab === 'collection' && <CollectionScreen />}
      </main>
    </div>
  );
}
