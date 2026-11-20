import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play, Search, X } from 'lucide-react'
import { apiGet } from '../api/client'
import { reactiveAudio } from '../audio/reactiveAudio'
import { usePlayerStore } from '../store/playerStore'
import { formatHours } from '../utils/apca'

export function FtsSearchModal() {
  const open = usePlayerStore((s) => s.searchOpen)
  const setOpen = usePlayerStore((s) => s.setSearchOpen)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!open)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 160)
    return () => clearTimeout(id)
  }, [query])

  const { data, isFetching } = useQuery({
    queryKey: ['fts5-search', debounced],
    queryFn: () => apiGet('/api/v3/search', undefined, { q: debounced, limit: 25 }),
    enabled: open && debounced.length >= 1,
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-16" onClick={() => setOpen(false)}>
      <div
        className="surface-card w-full max-w-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <Search className="h-4 w-4 text-[var(--accent)]" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Recherche SQLite FTS5 (unicode61 sans accents + trigram + paroles)..."
            className="w-full bg-transparent text-sm text-[var(--text-strong)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <button onClick={() => setOpen(false)} className="tactile-btn p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-3">
          {!debounced && (
            <p className="p-4 text-center text-xs text-[var(--text-secondary)]">
              Tapez un titre, artiste, album, genre ou extrait de paroles. Exemple : <code className="font-mono-tab">deja</code> retrouve automatiquement <code className="font-mono-tab">Déjà</code>.
            </p>
          )}
          {debounced && isFetching && (
            <p className="p-4 text-center font-mono-tab text-xs text-[var(--text-secondary)]">Recherche FTS5...</p>
          )}
          {data?.tracks?.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 py-1 font-mono-tab text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Catalogue ({data.tracks.length})
              </div>
              {data.tracks.map((t: any) => (
                <div
                  key={t.track_key}
                  className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-[var(--bg-surface-2)]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-[var(--text-strong)]">{t.song_name}</div>
                    <div className="truncate text-[11px] text-[var(--text-secondary)]">
                      {t.artist_name} · {t.album_name} {t.release_year ? `(${t.release_year})` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded bg-[var(--bg-surface-3)] px-1.5 py-0.5 font-mono-tab text-[10px] text-[var(--text-muted)]">
                      {t.match_source === 'fts5_trigram' ? 'trigram' : 'unicode61'}
                    </span>
                    <span className="font-mono-tab text-xs text-[var(--text-secondary)]">
                      {t.total_plays} · {formatHours(t.total_ms)}
                    </span>
                    {t.preview_url && (
                      <button
                        onClick={() => reactiveAudio.play(t)}
                        className="tactile-btn p-1.5 text-[var(--accent)]"
                        title="Écouter extrait 30s"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data?.lyrics_matches?.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-[var(--border-subtle)] pt-3">
              <div className="px-2 py-1 font-mono-tab text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Paroles indexées ({data.lyrics_matches.length})
              </div>
              {data.lyrics_matches.map((l: any) => (
                <div key={l.track_key} className="rounded-lg bg-[var(--bg-surface-2)] px-3 py-2 text-xs">
                  <div className="font-semibold text-[var(--text-strong)]">
                    {l.song_name} — {l.artist_name}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{l.snippet}</div>
                </div>
              ))}
            </div>
          )}

          {debounced && !isFetching && data && data.total === 0 && (
            <p className="p-6 text-center text-xs text-[var(--text-secondary)]">Aucun résultat pour « {debounced} ».</p>
          )}
        </div>
      </div>
    </div>
  )
}
