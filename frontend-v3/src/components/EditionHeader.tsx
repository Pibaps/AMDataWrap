import {
  Activity,
  Box,
  Compass,
  Disc3,
  ExternalLink,
  FlaskConical,
  Globe2,
  Moon,
  Radio,
  Search,
  Sparkles,
  Sun,
  Trophy,
  Wind,
} from 'lucide-react'
import type { MainTab, ThemePolarity, VisualEdition } from '../hooks/useUrlFilters'
import { usePlayerStore } from '../store/playerStore'

interface EditionHeaderProps {
  tab: MainTab
  edition: VisualEdition
  theme: ThemePolarity
  calm: boolean
  nowPlaying?: { active: boolean; song_name?: string | null; artist_name?: string | null; provider?: string | null }
  onTab: (t: MainTab) => void
  onEdition: (e: VisualEdition) => void
  onTheme: (t: ThemePolarity) => void
  onCalm: (c: boolean) => void
}

const NAV_TABS: { id: MainTab; label: string; icon: typeof Disc3 }[] = [
  { id: 'overview', label: 'Studio', icon: Disc3 },
  { id: 'science', label: 'Science', icon: FlaskConical },
  { id: 'atlas', label: 'Atlas & Graphe', icon: Globe2 },
  { id: 'observatory', label: 'Observatoire 3D', icon: Box },
  { id: 'analytics', label: 'Analytique', icon: Activity },
  { id: 'games', label: 'Jeux & Collector', icon: Trophy },
  { id: 'continuum', label: 'Hub Continuum', icon: Radio },
]

const EDITIONS: { id: VisualEdition; label: string; tag: string }[] = [
  { id: 'field', label: 'Hi-Fi Field', tag: 'Braun × OP-1' },
  { id: 'editorial', label: 'Atlas Éditorial', tag: 'The Pudding' },
  { id: 'observatory', label: 'Observatoire', tag: '3D Mat' },
]

export function EditionHeader({
  tab,
  edition,
  theme,
  calm,
  nowPlaying,
  onTab,
  onEdition,
  onTheme,
  onCalm,
}: EditionHeaderProps) {
  const setWrappedOpen = usePlayerStore((s) => s.setWrappedOpen)
  const setSearchOpen = usePlayerStore((s) => s.setSearchOpen)

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-header)]">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        {/* Brand + Live Now Playing pill */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => onTab('overview')}
            className="flex items-center gap-2 text-left"
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface-2)] font-mono-tab text-xs font-bold"
              style={{ color: 'var(--accent)' }}
            >
              V3
            </span>
            <div>
              <div className="font-display text-base font-bold leading-tight text-[var(--text-strong)]">
                AMDataWrap <span className="font-serif-ed italic font-normal text-[var(--accent)]">Continuum</span>
              </div>
              <div className="font-mono-tab text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {edition === 'field' ? 'STUDIO HI-FI FIELD' : edition === 'editorial' ? 'ATLAS ÉDITORIAL SUISSE' : 'OBSERVATOIRE 3D MAT'}
              </div>
            </div>
          </button>

          {nowPlaying?.active && nowPlaying.song_name && (
            <button
              onClick={() => onTab('continuum')}
              className="hidden items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface-2)] px-3 py-1 text-xs xl:flex"
            >
              <span className="field-led bg-[var(--accent-ok)]" />
              <span className="font-medium text-[var(--text-strong)]">{nowPlaying.song_name}</span>
              <span className="text-[var(--text-secondary)]">· {nowPlaying.artist_name}</span>
            </button>
          )}
        </div>

        {/* Hot-Swap 3 Visual Editions Selector */}
        <div className="flex items-center gap-1 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] p-0.5">
          {EDITIONS.map((ed) => {
            const active = edition === ed.id
            return (
              <button
                key={ed.id}
                onClick={() => onEdition(ed.id)}
                title={ed.tag}
                data-testid={`edition-${ed.id}`}
                className={`rounded-[calc(var(--radius-card)-2px)] px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[var(--bg-surface-1)] text-[var(--text-strong)] shadow-xs border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {ed.label}
              </button>
            )
          })}
        </div>

        {/* Right Controls: Search FTS5, Wrapped Scrollytelling, Light/Dark, Calm, V1/V2 links */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSearchOpen(true)}
            data-testid="open-fts-search"
            className="tactile-btn flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
            title="Recherche instantanée FTS5 (Ctrl+K)"
          >
            <Search className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            <span className="hidden sm:inline">FTS5</span>
            <kbd className="hidden rounded bg-[var(--bg-surface-3)] px-1 font-mono-tab text-[10px] text-[var(--text-muted)] md:inline">
              ⌘K
            </kbd>
          </button>

          <button
            onClick={() => setWrappedOpen(true)}
            data-testid="open-wrapped-scrolly"
            className="flex items-center gap-1.5 rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Wrapped</span>
          </button>

          <button
            onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
            data-testid="toggle-theme"
            className="tactile-btn p-1.5"
            title={theme === 'dark' ? 'Passer en Mode Clair (Papier Mat)' : 'Passer en Mode Sombre Anti-Halation'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4 text-[var(--accent-warm)]" /> : <Moon className="h-4 w-4 text-[var(--accent)]" />}
          </button>

          <button
            onClick={() => onCalm(!calm)}
            data-testid="toggle-calm"
            className={`tactile-btn flex items-center gap-1 px-2 py-1.5 text-xs ${calm ? 'border-[var(--accent-ok)] text-[var(--accent-ok)]' : ''}`}
            title="Mode Calme (désactive animations et mouvement)"
          >
            <Wind className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Calme</span>
          </button>

          {/* Parallel V1 & V2 quick switches — preserving full access! */}
          <div className="ml-1 hidden items-center gap-1 border-l border-[var(--border-subtle)] pl-2 sm:flex">
            <a
              href="http://localhost:5174"
              target="_blank"
              rel="noreferrer"
              className="tactile-btn flex items-center gap-1 px-2 py-1 font-mono-tab text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
              title="Ouvrir V2 Spatial 3D en parallèle (:5174)"
            >
              V2 <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href="http://localhost:5173"
              target="_blank"
              rel="noreferrer"
              className="tactile-btn flex items-center gap-1 px-2 py-1 font-mono-tab text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
              title="Ouvrir V1 Classique en parallèle (:5173)"
            >
              V1 <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Primary Navigation Row */}
      <nav className="mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-4 pb-2">
        {NAV_TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              data-testid={`nav-${t.id}`}
              className={`flex shrink-0 items-center gap-1.5 rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border border-[var(--border-strong)] bg-[var(--bg-surface-2)] text-[var(--text-strong)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-1)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" style={active ? { color: 'var(--accent)' } : undefined} />
              <span>{t.label}</span>
            </button>
          )
        })}
        <div className="ml-auto hidden items-center gap-2 font-mono-tab text-[10px] text-[var(--text-muted)] xl:flex">
          <Compass className="h-3 w-3" />
          <span>APCA Anti-Halation · 0 backdrop-filter · URL Sync</span>
        </div>
      </nav>
    </header>
  )
}
