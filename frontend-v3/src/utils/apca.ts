/**
 * APCA (Advanced Perceptual Contrast Algorithm — WCAG 3 candidate) utilities
 * + automatic 15% desaturation of extracted artwork hues for eye comfort.
 */

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim()
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0')
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ]
}

function sRGBtoY(r: number, g: number, b: number): number {
  const lin = (c: number) => Math.pow(c / 255, 2.4)
  return 0.2126729 * lin(r) + 0.7151522 * lin(g) + 0.072175 * lin(b)
}

/**
 * Compute APCA Lightness Contrast (Lc) between foreground text and background hex.
 * Targets: |Lc| >= 60 large/bold titles, |Lc| >= 75 body copy, |Lc| >= 90 fine/mono KPIs.
 */
export function calcApcaLc(textHex: string, bgHex: string): number {
  const [tr, tg, tb] = parseHex(textHex)
  const [br, bg, bb] = parseHex(bgHex)
  let txtY = sRGBtoY(tr, tg, tb)
  let bgY = sRGBtoY(br, bg, bb)

  // Soft clamp near black
  const blkThrs = 0.022
  const blkClmp = 1.414
  if (txtY < blkThrs) txtY += Math.pow(blkThrs - txtY, blkClmp)
  if (bgY < blkThrs) bgY += Math.pow(blkThrs - bgY, blkClmp)

  if (Math.abs(bgY - txtY) < 0.0005) return 0

  let sapc = 0
  if (bgY > txtY) {
    // Dark text on light background (positive Lc)
    sapc = (Math.pow(bgY, 0.56) - Math.pow(txtY, 0.57)) * 1.14
    return Math.round((sapc < 0.1 ? 0 : sapc - 0.027) * 100)
  } else {
    // Light text on dark background (negative Lc)
    sapc = (Math.pow(bgY, 0.65) - Math.pow(txtY, 0.62)) * 1.14
    return Math.round((sapc > -0.1 ? 0 : sapc + 0.027) * 100)
  }
}

/**
 * Automatically desaturate artwork colors by 15% and clamp lightness for anti-halation comfort.
 */
export function desaturateForTheme(hex: string, reduction = 0.16): string {
  const [r0, g0, b0] = parseHex(hex)
  const r = r0 / 255
  const g = g0 / 255
  const b = b0 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  let l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }

  s = Math.max(0.18, Math.min(0.62, s * (1 - reduction)))
  l = Math.max(0.42, Math.min(0.66, l))

  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const rr = Math.round(hue2rgb(p, q, h + 1 / 3) * 255)
  const gg = Math.round(hue2rgb(p, q, h) * 255)
  const bb = Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`
}

export function formatHours(ms: number | undefined | null): string {
  const hrs = (ms || 0) / 3_600_000
  if (hrs >= 100) return `${hrs.toFixed(0)} h`
  if (hrs >= 10) return `${hrs.toFixed(1)} h`
  return `${hrs.toFixed(2)} h`
}

export function formatDurationMs(ms: number | undefined | null): string {
  const totalSec = Math.max(0, Math.floor((ms || 0) / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatNumber(n: number | undefined | null): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))
}

export function artworkProxyUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith('/api/')) return url
  return `/api/artwork-proxy?url=${encodeURIComponent(url)}`
}

export function audioProxyUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith('/api/')) return url
  return `/api/audio-proxy?url=${encodeURIComponent(url)}`
}
