/**
 * Hybrid 0 EUR Full-Track Playback Deck:
 * 1. `YouTubeIFrameProvider` (default, PC & Mobile, 0 install, >= 200x200 px ToS compliant)
 *    - Double intelligent display:
 *      * On `studio` tab: docked cleanly inside the Turntable Digital Display panel
 *      * On stats tabs: draggable V2 glassmorphism floating cartridge (240x200 px), shown ONLY when YT active
 *    - Anti-Error 153: `referrerPolicy="strict-origin-when-cross-origin"`, `origin`, `playsinline=1`
 * 2. `ExtensionBridgeProvider` (PC opt-in via `WS /ws/bridge?role=frontend`)
 * 3. `PreviewAudioProvider` (30s fallback audio element)
 * 4. `WS /ws/now-playing` listener so external PC/Mobile listens spin the 3D turntable live!
 */

import React, { useEffect, useRef, useState } from "react";
import { Pause, Play, Radio, Tv, Volume2, GripHorizontal, X } from "lucide-react";
import { apiPost, formatDurationMs } from "../api/client";
import { useV4Store } from "../store/useV4Store";
import { vinylFoley } from "../audio/vinylFoley";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const HybridPlaybackDeck: React.FC = () => {
  const activeTab = useV4Store((s) => s.activeTab);
  const nowPlaying = useV4Store((s) => s.nowPlaying);
  const setNowPlaying = useV4Store((s) => s.setNowPlaying);
  const updatePlaybackClock = useV4Store((s) => s.updatePlaybackClock);
  const seekRequestSec = useV4Store((s) => s.seekRequestSec);
  const requestSeek = useV4Store((s) => s.requestSeek);
  const soundFxEnabled = useV4Store((s) => s.soundFxEnabled);
  const setExtensionStatus = useV4Store((s) => s.setExtensionStatus);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const bridgeWsRef = useRef<WebSocket | null>(null);
  const scrobbledSigRef = useRef<string>("");

  // Draggable floating cartridge position on non-studio tabs
  const [floatPos, setFloatPos] = useState({ x: 24, y: 84 });
  const dragRef = useRef<{ active: boolean; ox: number; oy: number }>({ active: false, ox: 0, oy: 0 });

  // 1. Live Now-Playing WebSocket (`/ws/now-playing`) for external desktop/mobile listens
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/now-playing`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "now_playing" && msg.data?.song_name) {
          const cur = useV4Store.getState().nowPlaying;
          // Only override if no local YouTube playback is actively playing
          if (!cur || !cur.is_playing || cur.provider === "external_live") {
            setNowPlaying({
              song_name: msg.data.song_name,
              artist_name: msg.data.artist_name || "",
              album_name: msg.data.album_name || "",
              artwork_url: msg.data.artwork_url || null,
              duration_ms: msg.data.duration_ms || 180_000,
              position_ms: msg.data.position_ms || 0,
              is_playing: Boolean(msg.data.is_playing),
              provider: "external_live",
            });
          }
        }
      } catch {
        // ignore malformed frames
      }
    };
    return () => ws.close();
  }, [setNowPlaying]);

  // 2. Extension MV3 Bridge WebSocket (`/ws/bridge?role=frontend`)
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/bridge?role=frontend`);
    bridgeWsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "bridge_status" && msg.data) {
          setExtensionStatus(
            Boolean(msg.data.extension_connected),
            (msg.data.platforms || []).map((p: any) => p.platform)
          );
        } else if (msg.type === "playback_state" && msg.data?.song_name) {
          setNowPlaying({
            song_name: msg.data.song_name,
            artist_name: msg.data.artist_name || "",
            album_name: msg.data.album_name || "",
            artwork_url: msg.data.artwork_url || null,
            duration_ms: msg.data.duration_ms || 180_000,
            position_ms: msg.data.position_ms || 0,
            is_playing: Boolean(msg.data.is_playing),
            provider: "extension_bridge",
          });
        }
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, [setExtensionStatus, setNowPlaying]);

  // 3. Preview Audio fallback sync
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (nowPlaying?.provider === "preview_audio" && nowPlaying.preview_url) {
      const proxied = `/api/audio-proxy?url=${encodeURIComponent(nowPlaying.preview_url)}`;
      if (audio.src !== window.location.origin + proxied) {
        audio.src = proxied;
      }
      if (nowPlaying.is_playing) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    } else {
      audio.pause();
    }
  }, [nowPlaying?.provider, nowPlaying?.preview_url, nowPlaying?.is_playing]);

  // 4. Handle seek requests (e.g. from interactive tonearm dragging on grooves)
  useEffect(() => {
    if (seekRequestSec === null) return;
    if (nowPlaying?.provider === "youtube_iframe" && ytPlayerRef.current?.seekTo) {
      ytPlayerRef.current.seekTo(seekRequestSec, true);
    } else if (nowPlaying?.provider === "preview_audio" && audioRef.current) {
      audioRef.current.currentTime = seekRequestSec;
    } else if (nowPlaying?.provider === "extension_bridge" && bridgeWsRef.current?.readyState === WebSocket.OPEN) {
      bridgeWsRef.current.send(JSON.stringify({ command: "seek", payload: { seconds: seekRequestSec } }));
    }
    updatePlaybackClock(Math.round(seekRequestSec * 1000));
    requestSeek(null);
  }, [seekRequestSec, nowPlaying?.provider, requestSeek, updatePlaybackClock]);

  // 5. Periodic clock sync & automatic scrobble after 50% playback
  useEffect(() => {
    if (!nowPlaying?.is_playing) return;
    const id = window.setInterval(() => {
      let posMs = nowPlaying.position_ms + 1000;
      let durMs = nowPlaying.duration_ms || 180_000;

      if (nowPlaying.provider === "preview_audio" && audioRef.current) {
        posMs = Math.round(audioRef.current.currentTime * 1000);
        if (Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0) {
          durMs = Math.round(audioRef.current.duration * 1000);
        }
      }
      updatePlaybackClock(Math.min(posMs, durMs), durMs, true);

      const sig = `${nowPlaying.song_name}::${nowPlaying.artist_name}`;
      if (posMs >= 30_000 && posMs >= durMs * 0.5 && scrobbledSigRef.current !== sig) {
        scrobbledSigRef.current = sig;
        apiPost("/api/v4/playback/scrobble", {
          song_name: nowPlaying.song_name,
          artist_name: nowPlaying.artist_name,
          album_name: nowPlaying.album_name,
          play_duration_ms: posMs,
          media_duration_ms: durMs,
          provider: nowPlaying.provider === "external_live" ? "os_media" : nowPlaying.provider,
          video_id: nowPlaying.video_id || undefined,
          artwork_url: nowPlaying.artwork_url || undefined,
          event_type: "scrobble",
        }).catch(() => {});
      }
    }, 1000);
    return () => clearInterval(id);
  }, [nowPlaying, updatePlaybackClock]);

  const togglePlay = () => {
    if (!nowPlaying) return;
    vinylFoley.playClick(soundFxEnabled);
    const next = !nowPlaying.is_playing;
    if (nowPlaying.provider === "extension_bridge" && bridgeWsRef.current?.readyState === WebSocket.OPEN) {
      bridgeWsRef.current.send(JSON.stringify({ command: next ? "play" : "pause" }));
    }
    setNowPlaying({ ...nowPlaying, is_playing: next });
  };

  const isYouTubeActive = Boolean(nowPlaying?.provider === "youtube_iframe" && nowPlaying.video_id);
  const isStudio = activeTab === "studio";

  // Show floating YouTube cartridge on non-studio tabs ONLY when YouTube is active (>= 200x200 px ToS)
  if (!isStudio && !isYouTubeActive) {
    return <audio ref={audioRef} className="hidden" />;
  }

  const embedUrl = isYouTubeActive
    ? `https://www.youtube.com/embed/${encodeURIComponent(nowPlaying!.video_id!)}?autoplay=${
        nowPlaying!.is_playing ? 1 : 0
      }&enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(window.location.origin)}`
    : null;

  // On Studio tab: docked inside Turntable Digital Display (bottom-right)
  // On Stats tabs: draggable floating V2 glassmorphism cartridge (240x200 px)
  const containerStyle: React.CSSProperties = isStudio
    ? {}
    : {
        position: "fixed",
        right: floatPos.x,
        bottom: floatPos.y,
        width: 244,
        zIndex: 45,
      };

  return (
    <>
      <audio ref={audioRef} className="hidden" />
      <div
        style={containerStyle}
        data-testid={isStudio ? "turntable-digital-display" : "floating-youtube-cartridge"}
        className={
          isStudio
            ? "fixed right-4 bottom-24 z-30 w-[248px] glass-panel rounded-2xl overflow-hidden border border-white/15 hidden sm:block"
            : "glass-panel rounded-2xl overflow-hidden border border-white/15 shadow-2xl"
        }
      >
        {/* Top bar (draggable on stats tabs) */}
        <div
          onMouseDown={(e) => {
            if (isStudio) return;
            dragRef.current = { active: true, ox: e.clientX, oy: e.clientY };
            const onMove = (me: MouseEvent) => {
              if (!dragRef.current.active) return;
              const dx = dragRef.current.ox - me.clientX;
              const dy = dragRef.current.oy - me.clientY;
              dragRef.current.ox = me.clientX;
              dragRef.current.oy = me.clientY;
              setFloatPos((p) => ({
                x: Math.max(12, Math.min(window.innerWidth - 260, p.x + dx)),
                y: Math.max(72, Math.min(window.innerHeight - 260, p.y + dy)),
              }));
            };
            const onUp = () => {
              dragRef.current.active = false;
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
          className={`flex items-center justify-between px-3 py-1.5 bg-black/50 border-b border-white/10 text-[11px] font-mono-num ${
            !isStudio ? "cursor-grab active:cursor-grabbing" : ""
          }`}
        >
          <span className="flex items-center gap-1.5 text-rose-300">
            {isYouTubeActive ? <Tv className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5" />}
            {isStudio ? "AFFICHEUR PLATINE" : "YOUTUBE 0 €"}
          </span>
          <div className="flex items-center gap-1.5 text-white/60">
            {!isStudio && <GripHorizontal className="w-3.5 h-3.5" />}
            {nowPlaying && (
              <button
                onClick={() => setNowPlaying(null)}
                className="hover:text-white transition"
                title="Fermer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* >= 200x200 px YouTube IFrame when active, else Live Digital Telemetry (BPM/Camelot/Spectrum) */}
        {isYouTubeActive && embedUrl ? (
          <div ref={ytContainerRef} className="w-[244px] h-[200px] bg-black">
            <iframe
              src={embedUrl}
              title={nowPlaying?.song_name || "AMDataWrap YouTube Player"}
              width="244"
              height="200"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="autoplay; encrypted-media; picture-in-picture"
              className="w-full h-full border-0"
            />
          </div>
        ) : (
          <div className="p-3.5 bg-gradient-to-b from-[#080b14] to-[#05060c]">
            <div className="flex items-center justify-between text-[10px] font-mono-num text-cyan-300/80 mb-2">
              <span>{nowPlaying?.bpm ? `${Math.round(nowPlaying.bpm)} BPM` : "33⅓ RPM"}</span>
              <span>{nowPlaying?.camelot || "STEREO"}</span>
              <span>{nowPlaying ? formatDurationMs(nowPlaying.position_ms) : "0:00"}</span>
            </div>
            {/* Animated BPM-synced spectrum bars */}
            <div className="flex items-end gap-1 h-12 mb-2.5">
              {Array.from({ length: 18 }).map((_, i) => {
                const h = nowPlaying?.is_playing
                  ? 25 + ((Math.sin(i * 0.9 + (nowPlaying.position_ms || 0) / 300) + 1) * 35)
                  : 12;
                return (
                  <div
                    key={i}
                    style={{ height: `${h}%` }}
                    className="flex-1 rounded-t bg-gradient-to-t from-rose-500/80 via-indigo-400/80 to-cyan-300/90 transition-all duration-300"
                  />
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate text-white">
                  {nowPlaying?.song_name || "Prêt — Choisis un vinyle"}
                </p>
                <p className="text-[11px] truncate text-white/60">
                  {nowPlaying?.artist_name || "Lecture 0 € (YouTube / Extension)"}
                </p>
              </div>
              {nowPlaying && (
                <button
                  onClick={togglePlay}
                  className="p-2 rounded-full bg-white/10 hover:bg-rose-500/40 transition shrink-0"
                  aria-label="Lecture / Pause"
                >
                  {nowPlaying.is_playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
