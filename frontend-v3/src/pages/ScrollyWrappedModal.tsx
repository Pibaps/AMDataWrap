import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Volume2, VolumeX, X } from 'lucide-react'
import { apiGet, type FilterState } from '../api/client'
import { reactiveAudio } from '../audio/reactiveAudio'
import { EChartCanvas } from '../components/EChartCanvas'
import { usePlayerStore } from '../store/playerStore'
import { formatHours, formatNumber } from '../utils/apca'

interface ScrollyWrappedModalProps {
  filters: FilterState
}

/**
 * Wrapped « Essai Visuel Scrollytelling » (Phase 4 · Inspiration The Pudding).
 * Driven by IntersectionObserver (Scrollama pattern): sticky right-hand visualization
 * morphs organically as the user scrolls through editorial story chapters while 30s audio
 * previews crossfade seamlessly (when sound is enabled).
 */
export function ScrollyWrappedModal({ filters }: ScrollyWrappedModalProps) {
  const open = usePlayerStore((s) => s.wrappedOpen)
  const setOpen = usePlayerStore((s) => s.setWrappedOpen)
  const [activeStep, setActiveStep] = useState(0)
  const [soundOn, setSoundOn] = useState(false)
  const stepRefs = useRef<(HTMLElement | null)[]>([])

  const { data } = useQuery({
    queryKey: ['v3-wrapped-scrolly', filters],
    queryFn: () => apiGet('/api/v3/wrapped/scrollytelling', filters),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // IntersectionObserver (Scrollama engine)
  useEffect(() => {
    if (!open || !data) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.step || 0)
            setActiveStep(idx)
          }
        }
      },
      { threshold: 0.55 }
    )
    stepRefs.current.forEach((el) => {
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [open, data])

  // Auto-play chapter soundtrack when Sound is toggled ON
  useEffect(() => {
    if (!open || !soundOn || !data) return
    const topTracks = data.wrapped?.summary_card?.top_tracks || []
    const pick = topTracks[activeStep % Math.max(topTracks.length, 1)] || data.wrapped?.top_track
    if (pick?.preview_url) {
      void reactiveAudio.play(pick)
    }
  }, [activeStep, soundOn, open, data])

  if (!open) return null

  const w = data?.wrapped
  const kpis = w?.kpis
  const eras = data?.eras?.eras || []
  const compass = data?.compass
  const science = data?.science
  const atlas = data?.atlas
  const iceberg = data?.iceberg

  const totalHours = Number((kpis?.total_hours ?? (kpis?.total_ms || 0) / 3_600_000).toFixed(1))
  const parisTokyoFlights = (totalHours / 13.5).toFixed(1)
  const topArtist = w?.top_artist
  const topTrack = w?.top_track

  const chapters = [
    {
      tag: '01 · OUVERTURE',
      title: `${totalHours} heures d'immersion sonore`,
      body: `Sur la période ${w?.period_label || ''}, tu as accumulé ${formatNumber(kpis?.plays)} écoutes validées — l'équivalent de ${parisTokyoFlights} vols Paris → Tokyo en musique continue.`,
    },
    {
      tag: '02 · TES ÈRES MUSICALES (PELT)',
      title: `${eras.length || 1} chapitres esthétiques détectés`,
      body: eras[0]
        ? `L'algorithme PELT a identifié tes vrais virages musicaux sans découpage artificiel : notamment l'ère « ${eras[0].title} » (${eras[0].start_date} → ${eras[0].end_date}, ${eras[0].hours} h).`
        : 'Ton année forme une signature cohérente tout au long de la période.',
    },
    {
      tag: '03 · RYTHME AFFECTIF (RUSSELL)',
      title: 'Ta boussole émotionnelle au fil des 24 heures',
      body: `Croisant ton ADN audio et l'analyse de tes paroles, ton profil émotionnel trace une courbe diurne unique entre pics d'énergie et moments introspectifs.`,
    },
    {
      tag: '04 · TON ARTISTE PHARE',
      title: topArtist ? topArtist.artist_name : 'Artiste #1',
      body: topArtist
        ? `${formatHours(topArtist.total_ms)} passées ensemble (${topArtist.plays} écoutes). Un pilier incontournable de ton noyau effectif D_eff = ${science?.gini_artists?.effective_core ?? '—'}.`
        : '',
    },
    {
      tag: '05 · TON TITRE HYMNE',
      title: topTrack ? topTrack.song_name : 'Titre #1',
      body: topTrack
        ? `Signé ${topTrack.artist_name} · ${topTrack.plays ?? ''} écoutes (${formatHours(topTrack.total_ms)}). Nombre d'Eddington atteint : E = ${science?.eddington?.eddington ?? 0}.`
        : '',
    },
    {
      tag: '06 · GÉOGRAPHIE & OBSCURITÉ',
      title: `${atlas?.countries?.length ?? 0} pays · Indice d'obscurité ${iceberg?.obscurity_index ?? 0}/100`,
      body: `Verdict Iceberg : « ${iceberg?.verdict || 'Mélomane'} ». Ton empreinte géographique relie ${atlas?.mapped_count ?? 0} artistes cartographiés autour du globe.`,
    },
  ]

  // Sticky central ECharts option morphing smoothly per active chapter!
  const getStageOption = () => {
    if (activeStep === 1 && eras.length > 0) {
      return {
        grid: { left: 48, right: 20, top: 24, bottom: 40 },
        xAxis: { type: 'category', data: eras.map((e: any) => `Ère ${e.index + 1}`) },
        yAxis: { type: 'value', name: 'Heures' },
        series: [
          {
            type: 'bar',
            id: 'scrolly-main',
            universalTransition: { enabled: true },
            data: eras.map((e: any) => e.hours),
            itemStyle: { color: '#d46d3d', borderRadius: [6, 6, 0, 0] },
          },
        ],
      }
    }
    if (activeStep === 2 && compass?.diurnal_trajectory) {
      return {
        grid: { left: 42, right: 20, top: 24, bottom: 32 },
        xAxis: { type: 'category', data: compass.diurnal_trajectory.map((d: any) => `${d.hour}h`) },
        yAxis: { type: 'value', min: 0.2, max: 0.9 },
        series: [
          {
            type: 'line',
            id: 'scrolly-main',
            smooth: true,
            universalTransition: { enabled: true },
            data: compass.diurnal_trajectory.map((d: any) => d.arousal),
            lineStyle: { color: '#689cd2', width: 3 },
            areaStyle: { color: 'rgba(104,156,210,0.2)' },
          },
        ],
      }
    }
    if (activeStep === 5 && atlas?.countries?.length) {
      const topC = atlas.countries.slice(0, 8)
      return {
        grid: { left: 95, right: 20, top: 20, bottom: 28 },
        xAxis: { type: 'value', name: 'Heures' },
        yAxis: { type: 'category', inverse: true, data: topC.map((c: any) => c.country_name) },
        series: [
          {
            type: 'bar',
            id: 'scrolly-main',
            universalTransition: { enabled: true },
            data: topC.map((c: any) => c.hours),
            itemStyle: { color: '#5db08a', borderRadius: [0, 6, 6, 0] },
          },
        ],
      }
    }
    // Default / Opening / Top Artists bar morph
    const topA = (w?.summary_card?.top_artists || []).slice(0, 6)
    return {
      grid: { left: 110, right: 24, top: 20, bottom: 28 },
      xAxis: { type: 'value', name: 'Heures' },
      yAxis: { type: 'category', inverse: true, data: topA.map((a: any) => a.artist_name) },
      series: [
        {
          type: 'bar',
          id: 'scrolly-main',
          universalTransition: { enabled: true },
          data: topA.map((a: any) => Number(((a.total_ms || 0) / 3_600_000).toFixed(1))),
          itemStyle: { color: '#689cd2', borderRadius: [0, 6, 6, 0] },
        },
      ],
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#121214] text-[#e0e0e0]">
      {/* Top sticky controls */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-[#2e2e36] bg-[#16161a] px-5 py-3">
        <div>
          <span className="font-mono-tab text-[10px] uppercase tracking-widest text-[#d46d3d]">
            ESSAI VISUEL SCROLLYTELLING · THE PUDDING EDITION
          </span>
          <div className="font-serif-ed text-xl italic">AMDataWrap V3 Continuum Wrapped</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const next = !soundOn
              setSoundOn(next)
              if (!next) reactiveAudio.stop()
            }}
            className="flex items-center gap-1.5 rounded border border-[#3e3e49] bg-[#222228] px-3 py-1.5 text-xs"
          >
            {soundOn ? <Volume2 className="h-3.5 w-3.5 text-[#5db08a]" /> : <VolumeX className="h-3.5 w-3.5 text-[#a2a2ad]" />}
            {soundOn ? 'Son ON' : 'Muet'}
          </button>
          <button
            onClick={() => {
              reactiveAudio.stop()
              setOpen(false)
            }}
            data-testid="close-wrapped"
            className="rounded border border-[#3e3e49] bg-[#222228] p-1.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Two-column Scrollytelling Layout: Left Scrolling Story, Right Sticky Morphing Graphic */}
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-12">
        <div className="space-y-[32vh] pb-[35vh] lg:col-span-5">
          {chapters.map((ch, idx) => (
            <section
              key={idx}
              ref={(el) => {
                stepRefs.current[idx] = el
              }}
              data-step={idx}
              className={`rounded-xl border p-6 transition-all duration-200 ${
                activeStep === idx
                  ? 'border-[#689cd2] bg-[#1b1b20] opacity-100'
                  : 'border-[#2a2a32] bg-[#16161a] opacity-55'
              }`}
            >
              <div className="font-mono-tab text-[11px] tracking-widest text-[#c89446]">{ch.tag}</div>
              <h2 className="mt-2 font-serif-ed text-3xl leading-snug text-[#ebebef]">{ch.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-[#a2a2ad]">{ch.body}</p>
            </section>
          ))}
        </div>

        <div className="lg:col-span-7">
          <div className="sticky top-24 rounded-2xl border border-[#2e2e36] bg-[#18181d] p-6">
            <div className="mb-3 flex items-center justify-between font-mono-tab text-xs text-[#a2a2ad]">
              <span>CHAPITRE 0{activeStep + 1} / 0{chapters.length}</span>
              <span>MORPHING ECHARTS UNIVERSAL TRANSITION</span>
            </div>
            <EChartCanvas theme="dark" height={380} option={getStageOption()} />
            <div className="mt-4 flex justify-center gap-1.5">
              {chapters.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setActiveStep(idx)
                    stepRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }}
                  className={`h-1.5 rounded-full transition-all ${
                    activeStep === idx ? 'w-8 bg-[#d46d3d]' : 'w-2 bg-[#3e3e49]'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
