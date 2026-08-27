import type { Tower } from '../combat/Battle';
import { MAX_TOWER_TIER } from '../combat/Battle';

export interface TowerPanelCallbacks {
  onUpgrade(tower: Tower): void;
  onSell(tower: Tower): void;
  onClose(): void;
}

/**
 * Inspector for a selected tower.
 *
 * Anchored in the corner rather than floating at the tower's screen position:
 * a panel that tracks a world object drifts under the camera and ends up
 * covering the very thing the player is deciding about.
 */
export class TowerPanel {
  private readonly root: HTMLDivElement;
  private tower: Tower | null = null;

  constructor(host: HTMLElement, private readonly cb: TowerPanelCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'tpanel';
    this.root.hidden = true;
    host.appendChild(this.root);
    this.injectStyles();
  }

  get selected(): Tower | null {
    return this.tower;
  }

  show(tower: Tower, name: string, accent: string) {
    this.tower = tower;
    this.root.hidden = false;
    this.root.style.setProperty('--accent', accent);
    this.render(name);
  }

  hide() {
    this.tower = null;
    this.root.hidden = true;
  }

  /** Re-render affordability without rebuilding, called as gold changes. */
  refresh(gold: number) {
    if (!this.tower) return;
    const btn = this.root.querySelector<HTMLButtonElement>('[data-up]');
    if (!btn) return;
    const cost = this.tower.upgradeCost;
    btn.disabled = cost === null || gold < cost;
  }

  private render(name: string) {
    const t = this.tower!;
    const cost = t.upgradeCost;
    const pips = Array.from({ length: MAX_TOWER_TIER }, (_, i) =>
      `<span class="tpip ${i < t.tier ? 'is-on' : ''}"></span>`).join('');

    this.root.innerHTML = `
      <header class="tpanel-head">
        <span class="tpanel-name">${name}</span>
        <button class="tpanel-x" type="button" aria-label="Close">&times;</button>
      </header>
      <div class="tpanel-tier">${pips}<span class="tpanel-tierlabel">Tier ${t.tier}</span></div>
      <dl class="tpanel-stats">
        <div><dt>Damage</dt><dd>${t.stats.damage.toFixed(1)}</dd></div>
        <div><dt>Range</dt><dd>${t.stats.range.toFixed(1)}</dd></div>
        <div><dt>Rate</dt><dd>${t.stats.rate.toFixed(2)}/s</dd></div>
      </dl>
      <div class="tpanel-actions">
        <button class="tbtn tbtn-up" data-up type="button">
          ${cost === null ? 'Max Tier' : `Upgrade <b>${cost}</b>`}
        </button>
        <button class="tbtn tbtn-sell" data-sell type="button">Sell <b>${t.sellValue}</b></button>
      </div>
    `;

    this.root.querySelector('[data-up]')?.addEventListener('click', () => {
      if (this.tower) this.cb.onUpgrade(this.tower);
    });
    this.root.querySelector('[data-sell]')?.addEventListener('click', () => {
      if (this.tower) this.cb.onSell(this.tower);
    });
    this.root.querySelector('.tpanel-x')?.addEventListener('click', () => this.cb.onClose());
  }

  /** Rebuild after an upgrade so the numbers reflect the new tier. */
  rerender(name: string) {
    if (this.tower) this.render(name);
  }

  dispose() {
    this.root.remove();
  }

  private injectStyles() {
    if (document.getElementById('tpanel-styles')) return;
    const st = document.createElement('style');
    st.id = 'tpanel-styles';
    st.textContent = `
      .tpanel[hidden] { display: none; }
      .tpanel {
        --accent: #7ad0a8;
        position: absolute; right: 14px; top: 68px; width: 214px;
        pointer-events: auto; padding: 12px; border-radius: 15px;
        font-family: ui-rounded, "Nunito", system-ui, sans-serif; color: #fff;
        background: linear-gradient(180deg, rgba(26,36,48,.96), rgba(13,19,27,.96));
        border: 1px solid rgba(255,255,255,.14); border-top: 3px solid var(--accent);
        box-shadow: 0 12px 30px rgba(0,0,0,.5);
      }
      .tpanel-head { display: flex; align-items: center; gap: 8px; }
      .tpanel-name { font-weight: 900; font-size: 15px; flex: 1; }
      .tpanel-x {
        background: rgba(255,255,255,.1); border: none; color: #fff; cursor: pointer;
        width: 24px; height: 24px; border-radius: 7px; font-size: 16px; line-height: 1;
      }
      .tpanel-tier { display: flex; align-items: center; gap: 4px; margin: 9px 0 10px; }
      .tpip {
        width: 20px; height: 6px; border-radius: 99px; background: rgba(255,255,255,.15);
      }
      .tpip.is-on { background: var(--accent); }
      .tpanel-tierlabel { font-size: 11px; opacity: .6; margin-left: 5px; }
      .tpanel-stats { display: grid; gap: 4px; margin-bottom: 11px; }
      .tpanel-stats > div { display: flex; justify-content: space-between; font-size: 12.5px; }
      .tpanel-stats dt { opacity: .6; }
      .tpanel-stats dd { font-weight: 800; font-variant-numeric: tabular-nums; }
      .tpanel-actions { display: grid; gap: 6px; }
      .tbtn {
        font: inherit; font-weight: 800; font-size: 13px; cursor: pointer; color: #08131a;
        padding: 9px; border-radius: 10px; border: none;
        background: linear-gradient(180deg, #a8f0c8, #56c894);
        box-shadow: 0 4px 0 #2f8a63;
        transition: transform .1s ease, box-shadow .1s ease, filter .14s ease;
      }
      .tbtn:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 #2f8a63; }
      .tbtn:disabled { filter: grayscale(.75) brightness(.7); cursor: default; }
      .tbtn-sell {
        background: linear-gradient(180deg, #f0c0a8, #c8896b);
        box-shadow: 0 4px 0 #8a5a44;
      }
      @media (max-width: 760px) {
        .tpanel { right: 10px; top: 58px; width: 176px; padding: 10px; }
        .tpanel-name { font-size: 13.5px; }
      }
    `;
    document.head.appendChild(st);
  }
}
