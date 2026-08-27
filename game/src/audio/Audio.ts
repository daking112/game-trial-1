/**
 * Synthesised audio.
 *
 * Every sound is generated with Web Audio oscillators and noise buffers. There
 * are no audio files to download -- the same constraint that drives the
 * procedural textures -- and synthesis has a real advantage here: pitch and
 * timbre can be varied per event so a wave of twenty kills never sounds like
 * the same sample twenty times.
 */
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

  /** Projectile landing: filtered noise tick. */
  hit() {
    if (!this.ctx || this.muted || !this.budget(8)) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 1800 + Math.random() * 900;
    filt.Q.value = 1.4;
    const gain = this.ctx.createGain();
    this.env(gain, t, 0.09, 0.002, 0.055);
    src.connect(filt).connect(gain).connect(this.master!);
    src.start(t); src.stop(t + 0.09);
  }

  /** Enemy destroyed: a body thump plus a bright pop. */
  pop(big = false) {
    if (!this.ctx || this.muted || !this.budget(5)) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const g1 = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(big ? 210 : 420, t);
    osc.frequency.exponentialRampToValueAtTime(big ? 46 : 110, t + (big ? 0.34 : 0.16));
    this.env(g1, t, big ? 0.36 : 0.18, 0.005, big ? 0.36 : 0.17);
    osc.connect(g1).connect(this.master!);
    osc.start(t); osc.stop(t + (big ? 0.42 : 0.22));

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = big ? 620 : 1500;
    const g2 = this.ctx.createGain();
    this.env(g2, t, big ? 0.2 : 0.1, 0.003, big ? 0.26 : 0.1);
    src.connect(filt).connect(g2).connect(this.master!);
    src.start(t); src.stop(t + 0.3);
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

  /** Wave incoming: a rising three-note fanfare. */
  fanfare(win = false) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const notes = win ? [523.25, 659.25, 783.99, 1046.5] : [392, 523.25, 659.25];
    notes.forEach((f, i) => {
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
}
