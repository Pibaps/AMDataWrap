/**
 * Root Application — AMDataWrap V4 ("Salon d'écoute").
 *
 * Refinements from user feedback:
 * - Lazy-loaded analytics views (`React.lazy` + `Suspense`) for a much lighter initial bundle and instant startup.
 * - Locked to the user's Apple Music data (`source_provider: "apple_music"`) without cluttering the header
 *   with multi-platform dropdowns.
 */

import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import {
  API,
  apiGet,
  apiPost,
  type ProfileCapabilities,
  type ProfileItem,
} from "./api/client";
import type { FilterOptionsData } from "./api/types";
import { DetailDrawer } from "./components/DetailDrawer";
import { FilterDrawer } from "./components/FilterDrawer";
import { Header } from "./components/Header";
import { HybridPlaybackDeck } from "./components/HybridPlaybackDeck";
import { Loading } from "./components/ui";
import { WelcomeOverlay } from "./components/WelcomeOverlay";
import { useT } from "./i18n";
import { PersistentStageCanvas } from "./scene/PersistentStageCanvas";
import { useV4Store } from "./store/useV4Store";
import { VinylStudioView } from "./views/VinylStudioView";

const OverviewPage = lazy(() => import("./views/pages/OverviewPage").then((m) => ({ default: m.OverviewPage })));
const TopsPage = lazy(() => import("./views/pages/TopsPage").then((m) => ({ default: m.TopsPage })));
const ChronoPage = lazy(() => import("./views/pages/ChronoPage").then((m) => ({ default: m.ChronoPage })));
const PersonaPage = lazy(() => import("./views/pages/PersonaPage").then((m) => ({ default: m.PersonaPage })));
const BehaviorPage = lazy(() => import("./views/pages/BehaviorPage").then((m) => ({ default: m.BehaviorPage })));
const SciencePage = lazy(() => import("./views/pages/SciencePage").then((m) => ({ default: m.SciencePage })));
const AtlasPage = lazy(() => import("./views/pages/AtlasPage").then((m) => ({ default: m.AtlasPage })));
const GalaxyPage = lazy(() => import("./views/pages/GalaxyPage").then((m) => ({ default: m.GalaxyPage })));
const SearchPage = lazy(() => import("./views/pages/SearchPage").then((m) => ({ default: m.SearchPage })));
const WrappedPage = lazy(() => import("./views/pages/WrappedPage").then((m) => ({ default: m.WrappedPage })));
const HubPage = lazy(() => import("./views/pages/HubPage").then((m) => ({ default: m.HubPage })));

