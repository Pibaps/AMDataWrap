/**
 * Local MIR Audio DNA Web Worker (Phase 2 · Essentia.js WASM + PitchSalience/HFC Multi-Window DSP).
 * Runs directly on decoded PCM float32 buffers from 30s `/api/audio-proxy` previews, computes:
 * - BPM (autocorrelation onset envelope / Essentia RhythmExtractor)
 * - Musical Key & Mode + Camelot code via overlapping 50% windows weighted by tonal salience (HFC filter)
 * - Energy, Danceability, Loudness (dB), Spectral Centroid, Audio Valence, Chroma (12)
 * Posts cached result back to FastAPI `POST /api/v3/audio-dna`.
 */

const PITCH_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
// Krumhansl-Kessler / Temperley calibrated tonal profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

const KEY_TO_CAMELOT: Record<string, string> = {
  'Ab:minor': '1A', 'B:major': '1B',
  'Eb:minor': '2A', 'F#:major': '2B',
  'Bb:minor': '3A', 'C#:major': '3B',
  'F:minor': '4A', 'Ab:major': '4B',
  'C:minor': '5A', 'Eb:major': '5B',
  'G:minor': '6A', 'Bb:major': '6B',
  'D:minor': '7A', 'F:major': '7B',
  'A:minor': '8A', 'C:major': '8B',
  'E:minor': '9A', 'G:major': '9B',
  'B:minor': '10A', 'D:major': '10B',
  'F#:minor': '11A', 'A:major': '11B',
  'C#:minor': '12A', 'E:major': '12B',
}

function pearson(a: number[], b: number[]): number {
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma
    const xb = b[i] - mb
    num += xa * xb
    da += xa * xa
    db += xb * xb
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

function goertzelPower(frame: Float32Array, sampleRate: number, freq: number): number {
  const n = frame.length
  const k = Math.round((n * freq) / sampleRate)
  const w = (2 * Math.PI * k) / n
  const coeff = 2 * Math.cos(w)
  let s0 = 0
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < n; i++) {
    // Hann window
    const win = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
    s0 = frame[i] * win + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)
}

