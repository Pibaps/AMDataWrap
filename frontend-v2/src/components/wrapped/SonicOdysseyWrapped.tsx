import { AnimatePresence, motion } from 'framer-motion'
import { toPng } from 'html-to-image'
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Download,
  Flame,
  Loader2,
  Pause,
  Play,
  Receipt,
  Repeat,
  Search,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, fetchArtistBio, fetchLyrics, fetchTrackBpm, proxyArtworkUrl } from '../../api/client'
import { useApp } from '../../store/AppContext'
import { formatDateFr, formatDurationMs, formatMonthFr, formatNumber } from '../../utils/format'
import { AmbientNebulaCanvas } from '../three/AmbientNebulaCanvas'

interface SonicOdysseyWrappedProps {
  open: boolean
  onClose: () => void
}

const SLIDE_THEMES: {
  mode: 'nebula' | 'tunnel' | 'rings' | 'orb'
  colors: [string, string, string]
  tag: string
}[] = [
  { mode: 'nebula', colors: ['#ff2a5f', '#7c3aed', '#06b6d4'], tag: '01 · OUVERTURE' },
  { mode: 'rings', colors: ['#6366f1', '#ec4899', '#38bdf8'], tag: '02 · CHRONOBIOLOGIE' },
  { mode: 'rings', colors: ['#f43f5e', '#d946ef', '#fb923c'], tag: '03 · EN BOUCLE' },
  { mode: 'orb', colors: ['#fb7185', '#f59e0b', '#ec4899'], tag: '04 · TA PHASE' },
  { mode: 'nebula', colors: ['#e879f9', '#ff2a5f', '#6366f1'], tag: '05 · ARTISTE #1' },
  { mode: 'rings', colors: ['#38bdf8', '#818cf8', '#f43f5e'], tag: '06 · TITRE #1' },
  { mode: 'nebula', colors: ['#a855f7', '#6366f1', '#ec4899'], tag: '07 · ALBUM #1' },
  { mode: 'tunnel', colors: ['#f59e0b', '#fb7185', '#38bdf8'], tag: '08 · VOYAGE TEMPOREL' },
  { mode: 'orb', colors: ['#2dd4bf', '#6366f1', '#f43f5e'], tag: '09 · TON AURA' },
  { mode: 'nebula', colors: ['#38bdf8', '#f59e0b', '#e879f9'], tag: '10 · PAROLES & RECHERCHES' },
  { mode: 'rings', colors: ['#ff2a5f', '#7c3aed', '#2dd4bf'], tag: '11 · POSTER COLLECTOR' },
]

