export interface EndScreenStats {
  wavesCleared: number;
  totalWaves: number;
  livesLeft: number;
  goldEarned: number;
  caught: number;
  totalSpecies: number;
  bestCreature?: { name: string; kills: number; level: number };
}

/**
 * Victory / defeat screen.
 *
 * Shown on a delay rather than the instant the last life drops: cutting
 * straight from a hit to a modal steals the moment the player needs to see
 * what actually killed them.
 */
export class EndScreen {
  private readonly root: HTMLDivElement;
  private pending = 0;
  private queued: { won: boolean; stats: EndScreenStats } | null = null;

  constructor(host: HTMLElement, private readonly onRestart: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'endscreen';
    this.root.hidden = true;
    host.appendChild(this.root);
    this.injectStyles();
  }

  /** Queue the screen; it appears after `delay` seconds of play. */
  show(won: boolean, stats: EndScreenStats, delay = 1.6) {
    this.queued = { won, stats };
    this.pending = delay;
  }

  hide() {
    this.root.hidden = true;
    this.queued = null;
    this.pending = 0;
  }

  update(dt: number) {
    if (this.pending <= 0 || !this.queued) return;
    this.pending -= dt;
    if (this.pending > 0) return;
    this.render(this.queued.won, this.queued.stats);
    this.queued = null;
  }

  private render(won: boolean, s: EndScreenStats) {
    this.root.hidden = false;
    this.root.dataset.tone = won ? 'win' : 'loss';
    this.root.innerHTML = `
      <div class="es-card">
        <div class="es-crest">${won ? '&#9733;' : '&#9760;'}</div>
        <h2 class="es-title">${won ? 'Gearwood Holds' : 'The Thicket Falls'}</h2>
        <p class="es-sub">${won
          ? 'Every wave turned back. The canopy is quiet again.'
          : `Overrun at wave ${s.wavesCleared + 1}. The lanterns go dark.`}</p>
        <dl class="es-stats">
          <div><dt>Waves cleared</dt><dd>${s.wavesCleared} / ${s.totalWaves}</dd></div>
          <div><dt>Lives remaining</dt><dd>${s.livesLeft}</dd></div>
          <div><dt>Scrap earned</dt><dd>${s.goldEarned}</dd></div>
          <div><dt>Codex</dt><dd>${s.caught} / ${s.totalSpecies}</dd></div>
          ${s.bestCreature ? `<div><dt>Top creature</dt><dd>${s.bestCreature.name} &middot; Lv.${s.bestCreature.level} &middot; ${s.bestCreature.kills} defeated</dd></div>` : ''}
        </dl>
        <button class="es-btn" type="button">Play Again</button>
        <p class="es-note">Creature levels carry over to your next run.</p>
      </div>
    `;
    this.root.querySelector('.es-btn')?.addEventListener('click', () => this.onRestart());
  }

  dispose() {
    this.root.remove();
  }

  private injectStyles() {
    if (document.getElementById('endscreen-styles')) return;
    const st = document.createElement('style');
    st.id = 'endscreen-styles';
    st.textContent = `
      .endscreen[hidden] { display: none; }
      .endscreen {
        position: absolute; inset: 0; z-index: 30; pointer-events: auto;
        display: grid; place-items: center;
        background: rgba(4,8,14,.72); backdrop-filter: blur(9px);
        font-family: ui-rounded, "Nunito", system-ui, sans-serif; color: #fff;
        animation: es-fade .4s ease both;
      }
      @keyframes es-fade { from { opacity: 0 } to { opacity: 1 } }
      .es-card {
        width: min(430px, 90vw); padding: 28px; text-align: center;
        background: linear-gradient(180deg, rgba(26,36,48,.98), rgba(13,19,27,.98));
        border: 1px solid rgba(255,255,255,.16); border-radius: 22px;
        box-shadow: 0 30px 80px rgba(0,0,0,.7);
        animation: es-pop .42s cubic-bezier(.2,1.3,.4,1) both;
      }
      @keyframes es-pop { from { transform: translateY(16px) scale(.94) } to { transform: none } }
      .es-crest { font-size: 42px; line-height: 1; margin-bottom: 6px; }
      .endscreen[data-tone="win"]  .es-crest { color: #ffd35c; }
      .endscreen[data-tone="loss"] .es-crest { color: #ff8a8a; }
      .es-title { font-size: 27px; font-weight: 900; letter-spacing: .3px; }
      .es-sub { font-size: 13.5px; opacity: .68; margin: 7px 0 18px; line-height: 1.5; }
      .es-stats {
        display: grid; gap: 7px; text-align: left; margin-bottom: 20px;
        background: rgba(255,255,255,.045); padding: 13px 15px; border-radius: 13px;
      }
      .es-stats > div { display: flex; justify-content: space-between; gap: 14px; font-size: 13px; }
      .es-stats dt { opacity: .6; }
      .es-stats dd { font-weight: 800; text-align: right; }
      .es-btn {
        font: inherit; font-weight: 900; font-size: 16px; cursor: pointer; color: #08131a;
        padding: 14px 30px; border-radius: 14px; border: none; width: 100%;
        background: linear-gradient(180deg, #a8f0c8, #56c894);
        box-shadow: 0 6px 0 #2f8a63, 0 12px 24px rgba(0,0,0,.45);
        transition: transform .1s ease, box-shadow .1s ease;
      }
      .es-btn:active { transform: translateY(4px); box-shadow: 0 2px 0 #2f8a63; }
      .es-note { font-size: 11.5px; opacity: .5; margin-top: 11px; }
    `;
    document.head.appendChild(st);
  }
}
