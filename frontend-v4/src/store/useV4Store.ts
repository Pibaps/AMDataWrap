/**
 * Zustand global store for AMDataWrap V4 ("Salon d'écoute").
 *
 * Defaults strictly to `source_provider: "apple_music"` per user preference.
 */

import { create } from "zustand";
import type {
  GlobalFilters,
  NavTab,
  ProfileCapabilities,
  ProfileItem,
  TurntableFinish,
  VinylCrateAlbum,
  VinylDetail,
  VinylStage,
} from "../api/client";

export type PlaybackSource = "youtube" | "preview";

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

export const useV4Store = create<V4State>((set) => ({
  activeTab: "studio",
  setActiveTab: (activeTab) => set({ activeTab }),

  filters: {
    profile_id: null,
    source_provider: "apple_music",
    year: "all",
    skip_mode: "lastfm",
    exclude_incognito: false,
  },
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),

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
  activeSideIndex: 0,
  setActiveSideIndex: (activeSideIndex) => set({ activeSideIndex }),
  sleeveFlipped: false,
  setSleeveFlipped: (sleeveFlipped) => set({ sleeveFlipped }),
  discOut: false,
  setDiscOut: (discOut) => set({ discOut }),
  rpm: 33,
  setRpm: (rpm) => set({ rpm }),
  pitchPct: 0,
  setPitchPct: (pitchPct) => set({ pitchPct }),
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
