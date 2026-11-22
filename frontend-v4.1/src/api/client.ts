/**
 * Shared TypeScript contracts & API client for AMDataWrap V4.
 * All endpoint paths here are verified against backend/app (openapi.json).
 */

export type NavTab =
  | "studio"
  | "overview"
  | "tops"
  | "chrono"
  | "persona"
  | "behavior"
  | "science"
  | "atlas"
  | "galaxy"
  | "search"
  | "wrapped"
  | "hub";

export type TurntableFinish = "black" | "silver" | "walnut";
export type VinylStage = "ROOM" | "CRATE" | "INSPECT" | "TURNTABLE" | "FREECAM";

export interface ProfileCapabilities {
  profile_id: number;
  profile_name: string;
  profile_kind: "standard" | "merged";
  platforms: string[];
  has_exact_duration: boolean;
  estimated_duration_pct: number;
  has_skips: boolean;
  has_end_reasons: boolean;
  has_lyrics_events: boolean;
  has_search_events: boolean;
  has_devices: boolean;
  has_audio_quality: boolean;
  has_incognito_flag: boolean;
  has_shuffle_flag: boolean;
}

export interface ProfileItem {
  id: number;
  name: string;
  kind: "standard" | "merged";
  merged_profile_ids: number[];
  is_active: boolean;
  total_plays?: number;
  events_count?: number;
  unique_tracks?: number;
  platforms?: string[];
  sources: Array<{
    id: number;
    source_provider: string;
    filename: string | null;
    events_count: number;
    imported_at: string;
  }>;
}

export interface VinylCrateAlbum {
  album_key: string;
  album_name: string;
  artist_name: string;
  genre: string;
  release_year: number | null;
  artwork_url: string | null;
  back_cover_url: string | null;
  medium_label_url: string | null;
  plays: number;
  total_ms: number;
  track_count: number;
  last_played: string | null;
  label_name: string | null;
  catalog_number: string | null;
  country: string | null;
  disc_count: number;
  vinyl_color_hex: string;
  has_real_pressing: boolean;
}

export interface VinylSideTrack {
  number: string;
  title: string;
  artist_name?: string | null;
  track_key?: string;
  duration_ms: number;
  plays?: number;
  preview_url?: string | null;
}

export interface VinylSide {
  side: string;
  total_duration_ms: number;
  tracks: VinylSideTrack[];
}

export interface VinylDetail {
  album_key: string;
  album_name: string;
  artist_name: string;
  genre: string;
  release_year: number | null;
  artwork_url: string | null;
  back_cover_url: string | null;
  medium_label_url: string | null;
  label_name: string;
  catalog_number: string;
  country: string;
  disc_count: number;
  vinyl_color_hex: string;
  has_real_pressing: boolean;
  total_plays: number;
  total_ms: number;
  sides: VinylSide[];
  tracks: Array<Record<string, any>>;
}

export interface GlobalFilters {
  profile_id: number | null;
  source_provider: string;
  period_mode: "all" | "year" | "month" | "season" | "custom";
  year: string;
  month: string;
  season: string;
  date_from: string;
  date_to: string;
  skip_mode: "lastfm" | "all" | "custom";
  min_seconds: number;
  min_completion_pct: number;
  metric: "ms" | "plays";
  genre: string;
  device: string;
  offline: "" | "true" | "false";
  exclude_incognito: boolean;
}

/** Builds the standard backend FilterParams query string (see backend/app/filters.py). */
export function buildQueryParams(
  filters: GlobalFilters,
  extra?: Record<string, string | number | boolean | undefined | null>
): string {
  const qs = new URLSearchParams();
  if (filters.profile_id != null) qs.set("profile_id", String(filters.profile_id));
  if (filters.source_provider && filters.source_provider !== "all") {
    qs.set("source_provider", filters.source_provider);
  }
  if (filters.year && filters.year !== "all") {
    qs.set("period_mode", "year");
    qs.set("year", filters.year);
  } else if (filters.period_mode && filters.period_mode !== "all") {
    qs.set("period_mode", filters.period_mode);
    if (filters.period_mode === "month" && filters.month) qs.set("month", filters.month);
    if (filters.period_mode === "season" && filters.season) qs.set("season", filters.season);
    if (filters.period_mode === "custom") {
      if (filters.date_from) qs.set("date_from", filters.date_from);
      if (filters.date_to) qs.set("date_to", filters.date_to);
    }
  }
  qs.set("skip_mode", filters.skip_mode);
  if (filters.skip_mode === "custom") {
    qs.set("min_seconds", String(filters.min_seconds));
    qs.set("min_completion_pct", String(filters.min_completion_pct));
  }
  if (filters.metric && filters.metric !== "ms") qs.set("metric", filters.metric);
  if (filters.genre) qs.set("genre", filters.genre);
  if (filters.device) qs.set("device", filters.device);
  if (filters.offline) qs.set("offline", filters.offline);
  if (filters.exclude_incognito) qs.set("exclude_incognito", "true");
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}

