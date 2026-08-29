import { SPECIES, type Rarity } from '../creatures/species';
import type { Gacha } from '../meta/Gacha';
import { MAX_STARS, starCost, starMultipliers, type Stars } from '../meta/StarUp';

export interface StarCallbacks {
  /** Species the player actually owns; only these can be starred up. */
  owned(): Set<string>;
  onUpgrade(speciesId: string, newRank: number): void;
  onClose(): void;
}

const RARITY_COLOR: Record<Rarity, string> = {
  Common: '#9fb0c0',
  Uncommon: '#6fd08c',
  Rare: '#57b4f0',
  Epic: '#c48cff',
  Legendary: '#ffcf5c',
};

/**
 * Star-up screen — where duplicate shards are spent.
 *
 * Without this the gacha's most common outcome is a dead end: two thirds of
 * pulls are duplicates, and a duplicate that buys nothing turns the bulk of
 * the loop into a loss. Stars are the sink, so this screen's real job is to
 * make the shards a player already holds legible, and to make the next star
 * feel like a short walk rather than an unmarked distance.
 *
 * Hence a bar per species rather than a bare number: "142 / 178" is a number
 * you have to do arithmetic on, a bar is a distance you can see. And the stat
 * gain is shown as the actual before-and-after figures, because "+12% damage"
 * is a claim about a number the player cannot see, while "4.0 -> 4.5" is the
 * number itself.
 */
export class StarPanel {
  private readonly root: HTMLDivElement;
  private open = false;

