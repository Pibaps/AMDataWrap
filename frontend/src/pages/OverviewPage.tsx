import { motion } from 'framer-motion'
import {
  Award,
  Calendar,
  Clock,
  Disc3,
  Flame,
  Headphones,
  ListMusic,
  Mic2,
  Music2,
  Play,
  Smartphone,
  Sparkles,
  WifiOff,
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
  const { filters, refreshKey, openDrawer, setAmbientFromArtwork } = useApp()
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
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-white/[0.04]" />
        ))}
      </div>
    )
  }

  if (!data) return null
  const { kpis, records, top_artists, top_tracks, top_albums, top_genres, breakdowns } = data

  return (
    <div className="space-y-6">
      {/* Hero Banner with Wrapped CTA */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden glass-panel rounded-3xl p-6 md:p-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6"
      >
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {kpis.min_date && kpis.max_date
                ? `${formatDateFr(kpis.min_date)} → ${formatDateFr(kpis.max_date)}`
                : 'Votre univers Apple Music'}
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            <AnimatedCounter value={kpis.total_hours} decimals={1} suffix=" heures" className="text-transparent bg-clip-text bg-gradient-to-r from-white via-rose-200 to-indigo-200" />{' '}
            de musique explorées.
          </h1>
          <p className="text-sm text-zinc-400">
            Soit <span className="text-zinc-200 font-mono-num font-semibold">{kpis.total_days} jours</span> non-stop répartis sur{' '}
            <span className="text-zinc-200 font-mono-num font-semibold">{formatNumber(kpis.active_days)}</span> jours actifs et{' '}
            <span className="text-zinc-200 font-mono-num font-semibold">{formatNumber(kpis.total_sessions)}</span> sessions d'écoute.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenWrapped}
          className="group relative inline-flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-rose-500 via-fuchsia-500 to-indigo-500 text-white font-semibold text-sm shadow-xl shadow-rose-500/25 hover:scale-[1.03] active:scale-[0.98] transition-all cursor-pointer shrink-0"
        >
          <Play className="w-4 h-4 fill-current" />
          Lancer mon Wrapped interactif
        </button>
      </motion.div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>Écoutes validées</span>
            <Headphones className="w-4 h-4 text-rose-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            <AnimatedCounter value={kpis.plays} />
          </p>
          <p className="text-[11px] text-zinc-500 mt-1 font-mono-num">
            Moy. {formatDurationMs(kpis.daily_avg_ms, true)} / jour actif
          </p>
        </div>

        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>Artistes uniques</span>
            <Mic2 className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            <AnimatedCounter value={kpis.unique_artists} />
          </p>
          <p className="text-[11px] text-zinc-500 mt-1 font-mono-num">
            {formatNumber(kpis.unique_albums)} albums · {formatNumber(kpis.unique_tracks)} titres
          </p>
        </div>

        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>Plus longue streak</span>
            <Flame className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            <AnimatedCounter value={records.longest_streak?.days || 0} suffix=" j" />
          </p>
          <p className="text-[11px] text-zinc-500 mt-1 truncate">
            {records.longest_streak?.start
              ? `${formatDateFr(records.longest_streak.start)} → ${formatDateFr(records.longest_streak.end)}`
              : '—'}
          </p>
        </div>

        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>Complétion & Skips</span>
            <Award className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400 font-mono-num">{kpis.avg_completion_pct}%</p>
          <p className="text-[11px] text-zinc-500 mt-1 font-mono-num">
            Skips &lt;30s : {kpis.skip_rate_30s_pct}% · Hors-ligne : {formatNumber(kpis.offline_plays)}
          </p>
        </div>
      </div>

      {/* Records Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {records.record_day && (
          <button
            type="button"
            onClick={() => openDrawer({ type: 'day', id: records.record_day.date })}
            className="glass-card rounded-2xl p-4 flex items-center justify-between text-left hover:border-rose-500/40 cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center shrink-0">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-rose-300 font-medium">Journée record</p>
                <p className="text-base font-bold text-white">{formatDateFr(records.record_day.date)}</p>
                {records.record_day.top_artist && (
                  <p className="text-xs text-zinc-400">Menée par {records.record_day.top_artist}</p>
                )}
              </div>
            </div>
            <div className="text-right font-mono-num">
              <p className="text-lg font-bold text-white">{formatDurationMs(records.record_day.total_ms, true)}</p>
              <p className="text-xs text-zinc-400">{records.record_day.plays} écoutes</p>
            </div>
          </button>
        )}

        {records.longest_session && (
          <button
            type="button"
            onClick={() => onNavigate('sessions')}
            className="glass-card rounded-2xl p-4 flex items-center justify-between text-left hover:border-indigo-500/40 cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-indigo-300 font-medium">Session la plus longue</p>
                <p className="text-base font-bold text-white">{formatDateFr(records.longest_session.start_local)}</p>
                <p className="text-xs text-zinc-400 font-mono-num">
                  {records.longest_session.start_local.slice(11, 16)} → {records.longest_session.end_local.slice(11, 16)}
                </p>
              </div>
            </div>
            <div className="text-right font-mono-num">
              <p className="text-lg font-bold text-white">{formatDurationMs(records.longest_session.total_ms, true)}</p>
              <p className="text-xs text-zinc-400">{records.longest_session.plays} titres d'affilée</p>
            </div>
          </button>
        )}
      </div>

      {/* Top 5 Artists, Tracks & Albums Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Artists */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Mic2 className="w-4 h-4 text-rose-400" />
              Top Artistes
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('tops')}
              className="text-xs text-zinc-400 hover:text-white cursor-pointer"
            >
              Voir tout →
            </button>
          </div>
          <div className="space-y-2.5">
            {top_artists.map((a: any) => (
              <div
                key={a.artist_group_key}
                onClick={() => openDrawer({ type: 'artist', id: a.artist_group_key, title: a.artist_name })}
                className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.05] transition-colors cursor-pointer"
              >
                <span className="font-mono-num text-xs text-zinc-500 w-4">{a.rank}</span>
                <Artwork url={a.artwork_url} alt={a.artist_name} size="sm" rounded="full" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{a.artist_name}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{a.primary_genre || `${a.unique_tracks} titres`}</p>
                </div>
                <div className="text-right font-mono-num shrink-0">
                  <p className="text-xs font-bold text-white">
                    {filters.metric === 'plays' ? `${a.plays}×` : formatDurationMs(a.total_ms, true)}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    {filters.metric === 'plays' ? formatDurationMs(a.total_ms, true) : `${a.plays}×`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Tracks */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Music2 className="w-4 h-4 text-fuchsia-400" />
              Top Titres
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('tops')}
              className="text-xs text-zinc-400 hover:text-white cursor-pointer"
            >
              Voir tout →
            </button>
          </div>
          <div className="space-y-2.5">
            {top_tracks.map((t: any) => (
              <div
                key={t.track_key}
                onClick={() =>
                  t.artist_group_key && openDrawer({ type: 'artist', id: t.artist_group_key, title: t.artist_name })
                }
                className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.05] transition-colors cursor-pointer"
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
                  <p className="text-sm font-semibold text-white truncate">{t.song_name}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{t.artist_name || t.album_name}</p>
                </div>
                <div className="text-right font-mono-num shrink-0">
                  <p className="text-xs font-bold text-white">
                    {filters.metric === 'plays' ? `${t.plays}×` : formatDurationMs(t.total_ms, true)}
                  </p>
                  <p className="text-[10px] text-zinc-500">{t.plays} écoutes</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Albums */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Disc3 className="w-4 h-4 text-indigo-400" />
              Top Albums
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('tops')}
              className="text-xs text-zinc-400 hover:text-white cursor-pointer"
            >
              Voir tout →
            </button>
          </div>
          <div className="space-y-2.5">
            {top_albums.map((alb: any) => (
              <div
                key={alb.album_group_key}
                onClick={() => openDrawer({ type: 'album', id: alb.album_group_key, title: alb.album_name })}
                className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.05] transition-colors cursor-pointer"
              >
                <span className="font-mono-num text-xs text-zinc-500 w-4">{alb.rank}</span>
                <Artwork url={alb.artwork_url} alt={alb.album_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{alb.album_name}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{alb.artist_name || 'Compilation'}</p>
                </div>
                <div className="text-right font-mono-num shrink-0">
                  <p className="text-xs font-bold text-white">
                    {filters.metric === 'plays' ? `${alb.plays}×` : formatDurationMs(alb.total_ms, true)}
                  </p>
                  <p className="text-[10px] text-zinc-500">{alb.release_year || ''}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Breakdowns: Devices, Playlists, Genres */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Devices */}
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-3.5 flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 text-sky-400" />
            Appareils d'écoute
          </h3>
          <div className="space-y-2.5">
            {breakdowns.devices.slice(0, 6).map((d: any) => {
              const maxVal = breakdowns.devices[0]?.total_ms || 1
              const pct = Math.round((d.total_ms / maxVal) * 100)
              return (
                <div key={d.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-200 truncate">{d.label}</span>
                    <span className="font-mono-num text-zinc-400">{formatDurationMs(d.total_ms, true)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top Playlists */}
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-3.5 flex items-center gap-2">
            <ListMusic className="w-3.5 h-3.5 text-rose-400" />
            Playlists les plus jouées
          </h3>
          <div className="space-y-2.5">
            {breakdowns.playlists.slice(0, 6).map((p: any) => {
              const maxVal = breakdowns.playlists[0]?.total_ms || 1
              const pct = Math.round((p.total_ms / maxVal) * 100)
              return (
                <div key={p.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-200 truncate">{p.name}</span>
                    <span className="font-mono-num text-zinc-400">{formatDurationMs(p.total_ms, true)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-fuchsia-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top Genres */}
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-3.5 flex items-center gap-2">
            <WifiOff className="w-3.5 h-3.5 text-emerald-400" />
            Top Genres & Qualité Audio
          </h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {top_genres.map((g: any) => (
              <span
                key={g.genre}
                className="px-2.5 py-1 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-zinc-200 flex items-center gap-1.5"
              >
                <span>{g.genre}</span>
                <span className="font-mono-num text-[10px] text-rose-300">{g.share_pct}%</span>
              </span>
            ))}
          </div>
          {breakdowns.audio_quality?.length > 0 && (
            <div className="pt-3 border-t border-white/[0.07] space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Qualité audio déclarée</p>
              {breakdowns.audio_quality.slice(0, 3).map((q: any) => (
                <div key={q.label} className="flex justify-between text-xs">
                  <span className="text-zinc-400">{q.label.replace(/_/g, ' ')}</span>
                  <span className="font-mono-num text-zinc-300">{formatNumber(q.plays)} écoutes</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
