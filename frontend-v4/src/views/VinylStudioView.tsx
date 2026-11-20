/**
 * VinylStudioView — Pure 3D Listening Room HUD (Zero 2D Pop-up Tracklist Menu!).
 *
 * Everything happens via 3D physical objects in `PersistentStageCanvas`:
 * - Clicking a sleeve in the oak crate slides it physically out in 3D;
 * - Clicking the 3D sleeve flips it 180° (Recto ↔ Verso with printed tracklist);
 * - Clicking the 12" vinyl disc places it on the platter (and removes the jacket from the crate to place it on the easel);
 * - Clicking the wooden crate (or pressing Esc) slides the inspected jacket back into its slot in the crate;
 * - Hovering and clicking any groove band on the platter selects and plays that exact track on the vinyl!
 */

import React, { useCallback, useEffect } from "react";
import { Volume2, VolumeX } from "lucide-react";
import {
  API,
  apiGet,
  buildQueryParams,
  type TurntableFinish,
  type VinylCrateAlbum,
  type VinylDetail,
  type VinylStage,
} from "../api/client";
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
  const setDiscOut = useV4Store((s) => s.setDiscOut);
  const finish = useV4Store((s) => s.finish);
  const setFinish = useV4Store((s) => s.setFinish);
  const soundFx = useV4Store((s) => s.soundFx);
  const setSoundFx = useV4Store((s) => s.setSoundFx);
  const hoveredHint = useV4Store((s) => s.hoveredHint);

  useEffect(() => {
    let alive = true;
    const qs = buildQueryParams(filters, { sort: crateSort, limit: 20 });
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

  // Keyboard navigation in the studio (← / → flips crate, Enter pulls sleeve out, Esc returns sleeve to crate)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (e.key === "ArrowRight" && crate.length > 0) {
        e.preventDefault();
        vinylFoley.playCrateFlip(soundFx);
        setCrateIndex(Math.min(Math.min(crate.length, 20) - 1, crateIndex + 1));
      } else if (e.key === "ArrowLeft" && crate.length > 0) {
        e.preventDefault();
        vinylFoley.playCrateFlip(soundFx);
        setCrateIndex(Math.max(0, crateIndex - 1));
      } else if (e.key === "Enter" && focusedAlbum && vinylStage !== "INSPECT") {
        e.preventDefault();
        openAlbumInspect(focusedAlbum);
      } else if (e.key === "Escape" && vinylStage !== "ROOM") {
        e.preventDefault();
        vinylFoley.playSleeveSlide(soundFx);
        setVinylStage("ROOM");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [crate.length, crateIndex, focusedAlbum, vinylStage, soundFx, setCrateIndex, setVinylStage, openAlbumInspect]);

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
                vinylFoley.playRpmMicroSwitch(soundFx);
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

      {/* Subtle Bottom Prompt: Shows 3D Hover Tooltip (including live groove track title!) OR Focused Crate Sleeve */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="overlay px-3 py-1.5 text-xs text-ink-2 pointer-events-auto max-w-xl truncate">
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
            <span>Survole un sillon du vinyle 3D pour choisir une piste ou clique une pochette dans le bac</span>
          )}
        </div>

        <div className="hidden lg:flex overlay px-2.5 py-1.5 text-[10.5px] text-ink-3 num">
          Orbite : clic gauche · Pan : clic droit · Free Cam : ZQSD
        </div>
      </div>
    </div>
  );
};
