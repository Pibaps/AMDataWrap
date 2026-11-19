import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  BarChart3,
  Clock4,
  Compass,
  ExternalLink,
  Flame,
  History,
  Orbit,
  Play,
  Sparkles,
  Upload,
} from 'lucide-react'
import { useState } from 'react'
import { DetailDrawer } from './components/drawers/DetailDrawer'
import { EnrichmentBanner } from './components/layout/EnrichmentBanner'
import { FilterBar } from './components/layout/FilterBar'
import { ImportZipModal } from './components/layout/ImportZipModal'
import { SpatialVinylDeck } from './components/layout/SpatialVinylDeck'
import { AmbientNebulaCanvas } from './components/three/AmbientNebulaCanvas'
import { SonicGalaxy3D } from './components/three/SonicGalaxy3D'
import { SonicOdysseyWrapped } from './components/wrapped/SonicOdysseyWrapped'
import { BehaviorPage } from './pages/BehaviorPage'
import { ChronoPage } from './pages/ChronoPage'
import { OverviewPage } from './pages/OverviewPage'
import { PersonaPage } from './pages/PersonaPage'
import { SessionsHistoryPage } from './pages/SessionsHistoryPage'
import { TopsPage } from './pages/TopsPage'
import { AppProvider, useApp } from './store/AppContext'

type NavTab = 'overview' | 'galaxy' | 'tops' | 'chrono' | 'persona' | 'behavior' | 'sessions'

const NAV_ITEMS: { id: NavTab; label: string; icon: any }[] = [
  { id: 'overview', label: 'Studio', icon: Activity },
  { id: 'galaxy', label: 'Galaxie 3D', icon: Orbit },
  { id: 'tops', label: 'Tops', icon: BarChart3 },
  { id: 'chrono', label: 'Rythmes', icon: Clock4 },
  { id: 'persona', label: 'Persona', icon: Compass },
  { id: 'behavior', label: 'Obsessions', icon: Flame },
  { id: 'sessions', label: 'Historique', icon: History },
]

function ShellV2() {
  const { setImportModalOpen, auraColors } = useApp()
  const [activeTab, setActiveTab] = useState<NavTab>('overview')
  const [wrappedOpen, setWrappedOpen] = useState(false)

  return (
    <div className="min-h-screen relative text-white">
      {/* Live Audio-Reactive Three.js WebGL Nebula Stage */}
      <AmbientNebulaCanvas
        colors={auraColors}
        mode={activeTab === 'persona' ? 'orb' : activeTab === 'chrono' ? 'rings' : 'nebula'}
        intensity={0.78}
      />

      {/* Subtle Editorial Film Grain */}
      <div className="film-grain" />

      {/* Floating Spatial Top Dock (visionOS style, zero generic SaaS sidebar) */}
      <header className="sticky top-0 z-30 px-4 md:px-7 pt-4 pb-2">
        <div className="max-w-[1440px] mx-auto spatial-glass rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-rose-500 via-fuchsia-500 to-sky-400 flex items-center justify-center shadow-lg shadow-rose-500/25">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-display font-extrabold text-sm tracking-tight text-white">
                AMDataWrap <span className="text-rose-400">V2</span>
              </span>
            </div>
          </div>

          {/* Center Spatial Pill Navigation */}
          <nav className="flex items-center gap-1 overflow-x-auto">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
              const active = activeTab === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-black shadow-md'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.07]'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${active ? 'text-black' : id === 'galaxy' ? 'text-rose-400' : 'text-zinc-500'}`} />
                  <span>{label}</span>
                </button>
              )
            })}
          </nav>

          {/* Right Actions: Wrapped 3D + Import + Switch to V1 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWrappedOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-rose-500 via-fuchsia-500 to-indigo-500 text-white text-xs font-bold shadow-lg shadow-rose-500/25 hover:brightness-110 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Odyssey 3D
            </button>

            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              title="Importer un .zip"
              className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/15 border border-white/10 text-zinc-300 hover:text-white cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>

            <a
              href="http://localhost:5173"
              target="_blank"
              rel="noreferrer"
              title="Ouvrir la version V1 Classique en parallèle"
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/12 border border-white/10 text-[11px] font-mono-num text-zinc-300 hover:text-white"
            >
              V1 <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-[1440px] mx-auto px-4 md:px-7 py-3 pb-24">
        <FilterBar />

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            {activeTab === 'overview' && (
              <OverviewPage
                onOpenWrapped={() => setWrappedOpen(true)}
                onNavigate={(t) => setActiveTab(t as NavTab)}
              />
            )}
            {activeTab === 'galaxy' && <SonicGalaxy3D />}
            {activeTab === 'tops' && <TopsPage />}
            {activeTab === 'chrono' && <ChronoPage />}
            {activeTab === 'persona' && <PersonaPage />}
            {activeTab === 'behavior' && <BehaviorPage />}
            {activeTab === 'sessions' && <SessionsHistoryPage />}
          </motion.div>
        </AnimatePresence>

        {/* Discreet Floating Enrichment Pill bottom-left */}
        <div className="fixed bottom-5 left-5 z-30 w-60 hidden md:block">
          <EnrichmentBanner />
        </div>
      </main>

      <DetailDrawer />
      <SpatialVinylDeck />
      <ImportZipModal />
      <SonicOdysseyWrapped open={wrappedOpen} onClose={() => setWrappedOpen(false)} />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <ShellV2 />
    </AppProvider>
  )
}
