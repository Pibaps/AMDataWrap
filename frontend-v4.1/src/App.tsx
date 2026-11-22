/**
 * Root Application — AMDataWrap V4 ("Salon d'écoute").
 *
 * Refinements from user feedback:
 * - Lazy-loaded analytics views (`React.lazy` + `Suspense`) for a much lighter initial bundle and instant startup.
 * - Locked to the user's Apple Music data (`source_provider: "apple_music"`) without cluttering the header
 *   with multi-platform dropdowns.
 */

import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { API, apiGet, type NavTab, type ProfileCapabilities, type ProfileItem } from "./api/client";
import { EnrichmentPill } from "./components/EnrichmentPill";
import { HybridPlaybackDeck } from "./components/HybridPlaybackDeck";
import { Loading } from "./components/ui";
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

const NAV_TABS: Array<{ id: NavTab; label: string }> = [
  { id: "studio", label: "Salon 3D" },
  { id: "overview", label: "Synthèse" },
  { id: "tops", label: "Classements" },
  { id: "chrono", label: "Rythmes" },
  { id: "persona", label: "Portrait" },
  { id: "behavior", label: "Habitudes" },
  { id: "science", label: "Science" },
  { id: "atlas", label: "Atlas" },
  { id: "galaxy", label: "Constellation" },
  { id: "search", label: "Recherche" },
  { id: "wrapped", label: "Wrapped" },
  { id: "hub", label: "Archives" },
];

export const App: React.FC = () => {
  const activeTab = useV4Store((s) => s.activeTab);
  const setActiveTab = useV4Store((s) => s.setActiveTab);
  const filters = useV4Store((s) => s.filters);
  const setFilters = useV4Store((s) => s.setFilters);
  const timeUnit = useV4Store((s) => s.timeUnit);
  const setTimeUnit = useV4Store((s) => s.setTimeUnit);
  const capabilities = useV4Store((s) => s.capabilities);
  const setProfilesData = useV4Store((s) => s.setProfilesData);

  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [hasData, setHasData] = useState<boolean>(true);

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
        apiGet<{ years?: number[] }>(`${API.filters}${fltQs}`).catch(() => ({ years: [] })),
      ]);
      setProfilesData(profRes.profiles || [], activeId, caps);
      if (Array.isArray(flt?.years)) setAvailableYears(flt.years);
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
    apiGet<{ years?: number[] }>(`${API.filters}${qs}`)
      .then((flt) => {
        if (Array.isArray(flt?.years)) setAvailableYears(flt.years);
      })
      .catch(() => {});
  }, [filters.profile_id, filters.source_provider]);

  const availablePlatforms = capabilities?.platforms?.length ? capabilities.platforms : [];
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

  return (
    <div className="relative min-h-screen text-ink">
      {/* SINGLE PERSISTENT 3D LISTENING ROOM CANVAS (pauses RAF automatically off studio tab) */}
      <PersistentStageCanvas />

      {/* Clean Minimal Top Header (Brand + 12 Tabs + Apple Music Year Filter) */}
      <header className="sticky top-0 z-30 bg-bg-2/95 border-b border-line px-4 sm:px-7 py-2">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5 shrink-0">
            <button
              onClick={() => setActiveTab("studio")}
              className="font-display text-lg font-[600] tracking-tight text-ink hover:text-amber transition-colors"
            >
              AMDataWrap
            </button>
            <span className="kicker hidden sm:inline">
              {activePlatformBanner} · SALON 3D
            </span>
          </div>

          <nav
            aria-label="Navigation AMDataWrap V4"
            className="flex items-center gap-1 overflow-x-auto max-w-full py-0.5"
          >
            {NAV_TABS.map(({ id, label }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  data-testid={`nav-${id}`}
                  className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                    active
                      ? "bg-amber text-[#1a0f07] font-semibold"
                      : "text-ink-2 hover:text-ink hover:bg-bg-3"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>

          <div className="flex flex-wrap items-center gap-1.5 text-xs shrink-0">
            <EnrichmentPill hasData={hasData} />
            {availablePlatforms.length > 1 && (
              <div
                className="flex items-center gap-1 bg-bg-3 border border-line-2 rounded p-0.5"
                role="group"
                aria-label="Filtre plateformes (combinaisons multiples)"
                data-testid="platform-filter"
              >
                <button
                  type="button"
                  onClick={() => setFilters({ source_provider: "all", year: "all" })}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    isAllPlatforms ? "bg-amber text-[#1a0f07] font-semibold" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  Toutes
                </button>
                {availablePlatforms.map((p) => {
                  const active = !isAllPlatforms && selectedPlatforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      title="Cliquer pour activer/désactiver cette plateforme (combinaisons possibles)"
                      className={`px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                        active ? "bg-amber text-[#1a0f07] font-semibold" : "text-ink-2 hover:text-ink hover:bg-bg-4"
                      }`}
                    >
                      {PLATFORM_LABELS[p] || p.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
            )}
            <select
              value={filters.year}
              onChange={(e) => setFilters({ year: e.target.value })}
              aria-label="Filtre année"
              className="field text-xs"
            >
              <option value="all">Toutes années</option>
              {availableYears.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
            <div
              className="flex items-center gap-0.5 bg-bg-3 border border-line-2 rounded p-0.5"
              role="group"
              aria-label="Unité de durée"
              data-testid="time-unit-toggle"
            >
              <button
                type="button"
                onClick={() => setTimeUnit("hours")}
                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                  timeUnit === "hours" ? "bg-amber text-[#1a0f07] font-semibold" : "text-ink-2 hover:text-ink"
                }`}
              >
                h
              </button>
              <button
                type="button"
                onClick={() => setTimeUnit("minutes")}
                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                  timeUnit === "minutes" ? "bg-amber text-[#1a0f07] font-semibold" : "text-ink-2 hover:text-ink"
                }`}
              >
                min
              </button>
            </div>
          </div>
        </div>
      </header>

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

      {/* Bottom Transport Bar & Turntable-Mounted YouTube OLED Monitor */}
      <HybridPlaybackDeck />
    </div>
  );
};

export default App;
