import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, Calendar, Clock, Disc3, ExternalLink, Flame, Loader2, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiGet, fetchArtistBio } from '../../api/client'
import { useApp } from '../../store/AppContext'
import { formatDateFr, formatDurationMs, formatMonthFr, formatNumber } from '../../utils/format'
import { EChartBox } from '../charts/EChartBox'
import { Artwork } from '../ui/Artwork'

export function DetailDrawer() {
  const { drawer, closeDrawer, openDrawer, filters, refreshKey, setAmbientFromArtwork } = useApp()
  const [data, setData] = useState<any>(null)
  const [bio, setBio] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!drawer) {
      setData(null)
      setBio(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setBio(null)
    const endpoint =
      drawer.type === 'artist'
        ? `/api/detail/artist/${encodeURIComponent(drawer.id)}`
        : drawer.type === 'album'
        ? `/api/detail/album/${encodeURIComponent(drawer.id)}`
        : `/api/detail/day/${encodeURIComponent(drawer.id)}`

    apiGet(endpoint, filters)
      .then((res) => {
        if (cancelled) return
        setData(res)
        const art = res?.summary?.artwork_url || res?.top_tracks?.[0]?.artwork_url || res?.tracks?.[0]?.artwork_url
        if (art) setAmbientFromArtwork(art)
        if (drawer.type === 'artist' && res?.summary?.artist_name) {
          fetchArtistBio(res.summary.artist_name)
            .then((b) => !cancelled && setBio(b))
            .catch(() => {})
        }
      })
      .catch(console.error)
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [drawer, filters, refreshKey, setAmbientFromArtwork])

  const monthlyOption = data?.monthly?.length
    ? {
        backgroundColor: 'transparent',
        grid: { left: 10, right: 12, top: 14, bottom: 24, containLabel: true },
        tooltip: {
          trigger: 'axis',
          backgroundColor: 'rgba(10,10,16,0.95)',
          borderColor: 'rgba(255,255,255,0.14)',
          textStyle: { color: '#fff', fontSize: 12 },
        },
        xAxis: {
          type: 'category',
          data: data.monthly.map((m: any) => formatMonthFr(m.month)),
          axisLabel: { color: '#9ca3af', fontSize: 10 },
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: '#71717a', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        },
        series: [
          {
            name: filters.metric === 'plays' ? 'Écoutes' : 'Minutes',
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { width: 2.5, color: '#ff2a5f' },
            itemStyle: { color: '#ff2a5f' },
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(255,42,95,0.38)' },
                  { offset: 1, color: 'rgba(255,42,95,0.01)' },
                ],
              },
            },
            data: data.monthly.map((m: any) =>
              filters.metric === 'plays' ? m.plays : Math.round(m.total_ms / 60000)
            ),
          },
        ],
      }
    : null

  return (
    <AnimatePresence>
      {drawer && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeDrawer}
            className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-xl bg-[#08080e]/95 backdrop-blur-2xl border-l border-white/12 shadow-2xl overflow-y-auto"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-[#08080e]/85 backdrop-blur-xl border-b border-white/[0.07]">
              <span className="text-xs uppercase tracking-[0.2em] text-rose-400 font-semibold font-mono-num">
                {drawer.type === 'artist' ? 'Profil Artiste' : drawer.type === 'album' ? 'Détail Album' : 'Journal du jour'}
              </span>
              <button
                type="button"
                onClick={closeDrawer}
                className="p-1.5 rounded-xl bg-white/[0.06] hover:bg-white/15 text-zinc-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loading || !data ? (
              <div className="h-64 flex items-center justify-center text-zinc-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-rose-400" />
                <span className="text-sm">Chargement…</span>
              </div>
            ) : drawer.type === 'day' ? (
              <div className="p-6 space-y-5">
                <div>
                  <h2 className="text-2xl font-bold text-white">{formatDateFr(data.date)}</h2>
                  <div className="mt-2 flex items-center gap-4 text-sm text-zinc-400 font-mono-num">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-rose-400" />
                      {formatDurationMs(data.total_ms)}
                    </span>
                    <span>{formatNumber(data.plays)} écoutes</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {data.events.map((ev: any) => (
                    <div
                      key={ev.id}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:border-white/15"
                    >
                      <span className="font-mono-num text-[11px] text-zinc-500 w-11 shrink-0">
                        {ev.started_at_local.slice(11, 16)}
                      </span>
                      <Artwork
                        url={ev.artwork_url}
                        alt={ev.song_name}
                        size="xs"
                        previewUrl={ev.preview_url}
                        songName={ev.song_name}
                        artistName={ev.artist_name}
                        albumName={ev.album_name}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white truncate">{ev.song_name}</p>
                        <p className="text-[11px] text-zinc-400 truncate">
                          {ev.artist_name || 'Inconnu'} · {ev.album_name}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-mono-num text-zinc-300">{formatDurationMs(ev.play_duration_ms, true)}</p>
                        <p className="text-[10px] font-mono-num text-zinc-500">{Math.round(ev.completion_ratio * 100)}%</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-6">
                <div className="flex items-center gap-4">
                  <Artwork
                    url={data.summary?.artwork_url || data.top_tracks?.[0]?.artwork_url || data.tracks?.[0]?.artwork_url}
                    alt={data.summary?.artist_name || data.summary?.album_name || ''}
                    size="xl"
                    rounded={drawer.type === 'artist' ? 'full' : 'xl'}
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-2xl font-extrabold text-white leading-tight">
                      {drawer.type === 'artist' ? data.summary?.artist_name : data.summary?.album_name}
                    </h2>
                    {bio?.found && bio.description && (
                      <p className="font-editorial text-lg text-rose-300 mt-0.5">{bio.description}</p>
                    )}
                    {drawer.type === 'album' && data.summary?.artist_name && (
                      <button
                        type="button"
                        onClick={() =>
                          data.summary?.artist_group_key &&
                          openDrawer({ type: 'artist', id: data.summary.artist_group_key, title: data.summary.artist_name })
                        }
                        className="text-sm text-rose-400 hover:underline mt-0.5 cursor-pointer"
                      >
                        {data.summary.artist_name}
                      </button>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-400">
                      {data.summary?.genre && (
                        <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10">
                          {data.summary.genre}
                        </span>
                      )}
                      {data.summary?.release_year && (
                        <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 font-mono-num">
                          {data.summary.release_year}
                        </span>
                      )}
                      {data.summary?.first_discovered && (
                        <span className="flex items-center gap-1 text-zinc-400">
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDateFr(data.summary.first_discovered)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Live Wikipedia Bio Card */}
                {bio?.found && bio.summary && (
                  <div className="spatial-card rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-widest text-sky-300 font-semibold flex items-center gap-1.5">
                        <BookOpen className="w-3 h-3" />
                        Biographie · Wikipédia ({bio.lang?.toUpperCase()})
                      </span>
                      {bio.url && (
                        <a
                          href={bio.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1"
                        >
                          Article <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-zinc-300 leading-relaxed">{bio.summary}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="spatial-card rounded-xl p-3">
                    <p className="text-[10px] uppercase text-zinc-500">Temps total</p>
                    <p className="text-lg font-bold font-mono-num text-white mt-0.5">
                      {formatDurationMs(data.summary?.total_ms, true)}
                    </p>
                  </div>
                  <div className="spatial-card rounded-xl p-3">
                    <p className="text-[10px] uppercase text-zinc-500">Écoutes</p>
                    <p className="text-lg font-bold font-mono-num text-white mt-0.5">
                      {formatNumber(data.summary?.plays)}
                    </p>
                  </div>
                  <div className="spatial-card rounded-xl p-3">
                    <p className="text-[10px] uppercase text-zinc-500">Complétion</p>
                    <p className="text-lg font-bold font-mono-num text-emerald-400 mt-0.5">
                      {data.summary?.avg_completion_pct}%
                    </p>
                  </div>
                  <div className="spatial-card rounded-xl p-3">
                    <p className="text-[10px] uppercase text-zinc-500">Skip</p>
                    <p className="text-lg font-bold font-mono-num text-rose-400 mt-0.5">
                      {data.summary?.skip_rate_pct}%
                    </p>
                  </div>
                </div>

                {data.best_day && (
                  <button
                    type="button"
                    onClick={() => openDrawer({ type: 'day', id: data.best_day.date })}
                    className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-rose-500/15 via-fuchsia-500/10 to-transparent border border-rose-500/25 hover:border-rose-400/50 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <Flame className="w-5 h-5 text-rose-400" />
                      <div>
                        <p className="text-xs text-rose-300 font-medium">Meilleure journée avec cet artiste</p>
                        <p className="text-sm font-bold text-white">{formatDateFr(data.best_day.date)}</p>
                      </div>
                    </div>
                    <div className="text-right font-mono-num">
                      <p className="text-sm font-bold text-white">{formatDurationMs(data.best_day.total_ms, true)}</p>
                      <p className="text-xs text-zinc-400">{data.best_day.plays} écoutes</p>
                    </div>
                  </button>
                )}

                {monthlyOption && (
                  <div className="spatial-card rounded-2xl p-4">
                    <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                      Évolution dans le temps
                    </h3>
                    <EChartBox option={monthlyOption} height={180} />
                  </div>
                )}

                {drawer.type === 'artist' && data.top_albums?.length > 0 && (
                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center gap-1.5">
                      <Disc3 className="w-3.5 h-3.5 text-indigo-400" />
                      Albums les plus écoutés
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {data.top_albums.slice(0, 6).map((alb: any) => (
                        <button
                          key={alb.album_group_key}
                          type="button"
                          onClick={() =>
                            openDrawer({ type: 'album', id: alb.album_group_key, title: alb.album_name })
                          }
                          className="flex items-center gap-2.5 p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-left cursor-pointer"
                        >
                          <Artwork url={alb.artwork_url} alt={alb.album_name} size="xs" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-white truncate">{alb.album_name}</p>
                            <p className="text-[11px] font-mono-num text-zinc-400">
                              {formatDurationMs(alb.total_ms, true)} · {alb.plays}×
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2.5">
                    {drawer.type === 'artist' ? 'Titres les plus écoutés' : 'Pistes de l’album'}
                  </h3>
                  <div className="space-y-1.5">
                    {(data.top_tracks || data.tracks || []).map((t: any, i: number) => (
                      <div
                        key={t.track_key}
                        className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.025] hover:bg-white/[0.06]"
                      >
                        <span className="font-mono-num text-xs text-zinc-500 w-5 text-right">{i + 1}</span>
                        <Artwork
                          url={t.artwork_url}
                          alt={t.song_name}
                          size="xs"
                          previewUrl={t.preview_url}
                          songName={t.song_name}
                          artistName={t.artist_name || data.summary?.artist_name}
                          albumName={t.album_name || data.summary?.album_name}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-white truncate">{t.song_name}</p>
                          <p className="text-[11px] text-zinc-500 truncate">{t.album_name || ''}</p>
                        </div>
                        <div className="text-right font-mono-num shrink-0">
                          <p className="text-xs font-semibold text-zinc-200">{formatDurationMs(t.total_ms, true)}</p>
                          <p className="text-[10px] text-zinc-500">
                            {t.plays}× · {t.avg_completion_pct}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
