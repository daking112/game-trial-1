/**
 * Synthesised audio.
 *
 * Every sound is generated with Web Audio oscillators and noise buffers. There
 * are no audio files to download -- the same constraint that drives the
 * procedural textures -- and synthesis has a real advantage here: pitch and
 * timbre can be varied per event so a wave of twenty kills never sounds like
 * the same sample twenty times.
 */
/** Creature elements, matching `combat/Enemy`'s `DamageKind`. */
export type ElementKind = 'seed' | 'ember' | 'jet' | 'bolt' | 'shard';
/** What `hit` can be told about an impact. */
export type HitKind = ElementKind | 'shielded' | 'deflected';
/** Enemy tiers, matching `combat/Enemy`'s `EnemyTier`. */
export type DeathTier = 'husk' | 'dart' | 'brute' | 'warden' | 'colossus';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  /** Rolling budget so a mass death cannot produce a wall of clipping. */
  private recent: number[] = [];

  /** Must be called from a user gesture -- browsers block audio otherwise. */
  resume() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;

      // A gentle compressor keeps overlapping impacts from clipping.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      this.master.connect(comp).connect(this.ctx.destination);

      this.noiseBuffer = this.makeNoise(0.4);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  get isMuted() { return this.muted; }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 99;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    return buf;
  }

  /**
   * Seeded jitter. Every voice detunes slightly so twenty kills in a wave do
   * not sound like one sample twenty times, and seeding it keeps the game
   * deterministic the way the brief demands.
   */
  private noiseSeed = 20250829;
  private rand(): number {
    this.noiseSeed = (this.noiseSeed * 1664525 + 1013904223) >>> 0;
    return this.noiseSeed / 4294967296;
  }

  /** True if another voice may start; throttles dense frames. */
  private budget(max = 6): boolean {
    const now = this.ctx!.currentTime;
    this.recent = this.recent.filter((t) => now - t < 0.06);
    if (this.recent.length >= max) return false;
    this.recent.push(now);
    return true;
  }

  private env(gain: GainNode, at: number, peak: number, attack: number, decay: number) {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  }

  /** Tower firing: a short pitched blip. */
  shoot(pitch = 1) {
    if (!this.ctx || this.muted || !this.budget()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(720 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(300 * pitch, t + 0.09);
    this.env(gain, t, 0.12, 0.004, 0.09);
    osc.connect(gain).connect(this.master!);
    osc.start(t); osc.stop(t + 0.14);
  }

  /**
   * Projectile landing.
   *
   * Five distinguishable voices, one per element, built from the axes the ear
   * separates fastest: centre frequency, filter shape, and whether there is a
   * pitched body under the noise at all. With eyes closed, seed thumps low and
   * wooden, ember crackles wide and dirty, jet is a wet downward chirp, bolt
   * is a needle-thin tick with no body, and shard rings.
   */
  hit(kind?: HitKind) {
    if (!this.ctx || this.muted || !this.budget(8)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const v = this.rand();

    if (kind === 'shielded') { this.shieldTick(t); return; }
    if (kind === 'deflected') { this.clank(t); return; }

    const voice = {
      seed:  { type: 'lowpass',  freq: 900,  q: 1.0, gain: 0.085, decay: 0.075, tone: 190, toneEnd: 90,  toneType: 'triangle' },
      ember: { type: 'bandpass', freq: 1500, q: 0.5, gain: 0.085, decay: 0.13,  tone: 0,   toneEnd: 0,   toneType: 'sine' },
      jet:   { type: 'bandpass', freq: 2400, q: 2.2, gain: 0.07,  decay: 0.075, tone: 1250, toneEnd: 380, toneType: 'sine' },
      bolt:  { type: 'highpass', freq: 4600, q: 1.0, gain: 0.06,  decay: 0.03,  tone: 0,   toneEnd: 0,   toneType: 'square' },
      shard: { type: 'bandpass', freq: 3200, q: 6.0, gain: 0.075, decay: 0.11,  tone: 2100, toneEnd: 1900, toneType: 'square' },
    }[(kind ?? 'shard') as ElementKind];

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.85 + v * 0.4;
    const filt = ctx.createBiquadFilter();
    filt.type = voice.type as BiquadFilterType;
    filt.frequency.value = voice.freq * (0.9 + v * 0.22);
    filt.Q.value = voice.q;
    const gain = ctx.createGain();
    this.env(gain, t, voice.gain, 0.002, voice.decay);
    src.connect(filt).connect(gain).connect(this.master!);
    src.start(t); src.stop(t + voice.decay + 0.05);

    if (voice.tone > 0) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = voice.toneType as OscillatorType;
      const p = 0.94 + v * 0.13;
      osc.frequency.setValueAtTime(voice.tone * p, t);
      osc.frequency.exponentialRampToValueAtTime(voice.toneEnd * p, t + voice.decay);
      this.env(g, t, voice.gain * 0.8, 0.002, voice.decay);
      osc.connect(g).connect(this.master!);
      osc.start(t); osc.stop(t + voice.decay + 0.06);
    }
  }

  /** A shot swallowed by armour: dull, pitched, no sizzle. */
  private clank(t: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(96, t + 0.07);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 700;
    this.env(g, t, 0.075, 0.002, 0.07);
    osc.connect(filt).connect(g).connect(this.master!);
    osc.start(t); osc.stop(t + 0.13);
  }

  /** A shot landing on an intact shield: glassy, high, ringing. */
  private shieldTick(t: number) {
    const ctx = this.ctx!;
    [1860, 2790].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      this.env(g, t, i ? 0.03 : 0.055, 0.002, 0.12);
      osc.connect(g).connect(this.master!);
      osc.start(t); osc.stop(t + 0.18);
    });
  }

  /** A shield collapsing: the ring, shattered. */
  shieldBreak() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.26);
    this.env(g, t, 0.14, 0.003, 0.26);
    osc.connect(g).connect(this.master!);
    osc.start(t); osc.stop(t + 0.34);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 2600;
    const g2 = ctx.createGain();
    this.env(g2, t, 0.11, 0.002, 0.2);
    src.connect(filt).connect(g2).connect(this.master!);
    src.start(t); src.stop(t + 0.28);
  }

  /**
   * Enemy destroyed. Accepts a tier so the four death weights are audibly
   * different — a husk is a dry tick, a colossus is a sub-bass collapse with a
   * detuned brass stab over it.
   */
  pop(what: boolean | DeathTier = false) {
    if (!this.ctx || this.muted) return;
    const tier: DeathTier = typeof what === 'boolean' ? (what ? 'warden' : 'husk') : what;
    const boss = tier === 'colossus';
    if (!boss && !this.budget(5)) return;
    const ctx = this.ctx, t = ctx.currentTime;

    const shape = {
      husk:     { f0: 430, f1: 118, decay: 0.16, gain: 0.17, hp: 1500, nGain: 0.10, nDecay: 0.10 },
      dart:     { f0: 780, f1: 260, decay: 0.11, gain: 0.14, hp: 2600, nGain: 0.09, nDecay: 0.07 },
      brute:    { f0: 260, f1: 74,  decay: 0.26, gain: 0.26, hp: 900,  nGain: 0.15, nDecay: 0.2 },
      warden:   { f0: 205, f1: 52,  decay: 0.36, gain: 0.32, hp: 640,  nGain: 0.19, nDecay: 0.26 },
      colossus: { f0: 118, f1: 26,  decay: 0.85, gain: 0.42, hp: 300,  nGain: 0.26, nDecay: 0.7 },
    }[tier];

    const osc = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc.type = boss ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(shape.f0, t);
    osc.frequency.exponentialRampToValueAtTime(shape.f1, t + shape.decay);
    this.env(g1, t, shape.gain, 0.005, shape.decay);
    osc.connect(g1).connect(this.master!);
    osc.start(t); osc.stop(t + shape.decay + 0.1);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = boss ? 0.5 : 1;
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = shape.hp;
    const g2 = ctx.createGain();
    this.env(g2, t, shape.nGain, 0.003, shape.nDecay);
    src.connect(filt).connect(g2).connect(this.master!);
    src.start(t); src.stop(t + shape.nDecay + 0.1);

    // A boss death gets a falling minor stab on top so it lands as an event
    // rather than as a very large husk.
    if (boss) {
      [349.23, 261.63, 174.61].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const at = t + 0.05 + i * 0.13;
        this.env(g, at, 0.11, 0.008, 0.4);
        o.connect(g).connect(this.master!);
        o.start(at); o.stop(at + 0.5);
      });
    }
  }

  /**
   * The boss arriving. Low, slow, and the only sound in the game with a long
   * attack — everything else is percussive, so a swell reads instantly as
   * something different happening.
   */
  boss() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, detune] of [[58, 0], [58, 7], [87, -5]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = detune;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(200, t);
      filt.frequency.linearRampToValueAtTime(1500, t + 0.9);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
      o.connect(filt).connect(g).connect(this.master!);
      o.start(t); o.stop(t + 1.8);
    }
    // A struck-metal hit at the top of the swell.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 3;
    const g = ctx.createGain();
    this.env(g, t + 0.5, 0.13, 0.01, 0.7);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t + 0.5); src.stop(t + 1.4);
  }

  /** Life lost. Descending, deliberately unpleasant. */
  leak() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.42);
    this.env(gain, t, 0.16, 0.01, 0.44);
    osc.connect(gain).connect(this.master!);
    osc.start(t); osc.stop(t + 0.5);
  }

  /** Tower placed: a confirming two-note rise. */
  place() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [523.25, 783.99].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      this.env(gain, t + i * 0.075, 0.13, 0.006, 0.15);
      osc.connect(gain).connect(this.master!);
      osc.start(t + i * 0.075); osc.stop(t + i * 0.075 + 0.2);
    });
  }

  /**
   * Wave incoming: a rising three-note fanfare.
   *
   * `win` plays the wave-clear instead — deliberately the *only* sustained
   * major chord in the game, so clearing a wave is unmistakable next to the
   * percussive pops and the boss's minor swell.
   */
  fanfare(win = false) {
    if (win) { this.waveClear(); return; }
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [392, 523.25, 659.25].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'square';
      osc.frequency.value = f;
      const at = t + i * 0.11;
      this.env(gain, at, 0.075, 0.01, 0.22);
      osc.connect(gain).connect(this.master!);
      osc.start(at); osc.stop(at + 0.3);
    });
  }

  /**
   * Wave cleared: an arpeggio that lands on a held triad. `step` transposes it
   * up a semitone per wave, so late waves resolve higher than early ones and
   * the ear can hear the run getting further along.
   */
  waveClear(step = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const shift = Math.pow(2, Math.min(11, step) / 12);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f * shift;
      const at = t + i * 0.075;
      this.env(gain, at, 0.09, 0.008, 0.2);
      osc.connect(gain).connect(this.master!);
      osc.start(at); osc.stop(at + 0.28);
    });
    // The held triad under the run: this is the part you recognise.
    [261.63, 329.63, 392].forEach((f) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f * shift;
      const at = t + 0.24;
      this.env(gain, at, 0.06, 0.03, 0.62);
      osc.connect(gain).connect(this.master!);
      osc.start(at); osc.stop(at + 0.7);
    });
  }
}