export function SonicOdysseyWrapped({ open, onClose }: SonicOdysseyWrappedProps) {
  const { filters, playPreview, playingTrack, isPlaying, stopPreview } = useApp()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [slide, setSlide] = useState(0)
  const [soundtrackOn, setSoundtrackOn] = useState(true)
  const [posterStyle, setPosterStyle] = useState<'spatial' | 'receipt'>('spatial')
  const [exporting, setExporting] = useState(false)

  // Live free API enrichments
  const [artistBio, setArtistBio] = useState<any>(null)
  const [topLyrics, setTopLyrics] = useState<string | null>(null)
  const [topBpm, setTopBpm] = useState<number | null>(null)

  const cardRef = useRef<HTMLDivElement | null>(null)
  const totalSlides = SLIDE_THEMES.length

  useEffect(() => {
    if (!open) return
    setSlide(0)
    setLoading(true)
    setArtistBio(null)
    setTopLyrics(null)
    setTopBpm(null)

    apiGet('/api/analytics/wrapped', filters)
      .then((res) => {
        setData(res)
        if (res?.top_artist?.artist_name) {
          fetchArtistBio(res.top_artist.artist_name).then(setArtistBio).catch(() => {})
        }
        if (res?.top_track?.song_name) {
          fetchLyrics(res.top_track.song_name, res.top_track.artist_name || '', res.top_track.album_name || '')
            .then((l) => l?.found && setTopLyrics(l.plain_lyrics))
            .catch(() => {})
          fetchTrackBpm(res.top_track.song_name, res.top_track.artist_name || '')
            .then((b) => b?.found && setTopBpm(b.bpm))
            .catch(() => {})
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [open, filters])

  // Auto-Soundtrack per chapter!
  useEffect(() => {
    if (!open || !data || !soundtrackOn) return
    let candidate: any = null
    if (slide === 2 && data.top_loop?.preview_url) {
      candidate = {
        song_name: data.top_loop.song_name,
        artist_name: data.top_loop.artist_name,
        artwork_url: data.top_loop.artwork_url,
        preview_url: data.top_loop.preview_url,
      }
    } else if (slide === 4 && data.top_artist?.preview_url) {
      candidate = {
        song_name: data.top_artist.signature_song || data.top_artist.artist_name,
        artist_name: data.top_artist.artist_name,
        artwork_url: data.top_artist.artwork_url,
        preview_url: data.top_artist.preview_url,
      }
    } else if (slide === 5 && data.top_track?.preview_url) {
      candidate = {
        song_name: data.top_track.song_name,
        artist_name: data.top_track.artist_name,
        album_name: data.top_track.album_name,
        artwork_url: data.top_track.artwork_url,
        preview_url: data.top_track.preview_url,
      }
    } else if (slide === 6 && data.top_album?.preview_url) {
      candidate = {
        song_name: data.top_album.album_name,
        artist_name: data.top_album.artist_name,
        artwork_url: data.top_album.artwork_url,
        preview_url: data.top_album.preview_url,
      }
    }
    if (candidate && playingTrack?.preview_url !== candidate.preview_url) {
      playPreview(candidate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, open, data, soundtrackOn])

  const next = useCallback(() => setSlide((s) => Math.min(totalSlides - 1, s + 1)), [totalSlides])
  const prev = useCallback(() => setSlide((s) => Math.max(0, s - 1)), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopPreview()
        onClose()
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, next, prev, onClose, stopPreview])

  const handleExportPng = async () => {
    if (!cardRef.current || exporting) return
    setExporting(true)
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2.5,
        backgroundColor: posterStyle === 'receipt' && slide === 10 ? '#f5f2eb' : '#06060b',
      })
      const a = document.createElement('a')
      a.download = `AMDataWrap-Odyssey-${slide + 1}${slide === 10 ? `-${posterStyle}` : ''}.png`
      a.href = dataUrl
      a.click()
    } catch (err) {
      console.error('Export PNG failed:', err)
    } finally {
      setExporting(false)
    }
  }

  if (!open) return null

  const theme = SLIDE_THEMES[slide]
  const topTrack = data?.top_track
  const isTopTrackPlaying = Boolean(
    topTrack?.preview_url && playingTrack?.preview_url === topTrack.preview_url && isPlaying
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-[#040407] flex flex-col items-center justify-center p-4 overflow-hidden"
    >
      {/* Live 3D Three.js Audio-Reactive Stage behind the Wrapped! */}
      <AmbientNebulaCanvas
        colors={theme.colors}
        mode={theme.mode}
        intensity={1.15}
        className="absolute inset-0 z-0 pointer-events-none"
      />

      {/* Top Bar: Progress Segments + Soundtrack Toggle + Export + Close */}
      <div className="relative z-20 w-full max-w-3xl mb-4 flex items-center gap-3">
        <div className="flex-1 grid grid-cols-11 gap-1">
          {SLIDE_THEMES.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setSlide(idx)}
              className="h-1.5 rounded-full bg-white/15 overflow-hidden cursor-pointer"
            >
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  idx <= slide ? 'bg-white w-full' : 'w-0'
                }`}
              />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            if (soundtrackOn) stopPreview()
            setSoundtrackOn((v) => !v)
          }}
          title="Bande-son automatique 30s"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${
            soundtrackOn
              ? 'bg-rose-500/20 border-rose-400/40 text-rose-200'
              : 'bg-white/10 border-white/10 text-zinc-400'
          }`}
        >
          {soundtrackOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          {soundtrackOn ? 'Son ON' : 'Muet'}
        </button>

        <button
          type="button"
          onClick={handleExportPng}
          disabled={exporting || !data}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-bold cursor-pointer disabled:opacity-40"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          PNG HD
        </button>

        <button
          type="button"
          onClick={() => {
            stopPreview()
            onClose()
          }}
          className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Stage */}
      <div className="relative z-20 w-full max-w-3xl flex items-center justify-center">
        <button
          type="button"
          onClick={prev}
          disabled={slide === 0}
          className="hidden md:flex absolute -left-14 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 items-center justify-center text-white backdrop-blur-md cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div
          ref={cardRef}
          className={`w-full min-h-[580px] max-h-[82vh] overflow-y-auto rounded-[2.2rem] p-7 md:p-10 flex flex-col justify-between relative ${
            slide === 10 && posterStyle === 'receipt'
              ? 'bg-[#f5f2eb] text-[#141414] border border-black/15 shadow-2xl'
              : 'spatial-glass border border-white/15'
          }`}
        >
          {/* Chapter Header */}
          <div className="flex items-center justify-between text-xs mb-3">
            <span
              className={`font-mono-num tracking-[0.18em] font-semibold ${
                slide === 10 && posterStyle === 'receipt' ? 'text-zinc-600' : 'text-rose-300'
              }`}
            >
              {theme.tag}
            </span>
            <div className="flex items-center gap-2">
              {slide === 10 && (
                <div className="flex items-center gap-1 bg-black/20 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setPosterStyle('spatial')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${
                      posterStyle === 'spatial' ? 'bg-white text-black' : 'text-zinc-400'
                    }`}
                  >
                    Poster Spatial
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosterStyle('receipt')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                      posterStyle === 'receipt' ? 'bg-black text-white' : 'text-zinc-300'
                    }`}
                  >
                    <Receipt className="w-3 h-3" />
                    Ticket Collector
                  </button>
                </div>
              )}
              <span
                className={`font-mono-num px-2.5 py-1 rounded-full text-[11px] ${
                  slide === 10 && posterStyle === 'receipt'
                    ? 'bg-black/10 text-black'
                    : 'bg-white/10 text-zinc-200 border border-white/10'
                }`}
              >
                {data?.period_label || 'Sonic Odyssey'}
              </span>
            </div>
          </div>

          {loading || !data ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-zinc-300">
              <Loader2 className="w-6 h-6 animate-spin text-rose-400" />
              <span>Préparation de votre Sonic Odyssey 3D…</span>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={`${slide}-${posterStyle}`}
                initial={{ opacity: 0, y: 26, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -18, scale: 0.97 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="my-auto py-4"
              >
                {/* 0: OUVERTURE */}
                {slide === 0 && (
                  <div className="space-y-6">
                    <p className="font-editorial text-2xl text-rose-300">Votre odyssée sonore commence ici.</p>
                    <h2 className="text-6xl md:text-7xl font-extrabold text-white leading-none font-mono-num">
                      {data.kpis.total_hours.toLocaleString('fr-FR')}
                      <span className="text-3xl text-rose-400 ml-2">heures</span>
                    </h2>
                    <p className="text-base text-zinc-300 max-w-xl">
                      <b className="text-white font-mono-num">{formatNumber(data.kpis.plays)}</b> écoutes intenses,{' '}
                      <b className="text-white font-mono-num">{formatNumber(data.kpis.unique_artists)}</b> artistes et{' '}
                      <b className="text-white font-mono-num">{formatNumber(data.kpis.unique_tracks)}</b> morceaux qui ont façonné votre univers.
                    </p>
                    <div className="grid grid-cols-3 gap-3 pt-2">
                      {data.equivalents.map((eq: any) => (
                        <div key={eq.label} className="rounded-2xl bg-white/[0.06] border border-white/10 p-4">
                          <p className="text-2xl md:text-3xl font-bold font-mono-num text-white">{eq.value}</p>
                          <p className="text-xs font-semibold text-rose-200 mt-1">{eq.label}</p>
                          <p className="text-[10px] text-zinc-400 mt-0.5">{eq.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 1: CHRONOBIOLOGIE / HEURE D'OR */}
                {slide === 1 && data.rhythm && (
                  <div className="space-y-6 text-center">
                    <p className="font-editorial text-2xl text-indigo-300">Votre horloge musicale secrète</p>
                    <h2 className="text-6xl md:text-7xl font-extrabold font-mono-num text-white">
                      {String(data.rhythm.peak_hour).padStart(2, '0')}h00
                    </h2>
                    <p className="text-sm text-zinc-300">
                      C'est votre heure d'or — le moment exact où le volume monte le plus fort.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                      {data.rhythm.time_slots.map((s: any) => (
                        <div key={s.label} className="rounded-2xl bg-white/[0.06] border border-white/10 p-3.5">
                          <p className="text-2xl font-bold font-mono-num text-white">{s.share_pct}%</p>
                          <p className="text-[11px] text-zinc-300 mt-1">{s.label.split(' ')[0]}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2: OBSESSION EN BOUCLE */}
                {slide === 2 && (
                  <div className="flex flex-col items-center text-center space-y-5">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-fuchsia-500/20 border border-fuchsia-400/30 text-fuchsia-200 text-xs font-semibold">
                      <Repeat className="w-3.5 h-3.5" />
                      {formatNumber(data.total_loops)} répétitions consécutives au total
                    </div>
                    {data.top_loop ? (
                      <>
                        {data.top_loop.artwork_url && (
                          <img
                            src={proxyArtworkUrl(data.top_loop.artwork_url)}
                            crossOrigin="anonymous"
                            alt={data.top_loop.song_name}
                            className="w-40 h-40 rounded-3xl object-cover shadow-2xl border border-white/20"
                          />
                        )}
                        <div>
                          <p className="font-editorial text-2xl text-fuchsia-300">Impossible de passer au suivant</p>
                          <h2 className="text-3xl md:text-4xl font-extrabold text-white mt-1">
                            {data.top_loop.song_name}
                          </h2>
                          <p className="text-sm text-zinc-300 mt-1">{data.top_loop.artist_name}</p>
                        </div>
                        <p className="text-2xl font-mono-num font-bold text-rose-300">
                          {data.top_loop.max_consecutive}× d'affilée le {formatDateFr(data.top_loop.peak_date)}
                        </p>
                      </>
                    ) : (
                      <p className="text-zinc-400">Aucune boucle consécutive détectée sur cette période.</p>
                    )}
                  </div>
                )}

                {/* 3: PLUS GRANDE PHASE */}
                {slide === 3 && (
                  <div className="flex flex-col items-center text-center space-y-5">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-200 text-xs font-semibold">
                      <Flame className="w-3.5 h-3.5" />
                      Pic d'obsession détecté (fenêtre 14 jours)
                    </div>
                    {data.top_phase ? (
                      <>
                        {data.top_phase.artwork_url && (
                          <img
                            src={proxyArtworkUrl(data.top_phase.artwork_url)}
                            crossOrigin="anonymous"
                            alt={data.top_phase.artist_name}
                            className="w-40 h-40 rounded-full object-cover shadow-2xl border-2 border-amber-400/40"
                          />
                        )}
                        <h2 className="text-4xl md:text-5xl font-extrabold text-white">
                          {data.top_phase.artist_name}
                        </h2>
                        <p className="font-editorial text-2xl text-amber-200">
                          Du {formatDateFr(data.top_phase.start_date)} au {formatDateFr(data.top_phase.end_date)}
                        </p>
                        <div className="grid grid-cols-3 gap-3 w-full max-w-md pt-1">
                          <div className="rounded-2xl bg-white/[0.06] p-3">
                            <p className="text-2xl font-bold font-mono-num text-amber-300">×{data.top_phase.lift}</p>
                            <p className="text-[10px] text-zinc-400">vs habitude</p>
                          </div>
                          <div className="rounded-2xl bg-white/[0.06] p-3">
                            <p className="text-2xl font-bold font-mono-num text-white">{data.top_phase.window_share_pct}%</p>
                            <p className="text-[10px] text-zinc-400">des écoutes</p>
                          </div>
                          <div className="rounded-2xl bg-white/[0.06] p-3">
                            <p className="text-2xl font-bold font-mono-num text-white">{data.top_phase.plays}×</p>
                            <p className="text-[10px] text-zinc-400">lectures</p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-zinc-400">Écoute très équilibrée, sans phase dominante sur cette période.</p>
                    )}
                  </div>
                )}

                {/* 4: ARTISTE #1 + WIKIPEDIA BIO */}
                {slide === 4 && data.top_artist && (
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-center">
                    <div className="md:col-span-2 flex flex-col items-center">
                      {data.top_artist.artwork_url && (
                        <div className="relative">
                          <img
                            src={proxyArtworkUrl(data.top_artist.artwork_url)}
                            crossOrigin="anonymous"
                            alt={data.top_artist.artist_name}
                            className="w-48 h-48 rounded-full object-cover shadow-2xl border-2 border-white/25 animate-vinyl"
                          />
                          <div className="w-8 h-8 rounded-full bg-[#06060b] border-2 border-white/30 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-3 space-y-3 text-left">
                      <p className="font-editorial text-2xl text-fuchsia-300">Votre Artiste #1 incontesté</p>
                      <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight">
                        {data.top_artist.artist_name}
                      </h2>
                      <p className="font-mono-num text-lg text-rose-300 font-bold">
                        {formatDurationMs(data.top_artist.total_ms)} · {formatNumber(data.top_artist.plays)} écoutes
                      </p>
                      {data.top_artist.glory_month && (
                        <p className="text-xs text-zinc-300 bg-white/[0.06] border border-white/10 rounded-xl px-3 py-2 inline-block">
                          Pic d'écoute en <b>{formatMonthFr(data.top_artist.glory_month.month)}</b> (
                          <span className="font-mono-num">{formatDurationMs(data.top_artist.glory_month.total_ms, true)}</span>)
                        </p>
                      )}
                      {artistBio?.found && artistBio.summary && (
                        <p className="text-xs text-zinc-400 leading-relaxed line-clamp-4 pt-1 border-t border-white/10">
                          {artistBio.summary}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* 5: TITRE #1 + SPINNING VINYL + LIVE LRCLIB LYRICS + DEEZER BPM */}
                {slide === 5 && data.top_track && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                    <div className="flex flex-col items-center text-center space-y-4">
                      <div className="relative w-48 h-48">
                        <img
                          src={proxyArtworkUrl(data.top_track.artwork_url)}
                          crossOrigin="anonymous"
                          alt={data.top_track.song_name}
                          className={`w-48 h-48 rounded-full object-cover shadow-2xl border-2 border-white/25 ${
                            isTopTrackPlaying ? 'animate-vinyl' : 'animate-vinyl-paused'
                          }`}
                        />
                        <div className="w-9 h-9 rounded-full bg-[#06060b] border-2 border-white/30 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                      </div>
                      <div>
                        <p className="font-editorial text-xl text-sky-300">Votre hymne #1</p>
                        <h2 className="text-3xl font-extrabold text-white mt-0.5">{data.top_track.song_name}</h2>
                        <p className="text-sm text-zinc-300">{data.top_track.artist_name}</p>
                      </div>
                      <div className="flex items-center gap-2 font-mono-num text-xs">
                        <span className="px-3 py-1 rounded-full bg-white/10 text-white font-bold">
                          {formatNumber(data.top_track.plays)} écoutes
                        </span>
                        {topBpm && (
                          <span className="px-3 py-1 rounded-full bg-sky-500/20 text-sky-300 flex items-center gap-1">
                            <Activity className="w-3 h-3" /> {Math.round(topBpm)} BPM
                          </span>
                        )}
                      </div>
                      {data.top_track.preview_url && (
                        <button
                          type="button"
                          onClick={() =>
                            playPreview({
                              song_name: data.top_track.song_name,
                              artist_name: data.top_track.artist_name,
                              album_name: data.top_track.album_name,
                              artwork_url: data.top_track.artwork_url,
                              preview_url: data.top_track.preview_url,
                            })
                          }
                          className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-white text-black text-xs font-bold cursor-pointer"
                        >
                          {isTopTrackPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                          {isTopTrackPlaying ? 'Pause' : 'Écouter 30s'}
                        </button>
                      )}
                    </div>

                    {/* Floating Apple Music Sing-style Lyrics */}
                    <div className="rounded-3xl bg-black/35 border border-white/10 p-5 max-h-80 overflow-y-auto">
                      <p className="text-[10px] uppercase tracking-widest text-sky-300 mb-3 font-semibold">
                        Paroles · LRCLIB Live
                      </p>
                      {topLyrics ? (
                        <p className="text-sm text-zinc-100 whitespace-pre-line leading-relaxed font-medium">
                          {topLyrics.split('\n').slice(0, 18).join('\n')}
                        </p>
                      ) : (
                        <p className="text-xs text-zinc-400 italic">
                          « {data.top_track.song_name} » — {formatDurationMs(data.top_track.total_ms)} passées dans vos écouteurs.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* 6: ALBUM #1 */}
                {slide === 6 && data.top_album && (
                  <div className="flex flex-col items-center text-center space-y-5">
                    <p className="font-editorial text-2xl text-violet-300">Votre album refuge</p>
                    {data.top_album.artwork_url && (
                      <motion.img
                        whileHover={{ rotateY: 12, rotateX: -6, scale: 1.04 }}
                        src={proxyArtworkUrl(data.top_album.artwork_url)}
                        crossOrigin="anonymous"
                        alt={data.top_album.album_name}
                        className="w-52 h-52 rounded-3xl object-cover shadow-2xl border border-white/20"
                      />
                    )}
                    <div>
                      <h2 className="text-3xl md:text-4xl font-extrabold text-white">{data.top_album.album_name}</h2>
                      <p className="text-base text-zinc-300 mt-1">
                        {data.top_album.artist_name} {data.top_album.release_year ? `· ${data.top_album.release_year}` : ''}
                      </p>
                    </div>
                    <p className="font-mono-num text-lg text-violet-200 font-bold">
                      {formatDurationMs(data.top_album.total_ms)} · {formatNumber(data.top_album.plays)} écoutes
                    </p>
                  </div>
                )}

                {/* 7: VOYAGE TEMPOREL (AGE D'ECOUTE) */}
                {slide === 7 && data.listening_age && (
                  <div className="space-y-5 text-center">
                    <p className="font-editorial text-2xl text-amber-300">Voyage dans le temps</p>
                    <p className="text-7xl md:text-8xl font-extrabold font-mono-num text-white">
                      {data.listening_age.age ?? '—'} <span className="text-3xl text-amber-300">ans</span>
                    </p>
                    <p className="text-sm text-zinc-300 max-w-md mx-auto">
                      Votre année médiane pondérée est <b className="text-white font-mono-num">{data.listening_age.weighted_median_year}</b>, avec une décennie de cœur dans les{' '}
                      <b className="text-amber-300 font-mono-num">{data.listening_age.heart_decade}</b>.
                    </p>
                    <div className="grid grid-cols-4 gap-2.5 pt-2">
                      {data.listening_age.eras.map((e: any) => (
                        <div key={e.label} className="rounded-2xl bg-white/[0.06] border border-white/10 p-3">
                          <p className="text-xl font-bold font-mono-num text-white">{e.share_pct}%</p>
                          <p className="text-[10px] text-zinc-400 mt-0.5">{e.label.split(' ')[0]}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 8: ARCHETYPE & AURA */}
                {slide === 8 && data.persona && (
                  <div className="space-y-5 text-center">
                    <p className="font-editorial text-2xl text-teal-300">Votre archétype sonore</p>
                    <h2 className="text-4xl md:text-5xl font-extrabold text-white">{data.persona.title}</h2>
                    <p className="text-base italic text-teal-200">« {data.persona.tagline} »</p>
                    <p className="text-sm text-zinc-300 max-w-lg mx-auto">{data.persona.description}</p>
                    <div className="grid grid-cols-3 gap-2.5 pt-1">
                      {data.persona.radial_scores.map((s: any) => (
                        <div key={s.axis} className="rounded-2xl bg-white/[0.06] border border-white/10 p-3">
                          <p className="text-[11px] text-zinc-400">{s.axis}</p>
                          <p className="text-2xl font-bold font-mono-num text-white">{s.score}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 9: PAROLES & RECHERCHES */}
                {slide === 9 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="rounded-3xl bg-white/[0.05] border border-white/10 p-5 space-y-3">
                      <p className="text-xs uppercase tracking-wider text-sky-300 font-semibold">
                        Paroles affichées ({formatNumber(data.lyrics_highlight?.total_views || 0)}×)
                      </p>
                      <p className="font-editorial text-2xl text-white">Ce que vous chantez le plus</p>
                      <div className="space-y-2.5 pt-1">
                        {(data.lyrics_highlight?.top_3 || []).map((t: any, i: number) => (
                          <div key={t.track_key} className="flex items-center gap-2.5 text-xs">
                            <span className="font-mono-num text-zinc-500">#{i + 1}</span>
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-white truncate">{t.song_name}</p>
                              <p className="text-[11px] text-zinc-400 truncate">{t.artist_name}</p>
                            </div>
                            <span className="font-mono-num text-sky-300 font-bold">{t.lyric_views}×</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-3xl bg-white/[0.05] border border-white/10 p-5 space-y-3">
                      <p className="text-xs uppercase tracking-wider text-amber-300 font-semibold flex items-center gap-1.5">
                        <Search className="w-3.5 h-3.5" />
                        Recherches ({formatNumber(data.searches_highlight?.total_searches || 0)})
                      </p>
                      <p className="font-editorial text-2xl text-white">Vos obsessions dans la barre de recherche</p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {(data.searches_highlight?.top_queries || []).map((q: any) => (
                          <span
                            key={q.query}
                            className="px-3 py-1.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white font-medium"
                          >
                            {q.query} <span className="font-mono-num text-amber-300 ml-1">{q.count}×</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 10: POSTER COLLECTOR (SPATIAL vs RECEIPTIFY TICKET) */}
                {slide === 10 && data.summary_card && (
                  posterStyle === 'receipt' ? (
                    <div className="max-w-md mx-auto font-mono-num text-xs space-y-4 py-2">
                      <div className="text-center border-b-2 border-dashed border-black/30 pb-3">
                        <p className="text-xl font-extrabold tracking-widest uppercase">AMDATAWRAP</p>
                        <p className="text-[10px] text-zinc-600 mt-0.5">SONIC ODYSSEY RECEIPT · {data.period_label}</p>
                        <p className="text-[10px] text-zinc-600">ARCHETYPE: {data.persona?.title?.toUpperCase()}</p>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[10px] font-bold border-b border-black/20 pb-1">
                          <span>QTY  ITEM (TOP TRACKS)</span>
                          <span>TIME</span>
                        </div>
                        {data.summary_card.top_tracks.map((t: any, i: number) => (
                          <div key={t.track_key} className="flex justify-between gap-2">
                            <span className="truncate">
                              {String(t.plays).padStart(2, '0')}x  {t.song_name.toUpperCase()} - {(t.artist_name || '').toUpperCase()}
                            </span>
                            <span className="shrink-0">{formatDurationMs(t.total_ms, true)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-dashed border-black/30">
                        <div className="flex justify-between text-[10px] font-bold">
                          <span>TOP ARTISTS</span>
                          <span>HOURS</span>
                        </div>
                        {data.summary_card.top_artists.map((a: any, i: number) => (
                          <div key={a.artist_group_key} className="flex justify-between gap-2">
                            <span className="truncate">
                              0{i + 1}  {a.artist_name.toUpperCase()}
                            </span>
                            <span>{formatDurationMs(a.total_ms, true)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="border-t-2 border-dashed border-black/30 pt-3 space-y-1">
                        <div className="flex justify-between font-bold text-sm">
                          <span>TOTAL LISTENING</span>
                          <span>{data.kpis.total_hours} HRS</span>
                        </div>
                        <div className="flex justify-between text-[10px] text-zinc-600">
                          <span>LISTENING AGE: {data.listening_age?.age ?? '—'} YRS</span>
                          <span>PLAYS: {formatNumber(data.kpis.plays)}</span>
                        </div>
                      </div>

                      <div className="text-center pt-2">
                        <div className="h-8 w-full bg-[repeating-linear-gradient(90deg,#111_0px,#111_2px,transparent_2px,transparent_4px,#111_4px,#111_5px,transparent_5px,transparent_8px)] opacity-85" />
                        <p className="text-[9px] text-zinc-500 mt-1">THANK YOU FOR LISTENING · APPLE MUSIC EXPORT</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <p className="font-editorial text-2xl text-rose-300">{data.persona?.title}</p>
                          <h2 className="text-3xl font-extrabold text-white">Votre Empreinte Spatiale</h2>
                        </div>
                        <div className="text-right font-mono-num">
                          <p className="text-3xl font-extrabold text-white">{data.kpis.total_hours} h</p>
                          <p className="text-xs text-zinc-400">Âge musical {data.listening_age?.age ?? '—'} ans</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-2xl bg-black/40 border border-white/10 p-4 space-y-2">
                          <p className="text-[10px] uppercase tracking-widest text-rose-300 font-bold">Top 5 Artistes</p>
                          {data.summary_card.top_artists.map((a: any, i: number) => (
                            <div key={a.artist_group_key} className="flex items-center gap-2.5 text-xs">
                              <span className="font-mono-num text-zinc-500 w-3">{i + 1}</span>
                              {a.artwork_url && (
                                <img
                                  src={proxyArtworkUrl(a.artwork_url)}
                                  crossOrigin="anonymous"
                                  alt={a.artist_name}
                                  className="w-7 h-7 rounded-full object-cover"
                                />
                              )}
                              <span className="text-white font-bold truncate flex-1">{a.artist_name}</span>
                              <span className="font-mono-num text-zinc-400">{formatDurationMs(a.total_ms, true)}</span>
                            </div>
                          ))}
                        </div>

                        <div className="rounded-2xl bg-black/40 border border-white/10 p-4 space-y-2">
                          <p className="text-[10px] uppercase tracking-widest text-sky-300 font-bold">Top 5 Titres</p>
                          {data.summary_card.top_tracks.map((t: any, i: number) => (
                            <div key={t.track_key} className="flex items-center gap-2.5 text-xs">
                              <span className="font-mono-num text-zinc-500 w-3">{i + 1}</span>
                              {t.artwork_url && (
                                <img
                                  src={proxyArtworkUrl(t.artwork_url)}
                                  crossOrigin="anonymous"
                                  alt={t.song_name}
                                  className="w-7 h-7 rounded-lg object-cover"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-white font-bold truncate">{t.song_name}</p>
                                <p className="text-[10px] text-zinc-400 truncate">{t.artist_name}</p>
                              </div>
                              <span className="font-mono-num text-zinc-400">{t.plays}×</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <div className="flex flex-wrap gap-1.5">
                          {data.summary_card.top_genres.map((g: any) => (
                            <span key={g.genre} className="px-2.5 py-1 rounded-full bg-white/10 text-[11px] text-zinc-200">
                              {g.genre}
                            </span>
                          ))}
                        </div>
                        <span className="text-xs font-mono-num text-zinc-400">
                          {formatNumber(data.kpis.plays)} écoutes · {formatNumber(data.kpis.unique_artists)} artistes
                        </span>
                      </div>
                    </div>
                  )
                )}
              </motion.div>
            </AnimatePresence>
          )}

          {/* Footer */}
          <div
            className={`flex items-center justify-between text-[11px] pt-2 ${
              slide === 10 && posterStyle === 'receipt' ? 'text-zinc-500' : 'text-zinc-500'
            }`}
          >
            <span className="font-mono-num">
              {slide + 1} / {totalSlides}
            </span>
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-rose-400" />
              Flèches ← → ou Espace
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={next}
          disabled={slide === totalSlides - 1}
          className="hidden md:flex absolute -right-14 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 items-center justify-center text-white backdrop-blur-md cursor-pointer"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  )
}
