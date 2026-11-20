import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Cpu, Disc3, Mountain, Sparkles } from 'lucide-react'
import { apiGet, type FilterState } from '../api/client'
import { UnifiedObservatoryCanvas } from '../components/UnifiedObservatoryCanvas'
import type { ThemePolarity } from '../hooks/useUrlFilters'
import { usePlayerStore } from '../store/playerStore'

interface Observatory3DPageProps {
  filters: FilterState
  theme: ThemePolarity
  calm: boolean
}

export function Observatory3DPage({ filters, theme, calm }: Observatory3DPageProps) {
  const mode = usePlayerStore((s) => s.observatoryMode)
  const setMode = usePlayerStore((s) => s.setObservatoryMode)
  const gpu = usePlayerStore((s) => s.gpuMetrics)
  const openDrawer = usePlayerStore((s) => s.openDrawer)

  const { data: erasData } = useQuery({
    queryKey: ['v3-eras', filters],
    queryFn: () => apiGet('/api/v3/analytics/eras', filters),
    placeholderData: keepPreviousData,
  })

  const { data: collectorData } = useQuery({
    queryKey: ['v3-collector', filters],
    queryFn: () => apiGet('/api/v3/collector/atelier', filters),
    placeholderData: keepPreviousData,
  })

  const { data: graphData } = useQuery({
    queryKey: ['v3-graph2d-for-3d', filters],
    queryFn: () => apiGet('/api/v3/analytics/graph2d', filters, { limit: 120 }),
    placeholderData: keepPreviousData,
  })

  const modes: { id: 'ridgeline' | 'vinyls' | 'constellation'; label: string; desc: string; icon: typeof Mountain }[] = [
    {
      id: 'ridgeline',
      label: 'Topographie Ridgeline 3D',
      desc: 'Relief hebdomadaire de vos genres et ères musicales',
      icon: Mountain,
    },
    {
      id: 'vinyls',
      label: 'Bac à Vinyles 3D',
      desc: 'Pochettes 3D cliquables recto/verso (Cover Art Archive)',
      icon: Disc3,
    },
    {
      id: 'constellation',
      label: 'Constellation Harmonique',
      desc: 'InstancedMesh 120 artistes + filaments de co-occurrence',
      icon: Sparkles,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="font-mono-tab text-[10px] uppercase tracking-wider text-[var(--accent)]">
            OBSERVATOIRE 3D · CANVAS UNIQUE PERSISTANT
          </div>
          <h1 className="font-display text-2xl font-bold text-[var(--text-strong)]">
            Immersion Spatiale Maîtrisée (Zéro Néon · 0 % GPU au repos)
          </h1>
        </div>

        {/* Live GPU Performance Budget Telemetry (PDF p. 13) */}
        <div className="flex flex-wrap items-center gap-2 font-mono-tab text-[11px]">
          <span className="flex items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1 text-[var(--text-primary)]">
            <Cpu className="h-3.5 w-3.5 text-[var(--accent-ok)]" />
            {gpu.renderer}
          </span>
          <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1 text-[var(--text-primary)]">
            Draw calls : <strong className="text-[var(--accent-ok)]">{gpu.drawCalls}</strong> / 100
          </span>
          <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1 text-[var(--text-primary)]">
            DPR : <strong>{gpu.dpr}×</strong> (≤ 2×)
          </span>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="grid gap-3 md:grid-cols-3">
        {modes.map((m) => {
          const Icon = m.icon
          const active = mode === m.id
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              data-testid={`obs-mode-${m.id}`}
              className={`surface-card flex items-start gap-3 p-3.5 text-left ${
                active ? 'border-[var(--accent)] bg-[var(--bg-surface-2)]' : ''
              }`}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: active ? 'var(--accent)' : 'var(--text-secondary)' }} />
              <div>
                <div className="text-xs font-semibold text-[var(--text-strong)]">{m.label}</div>
                <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{m.desc}</div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Single Persistent Three.js Canvas */}
      <UnifiedObservatoryCanvas
        mode={mode}
        theme={theme}
        calm={calm}
        ridgeline={erasData?.ridgeline}
        vinyls={collectorData?.quilt}
        constellation={graphData}
        onSelectArtist={(key, label) => openDrawer({ type: 'artist', key, label })}
        onSelectAlbum={(key, label) => openDrawer({ type: 'album', key, label })}
      />
    </div>
  )
}
