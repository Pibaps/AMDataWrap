import { Flame, MessageSquareQuote, Repeat, Search, ShieldCheck, SkipForward } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api/client'
import { EChartBox } from '../components/charts/EChartBox'
import { Artwork } from '../components/ui/Artwork'
import { useApp } from '../store/AppContext'
import { formatDateFr, formatDurationMs, formatNumber } from '../utils/format'

export function BehaviorPage() {
  const { filters, refreshKey, openDrawer } = useApp()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet('/api/analytics/behavior', filters)
      .then((res) => !cancelled && setData(res))
      .catch(console.error)
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [filters, refreshKey])

  const endReasonOption = useMemo(() => {
    if (!data?.end_reasons?.length) return null
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(10,10,16,0.95)',
        borderColor: 'rgba(255,255,255,0.14)',
        textStyle: { color: '#fff', fontSize: 12 },
      },
      color: ['#10b981', '#fa2d48', '#6366f1', '#f59e0b', '#ec4899', '#38bdf8', '#a855f7', '#71717a'],
      series: [
        {
          type: 'pie',
          radius: ['48%', '76%'],
          center: ['50%', '50%'],
          itemStyle: { borderRadius: 6, borderColor: '#0c0c14', borderWidth: 2 },
          label: { show: false },
          data: data.end_reasons.map((e: any) => ({ name: e.label, value: e.count })),
        },
      ],
    }
  }, [data])

  if (loading && !data) return <div className="h-72 rounded-3xl bg-white/[0.04] animate-pulse" />
  if (!data) return null

  return (
    <div className="space-y-6">
      {/* 1. Radar d'Obsessions & Phases */}
      <div className="glass-panel rounded-3xl p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Flame className="w-4 h-4 text-rose-400" />
              Radar d'Obsessions & Phases musicales
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Fenêtres de 14 jours où un artiste explose sa part habituelle d'écoutes
            </p>
          </div>
          <span className="text-xs font-mono-num text-zinc-400">{data.phases.length} phases détectées</span>
        </div>

        {data.phases.length === 0 ? (
          <p className="text-xs text-zinc-500">Aucune phase marquée sur cette sélection filtrée.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {data.phases.map((ph: any) => (
              <div
                key={`${ph.artist_group_key}-${ph.start_date}`}
                onClick={() => openDrawer({ type: 'artist', id: ph.artist_group_key, title: ph.artist_name })}
                className="glass-card rounded-2xl p-4 hover:border-rose-500/40 cursor-pointer flex flex-col justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <Artwork url={ph.artwork_url} alt={ph.artist_name} size="md" rounded="full" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white truncate">{ph.artist_name}</p>
                    <p className="text-[11px] text-zinc-400">
                      {formatDateFr(ph.start_date)} → {formatDateFr(ph.end_date)}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 text-[11px] font-mono-num font-bold shrink-0">
                    ×{ph.lift}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs font-mono-num pt-2 border-t border-white/[0.06]">
                  <span className="text-white font-semibold">{ph.window_share_pct}% de vos écoutes</span>
                  <span className="text-zinc-400">
                    {ph.plays}× · {formatDurationMs(ph.total_ms, true)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Écoutes en boucle + End Reasons */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Loops */}
        <div className="lg:col-span-3 glass-panel rounded-3xl p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Repeat className="w-4 h-4 text-fuchsia-400" />
                Écoutes en boucle
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {formatNumber(data.loops.total_consecutive_repeats)} répétitions consécutives détectées
              </p>
            </div>
            {data.loops.record_loop && (
              <span className="px-3 py-1 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-300 text-xs font-mono-num font-bold">
                Record : {data.loops.record_loop.max_consecutive}× d'affilée
              </span>
            )}
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {data.loops.top_looped.map((t: any, i: number) => (
              <div
                key={t.track_key}
                className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.025] hover:bg-white/[0.06] transition-colors"
              >
                <span className="font-mono-num text-xs text-zinc-500 w-5 text-right">{i + 1}</span>
                <Artwork
                  url={t.artwork_url}
                  alt={t.song_name}
                  size="xs"
                  previewUrl={t.preview_url}
                  songName={t.song_name}
                  artistName={t.artist_name}
                  albumName={t.album_name}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">{t.song_name}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{t.artist_name || t.album_name}</p>
                </div>
                <div className="text-right font-mono-num shrink-0">
                  <p className="text-xs font-bold text-fuchsia-300">{t.max_consecutive}× d'affilée</p>
                  <p className="text-[10px] text-zinc-500">{t.loop_repeats} boucles · {formatDateFr(t.peak_date)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* End Reason Breakdown */}
        <div className="lg:col-span-2 glass-panel rounded-3xl p-5 md:p-6">
          <h2 className="text-base font-bold text-white flex items-center gap-2 mb-1">
            <SkipForward className="w-4 h-4 text-rose-400" />
            Raisons de fin de lecture
          </h2>
          <p className="text-xs text-zinc-400 mb-2">Sur l'ensemble des lectures brutes de la période</p>
          {endReasonOption && <EChartBox option={endReasonOption} height={190} />}
          <div className="mt-2 space-y-1.5">
            {data.end_reasons.slice(0, 6).map((e: any) => (
              <div key={e.code} className="flex items-center justify-between text-xs">
                <span className="text-zinc-300 truncate">{e.label}</span>
                <span className="font-mono-num text-zinc-400">
                  {e.share_pct}% <span className="text-zinc-600">({formatNumber(e.count)})</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Intouchables vs Mal-Aimés */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="glass-panel rounded-3xl p-5 md:p-6">
          <h2 className="text-base font-bold text-white flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Les Intouchables
          </h2>
          <p className="text-xs text-zinc-400 mb-4">Titres ≥ 8 écoutes au taux de skip le plus bas</p>
          <div className="space-y-2">
            {data.untouchables.slice(0, 10).map((t: any) => (
              <div key={t.track_key} className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.025]">
                <Artwork
                  url={t.artwork_url}
                  alt={t.song_name}
                  size="xs"
                  previewUrl={t.preview_url}
                  songName={t.song_name}
                  artistName={t.artist_name}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">{t.song_name}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{t.artist_name || t.album_name}</p>
                </div>
                <div className="text-right font-mono-num shrink-0">
                  <p className="text-xs font-bold text-emerald-400">{t.skip_rate_pct}% skip</p>
                  <p className="text-[10px] text-zinc-500">
                    {t.raw_plays}× · {t.avg_completion_pct}% compl.
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-3xl p-5 md:p-6">
          <h2 className="text-base font-bold text-white flex items-center gap-2 mb-1">
            <SkipForward className="w-4 h-4 text-rose-400" />
            Les Mal-Aimés / Faux départs
          </h2>
          <p className="text-xs text-zinc-400 mb-4">Titres les plus souvent skippés avant 30 secondes</p>
          <div className="space-y-2">
            {data.most_skipped.slice(0, 10).map((t: any) => (
              <div key={t.track_key} className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.025]">
                <Artwork
                  url={t.artwork_url}
                  alt={t.song_name}
                  size="xs"
                  previewUrl={t.preview_url}
                  songName={t.song_name}
                  artistName={t.artist_name}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">{t.song_name}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{t.artist_name || t.album_name}</p>
                </div>
                <div className="text-right font-mono-num shrink-0">
                  <p className="text-xs font-bold text-rose-400">{t.skips_30s} skips</p>
                  <p className="text-[10px] text-zinc-500">
                    {t.skip_rate_pct}% sur {t.raw_plays}×
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Lyrics Analysis + Search History Bonus */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Lyrics */}
        <div className="glass-panel rounded-3xl p-5 md:p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <MessageSquareQuote className="w-4 h-4 text-sky-400" />
                Affichage des Paroles
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {formatNumber(data.lyrics.total_views)} affichages (LYRIC_DISPLAY)
              </p>
            </div>
            <div className="flex gap-1.5">
              {data.lyrics.languages.slice(0, 3).map((l: any) => (
                <span key={l.lang} className="px-2 py-0.5 rounded-lg bg-sky-500/15 text-sky-300 text-[10px] font-mono-num uppercase">
                  {l.lang} ({l.count})
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {data.lyrics.top_tracks.map((t: any, i: number) => (
              <div key={t.track_key} className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.025]">
                <span className="font-mono-num text-xs text-zinc-500 w-5 text-right">{i + 1}</span>
                <Artwork
                  url={t.artwork_url}
                  alt={t.song_name}
                  size="xs"
                  previewUrl={t.preview_url}
                  songName={t.song_name}
                  artistName={t.artist_name}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">{t.song_name}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{t.artist_name || t.album_name}</p>
                </div>
                <span className="font-mono-num text-xs font-bold text-sky-300 shrink-0">
                  {t.lyric_views}×
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Search History Bonus */}
        <div className="glass-panel rounded-3xl p-5 md:p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Search className="w-4 h-4 text-amber-400" />
                Top Recherches Apple Music
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {formatNumber(data.searches.total_searches)} recherches réelles (autocomplétion dédupliquée)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {data.searches.top_queries.slice(0, 16).map((q: any) => (
              <span
                key={q.query}
                className="px-3 py-1.5 rounded-xl bg-white/[0.045] border border-white/10 text-xs text-zinc-200 flex items-center gap-2"
              >
                <span>{q.query}</span>
                <span className="font-mono-num text-[10px] text-amber-300 font-bold">{q.count}×</span>
              </span>
            ))}
          </div>

          {data.searches.recent.length > 0 && (
            <div className="pt-3 border-t border-white/[0.07]">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Recherches récentes</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {data.searches.recent.slice(0, 12).map((s: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300 truncate">{s.query}</span>
                    <span className="font-mono-num text-[10px] text-zinc-500 shrink-0 ml-2">
                      {formatDateFr(s.local_date)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
