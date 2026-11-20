/**
 * Procedural Web Audio mechanical sound effects + continuous analog vinyl crackle
 * for the 3D Vinyl Studio ("Salon d'écoute").
 *
 * Every physical interaction in the 3D room has its own distinct, logical acoustic signature:
 * - `playStartStopButton`: Heavy spring-loaded mechanical switch clunk (START · STOP)
 * - `playRpmMicroSwitch`: Crisp high-pitch tactile micro-switch click (33 / 45 RPM)
 * - `playPowerToggle`: Rotary power knob snap
 * - `playFaderDetent`: Soft metallic center-detent tick when sliding the volume/pitch fader
 * - `playLidHinge`: Acrylic dust cover hinge creak + soft rubber bumper thud
 * - `playLampSwitch`: Warm brass pull-chain / toggle click
 * - `playCrateFlip`: Wooden crate cardboard-against-cardboard flip thud
 * - `playSleeveSlide`: Paper-on-cardboard friction slide when pulling a jacket out or flipping recto/verso
 * - `playRecordPlace`: Soft felt slipmat thud when placing the 12" vinyl onto the platter
 * - `playNeedleDrop`: Stylus contact thump + initial vinyl groove hiss
 * - `setCrackleLoop`: Continuous subtle analog vinyl surface crackle (scaled by turntable volume)
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

  /** Heavy Technics START/STOP spring switch clunk (dual transient: down-click + spring release). */
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
  }

  /** Subtle metallic detent tick when dragging the physical volume fader on the plinth. */
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
  }

  /** Generic UI click (kept for compatibility). */
  public playClick(enabled: boolean): void {
    this.playRpmMicroSwitch(enabled);
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

    const dur = 4.0;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = (Math.random() * 2 - 1) * 0.006;
      last = last * 0.86 + white * 0.14;
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
