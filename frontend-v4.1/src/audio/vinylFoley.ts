/**
 * Procedural Web Audio mechanical sound effects + AudioWorklet vinyl crackle synthesis
 * for AMDataWrap V4.1 ("Salon d'écoute").
 *
 * V4.1 Extreme Memory & CPU Optimizations (PDF p. 11, 39-43):
 * - Replaces 4s stereo AudioBuffer reallocations (~1500 KiB) with an inline `AudioWorklet`
 *   loaded via `Blob` (`type: 'application/javascript'`, immediately revoked via `URL.revokeObjectURL()`
 *   to avoid Vite's `.ts?url` `video/mp2t` MIME issue).
 * - Paul Kellet refined pink-noise filter (7 floats b0..b6, 512 bytes per 128-sample quantum)
 *   + deterministic LCG micro-crackle generator.
 * - Single cached 2s mono fallback buffer (375 KiB) if AudioWorklet is unavailable.
 * - Single pooled short noise transient buffer (~0.4s mono) reused across foley hits (0 heap churn).
 * - Automatic `ctx.suspend()` 400 ms after crackle stops & transients end (0% idle audio CPU).
 */

const WORKLET_CODE = `
class VinylCrackleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.b0 = 0; this.b1 = 0; this.b2 = 0;
    this.b3 = 0; this.b4 = 0; this.b5 = 0; this.b6 = 0;
    this.seed = 0x51a7c3d9;
  }
  nextRand() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return (this.seed / 4294967296) * 2.0 - 1.0;
  }
  process(_inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    for (let i = 0; i < out.length; i++) {
      const white = this.nextRand();
      // Paul Kellet refined pink noise filter
      this.b0 = 0.99886 * this.b0 + white * 0.0555179;
      this.b1 = 0.99332 * this.b1 + white * 0.0750759;
      this.b2 = 0.96900 * this.b2 + white * 0.1538520;
      this.b3 = 0.86650 * this.b3 + white * 0.3104856;
      this.b4 = 0.55000 * this.b4 + white * 0.5329522;
      this.b5 = -0.7616 * this.b5 - white * 0.0168980;
      const pink = (this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362) * 0.0028;
      this.b6 = white * 0.115926;

      // Sparse surface dust micro-crackle
      const r2 = this.nextRand();
      let pop = 0;
      if (r2 > 0.9974) {
        pop = (r2 - 0.9974) * 38.0 * (this.nextRand() > 0 ? 1 : -1);
      }
      out[i] = pink + pop;
    }
    return true;
  }
}
registerProcessor('vinyl-crackle-processor', VinylCrackleProcessor);
`;

