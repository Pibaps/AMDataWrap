import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  Laptop,
  Radio,
  RefreshCw,
  Send,
  Upload,
} from 'lucide-react'
import { apiGet, apiPost } from '../api/client'

export function ContinuumHubPage() {
  const qc = useQueryClient()
  const { data: status, refetch } = useQuery({
    queryKey: ['continuum-status'],
    queryFn: () => apiGet('/api/v3/continuum/status'),
    refetchInterval: 10_000,
  })
  const { data: jobsData, refetch: refetchJobs } = useQuery({
    queryKey: ['v3-jobs-status'],
    queryFn: () => apiGet('/api/v3/jobs/status'),
    refetchInterval: 8_000,
  })

  const [lbUser, setLbUser] = useState('')
  const [lbToken, setLbToken] = useState('')
  const [lfmUser, setLfmUser] = useState('')
  const [lfmKey, setLfmKey] = useState('')
  const [setlistKey, setSetlistKey] = useState('')
  const [discogsToken, setDiscogsToken] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const saveProvider = useMutation({
    mutationFn: ({ provider, body }: { provider: string; body: any }) =>
      apiPost(`/api/v3/continuum/providers/${provider}`, body),
    onSuccess: (_, vars) => {
      setFeedback(`Configuration enregistrée pour ${vars.provider}.`)
      void refetch()
    },
  })

  const syncProvider = useMutation({
    mutationFn: (provider: string) => apiPost(`/api/v3/continuum/sync/${provider}`),
    onSuccess: (res: any) => {
      if (res.ok) {
        setFeedback(
          `${res.provider} synchronisé : ${res.inserted} ajoutés, ${res.upgraded} enrichis, ${res.deduplicated} dédupliqués.`
        )
      } else {
        setFeedback(`${res.provider} : ${res.error}${res.hint ? ` — ${res.hint}` : ''}`)
      }
      void refetch()
      void qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })

  const testLocalReceiver = async () => {
    const res = await apiPost('/apis/listenbrainz/1/submit-listens', {
      listen_type: 'playing_now',
      payload: [
        {
          track_metadata: {
            artist_name: 'Daft Punk',
            track_name: 'Veridis Quo (Test Récepteur Local)',
            release_name: 'Discovery',
            additional_info: { media_player: 'Pano Scrobbler Test' },
          },
        },
      ],
    })
    setFeedback(`Récepteur local actif ! Statut : ${res.status} (Now Playing mis à jour).`)
    void refetch()
  }

  const handleZipUpload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const resp = await fetch('/api/import', { method: 'POST', body: fd })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.message || data.detail || 'Erreur import ZIP')
      setFeedback(`Archive importée (${data.summary.total_play_events} écoutes, FTS5 + Parquet reconstruits).`)
      void qc.invalidateQueries()
    } catch (e: any) {
      setFeedback(e.message)
    } finally {
      setUploading(false)
    }
  }

  const receiverUrl = `${window.location.origin}/apis/listenbrainz/1/submit-listens`
  const byProv = Object.fromEntries((status?.providers || []).map((p: any) => [p.provider, p]))

  return (
    <div className="space-y-5">
      {/* Header & Truth Hierarchy Summary */}
      <div className="surface-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono-tab text-[10px] uppercase tracking-wider text-[var(--accent)]">
              PHASE 1 &amp; 2 · HUB TEMPS RÉEL CONTINUUM &amp; MOTEUR DE FUSION
            </div>
            <h1 className="font-display text-2xl font-bold text-[var(--text-strong)]">
              Alimentation Continue, Réconciliation &amp; Open Music Graph
            </h1>
            <p className="mt-1 max-w-3xl text-xs text-[var(--text-secondary)]">
              Hiérarchie de vérité terrain : <code className="font-mono-tab text-[var(--text-strong)]">apple_rgpd_zip (100) &gt; local_smtc (70) &gt; local_receiver (55) &gt; listenbrainz / lastfm (50)</code>.
              Fenêtre de déduplication temporelle ±180 s et imputation transparente des durées (<code className="font-mono-tab">duration_is_estimated</code>).
            </p>
          </div>
          <label className="tactile-btn flex cursor-pointer items-center gap-2 px-3.5 py-2 text-xs font-medium">
            <Upload className="h-4 w-4 text-[var(--accent)]" />
            <span>{uploading ? 'Import en cours...' : 'Importer ZIP Apple Music'}</span>
            <input
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => void handleZipUpload(e.target.files?.[0])}
            />
          </label>
        </div>

        {feedback && (
          <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--accent)] bg-[var(--bg-surface-2)] px-3 py-2 text-xs text-[var(--text-strong)]">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--accent-ok)]" />
            <span>{feedback}</span>
          </div>
        )}

        {/* Source breakdown strip */}
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(status?.source_breakdown || []).map((b: any) => (
            <div key={b.provider} className="surface-card-2 p-3 text-xs">
              <div className="font-mono-tab text-[10px] uppercase text-[var(--text-muted)]">{b.provider}</div>
              <div className="mt-0.5 font-mono-tab text-lg font-bold text-[var(--text-strong)]">
                {b.plays} éc. <span className="text-xs font-normal text-[var(--text-secondary)]">({b.hours} h)</span>
              </div>
              {b.estimated_plays > 0 && (
                <div className="font-mono-tab text-[10px] text-[var(--accent-warm)]">
                  {b.estimated_plays} durées estimées
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 4 Real-Time Connectors Grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1. ListenBrainz (Recommended, 100% Free) */}
        <div className="surface-card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-[var(--accent-ok)]" />
              <h2 className="font-display text-base font-bold text-[var(--text-strong)]">
                1. ListenBrainz (Recommandé · 100 % Gratuit)
              </h2>
            </div>
            <span className="rounded-full bg-[var(--accent-ok)]/15 px-2 py-0.5 font-mono-tab text-[10px] text-[var(--accent-ok)]">
              OPEN SOURCE
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Synchronisation incrémentale (<code className="font-mono-tab">min_ts / max_ts</code>) + écoute en direct (<code className="font-mono-tab">playing-now</code>) + export playlists JSPF.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              placeholder={byProv.listenbrainz?.username || 'Pseudo ListenBrainz'}
              value={lbUser}
              onChange={(e) => setLbUser(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-strong)]"
            />
            <input
              type="password"
              placeholder={byProv.listenbrainz?.has_token ? 'Token enregistré (optionnel)' : 'User Token (optionnel / playlists)'}
              value={lbToken}
              onChange={(e) => setLbToken(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-strong)]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() =>
                saveProvider.mutate({
                  provider: 'listenbrainz',
                  body: { enabled: true, username: lbUser || byProv.listenbrainz?.username, token: lbToken || undefined },
                })
              }
              className="tactile-btn px-3 py-1.5 text-xs font-medium"
            >
              Enregistrer
            </button>
            <button
              onClick={() => syncProvider.mutate('listenbrainz')}
              className="flex items-center gap-1.5 rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Synchroniser maintenant
            </button>
          </div>
        </div>

        {/* 2. Local Scrobble Receiver (Pano Scrobbler / AMWin-RP / Multi-Scrobbler) */}
        <div className="surface-card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-[var(--enc-blue)]" />
              <h2 className="font-display text-base font-bold text-[var(--text-strong)]">
                2. Récepteur Local (Pano Scrobbler / Multi-Scrobbler)
              </h2>
            </div>
            <span className="rounded-full bg-[var(--accent-ok)]/15 px-2 py-0.5 font-mono-tab text-[10px] text-[var(--accent-ok)]">
              ACTIF
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Pointez <strong>Pano Scrobbler</strong> (Android Motorola/Realme/Samsung), <strong>AMWin-RP</strong> (Windows), <strong>FastScrobbler</strong> ou <strong>Multi-Scrobbler</strong> vers votre serveur AMDataWrap :
          </p>
          <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 font-mono-tab text-[11px] text-[var(--accent)]">
            POST {receiverUrl}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void testLocalReceiver()} className="tactile-btn px-3 py-1.5 text-xs font-medium">
              Tester un événement Now Playing
            </button>
            <span className="font-mono-tab text-[11px] text-[var(--text-muted)]">
              Token accepté : n&apos;importe quelle chaîne (local)
            </span>
          </div>
        </div>

        {/* 3. Native Windows SMTC Sensor */}
        <div className="surface-card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Laptop className="h-4 w-4 text-[var(--enc-ochre)]" />
              <h2 className="font-display text-base font-bold text-[var(--text-strong)]">
                3. Capteur Natif Windows SMTC (0 Cloud · Polling 1s)
              </h2>
            </div>
            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2 py-0.5 font-mono-tab text-[10px]">
              {status?.smtc_supported ? (status?.smtc_running ? 'EN ÉCOUTE' : 'PRÊT WINDOWS') : 'WINDOWS UNIQUEMENT'}
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Sonde <code className="font-mono-tab">GlobalSystemMediaTransportControlsSessionManager</code> toutes les 1 s sur PC Windows (évitant le bug d&apos;événements WinRT Python) et applique la règle Last.fm (≥ 50 % ou ≥ 4 min).
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => syncProvider.mutate('local_smtc')}
              className="tactile-btn px-3 py-1.5 text-xs font-medium"
            >
              Démarrer capteur SMTC
            </button>
          </div>
        </div>

        {/* 4. Last.fm (Optional — Dec 1, 2026 Pro Gate Warning) */}
        <div className="surface-card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--accent-warn)]" />
              <h2 className="font-display text-base font-bold text-[var(--text-strong)]">
                4. Last.fm (Optionnel · API Pro au 1er déc. 2026)
              </h2>
            </div>
            <span className="rounded-full bg-[var(--accent-warn)]/15 px-2 py-0.5 font-mono-tab text-[10px] text-[var(--accent-warn)]">
              PRO REQUIS
            </span>
          </div>
          <div className="rounded border border-[var(--accent-warn)]/40 bg-[var(--accent-warn)]/10 p-2.5 text-[11px] text-[var(--text-primary)]">
            {status?.lastfm_pro_notice}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              placeholder={byProv.lastfm?.username || 'Pseudo Last.fm'}
              value={lfmUser}
              onChange={(e) => setLfmUser(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-strong)]"
            />
            <input
              type="password"
              placeholder={byProv.lastfm?.has_api_key ? 'Clé API enregistrée' : 'Clé API Last.fm Pro'}
              value={lfmKey}
              onChange={(e) => setLfmKey(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-strong)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() =>
                saveProvider.mutate({
                  provider: 'lastfm',
                  body: { enabled: true, username: lfmUser || byProv.lastfm?.username, api_key: lfmKey || undefined },
                })
              }
              className="tactile-btn px-3 py-1.5 text-xs"
            >
              Enregistrer
            </button>
            <button onClick={() => syncProvider.mutate('lastfm')} className="tactile-btn px-3 py-1.5 text-xs text-[var(--accent-warn)]">
              Synchroniser Last.fm
            </button>
          </div>
        </div>
      </div>

      {/* Phase 2 Storage & Persistent Background Jobs Monitor (Parquet/DuckDB + MusicBrainz + Setlist.fm + Discogs) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface-card space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[var(--accent)]" />
            <h2 className="font-display text-base font-bold text-[var(--text-strong)]">
              Parquet / DuckDB &amp; File Persistante (MusicBrainz 1 req/s)
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono-tab text-xs">
            <div className="surface-card-2 p-2.5">
              <div className="text-[10px] text-[var(--text-muted)]">PARQUET ROWS</div>
              <div className="text-base font-bold text-[var(--text-strong)]">{jobsData?.parquet?.rows ?? 0}</div>
            </div>
            <div className="surface-card-2 p-2.5">
              <div className="text-[10px] text-[var(--text-muted)]">JOBS PENDING / DONE</div>
              <div className="text-base font-bold text-[var(--text-strong)]">
                {jobsData?.jobs?.pending ?? 0} / {jobsData?.jobs?.done ?? 0}
              </div>
            </div>
            <div className="surface-card-2 p-2.5">
              <div className="text-[10px] text-[var(--text-muted)]">ARTISTES GÉO</div>
              <div className="text-base font-bold text-[var(--accent-ok)]">{jobsData?.jobs?.artists_geolocated ?? 0}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                await apiPost('/api/v3/parquet/rebuild')
                setFeedback('Instantané Parquet atomique reconstruit.')
                void refetchJobs()
              }}
              className="tactile-btn flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <HardDrive className="h-3.5 w-3.5" /> Reconstruire Parquet
            </button>
            <button
              onClick={async () => {
                const res = await apiPost('/api/v3/jobs/seed')
                setFeedback(`${res.queued} tâches MusicBrainz/Wikidata mises en file (1 req/s).`)
                void refetchJobs()
              }}
              className="tactile-btn px-3 py-1.5 text-xs"
            >
              Lancer file MusicBrainz + Wikidata
            </button>
          </div>
        </div>

        <div className="surface-card space-y-3 p-4">
          <h2 className="font-display text-base font-bold text-[var(--text-strong)]">
            Connecteurs Culturels Optionnels (Setlist.fm &amp; Discogs)
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="password"
              placeholder="Clé API Setlist.fm (2 req/s, 1440/j)"
              value={setlistKey}
              onChange={(e) => setSetlistKey(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-strong)]"
            />
            <input
              type="password"
              placeholder="Token Discogs (60 req/min)"
              value={discogsToken}
              onChange={(e) => setDiscogsToken(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-strong)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (setlistKey) saveProvider.mutate({ provider: 'setlistfm', body: { enabled: true, api_key: setlistKey } })
                if (discogsToken) saveProvider.mutate({ provider: 'discogs', body: { enabled: true, token: discogsToken } })
              }}
              className="tactile-btn px-3 py-1.5 text-xs"
            >
              Enregistrer clés culturelles
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
