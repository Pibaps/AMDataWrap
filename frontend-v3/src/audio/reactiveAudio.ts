/**
 * Reactive Web Audio Engine + Essentia.js WASM Audio DNA Dispatcher.
 * Updates off-React `audioTelemetryRef` at 60 FPS with ZERO React state mutations.
 */

import { apiPost } from '../api/client'
import { audioTelemetryRef, usePlayerStore, type PlayingTrack } from '../store/playerStore'
import { audioProxyUrl } from '../utils/apca'

class ReactiveAudioEngine {
  private audio: HTMLAudioElement | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private freqBuf: Uint8Array<ArrayBuffer> | null = null
  private waveBuf: Uint8Array<ArrayBuffer> | null = null
  private rafId: number | null = null
  private dnaWorker: Worker | null = null
  private analyzedKeys = new Set<string>()
  private frameListeners = new Set<() => void>()

  subscribeFrame(cb: () => void): () => void {
    this.frameListeners.add(cb)
    return () => this.frameListeners.delete(cb)
  }

  private ensureAudio() {
    if (this.audio) return
    this.audio = new Audio()
    this.audio.crossOrigin = 'anonymous'
    this.audio.preload = 'auto'
    this.audio.volume = usePlayerStore.getState().volume

    this.audio.addEventListener('play', () => {
      audioTelemetryRef.isPlaying = true
      usePlayerStore.getState().setIsPlaying(true)
      this.startLoop()
    })
    this.audio.addEventListener('pause', () => {
      audioTelemetryRef.isPlaying = false
      usePlayerStore.getState().setIsPlaying(false)
    })
    this.audio.addEventListener('ended', () => {
      audioTelemetryRef.isPlaying = false
      usePlayerStore.getState().setIsPlaying(false)
    })
    this.audio.addEventListener('timeupdate', () => {
      if (!this.audio) return
      audioTelemetryRef.progress = this.audio.currentTime || 0
      audioTelemetryRef.duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 30
    })
  }

  private ensureAnalyser() {
    if (!this.audio || this.analyser) return
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AC()
      const src = this.ctx.createMediaElementSource(this.audio)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 128
      this.analyser.smoothingTimeConstant = 0.78
      src.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)
      this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount)
      this.waveBuf = new Uint8Array(this.analyser.fftSize)
    } catch {
      /* AudioContext unavailable */
    }
  }

  private startLoop() {
    if (this.rafId !== null) return
    const tick = () => {
      if (!audioTelemetryRef.isPlaying) {
        this.rafId = null
        this.frameListeners.forEach((cb) => cb())
        return
      }
      if (this.analyser && this.freqBuf && this.waveBuf) {
        this.analyser.getByteFrequencyData(this.freqBuf)
        this.analyser.getByteTimeDomainData(this.waveBuf)

        let bass = 0
        let mid = 0
        let treble = 0
        for (let i = 0; i < 32; i++) {
          const v = (this.freqBuf[i] || 0) / 255
          audioTelemetryRef.bins[i] = v
          if (i < 6) bass += v
          else if (i < 18) mid += v
          else treble += v
        }
        audioTelemetryRef.bass = bass / 6
        audioTelemetryRef.mid = mid / 12
        audioTelemetryRef.treble = treble / 14

        let sq = 0
        for (let i = 0; i < 64; i++) {
          const s = ((this.waveBuf[i * 2] || 128) - 128) / 128
          audioTelemetryRef.waveform[i] = s
          sq += s * s
        }
        const rms = Math.sqrt(sq / 64)
        audioTelemetryRef.rmsL = Math.min(1, rms * 2.1 + audioTelemetryRef.bass * 0.25)
        audioTelemetryRef.rmsR = Math.min(1, rms * 1.9 + audioTelemetryRef.mid * 0.28)
      }
      this.frameListeners.forEach((cb) => cb())
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  async play(track: PlayingTrack) {
    this.ensureAudio()
    usePlayerStore.getState().setTrack(track)
    const proxied = audioProxyUrl(track.preview_url)
    if (!proxied || !this.audio) return

    this.ensureAnalyser()
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {})
    }
    if (this.audio.src !== new URL(proxied, window.location.origin).href) {
      this.audio.src = proxied
    }
    try {
      await this.audio.play()
    } catch {
      /* autoplay restriction */
    }

    // Automatically run local Audio DNA WASM worker if track_key is present and not yet scanned
    if (track.track_key && !this.analyzedKeys.has(track.track_key)) {
      void this.analyzePreviewUrl(track.track_key, proxied)
    }
  }

  togglePlayPause() {
    if (!this.audio) return
    if (this.audio.paused) {
      void this.audio.play().catch(() => {})
    } else {
      this.audio.pause()
    }
  }

  stop() {
    if (!this.audio) return
    this.audio.pause()
    this.audio.currentTime = 0
    audioTelemetryRef.isPlaying = false
    usePlayerStore.getState().setIsPlaying(false)
  }

  setVolume(vol: number) {
    usePlayerStore.getState().setVolume(vol)
    if (this.audio) this.audio.volume = vol
  }

  seek(pct: number) {
    if (!this.audio || !Number.isFinite(this.audio.duration)) return
    this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, pct * this.audio.duration))
  }

  private ensureDnaWorker(): Worker {
    if (!this.dnaWorker) {
      this.dnaWorker = new Worker(new URL('../workers/audioDna.worker.ts', import.meta.url), { type: 'module' })
    }
    return this.dnaWorker
  }

  async analyzePreviewUrl(trackKey: string, proxiedUrl: string): Promise<boolean> {
    try {
      const resp = await fetch(proxiedUrl)
      if (!resp.ok) return false
      const arrBuf = await resp.arrayBuffer()
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const decodeCtx = new AC()
      const audioBuf = await decodeCtx.decodeAudioData(arrBuf)
      const pcm = audioBuf.getChannelData(0).slice()
      const sampleRate = audioBuf.sampleRate
      await decodeCtx.close()

      const worker = this.ensureDnaWorker()
      const id = `${trackKey}:${Date.now()}`
      const dna: Record<string, unknown> = await new Promise((resolve, reject) => {
        const onMsg = (ev: MessageEvent) => {
          if (ev.data.id !== id) return
          worker.removeEventListener('message', onMsg)
          if (ev.data.ok) resolve(ev.data.result)
          else reject(new Error(ev.data.error))
        }
        worker.addEventListener('message', onMsg)
        worker.postMessage({ id, track_key: trackKey, pcm, sampleRate }, [pcm.buffer])
      })

      await apiPost('/api/v3/audio-dna', { track_key: trackKey, ...dna })
      this.analyzedKeys.add(trackKey)
      return true
    } catch {
      return false
    }
  }
}

export const reactiveAudio = new ReactiveAudioEngine()
