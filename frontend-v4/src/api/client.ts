/**
 * Shared TypeScript contracts & API client for AMDataWrap V4.
 */

export type NavTab =
  | "studio"
  | "overview"
  | "tops"
  | "galaxy"
  | "science"
  | "chrono"
  | "persona"
  | "obsessions"
  | "atlas"
  | "search"
  | "wrapped"
  | "hub";

export type TurntableFinish = "obsidian" | "walnut" | "studio";
export type VinylStage = "CRATE_BROWSE" | "SLEEVE_INSPECT" | "DISC_SLIDE_OUT" | "TURNTABLE_PLAY";
export type GraphicsTier = 0 | 1 | 2 | 3;

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
  year: string;
  skip_mode: "lastfm" | "all";
  exclude_incognito: boolean;
}

export function buildQueryParams(filters: GlobalFilters, extra?: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  if (filters.profile_id != null) qs.set("profile_id", String(filters.profile_id));
  if (filters.source_provider && filters.source_provider !== "all") {
    qs.set("source_provider", filters.source_provider);
  }
  if (filters.year && filters.year !== "all") {
    qs.set("period_mode", "year");
    qs.set("year", filters.year);
  }
  qs.set("skip_mode", filters.skip_mode);
  if (filters.exclude_incognito) qs.set("exclude_incognito", "true");
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}

export function artworkProxyUrl(url: string | null | undefined, mobileTier: boolean): string | null {
  if (!url) return null;
  const w = mobileTier ? 512 : 1024;
  const fmt = mobileTier ? "webp" : "jpeg";
  return `/api/artwork-proxy?url=${encodeURIComponent(url)}&w=${w}&fmt=${fmt}`;
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${txt}`);
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
    throw new Error(`API ${res.status}: ${txt}`);
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

export function formatHours(ms: number): string {
  const h = ms / 3_600_000;
  if (h >= 10) return `${Math.round(h).toLocaleString("fr-FR")} h`;
  return `${h.toFixed(1)} h`;
}