class VinylFoleyEngine {
  private ctx: AudioContext | null = null;
  private workletLoaded = false;
  private workletLoading: Promise<boolean> | null = null;
  private crackleNode: AudioNode | null = null;
  private crackleGain: GainNode | null = null;
  private crackleActive = false;
  private fallbackCrackleBuf: AudioBuffer | null = null;
  private transientNoiseBuf: AudioBuffer | null = null;
  private suspendTimer: number | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.suspendTimer !== null) {
      window.clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private scheduleAutoSuspend(delayMs = 420): void {
    if (this.crackleActive || !this.ctx) return;
    if (this.suspendTimer !== null) window.clearTimeout(this.suspendTimer);
    this.suspendTimer = window.setTimeout(() => {
      this.suspendTimer = null;
      if (!this.crackleActive && this.ctx && this.ctx.state === "running") {
        this.ctx.suspend().catch(() => {});
      }
    }, delayMs);
  }

  /** Pooled short mono noise buffer (0.4s) reused across all mechanical transients. */
  private getTransientNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.transientNoiseBuf && this.transientNoiseBuf.sampleRate === ctx.sampleRate) {
      return this.transientNoiseBuf;
    }
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 0x13579bdf;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    this.transientNoiseBuf = buf;
    return buf;
  }

  private async ensureWorklet(ctx: AudioContext): Promise<boolean> {
    if (this.workletLoaded) return true;
    if (!ctx.audioWorklet || typeof Blob === "undefined") return false;
    if (!this.workletLoading) {
      const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      this.workletLoading = ctx.audioWorklet
        .addModule(url)
        .then(() => {
          this.workletLoaded = true;
          return true;
        })
        .catch(() => false)
        .finally(() => {
          URL.revokeObjectURL(url);
        });
    }
    return this.workletLoading;
  }

  /** Heavy Technics START/STOP spring switch clunk. */
  public playStartStopButton(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(340, now);
    osc1.frequency.exponentialRampToValueAtTime(95, now + 0.032);
    g1.gain.setValueAtTime(0.14, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    osc1.connect(g1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.038);

    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1180, now + 0.022);
    osc2.frequency.exponentialRampToValueAtTime(420, now + 0.048);
    g2.gain.setValueAtTime(0.06, now + 0.022);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc2.connect(g2).connect(ctx.destination);
    osc2.start(now + 0.022);
    osc2.stop(now + 0.052);
    this.scheduleAutoSuspend(450);
  }

  /** Crisp high-pitch micro-switch click for 33 / 45 RPM speed buttons. */
  public playRpmMicroSwitch(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1650, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.018);
    gain.gain.setValueAtTime(0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.022);
    this.scheduleAutoSuspend(450);
  }

  /** Rotary power switch snap. */
  public playPowerToggle(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.04);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.048);
    this.scheduleAutoSuspend(450);
  }

  /** Subtle metallic detent tick when dragging the physical volume fader. */
  public playFaderDetent(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2200, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.009);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.011);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.012);
    this.scheduleAutoSuspend(450);
  }

  /** Acrylic dust lid hinge movement + rubber bumper contact. */
  public playLidHinge(enabled: boolean, opening: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(opening ? 140 : 210, now);
    osc.frequency.exponentialRampToValueAtTime(opening ? 240 : 75, now + 0.14);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
    this.scheduleAutoSuspend(450);
  }

  /** Dull hollow acrylic tap when clicking a control blocked by the closed dust cover. */
  public playLidBlocked(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(290, now);
    osc.frequency.exponentialRampToValueAtTime(115, now + 0.055);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
    this.scheduleAutoSuspend(450);
  }

  /** Brass lamp switch click. */
  public playLampSwitch(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1420, now);
    osc.frequency.exponentialRampToValueAtTime(380, now + 0.025);
    gain.gain.setValueAtTime(0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.03);
    this.scheduleAutoSuspend(450);
  }

  /** Soft felt slipmat thud when placing a 12" vinyl disc onto the platter. */
  public playRecordPlace(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(125, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.09);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
    this.scheduleAutoSuspend(450);
  }

  /** Generic UI click (kept for compatibility). */
  public playClick(enabled: boolean): void {
    this.playRpmMicroSwitch(enabled);
  }

  public playSleeveSlide(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.getTransientNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(680, now);
    filter.Q.setValueAtTime(1.25, now);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.11, now + 0.07);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    src.connect(filter).connect(env).connect(ctx.destination);
    src.start(now, 0, 0.25);
    this.scheduleAutoSuspend(500);
  }

  public playCrateFlip(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.getTransientNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1250, now);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.12, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    src.connect(filter).connect(env).connect(ctx.destination);
    src.start(now, 0.05, 0.15);

    const thud = ctx.createOscillator();
    const tg = ctx.createGain();
    thud.type = "sine";
    thud.frequency.setValueAtTime(160, now);
    thud.frequency.exponentialRampToValueAtTime(58, now + 0.035);
    tg.gain.setValueAtTime(0.14, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    thud.connect(tg).connect(ctx.destination);
    thud.start(now);
    thud.stop(now + 0.045);
    this.scheduleAutoSuspend(450);
  }

  public playNeedleDrop(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.getTransientNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2900, now);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.045, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    src.connect(filter).connect(env).connect(ctx.destination);
    src.start(now, 0, 0.36);

    const thump = ctx.createOscillator();
    const tg = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(175, now);
    thump.frequency.exponentialRampToValueAtTime(48, now + 0.055);
    tg.gain.setValueAtTime(0.24, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    thump.connect(tg).connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.07);
    this.scheduleAutoSuspend(520);
  }

  public setCrackleLoop(shouldPlay: boolean): void {
    if (shouldPlay === this.crackleActive) return;
    this.crackleActive = shouldPlay;

    if (!shouldPlay) {
      if (this.crackleGain && this.ctx) {
        const now = this.ctx.currentTime;
        this.crackleGain.gain.setTargetAtTime(0.0001, now, 0.06);
      }
      if (this.crackleNode) {
        const node = this.crackleNode;
        this.crackleNode = null;
        window.setTimeout(() => {
          try {
            if ("stop" in node && typeof (node as AudioBufferSourceNode).stop === "function") {
              (node as AudioBufferSourceNode).stop();
            }
            node.disconnect();
          } catch {
            /* ignore */
          }
        }, 200);
      }
      this.scheduleAutoSuspend(400);
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) {
      this.crackleActive = false;
      return;
    }

    this.startCrackleAsync(ctx);
  }

  private async startCrackleAsync(ctx: AudioContext): Promise<void> {
    const ok = await this.ensureWorklet(ctx);
    if (!this.crackleActive) return;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(320, ctx.currentTime);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(4200, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.setTargetAtTime(0.28, ctx.currentTime, 0.16);

    if (ok && typeof AudioWorkletNode !== "undefined") {
      try {
        const node = new AudioWorkletNode(ctx, "vinyl-crackle-processor", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.connect(hp).connect(lp).connect(gain).connect(ctx.destination);
        this.crackleNode = node;
        this.crackleGain = gain;
        return;
      } catch {
        /* fall through to cached 2s mono fallback */
      }
    }

    // Fallback: single cached 2s mono buffer (~375 KiB)
    if (!this.fallbackCrackleBuf || this.fallbackCrackleBuf.sampleRate !== ctx.sampleRate) {
      const len = Math.floor(ctx.sampleRate * 2.0);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = (Math.random() * 2 - 1) * 0.006;
        last = last * 0.86 + white * 0.14;
        const pop = Math.random() > 0.9986 ? (Math.random() * 2 - 1) * 0.095 : 0;
        data[i] = last + pop;
      }
      this.fallbackCrackleBuf = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.fallbackCrackleBuf;
    src.loop = true;
    src.connect(hp).connect(lp).connect(gain).connect(ctx.destination);
    src.start();
    this.crackleNode = src;
    this.crackleGain = gain;
  }
}

export const vinylFoley = new VinylFoleyEngine();
