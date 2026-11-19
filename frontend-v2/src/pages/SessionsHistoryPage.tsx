import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUpDown, Clock, Download, History, Layers, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { apiGet, buildFilterQuery } from '../api/client'
import { Artwork } from '../components/ui/Artwork'
import { useApp } from '../store/AppContext'
import { formatDateFr, formatDurationMs, formatNumber, formatTrackDuration } from '../utils/format'

export function SessionsHistoryPage() {
  const { filters, refreshKey, openDrawer } = useApp()
  const [subTab, setSubTab] = useState<'sessions' | 'history'>('sessions')

  // Sessions state
  const [sessions, setSessions] = useState<any[]>([])
  const [sessionsTotal, setSessionsTotal] = useState(0)
  const [sessionSort, setSessionSort] = useState<'recent' | 'longest' | 'most_plays'>('recent')
  const [loadingSessions, setLoadingSessions] = useState(false)

  // Virtualized history state
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortBy, setSortBy] = useState('started_at_local')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [loadingHistory, setLoadingHistory] = useState(false)
  const parentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 260)
    return () => clearTimeout(t)
  }, [searchInput])

  // Load Sessions
  useEffect(() => {
    if (subTab !== 'sessions') return
    let cancelled = false
    setLoadingSessions(true)
    apiGet('/api/sessions', filters, { limit: 60, sort: sessionSort })
      .then((res) => {
        if (cancelled) return
        setSessions(res.items || [])
        setSessionsTotal(res.total || 0)
      })
      .catch(console.error)
      .finally(() => !cancelled && setLoadingSessions(false))
    return () => {
      cancelled = true
    }
  }, [subTab, filters, sessionSort, refreshKey])

  // Load History (loads up to 2000 rows per chunk smoothly into virtualized table, with Load More for full 17k+)
  useEffect(() => {
    if (subTab !== 'history') return
    let cancelled = false
    setLoadingHistory(true)
    apiGet('/api/history', filters, {
      search: debouncedSearch,
      sort_by: sortBy,
      sort_dir: sortDir,
      limit: 2000,
      offset: 0,
    })
      .then((res) => {
        if (cancelled) return
        setHistoryItems(res.items || [])
        setHistoryTotal(res.total || 0)
      })
      .catch(console.error)
      .finally(() => !cancelled && setLoadingHistory(false))
    return () => {
      cancelled = true
    }
  }, [subTab, filters, debouncedSearch, sortBy, sortDir, refreshKey])

  const loadMoreHistory = async () => {
    if (loadingHistory || historyItems.length >= historyTotal) return
    setLoadingHistory(true)
    try {
      const res = await apiGet('/api/history', filters, {
        search: debouncedSearch,
        sort_by: sortBy,
        sort_dir: sortDir,
        limit: 2000,
        offset: historyItems.length,
      })
      setHistoryItems((prev) => [...prev, ...(res.items || [])])
    } finally {
      setLoadingHistory(false)
    }
  }

  const rowVirtualizer = useVirtualizer({
    count: historyItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 58,
    overscan: 14,
  })

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
  }

  const handleExportCsv = () => {
    const qs = buildFilterQuery(filters, { search: debouncedSearch })
    window.open(`/api/history/export.csv?${qs}`, '_blank')
  }

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 glass-panel p-1.5 rounded-2xl">
          <button
            type="button"
            onClick={() => setSubTab('sessions')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              subTab === 'sessions' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Sessions d'écoute
          </button>
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              subTab === 'history' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Historique complet (virtualisé)
          </button>
        </div>

        {subTab === 'sessions' ? (
          <div className="flex items-center gap-1.5 bg-white/[0.04] p-1 rounded-xl border border-white/10">
            {(
              [
                ['recent', 'Récentes'],
                ['longest', 'Plus longues'],
                ['most_plays', 'Plus de titres'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSessionSort(k)}
                className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                  sessionSort === k ? 'bg-rose-500 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Rechercher titre, artiste, album…"
                className="bg-white/[0.05] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-zinc-500 w-64 focus:outline-none focus:border-rose-400/60"
              />
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/15 border border-white/10 text-xs font-medium text-white cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        )}
      </div>

      {/* Sessions View */}
      {subTab === 'sessions' ? (
        <div className="space-y-3.5">
          <p className="text-xs text-zinc-400">
            {formatNumber(sessionsTotal)} sessions reconstituées (écoutes espacées de moins de 30 minutes).
          </p>

          {loadingSessions && sessions.length === 0 ? (
            <div className="space-y-3 animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-32 rounded-2xl bg-white/[0.04]" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => (
                <div key={s.session_id} className="glass-panel rounded-2xl p-4 md:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-white/[0.07]">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openDrawer({ type: 'day', id: s.local_date })}
                        className="text-sm font-bold text-white hover:text-rose-300 cursor-pointer"
                      >
                        {formatDateFr(s.local_date)}
                      </button>
                      <span className="font-mono-num text-xs text-zinc-400">
                        {s.start_local.slice(11, 16)} → {s.end_local.slice(11, 16)}
                      </span>
                      {s.device_label && (
                        <span className="px-2 py-0.5 rounded-full bg-white/[0.05] text-[10px] text-zinc-300">
                          {s.device_label}
                        </span>
                      )}
                      {s.playlist_name && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-[10px] text-rose-300">
                          {s.playlist_name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono-num text-xs">
                      <span className="text-white font-bold flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-rose-400" />
                        {formatDurationMs(s.total_ms, true)}
                      </span>
                      <span className="text-zinc-400">{s.plays} titres</span>
                    </div>
                  </div>

                  {/* Mini horizontal track timeline */}
                  <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                    {s.tracks.map((t: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] shrink-0 max-w-[230px]"
                      >
                        <Artwork
                          url={t.artwork_url}
                          alt={t.song_name}
                          size="xs"
                          previewUrl={t.preview_url}
                          songName={t.song_name}
                          artistName={t.artist_name}
                          albumName={t.album_name}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{t.song_name}</p>
                          <p className="text-[10px] text-zinc-400 truncate">
                            {t.artist_name || 'Inconnu'} · {t.started_at_local.slice(11, 16)}
                          </p>
                        </div>
                      </div>
                    ))}
                    {s.plays > s.tracks.length && (
                      <button
                        type="button"
                        onClick={() => openDrawer({ type: 'day', id: s.local_date })}
                        className="px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/10 text-xs text-zinc-300 shrink-0 cursor-pointer"
                      >
                        +{s.plays - s.tracks.length} autres…
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Virtualized History Table */
        <div className="glass-panel rounded-3xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between text-xs text-zinc-400">
            <span className="font-mono-num">
              {formatNumber(historyItems.length)} / {formatNumber(historyTotal)} événements affichés
            </span>
            {historyItems.length < historyTotal && (
              <button
                type="button"
                onClick={loadMoreHistory}
                disabled={loadingHistory}
                className="px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium cursor-pointer"
              >
                {loadingHistory ? 'Chargement…' : 'Charger +2 000 lignes'}
              </button>
            )}
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.07] text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
            <button
              type="button"
              onClick={() => toggleSort('started_at_local')}
              className="col-span-2 flex items-center gap-1 text-left hover:text-white cursor-pointer"
            >
              Date <ArrowUpDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => toggleSort('song_name')}
              className="col-span-4 flex items-center gap-1 text-left hover:text-white cursor-pointer"
            >
              Titre & Album <ArrowUpDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => toggleSort('artist_name')}
              className="col-span-2 flex items-center gap-1 text-left hover:text-white cursor-pointer"
            >
              Artiste <ArrowUpDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => toggleSort('play_duration_ms')}
              className="col-span-1 flex items-center gap-1 justify-end hover:text-white cursor-pointer"
            >
              Durée <ArrowUpDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => toggleSort('completion_ratio')}
              className="col-span-1 flex items-center gap-1 justify-end hover:text-white cursor-pointer"
            >
              % <ArrowUpDown className="w-3 h-3" />
            </button>
            <div className="col-span-2 text-right">Appareil / Source</div>
          </div>

          {/* Virtualized Scroll Body */}
          <div ref={parentRef} className="h-[580px] overflow-y-auto relative">
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const ev = historyItems[vRow.index]
                return (
                  <div
                    key={ev.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${vRow.size}px`,
                      transform: `translateY(${vRow.start}px)`,
                    }}
                    className="grid grid-cols-12 gap-2 items-center px-4 border-b border-white/[0.04] hover:bg-white/[0.04] transition-colors text-xs"
                  >
                    <div className="col-span-2 font-mono-num text-[11px] text-zinc-400">
                      <div>{ev.local_date}</div>
                      <div className="text-zinc-500">{ev.started_at_local.slice(11, 16)}</div>
                    </div>

                    <div className="col-span-4 flex items-center gap-2.5 min-w-0">
                      <Artwork
                        url={ev.artwork_url}
                        alt={ev.song_name}
                        size="xs"
                        previewUrl={ev.preview_url}
                        songName={ev.song_name}
                        artistName={ev.artist_name}
                        albumName={ev.album_name}
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">{ev.song_name}</p>
                        <p className="text-[11px] text-zinc-500 truncate">{ev.album_name}</p>
                      </div>
                    </div>

                    <div className="col-span-2 truncate">
                      {ev.artist_group_key ? (
                        <button
                          type="button"
                          onClick={() =>
                            openDrawer({ type: 'artist', id: ev.artist_group_key, title: ev.artist_name })
                          }
                          className="text-zinc-200 hover:text-rose-300 truncate block max-w-full text-left cursor-pointer"
                        >
                          {ev.artist_name}
                        </button>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </div>

                    <div className="col-span-1 text-right font-mono-num text-zinc-200">
                      {formatTrackDuration(ev.play_duration_ms)}
                    </div>

                    <div className="col-span-1 text-right font-mono-num">
                      <span
                        className={
                          ev.completion_ratio >= 0.8
                            ? 'text-emerald-400'
                            : ev.completion_ratio < 0.3
                            ? 'text-rose-400'
                            : 'text-zinc-300'
                        }
                      >
                        {Math.round(ev.completion_ratio * 100)}%
                      </span>
                    </div>

                    <div className="col-span-2 text-right truncate text-[11px] text-zinc-400">
                      <div className="truncate">{ev.device_label}</div>
                      <div className="text-[10px] text-zinc-500 truncate">{ev.playlist_name || ev.container_type}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
