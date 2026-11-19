import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { apiGet } from '../api/client'
import { reactiveAudio } from '../audio/reactiveAudio'
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
  auraColors: [string, string, string]
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
  const [auraColors, setAuraColors] = useState<[string, string, string]>(['#ff2a5f', '#7c3aed', '#06b6d4'])

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
        // ignore
      }
    }
    return () => es.close()
  }, [reloadOptions])

  useEffect(() => {
    const audio = reactiveAudio.audio
    const onTime = () => {
      if (audio.duration && !Number.isNaN(audio.duration)) {
        setAudioProgress((audio.currentTime / audio.duration) * 100)
      }
    }
    const onEnded = () => {
      setIsPlaying(false)
      setAudioProgress(0)
    }
    const onPause = () => setIsPlaying(false)
    const onPlay = () => setIsPlaying(true)

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('play', onPlay)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('play', onPlay)
    }
  }, [])

  const setAmbientFromArtwork = useCallback((url?: string | null) => {
    if (!url || url === lastPaletteUrlRef.current) return
    lastPaletteUrlRef.current = url
    extractPaletteFromArtwork(url).then((palette) => {
      if (!palette) return
      setAuraColors(palette)
      document.documentElement.style.setProperty('--aura-1', palette[0])
      document.documentElement.style.setProperty('--aura-2', palette[1])
      document.documentElement.style.setProperty('--aura-3', palette[2])
    })
  }, [])

  const playPreview = useCallback(
    (track: AudioPreviewTrack) => {
      if (!track.preview_url) return
      if (playingTrack?.preview_url === track.preview_url) {
        reactiveAudio.toggle()
        return
      }
      setPlayingTrack(track)
      setAudioProgress(0)
      if (track.artwork_url) setAmbientFromArtwork(track.artwork_url)
      reactiveAudio.playUrl(track.preview_url)
    },
    [playingTrack, setAmbientFromArtwork]
  )

  const togglePlayPause = useCallback(() => {
    if (!playingTrack) return
    reactiveAudio.toggle()
  }, [playingTrack])

  const stopPreview = useCallback(() => {
    reactiveAudio.stop()
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
        auraColors,
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
