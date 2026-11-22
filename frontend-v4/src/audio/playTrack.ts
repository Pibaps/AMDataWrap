/**
 * Single entry point to start playback of any track from anywhere in the app.
 * Resolves a full-length YouTube video id (backend /api/v4/playback/resolve) and
 * falls back to the 30 s preview. The headless PlayerEngine reacts to the store.
 */

import { API, apiGet, buildQueryParams, type VinylDetail } from "../api/client";
import { useV4Store, type ActiveTrack } from "../store/useV4Store";
import { playbackClock } from "./playbackClock";

export interface PlayRequest {
  song_name: string;
  artist_name: string;
  album_name?: string;
  artwork_url?: string | null;
  track_key?: string;
  preview_url?: string | null;
  duration_ms?: number;
  vinyl?: ActiveTrack["vinyl"];
}

interface ResolveOut {
  ok: boolean;
  track_key?: string;
  album_key?: string | null;
  duration_ms?: number | null;
  video_id: string | null;
  preview_url: string | null;
  artwork_url: string | null;
}

const resolveCache = new Map<string, Promise<ResolveOut>>();

function findTrackPositionInVinyl(
  detail: VinylDetail,
  trackKey: string | undefined,
  songName: string
): { sideIndex: number; trackIndex: number } {
  const normSong = songName.trim().toLowerCase();
  if (trackKey) {
    for (let s = 0; s < detail.sides.length; s++) {
      const tracks = detail.sides[s]?.tracks || [];
      const idx = tracks.findIndex((t) => t.track_key === trackKey);
      if (idx >= 0) return { sideIndex: s, trackIndex: idx };
    }
  }
  for (let s = 0; s < detail.sides.length; s++) {
    const tracks = detail.sides[s]?.tracks || [];
    const idx = tracks.findIndex((t) => t.title.trim().toLowerCase() === normSong);
    if (idx >= 0) return { sideIndex: s, trackIndex: idx };
  }
  return { sideIndex: 0, trackIndex: 0 };
}

async function syncPlatterForTrack(
  albumKey: string,
  trackKey: string | undefined,
  songName: string,
  seq: number
): Promise<ActiveTrack["vinyl"]> {
  const st = useV4Store.getState();
  let detail = st.onPlatter?.album_key === albumKey ? st.onPlatter : null;
  if (!detail) {
    try {
      const qs = buildQueryParams(st.filters);
      detail = await apiGet<VinylDetail>(`${API.vinyl(albumKey)}${qs}`);
    } catch {
      return null;
    }
    if (seq !== requestSeq) return null;
  }

  const { sideIndex, trackIndex } = findTrackPositionInVinyl(detail, trackKey, songName);
  const latest = useV4Store.getState();
  if (latest.onPlatter?.album_key !== detail.album_key) {
    latest.setOnPlatter(detail);
  }
  if (latest.activeSideIndex !== sideIndex) {
    latest.setActiveSideIndex(sideIndex);
  }
  return { album_key: detail.album_key, sideIndex, trackIndex };
}

export function resolveTrack(req: PlayRequest): Promise<ResolveOut> {
  const k = `${req.artist_name}::${req.song_name}::${req.album_name || ""}`.toLowerCase();
  let p = resolveCache.get(k);
  if (!p) {
    const qs = new URLSearchParams({ song: req.song_name, artist: req.artist_name || "", album: req.album_name || "" });
    if (req.track_key) qs.set("track_key", req.track_key);
    p = apiGet<ResolveOut>(`${API.resolve}?${qs.toString()}`).catch(() => ({
      ok: false,
      video_id: null,
      preview_url: null,
      artwork_url: null,
    }));
    resolveCache.set(k, p);
  }
  return p;
}

let requestSeq = 0;

export async function playTrack(req: PlayRequest): Promise<void> {
  const seq = ++requestSeq;
  const st = useV4Store.getState();
  const duration = req.duration_ms && req.duration_ms > 0 ? req.duration_ms : 0;

  // Optimistic: show the track immediately (cover/title) while resolving.
  playbackClock.reset(duration);
  st.setNowPlaying({
    song_name: req.song_name,
    artist_name: req.artist_name,
    album_name: req.album_name || "",
    artwork_url: req.artwork_url || null,
    track_key: req.track_key,
    video_id: null,
    preview_url: req.preview_url || null,
    duration_ms: duration,
    source: "preview",
    vinyl: req.vinyl ?? null,
  });
  st.setIsPlaying(false);

  const res = await resolveTrack(req);
  if (seq !== requestSeq) return; // superseded by a newer request

  const resolvedTrackKey = res.track_key || req.track_key;
  const resolvedDuration = duration > 0 ? duration : Number(res.duration_ms || 0);
  let vinylCtx: ActiveTrack["vinyl"] = req.vinyl ?? null;
  if (!vinylCtx && res.album_key) {
    vinylCtx = await syncPlatterForTrack(res.album_key, resolvedTrackKey, req.song_name, seq);
    if (seq !== requestSeq) return;
  }

  const preview = res.preview_url || req.preview_url || null;
  const wantYt = useV4Store.getState().preferredSource === "youtube";
  const useYt = wantYt && Boolean(res.video_id);
  if (!useYt && !preview) {
    useV4Store.getState().setPlaybackError("Aucune source audio trouvée pour ce titre.");
    return;
  }
  const finalDuration = useYt ? resolvedDuration : 30_000;
  playbackClock.reset(finalDuration);
  useV4Store.getState().setNowPlaying({
    song_name: req.song_name,
    artist_name: req.artist_name,
    album_name: req.album_name || "",
    artwork_url: req.artwork_url || res.artwork_url || null,
    track_key: resolvedTrackKey,
    video_id: res.video_id,
    preview_url: preview,
    duration_ms: finalDuration,
    source: useYt ? "youtube" : "preview",
    vinyl: vinylCtx,
  });
  useV4Store.getState().setIsPlaying(true);
}

export function togglePlayback() {
  const st = useV4Store.getState();
  if (!st.nowPlaying) return;
  st.setIsPlaying(!st.isPlaying);
}

export function stopPlayback() {
  const st = useV4Store.getState();
  st.setIsPlaying(false);
  st.setNowPlaying(null);
  playbackClock.reset(0);
}
