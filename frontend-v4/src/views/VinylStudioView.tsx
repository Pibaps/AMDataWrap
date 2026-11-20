/**
 * VinylStudioView — Minimalist HUD over the 3D Listening Room.
 *
 * Refinements from user feedback:
 * - Radically fewer 2D buttons! Because the 3D decor is now directly interactive
 *   (click the dust lid, brass lamp, stylus target lamp, START/STOP, 33/45 RPM, pitch fader,
 *   center label to flip A/B, grooves to drop the needle, crate brass plate to sort, crate sleeves
 *   to flip/open), we only keep:
 *   1. A compact top-left camera angle pill (Salon · Platine · Bac · Pochette 3D · Free Cam) +
 *      discrete 3-dot chassis swatch.
 *   2. A dynamic bottom-left 3D object tooltip ("hoveredHint") that tells the user what 3D element
 *      they are pointing at, plus the focused album title when browsing the crate.
 *   3. A clean liner-notes tracklist drawer on the right ONLY when inspecting a sleeve (`vinylStage === "INSPECT"`).
 */

import React, { useCallback, useEffect } from "react";
import { ArrowLeft, Disc3, FlipHorizontal, Play, Volume2, VolumeX } from "lucide-react";
import {
  API,
  apiGet,
  buildQueryParams,
  formatDurationMs,
  formatHours,
  type TurntableFinish,
  type VinylCrateAlbum,
  type VinylDetail,
  type VinylSideTrack,
  type VinylStage,
} from "../api/client";
import { playTrack } from "../audio/playTrack";
import { vinylFoley } from "../audio/vinylFoley";
import { useV4Store } from "../store/useV4Store";

const CAMERA_VIEWS: Array<{ id: VinylStage; label: string }> = [
  { id: "ROOM", label: "Salon" },
  { id: "TURNTABLE", label: "Platine" },
  { id: "CRATE", label: "Bac" },
  { id: "INSPECT", label: "Pochette" },
  { id: "FREECAM", label: "Free Cam" },
];

const FINISH_DOTS: Array<{ id: TurntableFinish; label: string; dot: string }> = [
  { id: "black", label: "Technics Noir", dot: "#1c1a18" },
  { id: "silver", label: "Alu Brossé", dot: "#c4c1ba" },
  { id: "walnut", label: "Noyer Huilé", dot: "#6e4223" },
];

