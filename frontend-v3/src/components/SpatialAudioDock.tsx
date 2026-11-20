import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Pause, Play, Volume2, X } from 'lucide-react'
import { apiGet } from '../api/client'
import { reactiveAudio } from '../audio/reactiveAudio'
import type { ThemePolarity, VisualEdition } from '../hooks/useUrlFilters'
import { audioTelemetryRef, usePlayerStore } from '../store/playerStore'
import { artworkProxyUrl } from '../utils/apca'

interface SpatialAudioDockProps {
  edition: VisualEdition
  theme: ThemePolarity
}

export function SpatialAudioDock({ edition, theme }: SpatialAudioDockProps) {
  const track = usePlayerStore((s) => s.track)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const volume = usePlayerStore((s) => s.volume)
  const lyricsOpen = usePlayerStore((s) => s.lyricsOpen)
  const setLyricsOpen = usePlayerStore((s) => s.setLyricsOpen)
  const setTrack = usePlayerStore((s) => s.setTrack)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const transferredRef = useRef(false)

  const { data: lyricsData } = useQuery({
    queryKey: ['lyrics', track?.song_name, track?.artist_name],
    queryFn: () =>
      apiGet('/api/external/lyrics', undefined, {
        song: track?.song_name || '',
        artist: track?.artist_name || '',
        album: track?.album_name || '',
      }),
    enabled: Boolean(track && lyricsOpen),
    staleTime: 1000 * 60 * 30,
  })

  // OffscreenCanvas Web Worker setup (with automatic main-thread fallback)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !track) return

    let fallbackCtx: CanvasRenderingContext2D | null = null
    if (!transferredRef.current && typeof canvas.transferControlToOffscreen === 'function') {
      try {
        const off = canvas.transferControlToOffscreen()
        const worker = new Worker(new URL('../workers/fftCanvas.worker.ts', import.meta.url), { type: 'module' })
        worker.postMessage({ type: 'init', canvas: off, width: 260, height: 38 }, [off])
        workerRef.current = worker
        transferredRef.current = true
      } catch {
        fallbackCtx = canvas.getContext('2d')
      }
    } else if (!workerRef.current) {
      fallbackCtx = canvas.getContext('2d')
    }

    const unsub = reactiveAudio.subscribeFrame(() => {
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'frame',
          bins: audioTelemetryRef.bins,
          waveform: audioTelemetryRef.waveform,
          rmsL: audioTelemetryRef.rmsL,
          rmsR: audioTelemetryRef.rmsR,
          playing: audioTelemetryRef.isPlaying,
        })
      } else if (fallbackCtx) {
        fallbackCtx.clearRect(0, 0, 260, 38)
        fallbackCtx.fillStyle = '#689cd2'
        for (let i = 0; i < 24; i++) {
          const h = Math.max(3, (audioTelemetryRef.bins[i] || 0.05) * 32)
          fallbackCtx.fillRect(i * 10, 36 - h, 7, h)
        }
      }
    })

    return () => {
      unsub()
    }
  }, [track])

  useEffect(() => {
    if (!workerRef.current) return
    workerRef.current.postMessage({
      type: 'style',
      mode: edition,
      accent: edition === 'field' ? '#d46d3d' : '#689cd2',
      accent2: '#528bc4',
      trackBg: theme === 'dark' ? '#26292d' : '#d8d3c6',
      mutedCol: theme === 'dark' ? '#3e3e49' : '#bab4a6',
    })
  }, [edition, theme, track])

  if (!track) return null

  const art = artworkProxyUrl(track.artwork_url)

  return (
    <div className="fixed bottom-4 left-1/2 z-40 w-[min(96vw,880px)] -translate-x-1/2">
      {/* Live LRCLIB Lyrics & Local Sentiment Drawer */}
      {lyricsOpen && (
        <div className="surface-card mb-2 max-h-[280px] overflow-y-auto p-4 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono-tab text-xs font-semibold uppercase tracking-wider text-[var(--text-strong)]">
                Paroles LRCLIB &amp; Sentiment Local
              </span>
              {lyricsData?.sentiment && (
                <span className="rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface-2)] px-2 py-0.5 font-mono-tab text-[11px] text-[var(--text-primary)]">
                  {lyricsData.sentiment.polarity_label} · V={Math.round(lyricsData.sentiment.valence * 100)}% · {lyricsData.sentiment.lang?.toUpperCase()}
                </span>
              )}
            </div>
            <button onClick={() => setLyricsOpen(false)} className="tactile-btn p-1">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {lyricsData?.found ? (
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-[var(--text-primary)]">
              {lyricsData.plain_lyrics}
            </pre>
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">
              Paroles indisponibles ou hors ligne pour « {track.song_name} ».
            </p>
          )}
        </div>
      )}

      {/* Main Dock Bar (zero backdrop-filter!) */}
      <div className="surface-card flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 shadow-lg">
        <div className="flex min-w-0 items-center gap-3">
          {art ? (
            <img src={art} alt={track.song_name} className="h-10 w-10 rounded object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded bg-[var(--bg-surface-2)] font-mono-tab text-xs text-[var(--text-muted)]">
              30s
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-[var(--text-strong)]">{track.song_name}</div>
            <div className="truncate text-[11px] text-[var(--text-secondary)]">
              {track.artist_name}
              {track.bpm ? ` · ${Math.round(track.bpm)} BPM` : ''}
              {track.camelot_code ? ` · ${track.camelot_code}` : ''}
            </div>
          </div>
        </div>

        {/* OffscreenCanvas 60 FPS Visualizer */}
        <canvas
          ref={canvasRef}
          width={260}
          height={38}
          className="hidden h-[38px] w-[260px] rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] sm:block"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={() => reactiveAudio.togglePlayPause()}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: 'var(--accent)' }}
            title={isPlaying ? 'Pause' : 'Lecture 30s'}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>

          <button
            onClick={() => setLyricsOpen(!lyricsOpen)}
            className={`tactile-btn flex items-center gap-1 px-2.5 py-1.5 text-xs ${lyricsOpen ? 'border-[var(--accent)] text-[var(--accent)]' : ''}`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Paroles</span>
          </button>

          <div className="hidden items-center gap-1.5 md:flex">
            <Volume2 className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => reactiveAudio.setVolume(Number(e.target.value))}
              className="w-16 accent-[var(--accent)]"
            />
          </div>

          <button
            onClick={() => {
              reactiveAudio.stop()
              setTrack(null)
              setLyricsOpen(false)
            }}
            className="tactile-btn p-1.5 text-[var(--text-secondary)]"
            title="Fermer le lecteur"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
