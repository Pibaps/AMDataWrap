/**
 * OffscreenCanvas 60 FPS Audio Visualizer Web Worker (Phase 3 · PDF p. 14).
 * Renders Braun/OP-1 Field Oscilloscope + Segmented VU-Meters, Editorial Spectral Ribbon,
 * or Observatory Harmonic Bars completely off the React main thread!
 */

let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let width = 300
let height = 44
let mode: 'field' | 'editorial' | 'observatory' = 'field'
let accent = '#d46d3d'
let accent2 = '#528bc4'
let trackBg = '#1e2023'
let mutedCol = '#494e56'

let bins = new Float32Array(32)
let waveform = new Float32Array(64)
let rmsL = 0
let rmsR = 0
let playing = false

function draw() {
  if (!ctx || !canvas) return
  const c = ctx
  c.clearRect(0, 0, width, height)

  if (mode === 'field') {
    // Left half: Braun/OP-1 Field vector oscilloscope; Right half: 12-segment stereo VU-meters
    const oscW = Math.floor(width * 0.56)
    c.strokeStyle = mutedCol
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(0, height / 2)
    c.lineTo(oscW - 6, height / 2)
    c.stroke()

    c.strokeStyle = accent
    c.lineWidth = 1.6
    c.beginPath()
    const n = waveform.length
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * (oscW - 8)
      const amp = playing ? waveform[i] : 0
      const y = height / 2 + amp * (height * 0.42)
      if (i === 0) c.moveTo(x, y)
      else c.lineTo(x, y)
    }
    c.stroke()

    // Segmented stereo VU-meters
    const vuX = oscW + 4
    const vuW = width - vuX - 2
    const segs = 12
    const segW = Math.max(3, Math.floor((vuW - (segs - 1) * 2) / segs))
    const drawRow = (y: number, level: number) => {
      const lit = Math.round(Math.min(1, level * 1.4) * segs)
      for (let s = 0; s < segs; s++) {
        const x = vuX + s * (segW + 2)
        if (s < lit) {
          c.fillStyle = s >= 10 ? '#cf6b6b' : s >= 8 ? '#c89446' : '#5db08a'
        } else {
          c.fillStyle = trackBg
        }
        c.fillRect(x, y, segW, 7)
      }
    }
    drawRow(height / 2 - 9, playing ? rmsL : 0)
    drawRow(height / 2 + 2, playing ? rmsR : 0)
    return
  }

  if (mode === 'editorial') {
    // Clean minimal Swiss spectral line
    const n = bins.length
    ctx.strokeStyle = accent2
    ctx.lineWidth = 1.6
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * width
      const v = playing ? bins[i] : 0.04
      const y = height - 4 - v * (height - 10)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    return
  }

  // Observatory: calm 28-bar desaturated harmonic equalizer
  const bars = 28
  const gap = 2
  const barW = Math.max(2, (width - (bars - 1) * gap) / bars)
  for (let i = 0; i < bars; i++) {
    const v = playing ? Math.max(0.06, bins[i] || 0) : 0.06
    const bh = Math.max(3, v * (height - 6))
    ctx.fillStyle = i % 2 === 0 ? accent : accent2
    ctx.fillRect(i * (barW + gap), height - bh - 2, barW, bh)
  }
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data
  if (msg.type === 'init') {
    canvas = msg.canvas as OffscreenCanvas
    width = msg.width
    height = msg.height
    canvas.width = width
    canvas.height = height
    ctx = canvas.getContext('2d')
    draw()
  } else if (msg.type === 'style') {
    mode = msg.mode
    accent = msg.accent
    accent2 = msg.accent2
    trackBg = msg.trackBg
    mutedCol = msg.mutedCol
    draw()
  } else if (msg.type === 'frame') {
    bins = msg.bins
    waveform = msg.waveform
    rmsL = msg.rmsL
    rmsR = msg.rmsR
    playing = msg.playing
    draw()
  }
}
