import { Compass, Hourglass, Info, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api/client'
import { EChartBox } from '../components/charts/EChartBox'
import { AnimatedCounter } from '../components/ui/AnimatedCounter'
import { useApp } from '../store/AppContext'
import { formatDurationMs } from '../utils/format'

export function PersonaPage() {
  const { filters, refreshKey } = useApp()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet('/api/analytics/persona', filters)
      .then((res) => !cancelled && setData(res))
      .catch(console.error)
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [filters, refreshKey])

  const radarOption = useMemo(() => {
    if (!data?.persona?.radial_scores?.length) return null
    const scores = data.persona.radial_scores
    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: 'rgba(10,10,16,0.95)',
        borderColor: 'rgba(255,255,255,0.14)',
        textStyle: { color: '#fff', fontSize: 12 },
      },
      radar: {
        radius: '68%',
        indicator: scores.map((s: any) => ({ name: s.axis, max: 100 })),
        splitNumber: 4,
        axisName: { color: '#e4e4e7', fontSize: 12, fontWeight: 600 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.09)' } },
        splitArea: { areaStyle: { color: ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.035)'] } },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: scores.map((s: any) => s.score),
              name: data.persona.title,
              symbol: 'circle',
              symbolSize: 7,
              lineStyle: { width: 2.5, color: data.persona.accent || '#fa2d48' },
              itemStyle: { color: data.persona.accent || '#fa2d48' },
              areaStyle: { color: `${data.persona.accent || '#fa2d48'}44` },
            },
          ],
        },
      ],
    }
  }, [data])

  const decadesOption = useMemo(() => {
    if (!data?.listening_age?.years?.length) return null
    const years = data.listening_age.years
    return {
      backgroundColor: 'transparent',
      grid: { left: 10, right: 14, top: 18, bottom: 26, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(10,10,16,0.95)',
        borderColor: 'rgba(255,255,255,0.14)',
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (params: any) => {
          const p = params[0]
          const yObj = years[p.dataIndex]
          return `<div><b>Année ${yObj.year}</b><br/><span style="font-family:JetBrains Mono;color:#fda4af">${formatDurationMs(yObj.total_ms)} · ${yObj.plays} écoutes</span></div>`
        },
      },
      xAxis: {
        type: 'category',
        data: years.map((y: any) => String(y.year)),
        axisLabel: { color: '#9ca3af', fontSize: 10, fontFamily: 'JetBrains Mono' },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
      },
      yAxis: {
        type: 'value',
        name: 'Minutes',
        nameTextStyle: { color: '#71717a', fontSize: 10 },
        axisLabel: { color: '#71717a', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 18,
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#fa2d48' },
                { offset: 1, color: '#6366f1' },
              ],
            },
          },
          data: years.map((y: any) => Math.round(y.total_ms / 60000)),
        },
      ],
    }
  }, [data])

  if (loading && !data) return <div className="h-72 rounded-3xl bg-white/[0.04] animate-pulse" />
  if (!data) return null

  const { listening_age, persona } = data

  return (
    <div className="space-y-6">
      {/* Top Hero Row: Listening Age + Listener Archetype */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Listening Age Card */}
        <div className="glass-panel rounded-3xl p-6 md:p-7 flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold">
              <Hourglass className="w-3.5 h-3.5" />
              Âge d'écoute musical
            </div>

            <div className="flex items-baseline gap-4">
              <span className="text-6xl md:text-7xl font-bold text-white tracking-tight">
                {listening_age.age ? <AnimatedCounter value={listening_age.age} /> : '—'}
              </span>
              <span className="text-xl text-zinc-400 font-display">ans</span>
            </div>

            <div className="grid grid-cols-3 gap-2.5 pt-2">
              <div className="glass-card rounded-xl p-3">
                <p className="text-[10px] uppercase text-zinc-500">Année médiane</p>
                <p className="text-lg font-bold font-mono-num text-white mt-0.5">
                  {listening_age.weighted_median_year ?? '—'}
                </p>
              </div>
              <div className="glass-card rounded-xl p-3">
                <p className="text-[10px] uppercase text-zinc-500">Année moyenne</p>
                <p className="text-lg font-bold font-mono-num text-zinc-200 mt-0.5">
                  {listening_age.weighted_mean_year ?? '—'}
                </p>
              </div>
              <div className="glass-card rounded-xl p-3">
                <p className="text-[10px] uppercase text-zinc-500">Décennie de cœur</p>
                <p className="text-lg font-bold font-mono-num text-amber-300 mt-0.5">
                  {listening_age.heart_decade ?? '—'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-start gap-2.5 text-xs text-zinc-400">
            <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
            <div>
              <p>{listening_age.formula_explanation}</p>
              <p className="text-[11px] text-zinc-500 mt-1 font-mono-num">
                Couverture des années de sortie : {listening_age.dated_coverage_pct}% du temps d'écoute.
              </p>
            </div>
          </div>
        </div>

        {/* Persona Archetype Card */}
        <div className="glass-panel rounded-3xl p-6 md:p-7 flex flex-col justify-between">
          <div className="space-y-3">
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border"
              style={{
                backgroundColor: `${persona.accent}20`,
                borderColor: `${persona.accent}50`,
                color: persona.accent,
              }}
            >
              <Compass className="w-3.5 h-3.5" />
              Votre Archétype d'Auditeur
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-white">{persona.title}</h2>
            <p className="text-sm font-medium text-zinc-200 italic">« {persona.tagline} »</p>
            <p className="text-sm text-zinc-400 leading-relaxed">{persona.description}</p>
          </div>

          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {persona.radial_scores.map((s: any) => (
              <div key={s.axis} className="glass-card rounded-xl p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-400">{s.axis}</span>
                  <span className="font-mono-num text-xs font-bold text-white">{s.score}</span>
                </div>
                <p className="text-[10px] text-zinc-500 mt-1 leading-snug">{s.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Radar Chart + Eras Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-2 glass-panel rounded-3xl p-5 md:p-6">
          <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-rose-400" />
            Empreinte comportementale (6 axes)
          </h3>
          {radarOption && <EChartBox option={radarOption} height={300} />}
        </div>

        <div className="lg:col-span-3 glass-panel rounded-3xl p-5 md:p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white mb-1">Répartition par époques & années de sortie</h3>
            <p className="text-xs text-zinc-400 mb-4">Pondérée par votre temps d'écoute réel</p>

            {/* 4 Eras segmented bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
              {listening_age.eras.map((e: any, idx: number) => {
                const colors = ['text-amber-300', 'text-rose-300', 'text-indigo-300', 'text-emerald-300']
                return (
                  <div key={e.label} className="glass-card rounded-xl p-3">
                    <p className="text-[11px] text-zinc-400">{e.label}</p>
                    <p className={`text-xl font-bold font-mono-num mt-1 ${colors[idx]}`}>{e.share_pct}%</p>
                    <p className="text-[10px] font-mono-num text-zinc-500">{formatDurationMs(e.total_ms, true)}</p>
                  </div>
                )
              })}
            </div>
          </div>

          {decadesOption && <EChartBox option={decadesOption} height={210} />}
        </div>
      </div>
    </div>
  )
}
