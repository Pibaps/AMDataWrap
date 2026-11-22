/**
 * Zustand global store for AMDataWrap V4.1 ("Salon d'écoute").
 *
 * Defaults strictly to `source_provider: "apple_music"` per user preference.
 * V4.1 additions:
 * - `PlaybackSource` includes `"bridge"` (free open-tab control for Apple Music / Spotify / Deezer via MV3 extension).
 * - `activeDiscIndex` (0 | 1) for Double LP Gatefold (LP 1 Faces A/B, LP 2 Faces C/D).
 * - `powerOn` for turntable power switch & YouTube iframe hibernation.
 * - `toastMessage` + `showToast` for discreet non-blocking feedback (e.g. closed dust lid).
 */

import { create } from "zustand";
import {
  getActiveLocale,
  getActiveTimeUnit,
  setActiveLocale,
  setActiveTimeUnit,
  type ActiveLocale,
  type GlobalFilters,
  type NavTab,
  type ProfileCapabilities,
  type ProfileItem,
  type TimeUnit,
  type TurntableFinish,
  type VinylCrateAlbum,
  type VinylDetail,
  type VinylStage,
} from "../api/client";

export type DrawerTarget =
  | { type: "artist"; key: string }
  | { type: "album"; key: string }
  | { type: "day"; date: string }
  | null;

export type PlaybackSource = "youtube" | "preview" | "bridge";

export interface ActiveTrack {
  song_name: string;
  artist_name: string;
  album_name: string;
  artwork_url: string | null;
  track_key?: string;
  video_id?: string | null;
  preview_url?: string | null;
  duration_ms: number;
  source: PlaybackSource | "external";
  vinyl?: { album_key: string; sideIndex: number; trackIndex: number } | null;
}

export interface V4State {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;

  filters: GlobalFilters;
  setFilters: (patch: Partial<GlobalFilters>) => void;
  resetFilters: () => void;

  locale: ActiveLocale;
  setLocale: (loc: ActiveLocale) => void;

  drawerTarget: DrawerTarget;
  openDrawer: (target: NonNullable<DrawerTarget>) => void;
  closeDrawer: () => void;

  timeUnit: TimeUnit;
  setTimeUnit: (unit: TimeUnit) => void;

  profiles: ProfileItem[];
  activeProfileId: number | null;
  capabilities: ProfileCapabilities | null;
  setProfilesData: (profiles: ProfileItem[], activeId: number | null, caps: ProfileCapabilities | null) => void;

  // Vinyl studio & interactive 3D room state
  vinylStage: VinylStage;
  setVinylStage: (stage: VinylStage) => void;
  crateSort: string;
  setCrateSort: (sort: string) => void;
  crate: VinylCrateAlbum[];
  setCrate: (albums: VinylCrateAlbum[]) => void;
  crateIndex: number;
  setCrateIndex: (idx: number) => void;
  inspected: VinylDetail | null;
  setInspected: (v: VinylDetail | null) => void;
  onPlatter: VinylDetail | null;
  setOnPlatter: (v: VinylDetail | null) => void;
  activeDiscIndex: 0 | 1;
  setActiveDiscIndex: (idx: 0 | 1) => void;
  activeSideIndex: number;
  setActiveSideIndex: (idx: number) => void;
  sleeveFlipped: boolean;
  setSleeveFlipped: (flipped: boolean) => void;
  discOut: boolean;
  setDiscOut: (out: boolean) => void;
  rpm: 33 | 45;
  setRpm: (rpm: 33 | 45) => void;
  pitchPct: number;
  setPitchPct: (pct: number) => void;
  volumePct: number;
  setVolumePct: (vol: number) => void;
  powerOn: boolean;
  setPowerOn: (on: boolean) => void;
  lidOpen: boolean;
  setLidOpen: (open: boolean) => void;
  lampOn: boolean;
  setLampOn: (on: boolean) => void;
  stylusLightOn: boolean;
  setStylusLightOn: (on: boolean) => void;
  finish: TurntableFinish;
  setFinish: (finish: TurntableFinish) => void;
  soundFx: boolean;
  setSoundFx: (on: boolean) => void;
  crackle: boolean;
  setCrackle: (on: boolean) => void;
  hoveredHint: string | null;
  setHoveredHint: (hint: string | null) => void;
  toastMessage: string | null;
  showToast: (msg: string, durationMs?: number) => void;
  seekRequestMs: number | null;
  requestSeekMs: (ms: number | null) => void;

  // Playback
  preferredSource: PlaybackSource;
  setPreferredSource: (s: PlaybackSource) => void;
  nowPlaying: ActiveTrack | null;
  setNowPlaying: (track: ActiveTrack | null) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  motorOn: boolean;
  setMotorOn: (on: boolean) => void;
  showVideo: boolean;
  setShowVideo: (on: boolean) => void;
  playbackError: string | null;
  setPlaybackError: (msg: string | null) => void;

  extensionConnected: boolean;
  extensionPlatforms: string[];
  setExtensionStatus: (connected: boolean, platforms: string[]) => void;
}

