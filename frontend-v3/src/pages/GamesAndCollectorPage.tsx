import { useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { domToPng } from 'modern-screenshot'
import { Download, Gamepad2, Grid3x3, Layers, Play, RefreshCw, Sparkles, Trophy } from 'lucide-react'
import { apiGet, type FilterState } from '../api/client'
import { reactiveAudio } from '../audio/reactiveAudio'
import { usePlayerStore } from '../store/playerStore'
import { artworkProxyUrl } from '../utils/apca'

interface GamesAndCollectorPageProps {
  filters: FilterState
}

type ModeTab = 'iceberg' | 'blindtest' | 'collector'
type CollectorPiece = 'quilt' | 'pixelgrid' | 'festival' | 'receipt' | 'poster'

export function GamesAndCollectorPage({ filters }: GamesAndCollectorPageProps) {
  const [sub, setSub] = useState<ModeTab>('iceberg')
  const [piece, setPiece] = useState<CollectorPiece>('festival')
  const [quiltSize, setQuiltSize] = useState<3 | 4 | 5>(4)
  const [exporting, setExporting] = useState(false)

  // Blind-Test state
  const [quizSeed, setQuizSeed] = useState(() => Math.floor(Date.now() / 1000))
  const [qIdx, setQIdx] = useState(0)
  const [clueStep, setClueStep] = useState(1)
  const [selectedOpt, setSelectedOpt] = useState<string | null>(null)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [clipTimer, setClipTimer] = useState<number | null>(null)

  const collectorRef = useRef<HTMLDivElement | null>(null)
  const openDrawer = usePlayerStore((s) => s.openDrawer)

  const { data: iceberg } = useQuery({
    queryKey: ['v3-iceberg', filters],
    queryFn: () => apiGet('/api/v3/analytics/iceberg', filters, { limit: 120 }),
    placeholderData: keepPreviousData,
  })

  const { data: quiz } = useQuery({
    queryKey: ['v3-blindtest', filters, quizSeed],
    queryFn: () => apiGet('/api/v3/games/blind-test', filters, { rounds: 8, seed: quizSeed }),
    enabled: sub === 'blindtest',
  })

  const { data: atelier } = useQuery({
    queryKey: ['v3-collector', filters],
    queryFn: () => apiGet('/api/v3/collector/atelier', filters),
    placeholderData: keepPreviousData,
  })

  const { data: overview } = useQuery({
    queryKey: ['overview-for-collector', filters],
    queryFn: () => apiGet('/api/analytics/overview', filters),
    placeholderData: keepPreviousData,
  })

  const questions = quiz?.questions || []
  const currentQ = questions[qIdx]

  const playSnippet = (seconds: number) => {
    if (!currentQ?.preview_url) return
    if (clipTimer) window.clearTimeout(clipTimer)
    void reactiveAudio.play({
      song_name: 'Blind-Test Mystère',
      artist_name: `Extrait ${seconds}s`,
      preview_url: currentQ.preview_url,
    })
    const t = window.setTimeout(() => reactiveAudio.stop(), seconds * 1000)
    setClipTimer(t)
  }

  const answerOption = (optId: string) => {
    if (selectedOpt || !currentQ) return
    setSelectedOpt(optId)
    if (optId === currentQ.correct_id) {
      setScore((s) => s + 1)
      setStreak((st) => st + 1)
    } else {
      setStreak(0)
    }
  }

  const nextQuestion = () => {
    reactiveAudio.stop()
    setSelectedOpt(null)
    setClueStep(1)
    setQIdx((i) => i + 1)
  }

  const restartQuiz = () => {
    reactiveAudio.stop()
    setSelectedOpt(null)
    setClueStep(1)
    setQIdx(0)
    setScore(0)
    setStreak(0)
    setQuizSeed((s) => s + 1)
  }

  // Export HD PNG via modern-screenshot (replacing deprecated html2canvas!) + native Canvas 2D option for Pixel Grid
  const exportCollectorPng = async () => {
    setExporting(true)
    try {
      if (piece === 'pixelgrid' && atelier?.pixel_grid?.length) {
        // Native Canvas 2D crisp HD generator for Annual Pixel Grid
        const grid = atelier.pixel_grid as any[]
        const cols = 30
        const rows = Math.ceil(grid.length / cols)
        const cell = 28
        const pad = 48
        const c = document.createElement('canvas')
        c.width = cols * cell + pad * 2
        c.height = rows * cell + pad * 2 + 80
        const ctx = c.getContext('2d')!
        ctx.fillStyle = '#121214'
        ctx.fillRect(0, 0, c.width, c.height)
        ctx.fillStyle = '#e0e0e0'
        ctx.font = 'bold 24px "Space Grotesk", sans-serif'
        ctx.fillText('AMDataWrap V3 · Pixel Grid Annuel', pad, 46)
        ctx.fillStyle = '#a2a2ad'
        ctx.font = '14px "JetBrains Mono", monospace'
        ctx.fillText(`${atelier.min_date} → ${atelier.max_date} · ${atelier.total_hours} h (${grid.length} jours actifs)`, pad, 72)
        grid.forEach((d, idx) => {
          const x = pad + (idx % cols) * cell
          const y = 96 + Math.floor(idx / cols) * cell
          ctx.fillStyle = d.color || '#689cd2'
          ctx.fillRect(x, y, cell - 4, cell - 4)
        })
        const link = document.createElement('a')
        link.download = `amdatawrap_pixelgrid.png`
        link.href = c.toDataURL('image/png')
        link.click()
        return
      }
      if (!collectorRef.current) return
      const dataUrl = await domToPng(collectorRef.current, { scale: 2.5, backgroundColor: '#121214' })
      const link = document.createElement('a')
      link.download = `amdatawrap_${piece}_hd.png`
      link.href = dataUrl
      link.click()
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="font-mono-tab text-[10px] uppercase tracking-wider text-[var(--accent)]">
            PHASE 4 · EXPÉRIENCES LUDIQUES &amp; LIVRABLES COLLECTOR HD
          </div>
          <h1 className="font-display text-2xl font-bold text-[var(--text-strong)]">
            Iceberg Musical, Blind-Test Personnel &amp; Atelier Collector
          </h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'iceberg', label: 'Iceberg (8 strates)', icon: Layers },
            { id: 'blindtest', label: 'Blind-Test Personnel', icon: Gamepad2 },
            { id: 'collector', label: 'Atelier Collector HD', icon: Grid3x3 },
          ].map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setSub(t.id as ModeTab)}
                data-testid={`games-tab-${t.id}`}
                className={`flex items-center gap-1.5 rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-medium ${
                  sub === t.id
                    ? 'border border-[var(--accent)] bg-[var(--bg-surface-2)] text-[var(--text-strong)]'
                    : 'tactile-btn text-[var(--text-secondary)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 1. MUSIC ICEBERG (8 Depth Strata) */}
      {sub === 'iceberg' && (
        <div className="space-y-3">
          <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-mono-tab text-xs text-[var(--text-secondary)]">INDICE D&apos;OBSCURITÉ GLOBAL</div>
              <div className="font-display text-2xl font-bold text-[var(--text-strong)]">
                {iceberg?.obscurity_index ?? 0} / 100 · <span className="text-[var(--accent)]">{iceberg?.verdict}</span>
              </div>
            </div>
            <p className="max-w-md text-xs text-[var(--text-secondary)]">
              Classement en 8 strates de profondeur selon la popularité mondiale ListenBrainz (et rareté locale pour les artistes non encore indexés).
            </p>
          </div>

          <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)]">
            {(iceberg?.tiers || []).map((tier: any, idx: number) => {
              // Deep ocean APCA-safe matte gradient per stratum
              const depthBg = [
                '#22354a', '#1e3044', '#1a2a3d', '#162436',
                '#131e2e', '#101926', '#0e141f', '#0c1018',
              ][idx] || '#0c1018'
              return (
                <div
                  key={tier.level}
                  className="border-b border-white/10 p-4 last:border-b-0"
                  style={{ backgroundColor: depthBg }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono-tab text-xs font-bold uppercase tracking-wider text-[#e0e0e0]">
                      0{tier.level} · {tier.name}
                    </span>
                    <span className="text-[11px] text-[#a2a2ad]">{tier.subtitle}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {tier.artists.length > 0 ? (
                      tier.artists.slice(0, 18).map((a: any) => (
                        <button
                          key={a.artist_key}
                          onClick={() => openDrawer({ type: 'artist', key: a.artist_key, label: a.artist_name })}
                          className="rounded-md border border-white/15 bg-black/25 px-2.5 py-1 text-xs font-medium text-[#ebebef] transition-colors hover:border-[#689cd2]"
                        >
                          {a.artist_name}
                          <span className="ml-1.5 font-mono-tab text-[10px] text-[#a2a2ad]">{a.hours}h</span>
                        </button>
                      ))
                    ) : (
                      <span className="font-mono-tab text-[11px] text-[#7a7a86]">Strate vide sur cette période</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 2. PERSONAL BLIND-TEST (Bandle-inspired) */}
      {sub === 'blindtest' && (
        <div className="surface-card mx-auto max-w-2xl p-6">
          <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
            <div className="flex items-center gap-3 font-mono-tab text-xs">
              <span className="flex items-center gap-1 text-[var(--accent)]">
                <Trophy className="h-4 w-4" /> Score : <strong>{score}</strong> / {questions.length}
              </span>
              <span className="text-[var(--accent-ok)]">Streak : {streak}×</span>
            </div>
            <button onClick={restartQuiz} className="tactile-btn flex items-center gap-1 px-2.5 py-1 text-xs">
              <RefreshCw className="h-3.5 w-3.5" /> Nouvelle partie
            </button>
          </div>

          {!currentQ ? (
            <div className="py-10 text-center">
              <Sparkles className="mx-auto mb-3 h-10 w-10 text-[var(--accent)]" />
              <h2 className="font-display text-2xl font-bold text-[var(--text-strong)]">
                Partie terminée : {score} / {questions.length}
              </h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {score >= Math.ceil(questions.length * 0.75)
                  ? 'Mémoire musicale redoutable — tu connais ton historique sur le bout des doigts.'
                  : 'Rejoue une manche pour affiner ton oreille sur tes propres écoutes !'}
              </p>
              <button
                onClick={restartQuiz}
                className="mt-4 rounded-[var(--radius-card)] px-4 py-2 text-xs font-semibold text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                Rejouer 8 manches
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="font-mono-tab text-[11px] uppercase text-[var(--text-muted)]">
                Manche {qIdx + 1} / {questions.length} ·{' '}
                {currentQ.mode === 'track_guess'
                  ? 'RECONNAISSANCE TITRE'
                  : currentQ.mode === 'artist_duel'
                    ? "DUEL D'ÉCOUTE"
                    : "MOIS D'OBSESSION"}
              </div>
              <h2 className="font-display text-xl font-bold text-[var(--text-strong)]">{currentQ.prompt}</h2>

              {currentQ.mode === 'track_guess' && (
                <div className="flex flex-wrap items-center gap-2">
                  {currentQ.preview_url ? (
                    [1, 3, 6].map((sec) => (
                      <button
                        key={sec}
                        onClick={() => playSnippet(sec)}
                        className="flex items-center gap-1.5 rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-semibold text-white"
                        style={{ backgroundColor: 'var(--accent)' }}
                      >
                        <Play className="h-3.5 w-3.5" /> Écouter {sec}s
                      </button>
                    ))
                  ) : (
                    <span className="font-mono-tab text-xs text-[var(--text-muted)]">
                      Mode Indices (extraits 30s disponibles après Passe 2)
                    </span>
                  )}
                  {clueStep < (currentQ.clues?.length || 0) && (
                    <button onClick={() => setClueStep((c) => c + 1)} className="tactile-btn px-2.5 py-1.5 text-xs">
                      + Révéler indice ({clueStep}/{currentQ.clues.length})
                    </button>
                  )}
                </div>
              )}

              {/* Clues */}
              <div className="space-y-1">
                {(currentQ.clues || []).slice(0, clueStep).map((c: string, i: number) => (
                  <div key={i} className="surface-card-2 px-3 py-1.5 text-xs text-[var(--text-primary)]">
                    Indice {i + 1} : {c}
                  </div>
                ))}
              </div>

              {/* Options */}
              <div className="grid gap-2 sm:grid-cols-2">
                {(currentQ.options || []).map((opt: any) => {
                  const isCorrect = opt.id === currentQ.correct_id
                  const isPicked = selectedOpt === opt.id
                  let borderCls = 'border-[var(--border-subtle)]'
                  if (selectedOpt) {
                    if (isCorrect) borderCls = 'border-[var(--accent-ok)] bg-[var(--accent-ok)]/15'
                    else if (isPicked) borderCls = 'border-[var(--accent-danger)] bg-[var(--accent-danger)]/15'
                  }
                  return (
                    <button
                      key={opt.id}
                      disabled={Boolean(selectedOpt)}
                      onClick={() => answerOption(opt.id)}
                      className={`rounded-[var(--radius-card)] border p-3 text-left transition-colors hover:border-[var(--accent)] ${borderCls}`}
                    >
                      <div className="text-xs font-semibold text-[var(--text-strong)]">{opt.label}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{opt.sub}</div>
                    </button>
                  )
                })}
              </div>

              {selectedOpt && (
                <div className="flex items-center justify-between rounded-[var(--radius-card)] bg-[var(--bg-surface-2)] p-3">
                  <div className="text-xs">
                    <strong className={selectedOpt === currentQ.correct_id ? 'text-[var(--accent-ok)]' : 'text-[var(--accent-danger)]'}>
                      {selectedOpt === currentQ.correct_id ? 'Bien joué !' : 'Raté !'}
                    </strong>{' '}
                    Réponse : {currentQ.correct_label}
                  </div>
                  <button
                    onClick={nextQuestion}
                    className="rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-semibold text-white"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    Suivant →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. ATELIER COLLECTOR HD (modern-screenshot + Native Canvas 2D — ZERO html2canvas) */}
      {sub === 'collector' && (
        <div className="space-y-4">
          <div className="surface-card flex flex-wrap items-center justify-between gap-2 p-3.5">
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'festival', label: 'Affiche Festival 3 Jours' },
                { id: 'quilt', label: 'Album Quilt' },
                { id: 'pixelgrid', label: 'Pixel Grid Annuel' },
                { id: 'receipt', label: 'Ticket Collector' },
                { id: 'poster', label: 'Poster Éditorial' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPiece(p.id as CollectorPiece)}
                  data-testid={`collector-${p.id}`}
                  className={`rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-medium ${
                    piece === p.id
                      ? 'border border-[var(--accent)] bg-[var(--bg-surface-2)] text-[var(--text-strong)]'
                      : 'tactile-btn text-[var(--text-secondary)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {piece === 'quilt' && (
                <div className="flex gap-1">
                  {([3, 4, 5] as const).map((sz) => (
                    <button
                      key={sz}
                      onClick={() => setQuiltSize(sz)}
                      className={`rounded px-2 py-1 font-mono-tab text-xs ${quiltSize === sz ? 'bg-[var(--accent)] text-white' : 'tactile-btn'}`}
                    >
                      {sz}×{sz}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={exportCollectorPng}
                disabled={exporting}
                className="flex items-center gap-1.5 rounded-[var(--radius-card)] px-3.5 py-1.5 text-xs font-semibold text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <Download className="h-3.5 w-3.5" /> {exporting ? 'Export HD...' : 'Exporter PNG HD'}
              </button>
            </div>
          </div>

          <div className="flex justify-center">
            <div ref={collectorRef} className="w-full max-w-2xl rounded-xl border border-[var(--border-strong)] bg-[#141418] p-6 text-[#e0e0e0]">
              {/* FESTIVAL POSTER (Instafest 3-day style) */}
              {piece === 'festival' && (
                <div className="space-y-5 text-center">
                  <div>
                    <div className="font-mono-tab text-[10px] tracking-[0.35em] text-[#c89446]">
                      AMDATAWRAP CONTINUUM PRESENTS
                    </div>
                    <h2 className="mt-1 font-serif-ed text-4xl italic tracking-wide text-[#f0ede6]">
                      SONIC FIELD FESTIVAL
                    </h2>
                    <div className="mt-1 font-mono-tab text-[11px] text-[#9e9ea8]">
                      {atelier?.min_date} — {atelier?.max_date} · {atelier?.total_hours} HEURES DE LIVE
                    </div>
                  </div>
                  <div className="space-y-4">
                    {(atelier?.festival_days || []).map((day: any) => {
                      const headliner = day.artists[0]
                      const sub = day.artists.slice(1, 4)
                      const under = day.artists.slice(4, 10)
                      return (
                        <div key={day.day} className="border-t border-white/10 pt-3">
                          <div className="font-mono-tab text-[10px] tracking-[0.25em] text-[#689cd2]">
                            {day.day} · {day.stage}
                          </div>
                          {headliner && (
                            <div className="mt-1 font-display text-2xl font-bold uppercase tracking-tight text-[#ebebef]">
                              {headliner.artist_name}
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-sm font-semibold uppercase text-[#c8c8d0]">
                            {sub.map((a: any) => (
                              <span key={a.artist_key}>{a.artist_name}</span>
                            ))}
                          </div>
                          <div className="mt-1 flex flex-wrap justify-center gap-x-2.5 gap-y-0.5 font-mono-tab text-[11px] uppercase text-[#8a8a96]">
                            {under.map((a: any) => (
                              <span key={a.artist_key}>{a.artist_name}</span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ALBUM QUILT */}
              {piece === 'quilt' && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-display text-lg font-bold">Album Quilt {quiltSize}×{quiltSize}</span>
                    <span className="font-mono-tab text-xs text-[#a2a2ad]">{atelier?.total_hours} h</span>
                  </div>
                  <div
                    className="grid gap-1.5"
                    style={{ gridTemplateColumns: `repeat(${quiltSize}, minmax(0, 1fr))` }}
                  >
                    {(atelier?.quilt || []).slice(0, quiltSize * quiltSize).map((alb: any) => {
                      const art = artworkProxyUrl(alb.artwork_url)
                      return (
                        <div
                          key={alb.album_key}
                          className="relative aspect-square overflow-hidden rounded border border-white/10"
                          style={{ backgroundColor: alb.color }}
                        >
                          {art ? (
                            <img src={art} alt={alb.album_name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full flex-col justify-end bg-gradient-to-t from-black/75 via-transparent p-2">
                              <div className="truncate text-[10px] font-bold text-white">{alb.album_name}</div>
                              <div className="truncate text-[9px] text-white/80">{alb.artist_name}</div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ANNUAL PIXEL GRID (Last.fm Labs style) */}
              {piece === 'pixelgrid' && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="font-display text-lg font-bold">Pixel Grid Annuel</div>
                      <div className="text-[11px] text-[#a2a2ad]">
                        1 pixel par jour actif teinté selon votre album #1 du jour ({atelier?.pixel_grid?.length || 0} jours)
                      </div>
                    </div>
                    <span className="font-mono-tab text-xs text-[#689cd2]">Canvas 2D HD</span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(14px,1fr))] gap-1">
                    {(atelier?.pixel_grid || []).map((d: any) => (
                      <button
                        key={d.date}
                        onClick={() => openDrawer({ type: 'day', key: d.date })}
                        title={`${d.date} · #1 : ${d.album_name} (${d.artist_name})`}
                        className="aspect-square w-full rounded-[2px]"
                        style={{ backgroundColor: d.color }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* RECEIPT COLLECTOR */}
              {piece === 'receipt' && (
                <div className="mx-auto max-w-sm rounded bg-[#f4f1ea] p-5 font-mono-tab text-[#1a1a1e]">
                  <div className="border-b border-dashed border-[#8a8a90] pb-2 text-center">
                    <div className="text-sm font-bold tracking-widest">AMDATAWRAP V3 RECEIPT</div>
                    <div className="text-[10px]">ORDER #{atelier?.total_plays} · {atelier?.min_date} → {atelier?.max_date}</div>
                  </div>
                  <div className="my-3 space-y-1.5 text-[11px]">
                    {(overview?.top_tracks || []).slice(0, 10).map((t: any, i: number) => (
                      <div key={t.track_key} className="flex justify-between gap-2">
                        <span className="truncate">
                          {String(i + 1).padStart(2, '0')} {t.song_name.toUpperCase()}
                        </span>
                        <span className="shrink-0">{t.plays}×</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-dashed border-[#8a8a90] pt-2 text-[11px]">
                    <div className="flex justify-between font-bold">
                      <span>TOTAL ÉCOUTE</span>
                      <span>{atelier?.total_hours} HRS</span>
                    </div>
                    <div className="mt-3 flex h-8 items-stretch justify-center gap-[2px]">
                      {Array.from({ length: 38 }, (_, i) => (
                        <div key={i} className="bg-[#1a1a1e]" style={{ width: i % 3 === 0 ? 3 : 1 }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* EDITORIAL POSTER */}
              {piece === 'poster' && (
                <div className="space-y-4">
                  <div className="flex items-end justify-between border-b border-white/15 pb-3">
                    <div>
                      <div className="font-mono-tab text-[10px] uppercase tracking-widest text-[#d46d3d]">
                        ARCHIVE SONORE PERSONNELLE
                      </div>
                      <h2 className="font-serif-ed text-4xl italic">{atelier?.total_hours} Heures d&apos;Écoute</h2>
                    </div>
                    <div className="text-right font-mono-tab text-xs text-[#a2a2ad]">
                      <div>{atelier?.total_plays} écoutes</div>
                      <div>{atelier?.min_date} → {atelier?.max_date}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="mb-1.5 font-mono-tab text-[10px] uppercase text-[#a2a2ad]">TOP ARTISTES</div>
                      {(overview?.top_artists || []).slice(0, 6).map((a: any, i: number) => (
                        <div key={a.artist_group_key || i} className="flex justify-between py-0.5 text-xs">
                          <span className="truncate">{i + 1}. {a.artist_name}</span>
                          <span className="font-mono-tab text-[#689cd2]">{(a.total_ms / 3_600_000).toFixed(1)}h</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="mb-1.5 font-mono-tab text-[10px] uppercase text-[#a2a2ad]">TOP TITRES</div>
                      {(overview?.top_tracks || []).slice(0, 6).map((t: any, i: number) => (
                        <div key={t.track_key} className="flex justify-between py-0.5 text-xs">
                          <span className="truncate">{i + 1}. {t.song_name}</span>
                          <span className="font-mono-tab text-[#c89446]">{t.plays}×</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
