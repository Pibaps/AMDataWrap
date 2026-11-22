/**
 * Header — Strict Two-Tier Responsive Header (zero horizontal scrollbars, never 3 tiers).
 *
 * Tier 1 (1 row always): Brand + adaptive Priority+ navigation
 *   - xl  (>= 1280px): all 12 tabs inline
 *   - lg  (1024-1279px): 8 primary tabs + "Plus ▾" popover (4 tabs)
 *   - md  (768-1023px):  5 primary tabs + "Plus ▾" popover (7 tabs)
 *   - sm  (640-767px):   4 primary tabs + "Plus ▾" popover (8 tabs)
 *   - xs  (< 640px):     compact active-tab menu trigger + 2-column popover of all 12 tabs
 *
 * Tier 2 (1 row always): EnrichmentPill + Platform Sources (inline on lg+, dropdown below lg)
 *   + Year select + Filters button + FR/EN + h/min.
 */

import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Menu, SlidersHorizontal, X } from "lucide-react";
import type { NavTab } from "../api/client";
import { useT } from "../i18n";
import { useV4Store } from "../store/useV4Store";
import { EnrichmentPill } from "./EnrichmentPill";

export const NAV_TAB_IDS: NavTab[] = [
  "studio",
  "overview",
  "tops",
  "chrono",
  "persona",
  "behavior",
  "science",
  "atlas",
  "galaxy",
  "search",
  "wrapped",
  "hub",
];

type ViewportTier = "xs" | "sm" | "md" | "lg" | "xl";

function readViewportTier(): ViewportTier {
  if (typeof window === "undefined") return "xl";
  const w = window.innerWidth;
  if (w >= 1280) return "xl";
  if (w >= 1024) return "lg";
  if (w >= 768) return "md";
  if (w >= 640) return "sm";
  return "xs";
}

function useViewportTier(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>(readViewportTier);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const queries = [
      window.matchMedia("(min-width: 1280px)"),
      window.matchMedia("(min-width: 1024px)"),
      window.matchMedia("(min-width: 768px)"),
      window.matchMedia("(min-width: 640px)"),
    ];
    const update = () => setTier(readViewportTier());
    update();
    queries.forEach((mq) => mq.addEventListener("change", update));
    return () => queries.forEach((mq) => mq.removeEventListener("change", update));
  }, []);

  return tier;
}

const VISIBLE_TAB_COUNT: Record<ViewportTier, number> = {
  xl: 12,
  lg: 8,
  md: 5,
  sm: 4,
  xs: 0,
};

