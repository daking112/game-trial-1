import { SPECIES, type Rarity } from '../creatures/species';

const RARITY_ORDER: Rarity[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
import { Gacha, SUMMON_COST, MULTI_COST, publishedOdds, type SummonResult } from '../meta/Gacha';
import { buildPortraits, creaturePortrait } from './StarPanel';

export interface SummonCallbacks {
  /** Species the player already owns, for duplicate handling. */
  owned(): Set<string>;
  onNewSpecies(speciesId: string): void;
  onClose(): void;
  /** Opens the star-up screen, where the duplicate shards are spent. */
  onOpenStars?(): void;
  /** Species with enough shards banked for their next star, for the badge. */
  starsReady?(): number;
}

const RARITY_COLOR: Record<Rarity, string> = {
  Common: '#9fb0c0',
  Uncommon: '#6fd08c',
  Rare: '#57b4f0',
  Epic: '#c48cff',
  Legendary: '#ffcf5c',
};

/**
 * Summoning screen.
 *
 * Results are revealed one at a time on a short cadence rather than dumped as
 * a grid. The reveal is the entire point of a gacha -- showing ten cards at
 * once turns the best moment in the loop into a spreadsheet.
 */
export class SummonPanel {
  private readonly root: HTMLDivElement;
  private open = false;
  private revealing: SummonResult[] = [];
  private revealTimer = 0;
  private revealIndex = 0;

  constructor(host: HTMLElement, private readonly gacha: Gacha, private readonly cb: SummonCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'summon';
    this.root.hidden = true;
    host.appendChild(this.root);
    this.injectStyles();
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.open) this.toggle();
    else if ((e.key === 's' || e.key === 'S') && !this.revealing.length) this.toggle();
  };

  get isOpen() { return this.open; }

  toggle() {
    this.open = !this.open;
    this.root.hidden = !this.open;
    if (this.open) this.render();
    else { this.revealing = []; this.revealIndex = 0; }
  }

  private doSummon(count: 1 | 10) {
    const results = this.gacha.summon(count, this.cb.owned());
    if (!results) return;
    for (const r of results) if (r.isNew) this.cb.onNewSpecies(r.speciesId);
    this.revealing = results;
    this.revealIndex = 0;
    this.revealTimer = 0;
    this.render();
  }

  update(dt: number) {
    if (!this.open || this.revealIndex >= this.revealing.length) return;
    this.revealTimer -= dt;
    if (this.revealTimer <= 0) {
      this.revealIndex++;
      // Faster for a ten-pull; a full second each would be a 10s wait.
      this.revealTimer = this.revealing.length > 1 ? 0.24 : 0.5;
      this.renderResults();
    }
  }

  private render() {
    const odds = publishedOdds();
    const pity = this.gacha.pityCountdown();
    // Duplicates are most of what a summon produces, so the way out of a pile
    // of them belongs on this screen rather than behind a keyboard shortcut.
    const ready = this.cb.starsReady?.() ?? 0;

    this.root.innerHTML = `
      <div class="sm-sheet">
        <header class="sm-head">
          <h2>Summoning Circle</h2>
          <span class="sm-cogs">&#9881; <b>${this.gacha.cogs}</b></span>
          <button class="sm-x" type="button" aria-label="Close">&times;</button>
        </header>

        <div class="sm-stage" data-stage></div>

        <div class="sm-actions">
          <button class="sm-btn sm-btn-multi" data-ten type="button" ${this.gacha.canAfford(10) ? '' : 'disabled'}>
            <span class="sm-btn-label">Summon &times;10</span>
            <span class="sm-btn-cost">&#9881; ${MULTI_COST.toLocaleString()}</span>
          </button>
          <button class="sm-btn sm-btn-single" data-one type="button" ${this.gacha.canAfford(1) ? '' : 'disabled'}>
            <span class="sm-btn-label">Summon &times;1</span>
            <span class="sm-btn-cost">&#9881; ${SUMMON_COST}</span>
          </button>
        </div>

        ${this.cb.onOpenStars ? `
          <button class="sm-stars" data-stars type="button">
            Star Ranks${ready > 0 ? ` <span class="sm-badge">${ready} ready</span>` : ''}
          </button>
        ` : ''}

        <div class="sm-odds">
          <span class="sm-odds-label">Base rates</span>
          ${odds.map((o) => `<span class="sm-odd" style="--c:${RARITY_COLOR[o.rarity]}">${o.rarity} ${o.percent}%</span>`).join('')}
        </div>
        <p class="sm-note">
          A ten-summon always contains at least one Rare${
            pity.rare !== null && pity.rare < 10
              ? `, and a Rare or better is guaranteed within <b>${pity.rare}</b> single summons`
              : ''
          }. Pity raises these rates; it never lowers them.
          Cogs are earned by playing and cannot be purchased.
        </p>
      </div>
    `;
    this.root.querySelector('.sm-x')?.addEventListener('click', () => this.cb.onClose());
    this.root.querySelector('[data-one]')?.addEventListener('click', () => this.doSummon(1));
    this.root.querySelector('[data-ten]')?.addEventListener('click', () => this.doSummon(10));
    this.root.querySelector('[data-stars]')?.addEventListener('click', () => this.cb.onOpenStars?.());
    this.renderResults();
  }

  private renderResults() {
    const stage = this.root.querySelector('[data-stage]');
    if (!stage) return;

    if (!this.revealing.length) {
      stage.innerHTML = `<p class="sm-empty">Summon a creature to add it to your roster.</p>`;
      return;
    }

    const shown = this.revealing.slice(0, this.revealIndex);
    // The reveal is the best moment in the loop, so it shows the actual
    // creature rather than a coloured ball standing in for one.
    buildPortraits(shown.map((r) => r.speciesId));

    // Duplicates stack instead of tiling. Six identical commons drawn six
    // times made the least interesting fact in the pull the loudest thing on
    // the screen, and pushed the rare -- the reason anyone pressed the button
    // -- to the same visual weight as the sixth copy of a starter.
    const stacks: Array<{ r: SummonResult; count: number; shards: number; isNew: boolean }> = [];
    const byId = new Map<string, number>();
    for (const r of shown) {
      const at = byId.get(r.speciesId);
      if (at === undefined) {
        byId.set(r.speciesId, stacks.length);
        stacks.push({ r, count: 1, shards: r.shards, isNew: r.isNew });
      } else {
        const st = stacks[at];
        st.count++;
        st.shards += r.shards;
        st.isNew = st.isNew || r.isNew;
      }
    }

    stage.innerHTML = `<div class="sm-grid">${stacks.map((st) => {
      const sp = SPECIES[st.r.speciesId];
      const portrait = creaturePortrait(st.r.speciesId);
      // Rarity buys presentation, not just a border colour. A Rare takes two
      // columns and a lit frame so the eye lands on it first.
      const big = RARITY_ORDER.indexOf(st.r.rarity) >= RARITY_ORDER.indexOf('Rare');
      return `
        <div class="sm-card ${st.isNew ? 'is-new' : ''} ${big ? 'is-big' : ''}"
             style="--c:${RARITY_COLOR[st.r.rarity]};--a:${sp.palette.primary};--b:${sp.palette.secondary}">
          <span class="sm-orb">${portrait ? `<img src="${portrait}" alt="" draggable="false">` : ''}</span>
          <span class="sm-name">${sp.name}${st.count > 1 ? `<b class="sm-mult">&times;${st.count}</b>` : ''}</span>
          <span class="sm-rarity">${st.r.rarity}</span>
          ${st.isNew ? '<span class="sm-tag">NEW</span>' : ''}
          ${st.shards > 0 ? `<span class="sm-dupe"><i class="sm-shard"></i>${st.shards}</span>` : ''}
        </div>`;
    }).join('')}</div>`;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private injectStyles() {
    if (document.getElementById('summon-styles')) return;
    const st = document.createElement('style');
    st.id = 'summon-styles';
    st.textContent = `
      .summon[hidden] { display: none; }
      .summon {
        position: absolute; inset: 0; z-index: 25; pointer-events: auto;
        background: rgba(3,6,11,.82); backdrop-filter: blur(15px);
        display: grid; place-items: center;
        font-family: ui-rounded, "Nunito", system-ui, sans-serif; color: #fff;
      }
      .sm-sheet {
        width: min(680px, 93vw); max-height: 88vh; overflow-y: auto; padding: 20px;
        background: linear-gradient(180deg, rgba(26,36,48,.98), rgba(13,19,27,.98));
        border: 1px solid rgba(255,255,255,.16); border-radius: 20px;
        box-shadow: 0 28px 72px rgba(0,0,0,.66);
      }
      .sm-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
      .sm-head h2 { font-size: 20px; font-weight: 900; flex: 1; }
      .sm-cogs {
        background: rgba(255,211,92,.14); color: #ffd35c; font-weight: 800;
        padding: 5px 13px; border-radius: 999px; font-size: 14px;
      }
      .sm-x {
        background: rgba(255,255,255,.1); border: none; color: #fff; cursor: pointer;
        width: 30px; height: 30px; border-radius: 9px; font-size: 19px; line-height: 1;
      }
      /* One inset for the whole sheet: the grid and the buttons used to start
         at different x, 42px apart inside a 660px dialog. */
      .sm-stage { min-height: 150px; display: grid; place-items: center; margin-bottom: 16px; }
      .sm-empty { opacity: .5; font-size: 13.5px; }
      .sm-grid {
        display: grid; grid-template-columns: repeat(5, 1fr); gap: 9px; width: 100%;
      }
      .sm-card {
        --c: #9fb0c0; --a: #7ad0a8;
        position: relative; padding: 11px 8px 9px; border-radius: 13px;
        display: grid; gap: 3px; justify-items: center; text-align: center;
        align-content: start;
        background: rgba(255,255,255,.05);
        border: 1px solid var(--c); box-shadow: 0 0 16px -6px var(--c);
        animation: sm-pop .34s cubic-bezier(.2,1.4,.4,1) both;
      }
      /* Rarity buys size and light, not only a border colour. */
      .sm-card.is-big {
        grid-column: span 2;
        border-width: 2px;
        background:
          radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--c) 30%, transparent), transparent 70%),
          rgba(255,255,255,.06);
        box-shadow: 0 0 30px -6px var(--c), inset 0 0 22px -12px var(--c);
      }
      .sm-card.is-big .sm-orb { width: 76px; height: 76px; }
      .sm-card.is-big .sm-name { font-size: 14.5px; }
      @keyframes sm-pop {
        from { transform: scale(.7) translateY(10px); opacity: 0 }
        to   { transform: none; opacity: 1 }
      }
      .sm-card.is-new { box-shadow: 0 0 22px -4px var(--c); }
      .sm-orb {
        width: 58px; height: 58px; border-radius: 13px; overflow: hidden;
        display: grid; place-items: center;
        background:
          radial-gradient(circle at 50% 34%, color-mix(in srgb, var(--c) 40%, transparent), transparent 68%),
          linear-gradient(180deg, rgba(255,255,255,.08), rgba(0,0,0,.26));
        box-shadow: inset 0 0 12px rgba(0,0,0,.4);
      }
      .sm-orb img { width: 100%; height: 100%; object-fit: contain; }
      .sm-name { font-size: 12.5px; font-weight: 800; }
      .sm-mult { color: #ffd35c; margin-left: 3px; }
      .sm-rarity { font-size: 9.5px; letter-spacing: 1.1px; text-transform: uppercase; color: var(--c); font-weight: 800; }
      /* NEW is the least valuable fact in a pull, so it stops competing with
         the rarest card for the one colour that should mean "rare". */
      .sm-tag {
        position: absolute; top: -6px; right: -4px; background: #7fd8ff; color: #06131c;
        font-size: 9px; font-weight: 900; padding: 2px 6px; border-radius: 999px;
      }
      .sm-shard {
        display: inline-block; width: 7px; height: 7px; margin-right: 4px;
        background: linear-gradient(160deg, #bfe6ff, #4aa8e8);
        transform: rotate(45deg); border-radius: 2px;
      }
      .sm-dupe { font-size: 10.5px; color: #a9dcff; font-weight: 700; display: flex; align-items: center; }
      .sm-actions { display: flex; gap: 10px; margin-bottom: 10px; }
      .sm-btn {
        font: inherit; cursor: pointer; color: #08131a;
        display: grid; gap: 1px; justify-items: center;
        padding: 11px; border-radius: 13px; border: 2px solid rgba(0,0,0,.28);
        background: linear-gradient(180deg, #ffe6a8, #f0b95c);
        box-shadow: 0 6px 0 #a8763a, inset 0 1px 0 rgba(255,255,255,.65);
        transition: transform .1s ease, box-shadow .1s ease, filter .14s ease;
      }
      .sm-btn-label { font-size: 16px; font-weight: 900; letter-spacing: .3px; }
      .sm-btn-cost { font-size: 11.5px; font-weight: 800; opacity: .8; }
      .sm-btn:active:not(:disabled) { transform: translateY(5px); box-shadow: 0 1px 0 #a8763a; }
      .sm-btn:disabled { filter: grayscale(.75) brightness(.7); cursor: default; }
      /* The ten-pull is the primary action and now looks like it: the single
         summon is demoted to an outline rather than competing at full fill. */
      .sm-btn-multi { flex: 3; }
      .sm-btn-single {
        flex: 2; color: #cfe3f5;
        background: rgba(255,255,255,.07);
        border-color: rgba(255,255,255,.22);
        box-shadow: 0 5px 0 rgba(0,0,0,.34);
      }
      .sm-btn-single:active:not(:disabled) { box-shadow: 0 1px 0 rgba(0,0,0,.34); }
      .sm-stars {
        position: relative; width: 100%; font: inherit; font-weight: 800; font-size: 13px;
        cursor: pointer; color: #ffd35c; padding: 10px; margin-bottom: 14px;
        background: rgba(255,211,92,.1); border: 1px solid rgba(255,211,92,.34);
        border-radius: 12px;
      }
      .sm-stars:hover { background: rgba(255,211,92,.17); }
      .sm-badge {
        background: #ffd35c; color: #1a1206; font-size: 10px; font-weight: 900;
        padding: 2px 8px; border-radius: 999px; margin-left: 6px;
      }
      .sm-odds { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; margin-bottom: 9px; }
      .sm-odds-label { font-size: 10.5px; letter-spacing: 1.1px; text-transform: uppercase; opacity: .5; }
      .sm-odd {
        font-size: 11px; font-weight: 700; color: var(--c);
        background: rgba(255,255,255,.06); padding: 3px 9px; border-radius: 999px;
      }
      .sm-note { font-size: 11.5px; opacity: .58; line-height: 1.5; }
      @media (max-width: 760px) {
        .sm-sheet { padding: 14px; }
        .sm-grid { grid-template-columns: repeat(3, 1fr); }
        .sm-card.is-big { grid-column: span 3; }
        .sm-rarity { font-size: 11px; }
        .sm-dupe { font-size: 11px; }
        .sm-actions { flex-direction: column; }
      }
    `;
    document.head.appendChild(st);
  }
}
