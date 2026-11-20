import { useQuery } from '@tanstack/react-query'
import { Calendar, Music2, Play, Ticket, X } from 'lucide-react'
import { apiGet, type FilterState } from '../api/client'
import { reactiveAudio } from '../audio/reactiveAudio'
import { usePlayerStore } from '../store/playerStore'
import { artworkProxyUrl, formatDurationMs, formatHours } from '../utils/apca'
import { EChartCanvas } from './EChartCanvas'

interface DetailDrawerProps {
  filters: FilterState
  theme: 'dark' | 'light'
}

export function DetailDrawer({ filters, theme }: DetailDrawerProps) {
  const drawer = usePlayerStore((s) => s.drawer)
  const openDrawer = usePlayerStore((s) => s.openDrawer)

  const endpoint =
    drawer?.type === 'artist'
      ? `/api/detail/artist/${encodeURIComponent(drawer.key)}`
      : drawer?.type === 'album'
        ? `/api/detail/album/${encodeURIComponent(drawer.key)}`
        : drawer?.type === 'day'
          ? `/api/detail/day/${encodeURIComponent(drawer.key)}`
          : null

  const { data, isLoading } = useQuery({
    queryKey: ['detail-drawer', drawer?.type, drawer?.key, filters],
    queryFn: () => apiGet(endpoint!, filters),
    enabled: Boolean(endpoint),
  })

  const artistName = drawer?.type === 'artist' ? data?.artist_name || drawer.label || '' : ''

  const { data: bio } = useQuery({
    queryKey: ['artist-bio', artistName],
    queryFn: () => apiGet('/api/external/artist-bio', undefined, { artist: artistName }),
    enabled: drawer?.type === 'artist' && Boolean(artistName),
    staleTime: 1000 * 60 * 60,
  })

  const { data: setlists } = useQuery({
    queryKey: ['artist-setlists', drawer?.key],
    queryFn: () => apiGet(`/api/v3/external/setlists/${encodeURIComponent(drawer!.key)}`),
    enabled: drawer?.type === 'artist' && Boolean(drawer?.key),
    staleTime: 1000 * 60 * 60,
  })

  if (!drawer) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55" onClick={() => openDrawer(null)}>
      <aside
        className="h-full w-full max-w-xl overflow-y-auto border-l border-[var(--border-strong)] bg-[var(--bg-surface-1)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <div className="min-w-0">
            <div className="font-mono-tab text-[10px] uppercase tracking-wider text-[var(--accent)]">
              {drawer.type === 'artist' ? 'FICHE ARTISTE' : drawer.type === 'album' ? 'FICHE ALBUM' : 'JOURNAL DU JOUR'}
            </div>
            <h2 className="truncate font-display text-xl font-bold text-[var(--text-strong)]">
              {drawer.type === 'artist'
                ? data?.artist_name || drawer.label || drawer.key
                : drawer.type === 'album'
                  ? data?.album_name || drawer.label || drawer.key
                  : drawer.key}
            </h2>
          </div>
          <button onClick={() => openDrawer(null)} className="tactile-btn p-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading && <p className="py-8 text-center font-mono-tab text-xs text-[var(--text-secondary)]">Chargement...</p>}

        {data && drawer.type === 'artist' && (
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              {artworkProxyUrl(data.artwork_url) && (
                <img
                  src={artworkProxyUrl(data.artwork_url)!}
                  alt={data.artist_name}
                  className="h-20 w-20 rounded-lg object-cover"
                />
              )}
              <div className="grid flex-1 grid-cols-3 gap-2">
                <div className="surface-card-2 p-2.5">
                  <div className="text-[10px] text-[var(--text-muted)]">TEMPS</div>
                  <div className="font-mono-tab text-sm font-bold text-[var(--text-strong)]">{formatHours(data.total_ms)}</div>
                </div>
                <div className="surface-card-2 p-2.5">
                  <div className="text-[10px] text-[var(--text-muted)]">ÉCOUTES</div>
                  <div className="font-mono-tab text-sm font-bold text-[var(--text-strong)]">{data.plays}</div>
                </div>
                <div className="surface-card-2 p-2.5">
                  <div className="text-[10px] text-[var(--text-muted)]">TITRES</div>
                  <div className="font-mono-tab text-sm font-bold text-[var(--text-strong)]">{data.unique_tracks}</div>
                </div>
              </div>
            </div>

            {bio?.found && (
              <div className="surface-card-2 p-3 text-xs leading-relaxed text-[var(--text-primary)]">
                <div className="mb-1 font-mono-tab text-[10px] uppercase text-[var(--text-muted)]">
                  Wikipédia ({bio.lang?.toUpperCase()}) {bio.description ? `· ${bio.description}` : ''}
                </div>
                {bio.summary}
              </div>
            )}

            {data.monthly?.length > 0 && (
              <div className="surface-card-2 p-3">
                <div className="mb-1 font-mono-tab text-[10px] uppercase text-[var(--text-muted)]">Évolution mensuelle</div>
                <EChartCanvas
                  theme={theme}
                  height={160}
                  option={{
                    grid: { left: 36, right: 12, top: 10, bottom: 24 },
                    xAxis: { type: 'category', data: data.monthly.map((m: any) => m.month) },
                    yAxis: { type: 'value' },
                    series: [
                      {
                        type: 'bar',
                        universalTransition: { enabled: true },
                        data: data.monthly.map((m: any) => Number((m.total_ms / 3_600_000).toFixed(2))),
                        itemStyle: { color: '#689cd2', borderRadius: [3, 3, 0, 0] },
                      },
                    ],
                  }}
                />
              </div>
            )}

            {/* Setlist.fm Concert Comparison */}
            <div className="surface-card-2 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono-tab text-[10px] uppercase text-[var(--text-muted)]">
                <Ticket className="h-3.5 w-3.5 text-[var(--accent)]" />
                <span>Concerts récents (Setlist.fm)</span>
              </div>
              {setlists?.found && setlists.setlists?.length > 0 ? (
                <div className="space-y-2">
                  {setlists.setlists.slice(0, 3).map((s: any, idx: number) => (
                    <div key={idx} className="rounded border border-[var(--border-subtle)] p-2 text-xs">
                      <div className="flex justify-between font-medium text-[var(--text-strong)]">
                        <span>{s.venue} ({s.city})</span>
                        <span className="font-mono-tab text-[var(--accent-ok)]">{s.known_ratio_pct}% connus</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{s.date} · {s.songs?.length || 0} titres joués</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--text-secondary)]">
                  {setlists?.hint || 'Configurez une clé gratuite Setlist.fm dans le Hub Continuum pour comparer ses setlists live avec vos écoutes.'}
                </p>
              )}
            </div>

            {data.top_tracks?.length > 0 && (
              <div>
                <h3 className="mb-2 font-mono-tab text-[11px] uppercase text-[var(--text-muted)]">Top Titres</h3>
                <div className="space-y-1">
                  {data.top_tracks.slice(0, 12).map((t: any, i: number) => (
                    <div key={t.track_key || i} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-[var(--bg-surface-2)]">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-[var(--text-strong)]">
                          {i + 1}. {t.song_name}
                        </div>
                        <div className="truncate text-[11px] text-[var(--text-secondary)]">{t.album_name}</div>
                      </div>
                      <div className="flex items-center gap-2 font-mono-tab text-xs text-[var(--text-secondary)]">
                        <span>{t.plays} · {formatHours(t.total_ms)}</span>
                        {t.preview_url && (
                          <button
                            onClick={() =>
                              reactiveAudio.play({
                                track_key: t.track_key,
                                song_name: t.song_name,
                                artist_name: data.artist_name,
                                album_name: t.album_name,
                                artwork_url: t.artwork_url || data.artwork_url,
                                preview_url: t.preview_url,
                              })
                            }
                            className="tactile-btn p-1 text-[var(--accent)]"
                          >
                            <Play className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {data && drawer.type === 'album' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--bg-surface-2)]">
                <Music2 className="h-6 w-6 text-[var(--accent)]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--text-strong)]">{data.artist_name}</div>
                <div className="font-mono-tab text-xs text-[var(--text-secondary)]">
                  {formatHours(data.total_ms)} · {data.plays} écoutes
                </div>
              </div>
            </div>
            <div className="space-y-1">
              {(data.tracks || []).map((t: any, i: number) => (
                <div key={t.track_key || i} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-[var(--bg-surface-2)]">
                  <span className="truncate text-xs text-[var(--text-primary)]">{i + 1}. {t.song_name}</span>
                  <span className="font-mono-tab text-xs text-[var(--text-secondary)]">{t.plays} · {formatHours(t.total_ms)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data && drawer.type === 'day' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-mono-tab text-xs text-[var(--text-secondary)]">
              <Calendar className="h-4 w-4 text-[var(--accent)]" />
              <span>{data.total_plays} écoutes · {formatHours(data.total_ms)}</span>
            </div>
            <div className="space-y-1">
              {(data.events || []).map((ev: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between gap-2 rounded bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--text-strong)]">{ev.song_name}</div>
                    <div className="truncate text-[11px] text-[var(--text-secondary)]">{ev.artist_name} · {ev.device_label}</div>
                  </div>
                  <div className="shrink-0 text-right font-mono-tab text-[11px] text-[var(--text-secondary)]">
                    <div>{(ev.started_at_local || '').slice(11, 16)}</div>
                    <div>{formatDurationMs(ev.play_duration_ms)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
