import { CheckCircle2, Loader2, Pause, Play, Sparkles } from 'lucide-react'
import { useApp } from '../../store/AppContext'

export function EnrichmentBanner() {
  const { enrichment } = useApp()
  if (!enrichment || !enrichment.total) return null

  const pct = Math.min(100, Math.round((enrichment.completed / Math.max(1, enrichment.total)) * 100))
  const isDone = !enrichment.running && pct >= 99

  const handleToggle = async () => {
    await fetch(enrichment.running ? '/api/enrichment/stop' : '/api/enrichment/start', { method: 'POST' })
  }

  return (
    <div className="px-3 py-2.5 rounded-xl bg-white/[0.035] border border-white/[0.07] text-xs">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-zinc-300 font-medium">
          {isDone ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : enrichment.running ? (
            <Loader2 className="w-3.5 h-3.5 text-rose-400 animate-spin shrink-0" />
          ) : (
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          )}
          <span className="truncate">
            {isDone ? 'Catalogue enrichi' : enrichment.running ? 'Enrichissement iTunes' : 'Enrichissement en pause'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono-num text-[11px] text-zinc-400">{pct}%</span>
          {!isDone && (
            <button
              type="button"
              onClick={handleToggle}
              title={enrichment.running ? 'Mettre en pause' : 'Reprendre'}
              className="p-1 rounded-md hover:bg-white/10 text-zinc-400 hover:text-white cursor-pointer"
            >
              {enrichment.running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>

      <div className="w-full h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isDone ? 'bg-emerald-400' : 'bg-gradient-to-r from-rose-500 via-fuchsia-500 to-indigo-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-500 font-mono-num">
        <span>{enrichment.with_artwork ?? enrichment.enriched} pochettes</span>
        <span>
          {enrichment.completed}/{enrichment.total}
        </span>
      </div>
      {enrichment.running && enrichment.current_track && (
        <p className="mt-1 text-[10px] text-zinc-400 truncate" title={enrichment.current_track}>
          {enrichment.current_track}
        </p>
      )}
    </div>
  )
}
