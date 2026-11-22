/**
 * Bottom Transport Bar & Lazy-Mounted 3D Turntable OLED Player (AMDataWrap V4.1).
 *
 * V4.1 Extreme RAM Optimization & Multi-Tab Fix (PDF p. 10, 33-38):
 * - Lightweight OLED Façade (< 1 Mo RAM) while YouTube is idle or paused > 45 s.
 * - Preconnects to `youtube-nocookie.com` & `i.ytimg.com` on first pointer enter.
 * - Single reused `YT.Player` (`host: 'https://www.youtube-nocookie.com'`) mounted lazily on first play.
 * - React 19 ref-callback cleanup executes:
 *   `player.stopVideo()` -> `iframe.src = 'about:blank'` -> `player.destroy()` -> `node.replaceChildren()`
 *   to reclaim 100% of Chromium OOPIF memory (~100-180 Mo) on 45 s pause hibernation, POWER OFF, or source switch.
 * - Free 0 EUR Open-Tab Bridge selector ("YouTube Intégré · Gratuit" / "Mon onglet ouvert" Apple Music / Spotify / Deezer)
 *   with green live badge + 3-step guide popover.
 * - "Voir sur la platine" quick jump button when playing from any of the 11 analytics tabs.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Disc3, ExternalLink, FileText, Pause, Play, Radio, SkipBack, SkipForward, Tv, X } from "lucide-react";
import { API, apiGet, apiPost, formatDurationMs } from "../api/client";
import type { TrackBpmData } from "../api/types";
import { useT } from "../i18n";
import { LyricsPanel } from "./LyricsPanel";
import { playbackClock, usePlaybackClock } from "../audio/playbackClock";
import {
  getLastBridgePlayAt,
  nextVinylTrack,
  playTrack,
  prevVinylTrack,
  registerBridgeSender,
  sendBridgeCommand,
  togglePlayback,
} from "../audio/playTrack";
import { vinylFoley } from "../audio/vinylFoley";
import { useV4Store } from "../store/useV4Store";
import { Cover } from "./ui";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_HIBERNATE_MS = 45_000;
let preconnected = false;

function preconnectYouTube(): void {
  if (preconnected || typeof document === "undefined") return;
  preconnected = true;
  for (const href of ["https://www.youtube-nocookie.com", "https://i.ytimg.com"]) {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = href;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
}

function ensureYouTubeApiLoaded(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    const existing = document.getElementById("yt-iframe-api-script");
    const prevCb = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevCb?.();
      resolve(window.YT);
    };
    if (!existing) {
      const s = document.createElement("script");
      s.id = "yt-iframe-api-script";
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      document.head.appendChild(s);
    }
  });
}

function teardownYouTubeHost(playerRef: React.MutableRefObject<any>, node: HTMLDivElement | null): void {
  const player = playerRef.current;
  playerRef.current = null;
  if (player) {
    try {
      player.stopVideo?.();
    } catch {
      /* ignore */
    }
    try {
      const iframe = player.getIframe?.() as HTMLIFrameElement | null;
      if (iframe && iframe.tagName === "IFRAME") {
        iframe.src = "about:blank";
      }
    } catch {
      /* ignore */
    }
    try {
      player.destroy?.();
    } catch {
      /* ignore */
    }
  }
  if (node) {
    const iframes = node.querySelectorAll("iframe");
    iframes.forEach((f) => {
      try {
        f.src = "about:blank";
      } catch {
        /* ignore */
      }
    });
    node.replaceChildren();
  }
}

const PLATFORM_LABELS: Record<string, string> = {
  apple_music: "Apple Music",
  spotify: "Spotify",
  deezer: "Deezer",
  youtube_music: "YouTube Music",
};