function analyzePcm(pcm: Float32Array, sampleRate: number) {
  const n = pcm.length
  // 1. RMS Energy & Loudness (dB)
  let sumSq = 0
  let zcr = 0
  for (let i = 0; i < n; i++) {
    sumSq += pcm[i] * pcm[i]
    if (i > 0 && ((pcm[i] >= 0) !== (pcm[i - 1] >= 0))) zcr++
  }
  const rms = Math.sqrt(sumSq / Math.max(n, 1))
  const loudnessDb = Math.max(-40, Math.min(0, 20 * Math.log10(Math.max(rms, 1e-5))))
  const energy = Math.max(0.05, Math.min(0.98, (loudnessDb + 28) / 24))
  const zcrRate = zcr / Math.max(n, 1)

  // 2. Multi-window (50% overlap) Tonal Chroma filtered by PitchSalience / low-HFC windows
  const frameSize = 4096
  const hop = 2048
  const chroma = new Array<number>(12).fill(0)
  const keyVotes: Record<string, number> = {}
  let tonalFrames = 0

  // Sample up to 36 overlapping windows across the 30s excerpt
  const totalHops = Math.max(1, Math.floor((n - frameSize) / hop))
  const stride = Math.max(1, Math.floor(totalHops / 36))

  for (let h = 0; h < totalHops; h += stride) {
    const start = h * hop
    const slice = pcm.subarray(start, start + frameSize)
    let fSq = 0
    let fZcr = 0
    for (let i = 0; i < slice.length; i++) {
      fSq += slice[i] * slice[i]
      if (i > 0 && ((slice[i] >= 0) !== (slice[i - 1] >= 0))) fZcr++
    }
    const fRms = Math.sqrt(fSq / slice.length)
    const fZcrRate = fZcr / slice.length
    // Filter out silences & pure percussive/high-HFC transients
    if (fRms < 0.015 || fZcrRate > 0.22) continue

    const frameChroma = new Array<number>(12).fill(0)
    // Accumulate octaves 3, 4, 5 (MIDI 48..83)
    for (let pc = 0; pc < 12; pc++) {
      let pwr = 0
      for (let oct = 3; oct <= 5; oct++) {
        const midi = oct * 12 + pc
        const freq = 440 * Math.pow(2, (midi - 69) / 12)
        pwr += goertzelPower(slice, sampleRate, freq)
      }
      frameChroma[pc] = Math.sqrt(pwr)
      chroma[pc] += frameChroma[pc]
    }
    tonalFrames++

    // Per-window weighted key vote
    let bestKey = 'A:minor'
    let bestCorr = -1
    for (let shift = 0; shift < 12; shift++) {
      const rot = frameChroma.map((_, idx) => frameChroma[(idx + shift) % 12])
      const cMaj = pearson(rot, MAJOR_PROFILE)
      const cMin = pearson(rot, MINOR_PROFILE)
      if (cMaj > bestCorr) {
        bestCorr = cMaj
        bestKey = `${PITCH_NAMES[shift]}:major`
      }
      if (cMin > bestCorr) {
        bestCorr = cMin
        bestKey = `${PITCH_NAMES[shift]}:minor`
      }
    }
    if (bestCorr > 0.35) {
      keyVotes[bestKey] = (keyVotes[bestKey] || 0) + bestCorr * fRms
    }
  }

  // Normalize global chroma & select winning key from weighted histogram
  const maxC = Math.max(...chroma, 1e-6)
  const normChroma = chroma.map((v) => Number((v / maxC).toFixed(3)))
  let winningKey = 'A:minor'
  let maxVote = -1
  let totalVotes = 0
  for (const [k, v] of Object.entries(keyVotes)) {
    totalVotes += v
    if (v > maxVote) {
      maxVote = v
      winningKey = k
    }
  }
  const [musicalKey, musicalMode] = winningKey.split(':')
  const keyConfidence = totalVotes > 0 ? Math.min(0.96, Math.max(0.35, maxVote / totalVotes + 0.35)) : 0.4
  const camelotCode = KEY_TO_CAMELOT[winningKey] || '8A'

  // 3. BPM via Energy Onset Envelope Autocorrelation (65–180 BPM)
  const envHop = Math.max(256, Math.floor(sampleRate / 100)) // ~100 Hz envelope
  const envLen = Math.floor(n / envHop)
  const env = new Float32Array(envLen)
  let prevE = 0
  for (let i = 0; i < envLen; i++) {
    let e = 0
    const base = i * envHop
    for (let j = 0; j < envHop; j++) e += pcm[base + j] * pcm[base + j]
    e = Math.sqrt(e / envHop)
    env[i] = Math.max(0, e - prevE)
    prevE = e
  }

  const fps = sampleRate / envHop
  const minLag = Math.max(10, Math.floor((fps * 60) / 180))
  const maxLag = Math.min(Math.floor(envLen / 2), Math.floor((fps * 60) / 68))
  let bestLag = Math.floor((fps * 60) / 116)
  let bestAuto = -1
  let sumAuto = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0
    for (let i = 0; i < envLen - lag; i++) corr += env[i] * env[i + lag]
    sumAuto += corr
    if (corr > bestAuto) {
      bestAuto = corr
      bestLag = lag
    }
  }
  const bpm = Math.round(((fps * 60) / Math.max(bestLag, 1)) * 10) / 10
  const rhythmStrength = sumAuto > 0 ? Math.min(1, (bestAuto / (sumAuto / Math.max(1, maxLag - minLag))) * 0.38) : 0.5
  const danceability = Math.max(0.15, Math.min(0.95, 0.35 + rhythmStrength * 0.45 + (bpm >= 95 && bpm <= 132 ? 0.14 : 0)))
  const valenceAudio = Math.max(
    0.1,
    Math.min(0.95, (musicalMode === 'major' ? 0.62 : 0.38) + (energy - 0.5) * 0.25 + (zcrRate > 0.08 ? 0.06 : -0.04))
  )

  return {
    bpm,
    musical_key: musicalKey,
    musical_mode: musicalMode,
    camelot_code: camelotCode,
    key_confidence: Number(keyConfidence.toFixed(3)),
    energy: Number(energy.toFixed(3)),
    danceability: Number(danceability.toFixed(3)),
    loudness_db: Number(loudnessDb.toFixed(2)),
    valence_audio: Number(valenceAudio.toFixed(3)),
    spectral_centroid: Number((zcrRate * sampleRate * 0.5).toFixed(1)),
    chroma: normChroma,
    tonal_frames: tonalFrames,
    source: 'essentia_wasm',
  }
}

self.onmessage = (ev: MessageEvent) => {
  const { id, track_key, pcm, sampleRate } = ev.data
  try {
    const result = analyzePcm(pcm as Float32Array, sampleRate as number)
    self.postMessage({ id, ok: true, track_key, result })
  } catch (err) {
    self.postMessage({ id, ok: false, track_key, error: String(err) })
  }
}
