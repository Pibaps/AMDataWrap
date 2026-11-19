import { AnimatePresence, motion } from 'framer-motion'
import { toPng } from 'html-to-image'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Pause,
  Play,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, proxyArtworkUrl } from '../../api/client'
import { useApp } from '../../store/AppContext'
import { formatDateFr, formatDurationMs, formatMonthFr, formatNumber } from '../../utils/format'

interface WrappedStoryModalProps {
  open: boolean
  onClose: () => void
}

const SLIDE_GRADIENTS = [
  'from-rose-600/40 via-[#120b1e] to-[#08080c]',
  'from-fuchsia-600/40 via-[#150c24] to-[#08080c]',
  'from-indigo-600/40 via-[#0d1026] to-[#08080c]',
  'from-violet-600/40 via-[#130c22] to-[#08080c]',
  'from-amber-500/35 via-[#1c120d] to-[#08080c]',
  'from-teal-500/35 via-[#0b1b1d] to-[#08080c]',
  'from-rose-500/40 via-[#1a0d18] to-[#08080c]',
  'from-rose-600/35 via-indigo-950/60 to-[#08080c]',
]

export function WrappedStoryModal({ open, onClose }: WrappedStoryModalProps) {
  const { filters, playPreview, playingTrack, isPlaying, stopPreview } = useApp()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [slide, setSlide] = useState(0)
  const [exporting, setExporting] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const totalSlides = 8

  useEffect(() => {
    if (!open) return
    setSlide(0)
    setLoading(true)
    apiGet('/api/analytics/wrapped', filters)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [open, filters])

  const next = useCallback(() => setSlide((s) => Math.min(totalSlides - 1, s + 1)), [])
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
        backgroundColor: '#08080c',
      })
      const a = document.createElement('a')
      a.download = `AMDataWrap-${data?.period_label?.replace(/\s+/g, '_') || 'Wrapped'}-slide${slide + 1}.png`
      a.href = dataUrl
      a.click()
    } catch (err) {
      console.error('Export PNG failed:', err)
    } finally {
      setExporting(false)
    }
  }

  if (!open) return null

  const topTrack = data?.top_track
  const isTopTrackPlaying = Boolean(
    topTrack?.preview_url && playingTrack?.preview_url === topTrack.preview_url && isPlaying
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-[#050508]/95 backdrop-blur-2xl flex flex-col items-center justify-center p-4"
    >
      {/* Top Progress Bars & Controls */}
      <div className="w-full max-w-2xl mb-4 flex items-center gap-3">
        <div className="flex-1 grid grid-cols-8 gap-1.5">
          {Array.from({ length: totalSlides }).map((_, idx) => (
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
          onClick={handleExportPng}
          disabled={exporting || !data}
          title="Exporter cette carte en PNG HD"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white cursor-pointer disabled:opacity-40"
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

      {/* Main Story Card Stage */}
      <div className="relative w-full max-w-2xl flex items-center justify-center">
        <button
          type="button"
          onClick={prev}
          disabled={slide === 0}
          className="hidden md:flex absolute -left-14 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 items-center justify-center text-white cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div
          ref={cardRef}
          className={`w-full min-h-[540px] rounded-[2rem] bg-gradient-to-br ${SLIDE_GRADIENTS[slide]} border border-white/15 shadow-2xl p-7 md:p-10 flex flex-col justify-between relative overflow-hidden`}
        >
          {/* Brand Header inside exportable card */}
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span className="font-display font-bold tracking-tight flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-rose-400" />
              AMDataWrap
            </span>
            <span className="font-mono-num px-2.5 py-1 rounded-full bg-white/10 border border-white/10 text-[11px]">
              {data?.period_label || 'Wrapped'}
            </span>
          </div>

          {loading || !data ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-zinc-300">
              <Loader2 className="w-6 h-6 animate-spin text-rose-400" />
              <span>Création de votre Wrapped…</span>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={slide}
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -18, scale: 0.98 }}
                transition={{ duration: 0.32 }}
                className="my-auto py-6"
              >
                {/* SLIDE 0: Intro & Fun Equivalents */}
                {slide === 0 && (
                  <div className="space-y-6">
                    <p className="text-xs uppercase tracking-[0.2em] text-rose-300 font-semibold">
                      Votre bande-son en chiffres
                    </p>
                    <h2 className="text-5xl md:text-6xl font-bold text-white leading-none font-mono-num">
                      {data.kpis.total_hours.toLocaleString('fr-FR')} h
                    </h2>
                    <p className="text-lg text-zinc-300">
                      Soit <b className="text-white font-mono-num">{formatNumber(data.kpis.plays)}</b> écoutes,{' '}
                      <b className="text-white font-mono-num">{formatNumber(data.kpis.unique_artists)}</b> artistes et{' '}
                      <b className="text-white font-mono-num">{formatNumber(data.kpis.unique_tracks)}</b> titres uniques.
                    </p>
                    <div className="grid grid-cols-3 gap-3 pt-2">
                      {data.equivalents.map((eq: any) => (
                        <div key={eq.label} className="rounded-2xl bg-white/[0.06] border border-white/10 p-3.5">
                          <p className="text-2xl font-bold font-mono-num text-rose-300">{eq.value}</p>
                          <p className="text-xs font-semibold text-white mt-1">{eq.label}</p>
                          <p className="text-[10px] text-zinc-400 mt-0.5">{eq.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SLIDE 1: Top Artist #1 */}
                {slide === 1 && data.top_artist && (
                  <div className="flex flex-col items-center text-center space-y-5">
                    <p className="text-xs uppercase tracking-[0.2em] text-fuchsia-300 font-semibold">
                      Votre Artiste #1
                    </p>
                    {data.top_artist.artwork_url && (
                      <img
                        src={proxyArtworkUrl(data.top_artist.artwork_url)}
                        crossOrigin="anonymous"
                        alt={data.top_artist.artist_name}
                        className="w-40 h-40 rounded-full object-cover shadow-2xl border-2 border-white/20"
                      />
                    )}
                    <h2 className="text-4xl md:text-5xl font-bold text-white">{data.top_artist.artist_name}</h2>
                    <p className="font-mono-num text-lg text-fuchsia-200">
                      {formatDurationMs(data.top_artist.total_ms)} · {formatNumber(data.top_artist.plays)} écoutes
                    </p>
                    {data.top_artist.glory_month && (
                      <div className="px-4 py-2 rounded-2xl bg-white/[0.07] border border-white/10 text-xs text-zinc-200">
                        Son moment de gloire :{' '}
                        <b className="text-white">{formatMonthFr(data.top_artist.glory_month.month)}</b> (
                        <span className="font-mono-num">
                          {formatDurationMs(data.top_artist.glory_month.total_ms, true)}
                        </span>
                        )
                      </div>
                    )}
                  </div>
                )}

                {/* SLIDE 2: Top Track #1 + 30s Preview */}
                {slide === 2 && data.top_track && (
                  <div className="flex flex-col items-center text-center space-y-5">
                    <p className="text-xs uppercase tracking-[0.2em] text-indigo-300 font-semibold">
                      Votre Titre #1
                    </p>
                    {data.top_track.artwork_url && (
                      <img
                        src={proxyArtworkUrl(data.top_track.artwork_url)}
                        crossOrigin="anonymous"
                        alt={data.top_track.song_name}
                        className="w-44 h-44 rounded-3xl object-cover shadow-2xl border border-white/20"
                      />
                    )}
                    <div>
                      <h2 className="text-3xl md:text-4xl font-bold text-white">{data.top_track.song_name}</h2>
                      <p className="text-base text-zinc-300 mt-1">{data.top_track.artist_name}</p>
                    </div>
                    <p className="font-mono-num text-base text-indigo-200">
                      {formatNumber(data.top_track.plays)} écoutes · {formatDurationMs(data.top_track.total_ms)}
                    </p>
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
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold shadow-lg hover:scale-105 transition-transform cursor-pointer"
                      >
                        {isTopTrackPlaying ? (
                          <>
                            <Pause className="w-4 h-4 fill-current" /> Mettre en pause
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4 fill-current" /> Écouter l'extrait 30s
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}

                {/* SLIDE 3: Top Album #1 */}
                {slide === 3 && data.top_album && (
                  <div className="flex flex-col items-center text-center space-y-5">
                    <p className="text-xs uppercase tracking-[0.2em] text-violet-300 font-semibold">
                      Votre Album #1
                    </p>
                    {data.top_album.artwork_url && (
                      <img
                        src={proxyArtworkUrl(data.top_album.artwork_url)}
                        crossOrigin="anonymous"
                        alt={data.top_album.album_name}
                        className="w-44 h-44 rounded-3xl object-cover shadow-2xl border border-white/20"
                      />
                    )}
                    <div>
                      <h2 className="text-3xl md:text-4xl font-bold text-white">{data.top_album.album_name}</h2>
                      <p className="text-base text-zinc-300 mt-1">
                        {data.top_album.artist_name}
                        {data.top_album.release_year ? ` · ${data.top_album.release_year}` : ''}
                      </p>
                    </div>
                    <p className="font-mono-num text-base text-violet-200">
                      {formatDurationMs(data.top_album.total_ms)} · {formatNumber(data.top_album.plays)} écoutes
                    </p>
                  </div>
                )}

                {/* SLIDE 4: Listening Age */}
                {slide === 4 && data.listening_age && (
                  <div className="space-y-5 text-center">
                    <p className="text-xs uppercase tracking-[0.2em] text-amber-300 font-semibold">
                      Votre Âge d'Écoute
                    </p>
                    <p className="text-7xl md:text-8xl font-bold font-mono-num text-white">
                      {data.listening_age.age ?? '—'} <span className="text-3xl text-amber-300">ans</span>
                    </p>
                    <p className="text-base text-zinc-300 max-w-md mx-auto">
                      Année de sortie médiane : <b className="text-white font-mono-num">{data.listening_age.weighted_median_year}</b> ·
                      Décennie de cœur : <b className="text-amber-300 font-mono-num">{data.listening_age.heart_decade}</b>
                    </p>
                    <div className="grid grid-cols-4 gap-2 pt-2">
                      {data.listening_age.eras.map((e: any) => (
                        <div key={e.label} className="rounded-xl bg-white/[0.06] border border-white/10 p-2.5">
                          <p className="text-lg font-bold font-mono-num text-white">{e.share_pct}%</p>
                          <p className="text-[10px] text-zinc-400 mt-0.5">{e.label.split(' ')[0]}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SLIDE 5: Listener Archetype */}
                {slide === 5 && data.persona && (
                  <div className="space-y-5 text-center">
                    <p className="text-xs uppercase tracking-[0.2em] text-teal-300 font-semibold">
                      Votre Archétype Musical
                    </p>
                    <h2 className="text-4xl md:text-5xl font-bold text-white">{data.persona.title}</h2>
                    <p className="text-base italic text-teal-200">« {data.persona.tagline} »</p>
                    <p className="text-sm text-zinc-300 max-w-lg mx-auto leading-relaxed">
                      {data.persona.description}
                    </p>
                    <div className="grid grid-cols-3 gap-2.5 pt-2">
                      {data.persona.radial_scores.slice(0, 6).map((s: any) => (
                        <div key={s.axis} className="rounded-xl bg-white/[0.06] border border-white/10 p-2.5">
                          <p className="text-xs text-zinc-400">{s.axis}</p>
                          <p className="text-xl font-bold font-mono-num text-white">{s.score}/100</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SLIDE 6: Biggest Listening Day & Streak */}
                {slide === 6 && data.records && (
                  <div className="space-y-6 text-center">
                    <p className="text-xs uppercase tracking-[0.2em] text-rose-300 font-semibold">
                      Vos Records Absoluts
                    </p>
                    {data.records.record_day && (
                      <div className="rounded-3xl bg-white/[0.06] border border-white/10 p-6">
                        <p className="text-xs text-zinc-400">Plus grosse journée d'écoute</p>
                        <p className="text-3xl font-bold text-white mt-1">
                          {formatDateFr(data.records.record_day.date)}
                        </p>
                        <p className="text-2xl font-bold font-mono-num text-rose-300 mt-2">
                          {formatDurationMs(data.records.record_day.total_ms)} · {data.records.record_day.plays} titres
                        </p>
                      </div>
                    )}
                    {data.records.longest_streak && (
                      <div className="rounded-2xl bg-white/[0.05] border border-white/10 p-4">
                        <p className="text-xs text-zinc-400">Plus longue série sans interruption</p>
                        <p className="text-2xl font-bold font-mono-num text-amber-300 mt-1">
                          {data.records.longest_streak.days} jours consécutifs
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* SLIDE 7: Final Shareable Summary Card */}
                {slide === 7 && data.summary_card && (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-rose-300 font-semibold">
                          Carte Récapitulative
                        </p>
                        <h2 className="text-2xl md:text-3xl font-bold text-white mt-0.5">
                          {data.persona?.title}
                        </h2>
                      </div>
                      <div className="text-right font-mono-num">
                        <p className="text-2xl font-bold text-white">{data.kpis.total_hours} h</p>
                        <p className="text-[11px] text-zinc-400">Âge musical : {data.listening_age?.age ?? '—'} ans</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                        <p className="text-[10px] uppercase tracking-wider text-rose-300 mb-2.5 font-semibold">
                          Top 5 Artistes
                        </p>
                        <div className="space-y-2">
                          {data.summary_card.top_artists.map((a: any, i: number) => (
                            <div key={a.artist_group_key} className="flex items-center gap-2.5 text-xs">
                              <span className="font-mono-num text-zinc-500 w-3">{i + 1}</span>
                              {a.artwork_url && (
                                <img
                                  src={proxyArtworkUrl(a.artwork_url)}
                                  crossOrigin="anonymous"
                                  alt={a.artist_name}
                                  className="w-7 h-7 rounded-full object-cover shrink-0"
                                />
                              )}
                              <span className="text-white font-semibold truncate flex-1">{a.artist_name}</span>
                              <span className="font-mono-num text-zinc-400">{formatDurationMs(a.total_ms, true)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                        <p className="text-[10px] uppercase tracking-wider text-indigo-300 mb-2.5 font-semibold">
                          Top 5 Titres
                        </p>
                        <div className="space-y-2">
                          {data.summary_card.top_tracks.map((t: any, i: number) => (
                            <div key={t.track_key} className="flex items-center gap-2.5 text-xs">
                              <span className="font-mono-num text-zinc-500 w-3">{i + 1}</span>
                              {t.artwork_url && (
                                <img
                                  src={proxyArtworkUrl(t.artwork_url)}
                                  crossOrigin="anonymous"
                                  alt={t.song_name}
                                  className="w-7 h-7 rounded-lg object-cover shrink-0"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-white font-semibold truncate">{t.song_name}</p>
                                <p className="text-[10px] text-zinc-400 truncate">{t.artist_name}</p>
                              </div>
                              <span className="font-mono-num text-zinc-400">{t.plays}×</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap gap-1.5">
                        {data.summary_card.top_genres.map((g: any) => (
                          <span
                            key={g.genre}
                            className="px-2.5 py-1 rounded-full bg-white/10 text-[11px] text-zinc-200"
                          >
                            {g.genre}
                          </span>
                        ))}
                      </div>
                      <span className="text-[11px] font-mono-num text-zinc-400">
                        {formatNumber(data.kpis.plays)} écoutes · {formatNumber(data.kpis.unique_artists)} artistes
                      </span>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}

          {/* Footer hint */}
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span className="font-mono-num">
              {slide + 1} / {totalSlides}
            </span>
            <span>Flèches ← → ou Espace pour naviguer</span>
          </div>
        </div>

        <button
          type="button"
          onClick={next}
          disabled={slide === totalSlides - 1}
          className="hidden md:flex absolute -right-14 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 items-center justify-center text-white cursor-pointer"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile Nav Buttons */}
      <div className="flex md:hidden items-center gap-4 mt-4">
        <button
          type="button"
          onClick={prev}
          disabled={slide === 0}
          className="px-4 py-2 rounded-xl bg-white/10 text-white text-xs disabled:opacity-30"
        >
          ← Précédent
        </button>
        <button
          type="button"
          onClick={next}
          disabled={slide === totalSlides - 1}
          className="px-4 py-2 rounded-xl bg-white text-black font-semibold text-xs disabled:opacity-30"
        >
          Suivant →
        </button>
      </div>
    </motion.div>
  )
}
