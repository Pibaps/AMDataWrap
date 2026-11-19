import { FilterState } from '../types'

export function buildFilterQuery(f: FilterState, extra?: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams()
  params.set('period_mode', f.period_mode)
  if (f.year !== null) params.set('year', String(f.year))
  if (f.month) params.set('month', f.month)
  if (f.season) params.set('season', f.season)
  if (f.date_from) params.set('date_from', f.date_from)
  if (f.date_to) params.set('date_to', f.date_to)
  params.set('skip_mode', f.skip_mode)
  params.set('min_seconds', String(f.min_seconds))
  params.set('min_completion_pct', String(f.min_completion_pct))
  params.set('metric', f.metric)
  if (f.artist) params.set('artist', f.artist)
  if (f.genre) params.set('genre', f.genre)
  if (f.decade !== null) params.set('decade', String(f.decade))
  if (f.container_type) params.set('container_type', f.container_type)
  if (f.feature_name) params.set('feature_name', f.feature_name)
  if (f.device) params.set('device', f.device)
  if (f.offline) params.set('offline', f.offline)

  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== null && v !== undefined && v !== '') {
        params.set(k, String(v))
      }
    }
  }
  return params.toString()
}

export async function apiGet<T = any>(path: string, f?: FilterState, extra?: Record<string, string | number | null | undefined>): Promise<T> {
  const qs = f ? buildFilterQuery(f, extra) : ''
  const url = qs ? `${path}?${qs}` : path
  const res = await fetch(url)
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(txt || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function uploadZipFile(file: File): Promise<any> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/import', { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erreur import ZIP' }))
    throw new Error(err.detail || 'Erreur import ZIP')
  }
  return res.json()
}

export function proxyArtworkUrl(url?: string | null): string | undefined {
  if (!url) return undefined
  return `/api/artwork-proxy?url=${encodeURIComponent(url)}`
}
