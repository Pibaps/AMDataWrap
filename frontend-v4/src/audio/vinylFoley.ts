/**
 * Procedural Web Audio mechanical sound effects + continuous analog vinyl crackle
 * for the 3D Vinyl Studio ("Salon d'écoute"):
 * - mechanical switch / start-stop button click
 * - cardboard sleeve slide & wooden crate flip rustle
 * - heavy needle drop thump + initial groove hiss
 * - continuous soft analog vinyl crackle while the stylus tracks the rotating platter
 *
 * 100% procedural Web Audio API, zero external assets, toggleable independently.
 */

class VinylFoleyEngine {
  private ctx: AudioContext | null = null;
  private crackleNode: AudioBufferSourceNode | null = null;
  private crackleGain: GainNode | null = null;
  private crackleActive = false;

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public playClick(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    // Tactile dual-transient mechanical button click (spring + contact)
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(920, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.028);
    gain.gain.setValueAtTime(0.085, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.032);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.036);
  }

  public playSleeveSlide(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dur = 0.24;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const env = Math.sin(t * Math.PI) * (1 - 0.35 * t);
      data[i] = (Math.random() * 2 - 1) * env * 0.12;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(680, ctx.currentTime);
    filter.Q.setValueAtTime(1.25, ctx.currentTime);
    src.connect(filter).connect(ctx.destination);
    src.start();
  }

  public playCrateFlip(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dur = 0.14;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const env = Math.pow(1 - t, 1.8) * Math.sin(t * Math.PI);
      const thud = t < 0.18 ? Math.sin(t * 280) * 0.22 * (1 - t / 0.18) : 0;
      data[i] = (Math.random() * 2 - 1) * env * 0.14 + thud;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1250, ctx.currentTime);
    src.connect(filter).connect(ctx.destination);
    src.start();
  }

  public playNeedleDrop(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dur = 0.38;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const thump = t < 0.09 ? Math.sin(t * 195) * Math.pow(1 - t / 0.09, 1.5) * 0.34 : 0;
      const pop = Math.random() > 0.982 ? (Math.random() * 2 - 1) * 0.26 : (Math.random() * 2 - 1) * 0.014;
      data[i] = (thump + pop) * (1 - t * 0.55);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2900, ctx.currentTime);
    src.connect(filter).connect(ctx.destination);
    src.start();
  }

  /** Starts/stops a subtle continuous vinyl surface crackle loop while the stylus is in the groove. */
  public setCrackleLoop(shouldPlay: boolean): void {
    if (shouldPlay === this.crackleActive) return;
    this.crackleActive = shouldPlay;

    if (!shouldPlay) {
      if (this.crackleGain && this.ctx) {
        const now = this.ctx.currentTime;
        this.crackleGain.gain.setTargetAtTime(0.0001, now, 0.08);
      }
      if (this.crackleNode) {
        const node = this.crackleNode;
        this.crackleNode = null;
        window.setTimeout(() => {
          try {
            node.stop();
            node.disconnect();
          } catch {
            /* ignore */
          }
        }, 220);
      }
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) {
      this.crackleActive = false;
      return;
    }

    // 4-second looping buffer with warm surface hiss + sparse dust pops
    const dur = 4.0;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Pink-ish warm floor
      const white = (Math.random() * 2 - 1) * 0.006;
      last = last * 0.86 + white * 0.14;
      // Occasional tiny dust tick
      const pop = Math.random() > 0.9986 ? (Math.random() * 2 - 1) * 0.095 : 0;
      data[i] = last + pop;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(320, ctx.currentTime);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(4200, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.setTargetAtTime(0.28, ctx.currentTime, 0.18);

    src.connect(hp).connect(lp).connect(gain).connect(ctx.destination);
    src.start();
    this.crackleNode = src;
    this.crackleGain = gain;
  }
}

export const vinylFoley = new VinylFoleyEngine();
