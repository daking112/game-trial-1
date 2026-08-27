import { levelState, MAX_LEVEL, type Collection } from '../meta/Progression';

export interface PanelSpecies {
  id: string;
  name: string;
  element: string;
  accent: string;
  flavour: string;
}

/**
 * Collection panel — the codex half of the game.
 *
 * Rebuilt from state each time it opens rather than kept live: it is only
 * visible when the player asks for it, and a full rebuild of a dozen cards is
 * far cheaper than keeping per-card bindings in sync every frame.
 */
export class CollectionPanel {
  private readonly root: HTMLDivElement;
  private open = false;

  constructor(
    host: HTMLElement,
    private readonly species: PanelSpecies[],
    private readonly collection: Collection,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'codex';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Creature collection');
    this.root.hidden = true;
    host.appendChild(this.root);
    this.injectStyles();

    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'c' || e.key === 'C') this.toggle();
    else if (e.key === 'Escape' && this.open) this.toggle();
  };

  toggle() {
    this.open = !this.open;
    this.root.hidden = !this.open;
    if (this.open) this.render();
  }

  get isOpen() { return this.open; }

  private render() {
    const caught = this.collection.caughtCount;
    const total = this.species.length;

    const cards = this.species.map((s) => {
      const e = this.collection.get(s.id);
      const known = e?.caught ?? false;
      const ls = levelState(e?.xp ?? 0);
      const pct = ls.toNext > 0 ? Math.round((ls.xp / ls.toNext) * 100) : 100;

      // Unseen species are shown as silhouettes; revealing everything up front
      // removes the only reason to keep playing a codex.
      return `
        <li class="codex-card ${known ? '' : 'is-locked'}" style="--accent:${s.accent}">
          <div class="codex-orb"></div>
          <div class="codex-body">
            <div class="codex-name">${known ? s.name : '???'}</div>
            <div class="codex-el">${known ? s.element : 'Undiscovered'}</div>
            ${known ? `
              <div class="codex-lv">Lv.<b>${ls.level}</b>${ls.level >= MAX_LEVEL ? ' <span class="codex-max">MAX</span>' : ''}</div>
              <div class="codex-bar"><span style="width:${pct}%"></span></div>
              <div class="codex-kills">${e?.kills ?? 0} defeated</div>
              <p class="codex-flavour">${s.flavour}</p>
            ` : '<p class="codex-flavour">Place this creature in battle to record it.</p>'}
          </div>
        </li>`;
    }).join('');

    this.root.innerHTML = `
      <div class="codex-sheet">
        <header class="codex-head">
          <h2>Field Codex</h2>
          <span class="codex-count">${caught} / ${total} recorded</span>
          <button class="codex-close" type="button" aria-label="Close">&times;</button>
        </header>
        <ul class="codex-grid">${cards}</ul>
        <footer class="codex-foot">Press <kbd>C</kbd> to close</footer>
      </div>
    `;
    this.root.querySelector('.codex-close')?.addEventListener('click', () => this.toggle());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.toggle();
    }, { once: true });
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private injectStyles() {
    if (document.getElementById('codex-styles')) return;
    const st = document.createElement('style');
    st.id = 'codex-styles';
    st.textContent = `
      /* Must come first: a display value in .codex would otherwise override
         the browser default [hidden] { display: none } and pin the panel open. */
      .codex[hidden] { display: none; }
      .codex {
        position: absolute; inset: 0; z-index: 20; pointer-events: auto;
        background: rgba(4,8,14,.68); backdrop-filter: blur(7px);
        display: grid; place-items: center;
        font-family: ui-rounded, "Nunito", system-ui, sans-serif; color: #fff;
      }
      .codex-sheet {
        width: min(920px, 92vw); max-height: 86vh; display: flex; flex-direction: column;
        background: linear-gradient(180deg, rgba(24,33,45,.98), rgba(13,19,27,.98));
        border: 1px solid rgba(255,255,255,.15); border-radius: 20px;
        box-shadow: 0 26px 70px rgba(0,0,0,.65);
      }
      .codex-head {
        display: flex; align-items: center; gap: 14px; padding: 18px 22px;
        border-bottom: 1px solid rgba(255,255,255,.1);
      }
      .codex-head h2 { font-size: 21px; font-weight: 900; letter-spacing: .3px; }
      .codex-count { font-size: 13px; opacity: .66; margin-right: auto; }
      .codex-close {
        background: rgba(255,255,255,.1); border: none; color: #fff; cursor: pointer;
        width: 34px; height: 34px; border-radius: 10px; font-size: 21px; line-height: 1;
      }
      .codex-close:hover { background: rgba(255,255,255,.2); }
      .codex-grid {
        list-style: none; display: grid; gap: 12px; padding: 18px;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        overflow-y: auto;
      }
      .codex-card {
        --accent: #7ad0a8;
        display: flex; gap: 12px; padding: 13px; border-radius: 14px;
        background: rgba(255,255,255,.045);
        border: 1px solid rgba(255,255,255,.09);
        border-left: 3px solid var(--accent);
      }
      .codex-card.is-locked { opacity: .5; border-left-color: rgba(255,255,255,.2); }
      .codex-card.is-locked .codex-orb { background: rgba(255,255,255,.16); filter: grayscale(1); }
      .codex-orb {
        flex: 0 0 auto; width: 50px; height: 50px; border-radius: 50%;
        background: radial-gradient(circle at 34% 30%, #fff7, transparent 58%), var(--accent);
        box-shadow: inset 0 -5px 9px rgba(0,0,0,.34);
      }
      .codex-body { min-width: 0; flex: 1; }
      .codex-name { font-weight: 900; font-size: 15px; }
      .codex-el { font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; opacity: .58; }
      .codex-lv { font-size: 12.5px; margin-top: 5px; }
      .codex-max { color: #ffd35c; font-size: 10px; font-weight: 900; }
      .codex-bar {
        height: 5px; border-radius: 99px; background: rgba(255,255,255,.13);
        margin: 5px 0 4px; overflow: hidden;
      }
      .codex-bar span { display: block; height: 100%; background: var(--accent); border-radius: 99px; }
      .codex-kills { font-size: 11px; opacity: .55; }
      .codex-flavour { font-size: 11.5px; opacity: .72; margin-top: 6px; line-height: 1.42; }
      .codex-foot { padding: 12px 22px; border-top: 1px solid rgba(255,255,255,.1); font-size: 12px; opacity: .55; }
      .codex kbd {
        background: rgba(255,255,255,.14); border-radius: 5px; padding: 1px 6px; font-size: 11px;
      }
    `;
    document.head.appendChild(st);
  }
}
