/**
 * Centerpiece V4 View: Bac à Vinyles & Tourne-Disque 3D Interactif (sans chaîne Hi-Fi).
 * Implements the full state machine:
 *   CRATE_BROWSE -> SLEEVE_INSPECT (Recto/Verso) -> DISC_SLIDE_OUT -> TURNTABLE_PLAY
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  FlipHorizontal,
  Play,
  Pause,
  RotateCw,
  Shuffle,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  ArrowUpFromLine,
  Layers,
} from "lucide-react";
import {
  apiGet,
  apiPost,
  artworkProxyUrl,
  buildQueryParams,
  formatDurationMs,
  formatHours,
  type TurntableFinish,
  type VinylCrateAlbum,
  type VinylDetail,
  type VinylSideTrack,
} from "../api/client";
import { useV4Store } from "../store/useV4Store";
import { vinylFoley } from "../audio/vinylFoley";
import { createGeneratedBackCoverDataUrl } from "../scene/vinylTextures";

const SORT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "top", label: "Top Albums" },
  { id: "recent", label: "Récents" },
  { id: "era", label: "Par Ère" },
  { id: "genre", label: "Par Genre" },
  { id: "random", label: "Pioche" },
];

const FINISH_OPTIONS: Array<{ id: TurntableFinish; label: string; swatch: string }> = [
  { id: "obsidian", label: "Obsidian Glass", swatch: "from-slate-900 to-rose-500" },
  { id: "walnut", label: "Noyer Vintage", swatch: "from-amber-900 to-amber-500" },
  { id: "studio", label: "Alu Studio", swatch: "from-slate-400 to-cyan-400" },
];

export const VinylStudioView: React.FC = () => {
  const filters = useV4Store((s) => s.filters);
  const graphicsTier = useV4Store((s) => s.graphicsTier);
  const vinylStage = useV4Store((s) => s.vinylStage);
  const setVinylStage = useV4Store((s) => s.setVinylStage);
  const selectedVinyl = useV4Store((s) => s.selectedVinyl);
  const setSelectedVinyl = useV4Store((s) => s.setSelectedVinyl);
  const activeSideIndex = useV4Store((s) => s.activeSideIndex);
  const setActiveSideIndex = useV4Store((s) => s.setActiveSideIndex);
  const sleeveFlipped = useV4Store((s) => s.sleeveFlipped);
  const setSleeveFlipped = useV4Store((s) => s.setSleeveFlipped);
  const rpmMode = useV4Store((s) => s.rpmMode);
  const setRpmMode = useV4Store((s) => s.setRpmMode);
  const lidOpen = useV4Store((s) => s.lidOpen);
  const setLidOpen = useV4Store((s) => s.setLidOpen);
  const cueLifted = useV4Store((s) => s.cueLifted);
  const setCueLifted = useV4Store((s) => s.setCueLifted);
  const soundFxEnabled = useV4Store((s) => s.soundFxEnabled);
  const setSoundFxEnabled = useV4Store((s) => s.setSoundFxEnabled);
  const turntableFinish = useV4Store((s) => s.turntableFinish);
  const setTurntableFinish = useV4Store((s) => s.setTurntableFinish);
  const nowPlaying = useV4Store((s) => s.nowPlaying);
  const setNowPlaying = useV4Store((s) => s.setNowPlaying);
  const requestSeek = useV4Store((s) => s.requestSeek);
  const preferredPlayback = useV4Store((s) => s.preferredPlayback);

  const [sort, setSort] = useState("top");
  const [crate, setCrate] = useState<VinylCrateAlbum[]>([]);
  const [crateIndex, setCrateIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);

  const mobileTier = graphicsTier <= 1;

  useEffect(() => {
    let active = true;
    setLoading(true);
    const qs = buildQueryParams(filters, { sort, limit: 36 });
    apiGet<{ albums: VinylCrateAlbum[] }>(`/api/v4/vinyl/crate${qs}`)
      .then((res) => {
        if (!active) return;
        setCrate(res.albums || []);
        setCrateIndex(0);
      })
      .catch(() => {
        if (active) setCrate([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, sort]);

  const generatedBackUrl = useMemo(() => {
    if (!selectedVinyl) return null;
    if (selectedVinyl.back_cover_url) {
      return artworkProxyUrl(selectedVinyl.back_cover_url, mobileTier);
    }
    return createGeneratedBackCoverDataUrl(selectedVinyl);
  }, [selectedVinyl, mobileTier]);

  const inspectAlbum = async (album: VinylCrateAlbum) => {
    vinylFoley.playSleeveSlide(soundFxEnabled);
    try {
      const qs = buildQueryParams(filters);
      const detail = await apiGet<VinylDetail>(`/api/v4/vinyl/${encodeURIComponent(album.album_key)}${qs}`);
      setSelectedVinyl(detail);
      setVinylStage("SLEEVE_INSPECT");
    } catch {
      // ignore
    }
  };

  const playVinylTrack = async (track: VinylSideTrack, vinyl: VinylDetail) => {
    vinylFoley.playNeedleDrop(soundFxEnabled);
    setCueLifted(false);
    setVinylStage("TURNTABLE_PLAY");

    try {
      const resolved = await apiGet<{
        ok: boolean;
        video_id: string | null;
        preview_url: string | null;
        provider: string;
      }>(
        `/api/v4/playback/resolve?song=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(
          vinyl.artist_name
        )}&album=${encodeURIComponent(vinyl.album_name)}${
          track.track_key ? `&track_key=${encodeURIComponent(track.track_key)}` : ""
        }`
      );
      const useYt = preferredPlayback === "youtube_iframe" && Boolean(resolved.video_id);
      setNowPlaying({
        song_name: track.title,
        artist_name: vinyl.artist_name,
        album_name: vinyl.album_name,
        artwork_url: vinyl.artwork_url,
        track_key: track.track_key,
        video_id: resolved.video_id,
        preview_url: resolved.preview_url || track.preview_url || null,
        duration_ms: track.duration_ms || 200_000,
        position_ms: 0,
        is_playing: true,
        provider: useYt ? "youtube_iframe" : resolved.preview_url ? "preview_audio" : "youtube_iframe",
      });
    } catch {
      setNowPlaying({
        song_name: track.title,
        artist_name: vinyl.artist_name,
        album_name: vinyl.album_name,
        artwork_url: vinyl.artwork_url,
        duration_ms: track.duration_ms || 200_000,
        position_ms: 0,
        is_playing: true,
        provider: "preview_audio",
        preview_url: track.preview_url || null,
      });
    }
  };

  const handleEnrichPressing = async () => {
    if (!selectedVinyl || enriching) return;
    setEnriching(true);
    try {
      await apiPost(`/api/v4/vinyl/${encodeURIComponent(selectedVinyl.album_key)}/enrich`);
      const qs = buildQueryParams(filters);
      const refreshed = await apiGet<VinylDetail>(
        `/api/v4/vinyl/${encodeURIComponent(selectedVinyl.album_key)}${qs}`
      );
      setSelectedVinyl(refreshed);
    } finally {
      setEnriching(false);
    }
  };

  const activeSide = selectedVinyl?.sides?.[activeSideIndex];
  const progressPct = nowPlaying?.duration_ms
    ? Math.min(100, Math.max(0, (nowPlaying.position_ms / nowPlaying.duration_ms) * 100))
    : 0;

  return (
    <div className="relative min-h-[calc(100vh-140px)] flex flex-col justify-between pb-24 px-3 sm:px-6">
      {/* Top Bar: Stage Breadcrumb + 3 Turntable Finishes (1-click) */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="glass-pill rounded-full px-3 py-1.5 flex items-center gap-2 text-xs">
          <Disc3 className="w-4 h-4 text-rose-400 animate-spin" style={{ animationDuration: "8s" }} />
          <span className="font-display font-bold tracking-wide">VINYL STUDIO 3D</span>
          <span className="text-white/40">·</span>
          <span className="font-mono-num text-[11px] text-rose-200">{vinylStage}</span>
        </div>

        {/* 3 Finishes Selector */}
        <div className="glass-pill rounded-full p-1 flex items-center gap-1" data-testid="turntable-finish-switcher">
          {FINISH_OPTIONS.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                vinylFoley.playClick(soundFxEnabled);
                setTurntableFinish(f.id);
              }}
              data-testid={`finish-${f.id}`}
              className={`px-2.5 py-1 rounded-full text-xs flex items-center gap-1.5 transition ${
                turntableFinish === f.id
                  ? "bg-white/15 text-white font-semibold shadow"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full bg-gradient-to-tr ${f.swatch}`} />
              <span className="hidden sm:inline">{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Interactive Stage Overlay (Pure & Airy — Zero Hi-Fi Stack) */}
      <div className="my-auto py-4">
        {vinylStage === "CRATE_BROWSE" && (
          <div className="max-w-5xl mx-auto">
            {/* Crate Sort Pills */}
            <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    vinylFoley.playClick(soundFxEnabled);
                    setSort(opt.id);
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition ${
                    sort === opt.id
                      ? "bg-rose-500/80 text-white shadow-lg shadow-rose-500/20"
                      : "glass-pill text-white/75 hover:text-white"
                  }`}
                >
                  {opt.id === "random" && <Shuffle className="w-3 h-3 inline mr-1" />}
                  {opt.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="glass-panel rounded-3xl p-10 text-center text-white/60 text-sm">
                Chargement de ton bac à vinyles…
              </div>
            ) : crate.length === 0 ? (
              <div className="glass-panel rounded-3xl p-10 text-center max-w-lg mx-auto">
                <p className="font-display text-lg font-bold mb-2">Ton bac à vinyles est prêt</p>
                <p className="text-sm text-white/65">
                  Importe un export Apple Music, Spotify, YouTube Music, Deezer ou TIDAL dans l&apos;onglet{" "}
                  <span className="text-rose-300 font-semibold">Hub &amp; Import</span> pour remplir ton bac 3D.
                </p>
              </div>
            ) : (
              /* Physical Record Crate Flip-Through */
              <div className="relative flex items-center justify-center gap-3 sm:gap-5">
                <button
                  onClick={() => {
                    vinylFoley.playSleeveSlide(soundFxEnabled);
                    setCrateIndex((i) => Math.max(0, i - 1));
                  }}
                  disabled={crateIndex === 0}
                  className="glass-pill p-3 rounded-full disabled:opacity-30 hover:bg-white/15 transition"
                  aria-label="Vinyle précédent"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="flex items-center justify-center gap-3 overflow-hidden py-3">
                  {crate.slice(Math.max(0, crateIndex - 1), crateIndex + 3).map((alb, idx) => {
                    const realIdx = Math.max(0, crateIndex - 1) + idx;
                    const isFocused = realIdx === crateIndex;
                    const cover = artworkProxyUrl(alb.artwork_url, mobileTier);
                    return (
                      <button
                        key={alb.album_key}
                        onClick={() => (isFocused ? inspectAlbum(alb) : setCrateIndex(realIdx))}
                        data-testid={isFocused ? "focused-crate-album" : undefined}
                        style={{
                          transform: isFocused ? "scale(1.04) translateY(-6px)" : "scale(0.88) rotateY(-12deg)",
                        }}
                        className={`group relative rounded-2xl overflow-hidden text-left transition-all duration-300 shrink-0 ${
                          isFocused
                            ? "w-56 sm:w-64 ring-2 ring-rose-400/70 shadow-2xl shadow-rose-500/20"
                            : "w-40 sm:w-48 opacity-65 hover:opacity-90 hidden sm:block"
                        }`}
                      >
                        <div className="aspect-square bg-gradient-to-br from-indigo-950 via-slate-900 to-rose-950 relative">
                          {cover ? (
                            <img src={cover} alt={alb.album_name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
                              <Disc3 className="w-12 h-12 text-white/25 mb-2" />
                              <span className="font-editorial italic text-base text-white/75 line-clamp-2">
                                {alb.album_name}
                              </span>
                            </div>
                          )}
                          {/* Spine highlight */}
                          <div className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-white/30 to-transparent" />
                          {isFocused && (
                            <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-black/65 backdrop-blur text-[10px] font-mono-num text-rose-200">
                              {alb.plays} plays
                            </div>
                          )}
                        </div>
                        <div className="p-3 bg-[#0c0e18]/90 backdrop-blur">
                          <p className="font-display font-bold text-sm truncate">{alb.album_name}</p>
                          <p className="text-xs text-white/60 truncate">{alb.artist_name}</p>
                          {isFocused && (
                            <p className="text-[11px] text-rose-300 mt-1.5 font-medium">
                              Cliquer pour sortir la pochette →
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => {
                    vinylFoley.playSleeveSlide(soundFxEnabled);
                    setCrateIndex((i) => Math.min(crate.length - 1, i + 1));
                  }}
                  disabled={crateIndex >= crate.length - 1}
                  className="glass-pill p-3 rounded-full disabled:opacity-30 hover:bg-white/15 transition"
                  aria-label="Vinyle suivant"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Stage 2 & 3: SLEEVE_INSPECT (Recto / Verso authentique) & DISC_SLIDE_OUT */}
        {(vinylStage === "SLEEVE_INSPECT" || vinylStage === "DISC_SLIDE_OUT") && selectedVinyl && (
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            {/* 3D Flippable Recto/Verso Sleeve + Sliding 12" Disc */}
            <div className="relative flex flex-col items-center">
              <div
                className="relative w-64 h-64 sm:w-80 sm:h-80 cursor-pointer"
                style={{ perspective: "1200px" }}
                onClick={() => {
                  vinylFoley.playSleeveSlide(soundFxEnabled);
                  setSleeveFlipped(!sleeveFlipped);
                }}
                data-testid="vinyl-sleeve-card"
              >
                {/* Sliding 12" Disc behind sleeve */}
                <div
                  className="absolute inset-2 rounded-full bg-gradient-to-br from-neutral-900 via-black to-neutral-800 border border-white/15 shadow-2xl transition-transform duration-700 flex items-center justify-center"
                  style={{
                    transform:
                      vinylStage === "DISC_SLIDE_OUT" ? "translateX(44%) rotate(110deg)" : "translateX(12%)",
                  }}
                >
                  <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-rose-500 via-indigo-500 to-cyan-400 flex flex-col items-center justify-center text-[9px] font-mono-num font-bold shadow-inner">
                    <span>FACE {activeSide?.side || "A"}</span>
                    <span className="opacity-80">{rpmMode} RPM</span>
                  </div>
                </div>

                {/* Sleeve Front / Back */}
                <div
                  className="relative w-full h-full rounded-xl overflow-hidden shadow-2xl border border-white/15 transition-transform duration-700"
                  style={{
                    transformStyle: "preserve-3d",
                    transform: sleeveFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                  }}
                >
                  {/* RECTO */}
                  <div className="absolute inset-0 bg-[#0d0f1a]" style={{ backfaceVisibility: "hidden" }}>
                    {selectedVinyl.artwork_url ? (
                      <img
                        src={artworkProxyUrl(selectedVinyl.artwork_url, mobileTier) || selectedVinyl.artwork_url}
                        alt={selectedVinyl.album_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-indigo-950 to-rose-950">
                        <Disc3 className="w-16 h-16 text-white/30 mb-3" />
                        <p className="font-display font-bold text-xl">{selectedVinyl.album_name}</p>
                        <p className="font-editorial italic text-white/70">{selectedVinyl.artist_name}</p>
                      </div>
                    )}
                  </div>
                  {/* VERSO (CAA back cover or high-res generated pressing back cover) */}
                  <div
                    className="absolute inset-0 bg-[#0d0f1a]"
                    style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                  >
                    {generatedBackUrl && (
                      <img src={generatedBackUrl} alt="Verso pressage vinyle" className="w-full h-full object-cover" />
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-2 mt-4">
                <button
                  onClick={() => {
                    vinylFoley.playSleeveSlide(soundFxEnabled);
                    setSleeveFlipped(!sleeveFlipped);
                  }}
                  className="glass-pill px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 hover:bg-white/15"
                >
                  <FlipHorizontal className="w-3.5 h-3.5 text-rose-300" />
                  {sleeveFlipped ? "Voir Recto" : "Retourner Verso"}
                </button>
                <button
                  onClick={() => {
                    vinylFoley.playSleeveSlide(soundFxEnabled);
                    setVinylStage(vinylStage === "DISC_SLIDE_OUT" ? "SLEEVE_INSPECT" : "DISC_SLIDE_OUT");
                  }}
                  className="glass-pill px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 hover:bg-white/15"
                >
                  <Layers className="w-3.5 h-3.5 text-cyan-300" />
                  {vinylStage === "DISC_SLIDE_OUT" ? "Rentrer disque" : "Sortir le disque 12\""}
                </button>
                <button
                  onClick={handleEnrichPressing}
                  disabled={enriching}
                  className="glass-pill px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 hover:bg-white/15 disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  {enriching ? "Enrichissement…" : "Pressage MusicBrainz"}
                </button>
              </div>
            </div>

            {/* Pressing Info + Clickable Tracklist */}
            <div className="glass-panel rounded-3xl p-5">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <h2 className="font-display text-xl font-bold">{selectedVinyl.album_name}</h2>
                  <p className="font-editorial italic text-lg text-white/75">{selectedVinyl.artist_name}</p>
                  <p className="text-[11px] font-mono-num text-rose-300/90 mt-1">
                    {selectedVinyl.label_name} · {selectedVinyl.catalog_number} · {selectedVinyl.country}{" "}
                    {selectedVinyl.release_year || ""}
                  </p>
                </div>
                <button
                  onClick={() => setVinylStage("CRATE_BROWSE")}
                  className="text-xs text-white/60 hover:text-white px-2.5 py-1 rounded-full bg-white/5"
                >
                  ← Bac
                </button>
              </div>

              {/* Face A / Face B Selector */}
              <div className="flex items-center gap-2 mb-3">
                {selectedVinyl.sides.map((s, idx) => (
                  <button
                    key={s.side}
                    onClick={() => {
                      vinylFoley.playClick(soundFxEnabled);
                      setActiveSideIndex(idx);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-mono-num transition ${
                      activeSideIndex === idx
                        ? "bg-indigo-500 text-white"
                        : "bg-white/5 text-white/65 hover:text-white"
                    }`}
                  >
                    FACE {s.side} ({formatDurationMs(s.total_duration_ms)})
                  </button>
                ))}
              </div>

              {/* Clickable Tracklist -> Drops Needle Directly on Groove */}
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {(activeSide?.tracks || []).map((tr) => (
                  <button
                    key={`${tr.number}-${tr.title}`}
                    onClick={() => playVinylTrack(tr, selectedVinyl)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-white/10 transition text-left group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono-num text-xs text-rose-300 w-6">{tr.number}</span>
                      <span className="text-sm truncate group-hover:text-white">{tr.title}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs font-mono-num text-white/50">
                      {tr.plays ? <span className="text-cyan-300/80">{tr.plays}×</span> : null}
                      <span>{formatDurationMs(tr.duration_ms)}</span>
                      <Play className="w-3.5 h-3.5 text-rose-400 opacity-0 group-hover:opacity-100 transition" />
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs text-white/60">
                <span>
                  Tes stats : <strong className="text-white">{selectedVinyl.total_plays} écoutes</strong> (
                  {formatHours(selectedVinyl.total_ms)})
                </span>
                <button
                  onClick={() => {
                    const firstTrack = activeSide?.tracks?.[0];
                    if (firstTrack) playVinylTrack(firstTrack, selectedVinyl);
                  }}
                  className="px-4 py-1.5 rounded-full bg-gradient-to-r from-rose-500 to-indigo-500 text-white font-semibold text-xs hover:brightness-110 transition"
                >
                  Poser sur la platine ▶
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stage 4: TURNTABLE_PLAY — Airy Now Playing Easel on left, 3D Turntable center, Digital Display right */}
        {vinylStage === "TURNTABLE_PLAY" && selectedVinyl && (
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start justify-between gap-4 pointer-events-none">
            {/* Now Playing Sleeve Easel */}
            <div className="glass-panel rounded-2xl p-3.5 w-full sm:w-60 pointer-events-auto">
              <p className="text-[10px] font-mono-num tracking-widest text-rose-300 mb-2">CHEVALET NOW PLAYING</p>
              <div className="flex sm:flex-col items-center gap-3">
                {selectedVinyl.artwork_url ? (
                  <img
                    src={artworkProxyUrl(selectedVinyl.artwork_url, mobileTier) || selectedVinyl.artwork_url}
                    alt={selectedVinyl.album_name}
                    className="w-16 h-16 sm:w-full sm:h-48 rounded-xl object-cover shadow-lg"
                  />
                ) : (
                  <div className="w-16 h-16 sm:w-full sm:h-44 rounded-xl bg-indigo-950/80 flex items-center justify-center">
                    <Disc3 className="w-10 h-10 text-white/30" />
                  </div>
                )}
                <div className="min-w-0 w-full">
                  <p className="font-display font-bold text-sm truncate">
                    {nowPlaying?.song_name || selectedVinyl.album_name}
                  </p>
                  <p className="text-xs text-white/65 truncate">{selectedVinyl.artist_name}</p>
                  <p className="text-[11px] font-mono-num text-cyan-300/80 mt-1">
                    FACE {activeSide?.side || "A"} · {rpmMode} RPM
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Physical Turntable Control Bar (Thumb-reachable on Mobile!) */}
      <div className="max-w-3xl w-full mx-auto glass-panel rounded-2xl p-3 flex flex-col gap-2.5">
        {/* Interactive Tonearm / Proportional Groove Scrubber */}
        <div className="flex items-center gap-3 text-[11px] font-mono-num text-white/70">
          <span className="w-10">{formatDurationMs(nowPlaying?.position_ms || 0)}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(progressPct)}
            onChange={(e) => {
              const pct = Number(e.target.value) / 100;
              const durSec = (nowPlaying?.duration_ms || 180_000) / 1000;
              requestSeek(pct * durSec);
            }}
            aria-label="Position du bras de lecture sur le sillon"
            className="flex-1 accent-rose-500 cursor-pointer"
          />
          <span className="w-10 text-right">{formatDurationMs(nowPlaying?.duration_ms || 0)}</span>
        </div>

        {/* Mechanical Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                vinylFoley.playClick(soundFxEnabled);
                if (nowPlaying) setNowPlaying({ ...nowPlaying, is_playing: !nowPlaying.is_playing });
              }}
              className="px-3 py-1.5 rounded-xl bg-rose-500/85 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              {nowPlaying?.is_playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {nowPlaying?.is_playing ? "STOP" : "START"}
            </button>
            <button
              onClick={() => {
                vinylFoley.playClick(soundFxEnabled);
                setCueLifted(!cueLifted);
              }}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-mono-num ${
                cueLifted ? "bg-amber-500/30 text-amber-200 border border-amber-400/40" : "bg-white/5 text-white/75"
              }`}
            >
              CUE {cueLifted ? "▲" : "▼"}
            </button>
            <button
              onClick={() => {
                vinylFoley.playClick(soundFxEnabled);
                setRpmMode(rpmMode === 33 ? 45 : 33);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono-num"
            >
              {rpmMode === 33 ? "33⅓" : "45"} RPM
            </button>
            <button
              onClick={() => {
                vinylFoley.playSleeveSlide(soundFxEnabled);
                const count = selectedVinyl?.sides?.length || 2;
                setActiveSideIndex((activeSideIndex + 1) % count);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs flex items-center gap-1"
            >
              <RotateCw className="w-3.5 h-3.5 text-indigo-300" />
              FLIP A/B
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                vinylFoley.playClick(soundFxEnabled);
                setLidOpen(!lidOpen);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs"
            >
              Capot {lidOpen ? "Ouvert" : "Fermé"}
            </button>
            <button
              onClick={() => setSoundFxEnabled(!soundFxEnabled)}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/75"
              title="Bruitages mécaniques Web Audio"
              aria-label="Basculer les bruitages mécaniques"
            >
              {soundFxEnabled ? <Volume2 className="w-4 h-4 text-cyan-300" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                vinylFoley.playSleeveSlide(soundFxEnabled);
                setVinylStage("CRATE_BROWSE");
              }}
              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs flex items-center gap-1 text-rose-200"
            >
              <ArrowUpFromLine className="w-3.5 h-3.5" />
              EJECT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