export const HybridPlaybackDeck: React.FC = () => {
  const activeTab = useV4Store((s) => s.activeTab);
  const setActiveTab = useV4Store((s) => s.setActiveTab);
  const setVinylStage = useV4Store((s) => s.setVinylStage);
  const nowPlaying = useV4Store((s) => s.nowPlaying);
  const setNowPlaying = useV4Store((s) => s.setNowPlaying);
  const isPlaying = useV4Store((s) => s.isPlaying);
  const setIsPlaying = useV4Store((s) => s.setIsPlaying);
  const setMotorOn = useV4Store((s) => s.setMotorOn);
  const powerOn = useV4Store((s) => s.powerOn);
  const volumePct = useV4Store((s) => s.volumePct);
  const preferredSource = useV4Store((s) => s.preferredSource);
  const setPreferredSource = useV4Store((s) => s.setPreferredSource);
  const playbackError = useV4Store((s) => s.playbackError);
  const soundFx = useV4Store((s) => s.soundFx);
  const seekRequestMs = useV4Store((s) => s.seekRequestMs);
  const requestSeekMs = useV4Store((s) => s.requestSeekMs);
  const extensionConnected = useV4Store((s) => s.extensionConnected);
  const extensionPlatforms = useV4Store((s) => s.extensionPlatforms);
  const setExtensionStatus = useV4Store((s) => s.setExtensionStatus);
  const onPlatter = useV4Store((s) => s.onPlatter);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytHostNodeRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const loadedVideoIdRef = useRef<string | null>(null);
  const scrobbledSigRef = useRef<string>("");
  const refreshedPreviewKeysRef = useRef<Set<string>>(new Set());
  const bridgeWsRef = useRef<WebSocket | null>(null);

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [ytMounted, setYtMounted] = useState(false);
  const [showBridgeGuide, setShowBridgeGuide] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [bpm, setBpm] = useState<number | null>(null);
  const bpmCacheRef = useRef<Map<string, number | null>>(new Map());
  const { t } = useT();

  useEffect(() => {
    if (!nowPlaying?.song_name || !nowPlaying?.artist_name) {
      setBpm(null);
      return;
    }
    const key = `${nowPlaying.artist_name}::${nowPlaying.song_name}`.toLowerCase();
    if (bpmCacheRef.current.has(key)) {
      setBpm(bpmCacheRef.current.get(key) ?? null);
      return;
    }
    const ctrl = new AbortController();
    apiGet<TrackBpmData>(
      `${API.trackBpm}?song=${encodeURIComponent(nowPlaying.song_name)}&artist=${encodeURIComponent(nowPlaying.artist_name)}`,
      ctrl.signal,
    )
      .then((res) => {
        const val = res?.found && res.bpm ? Math.round(res.bpm) : null;
        bpmCacheRef.current.set(key, val);
        setBpm(val);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setBpm(null);
      });
    return () => ctrl.abort();
  }, [nowPlaying?.song_name, nowPlaying?.artist_name]);

  const { positionMs, durationMs } = usePlaybackClock(250);

  useEffect(() => {
    const el = document.getElementById("turntable-css3d-screen");
    if (el) setPortalTarget(el);
  }, []);

  /** Automatically chains to the next track on the spinning 12" vinyl when a track finishes. */
  const advanceToNextVinylTrack = useCallback(() => {
    const st = useV4Store.getState();
    const platter = st.onPlatter;
    let vCtx = st.nowPlaying?.vinyl;
    if (platter && (!vCtx || platter.album_key !== vCtx.album_key) && st.nowPlaying?.song_name) {
      const curName = st.nowPlaying.song_name.trim().toLowerCase();
      for (let si = 0; si < platter.sides.length; si++) {
        const ti = platter.sides[si].tracks.findIndex((t) =>
          curName.includes(t.title.trim().toLowerCase().slice(0, 12))
        );
        if (ti >= 0) {
          vCtx = { album_key: platter.album_key, sideIndex: si, trackIndex: ti };
          break;
        }
      }
    }
    if (!platter || !vCtx || platter.album_key !== vCtx.album_key) {
      playbackClock.set(0, playbackClock.getDurationMs(), false);
      st.setIsPlaying(false);
      st.setMotorOn(false);
      return;
    }

    const curSide = platter.sides[vCtx.sideIndex] || platter.sides[0];
    const nextTrackIdx = vCtx.trackIndex + 1;
    if (curSide && nextTrackIdx < curSide.tracks.length) {
      const nextTrack = curSide.tracks[nextTrackIdx];
      playTrack({
        song_name: nextTrack.title,
        artist_name: nextTrack.artist_name || platter.artist_name,
        album_name: platter.album_name,
        artwork_url: platter.artwork_url,
        track_key: nextTrack.track_key,
        preview_url: nextTrack.preview_url,
        duration_ms: nextTrack.duration_ms,
        vinyl: { album_key: platter.album_key, sideIndex: vCtx.sideIndex, trackIndex: nextTrackIdx },
      });
      return;
    }

    const nextSideIdx = vCtx.sideIndex + 1;
    if (nextSideIdx < platter.sides.length && platter.sides[nextSideIdx].tracks.length > 0) {
      vinylFoley.playRecordPlace(st.soundFx);
      st.setActiveSideIndex(nextSideIdx);
      const firstOnNextSide = platter.sides[nextSideIdx].tracks[0];
      playTrack({
        song_name: firstOnNextSide.title,
        artist_name: firstOnNextSide.artist_name || platter.artist_name,
        album_name: platter.album_name,
        artwork_url: platter.artwork_url,
        track_key: firstOnNextSide.track_key,
        preview_url: firstOnNextSide.preview_url,
        duration_ms: firstOnNextSide.duration_ms,
        vinyl: { album_key: platter.album_key, sideIndex: nextSideIdx, trackIndex: 0 },
      });
      return;
    }

    playbackClock.set(0, playbackClock.getDurationMs(), false);
    st.setIsPlaying(false);
    st.setMotorOn(false);
  }, []);

  // 1. Live Now-Playing WebSocket (`/ws/now-playing`) with exponential backoff reconnect
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket | null = null;
    let closed = false;
    let delayMs = 1500;
    let retryTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(`${proto}://${window.location.host}/ws/now-playing`);
        ws.onopen = () => {
          delayMs = 1500;
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "now_playing" && msg.data?.song_name) {
              const st = useV4Store.getState();
              if (!st.nowPlaying || !st.isPlaying || st.nowPlaying.source === "external" || st.nowPlaying.source === "bridge") {
                if (
                  st.preferredSource === "bridge" &&
                  st.nowPlaying &&
                  Date.now() - getLastBridgePlayAt() < 6000 &&
                  !msg.data.song_name
                    .toLowerCase()
                    .includes(st.nowPlaying.song_name.toLowerCase().slice(0, 12))
                ) {
                  return;
                }
                const dur = msg.data.duration_ms || st.nowPlaying?.duration_ms || 180_000;
                const pos = msg.data.position_ms || 0;
                const playing = Boolean(msg.data.is_playing);
                playbackClock.set(pos, dur, playing);
                const sameSong =
                  Boolean(st.nowPlaying) &&
                  msg.data.song_name
                    .toLowerCase()
                    .includes(st.nowPlaying!.song_name.toLowerCase().slice(0, 12));
                st.setNowPlaying({
                  song_name: msg.data.song_name,
                  artist_name: msg.data.artist_name || st.nowPlaying?.artist_name || "",
                  album_name: msg.data.album_name || st.nowPlaying?.album_name || "",
                  artwork_url: msg.data.artwork_url || st.nowPlaying?.artwork_url || null,
                  track_key: sameSong ? st.nowPlaying?.track_key : undefined,
                  duration_ms: dur,
                  source: st.preferredSource === "bridge" ? "bridge" : "external",
                  vinyl: sameSong ? st.nowPlaying?.vinyl ?? null : null,
                });
                st.setIsPlaying(playing);
                st.setMotorOn(playing);
              }
            }
          } catch {
            /* ignore */
          }
        };
        ws.onclose = () => {
          if (closed) return;
          retryTimer = window.setTimeout(connect, delayMs);
          delayMs = Math.min(30_000, delayMs * 2);
        };
      } catch {
        /* ignore */
      }
    };
    connect();
    return () => {
      closed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [setNowPlaying, setIsPlaying, setMotorOn]);

  // 2. Extension MV3 Bridge WebSocket (`/ws/bridge?role=frontend`) with exponential backoff reconnect
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket | null = null;
    let closed = false;
    let delayMs = 1500;
    let retryTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(`${proto}://${window.location.host}/ws/bridge?role=frontend`);
        bridgeWsRef.current = ws;
        registerBridgeSender((msg) => {
          if (bridgeWsRef.current && bridgeWsRef.current.readyState === WebSocket.OPEN) {
            bridgeWsRef.current.send(JSON.stringify(msg));
            return true;
          }
          return false;
        });
        ws.onopen = () => {
          delayMs = 1500;
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "bridge_status" && msg.data) {
              setExtensionStatus(
                Boolean(msg.data.extension_connected),
                (msg.data.platforms || []).map((p: any) => p.platform)
              );
            } else if (msg.type === "track_ended") {
              const stCur = useV4Store.getState();
              if (stCur.nowPlaying?.source === "bridge" && Date.now() - getLastBridgePlayAt() > 2500) {
                advanceToNextVinylTrack();
              }
            } else if (msg.type === "autoplay_blocked" && msg.detail) {
              useV4Store.getState().showToast(msg.detail, 4500);
            } else if (msg.type === "error" && msg.detail) {
              useV4Store.getState().showToast(msg.detail, 5000);
              useV4Store.getState().setPlaybackError(msg.detail);
            }
          } catch {
            /* ignore */
          }
        };
        ws.onclose = () => {
          if (closed) return;
          retryTimer = window.setTimeout(connect, delayMs);
          delayMs = Math.min(30_000, delayMs * 2);
        };
      } catch {
        /* ignore */
      }
    };
    connect();
    return () => {
      closed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      registerBridgeSender(null);
      bridgeWsRef.current = null;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [setExtensionStatus, advanceToNextVinylTrack]);

  // 3. Lazy Mount & 45s Pause / Power-Off / Source-Switch Hibernation for YouTube OOPIF
  const wantsYouTube = Boolean(
    powerOn && preferredSource === "youtube" && nowPlaying?.source === "youtube" && nowPlaying.video_id
  );

  useEffect(() => {
    if (!wantsYouTube) {
      setYtMounted(false);
      loadedVideoIdRef.current = null;
      return;
    }
    if (isPlaying) {
      setYtMounted(true);
      return;
    }
    // Hibernation timer: after 45s of pause, unmount YT iframe completely to reclaim ~120 Mo RAM
    const timer = window.setTimeout(() => {
      if (!useV4Store.getState().isPlaying) {
        setYtMounted(false);
        loadedVideoIdRef.current = null;
      }
    }, YT_HIBERNATE_MS);
    return () => window.clearTimeout(timer);
  }, [wantsYouTube, isPlaying]);

  // Deterministic YouTube OOPIF teardown (`about:blank` + `destroy()` + `replaceChildren()`)
  // Managed on a permanently-mounted host <div> so React never hits `removeChild` NotFoundError!
  useEffect(() => {
    if (!ytMounted) {
      teardownYouTubeHost(ytPlayerRef, ytHostNodeRef.current);
      loadedVideoIdRef.current = null;
    }
  }, [ytMounted]);

  useEffect(() => {
    return () => {
      teardownYouTubeHost(ytPlayerRef, ytHostNodeRef.current);
      loadedVideoIdRef.current = null;
    };
  }, []);

  // 4. YouTube IFrame JS API lifecycle (only runs when `ytMounted === true`)
  useEffect(() => {
    if (!ytMounted || !wantsYouTube || !portalTarget) return;
    const vid = nowPlaying?.video_id;
    if (!vid) return;

    let cancelled = false;

    ensureYouTubeApiLoaded().then((YT) => {
      if (cancelled || !YT || !ytHostNodeRef.current) return;

      if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === "function") {
        if (loadedVideoIdRef.current !== vid) {
          loadedVideoIdRef.current = vid;
          ytPlayerRef.current.loadVideoById(vid);
        }
        ytPlayerRef.current.setVolume?.(useV4Store.getState().volumePct);
        if (useV4Store.getState().isPlaying) {
          ytPlayerRef.current.playVideo?.();
        }
        return;
      }

      ytHostNodeRef.current.replaceChildren();
      const child = document.createElement("div");
      ytHostNodeRef.current.appendChild(child);
      loadedVideoIdRef.current = vid;

      ytPlayerRef.current = new YT.Player(child, {
        width: "240",
        height: "126",
        host: "https://www.youtube-nocookie.com",
        videoId: vid,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e: any) => {
            e.target.setVolume?.(useV4Store.getState().volumePct);
            if (useV4Store.getState().isPlaying) {
              e.target.playVideo?.();
            }
          },
          onStateChange: (e: any) => {
            if (e.data === 1) {
              const durSec = e.target.getDuration?.() || 0;
              const curSec = e.target.getCurrentTime?.() || 0;
              const durMs =
                durSec > 0 ? Math.round(durSec * 1000) : useV4Store.getState().nowPlaying?.duration_ms || 180_000;
              playbackClock.set(Math.round(curSec * 1000), durMs, true);
              useV4Store.getState().setIsPlaying(true);
              useV4Store.getState().setMotorOn(true);
            } else if (e.data === 2) {
              const curSec = e.target.getCurrentTime?.() || 0;
              playbackClock.set(Math.round(curSec * 1000), playbackClock.getDurationMs(), false);
              useV4Store.getState().setIsPlaying(false);
              useV4Store.getState().setMotorOn(false);
            } else if (e.data === 0) {
              advanceToNextVinylTrack();
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [ytMounted, wantsYouTube, nowPlaying?.video_id, portalTarget, advanceToNextVinylTrack]);

  // Sync play/pause toggle to YT.Player
  useEffect(() => {
    if (nowPlaying?.source === "youtube" && ytPlayerRef.current) {
      try {
        if (isPlaying) ytPlayerRef.current.playVideo?.();
        else ytPlayerRef.current.pauseVideo?.();
      } catch {
        /* ignore */
      }
    }
  }, [isPlaying, nowPlaying?.source]);

  // Sync 3D Turntable Volume Fader (`volumePct`)
  useEffect(() => {
    if (ytPlayerRef.current?.setVolume) {
      try {
        ytPlayerRef.current.setVolume(volumePct);
      } catch {
        /* ignore */
      }
    }
    if (audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, volumePct / 100));
    }
    if (preferredSource === "bridge" || nowPlaying?.source === "bridge") {
      sendBridgeCommand("volume", {
        volume: Math.max(0, Math.min(1, volumePct / 100)),
        volume_pct: volumePct,
      });
    }
  }, [volumePct, preferredSource, nowPlaying?.source]);

  // 5. HTML5 30s Preview Audio sync
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, useV4Store.getState().volumePct / 100));
    if (powerOn && nowPlaying?.source === "preview" && nowPlaying.preview_url) {
      const proxied = `/api/audio-proxy?url=${encodeURIComponent(nowPlaying.preview_url)}`;
      if (audio.src !== window.location.origin + proxied) {
        audio.src = proxied;
      }
      if (isPlaying) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    } else {
      audio.pause();
    }
  }, [powerOn, nowPlaying?.source, nowPlaying?.preview_url, isPlaying]);

  // 6. Handle Seek Requests from bottom slider or 3D groove click
  useEffect(() => {
    if (seekRequestMs === null) return;
    const sec = seekRequestMs / 1000;
    const dur = playbackClock.getDurationMs() || nowPlaying?.duration_ms || 180_000;
    playbackClock.set(seekRequestMs, dur, isPlaying);

    if (nowPlaying?.source === "youtube" && ytPlayerRef.current?.seekTo) {
      try {
        ytPlayerRef.current.seekTo(sec, true);
      } catch {
        /* ignore */
      }
    } else if (nowPlaying?.source === "preview" && audioRef.current) {
      audioRef.current.currentTime = sec;
    } else if (nowPlaying?.source === "bridge") {
      sendBridgeCommand("seek", {
        seconds: sec,
        position_ms: Math.round(seekRequestMs),
        duration_ms: Math.round(dur),
      });
    }
    requestSeekMs(null);
  }, [seekRequestMs, nowPlaying?.source, nowPlaying?.duration_ms, isPlaying, requestSeekMs]);

  // 7. Poll playback clock every 400ms & auto-advance at track end
  useEffect(() => {
    if (!nowPlaying || !isPlaying) {
      playbackClock.set(playbackClock.getPositionMs(), nowPlaying?.duration_ms || 0, false);
      return;
    }
    playbackClock.set(playbackClock.getPositionMs(), nowPlaying.duration_ms || 180_000, true);

    const id = window.setInterval(() => {
      let pos = playbackClock.getPositionMs();
      let dur = playbackClock.getDurationMs() || nowPlaying.duration_ms || 180_000;

      if (nowPlaying.source === "youtube" && ytPlayerRef.current?.getCurrentTime) {
        try {
          const curSec = ytPlayerRef.current.getCurrentTime();
          const durSec = ytPlayerRef.current.getDuration?.() || 0;
          if (Number.isFinite(curSec) && curSec >= 0) pos = Math.round(curSec * 1000);
          if (Number.isFinite(durSec) && durSec > 0) dur = Math.round(durSec * 1000);
        } catch {
          /* ignore */
        }
      } else if (nowPlaying.source === "preview" && audioRef.current) {
        pos = Math.round(audioRef.current.currentTime * 1000);
        if (Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0) {
          dur = Math.round(audioRef.current.duration * 1000);
        }
      }

      if (nowPlaying.source === "bridge") {
        playbackClock.set(pos, dur, true);
      } else {
        if (pos >= dur && dur > 0) {
          advanceToNextVinylTrack();
          return;
        }
        playbackClock.set(pos, dur, true);
      }

      const sig = `${nowPlaying.song_name}::${nowPlaying.artist_name}`;
      if (pos >= 30_000 && pos >= dur * 0.5 && scrobbledSigRef.current !== sig) {
        scrobbledSigRef.current = sig;
        apiPost(API.scrobble, {
          song_name: nowPlaying.song_name,
          artist_name: nowPlaying.artist_name,
          album_name: nowPlaying.album_name,
          play_duration_ms: Math.round(pos),
          media_duration_ms: Math.round(dur),
          provider:
            nowPlaying.source === "youtube"
              ? "youtube_iframe"
              : nowPlaying.source === "bridge"
              ? "extension_bridge"
              : "preview_audio",
          video_id: nowPlaying.video_id || undefined,
          artwork_url: nowPlaying.artwork_url || undefined,
          event_type: "scrobble",
        }).catch(() => {});
      }
    }, 400);

    return () => clearInterval(id);
  }, [nowPlaying, isPlaying, advanceToNextVinylTrack]);

  const effDur = durationMs || nowPlaying?.duration_ms || 0;
  const pct = effDur > 0 ? Math.min(100, Math.max(0, (positionMs / effDur) * 100)) : 0;
  const activePlatformList = extensionPlatforms.map((p) => PLATFORM_LABELS[p] || p).join(" · ");

  // Turntable 3D OLED Console (Lightweight Façade when ytMounted === false -> 0 Mo YT RAM)
  const turntableScreenContent = (
    <div
      onPointerEnter={preconnectYouTube}
      style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
      className="w-[240px] h-[148px] flex flex-col bg-[#080605] text-ink"
    >
      <div className="flex items-center justify-between px-2 py-0.5 bg-[#120e0b] border-b border-line text-[9px] num shrink-0">
        <span className="flex items-center gap-1 text-amber">
          <Tv className="w-2.5 h-2.5" />
          {!powerOn ? "STANDBY" : preferredSource === "bridge" ? "BRIDGE · 0€" : "PLATINE SL-1200"}
        </span>
        <span className="text-ink-3">
          VOL {volumePct}% · {formatDurationMs(positionMs)}
        </span>
      </div>
      <div className="relative flex-1 bg-black overflow-hidden">
        {/* Permanently mounted host container: YT.Player mutates its children imperatively,
            while React never unmounts it — eliminates `removeChild` NotFoundError on track skip! */}
        <div ref={ytHostNodeRef} className={`w-full h-full ${ytMounted ? "block" : "hidden"}`} />
        {!ytMounted && (
          <div className="absolute inset-0 p-2.5 flex flex-col justify-between text-[10px] num">
            <div className="flex items-center justify-between text-amber text-[9px]">
              <span>{powerOn ? "QUARTZ LOCK" : "POWER OFF"}</span>
              <span>
                {preferredSource === "youtube"
                  ? "YT FAÇADE"
                  : preferredSource === "bridge"
                  ? extensionConnected
                    ? "ONGLET ACTIF"
                    : "BRIDGE"
                  : "30S"}
              </span>
            </div>
            <div>
              <p className="font-sans text-[11px] font-medium text-ink truncate">
                {nowPlaying?.song_name || "Platine prête"}
              </p>
              <p className="text-ink-3 truncate text-[9.5px]">
                {nowPlaying?.artist_name || "Clique START ou un sillon 12\""}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <audio
        ref={audioRef}
        className="hidden"
        onEnded={() => {
          advanceToNextVinylTrack();
        }}
        onError={async () => {
          const cur = useV4Store.getState().nowPlaying;
          if (!cur || cur.source !== "preview") return;
          const sig = `${cur.track_key || ""}::${cur.artist_name}::${cur.song_name}`.toLowerCase();
          if (refreshedPreviewKeysRef.current.has(sig)) return;
          refreshedPreviewKeysRef.current.add(sig);
          try {
            const qs = new URLSearchParams({
              song: cur.song_name,
              artist: cur.artist_name || "",
              album: cur.album_name || "",
            });
            if (cur.track_key) qs.set("track_key", cur.track_key);
            const res = await apiGet<{ ok: boolean; preview_url: string | null; artwork_url: string | null }>(
              `/api/v4/playback/refresh-preview?${qs.toString()}`
            );
            if (res.ok && res.preview_url) {
              const latest = useV4Store.getState().nowPlaying;
              if (latest && latest.song_name === cur.song_name) {
                useV4Store.getState().setNowPlaying({
                  ...latest,
                  preview_url: res.preview_url,
                  artwork_url: latest.artwork_url || res.artwork_url || null,
                });
              }
            }
          } catch {
            /* ignore refresh error */
          }
        }}
      />
      {portalTarget && createPortal(turntableScreenContent, portalTarget)}

      {/* Guided 3-step Bridge Extension Popover */}
      {showBridgeGuide && (
        <div className="fixed bottom-16 right-4 sm:right-7 z-50 w-80 bg-bg-2 border border-line-2 rounded-lg shadow-2xl p-4 text-xs space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-ink">Piloter ton onglet ouvert (0 €)</span>
            <button onClick={() => setShowBridgeGuide(false)} className="text-ink-3 hover:text-ink" aria-label="Fermer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-ink-2 leading-relaxed">
            Pilote directement ton onglet ouvert <strong>Apple Music</strong>, <strong>Spotify</strong> ou{" "}
            <strong>Deezer</strong> sans aucune clé API payante :
          </p>
          <ol className="list-decimal list-inside space-y-1.5 text-ink-2">
            <li>
              Ouvre <code className="text-amber">chrome://extensions</code> et active le <em>Mode développeur</em>.
            </li>
            <li>
              Clique <strong>Charger l'extension non empaquetée</strong> → dossier{" "}
              <code className="text-amber">extensions/amdatawrap-bridge</code>.
            </li>
            <li>
              Ouvre <code className="text-ink">music.apple.com</code>, <code className="text-ink">open.spotify.com</code>{" "}
              ou <code className="text-ink">deezer.com</code> : le badge passe au vert.
            </li>
          </ol>
          <div className="pt-1 flex justify-between items-center text-[11px]">
            <span className={extensionConnected ? "text-moss font-medium" : "text-ink-3"}>
              {extensionConnected ? `Connecté : ${activePlatformList || "Extension prête"}` : "En attente de l'extension…"}
            </span>
            <button onClick={() => setShowBridgeGuide(false)} className="btn text-[11px] py-1 px-2">
              Compris
            </button>
          </div>
        </div>
      )}

      {/* Bottom Transport Bar */}
      <footer
        onPointerEnter={preconnectYouTube}
        className="fixed bottom-0 inset-x-0 z-40 h-14 bg-bg-2 border-t border-line px-4 sm:px-7 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5 min-w-0 w-1/3">
          {nowPlaying ? (
            <>
              <Cover url={nowPlaying.artwork_url} alt={nowPlaying.song_name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate text-ink">{nowPlaying.song_name}</p>
                <p className="text-[11px] text-ink-2 truncate">
                  {nowPlaying.artist_name}
                  {nowPlaying.album_name ? ` · ${nowPlaying.album_name}` : ""}
                </p>
              </div>
              {activeTab !== "studio" && (
                <button
                  onClick={() => {
                    setActiveTab("studio");
                    setVinylStage("TURNTABLE");
                  }}
                  data-testid="jump-to-turntable"
                  className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 text-[11px] text-amber hover:bg-bg-3 shrink-0 transition-colors"
                  title="Basculer dans le Salon 3D sur la platine"
                >
                  <Disc3 className="w-3 h-3" />
                  <span>Voir sur la platine</span>
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <Disc3 className="w-4 h-4 text-ink-3 shrink-0" />
              <span className="truncate">Platine en veille — clique sur START ou un sillon du vinyle 3D</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-1 max-w-xl">
          <button
            onClick={() => prevVinylTrack()}
            disabled={!nowPlaying && !onPlatter}
            className="p-1.5 rounded-full text-ink-2 hover:text-ink hover:bg-bg-3 disabled:opacity-30 transition-colors shrink-0"
            aria-label="Piste précédente"
            title="Piste précédente (J)"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => {
              vinylFoley.playStartStopButton(soundFx);
              togglePlayback();
            }}
            disabled={!nowPlaying && !onPlatter}
            className="btn btn-primary btn-icon rounded-full shrink-0"
            aria-label="Lecture / Pause"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => nextVinylTrack()}
            disabled={!nowPlaying && !onPlatter}
            className="p-1.5 rounded-full text-ink-2 hover:text-ink hover:bg-bg-3 disabled:opacity-30 transition-colors shrink-0"
            aria-label="Piste suivante"
            title="Piste suivante (K)"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <span className="num text-xs text-ink-2 w-10 text-right">{formatDurationMs(positionMs)}</span>

          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(pct)}
            disabled={!nowPlaying}
            style={{ ["--pct" as any]: `${pct}%` }}
            onChange={(e) => {
              const ratio = Number(e.target.value) / 100;
              const targetMs = ratio * (effDur || 180_000);
              requestSeekMs(targetMs);
            }}
            aria-label="Position sur le sillon"
            className="scrubber flex-1"
          />

          <span className="num text-xs text-ink-3 w-10">{formatDurationMs(effDur)}</span>
        </div>

        <div className="hidden sm:flex items-center justify-end gap-1.5 w-1/3 text-xs">
          {playbackError && <span className="text-ember text-[11px] truncate max-w-[140px]">{playbackError}</span>}
          {bpm != null && (
            <span className="px-1.5 py-0.5 rounded bg-bg-3 border border-line text-[10px] font-mono text-amber shrink-0">
              {bpm} {t("player.bpm")}
            </span>
          )}
          <button
            type="button"
            data-testid="lyrics-toggle"
            onClick={() => setLyricsOpen((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition-colors shrink-0 ${
              lyricsOpen
                ? "bg-amber text-[#1a0f07] border-amber font-semibold"
                : "border-line bg-bg-1 text-ink-2 hover:text-ink"
            }`}
            title={t("player.lyricsTitle")}
          >
            <FileText className="w-3 h-3" />
            <span className="hidden lg:inline">{t("player.lyrics")}</span>
          </button>
          <span className="num text-[11px] text-ink-3 mr-1 hidden xl:inline">VOL {volumePct}%</span>

          {/* Clear 0 EUR Source Switcher: YouTube Integrated vs Open Tab Bridge (Apple Music / Spotify / Deezer) */}
          <div className="inline-flex items-center rounded border border-line bg-bg-1 p-0.5 gap-0.5">
            <button
              onClick={() => {
                setShowBridgeGuide(false);
                setPreferredSource("youtube");
              }}
              data-testid="source-youtube"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                preferredSource === "youtube"
                  ? "bg-amber text-[#1a0f07] font-semibold"
                  : "text-ink-2 hover:text-ink"
              }`}
              title="YouTube intégré gratuit (façade légère, 0 €)"
            >
              <Tv className="w-3 h-3" />
              <span>YouTube</span>
            </button>

            <button
              onClick={() => {
                setPreferredSource("bridge");
                if (!extensionConnected) setShowBridgeGuide(true);
              }}
              data-testid="source-bridge"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                preferredSource === "bridge"
                  ? "bg-amber text-[#1a0f07] font-semibold"
                  : "text-ink-2 hover:text-ink"
              }`}
              title="Piloter mon onglet ouvert (Apple Music / Spotify / Deezer · 0 €)"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  extensionConnected ? "bg-moss" : "bg-ink-3/60"
                }`}
              />
              <ExternalLink className="w-3 h-3" />
              <span className="hidden lg:inline">
                {extensionConnected && activePlatformList ? activePlatformList : "Mon onglet"}
              </span>
            </button>

            <button
              onClick={() => {
                setShowBridgeGuide(false);
                setPreferredSource("preview");
              }}
              data-testid="source-preview"
              className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-[11px] transition-colors ${
                preferredSource === "preview"
                  ? "bg-amber text-[#1a0f07] font-semibold"
                  : "text-ink-2 hover:text-ink"
              }`}
              title="Extrait 30s natif"
            >
              <Radio className="w-3 h-3" />
              <span className="hidden xl:inline">30s</span>
            </button>
          </div>
        </div>
      </footer>
      <LyricsPanel open={lyricsOpen} onClose={() => setLyricsOpen(false)} />
    </>
  );
};
