import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Mic2, Pause, Play, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fetchLyrics, fetchTrackBpm } from '../../api/client'
import { reactiveAudio } from '../../audio/reactiveAudio'
import { useApp } from '../../store/AppContext'

/**
 * Spatial Vinyl Deck with LIVE Web Audio API FFT spectrum visualizer,
 * live Deezer BPM badge, and Apple Music Sing-style LRCLIB Lyrics popover!
 */
export function SpatialVinylDeck() {
  const { playingTrack, isPlaying, togglePlayPause, stopPreview, audioProgress } = useApp()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [bpm, setBpm] = useState<number | null>(null)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [lyrics, setLyrics] = useState<string | null>(null)
  const [loadingLyrics, setLoadingLyrics] = useState(false)

  // Fetch free Deezer BPM + LRCLIB lyrics when track changes
  useEffect(() => {
    if (!playingTrack) {
      setBpm(null)
      setLyrics(null)
      setLyricsOpen(false)
      return
    }
    let cancelled = false
    setBpm(null)
    setLyrics(null)

    fetchTrackBpm(playingTrack.song_name, playingTrack.artist_name || '').then((res) => {
      if (!cancelled && res?.found && res.bpm) setBpm(res.bpm)
    })

    setLoadingLyrics(true)
    fetchLyrics(playingTrack.song_name, playingTrack.artist_name || '', playingTrack.album_name || '')
      .then((res) => {
        if (!cancelled) setLyrics(res?.found ? res.plain_lyrics : null)
      })
      .finally(() => !cancelled && setLoadingLyrics(false))

    return () => {
      cancelled = true
    }
  }, [playingTrack])

  // 60 FPS Web Audio API FFT Spectrum Bars
  useEffect(() => {
    if (!playingTrack) return
    let rafId = 0
    const draw = () => {
      rafId = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const { bins } = reactiveAudio.getBands()
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      const bars = 28
      const barW = w / bars - 2
      for (let i = 0; i < bars; i++) {
        const val = bins[i] / 255
        const barH = Math.max(3, val * h)
        const grad = ctx.createLinearGradient(0, h - barH, 0, h)
        grad.addColorStop(0, '#ff2a5f')
        grad.addColorStop(0.55, '#a855f7')
        grad.addColorStop(1, '#38bdf8')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.roundRect(i * (barW + 2), h - barH, barW, barH, 2)
        ctx.fill()
      }
    }
    draw()
    return () => cancelAnimationFrame(rafId)
  }, [playingTrack])

  return (
    <AnimatePresence>
      {playingTrack && (
        <motion.div
          initial={{ y: 100, opacity: 0, scale: 0.94 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 100, opacity: 0, scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 340, damping: 28 }}
          className="fixed bottom-5 right-5 z-50 w-[350px] max-w-[calc(100vw-2rem)]"
        >
          {/* Floating LRCLIB Lyrics Drawer */}
          <AnimatePresence>
            {lyricsOpen && (
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 14, scale: 0.96 }}
                className="mb-3 spatial-glass rounded-3xl p-5 max-h-72 overflow-y-auto border border-white/15"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-widest text-rose-300 font-semibold">
                    Paroles · LRCLIB
                  </span>
                  <button
                    type="button"
                    onClick={() => setLyricsOpen(false)}
                    className="text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {loadingLyrics ? (
                  <p className="text-xs text-zinc-400">Recherche des paroles…</p>
                ) : lyrics ? (
                  <p className="text-sm text-zinc-100 whitespace-pre-line leading-relaxed font-medium">
                    {lyrics}
                  </p>
                ) : (
                  <p className="text-xs text-zinc-500">Paroles introuvables pour cet extrait.</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Spatial Vinyl Deck */}
          <div className="spatial-glass rounded-3xl p-3.5 border border-white/15 shadow-2xl">
            <div className="flex items-center gap-3">
              {/* Spinning Vinyl Disc */}
              <div className="relative w-14 h-14 shrink-0">
                <div
                  className={`w-14 h-14 rounded-full overflow-hidden border-2 border-white/20 shadow-lg ${
                    isPlaying ? 'animate-vinyl' : 'animate-vinyl-paused'
                  }`}
                >
                  {playingTrack.artwork_url ? (
                    <img src={playingTrack.artwork_url} alt={playingTrack.song_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-rose-500 to-indigo-600" />
                  )}
                </div>
                <div className="w-3.5 h-3.5 rounded-full bg-[#08080c] border border-white/30 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold">
                    LIVE 30S
                  </span>
                  {bpm && (
                    <span className="text-[9px] font-mono-num px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 flex items-center gap-0.5">
                      <Activity className="w-2.5 h-2.5" />
                      {Math.round(bpm)} BPM
                    </span>
                  )}
                </div>
                <p className="text-xs font-bold text-white truncate mt-1">{playingTrack.song_name}</p>
                <p className="text-[11px] text-zinc-400 truncate">{playingTrack.artist_name || playingTrack.album_name}</p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setLyricsOpen((v) => !v)}
                  title="Afficher les paroles (LRCLIB)"
                  className={`w-8 h-8 rounded-full flex items-center justify-center border transition-colors cursor-pointer ${
                    lyricsOpen || lyrics
                      ? 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                      : 'bg-white/[0.04] border-white/10 text-zinc-500'
                  }`}
                >
                  <Mic2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={togglePlayPause}
                  className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform cursor-pointer"
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>
                <button
                  type="button"
                  onClick={stopPreview}
                  className="p-1 text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Live FFT Visualizer Canvas */}
            <canvas ref={canvasRef} width={320} height={26} className="w-full h-6 mt-2.5 rounded-lg opacity-90" />

            <div className="mt-1.5 h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-rose-500 via-fuchsia-500 to-sky-400 transition-[width] duration-150"
                style={{ width: `${audioProgress}%` }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
