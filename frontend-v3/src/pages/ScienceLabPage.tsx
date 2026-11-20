import { useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { Cpu, Download, Disc, FlaskConical, Play, Radio, Shuffle, Sparkles } from 'lucide-react'
import { apiGet, apiPost, buildFilterSearchParams, type FilterState } from '../api/client'
import { reactiveAudio } from '../audio/reactiveAudio'
import { EChartCanvas } from '../components/EChartCanvas'
import type { ThemePolarity } from '../hooks/useUrlFilters'
import { usePlayerStore } from '../store/playerStore'
import { audioProxyUrl } from '../utils/apca'

interface ScienceLabPageProps {
  filters: FilterState
  theme: ThemePolarity
}

type ScienceSubTab = 'eras' | 'compass' | 'camelot' | 'metrics'

export function ScienceLabPage({ filters, theme }: ScienceLabPageProps) {
  const [sub, setSub] = useState<ScienceSubTab>('eras')
  const [selectedCamelot, setSelectedCamelot] = useState<string | null>(null)
  const [playlistKind, setPlaylistKind] = useState<'harmonic_mix' | 'forgotten_gems' | 'zero_skip' | 'era_soundtrack'>('harmonic_mix')
  const [seedTrackKey, setSeedTrackKey] = useState<string | null>(null)
  const [generatedPlaylist, setGeneratedPlaylist] = useState<any | null>(null)
  const openDrawer = usePlayerStore((s) => s.openDrawer)
  const wasmScan = usePlayerStore((s) => s.wasmScanStatus)
  const setWasmScan = usePlayerStore((s) => s.setWasmScanStatus)

  const { data: erasData } = useQuery({
    queryKey: ['v3-eras', filters],
    queryFn: () => apiGet('/api/v3/analytics/eras', filters),
    placeholderData: keepPreviousData,
  })

  const { data: compassData, refetch: refetchCompass } = useQuery({
    queryKey: ['v3-compass', filters],
    queryFn: () => apiGet('/api/v3/analytics/compass', filters, { limit: 220 }),
    placeholderData: keepPreviousData,
  })

  const { data: camelotData } = useQuery({
    queryKey: ['v3-camelot', filters],
    queryFn: () => apiGet('/api/v3/analytics/camelot', filters),
    placeholderData: keepPreviousData,
  })

  const { data: scienceData } = useQuery({
    queryKey: ['v3-science', filters],
    queryFn: () => apiGet('/api/v3/analytics/science', filters),
    placeholderData: keepPreviousData,
  })

  const playlistMutation = useMutation({
    mutationFn: (opts: { kind: string; seed?: string | null; pushLb?: boolean }) =>
      apiPost(
        '/api/v3/playlists/generate',
        {
          kind: opts.kind,
          seed_track_key: opts.seed || undefined,
          limit: 18,
          push_to_listenbrainz: Boolean(opts.pushLb),
        },
        filters
      ),
    onSuccess: (res) => setGeneratedPlaylist(res),
  })

  // Batch Essentia.js WASM scan on top tracks with available 30s previews
  const runBatchWasmScan = async () => {
    const candidates = (compassData?.points || [])
      .filter((p: any) => p.preview_url && p.dna_source !== 'essentia_wasm')
      .slice(0, 12)
    if (candidates.length === 0) return
    setWasmScan({ running: true, done: 0, total: candidates.length, lastTrack: null })
    let done = 0
    for (const tr of candidates) {
      const proxied = audioProxyUrl(tr.preview_url)
      if (proxied) {
        await reactiveAudio.analyzePreviewUrl(tr.track_key, proxied)
      }
      done++
      setWasmScan({ running: true, done, total: candidates.length, lastTrack: tr.song_name })
    }
    setWasmScan({ running: false, done, total: candidates.length, lastTrack: null })
    void refetchCompass()
  }

  // ECharts options
  const eraTimelineOption = useMemo(() => {
    const weeks = erasData?.weekly_series || []
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 48, right: 20, top: 20, bottom: 30 },
      xAxis: { type: 'category', data: weeks.map((w: any) => w.week) },
      yAxis: [
        { type: 'value', name: 'Heures' },
        { type: 'value', name: 'Entropie', min: 0, max: 1 },
      ],
      series: [
        {
          name: 'Heures / sem.',
          type: 'bar',
          universalTransition: { enabled: true },
          data: weeks.map((w: any) => w.hours),
          itemStyle: { color: '#5d8fc2', borderRadius: [3, 3, 0, 0] },
        },
        {
          name: 'Entropie (exploration)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          universalTransition: { enabled: true },
          data: weeks.map((w: any) => w.entropy_norm),
          lineStyle: { color: '#d46d3d', width: 2 },
          itemStyle: { color: '#d46d3d' },
        },
      ],
    }
  }, [erasData])

  const russellScatterOption = useMemo(() => {
    const pts = compassData?.points || []
    const qColors: Record<string, string> = {
      euphoric: '#c89446',
      intense: '#cf6b6b',
      melancholic: '#689cd2',
      serene: '#5db08a',
    }
    return {
      tooltip: {
        formatter: (p: any) => {
          const d = p.data?.meta
          if (!d) return ''
          return `<b>${d.song_name}</b><br/>${d.artist_name}<br/>Valence: ${Math.round(d.valence * 100)}% · Arousal: ${Math.round(d.arousal * 100)}%<br/>${Math.round(d.bpm)} BPM · ${d.camelot_code} (${d.dna_source})`
        },
      },
      grid: { left: 48, right: 20, top: 24, bottom: 40 },
      xAxis: { type: 'value', name: 'Valence (Sombre → Positif)', nameLocation: 'middle', nameGap: 26, min: 0, max: 1 },
      yAxis: { type: 'value', name: 'Arousal (Calme → Intense)', min: 0, max: 1 },
      series: [
        {
          type: 'scatter',
          universalTransition: { enabled: true },
          symbolSize: (val: any, params: any) => Math.max(7, Math.min(26, 6 + Math.sqrt(params.data.meta.plays) * 2.4)),
          data: pts.map((pt: any) => ({
            value: [pt.valence, pt.arousal],
            meta: pt,
            itemStyle: { color: qColors[pt.quadrant] || '#689cd2', opacity: 0.82 },
          })),
        },
      ],
    }
  }, [compassData])

  const diurnalOption = useMemo(() => {
    const d = compassData?.diurnal_trajectory || []
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0, textStyle: { color: theme === 'dark' ? '#a2a2ad' : '#52525c', fontSize: 11 } },
      grid: { left: 40, right: 16, top: 30, bottom: 26 },
      xAxis: { type: 'category', data: d.map((x: any) => `${x.hour}h`) },
      yAxis: { type: 'value', min: 0.2, max: 0.9 },
      series: [
        {
          name: 'Valence',
          type: 'line',
          smooth: true,
          universalTransition: { enabled: true },
          data: d.map((x: any) => x.valence),
          lineStyle: { color: '#c89446', width: 2 },
          itemStyle: { color: '#c89446' },
        },
        {
          name: 'Arousal (Énergie)',
          type: 'line',
          smooth: true,
          universalTransition: { enabled: true },
          data: d.map((x: any) => x.arousal),
          lineStyle: { color: '#689cd2', width: 2 },
          itemStyle: { color: '#689cd2' },
        },
      ],
    }
  }, [compassData, theme])

  const lorenzOption = useMemo(() => {
    const pts = scienceData?.gini_artists?.lorenz || []
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 42, right: 16, top: 18, bottom: 28 },
      xAxis: { type: 'value', name: 'Part artistes', min: 0, max: 1 },
      yAxis: { type: 'value', name: 'Part temps', min: 0, max: 1 },
      series: [
        {
          name: 'Égalité parfaite',
          type: 'line',
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#7a7a86' },
          data: [[0, 0], [1, 1]],
        },
        {
          name: 'Courbe de Lorenz',
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.16 },
          data: pts.map((p: any) => [p.p, p.l]),
          lineStyle: { color: '#d46d3d', width: 2 },
          itemStyle: { color: '#d46d3d' },
        },
      ],
    }
  }, [scienceData])

  const survivalOption = useMemo(() => {
    const curve = scienceData?.survival?.curve || []
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 42, right: 16, top: 18, bottom: 28 },
      xAxis: { type: 'category', data: curve.map((c: any) => `M+${c.month_age}`) },
      yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
      series: [
        {
          name: 'Rétention artistes',
          type: 'line',
          step: 'end',
          areaStyle: { opacity: 0.18 },
          data: curve.map((c: any) => c.retention_pct),
          lineStyle: { color: '#5db08a', width: 2 },
          itemStyle: { color: '#5db08a' },
        },
      ],
    }
  }, [scienceData])

  const activeCamelotCell = (camelotData?.cells || []).find((c: any) => c.code === selectedCamelot) || camelotData?.dominant

  const exportUrl = (fmt: 'jspf' | 'xspf' | 'm3u8') => {
    const qs = buildFilterSearchParams(filters, {
      kind: playlistKind,
      fmt,
      seed_track_key: seedTrackKey || undefined,
      limit: 18,
    })
    return `/api/v3/playlists/export?${qs}`
  }

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-3.5">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-[var(--accent)]" />
          <div>
            <h1 className="font-display text-lg font-bold text-[var(--text-strong)]">Laboratoire de Science Musicale</h1>
            <p className="text-[11px] text-[var(--text-secondary)]">
              PELT (ruptures RBF/BIC) · Essentia.js WASM · Boussole Russell · Roue Camelot · Eddington / Gini / Entropie / Survie
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'eras', label: 'Ères PELT' },
            { id: 'compass', label: 'Boussole Russell & ADN' },
            { id: 'camelot', label: 'Roue Camelot & Mix' },
            { id: 'metrics', label: 'Eddington, Gini & Survie' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setSub(t.id as ScienceSubTab)}
              data-testid={`science-tab-${t.id}`}
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
      </div>

      {/* 1. PELT Musical Eras */}
      {sub === 'eras' && (
        <div className="space-y-4">
          <div className="surface-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
                Détection de Points de Rupture — {erasData?.algorithm || 'PELT RBF + BIC'}
              </span>
              <span className="font-mono-tab text-xs text-[var(--accent)]">
                {erasData?.eras?.length || 0} ères organiques détectées
              </span>
            </div>
            <EChartCanvas theme={theme} height={240} option={eraTimelineOption} />
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {(erasData?.eras || []).map((era: any) => (
              <div key={era.index} className="surface-card flex flex-col justify-between p-4">
                <div>
                  <div className="flex items-center justify-between font-mono-tab text-[10px] text-[var(--text-muted)]">
                    <span>ÈRE 0{era.index + 1} · {era.dominant_genre}</span>
                    <span>{era.weeks_count} sem.</span>
                  </div>
                  <h3 className="mt-1 font-display text-base font-bold text-[var(--text-strong)]">{era.title}</h3>
                  <div className="mt-0.5 font-mono-tab text-[11px] text-[var(--text-secondary)]">
                    {era.start_date} → {era.end_date} · {era.hours} h ({era.plays} éc.)
                  </div>
                  <div className="mt-2 flex gap-2 font-mono-tab text-[11px]">
                    <span className="rounded bg-[var(--bg-surface-2)] px-2 py-0.5">{era.avg_bpm} BPM</span>
                    <span className="rounded bg-[var(--bg-surface-2)] px-2 py-0.5">Énergie {Math.round(era.avg_energy * 100)}%</span>
                    <span className="rounded bg-[var(--bg-surface-2)] px-2 py-0.5">H={era.avg_entropy}b</span>
                  </div>
                </div>
                <div className="mt-3 space-y-1 border-t border-[var(--border-subtle)] pt-2.5">
                  <div className="font-mono-tab text-[10px] uppercase text-[var(--text-muted)]">Artistes à fort Lift</div>
                  {(era.signature_artists || []).slice(0, 3).map((a: any) => (
                    <button
                      key={a.artist_key}
                      onClick={() => openDrawer({ type: 'artist', key: a.artist_key, label: a.artist_name })}
                      className="flex w-full items-center justify-between text-xs hover:text-[var(--accent)]"
                    >
                      <span className="truncate">{a.artist_name}</span>
                      <span className="font-mono-tab text-[11px] text-[var(--accent-ok)]">×{a.lift} ({a.hours}h)</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. Russell Circumplex Emotional Compass + Local MIR WASM Scanner */}
      {sub === 'compass' && (
        <div className="space-y-4">
          <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="space-y-0.5">
              <div className="font-mono-tab text-xs font-semibold text-[var(--text-strong)]">
                Couverture ADN Audio Local (Essentia.js WASM) &amp; NLP Paroles FR/EN
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                WASM mesurés : <strong className="font-mono-tab text-[var(--accent)]">{compassData?.coverage?.essentia_wasm_tracks ?? 0}</strong> ·
                Paroles scorées : <strong className="font-mono-tab text-[var(--accent-ok)]">{compassData?.coverage?.lyrics_sentiment_tracks ?? 0}</strong> ·
                Catalogue : {compassData?.coverage?.total_catalog_tracks ?? 0} titres (prior acoustique calibré pour les titres non scannés)
              </div>
            </div>
            <button
              onClick={runBatchWasmScan}
              disabled={wasmScan.running}
              className="flex items-center gap-1.5 rounded-[var(--radius-card)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Cpu className="h-3.5 w-3.5" />
              {wasmScan.running
                ? `Analyse WASM ${wasmScan.done}/${wasmScan.total}...`
                : 'Scanner 12 extraits 30s (Worker WASM)'}
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="surface-card p-4 lg:col-span-7">
              <h2 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
                Boussole Émotionnelle de Russell (Valence × Arousal)
              </h2>
              <EChartCanvas theme={theme} height={340} option={russellScatterOption} />
            </div>

            <div className="space-y-4 lg:col-span-5">
              <div className="surface-card p-4">
                <h2 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
                  Trajectoire Affective Diurne (24h)
                </h2>
                <EChartCanvas theme={theme} height={190} option={diurnalOption} />
              </div>

              <div className="surface-card p-4">
                <h2 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
                  Répartition des 4 Quadrants
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {(compassData?.quadrants || []).map((q: any) => (
                    <div key={q.id} className="surface-card-2 p-2.5">
                      <div className="text-[11px] text-[var(--text-secondary)]">{q.label}</div>
                      <div className="font-mono-tab text-lg font-bold text-[var(--text-strong)]">{q.pct}%</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Interactive Camelot Wheel + Harmonic Mix & Smart Playlist Generator */}
      {sub === 'camelot' && (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="surface-card p-4 lg:col-span-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
                Roue de Camelot Interactive (1A–12A Mineur · 1B–12B Majeur)
              </h2>
              {camelotData?.dominant && (
                <span className="font-mono-tab text-xs text-[var(--accent)]">
                  Dominante : {camelotData.dominant.code} ({camelotData.dominant.musical_key})
                </span>
              )}
            </div>

            {/* Interactive 24-cell Camelot Wheel SVG */}
            <div className="flex justify-center">
              <svg viewBox="-160 -160 320 320" className="h-[310px] w-[310px]">
                {(camelotData?.cells || []).map((cell: any) => {
                  const angleStart = ((cell.number - 1) / 12) * Math.PI * 2 - Math.PI / 2 - Math.PI / 12
                  const angleEnd = angleStart + (Math.PI * 2) / 12
                  const rIn = cell.ring === 'A' ? 54 : 102
                  const rOut = cell.ring === 'A' ? 98 : 148
                  const x1 = Math.cos(angleStart) * rOut
                  const y1 = Math.sin(angleStart) * rOut
                  const x2 = Math.cos(angleEnd) * rOut
                  const y2 = Math.sin(angleEnd) * rOut
                  const x3 = Math.cos(angleEnd) * rIn
                  const y3 = Math.sin(angleEnd) * rIn
                  const x4 = Math.cos(angleStart) * rIn
                  const y4 = Math.sin(angleStart) * rIn
                  const d = `M ${x1} ${y1} A ${rOut} ${rOut} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 0 0 ${x4} ${y4} Z`
                  const midA = (angleStart + angleEnd) / 2
                  const tx = Math.cos(midA) * ((rIn + rOut) / 2)
                  const ty = Math.sin(midA) * ((rIn + rOut) / 2)
                  const maxH = Math.max(0.5, ...(camelotData?.cells || []).map((c: any) => c.hours))
                  const intensity = Math.min(1, (cell.hours || 0) / maxH)
                  const isSel = activeCamelotCell?.code === cell.code
                  const hue = (cell.number - 1) * 30
                  const fill = isSel
                    ? 'var(--accent)'
                    : `hsla(${hue}, 42%, ${theme === 'dark' ? 32 + intensity * 26 : 74 - intensity * 30}%, ${0.4 + intensity * 0.55})`
                  return (
                    <g
                      key={cell.code}
                      className="cursor-pointer"
                      onClick={() => setSelectedCamelot(cell.code)}
                    >
                      <path d={d} fill={fill} stroke="var(--bg-canvas)" strokeWidth={1.5} />
                      <text
                        x={tx}
                        y={ty + 3}
                        textAnchor="middle"
                        fontSize="10"
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight={isSel ? '700' : '500'}
                        fill={theme === 'dark' ? '#ebebef' : '#1c1c20'}
                      >
                        {cell.code}
                      </text>
                    </g>
                  )
                })}
                <circle cx={0} cy={0} r={48} fill="var(--bg-surface-2)" stroke="var(--border-subtle)" />
                <text x={0} y={-4} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--text-strong)" fontFamily="JetBrains Mono">
                  {activeCamelotCell?.code || '8A'}
                </text>
                <text x={0} y={14} textAnchor="middle" fontSize="10" fill="var(--text-secondary)">
                  {activeCamelotCell?.musical_key || ''}
                </text>
              </svg>
            </div>

            {activeCamelotCell && (
              <div className="mt-3 space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
                <div className="flex justify-between font-mono-tab text-xs">
                  <span className="font-semibold text-[var(--text-strong)]">
                    Clé {activeCamelotCell.code} ({activeCamelotCell.musical_key})
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {activeCamelotCell.hours} h · {activeCamelotCell.tracks_count} titres
                  </span>
                </div>
                {(activeCamelotCell.top_tracks || []).slice(0, 4).map((t: any) => (
                  <div key={t.track_key} className="flex items-center justify-between rounded bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-xs">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-[var(--text-strong)]">{t.song_name}</div>
                      <div className="truncate text-[11px] text-[var(--text-secondary)]">
                        {t.artist_name} · {Math.round(t.bpm)} BPM
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSeedTrackKey(t.track_key)
                        setPlaylistKind('harmonic_mix')
                        playlistMutation.mutate({ kind: 'harmonic_mix', seed: t.track_key })
                      }}
                      className="tactile-btn shrink-0 px-2 py-1 text-[11px] text-[var(--accent)]"
                    >
                      Graine Mix
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Smart & Harmonic Playlist Generator + JSPF / XSPF / M3U8 / ListenBrainz */}
          <div className="surface-card flex flex-col justify-between p-4 lg:col-span-6">
            <div>
              <h2 className="mb-3 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
                Générateur de Mix Harmonique &amp; Playlists Intelligentes
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'harmonic_mix', label: 'Mix Harmonique (Camelot)' },
                  { id: 'forgotten_gems', label: 'Perles Oubliées (>60j)' },
                  { id: 'zero_skip', label: 'Zéro Skip (Intouchables)' },
                  { id: 'era_soundtrack', label: "Bande-son d'Ère PELT" },
                ].map((k) => (
                  <button
                    key={k.id}
                    onClick={() => {
                      setPlaylistKind(k.id as any)
                      playlistMutation.mutate({ kind: k.id, seed: seedTrackKey })
                    }}
                    className={`rounded-[var(--radius-card)] p-2.5 text-left text-xs font-medium ${
                      playlistKind === k.id
                        ? 'border border-[var(--accent)] bg-[var(--bg-surface-2)] text-[var(--text-strong)]'
                        : 'tactile-btn text-[var(--text-secondary)]'
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => playlistMutation.mutate({ kind: playlistKind, seed: seedTrackKey })}
                  className="flex items-center gap-1.5 rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  <Shuffle className="h-3.5 w-3.5" /> Générer
                </button>
                <a href={exportUrl('jspf')} className="tactile-btn flex items-center gap-1 px-2.5 py-1.5 font-mono-tab text-xs">
                  <Download className="h-3.5 w-3.5" /> JSPF
                </a>
                <a href={exportUrl('xspf')} className="tactile-btn flex items-center gap-1 px-2.5 py-1.5 font-mono-tab text-xs">
                  <Download className="h-3.5 w-3.5" /> XSPF
                </a>
                <a href={exportUrl('m3u8')} className="tactile-btn flex items-center gap-1 px-2.5 py-1.5 font-mono-tab text-xs">
                  <Download className="h-3.5 w-3.5" /> M3U8
                </a>
                <button
                  onClick={() => playlistMutation.mutate({ kind: playlistKind, seed: seedTrackKey, pushLb: true })}
                  className="tactile-btn flex items-center gap-1 px-2.5 py-1.5 text-xs text-[var(--accent-ok)]"
                >
                  <Radio className="h-3.5 w-3.5" /> Publier ListenBrainz
                </button>
              </div>

              {generatedPlaylist?.listenbrainz_push && (
                <div className="mt-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] p-2 text-xs">
                  {generatedPlaylist.listenbrainz_push.ok
                    ? `Playlist publiée sur ListenBrainz : ${generatedPlaylist.listenbrainz_push.url}`
                    : generatedPlaylist.listenbrainz_push.error}
                </div>
              )}

              <div className="mt-3 max-h-[340px] space-y-1.5 overflow-y-auto pr-1">
                {generatedPlaylist?.tracks?.length ? (
                  generatedPlaylist.tracks.map((tr: any, i: number) => (
                    <div key={tr.track_key} className="flex items-center justify-between gap-2 rounded bg-[var(--bg-surface-2)] px-2.5 py-2 text-xs">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[var(--text-strong)]">
                          {i + 1}. {tr.song_name} <span className="font-normal text-[var(--text-secondary)]">· {tr.artist_name}</span>
                        </div>
                        <div className="truncate font-mono-tab text-[10px] text-[var(--accent)]">
                          {tr.camelot_code} · {Math.round(tr.bpm)} BPM · {tr.transition_reason}
                        </div>
                      </div>
                      {tr.preview_url && (
                        <button onClick={() => reactiveAudio.play(tr)} className="tactile-btn p-1 text-[var(--accent)]">
                          <Play className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-[var(--text-secondary)]">
                    <Disc className="mb-2 h-8 w-8 text-[var(--text-muted)]" />
                    Cliquez sur « Générer » ou choisissez un titre graine dans la roue de Camelot.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Rigorous Metrics: Eddington, Gini/D_eff, Shannon Entropy, Survival & Half-Life, Bridge Artists */}
      {sub === 'metrics' && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="surface-card p-4">
              <div className="font-mono-tab text-[10px] uppercase text-[var(--text-muted)]">NOMBRE D&apos;EDDINGTON</div>
              <div className="mt-1 font-mono-tab text-3xl font-bold text-[var(--accent)]">
                E = {scienceData?.eddington?.eddington ?? 0}
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Au moins {scienceData?.eddington?.eddington ?? 0} titres écoutés lors d&apos;au moins {scienceData?.eddington?.eddington ?? 0} journées.
                Encore <strong>{scienceData?.eddington?.days_needed_for_next ?? 0} j</strong> pour E={scienceData?.eddington?.next_target}.
              </p>
            </div>

            <div className="surface-card p-4">
              <div className="font-mono-tab text-[10px] uppercase text-[var(--text-muted)]">GINI &amp; NOYAU EFFECTIF</div>
              <div className="mt-1 font-mono-tab text-3xl font-bold text-[var(--text-strong)]">
                D_eff = {scienceData?.gini_artists?.effective_core ?? 0}
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                G = {scienceData?.gini_artists?.gini ?? 0} sur {scienceData?.gini_artists?.k ?? 0} artistes (⌊K × (1 − G)⌋).
                Titres : D_eff = {scienceData?.gini_tracks?.effective_core ?? 0}.
              </p>
            </div>

            <div className="surface-card p-4">
              <div className="font-mono-tab text-[10px] uppercase text-[var(--text-muted)]">ENTROPIE DE SHANNON</div>
              <div className="mt-1 font-mono-tab text-3xl font-bold text-[var(--accent-ok)]">
                {scienceData?.shannon_entropy?.bits ?? 0} bits
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Normalisée : {Math.round((scienceData?.shannon_entropy?.normalized ?? 0) * 100)}% · Perplexité ≈ {scienceData?.shannon_entropy?.perplexity ?? 0} artistes équivalents.
              </p>
            </div>

            <div className="surface-card p-4">
              <div className="font-mono-tab text-[10px] uppercase text-[var(--text-muted)]">DUCKDB PARQUET ISOLÉ</div>
              <div className="mt-1 font-mono-tab text-3xl font-bold text-[var(--text-strong)]">
                {scienceData?.duckdb_parquet_rows ?? 0}
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Lignes indexées dans l&apos;instantané Parquet immuable (zéro ATTACH SQLite, zéro risque SIGBUS).
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="surface-card p-4">
              <h3 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
                Courbe de Lorenz — Concentration des goûts
              </h3>
              <EChartCanvas theme={theme} height={220} option={lorenzOption} />
            </div>

            <div className="surface-card p-4">
              <h3 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
                Courbe de Survie &amp; Rétention des Artistes (M+1 → M+12)
              </h3>
              <EChartCanvas theme={theme} height={220} option={survivalOption} />
            </div>
          </div>

          {/* Survival archetypes + Bridge artists + Entropy by Device */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="surface-card p-4">
              <h3 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
                Longévité : Comètes, Classiques &amp; Résurrections
              </h3>
              <div className="mb-3 grid grid-cols-2 gap-1.5 font-mono-tab text-[11px]">
                {Object.entries(scienceData?.survival?.counts || {}).map(([k, v]: [string, any]) => (
                  <div key={k} className="surface-card-2 flex justify-between px-2 py-1">
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
              <div className="max-h-[220px] space-y-1 overflow-y-auto">
                {(scienceData?.survival?.artists || []).slice(0, 15).map((a: any) => (
                  <button
                    key={a.artist_key}
                    onClick={() => openDrawer({ type: 'artist', key: a.artist_key, label: a.artist_name })}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-[var(--bg-surface-2)]"
                  >
                    <span className="truncate font-medium text-[var(--text-strong)]">{a.artist_name}</span>
                    <span className="shrink-0 font-mono-tab text-[10px] text-[var(--accent)]">
                      {a.archetype} · t½={a.half_life_days}j
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="surface-card p-4">
              <h3 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
                Artistes-Passerelles (Transitions A → B)
              </h3>
              <div className="space-y-1.5">
                {(scienceData?.bridge_artists || []).slice(0, 8).map((b: any) => (
                  <button
                    key={b.artist_key}
                    onClick={() => openDrawer({ type: 'artist', key: b.artist_key, label: b.artist_name })}
                    className="block w-full rounded bg-[var(--bg-surface-2)] p-2 text-left text-xs hover:border-[var(--accent)]"
                  >
                    <div className="flex justify-between font-semibold text-[var(--text-strong)]">
                      <span>{b.artist_name}</span>
                      <span className="font-mono-tab text-[var(--accent-ok)]">score {b.bridge_score}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-[var(--text-secondary)]">
                      Relie : {(b.connected_genres || []).join(' · ') || b.primary_genre}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="surface-card p-4">
              <h3 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
                Entropie par Appareil (Routine vs Exploration)
              </h3>
              <div className="space-y-2">
                {(scienceData?.entropy_by_device || []).map((d: any) => (
                  <div key={d.device} className="surface-card-2 p-2.5 text-xs">
                    <div className="flex justify-between font-medium text-[var(--text-strong)]">
                      <span className="truncate">{d.device}</span>
                      <span className="font-mono-tab text-[var(--accent)]">{d.style}</span>
                    </div>
                    <div className="mt-0.5 flex justify-between font-mono-tab text-[11px] text-[var(--text-secondary)]">
                      <span>H = {d.entropy_bits} bits ({Math.round(d.entropy_norm * 100)}%)</span>
                      <span>{d.unique_artists} art. · {d.hours}h</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Plus H est élevé, plus vous explorez sur cet appareil.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
