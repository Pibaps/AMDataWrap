/**
 * Strict TypeScript API contracts for AMDataWrap V4.5.
 * Matches backend/app/routers/* and backend/app/analytics/* responses.
 */

export interface HealthData {
  status: string;
  version: string;
  has_data: boolean;
  meta: Record<string, any> | null;
  enrichment: EnrichmentSnapshot;
  parquet_snapshot: {
    exists: boolean;
    path: string;
    rows: number;
    exported_at: string | null;
    size_bytes: number;
  };
  jobs: {
    running: boolean;
    pending: number;
    completed: number;
    failed: number;
  };
}

export interface EnrichmentSnapshot {
  running: boolean;
  phase: string;
  total: number;
  completed: number;
  enriched: number;
  not_found: number;
  with_artwork?: number;
  with_artist?: number;
  with_year?: number;
  current_track: string | null;
  last_update: string | null;
  version: number;
}

export interface JobsStatusData {
  jobs: {
    running: boolean;
    pending: number;
    completed: number;
    failed: number;
    current_target?: string | null;
  };
  parquet: {
    exists: boolean;
    rows: number;
    exported_at: string | null;
    size_bytes: number;
  };
}

export interface FilterOptionsData {
  years: number[];
  months: string[];
  seasons: string[];
  genres: string[];
  decades: number[];
  artists: Array<{ key: string; name: string }>;
  containers: string[];
  features: string[];
  devices: string[];
  providers: string[];
}

export interface OverviewArtistItem {
  rank?: number;
  artist_group_key: string;
  artist_name: string;
  primary_genre?: string | null;
  artwork_url?: string | null;
  plays: number;
  total_ms: number;
  unique_tracks: number;
  unique_albums: number;
  first_discovered?: string | null;
  avg_completion_pct?: number;
  skip_rate_pct?: number;
}

export interface OverviewTrackItem {
  rank?: number;
  track_key: string;
  song_name: string;
  artist_name: string;
  artist_group_key?: string;
  album_name: string;
  album_group_key?: string;
  artwork_url?: string | null;
  preview_url?: string | null;
  duration_ms?: number;
  release_year?: number | null;
  plays: number;
  total_ms: number;
  first_discovered?: string | null;
  avg_completion_pct?: number;
  skip_rate_pct?: number;
}

export interface OverviewAlbumItem {
  rank?: number;
  album_group_key: string;
  album_name: string;
  artist_name: string;
  artist_group_key?: string;
  release_year?: number | null;
  artwork_url?: string | null;
  plays: number;
  total_ms: number;
  unique_tracks: number;
  first_discovered?: string | null;
  avg_completion_pct?: number;
}

export interface OverviewGenreItem {
  rank?: number;
  genre: string;
  plays: number;
  total_ms: number;
  share_pct: number;
  unique_artists: number;
  unique_tracks: number;
  avg_completion_pct?: number;
}

export interface OverviewData {
  kpis: {
    plays: number;
    total_ms: number;
    total_hours: number;
    total_days: number;
    daily_avg_ms: number;
    unique_artists: number;
    unique_albums: number;
    unique_tracks: number;
    total_sessions: number;
    avg_completion_pct: number;
    skip_rate_30s_pct: number;
    active_days: number;
    offline_plays: number;
    min_date: string | null;
    max_date: string | null;
  };
  records?: {
    longest_streak?: { days: number; start: string | null; end: string | null };
    record_day?: { date: string; plays: number; total_ms: number; top_artist?: string | null } | null;
    longest_session?: { session_id: number; plays: number; total_ms: number; start_local?: string } | null;
  };
  top_artists: OverviewArtistItem[];
  top_tracks: OverviewTrackItem[];
  top_albums: OverviewAlbumItem[];
  top_genres: OverviewGenreItem[];
  breakdowns?: {
    devices?: Array<{ label: string; plays: number; total_ms: number }>;
    containers?: Array<{ label: string; plays: number; total_ms: number }>;
    audio_quality?: Array<{ label: string; plays: number; total_ms: number }>;
  };
}

export interface TopsResponse<T> {
  total: number;
  items: T[];
}

export interface ChronoData {
  heatmap: Array<{ date: string; plays: number; total_ms: number; unique_tracks?: number }>;
  matrix: Array<{ dow: number; hour: number; plays: number; total_ms: number }>;
  time_slots: Array<{ label: string; share_pct: number; value: number }>;
  peak_hour: number;
  monthly_trend: Array<{ month: string; plays: number; total_ms: number; unique_artists: number }>;
  evolution: {
    months: string[];
    artists: Array<{ key: string; name: string; values: number[] }>;
  };
}

export interface PersonaData {
  persona: {
    title: string;
    tagline: string;
    description: string;
    radial_scores: Array<{ axis: string; score: number; detail: string }>;
  };
  listening_age?: {
    age: number | null;
    weighted_median_year: number | null;
    weighted_mean_year: number | null;
    heart_decade: string | null;
    dated_coverage_pct: number;
    dated_plays: number;
    formula_explanation?: string;
    eras: Array<{ label: string; share_pct: number; total_ms: number }>;
    decades: Array<{ decade: number; label: string; share_pct: number; total_ms: number; plays: number }>;
    years: Array<{ year: number; plays: number; total_ms: number }>;
  };
}

