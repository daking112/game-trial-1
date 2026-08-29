import * as THREE from 'three';
import { SPECIES, type Rarity } from '../creatures/species';
import { Creature } from '../creatures/Creature';
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

const PORTRAIT_PX = 144;
const portraitCache = new Map<string, string>();

/**
 * Render a species' actual creature to a portrait image, once, and keep it.
 *
 * The first version of this screen drew each creature as a two-stop radial
 * gradient. In a monster-collecting game that is the one substitution the
 * player will always catch: four coloured balls have no silhouette, so the
 * rows become interchangeable and the roster stops being a roster. The
 * creatures are already built in code, so the honest fix is to point a camera
 * at the real mesh rather than to draw a better circle.
 *
 * One throwaway renderer does every portrait in a single pass and is then
 * disposed, so the game keeps exactly one live WebGL context afterwards. The
 * results are data URLs held for the session -- a portrait is a few KB and
 * never changes, so re-rendering it on each open would be pure waste.
 */
function buildPortraits(ids: string[]) {
  const missing = ids.filter((id) => !portraitCache.has(id) && SPECIES[id]);
  if (missing.length === 0) return;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    // No second context available: the cards fall back to a plain frame
    // rather than failing to open the screen.
    return;
  }
  renderer.setSize(PORTRAIT_PX, PORTRAIT_PX, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  // Warm key, cool fill: the same split the battlefield uses, so a portrait
  // and the creature standing on the map read as the same object.
  const key = new THREE.DirectionalLight(0xfff0d8, 3.1);
  key.position.set(2.2, 3.4, 3.0);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x30405a, 1.55));
  const rim = new THREE.DirectionalLight(0x9fd0ff, 1.5);
  rim.position.set(-2.6, 1.6, -2.4);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);

  for (const id of missing) {
    const creature = new Creature(id, { facing: Math.PI * 0.16, contactShadow: false });
    scene.add(creature.group);

    // Frame the head and shoulders rather than the whole body: at 144px a
    // full-length creature is a smudge, and the face is what identifies it.
    const box = new THREE.Box3().setFromObject(creature.group);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const target = new THREE.Vector3(centre.x, box.max.y - size.y * 0.2, centre.z);
    // Tight enough that the head fills the frame. Framing on the whole body
    // put a full creature inside 68 device pixels, which is a smudge with a
    // rarity border around it -- the reason to render the real mesh at all is
    // that the face is what tells two creatures apart.
    const reach = Math.max(size.x * 0.5, size.y * 0.28) + 0.12;
    const dist = reach / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(target.x + dist * 0.34, target.y + dist * 0.16, target.z + dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    portraitCache.set(id, renderer.domElement.toDataURL('image/png'));

    scene.remove(creature.group);
    creature.dispose();
  }

  renderer.dispose();
  renderer.forceContextLoss();
}

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

  /**
   * Buy as many stars as the banked shards cover, in one press.
   *
   * The button used to be labelled with the number it could afford while
   * buying exactly one, and charging the first star's price under a label
   * that implied the total. Either half could have been the fix; buying the
   * lot is the one that saves pressing the same button five times.
   */
  private doUpgrade(speciesId: string) {
    let rank: number | null = null;
    for (let i = 0; i < MAX_STARS; i++) {
      const next = this.stars.upgrade(speciesId, this.gacha);
      if (next === null) break;
      rank = next;
    }
    if (rank === null) return;
    this.cb.onUpgrade(speciesId, rank);
    this.render();
  }

  private render() {
    const owned = this.cb.owned();
    buildPortraits([...owned]);
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

        <p class="st-note">Duplicate summons become shards; shards buy permanent stars.</p>
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
    const portrait = portraitCache.get(sp.id);
    // Named only once the player owns the base form; an undiscovered line
    // stays undiscovered, the same way the codex hides it.
    const evolved = sp.evolvesTo ? SPECIES[sp.evolvesTo] : undefined;
    const evolvesInto = evolved ? evolved.name : '';
    const maxed = cost === null;
    const affordable = !maxed && have >= cost!;

    const pips = Array.from({ length: MAX_STARS }, (_, i) =>
      `<span class="st-pip ${i < rank ? 'is-on' : ''}">&#9733;</span>`).join('') +
      '';

    // How many stars the banked shards would buy in one go. Showing "368 / 24"
    // and a full bar tells the player nothing about what to do next; showing
    // that it buys three tells them exactly.
    let affordableCount = 0;
    let spent = 0;
    for (let n = rank; n < MAX_STARS; n++) {
      const c = starCost(sp.id, n);
      if (c === null || spent + c > have) break;
      spent += c;
      affordableCount++;
    }

    // The bar measures the distance still to walk, not shards already past
    // their purpose. Measured against the FIRST star's price it pinned to
    // full the moment any surplus built up, so four rows holding wildly
    // different surpluses all drew the same full bar and the fill said
    // nothing at all.
    const remainder = have - spent;
    const nextCost = starCost(sp.id, rank + affordableCount);
    const pct = nextCost === null ? 100 : Math.min(100, Math.round((remainder / nextCost) * 100));

    const now = starMultipliers(rank);
    const next = starMultipliers(Math.min(rank + 1, MAX_STARS));
    // The gain, not the current value. Twelve copies of "1.00x" across four
    // rows read as an unpopulated template rather than as data.
    const delta = (a: number, b: number) =>
      `<span class="st-next">+${Math.round(((maxed ? a : b) - 1) * 100)}%</span>`;

    return `
      <li class="st-card ${isOwned ? '' : 'is-locked'} ${affordable ? 'is-ready' : ''}"
          style="--c:${colour};--a:${sp.palette.primary};--b:${sp.palette.secondary}">
        <span class="st-orb">
          ${portrait && isOwned ? `<img src="${portrait}" alt="" draggable="false">`
                                : portrait ? `<img class="is-silhouette" src="${portrait}" alt="" draggable="false">`
                                : ''}
        </span>
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
              <span class="st-count">
                ${maxed || nextCost === null ? 'Max rank'
                  : `<i class="st-shard"></i>${remainder} <span class="st-of">of ${nextCost}</span>`}
              </span>
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
            <span class="st-btn-label">Star Up${affordableCount > 1 ? ` &times;${affordableCount}` : ''}</span>
            <span class="st-btn-cost"><i class="st-shard"></i>${spent || cost}</span>
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
        width: min(700px, 94vw); max-height: 88vh; overflow-y: auto; padding: 18px 20px 20px;
        background: linear-gradient(180deg, rgba(30,41,55,.98), rgba(13,19,27,.98));
        border: 1px solid rgba(255,255,255,.14); border-radius: 20px;
        box-shadow: 0 28px 72px rgba(0,0,0,.66), inset 0 1px 0 rgba(255,255,255,.09);
      }
      .st-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
      .st-head h2 { font-size: 21px; font-weight: 900; flex: 1; letter-spacing: .2px; }
      /* The shard glyph. An economy screen that never draws its own currency
         makes the player parse the word "shards" six times instead. */
      .st-shard {
        display: inline-block; width: 9px; height: 9px; margin-right: 5px;
        background: linear-gradient(160deg, #bfe6ff, #4aa8e8);
        transform: rotate(45deg); border-radius: 2px;
        box-shadow: 0 0 6px rgba(87,180,240,.7);
      }
      .st-bank {
        display: flex; align-items: center; background: rgba(87,180,240,.13);
        color: #a9dcff; font-weight: 800; font-size: 13px;
        padding: 6px 13px; border-radius: 999px;
      }
      .st-ready {
        background: rgba(255,211,92,.17); color: #ffd35c; font-weight: 800;
        padding: 6px 13px; border-radius: 999px; font-size: 12.5px;
      }
      .st-x {
        background: rgba(255,255,255,.1); border: none; color: #fff; cursor: pointer;
        width: 44px; height: 44px; border-radius: 12px; font-size: 22px; line-height: 1;
      }
      .st-list { list-style: none; display: grid; gap: 9px; margin: 0 0 12px; padding: 0; }
      .st-card {
        display: flex; align-items: center; gap: 13px; padding: 11px 13px;
        background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09);
        border-radius: 15px;
      }
      /* Ready rows share one gold treatment. Tinting each by its own rarity
         made a single blue row look like a selection state with no legend. */
      .st-card.is-ready {
        border-color: rgba(255,211,92,.66);
        background: linear-gradient(90deg, rgba(255,211,92,.09), rgba(255,255,255,.05) 42%);
      }
      .st-card.is-locked { opacity: .42; }
      .st-orb {
        flex: none; width: 68px; height: 68px; border-radius: 15px; overflow: hidden;
        display: grid; place-items: center; position: relative;
        background:
          radial-gradient(circle at 50% 34%, color-mix(in srgb, var(--c) 42%, transparent), transparent 68%),
          linear-gradient(180deg, rgba(255,255,255,.09), rgba(0,0,0,.24));
        border: 2px solid var(--c);
        box-shadow: inset 0 0 14px rgba(0,0,0,.42), 0 0 12px -5px var(--c);
      }
      .st-orb img { width: 100%; height: 100%; object-fit: contain; }
      .st-orb img.is-silhouette { filter: brightness(0) saturate(0); opacity: .38; }
      .st-main { flex: 1; min-width: 0; display: grid; gap: 5px; }
      .st-top { display: flex; align-items: center; gap: 8px; }
      .st-name { font-size: 15px; font-weight: 800; }
      .st-rarity {
        font-size: 9.5px; letter-spacing: 1px; text-transform: uppercase; font-weight: 900;
        color: #0d141b; background: var(--c); padding: 3px 7px; border-radius: 5px;
      }
      .st-card.is-locked .st-rarity { color: #fff; background: rgba(255,255,255,.16); }
      .st-pips { margin-left: auto; display: flex; align-items: center; gap: 3px; font-size: 22px; }
      .st-pip { color: rgba(255,255,255,.14); text-shadow: 0 1px 0 rgba(0,0,0,.5); }
      .st-pip.is-on { color: #ffd35c; text-shadow: 0 0 8px rgba(255,211,92,.75); }
      .st-stats { display: flex; gap: 13px; font-size: 11px; }
      .st-stats span { white-space: nowrap; color: rgba(255,255,255,.62); }
      .st-now { font-weight: 700; color: rgba(255,255,255,.9); }
      .st-arrow { opacity: .65; margin: 0 3px; }
      .st-next { font-weight: 800; color: #ffd35c; }
      .st-barwrap { display: flex; align-items: center; gap: 10px; }
      .st-bar {
        flex: 1; height: 8px; border-radius: 999px; overflow: hidden;
        background: rgba(0,0,0,.38); box-shadow: inset 0 1px 2px rgba(0,0,0,.5);
      }
      /* Opaque along its whole length. The first version faded to a
         translucent white, so a full bar was indistinguishable from a
         half-empty one and every row's fill contradicted its own numbers. */
      .st-bar i {
        display: block; height: 100%; border-radius: 999px;
        background: linear-gradient(90deg, #3f7fb8, #7cc4f5);
        transition: width .3s ease;
      }
      .st-count {
        font-size: 11.5px; white-space: nowrap; font-weight: 700; color: #a9dcff;
        display: flex; align-items: center;
      }
      .st-of { opacity: .5; font-weight: 600; margin-left: 4px; color: #fff; }
      .st-locked-note { font-size: 11.5px; opacity: .6; }
      .st-line { font-size: 10.5px; opacity: .5; }
      .st-line b { color: #cfe3f5; font-weight: 800; }
      .st-btn {
        flex: none; min-width: 108px; font: inherit; cursor: pointer; color: #21160a;
        display: grid; gap: 1px; justify-items: center;
        padding: 9px 15px; border-radius: 12px; border: none;
        background: linear-gradient(180deg, #ffe6a8, #f0b95c);
        box-shadow: 0 4px 0 #a8763a, inset 0 1px 0 rgba(255,255,255,.6);
        transition: transform .1s ease, box-shadow .1s ease, filter .14s ease;
      }
      .st-btn-label { font-size: 13px; font-weight: 900; }
      .st-btn-cost { font-size: 10.5px; font-weight: 800; opacity: .78; display: flex; align-items: center; }
      .st-btn-cost .st-shard {
        width: 7px; height: 7px; margin-right: 4px; box-shadow: none;
        background: linear-gradient(160deg, #2f6f9e, #1d4a6e);
      }
      .st-btn:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 #a8763a; }
      .st-btn:disabled {
        cursor: default; color: rgba(255,255,255,.66);
        background: rgba(255,255,255,.08); box-shadow: none;
      }
      .st-btn:disabled .st-btn-cost { opacity: .6; }
      .st-max {
        flex: none; font-size: 10.5px; font-weight: 900; letter-spacing: 1.2px;
        color: #ffd35c; padding: 6px 12px; border-radius: 999px;
        background: rgba(255,211,92,.13);
      }
      .st-note { font-size: 11.5px; opacity: .5; line-height: 1.5; margin: 0; }
      /* A real two-tier row rather than a scaled-down landscape one: identity
         on the first line, the transaction on the second. The single-band
         layout overflowed a 390pt viewport by about a quarter before the
         button was even counted. */
      @media (max-width: 760px) {
        .st-sheet { padding: 14px; }
        .st-card { flex-wrap: wrap; row-gap: 10px; }
        .st-orb { width: 58px; height: 58px; }
        .st-main { flex-basis: calc(100% - 71px); }
        .st-stats { flex-wrap: wrap; gap: 8px; }
        .st-barwrap { flex-basis: 100%; order: 3; }
        .st-btn { flex-basis: 100%; order: 4; min-width: 0; }
      }
    `;
    document.head.appendChild(st);
  }
}
