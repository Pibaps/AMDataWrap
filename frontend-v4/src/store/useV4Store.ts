/**
 * Zustand global store for AMDataWrap V4.
 * Holds UI navigation, profiles, capabilities matrix, vinyl stage machine,
 * hybrid playback state (YouTube IFrame / Extension MV3 / Preview Audio),
 * graphics tier (Tier 0-3 including WebGPU opt-in), and turntable finish.
 */

import { create } from "zustand";
import type {
  GlobalFilters,
  GraphicsTier,
  NavTab,
  ProfileCapabilities,
  ProfileItem,
  TurntableFinish,
  VinylDetail,
  VinylStage,
} from "../api/client";

export type PlaybackMode = "youtube_iframe" | "extension_bridge" | "preview_audio";

export interface ActiveTrack {
  song_name: string;
  artist_name: string;
  album_name: string;
  artwork_url: string | null;
  track_key?: string;
  video_id?: string | null;
  preview_url?: string | null;
  duration_ms: number;
  position_ms: number;
  is_playing: boolean;
  provider: PlaybackMode | "external_live";
  bpm?: number | null;
  camelot?: string | null;
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

  // Vinyl Studio 3D state machine (CRATE_BROWSE -> SLEEVE_INSPECT -> DISC_SLIDE_OUT -> TURNTABLE_PLAY)
  vinylStage: VinylStage;
  setVinylStage: (stage: VinylStage) => void;
  selectedVinyl: VinylDetail | null;
  setSelectedVinyl: (v: VinylDetail | null) => void;
  activeSideIndex: number;
  setActiveSideIndex: (idx: number) => void;
  sleeveFlipped: boolean;
  setSleeveFlipped: (flipped: boolean) => void;
  rpmMode: 33 | 45;
  setRpmMode: (rpm: 33 | 45) => void;
  lidOpen: boolean;
  setLidOpen: (open: boolean) => void;
  cueLifted: boolean;
  setCueLifted: (lifted: boolean) => void;
  soundFxEnabled: boolean;
  setSoundFxEnabled: (enabled: boolean) => void;
  turntableFinish: TurntableFinish;
  setTurntableFinish: (finish: TurntableFinish) => void;

  // Hybrid 0 EUR Playback
  preferredPlayback: PlaybackMode;
  setPreferredPlayback: (mode: PlaybackMode) => void;
  extensionConnected: boolean;
  extensionPlatforms: string[];
  setExtensionStatus: (connected: boolean, platforms: string[]) => void;
  nowPlaying: ActiveTrack | null;
  setNowPlaying: (track: ActiveTrack | null) => void;
  updatePlaybackClock: (posMs: number, durMs?: number, isPlaying?: boolean) => void;
  seekRequestSec: number | null;
  requestSeek: (sec: number | null) => void;

  // Phase 3 Graphics Tier (0 = CSS/2D, 1 = Mobile WebGL2, 2 = Desktop WebGL2, 3 = PC WebGPU opt-in)
  graphicsTier: GraphicsTier;
  webgpuAvailable: boolean;
  webgpuOptIn: boolean;
  setGraphicsTier: (tier: GraphicsTier) => void;
  setWebgpuStatus: (available: boolean, optIn: boolean) => void;
  drawCallsCount: number;
  setDrawCallsCount: (count: number) => void;
}

function detectInitialTier(): GraphicsTier {
  if (typeof window === "undefined") return 2;
  const canvas = document.createElement("canvas");
  const gl2 = canvas.getContext("webgl2");
  if (!gl2) return 0;
  const isMobile = window.innerWidth <= 820 || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return isMobile ? 1 : 2;
}

export const useV4Store = create<V4State>((set) => ({
  activeTab: "studio",
  setActiveTab: (activeTab) => set({ activeTab }),

  filters: {
    profile_id: null,
    source_provider: "all",
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

  vinylStage: "CRATE_BROWSE",
  setVinylStage: (vinylStage) => set({ vinylStage }),
  selectedVinyl: null,
  setSelectedVinyl: (selectedVinyl) => set({ selectedVinyl, activeSideIndex: 0, sleeveFlipped: false }),
  activeSideIndex: 0,
  setActiveSideIndex: (activeSideIndex) => set({ activeSideIndex }),
  sleeveFlipped: false,
  setSleeveFlipped: (sleeveFlipped) => set({ sleeveFlipped }),
  rpmMode: 33,
  setRpmMode: (rpmMode) => set({ rpmMode }),
  lidOpen: true,
  setLidOpen: (lidOpen) => set({ lidOpen }),
  cueLifted: false,
  setCueLifted: (cueLifted) => set({ cueLifted }),
  soundFxEnabled: true,
  setSoundFxEnabled: (soundFxEnabled) => set({ soundFxEnabled }),
  turntableFinish: "obsidian",
  setTurntableFinish: (turntableFinish) => set({ turntableFinish }),

  preferredPlayback: "youtube_iframe",
  setPreferredPlayback: (preferredPlayback) => set({ preferredPlayback }),
  extensionConnected: false,
  extensionPlatforms: [],
  setExtensionStatus: (extensionConnected, extensionPlatforms) =>
    set({ extensionConnected, extensionPlatforms }),
  nowPlaying: null,
  setNowPlaying: (nowPlaying) => set({ nowPlaying }),
  updatePlaybackClock: (position_ms, duration_ms, is_playing) =>
    set((s) => {
      if (!s.nowPlaying) return s;
      return {
        nowPlaying: {
          ...s.nowPlaying,
          position_ms,
          duration_ms: duration_ms !== undefined && duration_ms > 0 ? duration_ms : s.nowPlaying.duration_ms,
          is_playing: is_playing !== undefined ? is_playing : s.nowPlaying.is_playing,
        },
      };
    }),
  seekRequestSec: null,
  requestSeek: (seekRequestSec) => set({ seekRequestSec }),

  graphicsTier: detectInitialTier(),
  webgpuAvailable: typeof navigator !== "undefined" && "gpu" in navigator,
  webgpuOptIn: false,
  setGraphicsTier: (graphicsTier) => set({ graphicsTier }),
  setWebgpuStatus: (webgpuAvailable, webgpuOptIn) =>
    set((s) => ({
      webgpuAvailable,
      webgpuOptIn,
      graphicsTier: webgpuOptIn && webgpuAvailable ? 3 : s.graphicsTier === 3 ? 2 : s.graphicsTier,
    })),
  drawCallsCount: 0,
  setDrawCallsCount: (drawCallsCount) => set({ drawCallsCount }),
}));
