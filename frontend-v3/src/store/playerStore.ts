import { create } from 'zustand'

export interface PlayingTrack {
  track_key?: string
  song_name: string
  artist_name: string
  album_name?: string
  artwork_url?: string | null
  preview_url?: string | null
  bpm?: number | null
  camelot_code?: string | null
}

export type DrawerTarget =
  | { type: 'artist'; key: string; label?: string }
  | { type: 'album'; key: string; label?: string }
  | { type: 'day'; key: string }
  | null

/**
 * Off-React mutable 60 FPS telemetry ref (PDF p. 13-15):
 * Audio FFT bands, waveform samples, VU levels and camera activity NEVER trigger React re-renders!
 */
export const audioTelemetryRef = {
  isPlaying: false,
  bass: 0,
  mid: 0,
  treble: 0,
  rmsL: 0,
  rmsR: 0,
  bins: new Float32Array(32),
  waveform: new Float32Array(64),
  progress: 0,
  duration: 30,
}

interface PlayerUiStore {
  track: PlayingTrack | null
  isPlaying: boolean
  volume: number
  lyricsOpen: boolean
  wrappedOpen: boolean
  searchOpen: boolean
  drawer: DrawerTarget
  observatoryMode: 'ridgeline' | 'vinyls' | 'constellation'
  gpuMetrics: { renderer: string; drawCalls: number; dpr: number; active: boolean }
  wasmScanStatus: { running: boolean; done: number; total: number; lastTrack: string | null }

  setTrack: (t: PlayingTrack | null) => void
  setIsPlaying: (v: boolean) => void
  setVolume: (v: number) => void
  setLyricsOpen: (v: boolean) => void
  setWrappedOpen: (v: boolean) => void
  setSearchOpen: (v: boolean) => void
  openDrawer: (d: DrawerTarget) => void
  setObservatoryMode: (m: 'ridgeline' | 'vinyls' | 'constellation') => void
  setGpuMetrics: (m: { renderer: string; drawCalls: number; dpr: number; active: boolean }) => void
  setWasmScanStatus: (s: { running: boolean; done: number; total: number; lastTrack: string | null }) => void
}

export const usePlayerStore = create<PlayerUiStore>((set) => ({
  track: null,
  isPlaying: false,
  volume: 0.78,
  lyricsOpen: false,
  wrappedOpen: false,
  searchOpen: false,
  drawer: null,
  observatoryMode: 'ridgeline',
  gpuMetrics: { renderer: 'WebGL2 (demand)', drawCalls: 0, dpr: 1, active: false },
  wasmScanStatus: { running: false, done: 0, total: 0, lastTrack: null },

  setTrack: (track) => set({ track }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setVolume: (volume) => set({ volume }),
  setLyricsOpen: (lyricsOpen) => set({ lyricsOpen }),
  setWrappedOpen: (wrappedOpen) => set({ wrappedOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  openDrawer: (drawer) => set({ drawer }),
  setObservatoryMode: (observatoryMode) => set({ observatoryMode }),
  setGpuMetrics: (gpuMetrics) => set({ gpuMetrics }),
  setWasmScanStatus: (wasmScanStatus) => set({ wasmScanStatus }),
}))
