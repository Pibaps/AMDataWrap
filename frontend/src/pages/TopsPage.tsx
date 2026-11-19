import { Disc3, Mic2, Music2, Tag } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiGet } from '../api/client'
import { Artwork } from '../components/ui/Artwork'
import { useApp } from '../store/AppContext'
import { formatDateFr, formatDurationMs, formatNumber } from '../utils/format'

type TopTab = 'artists' | 'albums' | 'tracks' | 'genres'

export function TopsPage() {
  const { filters, refreshKey, openDrawer } = useApp()
  const [tab, setTab] = useState<TopTab>('artists')
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet(`/api/analytics/tops/${tab}`, filters, { limit: tab === 'genres' ? 40 : 100 })
      .then((res) => {
        if (cancelled) return
        setItems(res.items || [])
        setTotal(res.total ?? (res.items?.length || 0))
      })
      .catch(console.error)
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [tab, filters, refreshKey])

  const maxMetric = items.length
    ? Math.max(...items.map((it) => (filters.metric === 'plays' ? it.plays : it.total_ms))) || 1
    : 1

  return (
    <div className="space-y-5">
      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 glass-panel p-1.5 rounded-2xl">
          {(
            [
              ['artists', 'Artistes', Mic2],
              ['albums', 'Albums', Disc3],
              ['tracks', 'Titres', Music2],
              ['genres', 'Genres', Tag],
            ] as [TopTab, string, any][]
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                tab === id
                  ? 'bg-white text-black shadow-md'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <span className="text-xs font-mono-num text-zinc-400">
          {formatNumber(total)} {tab === 'artists' ? 'artistes' : tab === 'albums' ? 'albums' : tab === 'tracks' ? 'titres' : 'genres'}
        </span>
      </div>

      {/* List */}
      <div className="glass-panel rounded-3xl p-4 md:p-5">
        {loading && items.length === 0 ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : tab === 'genres' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map((g) => (
              <div key={g.genre} className="glass-card rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono-num text-xs text-zinc-500 w-6">#{g.rank}</span>
                    <span className="text-sm font-bold text-white">{g.genre}</span>
                  </div>
                  <span className="font-mono-num text-xs font-bold text-rose-400">{g.share_pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden mb-2.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-rose-500 via-fuchsia-500 to-indigo-500"
                    style={{ width: `${Math.min(100, g.share_pct * 2.4)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono-num text-zinc-400">
                  <span>{formatDurationMs(g.total_ms)}</span>
                  <span>
                    {formatNumber(g.plays)} écoutes · {g.unique_artists} artistes · {g.avg_completion_pct}% compl.
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const val = filters.metric === 'plays' ? item.plays : item.total_ms
              const barPct = Math.max(3, Math.round((val / maxMetric) * 100))
              const title =
                tab === 'artists' ? item.artist_name : tab === 'albums' ? item.album_name : item.song_name
              const subtitle =
                tab === 'artists'
                  ? `${item.unique_tracks} titres · ${item.unique_albums} albums${item.primary_genre ? ` · ${item.primary_genre}` : ''}`
                  : tab === 'albums'
                  ? `${item.artist_name || 'Inconnu'}${item.release_year ? ` · ${item.release_year}` : ''}`
                  : `${item.artist_name || 'Inconnu'} · ${item.album_name}`

              const handleClick = () => {
                if (tab === 'artists') openDrawer({ type: 'artist', id: item.artist_group_key, title: item.artist_name })
                else if (tab === 'albums') openDrawer({ type: 'album', id: item.album_group_key, title: item.album_name })
                else if (item.artist_group_key) openDrawer({ type: 'artist', id: item.artist_group_key, title: item.artist_name })
              }

              return (
                <div
                  key={item.track_key || item.album_group_key || item.artist_group_key}
                  onClick={handleClick}
                  className="group relative flex items-center gap-3.5 p-3 rounded-2xl bg-white/[0.02] hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all cursor-pointer"
                >
                  <span
                    className={`font-mono-num text-sm font-bold w-7 text-right shrink-0 ${
                      item.rank <= 3 ? 'text-rose-400' : 'text-zinc-500'
                    }`}
                  >
                    {item.rank}
                  </span>

                  <Artwork
                    url={item.artwork_url}
                    alt={title}
                    size="md"
                    rounded={tab === 'artists' ? 'full' : 'lg'}
                    previewUrl={item.preview_url}
                    songName={item.song_name}
                    artistName={item.artist_name}
                    albumName={item.album_name}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-white truncate group-hover:text-rose-200 transition-colors">
                        {title}
                      </p>
                      <div className="flex items-center gap-3 shrink-0 font-mono-num">
                        <span className="text-xs font-bold text-white">
                          {filters.metric === 'plays'
                            ? `${formatNumber(item.plays)} écoutes`
                            : formatDurationMs(item.total_ms, true)}
                        </span>
                        <span className="text-[11px] text-zinc-500 hidden sm:inline">
                          {filters.metric === 'plays'
                            ? formatDurationMs(item.total_ms, true)
                            : `${formatNumber(item.plays)}×`}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-zinc-400 truncate mt-0.5">{subtitle}</p>

                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-rose-500 via-fuchsia-500 to-indigo-500 transition-all duration-500"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <div className="hidden md:flex items-center gap-3 text-[10px] font-mono-num text-zinc-500 shrink-0">
                        <span>Skip {item.skip_rate_pct}%</span>
                        <span>Compl. {item.avg_completion_pct}%</span>
                        <span>Déc. {formatDateFr(item.first_discovered)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
