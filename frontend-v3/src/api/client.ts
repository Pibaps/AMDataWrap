import createClient from 'openapi-fetch'
import type { paths } from './schema'

export const apiClient = createClient<paths>({
  baseUrl: '',
})

export interface FilterState {
  period_mode: 'all' | 'year' | 'month' | 'season' | 'custom'
  year: number | null
  month: string | null
  season: string | null
  date_from: string | null
  date_to: string | null
  skip_mode: 'lastfm' | 'all' | 'custom'
  min_seconds: number
  min_completion_pct: number
  metric: 'ms' | 'plays'
  artist: string | null
  genre: string | null
  decade: number | null
  container_type: string | null
  device: string | null
  offline: string | null
}

export function buildFilterSearchParams(f: FilterState, extra?: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams()
  sp.set('period_mode', f.period_mode)
  if (f.year !== null) sp.set('year', String(f.year))
  if (f.month) sp.set('month', f.month)
  if (f.season) sp.set('season', f.season)
  if (f.date_from) sp.set('date_from', f.date_from)
  if (f.date_to) sp.set('date_to', f.date_to)
  sp.set('skip_mode', f.skip_mode)
  sp.set('min_seconds', String(f.min_seconds))
  sp.set('min_completion_pct', String(f.min_completion_pct))
  sp.set('metric', f.metric)
  if (f.artist) sp.set('artist', f.artist)
  if (f.genre) sp.set('genre', f.genre)
  if (f.decade !== null) sp.set('decade', String(f.decade))
  if (f.container_type) sp.set('container_type', f.container_type)
  if (f.device) sp.set('device', f.device)
  if (f.offline) sp.set('offline', f.offline)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
    }
  }
  return sp.toString()
}

export async function apiGet<T = any>(path: string, f?: FilterState, extra?: Record<string, string | number | undefined | null>): Promise<T> {
  const qs = f ? buildFilterSearchParams(f, extra) : extra ? new URLSearchParams(
    Object.entries(extra).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])
  ).toString() : ''
  const url = qs ? `${path}?${qs}` : path
  const resp = await fetch(url)
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`
    try {
      const err = await resp.json()
      msg = err.message || err.detail || msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return resp.json() as Promise<T>
}

export async function apiPost<T = any>(path: string, body?: unknown, f?: FilterState): Promise<T> {
  const qs = f ? buildFilterSearchParams(f) : ''
  const url = qs ? `${path}?${qs}` : path
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`
    try {
      const err = await resp.json()
      msg = err.message || err.detail || msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return resp.json() as Promise<T>
}
