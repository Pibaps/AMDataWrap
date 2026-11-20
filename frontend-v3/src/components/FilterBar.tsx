import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { FilterState } from '../api/client'
import type { VisualEdition } from '../hooks/useUrlFilters'

interface FilterOptions {
  years: number[]
  months: string[]
  seasons: string[]
  genres: string[]
  decades: number[]
  devices: string[]
  containers: string[]
}

interface FilterBarProps {
  edition: VisualEdition
  filters: FilterState
  options?: FilterOptions
  onPatch: (u: Record<string, any>) => void
  onReset: () => void
}

/**
 * OP-1 Field / Braun Atelier Rotary Encoder (Edition 1: Studio Hi-Fi Field).
 * Click cycles values smoothly with tactile hardware dial feedback.
 */
function FieldEncoder({
  color,
  label,
  valueLabel,
  stepIndex,
  totalSteps,
  onClick,
}: {
  color: string
  label: string
  valueLabel: string
  stepIndex: number
  totalSteps: number
  onClick: () => void
}) {
  const angle = -130 + (stepIndex / Math.max(totalSteps - 1, 1)) * 260
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface-1)] px-2.5 py-1.5 text-left transition-colors hover:border-[var(--border-strong)]"
    >
      <div
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 shadow-inner"
        style={{ borderColor: color, backgroundColor: 'var(--bg-surface-2)' }}
      >
        <div
          className="h-3.5 w-1 origin-bottom rounded-full"
          style={{
            backgroundColor: color,
            transform: `translateY(-4px) rotate(${angle}deg)`,
          }}
        />
      </div>
      <div className="min-w-0">
        <div className="font-mono-tab text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
        <div className="max-w-[110px] truncate font-mono-tab text-xs font-semibold text-[var(--text-strong)]">
          {valueLabel}
        </div>
      </div>
    </button>
  )
}