  constructor(
    host: HTMLElement,
    private readonly gacha: Gacha,
    private readonly stars: Stars,
    private readonly cb: StarCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'starp';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Star ranks');
    this.root.hidden = true;
    host.appendChild(this.root);
    this.injectStyles();
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.open) this.toggle();
    else if (e.key === 'v' || e.key === 'V') this.toggle();
  };

  get isOpen() { return this.open; }

  toggle() {
    this.open = !this.open;
    this.root.hidden = !this.open;
    if (this.open) this.render();
  }

  /** Re-render in place, for when shards change while the screen is open. */
  refresh() {
    if (this.open) this.render();
  }

  private doUpgrade(speciesId: string) {
    const rank = this.stars.upgrade(speciesId, this.gacha);
    if (rank === null) return;
    this.cb.onUpgrade(speciesId, rank);
    this.render();
  }

  private render() {
    const owned = this.cb.owned();
    // Owned first, then by how close the next star is: the useful ordering is
    // "what can I do right now", not alphabetical.
    // Only species that can actually be summoned appear here. An evolved form
    // is never in the pool, so it can never earn a shard of its own -- listing
    // it would offer the player a bar that can never fill. Its star rank comes
    // from the form it evolved from, which is stated on that form's card.
    const rows = Object.values(SPECIES)
      .filter((sp) => !sp.evolvesFrom)
      .map((sp) => {
        const rank = this.stars.get(sp.id);
        const cost = starCost(sp.id, rank);
        const have = this.gacha.shardsFor(sp.id);
        return { sp, rank, cost, have, isOwned: owned.has(sp.id) };
      })
      .sort((a, b) => {
        if (a.isOwned !== b.isOwned) return a.isOwned ? -1 : 1;
        const pa = a.cost === null ? 2 : a.have / a.cost;
        const pb = b.cost === null ? 2 : b.have / b.cost;
        return pb - pa;
      });

    const ready = rows.filter((r) => r.isOwned && r.cost !== null && r.have >= r.cost).length;

    this.root.innerHTML = `
      <div class="st-sheet">
        <header class="st-head">
          <h2>Star Ranks</h2>
          ${ready > 0 ? `<span class="st-ready">${ready} ready</span>` : ''}
          <button class="st-x" type="button" aria-label="Close">&times;</button>
        </header>

        <ul class="st-list">
          ${rows.map((r) => this.card(r)).join('')}
        </ul>

        <p class="st-note">
          Duplicate summons become shards for that creature; shards buy stars.
          Stars are permanent and stack with levels, so a starter you have
          played all game keeps pace with a fresh pull. Every creature reaches
          five stars in about the same number of summons, whatever its rarity.
        </p>
      </div>
    `;

    this.root.querySelector('.st-x')?.addEventListener('click', () => this.cb.onClose());
    for (const btn of Array.from(this.root.querySelectorAll('[data-up]'))) {
      btn.addEventListener('click', () => this.doUpgrade((btn as HTMLElement).dataset.up!));
    }
  }

  private card(r: {
    sp: (typeof SPECIES)[string];
    rank: number;
    cost: number | null;
    have: number;
    isOwned: boolean;
  }): string {
    const { sp, rank, cost, have, isOwned } = r;
    const colour = RARITY_COLOR[sp.rarity];
    // Named only once the player owns the base form; an undiscovered line
    // stays undiscovered, the same way the codex hides it.
    const evolved = sp.evolvesTo ? SPECIES[sp.evolvesTo] : undefined;
    const evolvesInto = evolved ? evolved.name : '';
    const maxed = cost === null;
    const affordable = !maxed && have >= cost!;
    const pct = maxed ? 100 : Math.min(100, Math.round((have / cost!) * 100));

    const pips = Array.from({ length: MAX_STARS }, (_, i) =>
      `<span class="st-pip ${i < rank ? 'is-on' : ''}">&#9733;</span>`).join('');

    const now = starMultipliers(rank);
    const next = starMultipliers(Math.min(rank + 1, MAX_STARS));
    const delta = (a: number, b: number) =>
      `<span class="st-now">${a.toFixed(2)}&times;</span>` +
      (maxed ? '' : `<span class="st-arrow">&rsaquo;</span><span class="st-next">${b.toFixed(2)}&times;</span>`);

    return `
      <li class="st-card ${isOwned ? '' : 'is-locked'} ${affordable ? 'is-ready' : ''}"
          style="--c:${colour};--a:${sp.palette.primary};--b:${sp.palette.secondary}">
        <span class="st-orb"></span>
        <div class="st-main">
          <div class="st-top">
            <span class="st-name">${isOwned ? sp.name : '???'}</span>
            <span class="st-rarity">${isOwned ? sp.rarity : 'Undiscovered'}</span>
            <span class="st-pips">${pips}</span>
          </div>

          ${isOwned ? `
            <div class="st-stats">
              <span>DMG ${delta(now.damage, next.damage)}</span>
              <span>RNG ${delta(now.range, next.range)}</span>
              <span>SPD ${delta(now.rate, next.rate)}</span>
            </div>
            <div class="st-barwrap">
              <div class="st-bar"><i style="width:${pct}%"></i></div>
              <span class="st-count">${maxed ? 'Max rank' : `${have} / ${cost} shards`}</span>
            </div>
          ` : `
            <div class="st-locked-note">Summon this creature to start collecting its shards.</div>
          `}
          ${isOwned && evolvesInto ? `
            <div class="st-line">Also powers <b>${evolvesInto}</b></div>
          ` : ''}
        </div>

        ${isOwned && !maxed ? `
          <button class="st-btn" type="button" data-up="${sp.id}" ${affordable ? '' : 'disabled'}>
            ${affordable ? 'Star Up' : `${cost! - have} more`}
          </button>
        ` : isOwned ? '<span class="st-max">MAX</span>' : ''}
      </li>
    `;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private injectStyles() {
    if (document.getElementById('starp-styles')) return;
    const st = document.createElement('style');
    st.id = 'starp-styles';
    st.textContent = `
      .starp[hidden] { display: none; }
      .starp {
        position: absolute; inset: 0; z-index: 26; pointer-events: auto;
        background: rgba(4,8,14,.72); backdrop-filter: blur(8px);
        display: grid; place-items: center;
        font-family: ui-rounded, "Nunito", system-ui, sans-serif; color: #fff;
      }
      .st-sheet {
        width: min(680px, 93vw); max-height: 88vh; overflow-y: auto; padding: 20px;
        background: linear-gradient(180deg, rgba(26,36,48,.98), rgba(13,19,27,.98));
        border: 1px solid rgba(255,255,255,.16); border-radius: 20px;
        box-shadow: 0 28px 72px rgba(0,0,0,.66);
      }
      .st-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
      .st-head h2 { font-size: 20px; font-weight: 900; flex: 1; }
      .st-ready {
        background: rgba(255,211,92,.16); color: #ffd35c; font-weight: 800;
        padding: 5px 13px; border-radius: 999px; font-size: 12.5px;
      }
      .st-x {
        background: rgba(255,255,255,.1); border: none; color: #fff; cursor: pointer;
        width: 30px; height: 30px; border-radius: 9px; font-size: 19px; line-height: 1;
      }
      .st-list { list-style: none; display: grid; gap: 9px; margin: 0 0 14px; padding: 0; }
      .st-card {
        --c: #9fb0c0;
        display: flex; align-items: center; gap: 12px; padding: 11px 12px;
        background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09);
        border-radius: 14px;
      }
      .st-card.is-ready { border-color: var(--c); box-shadow: 0 0 18px -8px var(--c); }
      .st-card.is-locked { opacity: .42; }
      .st-orb {
        flex: none; width: 42px; height: 42px; border-radius: 50%;
        background:
          radial-gradient(circle at 34% 28%, #fff8, transparent 54%),
          linear-gradient(160deg, var(--a) 55%, var(--b, var(--a)) 100%);
        box-shadow: inset 0 -4px 8px rgba(0,0,0,.34);
      }
      .st-card.is-locked .st-orb { filter: grayscale(1) brightness(.5); }
      .st-main { flex: 1; min-width: 0; display: grid; gap: 5px; }
      .st-top { display: flex; align-items: baseline; gap: 8px; }
      .st-name { font-size: 14px; font-weight: 800; }
      .st-rarity {
        font-size: 9.5px; letter-spacing: 1.1px; text-transform: uppercase;
        color: var(--c); font-weight: 800;
      }
      .st-pips { margin-left: auto; font-size: 12px; letter-spacing: 1px; }
      .st-pip { color: rgba(255,255,255,.16); }
      .st-pip.is-on { color: #ffd35c; text-shadow: 0 0 7px rgba(255,211,92,.6); }
      .st-stats { display: flex; gap: 12px; font-size: 10.5px; opacity: .74; }
      .st-stats span { white-space: nowrap; }
      .st-now { font-weight: 700; }
      .st-arrow { opacity: .5; margin: 0 3px; }
      .st-next { font-weight: 800; color: #ffd35c; }
      .st-barwrap { display: flex; align-items: center; gap: 9px; }
      .st-bar {
        flex: 1; height: 7px; border-radius: 999px; overflow: hidden;
        background: rgba(255,255,255,.1);
      }
      .st-bar i {
        display: block; height: 100%; border-radius: 999px;
        background: linear-gradient(90deg, var(--c), #fff9);
        transition: width .3s ease;
      }
      .st-count { font-size: 10.5px; opacity: .6; white-space: nowrap; }
      .st-locked-note { font-size: 11px; opacity: .6; }
      .st-line { font-size: 10.5px; opacity: .55; }
      .st-line b { color: #cfe3f5; font-weight: 800; }
      .st-btn {
        flex: none; font: inherit; font-weight: 900; font-size: 12.5px; cursor: pointer;
        color: #08131a; padding: 9px 14px; border-radius: 11px; border: none;
        background: linear-gradient(180deg, #ffe6a8, #f0b95c);
        box-shadow: 0 4px 0 #a8763a;
        transition: transform .1s ease, box-shadow .1s ease, filter .14s ease;
      }
      .st-btn:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 #a8763a; }
      .st-btn:disabled {
        filter: grayscale(.8) brightness(.62); cursor: default;
        font-weight: 700; font-size: 11px;
      }
      .st-max {
        flex: none; font-size: 10px; font-weight: 900; letter-spacing: 1px;
        color: #ffd35c; padding: 6px 10px;
      }
      .st-note { font-size: 11.5px; opacity: .58; line-height: 1.5; }
      @media (max-width: 760px) {
        .st-sheet { padding: 14px; }
        .st-stats { flex-wrap: wrap; gap: 7px; }
        .st-card { flex-wrap: wrap; }
      }
    `;
    document.head.appendChild(st);
  }
}