export const App: React.FC = () => {
  const { t } = useT();
  const activeTab = useV4Store((s) => s.activeTab);
  const filters = useV4Store((s) => s.filters);
  const setFilters = useV4Store((s) => s.setFilters);
  const timeUnit = useV4Store((s) => s.timeUnit);
  const capabilities = useV4Store((s) => s.capabilities);
  const profiles = useV4Store((s) => s.profiles);
  const activeProfileId = useV4Store((s) => s.activeProfileId);
  const setProfilesData = useV4Store((s) => s.setProfilesData);

  const [filterOptions, setFilterOptions] = useState<FilterOptionsData | null>(null);
  const [hasData, setHasData] = useState<boolean>(true);
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [exitingDemo, setExitingDemo] = useState<boolean>(false);
  const availableYears = filterOptions?.years ?? [];

  const PLATFORM_LABELS: Record<string, string> = {
    apple_music: "Apple Music",
    spotify: "Spotify",
    youtube_music: "YouTube Music",
    deezer: "Deezer",
    tidal: "TIDAL",
  };

  const loadProfilesAndCapabilities = useCallback(async () => {
    try {
      const [profRes, healthRes] = await Promise.all([
        apiGet<{ profiles: ProfileItem[]; active_profile_id: number | null }>(API.profiles),
        apiGet<{ has_data: boolean }>(API.health).catch(() => ({ has_data: true })),
      ]);
      setHasData(Boolean(healthRes?.has_data));
      const activeId = profRes.active_profile_id ?? profRes.profiles?.[0]?.id ?? null;
      const fltParams = new URLSearchParams();
      if (activeId) fltParams.set("profile_id", String(activeId));
      const fltQs = fltParams.toString() ? `?${fltParams.toString()}` : "";
      const [caps, flt] = await Promise.all([
        apiGet<ProfileCapabilities>(`${API.capabilities}${activeId ? `?profile_id=${activeId}` : ""}`).catch(
          () => null
        ),
        apiGet<FilterOptionsData>(`${API.filters}${fltQs}`).catch(() => null),
      ]);
      setProfilesData(profRes.profiles || [], activeId, caps);
      if (flt) setFilterOptions(flt);
    } catch {
      /* backend booting */
    }
  }, [setProfilesData]);

  useEffect(() => {
    loadProfilesAndCapabilities();
  }, [loadProfilesAndCapabilities]);

  useEffect(() => {
    const fltParams = new URLSearchParams();
    if (filters.profile_id != null) fltParams.set("profile_id", String(filters.profile_id));
    if (filters.source_provider && filters.source_provider !== "all") {
      fltParams.set("source_provider", filters.source_provider);
    }
    const qs = fltParams.toString() ? `?${fltParams.toString()}` : "";
    apiGet<FilterOptionsData>(`${API.filters}${qs}`)
      .then((flt) => {
        if (flt) setFilterOptions(flt);
      })
      .catch(() => {});
  }, [filters.profile_id, filters.source_provider]);

  const HIDDEN_HEADER_PLATFORMS = new Set(["extension_bridge", "preview_audio", "youtube_iframe"]);
  const availablePlatforms = (capabilities?.platforms ?? []).filter((p) => !HIDDEN_HEADER_PLATFORMS.has(p));
  const selectedPlatforms =
    !filters.source_provider || filters.source_provider === "all"
      ? availablePlatforms
      : filters.source_provider
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  const isAllPlatforms =
    !filters.source_provider ||
    filters.source_provider === "all" ||
    (availablePlatforms.length > 0 && selectedPlatforms.length >= availablePlatforms.length);

  const togglePlatform = (p: string) => {
    if (isAllPlatforms) {
      setFilters({ source_provider: p, year: "all" });
      return;
    }
    const next = selectedPlatforms.includes(p)
      ? selectedPlatforms.filter((x) => x !== p)
      : [...selectedPlatforms, p];
    if (next.length === 0 || next.length >= availablePlatforms.length) {
      setFilters({ source_provider: "all", year: "all" });
    } else {
      setFilters({ source_provider: next.join(","), year: "all" });
    }
  };

  const activePlatformBanner =
    selectedPlatforms.length > 0
      ? selectedPlatforms.map((p) => PLATFORM_LABELS[p] || p.replace(/_/g, " ")).join(" + ").toUpperCase()
      : "MULTI-PLATEFORME";

  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const isDemoActive = activeProfile?.name === "Démo — Salon d'écoute";

  const activeAdvancedCount = [
    filters.month !== "all",
    filters.season !== "all",
    Boolean(filters.date_from),
    Boolean(filters.date_to),
    filters.skip_mode !== "lastfm",
    filters.metric !== "ms",
    filters.genre !== "all",
    filters.device !== "all",
    Boolean(filters.offline),
    filters.exclude_incognito === false,
  ].filter(Boolean).length;

  const handleExitDemo = async () => {
    setExitingDemo(true);
    try {
      await apiPost("/api/v4/demo/unload", {});
      await loadProfilesAndCapabilities();
    } finally {
      setExitingDemo(false);
    }
  };

  return (
    <div className="relative min-h-screen text-ink">
      {/* SINGLE PERSISTENT 3D LISTENING ROOM CANVAS (pauses RAF automatically off studio tab) */}
      <PersistentStageCanvas />

      {/* Strict Two-Tier Responsive Header (zero scrollbars, max 2 tiers at all widths) */}
      <Header
        hasData={hasData}
        availablePlatforms={availablePlatforms}
        selectedPlatforms={selectedPlatforms}
        isAllPlatforms={isAllPlatforms}
        platformLabels={PLATFORM_LABELS}
        activePlatformBanner={activePlatformBanner}
        availableYears={availableYears}
        filtersOpen={filtersOpen}
        activeAdvancedCount={activeAdvancedCount}
        onTogglePlatform={togglePlatform}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
      />

      <FilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        options={filterOptions}
        hasIncognito={capabilities?.has_incognito_flag}
      />

      {isDemoActive && (
        <div
          data-testid="demo-banner"
          className="relative z-20 bg-amber/10 border-b border-amber/30 px-4 py-2 text-xs text-amber flex items-center justify-center gap-3"
        >
          <span>{t("header.demoBanner")}</span>
          <button
            type="button"
            disabled={exitingDemo}
            onClick={handleExitDemo}
            className="px-2.5 py-0.5 rounded bg-amber text-[#1a0f07] font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {t("header.exitDemo")}
          </button>
        </div>
      )}

      {!hasData && activeTab !== "hub" && (
        <WelcomeOverlay onLoaded={loadProfilesAndCapabilities} />
      )}

      {/* Active View */}
      <main key={activeTab === "studio" ? "studio" : `unit-${timeUnit}`} className={`relative z-10 ${activeTab === "studio" ? "pointer-events-none" : ""}`}>
        {activeTab === "studio" ? (
          <VinylStudioView />
        ) : (
          <Suspense
            fallback={
              <div className="max-w-[1240px] mx-auto px-5 sm:px-8 pt-10">
                <Loading rows={6} />
              </div>
            }
          >
            {activeTab === "overview" && <OverviewPage />}
            {activeTab === "tops" && <TopsPage />}
            {activeTab === "chrono" && <ChronoPage />}
            {activeTab === "persona" && <PersonaPage />}
            {activeTab === "behavior" && <BehaviorPage />}
            {activeTab === "science" && <SciencePage />}
            {activeTab === "atlas" && <AtlasPage />}
            {activeTab === "galaxy" && <GalaxyPage />}
            {activeTab === "search" && <SearchPage />}
            {activeTab === "wrapped" && <WrappedPage />}
            {activeTab === "hub" && <HubPage onRefreshProfiles={loadProfilesAndCapabilities} />}
          </Suspense>
        )}
      </main>

      {/* Contextual Entity Drawers (Artist / Album / Day) */}
      <DetailDrawer />

      {/* Bottom Transport Bar & Turntable-Mounted YouTube OLED Monitor */}
      <HybridPlaybackDeck />
    </div>
  );
};

export default App;