const savedFinish = (typeof localStorage !== "undefined" && localStorage.getItem("amdw.finish")) as TurntableFinish | null;
let toastTimer: number | null = null;

export const DEFAULT_GLOBAL_FILTERS: GlobalFilters = {
  profile_id: null,
  source_provider: "all",
  period_mode: "all",
  year: "all",
  month: "",
  season: "",
  date_from: "",
  date_to: "",
  skip_mode: "lastfm",
  min_seconds: 30,
  min_completion_pct: 50,
  metric: "ms",
  genre: "",
  device: "",
  offline: "",
  exclude_incognito: false,
};

export const useV4Store = create<V4State>((set) => ({
  activeTab: "studio",
  setActiveTab: (activeTab) => set({ activeTab }),

  filters: { ...DEFAULT_GLOBAL_FILTERS },
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () =>
    set((s) => ({
      filters: {
        ...DEFAULT_GLOBAL_FILTERS,
        profile_id: s.filters.profile_id,
      },
    })),

  locale: getActiveLocale(),
  setLocale: (locale) => {
    setActiveLocale(locale);
    set({ locale });
  },

  drawerTarget: null,
  openDrawer: (drawerTarget) => set({ drawerTarget }),
  closeDrawer: () => set({ drawerTarget: null }),

  timeUnit: getActiveTimeUnit(),
  setTimeUnit: (timeUnit) => {
    setActiveTimeUnit(timeUnit);
    set({ timeUnit });
  },

  profiles: [],
  activeProfileId: null,
  capabilities: null,
  setProfilesData: (profiles, activeProfileId, capabilities) =>
    set((s) => ({
      profiles,
      activeProfileId,
      capabilities,
      filters: { ...s.filters, profile_id: activeProfileId },
    })),

  vinylStage: "ROOM",
  setVinylStage: (vinylStage) => set({ vinylStage }),
  crateSort: "top",
  setCrateSort: (crateSort) => set({ crateSort }),
  crate: [],
  setCrate: (crate) => set({ crate }),
  crateIndex: 0,
  setCrateIndex: (crateIndex) => set({ crateIndex }),
  inspected: null,
  setInspected: (inspected) => set({ inspected, sleeveFlipped: false, discOut: false }),
  onPlatter: null,
  setOnPlatter: (onPlatter) => set({ onPlatter }),
  activeDiscIndex: 0,
  setActiveDiscIndex: (activeDiscIndex) => set({ activeDiscIndex }),
  activeSideIndex: 0,
  setActiveSideIndex: (activeSideIndex) =>
    set({ activeSideIndex, activeDiscIndex: activeSideIndex >= 2 ? 1 : 0 }),
  sleeveFlipped: false,
  setSleeveFlipped: (sleeveFlipped) => set({ sleeveFlipped }),
  discOut: false,
  setDiscOut: (discOut) => set({ discOut }),
  rpm: 33,
  setRpm: (rpm) => set({ rpm }),
  pitchPct: 0,
  setPitchPct: (pitchPct) => set({ pitchPct }),
  volumePct: 80,
  setVolumePct: (volumePct) => set({ volumePct: Math.max(0, Math.min(100, Math.round(volumePct))) }),
  powerOn: true,
  setPowerOn: (powerOn) => set({ powerOn }),
  lidOpen: true,
  setLidOpen: (lidOpen) => set({ lidOpen }),
  lampOn: true,
  setLampOn: (lampOn) => set({ lampOn }),
  stylusLightOn: true,
  setStylusLightOn: (stylusLightOn) => set({ stylusLightOn }),
  finish: savedFinish === "black" || savedFinish === "silver" || savedFinish === "walnut" ? savedFinish : "black",
  setFinish: (finish) => {
    try {
      localStorage.setItem("amdw.finish", finish);
    } catch {
      /* ignore */
    }
    set({ finish });
  },
  soundFx: true,
  setSoundFx: (soundFx) => set({ soundFx }),
  crackle: true,
  setCrackle: (crackle) => set({ crackle }),
  hoveredHint: null,
  setHoveredHint: (hoveredHint) => set({ hoveredHint }),
  toastMessage: null,
  showToast: (msg, durationMs = 2600) => {
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    set({ toastMessage: msg });
    toastTimer = window.setTimeout(() => {
      toastTimer = null;
      set({ toastMessage: null });
    }, durationMs);
  },
  seekRequestMs: null,
  requestSeekMs: (seekRequestMs) => set({ seekRequestMs }),

  preferredSource: "youtube",
  setPreferredSource: (preferredSource) => set({ preferredSource }),
  nowPlaying: null,
  setNowPlaying: (nowPlaying) => set({ nowPlaying, playbackError: null }),
  isPlaying: false,
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  motorOn: false,
  setMotorOn: (motorOn) => set({ motorOn }),
  showVideo: true,
  setShowVideo: (showVideo) => set({ showVideo }),
  playbackError: null,
  setPlaybackError: (playbackError) => set({ playbackError }),

  extensionConnected: false,
  extensionPlatforms: [],
  setExtensionStatus: (extensionConnected, extensionPlatforms) => set({ extensionConnected, extensionPlatforms }),
}));
