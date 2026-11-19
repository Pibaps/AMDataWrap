import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { apiGet } from '../api/client'
import {
  AudioPreviewTrack,
  DEFAULT_FILTERS,
  DrawerTarget,
  EnrichmentState,
  FilterOptions,
  FilterState,
} from '../types'
import { extractPaletteFromArtwork } from '../utils/format'

interface AppContextValue {
  filters: FilterState
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>
  updateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void
  resetFilters: () => void
  filterOptions: FilterOptions | null
  reloadOptions: () => Promise<void>
  enrichment: EnrichmentState | null
  refreshKey: number
  triggerRefresh: () => void
  playingTrack: AudioPreviewTrack | null
  isPlaying: boolean
  playPreview: (track: AudioPreviewTrack) => void
  togglePlayPause: () => void
  stopPreview: () => void
  audioProgress: number
  drawer: DrawerTarget | null
  openDrawer: (target: DrawerTarget) => void
  closeDrawer: () => void
  setAmbientFromArtwork: (url?: string | null) => void
  importModalOpen: boolean
  setImportModalOpen: (open: boolean) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null)
  const [enrichment, setEnrichment] = useState<EnrichmentState | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null)
  const [importModalOpen, setImportModalOpen] = useState(false)

  // Audio preview player state
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playingTrack, setPlayingTrack] = useState<AudioPreviewTrack | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioProgress, setAudioProgress] = useState(0)
  const lastVersionRef = useRef<number>(0)
  const lastPaletteUrlRef = useRef<string | null>(null)

  const reloadOptions = useCallback(async () => {
    try {
      const data = await apiGet<FilterOptions>('/api/filters')
      setFilterOptions(data)
    } catch (err) {
      console.error('Failed to load filter options:', err)
    }
  }, [])

  useEffect(() => {
    reloadOptions()
  }, [reloadOptions])

  // Real-time SSE connection for Pass 2 enrichment progress
  useEffect(() => {
    const es = new EventSource('/api/enrichment/stream')
    es.onmessage = (ev) => {
      try {
        const parsed: EnrichmentState = JSON.parse(ev.data)
        setEnrichment(parsed)
        if (parsed.version && parsed.version !== lastVersionRef.current) {
          lastVersionRef.current = parsed.version
          setRefreshKey((k) => k + 1)
          if (parsed.phase === 'done' || parsed.version % 4 === 0) {
            reloadOptions()
          }
        }
      } catch {
        // ignore keep-alive
      }
    }
    es.onerror = () => {
      // EventSource reconnects automatically
    }
    return () => es.close()
  }, [reloadOptions])

  // Audio element lifecycle
  useEffect(() => {
    const audio = new Audio()
    audio.crossOrigin = 'anonymous'
    audio.volume = 0.72
    audio.ontimeupdate = () => {
      if (audio.duration && !Number.isNaN(audio.duration)) {
        setAudioProgress((audio.currentTime / audio.duration) * 100)
      }
    }
    audio.onended = () => {
      setIsPlaying(false)
      setAudioProgress(0)
    }
    audio.onpause = () => setIsPlaying(false)
    audio.onplay = () => setIsPlaying(true)
    audioRef.current = audio
    return () => {
      audio.pause()
      audio.src = ''
    }
  }, [])

  const playPreview = useCallback((track: AudioPreviewTrack) => {
    const audio = audioRef.current
    if (!audio || !track.preview_url) return
    if (playingTrack?.preview_url === track.preview_url) {
      if (audio.paused) {
        audio.play().catch(() => {})
      } else {
        audio.pause()
      }
      return
    }
    setPlayingTrack(track)
    setAudioProgress(0)
    audio.src = track.preview_url
    audio.play().catch(() => {})
  }, [playingTrack])

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !playingTrack) return
    if (audio.paused) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [playingTrack])

  const stopPreview = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }
    setPlayingTrack(null)
    setIsPlaying(false)
    setAudioProgress(0)
  }, [])

  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [])

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
    reloadOptions()
  }, [reloadOptions])

  const openDrawer = useCallback((target: DrawerTarget) => setDrawer(target), [])
  const closeDrawer = useCallback(() => setDrawer(null), [])

  const setAmbientFromArtwork = useCallback((url?: string | null) => {
    if (!url || url === lastPaletteUrlRef.current) return
    lastPaletteUrlRef.current = url
    extractPaletteFromArtwork(url).then((palette) => {
      if (!palette) return
      document.documentElement.style.setProperty('--ambient-1', palette[0])
      document.documentElement.style.setProperty('--ambient-2', palette[1])
      document.documentElement.style.setProperty('--ambient-3', palette[2])
    })
  }, [])

  return (
    <AppContext.Provider
      value={{
        filters,
        setFilters,
        updateFilter,
        resetFilters,
        filterOptions,
        reloadOptions,
        enrichment,
        refreshKey,
        triggerRefresh,
        playingTrack,
        isPlaying,
        playPreview,
        togglePlayPause,
        stopPreview,
        audioProgress,
        drawer,
        openDrawer,
        closeDrawer,
        setAmbientFromArtwork,
        importModalOpen,
        setImportModalOpen,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
