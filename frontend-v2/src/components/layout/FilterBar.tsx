import { Calendar, Clock, Filter, Hash, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../store/AppContext'
import { PeriodMode, SkipMode } from '../../types'
import { formatMonthFr } from '../../utils/format'

export function FilterBar() {
  const { filters, updateFilter, setFilters, resetFilters, filterOptions } = useApp()
  const [showAdvanced, setShowAdvanced] = useState(false)

  const activeAdvancedCount = [
    filters.artist,
    filters.genre,
    filters.decade !== null ? '1' : null,
    filters.container_type,
    filters.device,
    filters.offline,
  ].filter(Boolean).length

  const hasAnyFilter =
    filters.period_mode !== 'all' ||
    filters.skip_mode !== 'lastfm' ||
    activeAdvancedCount > 0

  const handlePeriodMode = (mode: PeriodMode) => {
    setFilters((prev) => ({
      ...prev,
      period_mode: mode,
      year: mode === 'year' ? prev.year ?? filterOptions?.years[0] ?? null : mode === 'season' ? prev.year : null,
      month: mode === 'month' ? prev.month ?? filterOptions?.months[0] ?? null : null,
      season: mode === 'season' ? prev.season ?? 'Été' : null,
      date_from: mode === 'custom' ? prev.date_from ?? filterOptions?.meta?.min_date ?? null : null,
      date_to: mode === 'custom' ? prev.date_to ?? filterOptions?.meta?.max_date ?? null : null,
    }))
  }

  return (
    <div className="glass-panel rounded-2xl p-3 md:px-4 md:py-3 mb-6 sticky top-3 z-30">
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Period Mode Pill Group */}
        <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-xl border border-white/[0.06]">
          <Calendar className="w-3.5 h-3.5 text-zinc-400 ml-1.5 mr-1 shrink-0" />
          {(
            [
              ['all', 'Tout'],
              ['year', 'Année'],
              ['month', 'Mois'],
              ['season', 'Saison'],
              ['custom', 'Plage'],
            ] as [PeriodMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => handlePeriodMode(mode)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                filters.period_mode === mode
                  ? 'bg-white text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Contextual Period Picker */}
        {filters.period_mode === 'year' && (
          <select
            value={filters.year ?? ''}
            onChange={(e) => updateFilter('year', e.target.value ? Number(e.target.value) : null)}
            className="bg-white/[0.06] border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono-num text-white focus:outline-none focus:border-rose-400/60"
          >
            {filterOptions?.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}

        {filters.period_mode === 'month' && (
          <select
            value={filters.month ?? ''}
            onChange={(e) => updateFilter('month', e.target.value || null)}
            className="bg-white/[0.06] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-rose-400/60"
          >
            {filterOptions?.months.map((m) => (
              <option key={m} value={m}>
                {formatMonthFr(m)}
              </option>
            ))}
          </select>
        )}

        {filters.period_mode === 'season' && (
          <div className="flex items-center gap-1.5">
            <select
              value={filters.season ?? 'Été'}
              onChange={(e) => updateFilter('season', e.target.value)}
              className="bg-white/[0.06] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
            >
              {filterOptions?.seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={filters.year ?? ''}
              onChange={(e) => updateFilter('year', e.target.value ? Number(e.target.value) : null)}
              className="bg-white/[0.06] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs font-mono-num text-white focus:outline-none"
            >
              <option value="">Toutes années</option>
              {filterOptions?.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}

        {filters.period_mode === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={filters.date_from ?? ''}
              onChange={(e) => updateFilter('date_from', e.target.value || null)}
              className="bg-white/[0.06] border border-white/10 rounded-xl px-2.5 py-1 text-xs font-mono-num text-white"
            />
            <span className="text-zinc-500 text-xs">→</span>
            <input
              type="date"
              value={filters.date_to ?? ''}
              onChange={(e) => updateFilter('date_to', e.target.value || null)}
              className="bg-white/[0.06] border border-white/10 rounded-xl px-2.5 py-1 text-xs font-mono-num text-white"
            />
          </div>
        )}

        {/* Skip / Threshold Selector */}
        <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-xl border border-white/[0.06]">
          <Sparkles className="w-3.5 h-3.5 text-rose-400 ml-1.5 mr-0.5 shrink-0" />
          {(
            [
              ['lastfm', 'Sans skips (Last.fm)'],
              ['all', 'Toutes lectures'],
              ['custom', 'Seuil custom'],
            ] as [SkipMode, string][]
          ).map(([sm, label]) => (
            <button
              key={sm}
              type="button"
              onClick={() => updateFilter('skip_mode', sm)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                filters.skip_mode === sm
                  ? 'bg-rose-500/90 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom skip threshold controls */}
        {filters.skip_mode === 'custom' && (
          <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-xl px-2.5 py-1 text-xs">
            <label className="flex items-center gap-1 text-zinc-300">
              <span>≥</span>
              <input
                type="number"
                min={0}
                max={300}
                value={filters.min_seconds}
                onChange={(e) => updateFilter('min_seconds', Math.max(0, Number(e.target.value) || 0))}
                className="w-12 bg-black/40 border border-white/15 rounded px-1.5 py-0.5 font-mono-num text-white text-center"
              />
              <span>s</span>
            </label>
            <span className="text-zinc-500">&</span>
            <label className="flex items-center gap-1 text-zinc-300">
              <span>≥</span>
              <input
                type="number"
                min={0}
                max={100}
                value={filters.min_completion_pct}
                onChange={(e) => updateFilter('min_completion_pct', Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                className="w-12 bg-black/40 border border-white/15 rounded px-1.5 py-0.5 font-mono-num text-white text-center"
              />
              <span>%</span>
            </label>
          </div>
        )}

        <div className="flex-1" />

        {/* Metric Switcher (Time vs Plays) */}
        <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-xl border border-white/[0.06]">
          <button
            type="button"
            onClick={() => updateFilter('metric', 'ms')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              filters.metric === 'ms' ? 'bg-indigo-500 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Temps
          </button>
          <button
            type="button"
            onClick={() => updateFilter('metric', 'plays')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              filters.metric === 'plays' ? 'bg-indigo-500 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Hash className="w-3.5 h-3.5" />
            Écoutes
          </button>
        </div>

        {/* Advanced filters toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
            showAdvanced || activeAdvancedCount > 0
              ? 'bg-white/10 border-white/20 text-white'
              : 'bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-white'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filtres
          {activeAdvancedCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-mono-num">
              {activeAdvancedCount}
            </span>
          )}
        </button>

        {hasAnyFilter && (
          <button
            type="button"
            onClick={resetFilters}
            title="Réinitialiser tous les filtres"
            className="p-1.5 rounded-xl bg-white/[0.04] hover:bg-white/10 border border-white/[0.08] text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Collapsible Advanced Filters Row */}
      {showAdvanced && (
        <div className="mt-3 pt-3 border-t border-white/[0.07] grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Artiste</label>
            <select
              value={filters.artist ?? ''}
              onChange={(e) => updateFilter('artist', e.target.value || null)}
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
            >
              <option value="">Tous les artistes</option>
              {filterOptions?.artists.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Genre</label>
            <select
              value={filters.genre ?? ''}
              onChange={(e) => updateFilter('genre', e.target.value || null)}
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
            >
              <option value="">Tous les genres</option>
              {filterOptions?.genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Décennie</label>
            <select
              value={filters.decade ?? ''}
              onChange={(e) => updateFilter('decade', e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono-num text-white"
            >
              <option value="">Toutes époques</option>
              {filterOptions?.decades.map((d) => (
                <option key={d} value={d}>
                  Années {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Contexte / Source</label>
            <select
              value={filters.container_type ?? ''}
              onChange={(e) => updateFilter('container_type', e.target.value || null)}
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
            >
              <option value="">Toutes sources</option>
              {filterOptions?.containers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Appareil</label>
            <select
              value={filters.device ?? ''}
              onChange={(e) => updateFilter('device', e.target.value || null)}
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
            >
              <option value="">Tous appareils</option>
              {filterOptions?.devices.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Mode Hors-ligne</label>
            <select
              value={filters.offline ?? ''}
              onChange={(e) => updateFilter('offline', e.target.value || null)}
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
            >
              <option value="">En ligne & Hors-ligne</option>
              <option value="true">Hors-ligne uniquement</option>
              <option value="false">En ligne uniquement</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
