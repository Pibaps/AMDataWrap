import { useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Download, Play, Search } from 'lucide-react'
import { apiGet, buildFilterSearchParams, type FilterState } from '../api/client'
import { reactiveAudio } from '../audio/reactiveAudio'
import { EChartCanvas } from '../components/EChartCanvas'
import type { ThemePolarity } from '../hooks/useUrlFilters'
import { usePlayerStore } from '../store/playerStore'
import { formatDurationMs, formatHours } from '../utils/apca'

interface AnalyticsCorePageProps {
  filters: FilterState
  theme: ThemePolarity
}

type CoreTab = 'tops' | 'chrono' | 'persona' | 'behavior' | 'history'

export function AnalyticsCorePage({ filters, theme }: AnalyticsCorePageProps) {
  const [sub, setSub] = useState<CoreTab>('tops')
  const [topKind, setTopKind] = useState<'artists' | 'albums' | 'tracks'>('artists')
  const [histSearch, setHistSearch] = useState('')
  const openDrawer = usePlayerStore((s) => s.openDrawer)

  const { data: topsData } = useQuery({
    queryKey: ['core-tops', topKind, filters],
    queryFn: () => apiGet(`/api/analytics/tops/${topKind}`, filters, { limit: 100 }),
    enabled: sub === 'tops',
    placeholderData: keepPreviousData,
  })

  const { data: chronoData } = useQuery({
    queryKey: ['core-chrono', filters],
    queryFn: () => apiGet('/api/analytics/chronobiology', filters),
    enabled: sub === 'chrono',
    placeholderData: keepPreviousData,
  })

  const { data: personaData } = useQuery({
    queryKey: ['core-persona', filters],
    queryFn: () => apiGet('/api/analytics/persona', filters),
    enabled: sub === 'persona',
    placeholderData: keepPreviousData,
  })

  const { data: behaviorData } = useQuery({
    queryKey: ['core-behavior', filters],
    queryFn: () => apiGet('/api/analytics/behavior', filters),
    enabled: sub === 'behavior',
    placeholderData: keepPreviousData,
  })

  const { data: historyData } = useQuery({
    queryKey: ['core-history', filters, histSearch],
    queryFn: () => apiGet('/api/history', filters, { search: histSearch || undefined, limit: 1200 }),
    enabled: sub === 'history',
    placeholderData: keepPreviousData,
  })

  const { data: sessionsData } = useQuery({
    queryKey: ['core-sessions', filters],
    queryFn: () => apiGet('/api/sessions', filters, { limit: 40 }),
    enabled: sub === 'history',
    placeholderData: keepPreviousData,
  })

  // Virtualized history list
  const histRows = historyData?.items || []
  const parentRef = useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: histRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
  })

  const heatmap7x24Option = useMemo(() => {
    const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
    const hours = Array.from({ length: 24 }, (_, i) => `${i}h`)
    const cells = (chronoData?.hour_dow_matrix || []).map((c: any) => [c.hour, c.dow, Math.round((c.total_ms || 0) / 60_000)])
    const maxV = Math.max(10, ...cells.map((c: any) => c[2]))
    return {
      tooltip: {
        formatter: (p: any) => `${days[p.value[1]]} ${p.value[0]}h : <b>${p.value[2]} min</b>`,
      },
      grid: { left: 42, right: 16, top: 10, bottom: 28 },
      xAxis: { type: 'category', data: hours },
      yAxis: { type: 'category', data: days },
      visualMap: {
        min: 0,
        max: maxV,
        show: false,
        inRange: { color: theme === 'dark' ? ['#1a1a1e', '#2f5278', '#528bc4', '#d46d3d'] : ['#ece8de', '#a5c0dc', '#528bc4', '#c45727'] },
      },
      series: [{ type: 'heatmap', data: cells, universalTransition: { enabled: true } }],
    }
  }, [chronoData, theme])

  const radarOption = useMemo(() => {
    const scores = personaData?.radar || []
    return {
      radar: {
        indicator: scores.map((s: any) => ({ name: s.axis, max: 100 })),
        splitArea: { areaStyle: { color: ['transparent'] } },
        axisName: { color: theme === 'dark' ? '#a2a2ad' : '#52525c', fontSize: 11 },
      },
      series: [
        {
          type: 'radar',
          data: [{ value: scores.map((s: any) => s.value), name: personaData?.archetype?.name || 'Profil' }],
          areaStyle: { color: 'rgba(104, 156, 210, 0.28)' },
          lineStyle: { color: '#689cd2', width: 2 },
          itemStyle: { color: '#689cd2' },
        },
      ],
    }
  }, [personaData, theme])

  const csvUrl = `/api/history/export.csv?${buildFilterSearchParams(filters, { search: histSearch || undefined })}`

  return (
    <div className="space-y-4">
      <div className="surface-card flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'tops', label: 'Tops 100' },
            { id: 'chrono', label: 'Chronobiologie' },
            { id: 'persona', label: 'Persona & Époques' },
            { id: 'behavior', label: 'Obsessions & Skips' },
            { id: 'history', label: 'Sessions & Historique' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setSub(t.id as CoreTab)}
              data-testid={`core-tab-${t.id}`}
              className={`rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-medium ${
                sub === t.id
                  ? 'border border-[var(--accent)] bg-[var(--bg-surface-2)] text-[var(--text-strong)]'
                  : 'tactile-btn text-[var(--text-secondary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {sub === 'tops' && (
          <div className="flex gap-1">
            {(['artists', 'albums', 'tracks'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTopKind(k)}
                className={`rounded px-2.5 py-1 text-xs ${topKind === k ? 'bg-[var(--accent)] text-white' : 'tactile-btn text-[var(--text-secondary)]'}`}
              >
                {k === 'artists' ? 'Artistes' : k === 'albums' ? 'Albums' : 'Titres'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* TOPS */}
      {sub === 'tops' && (
        <div className="surface-card overflow-hidden">
          <div className="max-h-[560px] overflow-y-auto divide-y divide-[var(--border-subtle)]">
            {(topsData?.items || []).map((item: any, idx: number) => (
              <div key={item.artist_key || item.album_key || item.track_key || idx} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--bg-surface-2)]">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-7 font-mono-tab text-xs text-[var(--text-muted)]">#{idx + 1}</span>
                  <div className="min-w-0">
                    <button
                      onClick={() => {
                        if (topKind === 'artists') openDrawer({ type: 'artist', key: item.artist_key, label: item.artist_name })
                        else if (topKind === 'albums') openDrawer({ type: 'album', key: item.album_key, label: item.album_name })
                        else if (item.artist_key) openDrawer({ type: 'artist', key: item.artist_key, label: item.artist_name })
                      }}
                      className="block truncate text-left text-xs font-semibold text-[var(--text-strong)] hover:text-[var(--accent)]"
                    >
                      {item.song_name || item.album_name || item.artist_name}
                    </button>
                    <div className="truncate text-[11px] text-[var(--text-secondary)]">
                      {topKind === 'artists' ? item.genre || '—' : `${item.artist_name}${item.album_name && topKind === 'tracks' ? ` · ${item.album_name}` : ''}`}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 font-mono-tab text-xs text-[var(--text-primary)]">
                  <span>{formatHours(item.total_ms)}</span>
                  <span className="text-[var(--text-secondary)]">{item.plays} éc.</span>
                  {item.preview_url && (
                    <button onClick={() => reactiveAudio.play(item)} className="tactile-btn p-1 text-[var(--accent)]">
                      <Play className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CHRONOBIOLOGY */}
      {sub === 'chrono' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="surface-card p-4">
            <h2 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
              Matrice Heure × Jour de la Semaine (7×24)
            </h2>
            <EChartCanvas theme={theme} height={270} option={heatmap7x24Option} />
          </div>
          <div className="surface-card p-4">
            <h2 className="mb-3 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
              Calendrier des Jours Actifs (cliquable)
            </h2>
            <div className="flex max-h-[260px] flex-wrap gap-1 overflow-y-auto">
              {(chronoData?.daily_heatmap || []).map((d: any) => {
                const hrs = (d.total_ms || 0) / 3_600_000
                const bg =
                  hrs > 3 ? 'var(--enc-orange)' : hrs > 1.5 ? 'var(--enc-blue)' : hrs > 0.5 ? 'var(--accent-ok)' : 'var(--bg-surface-3)'
                return (
                  <button
                    key={d.date}
                    onClick={() => openDrawer({ type: 'day', key: d.date })}
                    title={`${d.date} · ${hrs.toFixed(1)} h (${d.plays} éc.)`}
                    className="h-3.5 w-3.5 rounded-[2px]"
                    style={{ backgroundColor: bg }}
                  />
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* PERSONA */}
      {sub === 'persona' && (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="surface-card p-5 lg:col-span-6">
            <div className="font-mono-tab text-[10px] uppercase text-[var(--accent)]">ARCHÉTYPE D&apos;AUDITEUR</div>
            <h2 className="mt-1 font-display text-2xl font-bold text-[var(--text-strong)]">
              {personaData?.archetype?.name || '—'}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              {personaData?.archetype?.description || ''}
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="surface-card-2 p-3">
                <div className="font-mono-tab text-[10px] text-[var(--text-muted)]">ÂGE D&apos;ÉCOUTE</div>
                <div className="font-mono-tab text-xl font-bold text-[var(--text-strong)]">
                  {personaData?.listening_age ?? '—'} ans
                </div>
              </div>
              <div className="surface-card-2 p-3">
                <div className="font-mono-tab text-[10px] text-[var(--text-muted)]">ANNÉE MÉDIANE</div>
                <div className="font-mono-tab text-xl font-bold text-[var(--text-strong)]">
                  {personaData?.median_release_year ?? '—'}
                </div>
              </div>
              <div className="surface-card-2 p-3">
                <div className="font-mono-tab text-[10px] text-[var(--text-muted)]">DÉCENNIE CŒUR</div>
                <div className="font-mono-tab text-xl font-bold text-[var(--text-strong)]">
                  {personaData?.top_decade ? `${personaData.top_decade}s` : '—'}
                </div>
              </div>
            </div>
          </div>
          <div className="surface-card p-4 lg:col-span-6">
            <h3 className="mb-1 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
              Radar Comportemental 6 Axes
            </h3>
            <EChartCanvas theme={theme} height={260} option={radarOption} />
          </div>
        </div>
      )}

      {/* BEHAVIOR */}
      {sub === 'behavior' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="surface-card p-4">
            <h3 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
              Radar d&apos;Obsessions (Phases 14 jours)
            </h3>
            <div className="space-y-2">
              {(behaviorData?.obsessions || []).slice(0, 7).map((o: any, i: number) => (
                <div key={i} className="surface-card-2 p-2.5 text-xs">
                  <div className="flex justify-between font-semibold text-[var(--text-strong)]">
                    <span>{o.artist_name}</span>
                    <span className="font-mono-tab text-[var(--enc-orange)]">×{o.lift}</span>
                  </div>
                  <div className="font-mono-tab text-[11px] text-[var(--text-secondary)]">
                    {o.window_start} → {o.window_end} · {o.plays} éc.
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="surface-card p-4">
            <h3 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
              Écoutes en Boucle (Consécutives)
            </h3>
            <div className="space-y-2">
              {(behaviorData?.loops || []).slice(0, 7).map((l: any, i: number) => (
                <div key={i} className="surface-card-2 flex items-center justify-between p-2.5 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[var(--text-strong)]">{l.song_name}</div>
                    <div className="truncate text-[11px] text-[var(--text-secondary)]">{l.artist_name}</div>
                  </div>
                  <span className="shrink-0 font-mono-tab font-bold text-[var(--accent)]">{l.max_streak}×</span>
                </div>
              ))}
            </div>
          </div>
          <div className="surface-card p-4">
            <h3 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
              Top Recherches Apple Music
            </h3>
            <div className="space-y-1.5">
              {(behaviorData?.top_searches || []).slice(0, 10).map((s: any, i: number) => (
                <div key={i} className="flex justify-between rounded bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-xs">
                  <span className="truncate text-[var(--text-strong)]">{s.query}</span>
                  <span className="font-mono-tab text-[var(--text-secondary)]">{s.count}×</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SESSIONS & VIRTUALIZED HISTORY */}
      {sub === 'history' && (
        <div className="space-y-4">
          <div className="surface-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  value={histSearch}
                  onChange={(e) => setHistSearch(e.target.value)}
                  placeholder="Filtrer l'historique virtualisé..."
                  className="w-64 bg-transparent text-xs text-[var(--text-strong)] outline-none"
                />
              </div>
              <a href={csvUrl} className="tactile-btn flex items-center gap-1.5 px-3 py-1.5 text-xs">
                <Download className="h-3.5 w-3.5" /> Export CSV ({historyData?.total ?? 0} lignes)
              </a>
            </div>

            <div ref={parentRef} className="h-[380px] overflow-y-auto rounded border border-[var(--border-subtle)]">
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
                {rowVirtualizer.getVirtualItems().map((vRow) => {
                  const ev = histRows[vRow.index]
                  return (
                    <div
                      key={vRow.key}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${vRow.size}px`,
                        transform: `translateY(${vRow.start}px)`,
                      }}
                      className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 text-xs hover:bg-[var(--bg-surface-2)]"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-[var(--text-strong)]">{ev.song_name}</span>
                        <span className="ml-2 text-[var(--text-secondary)]">{ev.artist_name}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 font-mono-tab text-[11px] text-[var(--text-secondary)]">
                        <span>{(ev.started_at_local || '').replace('T', ' ').slice(0, 16)}</span>
                        <span>{formatDurationMs(ev.play_duration_ms)}</span>
                        <span className="hidden sm:inline">{ev.device_label}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="surface-card p-4">
            <h3 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
              Sessions d&apos;Écoute Récentes ({sessionsData?.total ?? 0})
            </h3>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {(sessionsData?.items || []).slice(0, 9).map((s: any) => (
                <div key={s.session_id} className="surface-card-2 p-2.5 text-xs">
                  <div className="flex justify-between font-mono-tab text-[11px] text-[var(--accent)]">
                    <span>Session #{s.session_id}</span>
                    <span>{formatHours(s.total_ms)} · {s.tracks_count} titres</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
                    {(s.started_at_local || '').replace('T', ' ').slice(0, 16)} · {s.device_label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
