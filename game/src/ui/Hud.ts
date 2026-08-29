export interface HudSpecies {
  id: string;
  name: string;
  element: string;
  cost: number;
  accent: string;
}

export interface HudCallbacks {
  onSelectSpecies(id: string | null): void;
  onStartWave(): void;
  onToggleSpeed(): void;
  onOpenCodex(): void;
  onOpenSummon(): void;
}

/**
 * DOM overlay HUD.
 *
 * Drawn in DOM rather than in-world because crisp text at every zoom level and
 * accessible focus handling are both free here and expensive in WebGL. The
 * canvas keeps pointer events; only the panels capture them.
 */
export class Hud {
  readonly root: HTMLDivElement;

  private readonly livesEl: HTMLSpanElement;
  private readonly goldEl: HTMLSpanElement;
  private readonly waveEl: HTMLSpanElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly waveBar: HTMLDivElement;
  private readonly waveName: HTMLSpanElement;
  private readonly waveCount: HTMLSpanElement;
  private readonly waveFill: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly cards = new Map<string, HTMLButtonElement>();

  private selected: string | null = null;
  private bannerTimer = 0;

  constructor(container: HTMLElement, species: HudSpecies[], private readonly cb: HudCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="stat stat-lives"><span class="stat-icon">&#9829;</span><span class="stat-val" data-lives>40</span></div>
        <div class="stat stat-gold"><span class="stat-icon">&#9679;</span><span class="stat-val" data-gold>120</span></div>
        <div class="stat stat-wave"><span class="stat-label">WAVE</span><span class="stat-val" data-wave>0</span></div>
        <div class="wavebar" data-wavebar hidden>
          <div class="wavebar-head">
            <span class="wavebar-name" data-wavename></span>
            <span class="wavebar-count" data-wavecount></span>
          </div>
          <div class="wavebar-track"><i data-wavefill></i></div>
        </div>
      </div>
      <div class="hud-banner" data-banner></div>
      <div class="hud-bottom">
        <div class="roster" data-roster></div>
        <div class="controls">
          <button class="btn btn-summon" data-summon type="button" title="Summoning Circle (S)">Summon</button>
          <button class="btn btn-speed" data-codex type="button" title="Field Codex (C)">Codex</button>
          <button class="btn btn-speed" data-speed type="button">1&times;</button>
          <button class="btn btn-start" data-start type="button">Start Wave</button>
        </div>
      </div>
    `;

    this.livesEl = this.root.querySelector('[data-lives]')!;
    this.goldEl = this.root.querySelector('[data-gold]')!;
    this.waveEl = this.root.querySelector('[data-wave]')!;
    this.bannerEl = this.root.querySelector('[data-banner]')!;
    this.waveBar = this.root.querySelector('[data-wavebar]')!;
    this.waveName = this.root.querySelector('[data-wavename]')!;
    this.waveCount = this.root.querySelector('[data-wavecount]')!;
    this.waveFill = this.root.querySelector('[data-wavefill]')!;
    this.startBtn = this.root.querySelector('[data-start]')!;
    this.speedBtn = this.root.querySelector('[data-speed]')!;

    const roster = this.root.querySelector('[data-roster]')!;
    for (const s of species) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.style.setProperty('--accent', s.accent);
      card.innerHTML = `
        <span class="card-glyph" aria-hidden="true"></span>
        <span class="card-name">${s.name}</span>
        <span class="card-el">${s.element}</span>
        <span class="card-cost">${s.cost}</span>
      `;
      card.addEventListener('click', () => this.select(s.id));
      roster.appendChild(card);
      this.cards.set(s.id, card);
    }

    this.startBtn.addEventListener('click', () => cb.onStartWave());
    this.speedBtn.addEventListener('click', () => cb.onToggleSpeed());
    this.root.querySelector('[data-codex]')!.addEventListener('click', () => cb.onOpenCodex());
    this.root.querySelector('[data-summon]')!.addEventListener('click', () => cb.onOpenSummon());

    // Escape clears the placement selection -- players expect this and without
    // it a mis-click strands you in placement mode.
    window.addEventListener('keydown', this.onKey);

    container.appendChild(this.root);
    this.injectStyles();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.select(null);
  };

  select(id: string | null) {
    this.selected = this.selected === id ? null : id;
    for (const [key, el] of this.cards) el.classList.toggle('is-active', key === this.selected);
    this.cb.onSelectSpecies(this.selected);
  }

  get selectedSpecies(): string | null {
    return this.selected;
  }

  setAffordable(costs: Record<string, number>, gold: number) {
    for (const [id, el] of this.cards) {
      el.classList.toggle('is-broke', (costs[id] ?? 0) > gold);
    }
  }

  setStats(lives: number, gold: number, wave: number) {
    this.livesEl.textContent = String(lives);
    this.goldEl.textContent = String(gold);
    this.waveEl.textContent = String(wave);
  }

  /**
   * Wave progress. Optional -- the HUD is correct if this is never called.
   *
   * A tower-defence player needs to know how much of the wave is left before
   * deciding whether to spend, and the game only told them the wave NUMBER.
   * "Wave 4" says nothing about whether four more enemies are coming or forty.
   *
   * Between waves this becomes the countdown to the next one, because the
   * same strip answers the same question in both states: how long have I got.
   */
  setWaveProgress(p: {
    spawned: number; total: number; alive: number;
    fraction: number; name: string; isBoss: boolean; nextIn: number | null;
  } | null) {
    if (!p || (p.total === 0 && p.nextIn === null)) {
      this.waveBar.hidden = true;
      return;
    }
    this.waveBar.hidden = false;
    this.waveBar.classList.toggle('is-boss', p.isBoss);

    if (p.nextIn !== null) {
      this.waveName.textContent = 'Next wave';
      this.waveCount.textContent = `${p.nextIn.toFixed(1)}s`;
      this.waveFill.style.width = '100%';
      this.waveBar.classList.add('is-waiting');
      return;
    }
    this.waveBar.classList.remove('is-waiting');
    this.waveName.textContent = p.isBoss ? `\u2620 ${p.name}` : p.name;
    // Standing enemies, not spawn count: what is still on the track is the
    // number the player is actually deciding against.
    this.waveCount.textContent = `${p.alive} left`;
    this.waveFill.style.width = `${Math.round(p.fraction * 100)}%`;
  }

  setWaveButton(enabled: boolean, label: string) {
    this.startBtn.disabled = !enabled;
    this.startBtn.textContent = label;
  }

  setSpeedLabel(label: string) {
    this.speedBtn.textContent = label;
  }

  banner(text: string, tone: 'info' | 'good' | 'bad' = 'info', seconds = 2.4) {
    this.bannerEl.textContent = text;
    this.bannerEl.dataset.tone = tone;
    this.bannerEl.classList.add('is-shown');
    this.bannerTimer = seconds;
  }

  update(dt: number) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('is-shown');
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private injectStyles() {
    if (document.getElementById('hud-styles')) return;
    const style = document.createElement('style');
    style.id = 'hud-styles';
    style.textContent = `
      .hud {
        position: absolute; inset: 0; pointer-events: none;
        font-family: ui-rounded, "Nunito", "Segoe UI", system-ui, sans-serif;
        color: #fff; user-select: none;
        display: flex; flex-direction: column; justify-content: space-between;
      }
      .hud-top { display: flex; gap: 10px; padding: 14px; }
      .stat {
        pointer-events: auto; display: flex; align-items: center; gap: 8px;
        padding: 8px 16px; border-radius: 999px;
        background: linear-gradient(180deg, rgba(22,32,44,.92), rgba(12,18,26,.92));
        border: 1px solid rgba(255,255,255,.14);
        box-shadow: 0 6px 18px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.14);
        font-weight: 800; font-size: 17px; letter-spacing: .2px;
      }
      .stat-icon { font-size: 15px; }
      .stat-lives .stat-icon { color: #ff6b7a; }
      .stat-gold .stat-icon { color: #ffd35c; }
      .stat-label { font-size: 11px; opacity: .62; letter-spacing: 1.4px; }
      .stat-val { font-variant-numeric: tabular-nums; }

      .wavebar {
        min-width: 190px; padding: 7px 12px 8px; border-radius: 14px;
        background: rgba(8,13,20,.72); backdrop-filter: blur(6px);
        border: 1px solid rgba(255,255,255,.1);
        display: grid; gap: 5px; align-content: center;
      }
      .wavebar[hidden] { display: none; }
      .wavebar-head { display: flex; align-items: baseline; gap: 8px; }
      .wavebar-name {
        font-size: 11.5px; font-weight: 800; color: #dce9f7;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .wavebar-count {
        margin-left: auto; font-size: 11px; font-weight: 800; color: #8fa6bd; white-space: nowrap;
      }
      .wavebar-track {
        height: 6px; border-radius: 999px; background: rgba(0,0,0,.5);
        overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,.5);
      }
      .wavebar-track i {
        display: block; height: 100%; border-radius: 999px; width: 0%;
        background: linear-gradient(90deg, #57b4f0, #9fe8ff);
        transition: width .22s linear;
      }
      /* A boss wave has to announce itself before it arrives, not once it is
         already halfway down the track. */
      .wavebar.is-boss { border-color: rgba(255,122,77,.62); }
      .wavebar.is-boss .wavebar-name { color: #ffb08a; }
      .wavebar.is-boss .wavebar-track i { background: linear-gradient(90deg, #ff7a4d, #ffd76e); }
      .wavebar.is-waiting .wavebar-track i { background: linear-gradient(90deg, #6fd08c, #b8f5cd); }
      @media (max-width: 760px) {
        .wavebar { min-width: 0; flex: 1; }
      }
      .hud-banner {
        align-self: center; margin-top: 6vh;
        padding: 12px 34px; border-radius: 14px; font-size: 26px; font-weight: 900;
        letter-spacing: .5px; text-shadow: 0 3px 10px rgba(0,0,0,.6);
        background: rgba(10,16,24,.7); border: 1px solid rgba(255,255,255,.16);
        opacity: 0; transform: translateY(-10px) scale(.96);
        transition: opacity .22s ease, transform .22s cubic-bezier(.2,1.4,.4,1);
      }
      .hud-banner.is-shown { opacity: 1; transform: translateY(0) scale(1); }
      .hud-banner[data-tone="good"] { color: #9dffcb; }
      .hud-banner[data-tone="bad"]  { color: #ff9d9d; }

      .hud-bottom {
        display: flex; align-items: flex-end; justify-content: space-between;
        gap: 16px; padding: 14px;
      }
      .roster { display: flex; gap: 10px; pointer-events: auto; flex-wrap: wrap; }
      .card {
        --accent: #7ad0a8;
        position: relative; width: 96px; padding: 10px 8px 8px;
        border-radius: 14px; cursor: pointer; font: inherit; color: #fff;
        background: linear-gradient(180deg, rgba(26,36,48,.95), rgba(13,19,27,.95));
        border: 1px solid rgba(255,255,255,.13);
        box-shadow: 0 8px 20px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.12);
        display: grid; gap: 3px; justify-items: center;
        transition: transform .14s cubic-bezier(.2,1.4,.4,1), box-shadow .14s ease, border-color .14s ease;
      }
      .card:hover { transform: translateY(-3px); border-color: var(--accent); }
      .card.is-active {
        border-color: var(--accent);
        box-shadow: 0 10px 26px rgba(0,0,0,.5), 0 0 0 2px var(--accent), inset 0 1px 0 rgba(255,255,255,.16);
        transform: translateY(-4px);
      }
      .card.is-broke { opacity: .42; cursor: not-allowed; }
      .card-glyph {
        width: 42px; height: 42px; border-radius: 50%;
        background: radial-gradient(circle at 34% 28%, #fff8, transparent 54%), var(--accent);
        box-shadow: inset 0 -4px 8px rgba(0,0,0,.34), 0 3px 8px rgba(0,0,0,.4);
      }
      .card-name { font-size: 12.5px; font-weight: 800; }
      .card-el { font-size: 10px; opacity: .6; letter-spacing: 1.1px; text-transform: uppercase; }
      .card-cost {
        font-size: 12px; font-weight: 800; color: #ffd35c;
        background: rgba(0,0,0,.34); border-radius: 999px; padding: 1px 9px;
      }

      .controls { display: flex; gap: 10px; pointer-events: auto; }
      .btn {
        font: inherit; font-weight: 800; cursor: pointer; color: #08131a;
        padding: 13px 22px; border-radius: 13px; border: none; font-size: 15px;
        background: linear-gradient(180deg, #a8f0c8, #56c894);
        box-shadow: 0 6px 0 #2f8a63, 0 10px 20px rgba(0,0,0,.4);
        transition: transform .1s ease, box-shadow .1s ease, filter .14s ease;
      }
      .btn:hover:not(:disabled) { filter: brightness(1.06); }
      .btn:active:not(:disabled) { transform: translateY(4px); box-shadow: 0 2px 0 #2f8a63, 0 5px 12px rgba(0,0,0,.4); }
      .btn:disabled { filter: grayscale(.7) brightness(.75); cursor: default; }
      .btn-summon {
        background: linear-gradient(180deg, #ffe6a8, #f0b95c);
        box-shadow: 0 6px 0 #a8763a, 0 10px 20px rgba(0,0,0,.4);
      }
      .btn-speed {
        background: linear-gradient(180deg, #cfe0f0, #93aec8);
        box-shadow: 0 6px 0 #5b7793, 0 10px 20px rgba(0,0,0,.4);
        min-width: 62px;
      }

      /* Narrow viewports: the roster wrapped into a vertical column that ran
         off the top of the screen. Stack the bar instead and let the roster
         scroll horizontally, which is how every mobile game solves this. */
      @media (max-width: 760px) {
        .hud-bottom { flex-direction: column; align-items: stretch; gap: 10px; padding: 10px; }
        .roster {
          flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden;
          padding-bottom: 4px; scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
        }
        .roster::-webkit-scrollbar { display: none; }
        .card { width: 78px; flex: 0 0 auto; padding: 8px 6px 6px; }
        .card-glyph { width: 34px; height: 34px; }
        .card-name { font-size: 11px; }
        .controls { justify-content: stretch; }
        .controls .btn { flex: 1; padding: 12px 10px; font-size: 14px; }
        .hud-top { padding: 10px; gap: 7px; }
        .stat { padding: 6px 12px; font-size: 15px; }
        .wavebar {
        min-width: 190px; padding: 7px 12px 8px; border-radius: 14px;
        background: rgba(8,13,20,.72); backdrop-filter: blur(6px);
        border: 1px solid rgba(255,255,255,.1);
        display: grid; gap: 5px; align-content: center;
      }
      .wavebar[hidden] { display: none; }
      .wavebar-head { display: flex; align-items: baseline; gap: 8px; }
      .wavebar-name {
        font-size: 11.5px; font-weight: 800; color: #dce9f7;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .wavebar-count {
        margin-left: auto; font-size: 11px; font-weight: 800; color: #8fa6bd; white-space: nowrap;
      }
      .wavebar-track {
        height: 6px; border-radius: 999px; background: rgba(0,0,0,.5);
        overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,.5);
      }
      .wavebar-track i {
        display: block; height: 100%; border-radius: 999px; width: 0%;
        background: linear-gradient(90deg, #57b4f0, #9fe8ff);
        transition: width .22s linear;
      }
      /* A boss wave has to announce itself before it arrives, not once it is
         already halfway down the track. */
      .wavebar.is-boss { border-color: rgba(255,122,77,.62); }
      .wavebar.is-boss .wavebar-name { color: #ffb08a; }
      .wavebar.is-boss .wavebar-track i { background: linear-gradient(90deg, #ff7a4d, #ffd76e); }
      .wavebar.is-waiting .wavebar-track i { background: linear-gradient(90deg, #6fd08c, #b8f5cd); }
      @media (max-width: 760px) {
        .wavebar { min-width: 0; flex: 1; }
      }
      .hud-banner { font-size: 19px; padding: 10px 20px; margin-top: 4vh; }
      }
    `;
    document.head.appendChild(style);
  }
}