export function FilterBar({ edition, filters, options, onPatch, onReset }: FilterBarProps) {
  const years = options?.years || []
  const months = options?.months || []
  const genres = options?.genres || []
  const devices = options?.devices || []

  const periodModes: FilterState['period_mode'][] = ['all', 'year', 'month', 'season']
  const skipModes: FilterState['skip_mode'][] = ['lastfm', 'all', 'custom']

  const cyclePeriod = () => {
    const idx = (periodModes.indexOf(filters.period_mode) + 1) % periodModes.length
    const next = periodModes[idx]
    onPatch({
      period_mode: next,
      year: next === 'year' ? years[years.length - 1] ?? null : null,
      month: next === 'month' ? months[months.length - 1] ?? null : null,
      season: next === 'season' ? 'Été' : null,
    })
  }

  const cycleSkip = () => {
    const idx = (skipModes.indexOf(filters.skip_mode) + 1) % skipModes.length
    onPatch({ skip_mode: skipModes[idx] })
  }

  const cycleMetric = () => {
    onPatch({ metric: filters.metric === 'ms' ? 'plays' : 'ms' })
  }

  const cycleGenre = () => {
    const list = [null, ...genres.slice(0, 8)]
    const idx = (list.indexOf(filters.genre) + 1) % list.length
    onPatch({ genre: list[idx] })
  }

  const hasActiveFilter =
    filters.period_mode !== 'all' ||
    filters.skip_mode !== 'lastfm' ||
    filters.metric !== 'ms' ||
    !!filters.genre ||
    !!filters.device ||
    !!filters.artist ||
    filters.decade !== null ||
    !!filters.offline

  return (
    <section className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface-1)]/60">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-2.5 px-4 py-2.5">
        {edition === 'field' ? (
          /* 4 Signature OP-1 Field Color-Coded Functional Encoders */
          <div className="flex flex-wrap items-center gap-2">
            <FieldEncoder
              color="var(--enc-blue)"
              label="ENC 1 · PÉRIODE"
              valueLabel={
                filters.period_mode === 'all'
                  ? 'TOUT'
                  : filters.period_mode === 'year'
                    ? String(filters.year || 'ANNÉE')
                    : filters.period_mode === 'month'
                      ? filters.month || 'MOIS'
                      : filters.season || 'SAISON'
              }
              stepIndex={periodModes.indexOf(filters.period_mode)}
              totalSteps={periodModes.length}
              onClick={cyclePeriod}
            />
            <FieldEncoder
              color="var(--enc-ochre)"
              label="ENC 2 · SKIPS"
              valueLabel={
                filters.skip_mode === 'lastfm' ? 'LAST.FM' : filters.skip_mode === 'all' ? 'TOUTES' : `≥${filters.min_seconds}s`
              }
              stepIndex={skipModes.indexOf(filters.skip_mode)}
              totalSteps={skipModes.length}
              onClick={cycleSkip}
            />
            <FieldEncoder
              color="var(--enc-gray)"
              label="ENC 3 · MÉTRIQUE"
              valueLabel={filters.metric === 'ms' ? 'TEMPS (H)' : 'ÉCOUTES'}
              stepIndex={filters.metric === 'ms' ? 0 : 1}
              totalSteps={2}
              onClick={cycleMetric}
            />
            <FieldEncoder
              color="var(--enc-orange)"
              label="ENC 4 · GENRE"
              valueLabel={filters.genre || 'TOUS'}
              stepIndex={filters.genre ? Math.max(1, genres.slice(0, 8).indexOf(filters.genre) + 1) : 0}
              totalSteps={Math.min(9, genres.length + 1)}
              onClick={cycleGenre}
            />
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Filtres</span>
          </div>
        )}

        {/* Precision Selectors (always accessible for exact tuning in every edition) */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="Mode de période"
            value={filters.period_mode}
            onChange={(e) => {
              const pm = e.target.value as FilterState['period_mode']
              onPatch({
                period_mode: pm,
                year: pm === 'year' ? years[years.length - 1] ?? null : null,
                month: pm === 'month' ? months[months.length - 1] ?? null : null,
                season: pm === 'season' ? 'Été' : null,
              })
            }}
            className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-[var(--text-primary)]"
          >
            <option value="all">Toute la période</option>
            <option value="year">Par année</option>
            <option value="month">Par mois</option>
            <option value="season">Par saison</option>
          </select>

          {filters.period_mode === 'year' && (
            <select
              aria-label="Année"
              value={filters.year ?? ''}
              onChange={(e) => onPatch({ year: e.target.value ? Number(e.target.value) : null })}
              className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 font-mono-tab text-[var(--text-primary)]"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}

          {filters.period_mode === 'month' && (
            <select
              aria-label="Mois"
              value={filters.month ?? ''}
              onChange={(e) => onPatch({ month: e.target.value || null })}
              className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 font-mono-tab text-[var(--text-primary)]"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}

          {filters.period_mode === 'season' && (
            <select
              aria-label="Saison"
              value={filters.season ?? 'Été'}
              onChange={(e) => onPatch({ season: e.target.value })}
              className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-[var(--text-primary)]"
            >
              {['Hiver', 'Printemps', 'Été', 'Automne'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}

          <select
            aria-label="Règle skips"
            value={filters.skip_mode}
            onChange={(e) => onPatch({ skip_mode: e.target.value })}
            className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-[var(--text-primary)]"
          >
            <option value="lastfm">Sans skips (Last.fm)</option>
            <option value="all">Toutes lectures</option>
            <option value="custom">Seuil personnalisé</option>
          </select>

          <select
            aria-label="Métrique"
            value={filters.metric}
            onChange={(e) => onPatch({ metric: e.target.value })}
            className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-[var(--text-primary)]"
          >
            <option value="ms">Classement : Temps</option>
            <option value="plays">Classement : Écoutes</option>
          </select>

          <select
            aria-label="Genre"
            value={filters.genre ?? ''}
            onChange={(e) => onPatch({ genre: e.target.value || null })}
            className="max-w-[150px] rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-[var(--text-primary)]"
          >
            <option value="">Tous genres</option>
            {genres.slice(0, 35).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <select
            aria-label="Appareil"
            value={filters.device ?? ''}
            onChange={(e) => onPatch({ device: e.target.value || null })}
            className="max-w-[155px] rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-[var(--text-primary)]"
          >
            <option value="">Tous appareils</option>
            {devices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={onReset}
              className="tactile-btn flex items-center gap-1 px-2.5 py-1.5 text-xs text-[var(--accent)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Réinitialiser</span>
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