export interface BehaviorData {
  end_reasons: Array<{ code?: string; label?: string; count: number; share_pct: number; total_ms: number }>;
  untouchables: Array<OverviewTrackItem & { skips_30s: number; raw_plays: number; avg_completion_pct: number }>;
  most_skipped: Array<OverviewTrackItem & { skips_30s: number; raw_plays: number; skip_rate_pct: number }>;
  loops: {
    total_consecutive_repeats: number;
    record_loop: {
      track_key?: string;
      song_name: string;
      artist_name: string;
      album_name: string;
      artwork_url?: string | null;
      preview_url?: string | null;
      max_consecutive: number;
      loop_repeats: number;
      peak_date: string;
    } | null;
    top_looped: Array<{
      track_key?: string;
      song_name: string;
      artist_name: string;
      album_name: string;
      artwork_url?: string | null;
      preview_url?: string | null;
      max_consecutive: number;
      loop_repeats: number;
    }>;
  };
  phases: Array<{
    artist_group_key: string;
    artist_name: string;
    artwork_url?: string | null;
    start_date: string;
    end_date: string;
    plays: number;
    total_ms: number;
    lift: number;
    window_share_pct: number;
    baseline_share_pct: number;
  }>;
  lyrics: {
    total_views: number;
    display_types: Array<{ type: string; count: number }>;
    languages: Array<{ lang: string; count: number }>;
    top_tracks: Array<OverviewTrackItem & { lang?: string; lyric_views: number }>;
  };
}

export interface ScienceData {
  duckdb_parquet_rows: number;
  eddington: {
    eddington: number;
    next_target: number;
    days_at_next: number;
    days_needed_for_next: number;
  };
  gini_artists: { k: number; gini: number; effective_core: number; lorenz: Array<{ p: number; l: number }> };
  gini_tracks: { k: number; gini: number; effective_core: number; lorenz: Array<{ p: number; l: number }> };
  shannon_entropy: { bits: number; normalized: number; perplexity: number };
  entropy_by_device: Array<{
    device: string;
    hours: number;
    unique_artists: number;
    entropy_bits: number;
    entropy_norm: number;
    style: string;
  }>;
  survival: {
    counts: Record<string, number>;
    curve: Array<{ month_age: number; retention_pct: number }>;
    artists: Array<{
      artist_key: string;
      artist_name: string;
      artwork_url?: string | null;
      archetype: string;
      plays: number;
      hours: number;
      span_days: number;
      half_life_days: number;
      active_months: number;
      peak_month: string;
      peak_share_pct: number;
    }>;
  };
  bridge_artists: Array<{
    artist_key: string;
    artist_name: string;
    primary_genre: string;
    cross_transitions: number;
    connected_genres: string[];
    bridge_score: number;
  }>;
  top_transitions: Array<{
    from_key: string;
    from_name: string;
    to_key: string;
    to_name: string;
    count: number;
  }>;
}

export interface ErasData {
  algorithm: string;
  eras: Array<{
    index: number;
    title: string;
    label?: string;
    dominant_genre: string;
    start_week: string;
    end_week: string;
    start_date: string;
    end_date: string;
    start_month?: string;
    end_month?: string;
    plays: number;
    hours: number;
    top_artists: Array<{ artist_key: string; artist_name: string; artwork_url?: string | null }>;
  }>;
  change_points: string[];
}

export interface CamelotData {
  cells: Array<{
    code: string;
    number: number;
    ring: string;
    musical_key: string;
    plays: number;
    total_ms: number;
    tracks_count: number;
    hours: number;
  }>;
  wheel?: Array<{ code?: string; camelot_code?: string; count?: number; tracks_count?: number }>;
  dominant?: { code: string } | null;
}

export interface AtlasData {
  home: { label: string; lat: number; lng: number };
  nodes: Array<{
    artist_key: string;
    artist_name: string;
    genre: string;
    artwork_url?: string | null;
    country_iso: string;
    country_name: string;
    city: string;
    lat: number;
    lng: number;
    plays: number;
    hours: number;
    total_ms: number;
  }>;
  countries: Array<{
    country_iso: string;
    country_name: string;
    artists: number;
    plays: number;
    hours: number;
  }>;
  mapped_count: number;
  total_considered: number;
}

export interface GalaxyData {
  nodes: Array<{
    artist_group_key: string;
    artist_name: string;
    genre?: string;
    avg_year?: number;
    plays: number;
    total_ms: number;
    artwork_url?: string | null;
    preview_url?: string | null;
    sample_song?: string | null;
  }>;
  edges: Array<{ source: string; target: string; weight: number }>;
}

