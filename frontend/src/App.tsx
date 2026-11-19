import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  BarChart3,
  Clock4,
  Compass,
  Flame,
  History,
  Play,
  Sparkles,
  Upload,
} from 'lucide-react'
import { useState } from 'react'
import { DetailDrawer } from './components/drawers/DetailDrawer'
import { EnrichmentBanner } from './components/layout/EnrichmentBanner'
import { FilterBar } from './components/layout/FilterBar'
import { ImportZipModal } from './components/layout/ImportZipModal'
import { MiniAudioPlayer } from './components/layout/MiniAudioPlayer'
import { WrappedStoryModal } from './components/wrapped/WrappedStoryModal'
import { BehaviorPage } from './pages/BehaviorPage'
import { ChronoPage } from './pages/ChronoPage'
import { OverviewPage } from './pages/OverviewPage'
import { PersonaPage } from './pages/PersonaPage'
import { SessionsHistoryPage } from './pages/SessionsHistoryPage'
import { TopsPage } from './pages/TopsPage'
import { AppProvider, useApp } from './store/AppContext'

type NavTab = 'overview' | 'tops' | 'chrono' | 'persona' | 'behavior' | 'sessions'

const NAV_ITEMS: { id: NavTab; label: string; icon: any }[] = [
  { id: 'overview', label: "Vue d'ensemble", icon: Activity },
  { id: 'tops', label: 'Tops détaillés', icon: BarChart3 },
  { id: 'chrono', label: 'Chronobiologie', icon: Clock4 },
  { id: 'persona', label: 'Persona & Époques', icon: Compass },
  { id: 'behavior', label: 'Obsessions & Skips', icon: Flame },
  { id: 'sessions', label: 'Sessions & Historique', icon: History },
]

function Shell() {
  const { setImportModalOpen, filterOptions } = useApp()
  const [activeTab, setActiveTab] = useState<NavTab>('overview')
  const [wrappedOpen, setWrappedOpen] = useState(false)

  return (
    <div className="min-h-screen relative text-white flex flex-col lg:flex-row">
      {/* Dynamic Ambient Obsidian Mesh */}
      <div className="ambient-mesh">
        <div className="ambient-orb-mid" />
      </div>

      {/* Left Sidebar (Desktop) / Top Header (Mobile) */}
      <aside className="relative z-20 lg:w-64 lg:shrink-0 lg:h-screen lg:sticky lg:top-0 border-b lg:border-b-0 lg:border-r border-white/[0.07] bg-[#0a0a10]/80 backdrop-blur-2xl flex flex-col justify-between p-4">
        <div>
          {/* Brand */}
          <div className="flex items-center justify-between lg:justify-start gap-3 px-2 py-2 mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-rose-500 via-fuchsia-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-rose-500/25">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-white leading-none">AMDataWrap</h1>
                <p className="text-[10px] text-zinc-400 mt-0.5">Apple Music Spatial</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setWrappedOpen(true)}
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-rose-500 to-indigo-500 text-xs font-semibold"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Wrapped
            </button>
          </div>

          {/* Wrapped CTA (Desktop) */}
          <button
            type="button"
            onClick={() => setWrappedOpen(true)}
            className="hidden lg:flex w-full items-center justify-center gap-2 px-4 py-3 mb-5 rounded-2xl bg-gradient-to-r from-rose-500 via-fuchsia-500 to-indigo-500 text-white text-xs font-bold shadow-lg shadow-rose-500/20 hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Mode Wrapped / Story
          </button>

          {/* Navigation */}
          <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
              const active = activeTab === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white/[0.1] text-white border border-white/10 shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-rose-400' : 'text-zinc-500'}`} />
                  <span>{label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Bottom Sidebar: Import ZIP + Real-Time Enrichment SSE */}
        <div className="hidden lg:flex flex-col gap-2.5 pt-4 border-t border-white/[0.07]">
          <EnrichmentBanner />
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-xs font-medium text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Importer un .zip
          </button>
          {filterOptions?.meta && (
            <p className="text-[10px] text-zinc-500 text-center truncate px-1" title={filterOptions.meta.zip_filename}>
              {filterOptions.meta.zip_filename}
            </p>
          )}
        </div>
      </aside>

      {/* Main Content Workspace */}
      <main className="relative z-10 flex-1 min-w-0 px-4 md:px-7 py-5 max-w-[1440px] w-full mx-auto">
        <FilterBar />

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'overview' && (
              <OverviewPage
                onOpenWrapped={() => setWrappedOpen(true)}
                onNavigate={(t) => setActiveTab(t as NavTab)}
              />
            )}
            {activeTab === 'tops' && <TopsPage />}
            {activeTab === 'chrono' && <ChronoPage />}
            {activeTab === 'persona' && <PersonaPage />}
            {activeTab === 'behavior' && <BehaviorPage />}
            {activeTab === 'sessions' && <SessionsHistoryPage />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Global Interactive Overlays */}
      <DetailDrawer />
      <MiniAudioPlayer />
      <ImportZipModal />
      <WrappedStoryModal open={wrappedOpen} onClose={() => setWrappedOpen(false)} />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
