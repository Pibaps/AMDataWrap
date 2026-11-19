export interface AudioBands {
  bass: number // 0..1
  mid: number // 0..1
  treble: number // 0..1
  energy: number // 0..1
  bins: Uint8Array
}

class ReactiveAudioEngine {
  public audio: HTMLAudioElement
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private dataArray: Uint8Array<ArrayBuffer> = new Uint8Array(64)
  private connected = false

  constructor() {
    this.audio = new Audio()
    this.audio.crossOrigin = 'anonymous'
    this.audio.volume = 0.78
  }

  private ensureContext() {
    if (this.connected) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {})
      }
      return
    }
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      this.ctx = new AudioCtx()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 128
      this.analyser.smoothingTimeConstant = 0.82
      this.source = this.ctx.createMediaElementSource(this.audio)
      this.source.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount)
      this.connected = true
    } catch {
      // Fallback gracefully if AudioContext cannot attach
    }
  }

  public playUrl(rawUrl: string) {
    this.ensureContext()
    const proxied = `/api/audio-proxy?url=${encodeURIComponent(rawUrl)}`
    this.audio.src = proxied
    this.audio.play().catch(() => {
      // Fallback to direct URL if proxy fails
      this.audio.src = rawUrl
      this.audio.play().catch(() => {})
    })
  }

  public toggle() {
    this.ensureContext()
    if (this.audio.paused) {
      this.audio.play().catch(() => {})
    } else {
      this.audio.pause()
    }
  }

  public stop() {
    this.audio.pause()
    this.audio.currentTime = 0
  }

  public getBands(): AudioBands {
    if (!this.analyser || this.audio.paused) {
      this.dataArray.fill(0)
      return { bass: 0, mid: 0, treble: 0, energy: 0, bins: this.dataArray }
    }
    this.analyser.getByteFrequencyData(this.dataArray)
    const n = this.dataArray.length // 64 bins
    let bassSum = 0
    let midSum = 0
    let trebSum = 0
    for (let i = 0; i < 8; i++) bassSum += this.dataArray[i]
    for (let i = 8; i < 28; i++) midSum += this.dataArray[i]
    for (let i = 28; i < n; i++) trebSum += this.dataArray[i]

    const bass = bassSum / (8 * 255)
    const mid = midSum / (20 * 255)
    const treble = trebSum / ((n - 28) * 255)
    const energy = bass * 0.5 + mid * 0.35 + treble * 0.15
    return { bass, mid, treble, energy, bins: this.dataArray }
  }
}

export const reactiveAudio = new ReactiveAudioEngine()