/** Canonical endpoint map — single source of truth for every view. */
export const API = {
  health: "/api/health",
  filters: "/api/filters",
  overview: "/api/analytics/overview",
  topArtists: "/api/analytics/tops/artists",
  topAlbums: "/api/analytics/tops/albums",
  topTracks: "/api/analytics/tops/tracks",
  topGenres: "/api/analytics/tops/genres",
  chrono: "/api/analytics/chronobiology",
  persona: "/api/analytics/persona",
  behavior: "/api/analytics/behavior",
  wrapped: "/api/analytics/wrapped",
  galaxy: "/api/analytics/galaxy",
  science: "/api/v3/analytics/science",
  eras: "/api/v3/analytics/eras",
  compass: "/api/v3/analytics/compass",
  camelot: "/api/v3/analytics/camelot",
  atlas: "/api/v3/analytics/atlas",
  iceberg: "/api/v3/analytics/iceberg",
  search: "/api/v3/search",
  sessions: "/api/sessions",
  history: "/api/history",
  historyCsv: "/api/history/export.csv",
  trackBpm: "/api/external/track-bpm",
  detailArtist: (key: string) => `/api/detail/artist/${encodeURIComponent(key)}`,
  detailAlbum: (key: string) => `/api/detail/album/${encodeURIComponent(key)}`,
  detailDay: (date: string) => `/api/detail/day/${encodeURIComponent(date)}`,
  profiles: "/api/v4/profiles",
  capabilities: "/api/v4/profile/capabilities",
  crate: "/api/v4/vinyl/crate",
  vinyl: (key: string) => `/api/v4/vinyl/${encodeURIComponent(key)}`,
  vinylEnrich: (key: string) => `/api/v4/vinyl/${encodeURIComponent(key)}/enrich`,
  resolve: "/api/v4/playback/resolve",
  scrobble: "/api/v4/playback/scrobble",
  importGuides: "/api/v4/import/guides",
  importPreview: "/api/v4/import/preview",
  importV4: "/api/v4/import",
  importProgress: (id: string) => `/api/v4/import/progress/${encodeURIComponent(id)}`,
  trackingSetup: "/api/v4/tracking/setup",
} as const;

/**
 * Proxied artwork URL (CORS-safe for WebGL textures / canvas).
 * Normalises `http://` URLs (Cover Art Archive returns http links) to https.
 */
export function coverUrl(url: string | null | undefined, size = 400): string | null {
  if (!url) return null;
  let u = url.trim();
  if (u.startsWith("//")) u = `https:${u}`;
  if (u.startsWith("http://")) u = `https://${u.slice(7)}`;
  if (!u.startsWith("https://")) return null;
  return `/api/artwork-proxy?url=${encodeURIComponent(u)}&w=${size}&fmt=webp`;
}

export async function apiGet<T = any>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

export async function apiPost<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE" });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

export function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type TimeUnit = "hours" | "minutes";
export type ActiveLocale = "fr" | "en";

let _activeTimeUnit: TimeUnit =
  typeof localStorage !== "undefined" && localStorage.getItem("amdw.timeUnit") === "minutes"
    ? "minutes"
    : "hours";

let _activeLocale: ActiveLocale =
  typeof localStorage !== "undefined" && localStorage.getItem("amdw.locale") === "en" ? "en" : "fr";

export function getActiveTimeUnit(): TimeUnit {
  return _activeTimeUnit;
}

export function setActiveTimeUnit(unit: TimeUnit): void {
  _activeTimeUnit = unit;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("amdw.timeUnit", unit);
  }
}

export function getActiveLocale(): ActiveLocale {
  return _activeLocale;
}

export function setActiveLocale(loc: ActiveLocale): void {
  _activeLocale = loc;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("amdw.locale", loc);
  }
}

function intlLocale(): string {
  return _activeLocale === "en" ? "en-US" : "fr-FR";
}

export function formatMinutes(ms: number): string {
  const m = (ms || 0) / 60_000;
  if (m >= 10 || m === 0) return `${Math.round(m).toLocaleString(intlLocale())} min`;
  const str = m.toFixed(1);
  return `${_activeLocale === "fr" ? str.replace(".", ",") : str} min`;
}

export function formatHours(ms: number): string {
  if (_activeTimeUnit === "minutes") return formatMinutes(ms);
  const h = (ms || 0) / 3_600_000;
  if (h > 0 && h < 1) return formatMinutes(ms);
  if (h >= 10) return `${Math.round(h).toLocaleString(intlLocale())} h`;
  const str = h.toFixed(1);
  return `${_activeLocale === "fr" ? str.replace(".", ",") : str} h`;
}

export function formatHoursNum(hours: number | null | undefined): string {
  return formatHours((Number(hours) || 0) * 3_600_000);
}

export function formatInt(n: number | null | undefined): string {
  return Math.round(n || 0).toLocaleString(intlLocale());
}

export function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(intlLocale(), { day: "numeric", month: "long", year: "numeric" });
}
