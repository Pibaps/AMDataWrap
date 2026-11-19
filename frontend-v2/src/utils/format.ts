export function formatDurationMs(ms: number | null | undefined, compact = false): string {
  if (!ms || ms <= 0) return compact ? '0m' : '0 min'
  const totalSec = Math.round(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (hours >= 24 && compact) return `${hours.toLocaleString('fr-FR')}h`
  if (hours > 0) {
    return compact ? `${hours}h${mins > 0 ? String(mins).padStart(2, '0') : ''}` : `${hours} h ${mins} min`
  }
  if (mins > 0) return compact ? `${mins}m` : `${mins} min`
  return `${secs}s`
}

export function formatTrackDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '0:00'
  const totalSec = Math.round(ms / 1000)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '0'
  return n.toLocaleString('fr-FR')
}

export function formatDateFr(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  try {
    const d = new Date(isoDate.length === 10 ? `${isoDate}T12:00:00` : isoDate)
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return isoDate
  }
}

export function formatMonthFr(ym: string): string {
  if (!ym || ym.length < 7) return ym
  const [y, m] = ym.split('-')
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']
  return `${months[Math.max(0, parseInt(m, 10) - 1)] || m} ${y}`
}

export async function extractPaletteFromArtwork(artworkUrl: string): Promise<[string, string, string] | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 24
        canvas.height = 24
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, 24, 24)
        const data = ctx.getImageData(0, 0, 24, 24).data
        const buckets: { r: number; g: number; b: number; score: number }[] = []
        for (let i = 0; i < data.length; i += 16) {
          const r = data[i], g = data[i + 1], b = data[i + 2]
          const max = Math.max(r, g, b), min = Math.min(r, g, b)
          const sat = max === 0 ? 0 : (max - min) / max
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
          if (lum > 0.14 && lum < 0.86 && sat > 0.22) {
            buckets.push({ r, g, b, score: sat * (1 - Math.abs(lum - 0.5)) })
          }
        }
        if (buckets.length < 3) return resolve(null)
        buckets.sort((a, b) => b.score - a.score)
        const toHex = (c: { r: number; g: number; b: number }) =>
          `#${[c.r, c.g, c.b].map((v) => Math.min(255, Math.round(v * 1.12)).toString(16).padStart(2, '0')).join('')}`
        resolve([toHex(buckets[0]), toHex(buckets[Math.floor(buckets.length * 0.35)]), toHex(buckets[Math.floor(buckets.length * 0.7)])])
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = `/api/artwork-proxy?url=${encodeURIComponent(artworkUrl)}`
  })
}
