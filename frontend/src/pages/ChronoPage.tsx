import { CalendarDays, Clock4, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api/client'
import { EChartBox } from '../components/charts/EChartBox'
import { useApp } from '../store/AppContext'
import { formatDateFr, formatDurationMs, formatMonthFr, formatNumber } from '../utils/format'

const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const STREAM_COLORS = [
  '#fa2d48', '#818cf8', '#2dd4bf', '#f59e0b', '#e879f9',
  '#38bdf8', '#fb7185', '#a3e635', '#c084fc', '#fb923c',
]

export function ChronoPage() {
  const { filters, refreshKey, openDrawer } = useApp()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [evoMode, setEvoMode] = useState<'artists' | 'genres'>('artists')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet('/api/analytics/chronobiology', filters)
      .then((res) => !cancelled && setData(res))
      .catch(console.error)
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [filters, refreshKey])

  // Calendar Heatmap option (supports multi-year cleanly by showing available range)
  const calendarOption = useMemo(() => {
    if (!data?.heatmap?.length) return null
    const usePlays = filters.metric === 'plays'
    const items = data.heatmap
    const minDate = items[0].date
    const maxDate = items[items.length - 1].date
    const vals = items.map((d: any) => (usePlays ? d.plays : Math.round(d.total_ms / 60000)))
    const maxVal = Math.max(...vals, 1)

    // Group years present
    const years = Array.from(new Set(items.map((d: any) => d.date.slice(0, 4)))) as string[]

    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: 'rgba(10,10,16,0.95)',
        borderColor: 'rgba(255,255,255,0.14)',
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (p: any) => {
          const [dt, val, ms, plays] = p.data
          return `<div style="font-family:Plus Jakarta Sans">
            <div style="font-weight:700;margin-bottom:4px">${formatDateFr(dt)}</div>
            <div style="font-family:JetBrains Mono;color:#fda4af">${formatDurationMs(ms)} · ${plays} écoutes</div>
            <div style="font-size:10px;color:#9ca3af;margin-top:4px">Cliquer pour voir le détail du jour</div>
          </div>`
        },
      },
      visualMap: {
        min: 0,
        max: maxVal,
        show: false,
        inRange: {
          color: ['#151521', '#4c1d3d', '#9d174d', '#e11d48', '#fb7185'],
        },
      },
      calendar: years.map((yr, idx) => ({
        top: 32 + idx * 145,
        left: 42,
        right: 16,
        cellSize: ['auto', 14],
        range: years.length === 1 ? [minDate, maxDate] : yr,
        itemStyle: {
          color: '#11111a',
          borderWidth: 2,
          borderColor: '#08080c',
          borderRadius: 3,
        },
        splitLine: { show: false },
        yearLabel: { show: true, color: '#9ca3af', fontSize: 12, fontFamily: 'JetBrains Mono' },
        dayLabel: { firstDay: 1, nameMap: ['D', 'L', 'M', 'M', 'J', 'V', 'S'], color: '#71717a', fontSize: 10 },
        monthLabel: { color: '#a1a1aa', fontSize: 10 },
      })),
      series: years.map((yr, idx) => ({
        type: 'heatmap',
        coordinateSystem: 'calendar',
        calendarIndex: idx,
        data: items
          .filter((d: any) => d.date.startsWith(yr))
          .map((d: any) => [d.date, usePlays ? d.plays : Math.round(d.total_ms / 60000), d.total_ms, d.plays]),
      })),
    }
  }, [data, filters.metric])

  const calendarHeight = useMemo(() => {
    if (!data?.heatmap?.length) return 180
    const years = new Set(data.heatmap.map((d: any) => d.date.slice(0, 4)))
    return Math.max(185, years.size * 150 + 25)
  }, [data])

  // Hour x Day-of-Week Matrix
  const matrixOption = useMemo(() => {
    if (!data?.matrix?.length) return null
    const usePlays = filters.metric === 'plays'
    const map = new Map<string, any>()
    let maxVal = 1
    for (const m of data.matrix) {
      map.set(`${m.hour}-${m.dow}`, m)
      if (m.value > maxVal) maxVal = m.value
    }
    const gridData: any[] = []
    for (let h = 0; h < 24; h++) {
      for (let d = 0; d < 7; d++) {
        const hit = map.get(`${h}-${d}`)
        gridData.push([h, d, hit ? hit.value : 0, hit ? hit.total_ms : 0, hit ? hit.plays : 0])
      }
    }

    return {
      backgroundColor: 'transparent',
      grid: { left: 42, right: 14, top: 14, bottom: 28 },
      tooltip: {
        backgroundColor: 'rgba(10,10,16,0.95)',
        borderColor: 'rgba(255,255,255,0.14)',
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (p: any) => {
          const [h, d, , ms, plays] = p.data
          return `<div><b>${DOW[d]} · ${String(h).padStart(2, '0')}h–${String((h + 1) % 24).padStart(2, '0')}h</b><br/>
          <span style="font-family:JetBrains Mono;color:#a5b4fc">${formatDurationMs(ms)} · ${plays} écoutes</span></div>`
        },
      },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, i) => `${i}h`),
        axisLabel: { color: '#9ca3af', fontSize: 10, fontFamily: 'JetBrains Mono' },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: DOW,
        inverse: true,
        axisLabel: { color: '#a1a1aa', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      visualMap: {
        min: 0,
        max: maxVal,
        show: false,
        inRange: {
          color: ['#11111a', '#312e81', '#4f46e5', '#9333ea', '#ec4899', '#fb7185'],
        },
      },
      series: [
        {
          type: 'heatmap',
          data: gridData,
          itemStyle: { borderRadius: 4, borderWidth: 2, borderColor: '#0c0c14' },
        },
      ],
    }
  }, [data, filters.metric])

  // Evolution Stream / Stacked Area Chart
  const evoOption = useMemo(() => {
    if (!data?.evolution?.months?.length) return null
    const seriesSrc = evoMode === 'artists' ? data.evolution.artists : data.evolution.genres
    return {
      backgroundColor: 'transparent',
      color: STREAM_COLORS,
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(10,10,16,0.95)',
        borderColor: 'rgba(255,255,255,0.14)',
        textStyle: { color: '#fff', fontSize: 11 },
      },
      legend: {
        bottom: 0,
        textStyle: { color: '#a1a1aa', fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { left: 10, right: 16, top: 18, bottom: 56, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: data.evolution.months.map((m: string) => formatMonthFr(m)),
        axisLabel: { color: '#9ca3af', fontSize: 10 },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
      },
      yAxis: {
        type: 'value',
        name: filters.metric === 'plays' ? 'Écoutes' : 'Minutes',
        nameTextStyle: { color: '#71717a', fontSize: 10 },
        axisLabel: { color: '#71717a', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
      },
      series: seriesSrc.map((s: any) => ({
        name: s.name,
        type: 'line',
        stack: 'total',
        smooth: 0.35,
        showSymbol: false,
        lineStyle: { width: 1.5 },
        areaStyle: { opacity: 0.62 },
        emphasis: { focus: 'series' },
        data: s.values,
      })),
    }
  }, [data, evoMode, filters.metric])

  if (loading && !data) {
    return <div className="h-72 rounded-3xl bg-white/[0.04] animate-pulse" />
  }
  if (!data) return null

  return (
    <div className="space-y-6">
      {/* 1. GitHub-style Calendar Heatmap */}
      <div className="glass-panel rounded-3xl p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-rose-400" />
              Calendrier d'activité jour par jour
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Cliquez sur n'importe quel jour pour explorer la liste complète des morceaux écoutés.
            </p>
          </div>
          <span className="text-xs font-mono-num text-zinc-400">
            {formatNumber(data.heatmap.length)} jours actifs
          </span>
        </div>

        {calendarOption && (
          <EChartBox
            option={calendarOption}
            height={calendarHeight}
            onChartClick={(p) => {
              if (p?.data?.[0]) {
                openDrawer({ type: 'day', id: p.data[0] })
              }
            }}
          />
        )}
      </div>

      {/* 2. Hour x Day-of-Week Matrix + Time Slots */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass-panel rounded-3xl p-5 md:p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Clock4 className="w-4 h-4 text-indigo-400" />
                Matrice Heure × Jour de la semaine
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">Vos créneaux horaires de prédilection</p>
            </div>
            <span className="px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-mono-num">
              Pic à {String(data.peak_hour).padStart(2, '0')}h
            </span>
          </div>
          {matrixOption && <EChartBox option={matrixOption} height={240} />}
        </div>

        <div className="glass-panel rounded-3xl p-5 md:p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white mb-1">Rythme circadien</h3>
            <p className="text-xs text-zinc-400 mb-5">Répartition selon les 4 moments de la journée</p>
            <div className="space-y-4">
              {data.time_slots.map((s: any, idx: number) => {
                const gradients = [
                  'from-amber-400 to-orange-500',
                  'from-sky-400 to-indigo-500',
                  'from-rose-500 to-fuchsia-500',
                  'from-violet-500 to-indigo-700',
                ]
                return (
                  <div key={s.label}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-zinc-200 font-medium">{s.label}</span>
                      <span className="font-mono-num text-zinc-300 font-semibold">
                        {s.share_pct}%{' '}
                        <span className="text-zinc-500 font-normal">
                          ({filters.metric === 'plays' ? `${formatNumber(s.value)}×` : `${s.value}h`})
                        </span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${gradients[idx % gradients.length]}`}
                        style={{ width: `${s.share_pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Taste Evolution Streamgraph */}
      <div className="glass-panel rounded-3xl p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-fuchsia-400" />
              Évolution des goûts mois par mois
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Flux cumulé de votre Top {evoMode === 'artists' ? '10 artistes' : '8 genres'} dans le temps
            </p>
          </div>
          <div className="flex items-center gap-1 bg-white/[0.05] p-1 rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => setEvoMode('artists')}
              className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                evoMode === 'artists' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Top 10 Artistes
            </button>
            <button
              type="button"
              onClick={() => setEvoMode('genres')}
              className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                evoMode === 'genres' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Top 8 Genres
            </button>
          </div>
        </div>
        {evoOption && <EChartBox option={evoOption} height={330} />}
      </div>
    </div>
  )
}
