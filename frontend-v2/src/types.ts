export type PeriodMode = 'all' | 'year' | 'month' | 'season' | 'custom'
export type SkipMode = 'lastfm' | 'all' | 'custom'
export type MetricMode = 'ms' | 'plays'

export interface FilterState {
  period_mode: PeriodMode
  year: number | null
  month: string | null
  season: string | null
  date_from: string | null
  date_to: string | null
  skip_mode: SkipMode
  min_seconds: number
  min_completion_pct: number
  metric: MetricMode
  artist: string | null
  genre: string | null
  decade: number | null
  container_type: string | null
  feature_name: string | null
  device: string | null
  offline: string | null
}

export const DEFAULT_FILTERS: FilterState = {
  period_mode: 'all',
  year: null,
  month: null,
  season: null,
  date_from: null,
  date_to: null,
  skip_mode: 'lastfm',
  min_seconds: 30,
  min_completion_pct: 50,
  metric: 'ms',
  artist: null,
  genre: null,
  decade: null,
  container_type: null,
  feature_name: null,
  device: null,
  offline: null,
}

export interface EnrichmentState {
  running: boolean
  phase: string
  total: number
  completed: number
  enriched: number
  not_found: number
  with_artwork?: number
  with_artist?: number
  with_year?: number
  current_track: string | null
  last_update: string | null
  version: number
}

export interface AudioPreviewTrack {
  song_name: string
  artist_name?: string | null
  album_name?: string | null
  artwork_url?: string | null
  preview_url: string
}

export interface DrawerTarget {
  type: 'artist' | 'album' | 'day'
  id: string
  title?: string
}

export interface FilterOptions {
  meta: {
    zip_filename: string
    imported_at: string
    total_raw_rows: number
    total_play_events: number
    total_lyric_events: number
    total_search_events: number
    unique_tracks: number
    pass1_artist_pct: number
    pass1_genre_year_pct: number
    min_date: string
    max_date: string
  } | null
  years: number[]
  months: string[]
  seasons: string[]
  genres: string[]
  decades: number[]
  artists: { key: string; name: string }[]
  containers: string[]
  features: string[]
  devices: string[]
}