export interface SearchData {
  query: string;
  total: number;
  tracks: OverviewTrackItem[];
  results?: OverviewTrackItem[];
  lyrics_matches: Array<{ track_key?: string; song_name: string; artist_name: string; snippet?: string | null }>;
}

export interface WrappedData {
  period_label: string;
  kpis: {
    plays: number;
    total_ms: number;
    active_days: number;
    total_sessions: number;
  };
  equivalents: Array<{ label: string; value: string; detail: string }>;
  top_artist?: {
    artist_group_key?: string;
    artist_name: string;
    artwork_url?: string | null;
    preview_url?: string | null;
    first_discovered?: string;
    plays: number;
    total_ms: number;
    unique_tracks: number;
    unique_albums: number;
    signature_song?: string;
    glory_month?: { month: string; plays: number; total_ms: number } | null;
  } | null;
  top_track?: (OverviewTrackItem & { avg_completion_pct?: number }) | null;
  top_album?: (OverviewAlbumItem & { avg_completion_pct?: number }) | null;
  top_loop?: {
    track_key?: string;
    song_name: string;
    artist_name: string;
    album_name: string;
    artwork_url?: string | null;
    preview_url?: string | null;
    max_consecutive: number;
    loop_repeats: number;
    peak_date: string;
  } | null;
  top_phase?: {
    artist_group_key?: string;
    artist_name: string;
    artwork_url?: string | null;
    start_date: string;
    end_date: string;
    plays: number;
    window_share_pct: number;
    lift: number;
  } | null;
  rhythm?: { peak_hour?: number };
}

export interface ArtistDetailData {
  artist_group_key: string;
  summary: {
    artist_name: string | null;
    genre: string | null;
    artwork_url: string | null;
    plays: number;
    total_ms: number;
    unique_tracks: number;
    unique_albums: number;
    active_days: number;
    avg_completion_pct: number;
    skip_rate_pct: number;
    first_discovered: string | null;
    last_played: string | null;
  };
  best_day: { date: string; plays: number; total_ms: number } | null;
  monthly: Array<{ month: string; plays: number; total_ms: number }>;
  top_tracks: OverviewTrackItem[];
  top_albums: OverviewAlbumItem[];
}

export interface AlbumDetailData {
  album_group_key: string;
  summary: {
    album_name: string | null;
    artist_name: string | null;
    artist_group_key: string | null;
    genre: string | null;
    release_year: number | null;
    artwork_url: string | null;
    plays: number;
    total_ms: number;
    unique_tracks: number;
    avg_completion_pct: number;
    skip_rate_pct: number;
    first_discovered: string | null;
    last_played: string | null;
  };
  tracks: OverviewTrackItem[];
  monthly: Array<{ month: string; plays: number; total_ms: number }>;
}

export interface DayDetailData {
  date: string;
  plays: number;
  total_ms: number;
  events: Array<{
    id: number;
    started_at_local: string;
    play_duration_ms: number;
    media_duration_ms: number;
    completion_ratio: number;
    end_reason_type: string | null;
    device_label: string | null;
    container_type: string | null;
    playlist_name: string | null;
    session_id: number;
    track_key: string;
    song_name: string;
    album_name: string;
    artist_name: string | null;
    artist_group_key: string | null;
    artwork_url: string | null;
    preview_url: string | null;
  }>;
}

export interface SessionsData {
  total: number;
  items: Array<{
    session_id: number;
    start_local: string;
    end_local: string;
    local_date: string;
    plays: number;
    total_ms: number;
    unique_tracks: number;
    unique_artists: number;
    device_label: string | null;
    container_type: string | null;
    playlist_name: string | null;
    tracks: Array<{
      started_at_local: string;
      play_duration_ms: number;
      completion_ratio: number;
      song_name: string;
      artist_name: string | null;
      album_name: string;
      artwork_url: string | null;
      preview_url: string | null;
    }>;
  }>;
}

export interface HistoryItem {
  id: number;
  started_at_local: string;
  local_date: string;
  play_duration_ms: number;
  media_duration_ms: number;
  completion_ratio: number;
  end_reason_type: string | null;
  device_label: string | null;
  container_type: string | null;
  playlist_name: string | null;
  offline: number;
  audio_quality: string | null;
  session_id: number;
  track_key: string;
  song_name: string;
  album_name: string;
  album_group_key: string;
  artist_name: string | null;
  artist_group_key: string | null;
  genre: string | null;
  release_year: number | null;
  artwork_url: string | null;
  preview_url: string | null;
}

export interface HistoryData {
  total: number;
  items: HistoryItem[];
}

export interface LyricsData {
  found: boolean;
  plain_lyrics: string | null;
  synced_lines: Array<{ time: string; text: string }>;
  instrumental?: boolean;
  source?: string;
}

export interface ArtistBioData {
  found: boolean;
  title?: string;
  description?: string | null;
  summary?: string | null;
  thumbnail?: string | null;
  url?: string | null;
  lang?: string;
}

export interface TrackBpmData {
  found: boolean;
  bpm: number | null;
  gain?: number | null;
  duration?: number | null;
  source?: string;
}
