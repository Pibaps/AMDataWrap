/**
 * Single entry point to start/navigate playback of any track from anywhere in AMDataWrap V4.1.
 *
 * Supports:
 * - YouTube Integrated (0 EUR, default) via `/api/v4/playback/resolve`
 * - Open Tab Bridge (0 EUR — Apple Music / Spotify / Deezer via MV3 extension `/ws/bridge`)
 * - 30s Preview fallback
 * - Next / Prev vinyl track navigation (`nextVinylTrack`, `prevVinylTrack`)
 */

import { API, apiGet, buildQueryParams, type VinylDetail } from "../api/client";
import { useV4Store, type ActiveTrack } from "../store/useV4Store";
import { playbackClock } from "./playbackClock";
import { vinylFoley } from "./vinylFoley";

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

interface AppleHintsOut {
  ok: boolean;
  track_key: string;
  album_key?: string | null;
  apple_song_id: string | null;
  isrcs: string[];
  artist_name?: string;
  album_name?: string;
}

function extractAlbumKeyFromTrackKey(trackKey?: string | null): string | null {
  if (!trackKey || !trackKey.includes("||")) return null;
  const parts = trackKey.split("||");
  return parts[1]?.trim() || null;
}

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
  albumKey: string | null | undefined,
  trackKey: string | undefined,
  songName: string,
  seq: number
): Promise<ActiveTrack["vinyl"]> {
  const effAlbumKey = albumKey || extractAlbumKeyFromTrackKey(trackKey);
  if (!effAlbumKey) return null;

  const st = useV4Store.getState();
  let detail = st.onPlatter?.album_key === effAlbumKey ? st.onPlatter : null;
  if (!detail) {
    try {
      const qs = buildQueryParams(st.filters);
      detail = await apiGet<VinylDetail>(`${API.vinyl(effAlbumKey)}${qs}`);
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
  if (latest.vinylStage === "INSPECT") {
    latest.setVinylStage("ROOM");
  }
  return { album_key: detail.album_key, sideIndex, trackIndex };
}

const appleHintsCache = new Map<string, Promise<AppleHintsOut>>();

function fetchAppleHints(req: PlayRequest): Promise<AppleHintsOut> {
  const k = `${req.track_key || ""}::${req.artist_name}::${req.song_name}::${req.album_name || ""}`.toLowerCase();
  let p = appleHintsCache.get(k);
  if (!p) {
    const qs = new URLSearchParams({
      song: req.song_name,
      artist: req.artist_name || "",
      album: req.album_name || "",
    });
    if (req.track_key) qs.set("track_key", req.track_key);
    p = apiGet<AppleHintsOut>(`/api/v4/playback/apple-hints?${qs.toString()}`).catch(() => ({
      ok: false,
      track_key: req.track_key || "",
      apple_song_id: null,
      isrcs: [],
    }));
    appleHintsCache.set(k, p);
  }
  return p;
}

type BridgeSender = (msg: Record<string, any>) => boolean;
let bridgeSender: BridgeSender | null = null;

export function registerBridgeSender(fn: BridgeSender | null): void {
  bridgeSender = fn;
}

export function sendBridgeCommand(command: string, payload?: Record<string, any>): boolean {
  if (!bridgeSender) return false;
  const st = useV4Store.getState();
  const platform =
    st.extensionPlatforms.find((p) => p === "apple_music" || p === "spotify" || p === "deezer" || p === "youtube_music") ||
    "apple_music";
  return bridgeSender({ type: command, command, platform, payload: payload || {} });
}

const resolveCache = new Map<string, Promise<ResolveOut>>();

export function resolveTrack(req: PlayRequest): Promise<ResolveOut> {
  const k = `${req.artist_name}::${req.song_name}::${req.album_name || ""}`.toLowerCase();
  let p = resolveCache.get(k);
  if (!p) {
    const qs = new URLSearchParams({ song: req.song_name, artist: req.artist_name || "", album: req.album_name || "" });
    if (req.track_key) qs.set("track_key", req.track_key);
    p = apiGet<ResolveOut>(`${API.resolve}?${qs.toString()}`)
      .then((res) => {
        if (!res.ok && !res.video_id && !res.preview_url) {
          resolveCache.delete(k);
        }
        return res;
      })
      .catch(() => {
        resolveCache.delete(k);
        return {
          ok: false,
          video_id: null,
          preview_url: null,
          artwork_url: null,
        };
      });
    resolveCache.set(k, p);
  }
  return p;
}

let requestSeq = 0;
let lastBridgePlayAt = 0;

export function getLastBridgePlayAt(): number {
  return lastBridgePlayAt;
}

export async function playTrack(req: PlayRequest): Promise<void> {
  const seq = ++requestSeq;
  const st = useV4Store.getState();
  const duration = req.duration_ms && req.duration_ms > 0 ? req.duration_ms : 180_000;

  if (!st.powerOn) {
    st.setPowerOn(true);
  }

  // Start syncing the 3D turntable platter immediately if track_key already encodes album_key ("song||album_key")
  const earlyVinylPromise: Promise<ActiveTrack["vinyl"]> =
    !req.vinyl && extractAlbumKeyFromTrackKey(req.track_key)
      ? syncPlatterForTrack(null, req.track_key, req.song_name, seq)
      : Promise.resolve(req.vinyl ?? null);

  // Open-Tab Bridge mode (Apple Music / Spotify / Deezer at 0 EUR, 0 Mo YouTube RAM)
  if (st.preferredSource === "bridge") {
    lastBridgePlayAt = Date.now();
    playbackClock.reset(duration);
    st.setPlaybackError(null);
    st.setNowPlaying({
      song_name: req.song_name,
      artist_name: req.artist_name,
      album_name: req.album_name || "",
      artwork_url: req.artwork_url || null,
      track_key: req.track_key,
      video_id: null,
      preview_url: req.preview_url || null,
      duration_ms: duration,
      source: "bridge",
      vinyl: req.vinyl ?? null,
    });
    st.setIsPlaying(true);
    st.setMotorOn(true);

    const [hints, earlyVinyl] = await Promise.all([fetchAppleHints(req), earlyVinylPromise]);
    if (seq !== requestSeq) return;

    const bridgeTrackKey = hints.track_key || req.track_key;
    const bridgeVinyl =
      earlyVinyl ||
      (!req.vinyl ? await syncPlatterForTrack(hints.album_key, bridgeTrackKey, req.song_name, seq) : null);
    if (seq !== requestSeq) return;
    if (bridgeVinyl) {
      const curNow = useV4Store.getState().nowPlaying;
      if (curNow) {
        useV4Store.getState().setNowPlaying({ ...curNow, track_key: bridgeTrackKey, vinyl: bridgeVinyl });
      }
    }

    const sent = sendBridgeCommand("play_track", {
      song_name: req.song_name,
      artist_name: hints.artist_name || req.artist_name,
      album_name: hints.album_name || req.album_name || "",
      track_key: hints.track_key || req.track_key || "",
      apple_song_id: hints.apple_song_id || undefined,
      isrcs: hints.isrcs || [],
      volume: Math.max(0, Math.min(1, st.volumePct / 100)),
      query: `${req.artist_name} ${req.song_name}`.trim(),
    });
    if (!sent) {
      st.setPlaybackError("Extension Bridge non connectée — ouvre ton onglet Apple Music, Spotify ou Deezer.");
      st.setIsPlaying(false);
      st.setMotorOn(false);
    }
    return;
  }

  // Optimistic update while resolving YouTube / Preview.
  // Keep `source: "youtube"` & previous `video_id` when already in YouTube mode so
  // skipping tracks reuses the existing YT.Player via `loadVideoById()` without teardown!
  const keepYtAlive = st.preferredSource === "youtube" && st.nowPlaying?.source === "youtube" && Boolean(st.nowPlaying?.video_id);
  playbackClock.reset(duration);
  st.setNowPlaying({
    song_name: req.song_name,
    artist_name: req.artist_name,
    album_name: req.album_name || "",
    artwork_url: req.artwork_url || null,
    track_key: req.track_key,
    video_id: keepYtAlive ? st.nowPlaying!.video_id : null,
    preview_url: req.preview_url || null,
    duration_ms: duration,
    source: keepYtAlive ? "youtube" : "preview",
    vinyl: req.vinyl ?? null,
  });
  if (!keepYtAlive) {
    st.setIsPlaying(false);
  }

  const [res, earlyVinyl] = await Promise.all([resolveTrack(req), earlyVinylPromise]);
  if (seq !== requestSeq) return; // superseded

  const resolvedTrackKey = res.track_key || req.track_key;
  const resolvedDuration = req.duration_ms && req.duration_ms > 0 ? req.duration_ms : Number(res.duration_ms || 0) || duration;
  let vinylCtx: ActiveTrack["vinyl"] = earlyVinyl ?? null;
  if (!vinylCtx) {
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
  useV4Store.getState().setMotorOn(true);
}

/** Resolve active (sideIndex, trackIndex) on the platter even if `nowPlaying.vinyl` was cleared. */
function resolvePlatterPosition(st: ReturnType<typeof useV4Store.getState>): { sideIdx: number; trackIdx: number } {
  const platter = st.onPlatter;
  if (!platter) return { sideIdx: 0, trackIdx: -1 };
  if (st.nowPlaying?.vinyl && st.nowPlaying.vinyl.album_key === platter.album_key) {
    return { sideIdx: st.nowPlaying.vinyl.sideIndex, trackIdx: st.nowPlaying.vinyl.trackIndex };
  }
  const curName = (st.nowPlaying?.song_name || "").trim().toLowerCase();
  if (curName) {
    for (let si = 0; si < platter.sides.length; si++) {
      const ti = platter.sides[si].tracks.findIndex((t) => t.title.trim().toLowerCase() === curName);
      if (ti >= 0) return { sideIdx: si, trackIdx: ti };
    }
  }
  return { sideIdx: st.activeSideIndex ?? 0, trackIdx: -1 };
}

/** Step to the next track on the active vinyl record (flips side automatically when reaching the end of a side). */
export function nextVinylTrack(): void {
  const st = useV4Store.getState();
  const platter = st.onPlatter;
  if (!platter || !platter.sides.length) {
    if (st.preferredSource === "bridge") sendBridgeCommand("next");
    return;
  }

  const { sideIdx, trackIdx } = resolvePlatterPosition(st);
  const curSide = platter.sides[sideIdx] || platter.sides[0];

  if (curSide && trackIdx + 1 < curSide.tracks.length) {
    const nextIdx = trackIdx + 1;
    const t = curSide.tracks[nextIdx];
    vinylFoley.playNeedleDrop(st.soundFx);
    playTrack({
      song_name: t.title,
      artist_name: t.artist_name || platter.artist_name,
      album_name: platter.album_name,
      artwork_url: platter.artwork_url,
      track_key: t.track_key,
      preview_url: t.preview_url,
      duration_ms: t.duration_ms,
      vinyl: { album_key: platter.album_key, sideIndex: sideIdx, trackIndex: nextIdx },
    });
    return;
  }

  const nextSideIdx = sideIdx + 1;
  if (nextSideIdx < platter.sides.length && platter.sides[nextSideIdx].tracks.length > 0) {
    vinylFoley.playRecordPlace(st.soundFx);
    st.setActiveSideIndex(nextSideIdx);
    const t = platter.sides[nextSideIdx].tracks[0];
    playTrack({
      song_name: t.title,
      artist_name: t.artist_name || platter.artist_name,
      album_name: platter.album_name,
      artwork_url: platter.artwork_url,
      track_key: t.track_key,
      preview_url: t.preview_url,
      duration_ms: t.duration_ms,
      vinyl: { album_key: platter.album_key, sideIndex: nextSideIdx, trackIndex: 0 },
    });
  }
}

/** Step to the previous track on the active vinyl record (or restart current track if > 4s in). */
export function prevVinylTrack(): void {
  const st = useV4Store.getState();
  const platter = st.onPlatter;
  if (!platter || !platter.sides.length) {
    if (st.preferredSource === "bridge") sendBridgeCommand("prev");
    return;
  }
  if (playbackClock.getPositionMs() > 4000) {
    st.requestSeekMs(0);
    return;
  }

  const { sideIdx, trackIdx } = resolvePlatterPosition(st);
  const curSide = platter.sides[sideIdx] || platter.sides[0];

  if (curSide && trackIdx - 1 >= 0) {
    const prevIdx = trackIdx - 1;
    const t = curSide.tracks[prevIdx];
    vinylFoley.playNeedleDrop(st.soundFx);
    playTrack({
      song_name: t.title,
      artist_name: t.artist_name || platter.artist_name,
      album_name: platter.album_name,
      artwork_url: platter.artwork_url,
      track_key: t.track_key,
      preview_url: t.preview_url,
      duration_ms: t.duration_ms,
      vinyl: { album_key: platter.album_key, sideIndex: sideIdx, trackIndex: prevIdx },
    });
    return;
  }

  const prevSideIdx = sideIdx - 1;
  if (prevSideIdx >= 0 && platter.sides[prevSideIdx].tracks.length > 0) {
    vinylFoley.playRecordPlace(st.soundFx);
    st.setActiveSideIndex(prevSideIdx);
    const tracks = platter.sides[prevSideIdx].tracks;
    const lastIdx = tracks.length - 1;
    const t = tracks[lastIdx];
    playTrack({
      song_name: t.title,
      artist_name: t.artist_name || platter.artist_name,
      album_name: platter.album_name,
      artwork_url: platter.artwork_url,
      track_key: t.track_key,
      preview_url: t.preview_url,
      duration_ms: t.duration_ms,
      vinyl: { album_key: platter.album_key, sideIndex: prevSideIdx, trackIndex: lastIdx },
    });
  }
}

export function togglePlayback() {
  const st = useV4Store.getState();
  if (!st.nowPlaying) {
    // If a record is on the platter, start its first track on active side!
    if (st.onPlatter) {
      const side = st.onPlatter.sides[st.activeSideIndex] || st.onPlatter.sides[0];
      const first = side?.tracks?.[0];
      if (first) {
        playTrack({
          song_name: first.title,
          artist_name: first.artist_name || st.onPlatter.artist_name,
          album_name: st.onPlatter.album_name,
          artwork_url: st.onPlatter.artwork_url,
          track_key: first.track_key,
          preview_url: first.preview_url,
          duration_ms: first.duration_ms,
          vinyl: { album_key: st.onPlatter.album_key, sideIndex: st.activeSideIndex, trackIndex: 0 },
        });
      }
    }
    return;
  }
  const next = !st.isPlaying;
  if (st.nowPlaying.source === "bridge" || st.preferredSource === "bridge") {
    sendBridgeCommand(next ? "play" : "pause");
  }
  st.setIsPlaying(next);
  st.setMotorOn(next);
}

export function stopPlayback() {
  const st = useV4Store.getState();
  if (st.nowPlaying?.source === "bridge") {
    sendBridgeCommand("pause");
  }
  st.setIsPlaying(false);
  st.setMotorOn(false);
  st.setNowPlaying(null);
  playbackClock.reset(0);
}
