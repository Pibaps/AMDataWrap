/**
 * Bottom Transport Bar & True 3D Turntable-Embedded YouTube Player (via React Portal into CSS3DObject + YT.Player JS API).
 *
 * Refinements from user feedback:
 * - Renders the YouTube player inside `#turntable-css3d-screen` via `createPortal`, so it is a genuine
 *   3D plane glued onto the front of the turntable plinth (`CSS3DRenderer`) — it NEVER floats in 2D
 *   and NEVER collides with the crate or any UI element!
 * - Uses the official YouTube IFrame JS API (`window.YT.Player`) for bidirectional sync:
 *   * `getCurrentTime()` and `getDuration()` drive the bottom slider and the 3D tonearm groove radius in real time.
 *   * Dragging the bottom slider calls `ytPlayer.seekTo(seconds, true)` so the YouTube track and the 3D tonearm seek together!
 *   * Play/Pause buttons on the 3D turntable (`START · STOP`) or bottom bar call `ytPlayer.playVideo()` / `pauseVideo()`.
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Disc3, Pause, Play, Radio, Tv } from "lucide-react";
import { API, apiPost, formatDurationMs } from "../api/client";
import { playbackClock, usePlaybackClock } from "../audio/playbackClock";
import { togglePlayback } from "../audio/playTrack";
import { vinylFoley } from "../audio/vinylFoley";
import { useV4Store } from "../store/useV4Store";
import { Cover } from "./ui";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
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

export const HybridPlaybackDeck: React.FC = () => {
  const nowPlaying = useV4Store((s) => s.nowPlaying);
  const setNowPlaying = useV4Store((s) => s.setNowPlaying);
  const isPlaying = useV4Store((s) => s.isPlaying);
  const setIsPlaying = useV4Store((s) => s.setIsPlaying);
  const setMotorOn = useV4Store((s) => s.setMotorOn);
  const preferredSource = useV4Store((s) => s.preferredSource);
  const setPreferredSource = useV4Store((s) => s.setPreferredSource);
  const playbackError = useV4Store((s) => s.playbackError);
  const soundFx = useV4Store((s) => s.soundFx);
  const seekRequestMs = useV4Store((s) => s.seekRequestMs);
  const requestSeekMs = useV4Store((s) => s.requestSeekMs);
  const setExtensionStatus = useV4Store((s) => s.setExtensionStatus);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const loadedVideoIdRef = useRef<string | null>(null);
  const scrobbledSigRef = useRef<string>("");
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const { positionMs, durationMs } = usePlaybackClock(250);

  useEffect(() => {
    const el = document.getElementById("turntable-css3d-screen");
    if (el) setPortalTarget(el);
  }, []);

  // 1. Live Now-Playing WebSocket (`/ws/now-playing`)
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${proto}://${window.location.host}/ws/now-playing`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "now_playing" && msg.data?.song_name) {
            const st = useV4Store.getState();
            if (!st.nowPlaying || !st.isPlaying || st.nowPlaying.source === "external") {
              const dur = msg.data.duration_ms || 180_000;
              const pos = msg.data.position_ms || 0;
              const playing = Boolean(msg.data.is_playing);
              playbackClock.set(pos, dur, playing);
              st.setNowPlaying({
                song_name: msg.data.song_name,
                artist_name: msg.data.artist_name || "",
                album_name: msg.data.album_name || "",
                artwork_url: msg.data.artwork_url || null,
                duration_ms: dur,
                source: "external",
              });
              st.setIsPlaying(playing);
              st.setMotorOn(playing);
            }
          }
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* ignore */
    }
    return () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [setNowPlaying, setIsPlaying, setMotorOn]);

  // 2. Extension MV3 Bridge WebSocket (`/ws/bridge?role=frontend`)
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${proto}://${window.location.host}/ws/bridge?role=frontend`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "bridge_status" && msg.data) {
            setExtensionStatus(
              Boolean(msg.data.extension_connected),
              (msg.data.platforms || []).map((p: any) => p.platform)
            );
          }
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* ignore */
    }
    return () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [setExtensionStatus]);

  // 3. YouTube IFrame JS API lifecycle (bidirectional sync with bottom slider & 3D tonearm)
  useEffect(() => {
    const isYt = nowPlaying?.source === "youtube" && Boolean(nowPlaying.video_id);
    if (!isYt || !portalTarget) return;

    const vid = nowPlaying!.video_id!;
    let cancelled = false;

    ensureYouTubeApiLoaded().then((YT) => {
      if (cancelled || !YT || !ytHostRef.current) return;

      if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === "function") {
        if (loadedVideoIdRef.current !== vid) {
          loadedVideoIdRef.current = vid;
          ytPlayerRef.current.loadVideoById(vid);
        }
        if (useV4Store.getState().isPlaying) {
          ytPlayerRef.current.playVideo?.();
        }
        return;
      }

      ytHostRef.current.innerHTML = "";
      const child = document.createElement("div");
      ytHostRef.current.appendChild(child);
      loadedVideoIdRef.current = vid;

      ytPlayerRef.current = new YT.Player(child, {
        width: "240",
        height: "126",
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
            if (useV4Store.getState().isPlaying) {
              e.target.playVideo?.();
            }
          },
          onStateChange: (e: any) => {
            // YT.PlayerState.PLAYING === 1, PAUSED === 2, ENDED === 0
            if (e.data === 1) {
              const durSec = e.target.getDuration?.() || 0;
              const curSec = e.target.getCurrentTime?.() || 0;
              const durMs = durSec > 0 ? Math.round(durSec * 1000) : useV4Store.getState().nowPlaying?.duration_ms || 180_000;
              playbackClock.set(Math.round(curSec * 1000), durMs, true);
              useV4Store.getState().setIsPlaying(true);
              useV4Store.getState().setMotorOn(true);
            } else if (e.data === 2) {
              const curSec = e.target.getCurrentTime?.() || 0;
              playbackClock.set(Math.round(curSec * 1000), playbackClock.getDurationMs(), false);
              useV4Store.getState().setIsPlaying(false);
              useV4Store.getState().setMotorOn(false);
            } else if (e.data === 0) {
              playbackClock.set(0, playbackClock.getDurationMs(), false);
              useV4Store.getState().setIsPlaying(false);
              useV4Store.getState().setMotorOn(false);
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [nowPlaying?.source, nowPlaying?.video_id, portalTarget]);

  // Sync play/pause toggle from 3D turntable START/STOP button or bottom bar to YT.Player
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

  // 4. HTML5 30s Preview Audio sync
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (nowPlaying?.source === "preview" && nowPlaying.preview_url) {
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
  }, [nowPlaying?.source, nowPlaying?.preview_url, isPlaying]);

  // 5. Handle Seek Requests from bottom slider or 3D groove click
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
    }
    requestSeekMs(null);
  }, [seekRequestMs, nowPlaying?.source, nowPlaying?.duration_ms, isPlaying, requestSeekMs]);

  // 6. Poll real YT.Player / HTML5 audio currentTime every 400ms & auto-scrobble at 50%
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

      if (pos >= dur && dur > 0) {
        playbackClock.set(0, dur, false);
        useV4Store.getState().setIsPlaying(false);
        useV4Store.getState().setMotorOn(false);
        return;
      }
      playbackClock.set(pos, dur, true);

      const sig = `${nowPlaying.song_name}::${nowPlaying.artist_name}`;
      if (pos >= 30_000 && pos >= dur * 0.5 && scrobbledSigRef.current !== sig) {
        scrobbledSigRef.current = sig;
        apiPost(API.scrobble, {
          song_name: nowPlaying.song_name,
          artist_name: nowPlaying.artist_name,
          album_name: nowPlaying.album_name,
          play_duration_ms: Math.round(pos),
          media_duration_ms: Math.round(dur),
          provider: nowPlaying.source === "youtube" ? "youtube_iframe" : "preview_audio",
          video_id: nowPlaying.video_id || undefined,
          artwork_url: nowPlaying.artwork_url || undefined,
          event_type: "scrobble",
        }).catch(() => {});
      }
    }, 400);

    return () => clearInterval(id);
  }, [nowPlaying, isPlaying]);

  const isYt = Boolean(nowPlaying?.source === "youtube" && nowPlaying.video_id);
  const effDur = durationMs || nowPlaying?.duration_ms || 0;
  const pct = effDur > 0 ? Math.min(100, Math.max(0, (positionMs / effDur) * 100)) : 0;

  const turntableScreenContent = (
    <div className="w-[240px] h-[148px] flex flex-col bg-[#080605] text-ink">
      <div className="flex items-center justify-between px-2 py-0.5 bg-[#120e0b] border-b border-line text-[9px] num shrink-0">
        <span className="flex items-center gap-1 text-amber">
          <Tv className="w-2.5 h-2.5" />
          PLATINE SL-1200 · YT
        </span>
        <span className="text-ink-3">{formatDurationMs(positionMs)}</span>
      </div>
      <div className="relative flex-1 bg-black overflow-hidden">
        <div ref={ytHostRef} className={`w-full h-full ${isYt ? "block" : "hidden"}`} />
        {!isYt && (
          <div className="absolute inset-0 p-2.5 flex flex-col justify-between text-[10px] num">
            <div className="flex items-center justify-between text-amber text-[9px]">
              <span>QUARTZ LOCK</span>
              <span>{preferredSource === "youtube" ? "YT READY" : "30S"}</span>
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
      <audio ref={audioRef} className="hidden" />
      {portalTarget && createPortal(turntableScreenContent, portalTarget)}

      {/* Bottom Transport Bar (synchronized bidirectionally with YouTube IFrame JS API & 3D Tonearm) */}
      <footer className="fixed bottom-0 inset-x-0 z-40 h-14 bg-bg-2 border-t border-line px-4 sm:px-7 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 w-1/3">
          {nowPlaying ? (
            <>
              <Cover url={nowPlaying.artwork_url} alt={nowPlaying.song_name} size={36} />
              <div className="min-w-0">
                <p className="text-xs font-medium truncate text-ink">{nowPlaying.song_name}</p>
                <p className="text-[11px] text-ink-2 truncate">
                  {nowPlaying.artist_name}
                  {nowPlaying.album_name ? ` · ${nowPlaying.album_name}` : ""}
                </p>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <Disc3 className="w-4 h-4 text-ink-3" />
              <span className="truncate">Platine en veille — clique sur START ou sur un vinyle dans le bac 3D</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-1 max-w-xl">
          <button
            onClick={() => {
              vinylFoley.playClick(soundFx);
              togglePlayback();
            }}
            disabled={!nowPlaying}
            className="btn btn-primary btn-icon rounded-full shrink-0"
            aria-label="Lecture / Pause"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
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

        <div className="hidden sm:flex items-center justify-end gap-2 w-1/3 text-xs">
          {playbackError && <span className="text-ember text-[11px] truncate max-w-[180px]">{playbackError}</span>}

          <button
            onClick={() => setPreferredSource(preferredSource === "youtube" ? "preview" : "youtube")}
            className="btn text-xs"
            title="Basculer entre titre complet YouTube (sur l'écran 3D de la platine) et extrait 30s"
          >
            {preferredSource === "youtube" ? (
              <>
                <Tv className="w-3.5 h-3.5 text-amber" />
                <span>YouTube 3D Platine</span>
              </>
            ) : (
              <>
                <Radio className="w-3.5 h-3.5 text-brass" />
                <span>Extrait 30s</span>
              </>
            )}
          </button>
        </div>
      </footer>
    </>
  );
};
