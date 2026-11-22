/**
 * VinylStudioView — Pure 3D Listening Room HUD (AMDataWrap V4.1).
 *
 * V4.1 additions:
 * - Discreet Previous/Next track controls + J/K keyboard shortcuts
 * - Active Disc / Side indicator (Face A/B/C/D)
 * - Discreet non-blocking toast for physical feedback (e.g. closed dust lid)
 */

import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Disc3, HelpCircle, RotateCw, SkipBack, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import {
  API,
  apiGet,
  buildQueryParams,
  type TurntableFinish,
  type VinylCrateAlbum,
  type VinylDetail,
  type VinylStage,
} from "../api/client";
import { nextVinylTrack, playTrack, prevVinylTrack } from "../audio/playTrack";
import { vinylFoley } from "../audio/vinylFoley";
import { useV4Store } from "../store/useV4Store";

const CRATE_SORT_LABELS: Array<{ id: string; label: string }> = [
  { id: "top", label: "Top" },
  { id: "recent", label: "Récents" },
  { id: "era", label: "Décennie" },
  { id: "genre", label: "Genre" },
  { id: "random", label: "Aléatoire" },
];

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
  const setCrateSort = useV4Store((s) => s.setCrateSort);
  const crate = useV4Store((s) => s.crate);
  const setCrate = useV4Store((s) => s.setCrate);
  const crateIndex = useV4Store((s) => s.crateIndex);
  const setCrateIndex = useV4Store((s) => s.setCrateIndex);
  const inspected = useV4Store((s) => s.inspected);
  const setInspected = useV4Store((s) => s.setInspected);
  const onPlatter = useV4Store((s) => s.onPlatter);
  const setOnPlatter = useV4Store((s) => s.setOnPlatter);
  const setActiveDiscIndex = useV4Store((s) => s.setActiveDiscIndex);
  const activeSideIndex = useV4Store((s) => s.activeSideIndex);
  const setActiveSideIndex = useV4Store((s) => s.setActiveSideIndex);
  const sleeveFlipped = useV4Store((s) => s.sleeveFlipped);
  const setSleeveFlipped = useV4Store((s) => s.setSleeveFlipped);
  const discOut = useV4Store((s) => s.discOut);
  const setDiscOut = useV4Store((s) => s.setDiscOut);
  const lidOpen = useV4Store((s) => s.lidOpen);
  const setLidOpen = useV4Store((s) => s.setLidOpen);
  const setMotorOn = useV4Store((s) => s.setMotorOn);
  const finish = useV4Store((s) => s.finish);
  const setFinish = useV4Store((s) => s.setFinish);
  const soundFx = useV4Store((s) => s.soundFx);
  const setSoundFx = useV4Store((s) => s.setSoundFx);
  const hoveredHint = useV4Store((s) => s.hoveredHint);
  const toastMessage = useV4Store((s) => s.toastMessage);
  const [showHelp, setShowHelp] = useState(false);

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
  const activeSide = onPlatter?.sides[activeSideIndex] || onPlatter?.sides[0];
  const maxCrateCount = Math.min(crate.length, 20);

  const stepCrate = useCallback(
    (delta: number) => {
      if (maxCrateCount === 0) return;
      const next = Math.max(0, Math.min(maxCrateCount - 1, crateIndex + delta));
      if (next !== crateIndex) {
        vinylFoley.playCrateFlip(soundFx);
        setCrateIndex(next);
      }
    },
    [maxCrateCount, crateIndex, soundFx, setCrateIndex]
  );

  const placeInspectedOnPlatter = useCallback(
    (chosenDisc: 0 | 1 = 0) => {
      if (!inspected) return;
      const disc = chosenDisc === 1 && inspected.sides.length > 2 ? 1 : 0;
      const startSideIdx = disc === 1 ? 2 : 0;
      vinylFoley.playRecordPlace(soundFx);
      window.setTimeout(() => vinylFoley.playNeedleDrop(useV4Store.getState().soundFx), 180);
      setOnPlatter(inspected);
      setActiveDiscIndex(disc);
      setActiveSideIndex(startSideIdx);
      setMotorOn(true);
      setVinylStage("ROOM");
      const side = inspected.sides[startSideIdx] || inspected.sides[0];
      const firstTrack = side?.tracks?.[0];
      if (firstTrack) {
        playTrack({
          song_name: firstTrack.title,
          artist_name: firstTrack.artist_name || inspected.artist_name,
          album_name: inspected.album_name,
          artwork_url: inspected.artwork_url,
          track_key: firstTrack.track_key,
          preview_url: firstTrack.preview_url,
          duration_ms: firstTrack.duration_ms,
          vinyl: { album_key: inspected.album_key, sideIndex: startSideIdx, trackIndex: 0 },
        });
      }
    },
    [inspected, soundFx, setOnPlatter, setActiveDiscIndex, setActiveSideIndex, setMotorOn, setVinylStage]
  );

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

  // Keyboard navigation in the studio (← / → flips crate, J/K prev/next track, Enter inspects, Esc returns)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        prevVinylTrack();
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        nextVinylTrack();
      } else if (e.key === "ArrowRight" && crate.length > 0) {
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
      {/* Minimal Top Bar: 5 Camera Presets + Track Skip + 3 Finish Swatch Dots */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="overlay px-2 py-1 flex flex-wrap items-center gap-1 pointer-events-auto">
          {CAMERA_VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                if (v.id === "INSPECT" && !inspected) {
                  if (onPlatter) {
                    setInspected(onPlatter);
                    setDiscOut(true);
                  } else if (focusedAlbum) {
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
          {onPlatter && (
            <>
              <span className="num text-[10.5px] text-brass px-1">
                Face {activeSide?.side || "A"}
                {onPlatter.disc_count >= 2 ? ` · LP ${activeSideIndex >= 2 ? 2 : 1}` : ""}
              </span>
              <button
                onClick={() => prevVinylTrack()}
                className="text-ink-2 hover:text-amber p-1 transition-colors"
                title="Piste précédente (J)"
                aria-label="Piste précédente"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => nextVinylTrack()}
                className="text-ink-2 hover:text-amber p-1 transition-colors"
                title="Piste suivante (K)"
                aria-label="Piste suivante"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
              <span className="w-px h-3.5 bg-line" />
            </>
          )}
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
            onClick={() => {
              vinylFoley.playLidHinge(soundFx, !lidOpen);
              setLidOpen(!lidOpen);
            }}
            className={`chip text-[11px] h-6 px-2 ${!lidOpen ? "border-amber/60 text-amber" : ""}`}
            title={lidOpen ? "Fermer le capot acrylique" : "Ouvrir le capot acrylique"}
          >
            {lidOpen ? "Capot ouvert" : "Capot fermé · Ouvrir"}
          </button>
          <span className="w-px h-3.5 bg-line" />
          <button
            onClick={() => setSoundFx(!soundFx)}
            className="text-ink-2 hover:text-ink p-1"
            title="Bruitages mécaniques & grain vinyle"
            aria-label="Bruitages mécaniques"
          >
            {soundFx ? <Volume2 className="w-3.5 h-3.5 text-amber" /> : <VolumeX className="w-3.5 h-3.5 text-ink-3" />}
          </button>
          <button
            onClick={() => setShowHelp((v) => !v)}
            className={`p-1 transition-colors ${showHelp ? "text-amber" : "text-ink-2 hover:text-ink"}`}
            title="Comment utiliser le Salon 3D"
            aria-label="Aide des contrôles"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Compact Guide Card (toggled by ? button) */}
      {showHelp && (
        <div className="self-end overlay p-3.5 max-w-sm text-xs text-ink-2 space-y-2 pointer-events-auto border border-brass/40">
          <div className="flex items-center justify-between">
            <span className="kicker text-amber">Guide rapide · Salon 3D</span>
            <button onClick={() => setShowHelp(false)} className="text-ink-3 hover:text-ink" aria-label="Fermer l'aide">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="space-y-1.5 text-[11.5px] leading-snug">
            <li>
              <strong className="text-ink">1. Bac à vinyles :</strong> Feuilleter avec{" "}
              <span className="text-amber">‹ ›</span>, la <span className="text-amber">molette</span> sur le bac ou{" "}
              <span className="text-amber">← / →</span>. Cliquer une pochette pour la sortir.
            </li>
            <li>
              <strong className="text-ink">2. Poser sur la platine :</strong> En vue Pochette, cliquer sur le{" "}
              <span className="text-amber">disque noir</span> ou sur{" "}
              <span className="text-amber">Poser sur la platine</span>.
            </li>
            <li>
              <strong className="text-ink">3. Platine & sillons :</strong> Cliquer <span className="text-amber">START·STOP</span>{" "}
              (ou un sillon du vinyle) pour poser le diamant. Cliquer le <span className="text-amber">macaron central</span>{" "}
              pour retourner Face A/B.
            </li>
            <li>
              <strong className="text-ink">4. Capot & caméra :</strong> Poignée chromée (ou bouton{" "}
              <span className="text-amber">Capot</span>) pour ouvrir/fermer. Orbite : clic gauche · Pan : clic droit · Pistes :{" "}
              <span className="text-amber">J / K</span>.
            </li>
          </ul>
        </div>
      )}

      {/* Discreet Toast (e.g. Closed Dust Lid feedback) */}
      {toastMessage && (
        <div
          role="status"
          data-testid="studio-toast"
          className="self-center overlay px-3.5 py-1.5 text-xs text-amber border border-amber/40 pointer-events-none"
        >
          {toastMessage}
        </div>
      )}

      {/* Bottom Controls: Inspect Action Bar + Crate Browser + Hover Hint */}
      <div className="flex flex-col gap-2">
        {vinylStage === "INSPECT" && inspected && (
          <div
            data-testid="inspect-action-bar"
            className="self-center overlay px-3 py-1.5 flex flex-wrap items-center justify-center gap-2 pointer-events-auto border border-brass/40"
          >
            <span className="text-[11px] text-ink-2 mr-1 hidden sm:inline">
              <strong className="text-ink">{inspected.album_name}</strong> · {inspected.artist_name}
            </span>
            {inspected.disc_count >= 2 || inspected.sides.length > 2 ? (
              <>
                <button
                  onClick={() => placeInspectedOnPlatter(0)}
                  className="chip text-[11px] h-7 px-2.5 border-amber/60 text-amber hover:bg-amber/15 flex items-center gap-1"
                >
                  <Disc3 className="w-3.5 h-3.5" />
                  Poser LP 1 (A/B)
                </button>
                <button
                  onClick={() => placeInspectedOnPlatter(1)}
                  className="chip text-[11px] h-7 px-2.5 border-amber/60 text-amber hover:bg-amber/15 flex items-center gap-1"
                >
                  <Disc3 className="w-3.5 h-3.5" />
                  Poser LP 2 (C/D)
                </button>
              </>
            ) : (
              <button
                onClick={() => placeInspectedOnPlatter(0)}
                data-testid="place-on-platter-btn"
                className="chip text-[11px] h-7 px-2.5 border-amber/60 text-amber hover:bg-amber/15 flex items-center gap-1"
              >
                <Disc3 className="w-3.5 h-3.5" />
                Poser sur la platine
              </button>
            )}
            <button
              onClick={() => {
                vinylFoley.playSleeveSlide(soundFx);
                setSleeveFlipped(!sleeveFlipped);
              }}
              className="chip text-[11px] h-7 px-2 flex items-center gap-1"
            >
              <RotateCw className="w-3 h-3" />
              {sleeveFlipped ? "Voir Recto" : "Voir Verso"}
            </button>
            <button
              onClick={() => {
                vinylFoley.playSleeveSlide(soundFx);
                setDiscOut(!discOut);
              }}
              className="chip text-[11px] h-7 px-2"
            >
              {discOut ? "Rentrer disque" : "Sortir disque"}
            </button>
            <button
              onClick={() => {
                vinylFoley.playSleeveSlide(soundFx);
                setVinylStage("ROOM");
              }}
              className="chip text-[11px] h-7 px-2 text-ink-3"
            >
              Ranger (Échap)
            </button>
          </div>
        )}

        {hoveredHint && (
          <div className="self-start overlay px-3 py-1 text-xs text-amber font-medium pointer-events-none max-w-xl truncate">
            {hoveredHint}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="overlay px-2.5 py-1.5 text-xs text-ink-2 pointer-events-auto flex items-center gap-2 min-w-0 max-w-full lg:max-w-2xl overflow-hidden">
            {focusedAlbum ? (
              <>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => stepCrate(-1)}
                    disabled={crateIndex <= 0}
                    className="p-1 rounded hover:bg-white/10 hover:text-amber disabled:opacity-30 transition-colors"
                    title="Vinyle précédent (← ou molette)"
                    aria-label="Vinyle précédent dans le bac"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="kicker px-1">
                    BAC {crateIndex + 1}/{maxCrateCount}
                  </span>
                  <button
                    onClick={() => stepCrate(1)}
                    disabled={crateIndex >= maxCrateCount - 1}
                    className="p-1 rounded hover:bg-white/10 hover:text-amber disabled:opacity-30 transition-colors"
                    title="Vinyle suivant (→ ou molette)"
                    aria-label="Vinyle suivant dans le bac"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  onClick={() => openAlbumInspect(focusedAlbum)}
                  data-testid="focused-crate-album"
                  className="text-left hover:text-amber transition-colors truncate min-w-0 flex-1"
                  title="Cliquer pour inspecter et poser sur la platine"
                >
                  <strong className="text-ink">{focusedAlbum.album_name}</strong> · {focusedAlbum.artist_name}{" "}
                  {focusedAlbum.disc_count >= 2 && <span className="text-brass text-[10px] mr-1">2×LP</span>}
                  <span className="num text-ink-3 ml-1">({focusedAlbum.plays}×)</span>
                </button>
                <span className="w-px h-3.5 bg-line shrink-0 hidden sm:inline-block" />
                <button
                  onClick={() => {
                    vinylFoley.playRpmMicroSwitch(soundFx);
                    const idx = CRATE_SORT_LABELS.findIndex((s) => s.id === crateSort);
                    const next = CRATE_SORT_LABELS[(idx + 1) % CRATE_SORT_LABELS.length];
                    setCrateSort(next.id);
                  }}
                  className="chip text-[10.5px] h-6 px-2 shrink-0 hidden sm:inline-flex"
                  title="Changer le tri du bac"
                >
                  Tri : {CRATE_SORT_LABELS.find((s) => s.id === crateSort)?.label || crateSort}
                </button>
              </>
            ) : (
              <span>Bac vide — importe des écoutes dans l'onglet Archives</span>
            )}
          </div>

          <div className="hidden lg:flex overlay px-2.5 py-1.5 text-[10.5px] text-ink-3 num">
            Orbite : clic gauche · Pan : clic droit · Bac : ‹ › / molette · Pistes : J/K
          </div>
        </div>
      </div>
    </div>
  );
};
