import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from './api/client'
import { DetailDrawer } from './components/DetailDrawer'
import { EditionHeader } from './components/EditionHeader'
import { FilterBar } from './components/FilterBar'
import { FtsSearchModal } from './components/FtsSearchModal'
import { SpatialAudioDock } from './components/SpatialAudioDock'
import { useUrlAppState } from './hooks/useUrlFilters'
import { AnalyticsCorePage } from './pages/AnalyticsCorePage'
import { AtlasAndGraphPage } from './pages/AtlasAndGraphPage'
import { ContinuumHubPage } from './pages/ContinuumHubPage'
import { GamesAndCollectorPage } from './pages/GamesAndCollectorPage'
import { Observatory3DPage } from './pages/Observatory3DPage'
import { ScienceLabPage } from './pages/ScienceLabPage'
import { ScrollyWrappedModal } from './pages/ScrollyWrappedModal'
import { StudioOverviewPage } from './pages/StudioOverviewPage'

export function App() {
  const {
    tab,
    edition,
    theme,
    calm,
    filters,
    setTab,
    setEdition,
    setTheme,
    setCalm,
    patchFilters,
    resetFilters,
  } = useUrlAppState()

  // Sync data-edition / data-theme / data-calm attributes onto <html> (smooth 240ms polarity switch, zero invert!)
  useEffect(() => {
    const html = document.documentElement
    html.setAttribute('data-edition', edition)
    html.setAttribute('data-theme', theme)
    html.setAttribute('data-calm', calm ? 'true' : 'false')
  }, [edition, theme, calm])

  const { data: filterOptions } = useQuery({
    queryKey: ['filter-options'],
    queryFn: () => apiGet('/api/filters'),
    staleTime: 1000 * 60 * 5,
  })

  const { data: continuum } = useQuery({
    queryKey: ['continuum-header-status'],
    queryFn: () => apiGet('/api/v3/continuum/status'),
    refetchInterval: 15_000,
  })

  return (
    <div className="min-h-screen pb-24">
      <EditionHeader
        tab={tab}
        edition={edition}
        theme={theme}
        calm={calm}
        nowPlaying={continuum?.now_playing}
        onTab={setTab}
        onEdition={setEdition}
        onTheme={setTheme}
        onCalm={setCalm}
      />

      {tab !== 'continuum' && (
        <FilterBar
          edition={edition}
          filters={filters}
          options={filterOptions}
          onPatch={patchFilters}
          onReset={resetFilters}
        />
      )}

      <main className="mx-auto max-w-[1440px] px-4 py-5">
        {tab === 'overview' && <StudioOverviewPage filters={filters} edition={edition} theme={theme} />}
        {tab === 'science' && <ScienceLabPage filters={filters} theme={theme} />}
        {tab === 'atlas' && <AtlasAndGraphPage filters={filters} theme={theme} />}
        {tab === 'observatory' && <Observatory3DPage filters={filters} theme={theme} calm={calm} />}
        {tab === 'analytics' && <AnalyticsCorePage filters={filters} theme={theme} />}
        {tab === 'games' && <GamesAndCollectorPage filters={filters} />}
        {tab === 'continuum' && <ContinuumHubPage />}
      </main>

      <SpatialAudioDock edition={edition} theme={theme} />
      <FtsSearchModal />
      <DetailDrawer filters={filters} theme={theme} />
      <ScrollyWrappedModal filters={filters} />
    </div>
  )
}

export default App