export interface HeaderProps {
  hasData: boolean;
  availablePlatforms: string[];
  selectedPlatforms: string[];
  isAllPlatforms: boolean;
  platformLabels: Record<string, string>;
  activePlatformBanner: string;
  availableYears: number[];
  filtersOpen: boolean;
  activeAdvancedCount: number;
  onTogglePlatform: (platform: string) => void;
  onToggleFilters: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  hasData,
  availablePlatforms,
  selectedPlatforms,
  isAllPlatforms,
  platformLabels,
  activePlatformBanner,
  availableYears,
  filtersOpen,
  activeAdvancedCount,
  onTogglePlatform,
  onToggleFilters,
}) => {
  const { t, locale } = useT();
  const activeTab = useV4Store((s) => s.activeTab);
  const setActiveTab = useV4Store((s) => s.setActiveTab);
  const filters = useV4Store((s) => s.filters);
  const setFilters = useV4Store((s) => s.setFilters);
  const timeUnit = useV4Store((s) => s.timeUnit);
  const setTimeUnit = useV4Store((s) => s.setTimeUnit);
  const setLocale = useV4Store((s) => s.setLocale);

  const tier = useViewportTier();
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const navMenuRef = useRef<HTMLDivElement>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);

  // Close popovers when crossing breakpoints
  useEffect(() => {
    setNavMenuOpen(false);
    setSourcesOpen(false);
  }, [tier]);

  // Close popovers on outside click or Escape
  useEffect(() => {
    if (!navMenuOpen && !sourcesOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (navMenuOpen && navMenuRef.current && !navMenuRef.current.contains(target)) {
        setNavMenuOpen(false);
      }
      if (sourcesOpen && sourcesRef.current && !sourcesRef.current.contains(target)) {
        setSourcesOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavMenuOpen(false);
        setSourcesOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [navMenuOpen, sourcesOpen]);

  const visibleCount = VISIBLE_TAB_COUNT[tier];
  const inlineTabs = NAV_TAB_IDS.slice(0, visibleCount);
  const overflowTabs = NAV_TAB_IDS.slice(visibleCount);
  const activeInOverflow = overflowTabs.includes(activeTab);

  const inlinePlatforms = tier === "xl" || tier === "lg";
  const isCompact = tier === "xs";

  const sourcesSummary = isAllPlatforms
    ? t("header.allPlatforms")
    : selectedPlatforms.length === 1
      ? platformLabels[selectedPlatforms[0]] || selectedPlatforms[0].replace(/_/g, " ")
      : `${selectedPlatforms.length} ${t("header.sources").toLowerCase()}`;

  const handleSelectTab = (id: NavTab) => {
    setActiveTab(id);
    setNavMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 bg-bg-2/95 border-b border-line px-3 sm:px-5 lg:px-6 xl:px-8 py-1.5 sm:py-2">
      <div className="max-w-[1440px] mx-auto flex flex-col gap-1.5">
        {/* Tier 1: Brand + Adaptive Navigation (strictly 1 row, zero horizontal scrollbars) */}
        <div className="flex items-center justify-between gap-2 sm:gap-3 flex-nowrap min-w-0">
          <div className="flex items-baseline gap-2.5 shrink-0 min-w-0">
            <button
              type="button"
              onClick={() => handleSelectTab("studio")}
              className="font-display text-base sm:text-lg font-[600] tracking-tight text-ink hover:text-amber transition-colors whitespace-nowrap"
            >
              AMDataWrap
            </button>
            <span className="kicker hidden 2xl:inline whitespace-nowrap truncate max-w-[260px]">
              {activePlatformBanner} · SALON 3D
            </span>
          </div>

          <nav
            aria-label="Navigation AMDataWrap V4"
            className="flex items-center gap-0.5 2xl:gap-1 flex-nowrap shrink-0"
          >
            {inlineTabs.map((id) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectTab(id)}
                  data-testid={`nav-${id}`}
                  className={`px-2 2xl:px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                    active
                      ? "bg-amber text-[#1a0f07] font-semibold"
                      : "text-ink-2 hover:text-ink hover:bg-bg-3"
                  }`}
                >
                  {t(`nav.${id}`)}
                </button>
              );
            })}

            {overflowTabs.length > 0 && (
              <div className="relative" ref={navMenuRef}>
                <button
                  type="button"
                  onClick={() => {
                    setNavMenuOpen((v) => !v);
                    setSourcesOpen(false);
                  }}
                  data-testid="nav-more-toggle"
                  aria-expanded={navMenuOpen}
                  aria-haspopup="menu"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap border transition-colors ${
                    activeInOverflow
                      ? "bg-amber text-[#1a0f07] border-amber font-semibold"
                      : navMenuOpen
                        ? "bg-bg-4 text-ink border-line-2"
                        : "bg-bg-3 text-ink-2 border-line-2 hover:text-ink hover:bg-bg-4"
                  }`}
                >
                  {isCompact && (navMenuOpen ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />)}
                  <span>{activeInOverflow ? t(`nav.${activeTab}`) : t("header.more")}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${navMenuOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {navMenuOpen && (
                  <div
                    role="menu"
                    data-testid="nav-more-menu"
                    className={`absolute right-0 top-full mt-1.5 z-50 bg-bg-2 border border-line-2 rounded-lg shadow-2xl p-1.5 ${
                      overflowTabs.length > 5
                        ? "w-[min(19rem,calc(100vw-1.5rem))] grid grid-cols-2 gap-1"
                        : "min-w-[10.5rem] flex flex-col gap-0.5"
                    }`}
                  >
                    {overflowTabs.map((id) => {
                      const active = activeTab === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          role="menuitem"
                          onClick={() => handleSelectTab(id)}
                          data-testid={`nav-${id}`}
                          className={`px-2.5 py-1.5 rounded text-xs font-medium text-left whitespace-nowrap transition-colors ${
                            active
                              ? "bg-amber text-[#1a0f07] font-semibold"
                              : "text-ink-2 hover:text-ink hover:bg-bg-3"
                          }`}
                        >
                          {t(`nav.${id}`)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </nav>
        </div>

        {/* Tier 2: Enrich. + Platform Sources + Year / Filters / Lang / Unit (strictly 1 row, never wraps) */}
        <div className="flex items-center justify-between gap-1.5 sm:gap-2 pt-1.5 border-t border-line/60 text-xs flex-nowrap min-w-0">
          {/* Left cluster: Enrichment status + Platform Sources */}
          <div className="flex items-center gap-1.5 flex-nowrap min-w-0">
            <EnrichmentPill hasData={hasData} />

            {availablePlatforms.length > 1 &&
              (inlinePlatforms ? (
                <div
                  className="flex items-center gap-0.5 bg-bg-3 border border-line-2 rounded p-0.5 shrink-0"
                  role="group"
                  aria-label="Filtre plateformes (combinaisons multiples)"
                  data-testid="platform-filter"
                >
                  <button
                    type="button"
                    onClick={() => setFilters({ source_provider: "all", year: "all" })}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                      isAllPlatforms ? "bg-amber text-[#1a0f07] font-semibold" : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    {t("header.allPlatforms")}
                  </button>
                  {availablePlatforms.map((p) => {
                    const active = !isAllPlatforms && selectedPlatforms.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => onTogglePlatform(p)}
                        title="Cliquer pour activer/désactiver cette plateforme (combinaisons possibles)"
                        className={`px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                          active ? "bg-amber text-[#1a0f07] font-semibold" : "text-ink-2 hover:text-ink hover:bg-bg-4"
                        }`}
                      >
                        {platformLabels[p] || p.replace(/_/g, " ")}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="relative shrink-0" ref={sourcesRef} data-testid="platform-filter">
                  <button
                    type="button"
                    onClick={() => {
                      setSourcesOpen((v) => !v);
                      setNavMenuOpen(false);
                    }}
                    data-testid="sources-dropdown-toggle"
                    aria-expanded={sourcesOpen}
                    aria-haspopup="menu"
                    className={`inline-flex items-center gap-1 h-7 px-2 rounded text-[11px] font-medium border whitespace-nowrap transition-colors ${
                      !isAllPlatforms
                        ? "bg-amber/15 border-amber/40 text-amber"
                        : "bg-bg-3 border-line-2 text-ink-2 hover:text-ink"
                    }`}
                  >
                    <span className="truncate max-w-[72px] sm:max-w-[120px]">{sourcesSummary}</span>
                    <ChevronDown
                      className={`w-3 h-3 shrink-0 transition-transform ${sourcesOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {sourcesOpen && (
                    <div
                      role="menu"
                      data-testid="sources-dropdown-menu"
                      className="absolute left-0 top-full mt-1.5 z-50 min-w-[11rem] bg-bg-2 border border-line-2 rounded-lg shadow-2xl p-1.5 flex flex-col gap-0.5"
                    >
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={isAllPlatforms}
                        onClick={() => setFilters({ source_provider: "all", year: "all" })}
                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                          isAllPlatforms
                            ? "bg-amber text-[#1a0f07] font-semibold"
                            : "text-ink-2 hover:text-ink hover:bg-bg-3"
                        }`}
                      >
                        <span>{t("header.allPlatforms")}</span>
                        {isAllPlatforms && <Check className="w-3.5 h-3.5" />}
                      </button>
                      {availablePlatforms.map((p) => {
                        const active = !isAllPlatforms && selectedPlatforms.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={active}
                            onClick={() => onTogglePlatform(p)}
                            className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                              active
                                ? "bg-amber/20 text-amber font-semibold"
                                : "text-ink-2 hover:text-ink hover:bg-bg-3"
                            }`}
                          >
                            <span>{platformLabels[p] || p.replace(/_/g, " ")}</span>
                            {active && <Check className="w-3.5 h-3.5" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
          </div>

          {/* Right cluster: Year + Advanced Filters + Language + Time Unit */}
          <div className="flex items-center gap-1 sm:gap-1.5 flex-nowrap shrink-0">
            <select
              value={filters.year}
              onChange={(e) => setFilters({ year: e.target.value })}
              aria-label="Filtre année"
              className="field !h-7 !px-1.5 sm:!px-2 text-[11px] sm:text-xs max-w-[80px] sm:max-w-none"
            >
              <option value="all">{isCompact ? t("header.allYearsShort") : t("header.allYears")}</option>
              {availableYears.map((y: number) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>

            <button
              type="button"
              data-testid="filters-toggle"
              onClick={onToggleFilters}
              aria-label={t("header.filtersBtn")}
              className={`inline-flex items-center gap-1 h-7 px-2 sm:px-2.5 rounded text-[11px] sm:text-xs font-medium border whitespace-nowrap transition-colors ${
                filtersOpen || activeAdvancedCount > 0
                  ? "bg-amber/15 border-amber/40 text-amber"
                  : "bg-bg-3 border-line-2 text-ink-2 hover:text-ink"
              }`}
            >
              <SlidersHorizontal className="w-3 h-3 sm:hidden shrink-0" />
              <span className="hidden sm:inline">{t("header.filtersBtn")}</span>
              {activeAdvancedCount > 0 && (
                <span className="num text-[10.5px]">({activeAdvancedCount})</span>
              )}
            </button>

            <div
              className="flex items-center gap-0.5 bg-bg-3 border border-line-2 rounded p-0.5 shrink-0"
              role="group"
              aria-label="Language"
              data-testid="lang-toggle"
            >
              <button
                type="button"
                onClick={() => setLocale("fr")}
                className={`px-1.5 sm:px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                  locale === "fr" ? "bg-amber text-[#1a0f07] font-semibold" : "text-ink-2 hover:text-ink"
                }`}
              >
                FR
              </button>
              <button
                type="button"
                onClick={() => setLocale("en")}
                className={`px-1.5 sm:px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                  locale === "en" ? "bg-amber text-[#1a0f07] font-semibold" : "text-ink-2 hover:text-ink"
                }`}
              >
                EN
              </button>
            </div>

            <div
              className="flex items-center gap-0.5 bg-bg-3 border border-line-2 rounded p-0.5 shrink-0"
              role="group"
              aria-label="Unité de durée"
              data-testid="time-unit-toggle"
            >
              <button
                type="button"
                onClick={() => setTimeUnit("hours")}
                className={`px-1.5 sm:px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                  timeUnit === "hours" ? "bg-amber text-[#1a0f07] font-semibold" : "text-ink-2 hover:text-ink"
                }`}
              >
                h
              </button>
              <button
                type="button"
                onClick={() => setTimeUnit("minutes")}
                className={`px-1.5 sm:px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                  timeUnit === "minutes" ? "bg-amber text-[#1a0f07] font-semibold" : "text-ink-2 hover:text-ink"
                }`}
              >
                min
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
