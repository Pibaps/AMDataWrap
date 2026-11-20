import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Calendar, Flame, Headphones, Play, Sparkles, TrendingUp } from 'lucide-react'
import { apiGet, type FilterState } from '../api/client'
import { reactiveAudio } from '../audio/reactiveAudio'
import { EChartCanvas } from '../components/EChartCanvas'
import type { ThemePolarity, VisualEdition } from '../hooks/useUrlFilters'
import { usePlayerStore } from '../store/playerStore'
import { artworkProxyUrl, calcApcaLc, formatHours, formatNumber } from '../utils/apca'

interface StudioOverviewPageProps {
  filters: FilterState
  edition: VisualEdition
  theme: ThemePolarity
}

export function StudioOverviewPage({ filters, edition, theme }: StudioOverviewPageProps) {
  const openDrawer = usePlayerStore((s) => s.openDrawer)

  const { data, isFetching } = useQuery({
    queryKey: ['overview', filters],
    queryFn: () => apiGet('/api/analytics/overview', filters),
    placeholderData: keepPreviousData,
  })

  const { data: science } = useQuery({
    queryKey: ['science-mini', filters],
    queryFn: () => apiGet('/api/v3/analytics/science', filters),
    placeholderData: keepPreviousData,
  })

  const kpis = data?.kpis
  const totalHours = ((kpis?.total_ms || 0) / 3_600_000).toFixed(1)
  const tapeDigits = String(Math.floor((kpis?.total_ms || 0) / 60_000)).padStart(6, '0')
  const apcaScore = Math.abs(calcApcaLc(theme === 'dark' ? '#e0e0e0' : '#1c1c20', theme === 'dark' ? '#121214' : '#f3f0e8'))

  const genreChartOption = {
    grid: { left: 100, right: 20, top: 8, bottom: 20 },
    xAxis: { type: 'value' },
    yAxis: {
      type: 'category',
      inverse: true,
      data: (data?.top_genres || []).slice(0, 7).map((g: any) => g.genre),
    },
    series: [
      {
        type: 'bar',
        id: 'overview-genres',
        universalTransition: { enabled: true },
        data: (data?.top_genres || []).slice(0, 7).map((g: any) =>
          filters.metric === 'plays' ? g.plays : Number(((g.total_ms || 0) / 3_600_000).toFixed(2))
        ),
        itemStyle: { color: edition === 'field' ? '#d46d3d' : '#689cd2', borderRadius: [0, 4, 4, 0] },
      },
    ],
  }

  return (
    <div className={`space-y-5 transition-opacity duration-200 ${isFetching ? 'opacity-85' : 'opacity-100'}`}>
      {/* Hero Banner adapting to the 3 Visual Editions */}
      <div className="surface-card grid gap-5 p-5 lg:grid-cols-12">
        <div className="flex flex-col justify-between lg:col-span-7">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 font-mono-tab text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              <span className="field-led bg-[var(--accent)]" />
              <span>
                {edition === 'field'
                  ? 'BRAUN ATELIER × OP-1 FIELD · COMPTEUR À BANDE'
                  : edition === 'editorial'
                    ? 'ATLAS ÉDITORIAL · ESSAI ANALYTIQUE'
                    : 'OBSERVATOIRE 3D · SYNTHÈSE HARMONIQUE'}
              </span>
              <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-1.5 py-0.5 text-[10px]">
                APCA Lc {apcaScore}
              </span>
            </div>

            {edition === 'editorial' ? (
              <h1 className="font-serif-ed text-4xl leading-tight text-[var(--text-strong)] sm:text-5xl">
                <span className="italic text-[var(--accent)]">{totalHours} heures</span> de musique,{' '}
                {formatNumber(kpis?.total_plays)} écoutes validées.
              </h1>
            ) : (
              <div className="flex flex-wrap items-baseline gap-4">
                <h1 className="font-display text-4xl font-bold tracking-tight text-[var(--text-strong)] sm:text-5xl">
                  {totalHours} <span className="text-xl font-normal text-[var(--text-secondary)]">heures</span>
                </h1>
                {edition === 'field' && (
                  <div className="flex items-center gap-1 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 py-1 font-mono-tab text-sm tracking-[0.2em] text-[var(--enc-orange)]">
                    {tapeDigits} <span className="text-[10px] tracking-normal text-[var(--text-muted)]">MIN</span>
                  </div>
                )}
              </div>
            )}

            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[var(--text-secondary)]">
              {kpis?.min_date && kpis?.max_date
                ? `Fenêtre active du ${kpis.min_date} au ${kpis.max_date} · ${formatNumber(kpis.unique_artists)} artistes uniques · ${formatNumber(kpis.unique_tracks)} titres · ${formatNumber(kpis.sessions_count)} sessions reconstituées.`
                : 'Chargez votre archive Apple Music ou connectez ListenBrainz dans le Hub Continuum.'}
            </p>
          </div>

          {/* 4 Rigorous V3 Micro-Badges */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="surface-card-2 p-2.5">
              <div className="font-mono-tab text-[10px] text-[var(--text-muted)]">EDDINGTON E</div>
              <div className="font-mono-tab text-lg font-bold text-[var(--text-strong)]">
                {science?.eddington?.eddington ?? '—'}
              </div>
            </div>
            <div className="surface-card-2 p-2.5">
              <div className="font-mono-tab text-[10px] text-[var(--text-muted)]">NOYAU D_EFF</div>
              <div className="font-mono-tab text-lg font-bold text-[var(--text-strong)]">
                {science?.gini_artists?.effective_core ?? '—'}
              </div>
            </div>
            <div className="surface-card-2 p-2.5">
              <div className="font-mono-tab text-[10px] text-[var(--text-muted)]">ENTROPIE H</div>
              <div className="font-mono-tab text-lg font-bold text-[var(--text-strong)]">
                {science?.shannon_entropy ? `${science.shannon_entropy.bits.toFixed(2)} b` : '—'}
              </div>
            </div>
            <div className="surface-card-2 p-2.5">
              <div className="font-mono-tab text-[10px] text-[var(--text-muted)]">STREAK MAX</div>
              <div className="font-mono-tab text-lg font-bold text-[var(--text-strong)]">
                {kpis?.longest_streak_days ?? 0} j
              </div>
            </div>
          </div>
        </div>

        {/* #1 Track / Artist Spotlight Card */}
        <div className="surface-card-2 flex flex-col justify-between p-4 lg:col-span-5">
          {data?.top_tracks?.[0] ? (
            <>
              <div className="flex items-center justify-between">
                <span className="font-mono-tab text-[10px] uppercase tracking-wider text-[var(--accent)]">
                  #1 EN ROTATION
                </span>
                <span className="font-mono-tab text-[11px] text-[var(--text-secondary)]">
                  {data.top_tracks[0].plays} écoutes · {formatHours(data.top_tracks[0].total_ms)}
                </span>
              </div>
              <div className="my-3 flex items-center gap-4">
                {artworkProxyUrl(data.top_tracks[0].artwork_url) ? (
                  <img
                    src={artworkProxyUrl(data.top_tracks[0].artwork_url)!}
                    alt={data.top_tracks[0].song_name}
                    className="h-20 w-20 rounded-lg border border-[var(--border-strong)] object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface-1)] font-mono-tab text-lg font-bold text-[var(--accent)]">
                    #1
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-lg font-bold text-[var(--text-strong)]">
                    {data.top_tracks[0].song_name}
                  </div>
                  <button
                    onClick={() => openDrawer({ type: 'artist', key: data.top_tracks[0].artist_key, label: data.top_tracks[0].artist_name })}
                    className="truncate text-xs text-[var(--accent)] hover:underline"
                  >
                    {data.top_tracks[0].artist_name}
                  </button>
                  <div className="truncate text-[11px] text-[var(--text-secondary)]">{data.top_tracks[0].album_name}</div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                {data.top_tracks[0].preview_url ? (
                  <button
                    onClick={() => reactiveAudio.play(data.top_tracks[0])}
                    className="flex items-center gap-1.5 rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-semibold text-white"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    <Play className="h-3.5 w-3.5" /> Écouter 30s + FFT
                  </button>
                ) : (
                  <span className="font-mono-tab text-[11px] text-[var(--text-muted)]">Extrait 30s après Passe 2</span>
                )}
                {kpis?.record_day && (
                  <button
                    onClick={() => openDrawer({ type: 'day', key: kpis.record_day.date })}
                    className="tactile-btn flex items-center gap-1 px-2.5 py-1.5 font-mono-tab text-[11px]"
                  >
                    <Calendar className="h-3 w-3 text-[var(--accent)]" />
                    Record : {kpis.record_day.date}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-xs text-[var(--text-secondary)]">Chargement du classement...</div>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="surface-card p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <Headphones className="h-3.5 w-3.5 text-[var(--enc-blue)]" /> Moyenne / jour actif
          </div>
          <div className="mt-1 font-mono-tab text-xl font-bold text-[var(--text-strong)]">
            {kpis ? `${Math.round((kpis.avg_daily_ms || 0) / 60_000)} min` : '—'}
          </div>
        </div>
        <div className="surface-card p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <TrendingUp className="h-3.5 w-3.5 text-[var(--accent-ok)]" /> Complétion moyenne
          </div>
          <div className="mt-1 font-mono-tab text-xl font-bold text-[var(--text-strong)]">
            {kpis ? `${Math.round((kpis.avg_completion || 0) * 100)} %` : '—'}
          </div>
        </div>
        <div className="surface-card p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <Flame className="h-3.5 w-3.5 text-[var(--enc-orange)]" /> Taux de skip &lt;30s
          </div>
          <div className="mt-1 font-mono-tab text-xl font-bold text-[var(--text-strong)]">
            {kpis ? `${(kpis.skip_rate_pct || 0).toFixed(1)} %` : '—'}
          </div>
        </div>
        <div className="surface-card p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--enc-ochre)]" /> Paroles / Recherches
          </div>
          <div className="mt-1 font-mono-tab text-xl font-bold text-[var(--text-strong)]">
            {formatNumber(kpis?.lyric_displays)} / {formatNumber(kpis?.searches_count)}
          </div>
        </div>
      </div>

      {/* Bento Grid: Top Artists, Top Tracks, Top Albums, Genres Chart */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Top 5 Artists */}
        <div className="surface-card p-4">
          <h2 className="mb-3 font-mono-tab text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Top 5 Artistes
          </h2>
          <div className="space-y-2">
            {(data?.top_artists || []).slice(0, 5).map((a: any, i: number) => (
              <button
                key={a.artist_key}
                onClick={() => openDrawer({ type: 'artist', key: a.artist_key, label: a.artist_name })}
                className="flex w-full items-center justify-between gap-2 rounded-lg p-2 text-left hover:bg-[var(--bg-surface-2)]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="w-5 font-mono-tab text-xs text-[var(--text-muted)]">0{i + 1}</span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-[var(--text-strong)]">{a.artist_name}</div>
                    <div className="truncate text-[11px] text-[var(--text-secondary)]">{a.genre || '—'}</div>
                  </div>
                </div>
                <span className="shrink-0 font-mono-tab text-xs text-[var(--text-primary)]">
                  {filters.metric === 'plays' ? `${a.plays} éc.` : formatHours(a.total_ms)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Top 5 Tracks */}
        <div className="surface-card p-4">
          <h2 className="mb-3 font-mono-tab text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Top 5 Titres
          </h2>
          <div className="space-y-2">
            {(data?.top_tracks || []).slice(0, 5).map((t: any, i: number) => (
              <div
                key={t.track_key}
                className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-[var(--bg-surface-2)]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="w-5 font-mono-tab text-xs text-[var(--text-muted)]">0{i + 1}</span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-[var(--text-strong)]">{t.song_name}</div>
                    <div className="truncate text-[11px] text-[var(--text-secondary)]">{t.artist_name}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono-tab text-xs text-[var(--text-primary)]">
                    {filters.metric === 'plays' ? `${t.plays}` : formatHours(t.total_ms)}
                  </span>
                  {t.preview_url && (
                    <button onClick={() => reactiveAudio.play(t)} className="tactile-btn p-1 text-[var(--accent)]">
                      <Play className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Genres Bar Chart (ECharts Canvas universalTransition) */}
        <div className="surface-card p-4">
          <h2 className="mb-2 font-mono-tab text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Genres majeurs
          </h2>
          <EChartCanvas theme={theme} height={225} option={genreChartOption} />
        </div>
      </div>

      {/* Devices & Top Albums */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface-card p-4">
          <h2 className="mb-3 font-mono-tab text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Top 5 Albums
          </h2>
          <div className="space-y-1.5">
            {(data?.top_albums || []).slice(0, 5).map((al: any, i: number) => (
              <button
                key={al.album_key}
                onClick={() => openDrawer({ type: 'album', key: al.album_key, label: al.album_name })}
                className="flex w-full items-center justify-between gap-2 rounded-lg p-2 text-left hover:bg-[var(--bg-surface-2)]"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-[var(--text-strong)]">
                    {i + 1}. {al.album_name}
                  </div>
                  <div className="truncate text-[11px] text-[var(--text-secondary)]">{al.artist_name}</div>
                </div>
                <span className="shrink-0 font-mono-tab text-xs text-[var(--text-primary)]">
                  {formatHours(al.total_ms)} · {al.plays}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="surface-card p-4">
          <h2 className="mb-3 font-mono-tab text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Appareils détectés
          </h2>
          <div className="space-y-2.5">
            {(data?.devices || []).slice(0, 6).map((d: any) => {
              const pct = Math.min(100, Math.round(((d.total_ms || 0) / Math.max(kpis?.total_ms || 1, 1)) * 100))
              return (
                <div key={d.device}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium text-[var(--text-strong)]">{d.device}</span>
                    <span className="font-mono-tab text-[var(--text-secondary)]">
                      {formatHours(d.total_ms)} ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-surface-3)]">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--accent)' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