export const VinylStudioView: React.FC = () => {
  const filters = useV4Store((s) => s.filters);
  const vinylStage = useV4Store((s) => s.vinylStage);
  const setVinylStage = useV4Store((s) => s.setVinylStage);
  const crateSort = useV4Store((s) => s.crateSort);
  const crate = useV4Store((s) => s.crate);
  const setCrate = useV4Store((s) => s.setCrate);
  const crateIndex = useV4Store((s) => s.crateIndex);
  const setCrateIndex = useV4Store((s) => s.setCrateIndex);
  const inspected = useV4Store((s) => s.inspected);
  const setInspected = useV4Store((s) => s.setInspected);
  const onPlatter = useV4Store((s) => s.onPlatter);
  const setOnPlatter = useV4Store((s) => s.setOnPlatter);
  const activeSideIndex = useV4Store((s) => s.activeSideIndex);
  const setActiveSideIndex = useV4Store((s) => s.setActiveSideIndex);
  const sleeveFlipped = useV4Store((s) => s.sleeveFlipped);
  const setSleeveFlipped = useV4Store((s) => s.setSleeveFlipped);
  const discOut = useV4Store((s) => s.discOut);
  const setDiscOut = useV4Store((s) => s.setDiscOut);
  const finish = useV4Store((s) => s.finish);
  const setFinish = useV4Store((s) => s.setFinish);
  const soundFx = useV4Store((s) => s.soundFx);
  const setSoundFx = useV4Store((s) => s.setSoundFx);
  const hoveredHint = useV4Store((s) => s.hoveredHint);
  const nowPlaying = useV4Store((s) => s.nowPlaying);
  const setMotorOn = useV4Store((s) => s.setMotorOn);

  useEffect(() => {
    let alive = true;
    const qs = buildQueryParams(filters, { sort: crateSort, limit: 24 });
    apiGet<{ albums: VinylCrateAlbum[] }>(`${API.crate}${qs}`)
      .then((res) => {
        if (!alive) return;
        setCrate(res.albums || []);
        setCrateIndex(0);
      })
      .catch(() => {
        if (alive) setCrate([]);
      });
    return () => {
      alive = false;
    };
  }, [filters, crateSort, setCrate, setCrateIndex]);

  const focusedAlbum: VinylCrateAlbum | undefined = crate[crateIndex];

  const openAlbumInspect = useCallback(
    async (album: VinylCrateAlbum) => {
      vinylFoley.playSleeveSlide(soundFx);
      try {
        const qs = buildQueryParams(filters);
        const detail = await apiGet<VinylDetail>(`${API.vinyl(album.album_key)}${qs}`);
        setInspected(detail);
        setDiscOut(true);
        setVinylStage("INSPECT");
      } catch {
        /* ignore */
      }
    },
    [filters, soundFx, setInspected, setDiscOut, setVinylStage]
  );

  // Keyboard navigation in the studio (← / → flips crate, Enter opens sleeve, Esc returns to ROOM)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (e.key === "ArrowRight" && crate.length > 0) {
        e.preventDefault();
        vinylFoley.playCrateFlip(soundFx);
        setCrateIndex(Math.min(Math.min(crate.length, 24) - 1, crateIndex + 1));
      } else if (e.key === "ArrowLeft" && crate.length > 0) {
        e.preventDefault();
        vinylFoley.playCrateFlip(soundFx);
        setCrateIndex(Math.max(0, crateIndex - 1));
      } else if (e.key === "Enter" && focusedAlbum && vinylStage !== "INSPECT") {
        e.preventDefault();
        openAlbumInspect(focusedAlbum);
      } else if (e.key === "Escape" && vinylStage !== "ROOM") {
        e.preventDefault();
        setVinylStage("ROOM");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [crate.length, crateIndex, focusedAlbum, vinylStage, soundFx, setCrateIndex, setVinylStage, openAlbumInspect]);

  const handleDropNeedleOnTrack = (track: VinylSideTrack, trackIdx: number, vinyl: VinylDetail) => {
    vinylFoley.playNeedleDrop(soundFx);
    setOnPlatter(vinyl);
    setMotorOn(true);
    setVinylStage("ROOM");
    playTrack({
      song_name: track.title,
      artist_name: vinyl.artist_name,
      album_name: vinyl.album_name,
      artwork_url: vinyl.artwork_url,
      track_key: track.track_key,
      preview_url: track.preview_url,
      duration_ms: track.duration_ms,
      vinyl: { album_key: vinyl.album_key, sideIndex: activeSideIndex, trackIndex: trackIdx },
    });
  };

  const activeRecord = inspected || onPlatter;
  const activeSide = activeRecord?.sides?.[activeSideIndex] || activeRecord?.sides?.[0];

  return (
    <div className="relative z-10 min-h-[calc(100vh-116px)] flex flex-col justify-between px-4 sm:px-7 pt-3 pb-20 pointer-events-none select-none">
      {/* Minimal Top Bar: 5 Camera Presets (including Free Cam) + 3 Finish Swatch Dots */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="overlay px-2 py-1 flex flex-wrap items-center gap-1 pointer-events-auto">
          {CAMERA_VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                if (v.id === "INSPECT" && !inspected) {
                  if (onPlatter) setInspected(onPlatter);
                  else if (focusedAlbum) {
                    openAlbumInspect(focusedAlbum);
                    return;
                  }
                }
                setVinylStage(v.id);
              }}
              className="chip text-[11px] h-6 px-2"
              data-active={vinylStage === v.id}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div
          className="overlay px-2 py-1 flex items-center gap-1.5 pointer-events-auto"
          data-testid="turntable-finish-switcher"
        >
          {FINISH_DOTS.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                vinylFoley.playClick(soundFx);
                setFinish(f.id);
              }}
              data-testid={`finish-${f.id}`}
              title={f.label}
              aria-label={f.label}
              className={`w-4 h-4 rounded-full border transition-transform ${
                finish === f.id ? "scale-125 border-amber" : "border-white/25 opacity-75 hover:opacity-100"
              }`}
              style={{ background: f.dot }}
            />
          ))}
          <span className="w-px h-3.5 bg-line" />
          <button
            onClick={() => setSoundFx(!soundFx)}
            className="text-ink-2 hover:text-ink p-1"
            title="Bruitages mécaniques & grain vinyle"
            aria-label="Bruitages mécaniques"
          >
            {soundFx ? <Volume2 className="w-3.5 h-3.5 text-amber" /> : <VolumeX className="w-3.5 h-3.5 text-ink-3" />}
          </button>
        </div>
      </div>

      {/* Right Liner-Notes Tracklist Drawer ONLY when inspecting a sleeve in 3D */}
      {vinylStage === "INSPECT" && activeRecord && (
        <div
          className="my-auto ml-auto overlay p-4 w-full sm:w-[360px] pointer-events-auto space-y-3 max-h-[68vh] flex flex-col"
          data-testid="vinyl-sleeve-card"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="kicker">
                {activeRecord.label_name} · {activeRecord.catalog_number}
              </p>
              <h2 className="font-display text-xl font-[500] leading-tight mt-0.5 truncate">
                {activeRecord.album_name}
              </h2>
              <p className="text-xs text-ink-2 truncate">{activeRecord.artist_name}</p>
            </div>
            <button onClick={() => setVinylStage("ROOM")} className="btn text-xs shrink-0">
              <ArrowLeft className="w-3.5 h-3.5" />
              Salon
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                vinylFoley.playSleeveSlide(soundFx);
                setSleeveFlipped(!sleeveFlipped);
              }}
              className="btn text-xs flex-1 justify-center"
            >
              <FlipHorizontal className="w-3.5 h-3.5 text-amber" />
              {sleeveFlipped ? "Recto" : "Verso 3D"}
            </button>
            <button
              onClick={() => {
                vinylFoley.playSleeveSlide(soundFx);
                setDiscOut(!discOut);
              }}
              className="btn text-xs flex-1 justify-center"
            >
              <Disc3 className="w-3.5 h-3.5 text-brass" />
              {discOut ? "Rentrer LP" : "Sortir LP"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1 border-y border-line py-1.5">
            {activeRecord.sides.map((s, idx) => (
              <button
                key={s.side}
                onClick={() => {
                  vinylFoley.playClick(soundFx);
                  setActiveSideIndex(idx);
                }}
                className="chip num"
                data-active={activeSideIndex === idx}
              >
                FACE {s.side}
              </button>
            ))}
          </div>

          <div className="space-y-0.5 overflow-y-auto pr-1 flex-1">
            {(activeSide?.tracks || []).map((tr, idx) => {
              const isCurrentTrack =
                nowPlaying?.song_name === tr.title && nowPlaying?.artist_name === activeRecord.artist_name;
              return (
                <button
                  key={`${tr.number}-${tr.title}`}
                  onClick={() => handleDropNeedleOnTrack(tr, idx, activeRecord)}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                    isCurrentTrack ? "bg-amber/15 text-amber" : "row-hover text-ink"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="num text-xs text-ink-3 w-5 shrink-0">{tr.number}</span>
                    <span className="text-xs truncate">{tr.title}</span>
                  </div>
                  <span className="num text-[11px] text-ink-3 shrink-0">{formatDurationMs(tr.duration_ms)}</span>
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-line flex items-center justify-between text-xs text-ink-2">
            <span className="num">
              {activeRecord.total_plays} écoutes · {formatHours(activeRecord.total_ms)}
            </span>
            <button
              onClick={() => {
                const first = activeSide?.tracks?.[0];
                if (first) handleDropNeedleOnTrack(first, 0, activeRecord);
              }}
              className="btn btn-primary"
            >
              <Play className="w-3.5 h-3.5" />
              Poser sur la platine
            </button>
          </div>
        </div>
      )}

      {/* Subtle Bottom Prompt: Shows 3D Hover Tooltip OR Focused Crate Sleeve + Compact Free-Cam Hint on far right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="overlay px-3 py-1.5 text-xs text-ink-2 pointer-events-auto max-w-md truncate">
          {hoveredHint ? (
            <span className="text-amber font-medium">{hoveredHint}</span>
          ) : focusedAlbum ? (
            <button
              onClick={() => openAlbumInspect(focusedAlbum)}
              data-testid="focused-crate-album"
              className="text-left hover:text-amber transition-colors"
            >
              <span className="kicker mr-2">
                BAC ({crateIndex + 1}/{Math.min(crate.length, 20)}) :
              </span>
              <strong className="text-ink">{focusedAlbum.album_name}</strong> · {focusedAlbum.artist_name}{" "}
              <span className="num text-ink-3 ml-1">({focusedAlbum.plays}×)</span>
            </button>
          ) : (
            <span>Survole ou clique les objets du salon 3D</span>
          )}
        </div>

        <div className="hidden lg:flex overlay px-2.5 py-1.5 text-[10.5px] text-ink-3 num">
          Orbite : clic gauche · Pan : clic droit · Free Cam : ZQSD
        </div>
      </div>
    </div>
  );
};
