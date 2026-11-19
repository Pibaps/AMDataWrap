import { motion } from 'framer-motion'
import {
  ArrowUpRight,
  Calendar,
  Clock,
  Disc3,
  Flame,
  ListMusic,
  Orbit,
  Play,
  Smartphone,
  Sparkles,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiGet } from '../api/client'
import { AnimatedCounter } from '../components/ui/AnimatedCounter'
import { Artwork } from '../components/ui/Artwork'
import { useApp } from '../store/AppContext'
import { formatDateFr, formatDurationMs, formatNumber } from '../utils/format'

interface OverviewPageProps {
  onOpenWrapped: () => void
  onNavigate: (tab: string) => void
}

export function OverviewPage({ onOpenWrapped, onNavigate }: OverviewPageProps) {
  const { filters, refreshKey, openDrawer, playPreview, setAmbientFromArtwork } = useApp()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet('/api/analytics/overview', filters)
      .then((res) => {
        if (cancelled) return
        setData(res)
        const art = res?.top_artists?.[0]?.artwork_url || res?.top_tracks?.[0]?.artwork_url
        if (art) setAmbientFromArtwork(art)
      })
      .catch(console.error)
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [filters, refreshKey, setAmbientFromArtwork])

  if (loading && !data) {
    return <div className="h-96 rounded-[2rem] bg-white/[0.04] animate-pulse" />
  }
  if (!data) return null

  const { kpis, records, top_artists, top_tracks, top_albums, top_genres, breakdowns } = data
  const heroArtist = top_artists?.[0]
  const heroTrack = top_tracks?.[0]

  return (
    <div className="space-y-6">
      {/* Editorial Asymmetric Hero Stage */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Massive Editorial Typography + Odyssey Launchers */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-8 spatial-glass rounded-[2.2rem] p-7 md:p-9 flex flex-col justify-between relative overflow-hidden"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] font-mono-num uppercase tracking-wider">
                {kpis.min_date && kpis.max_date
                  ? `${formatDateFr(kpis.min_date)} → ${formatDateFr(kpis.max_date)}`
                  : 'Apple Music Archive'}
              </span>
              <span className="px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-zinc-300 text-[11px] font-mono-num">
                {formatNumber(kpis.total_sessions)} sessions
              </span>
            </div>

            <div>
              <p className="font-editorial text-2xl md:text-3xl text-rose-300">Votre empreinte sonore totale</p>
              <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tight mt-1 leading-[0.95]">
                <AnimatedCounter value={kpis.total_hours} decimals={1} />
                <span className="text-2xl md:text-3xl text-zinc-400 font-display ml-2">heures</span>
              </h1>
            </div>

            <p className="text-sm text-zinc-400 max-w-xl leading-relaxed">
              <span className="text-white font-mono-num font-semibold">{kpis.total_days} jours</span> de musique non-stop sur{' '}
              <span className="text-white font-mono-num font-semibold">{formatNumber(kpis.active_days)}</span> jours actifs ·{' '}
              <span className="text-white font-mono-num font-semibold">{formatNumber(kpis.unique_artists)}</span> artistes ·{' '}
              <span className="text-white font-mono-num font-semibold">{formatNumber(kpis.unique_tracks)}</span> titres uniques.
            </p>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpenWrapped}
              className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-white text-black font-bold text-xs tracking-wide uppercase hover:scale-[1.03] active:scale-[0.98] transition-all shadow-xl shadow-white/10 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              Lancer Sonic Odyssey (Wrapped 3D)
            </button>

            <button
              type="button"
              onClick={() => onNavigate('galaxy')}
              className="inline-flex items-center gap-2 px-5 py-3.5 rounded-2xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-white font-semibold text-xs transition-all cursor-pointer"
            >
              <Orbit className="w-4 h-4 text-rose-400" />
              Explorer la Galaxie 3D
            </button>
          </div>
        </motion.div>

        {/* Right: Tactile Spinning Vinyl Showcase of #1 Artist & Track */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="lg:col-span-4 spatial-glass rounded-[2.2rem] p-6 flex flex-col items-center justify-between text-center relative overflow-hidden"
        >
          <div className="w-full flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-400 font-mono-num">
            <span>N°1 EN ROTATION</span>
            <Sparkles className="w-3.5 h-3.5 text-rose-400" />
          </div>

          <div
            onClick={() =>
              heroTrack?.preview_url &&
              playPreview({
                song_name: heroTrack.song_name,
                artist_name: heroTrack.artist_name,
                album_name: heroTrack.album_name,
                artwork_url: heroTrack.artwork_url,
                preview_url: heroTrack.preview_url,
              })
            }
            className="relative my-5 group cursor-pointer"
            title="Cliquer pour lancer l'extrait 30s"
          >
            <div className="w-44 h-44 rounded-full p-1 bg-gradient-to-tr from-rose-500/60 via-fuchsia-500/40 to-sky-400/60 shadow-2xl shadow-rose-500/20">
              <img
                src={heroArtist?.artwork_url || heroTrack?.artwork_url}
                alt={heroArtist?.artist_name || ''}
                className="w-full h-full rounded-full object-cover animate-vinyl"
              />
            </div>
            <div className="w-10 h-10 rounded-full bg-[#06060b] border-2 border-white/25 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Play className="w-3.5 h-3.5 text-white fill-current ml-0.5" />
            </div>
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() =>
                heroArtist && openDrawer({ type: 'artist', id: heroArtist.artist_group_key, title: heroArtist.artist_name })
              }
              className="text-xl font-extrabold text-white hover:text-rose-300 transition-colors cursor-pointer"
            >
              {heroArtist?.artist_name || '—'}
            </button>
            <p className="text-xs font-mono-num text-zinc-400">
              {formatDurationMs(heroArtist?.total_ms)} · {formatNumber(heroArtist?.plays)} écoutes
            </p>
          </div>
        </motion.div>
      </div>

      {/* Compact High-Contrast Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="spatial-card rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">Écoutes validées</p>
          <p className="text-2xl font-extrabold text-white mt-1">
            <AnimatedCounter value={kpis.plays} />
          </p>
          <p className="text-[11px] font-mono-num text-zinc-400 mt-1">
            Moy. {formatDurationMs(kpis.daily_avg_ms, true)} / jour
          </p>
        </div>

        <div className="spatial-card rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">Plus longue streak</p>
          <p className="text-2xl font-extrabold text-amber-300 mt-1 flex items-center gap-1.5">
            <Flame className="w-5 h-5" />
            <AnimatedCounter value={records.longest_streak?.days || 0} suffix=" j" />
          </p>
          <p className="text-[11px] text-zinc-500 mt-1 truncate">
            {records.longest_streak?.start ? formatDateFr(records.longest_streak.start) : '—'}
          </p>
        </div>

        {records.record_day && (
          <button
            type="button"
            onClick={() => openDrawer({ type: 'day', id: records.record_day.date })}
            className="spatial-card rounded-2xl p-4 text-left hover:border-rose-500/40 cursor-pointer"
          >
            <p className="text-[10px] uppercase tracking-widest text-rose-300 flex items-center justify-between">
              <span>Journée record</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </p>
            <p className="text-2xl font-extrabold font-mono-num text-white mt-1">
              {formatDurationMs(records.record_day.total_ms, true)}
            </p>
            <p className="text-[11px] text-zinc-400 mt-1">{formatDateFr(records.record_day.date)}</p>
          </button>
        )}

        <div className="spatial-card rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">Complétion moyenne</p>
          <p className="text-2xl font-extrabold font-mono-num text-emerald-400 mt-1">{kpis.avg_completion_pct}%</p>
          <p className="text-[11px] font-mono-num text-zinc-500 mt-1">Skips &lt;30s : {kpis.skip_rate_30s_pct}%</p>
        </div>
      </div>

      {/* Bento Tops Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="spatial-glass rounded-3xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Top Artistes</h2>
            <button type="button" onClick={() => onNavigate('tops')} className="text-xs text-rose-300 hover:text-white cursor-pointer">
              Tout voir →
            </button>
          </div>
          <div className="space-y-2.5">
            {top_artists.map((a: any) => (
              <div
                key={a.artist_group_key}
                onClick={() => openDrawer({ type: 'artist', id: a.artist_group_key, title: a.artist_name })}
                className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.06] cursor-pointer"
              >
                <span className="font-mono-num text-xs text-zinc-500 w-4">{a.rank}</span>
                <Artwork url={a.artwork_url} alt={a.artist_name} size="sm" rounded="full" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">{a.artist_name}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{a.primary_genre || `${a.unique_tracks} titres`}</p>
                </div>
                <span className="font-mono-num text-xs font-bold text-white">
                  {filters.metric === 'plays' ? `${a.plays}×` : formatDurationMs(a.total_ms, true)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="spatial-glass rounded-3xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Top Titres</h2>
            <button type="button" onClick={() => onNavigate('tops')} className="text-xs text-rose-300 hover:text-white cursor-pointer">
              Tout voir →
            </button>
          </div>
          <div className="space-y-2.5">
            {top_tracks.map((t: any) => (
              <div
                key={t.track_key}
                className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.06]"
              >
                <span className="font-mono-num text-xs text-zinc-500 w-4">{t.rank}</span>
                <Artwork
                  url={t.artwork_url}
                  alt={t.song_name}
                  size="sm"
                  previewUrl={t.preview_url}
                  songName={t.song_name}
                  artistName={t.artist_name}
                  albumName={t.album_name}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">{t.song_name}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{t.artist_name || t.album_name}</p>
                </div>
                <span className="font-mono-num text-xs font-bold text-white">
                  {filters.metric === 'plays' ? `${t.plays}×` : formatDurationMs(t.total_ms, true)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="spatial-glass rounded-3xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Top Albums</h2>
            <button type="button" onClick={() => onNavigate('tops')} className="text-xs text-rose-300 hover:text-white cursor-pointer">
              Tout voir →
            </button>
          </div>
          <div className="space-y-2.5">
            {top_albums.map((alb: any) => (
              <div
                key={alb.album_group_key}
                onClick={() => openDrawer({ type: 'album', id: alb.album_group_key, title: alb.album_name })}
                className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.06] cursor-pointer"
              >
                <span className="font-mono-num text-xs text-zinc-500 w-4">{alb.rank}</span>
                <Artwork url={alb.artwork_url} alt={alb.album_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">{alb.album_name}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{alb.artist_name || 'Compilation'}</p>
                </div>
                <span className="font-mono-num text-xs font-bold text-white">
                  {filters.metric === 'plays' ? `${alb.plays}×` : formatDurationMs(alb.total_ms, true)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Context Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="spatial-card rounded-2xl p-5">
          <h3 className="text-[11px] uppercase tracking-widest text-zinc-400 mb-3 flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 text-sky-400" /> Appareils
          </h3>
          <div className="space-y-2">
            {breakdowns.devices.slice(0, 5).map((d: any) => (
              <div key={d.label} className="flex justify-between text-xs">
                <span className="text-zinc-200 truncate">{d.label}</span>
                <span className="font-mono-num text-zinc-400">{formatDurationMs(d.total_ms, true)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="spatial-card rounded-2xl p-5">
          <h3 className="text-[11px] uppercase tracking-widest text-zinc-400 mb-3 flex items-center gap-2">
            <ListMusic className="w-3.5 h-3.5 text-rose-400" /> Playlists favorites
          </h3>
          <div className="space-y-2">
            {breakdowns.playlists.slice(0, 5).map((p: any) => (
              <div key={p.name} className="flex justify-between text-xs">
                <span className="text-zinc-200 truncate">{p.name}</span>
                <span className="font-mono-num text-zinc-400">{formatDurationMs(p.total_ms, true)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="spatial-card rounded-2xl p-5">
          <h3 className="text-[11px] uppercase tracking-widest text-zinc-400 mb-3 flex items-center gap-2">
            <Disc3 className="w-3.5 h-3.5 text-emerald-400" /> Genres majeurs
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {top_genres.map((g: any) => (
              <span key={g.genre} className="px-2.5 py-1 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-zinc-200">
                {g.genre} <span className="font-mono-num text-[10px] text-rose-300 ml-1">{g.share_pct}%</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
