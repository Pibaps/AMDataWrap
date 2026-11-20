/**
 * Root Application — AMDataWrap V4 ("SONIC ODYSSEY × VINYL STUDIO 3D").
 * Mounts ONE PersistentStageCanvas at the root (never unmounts -> zero brutal animation resets!),
 * a global Profile & Platform Filter Header, the active View, the HybridPlaybackDeck,
 * and the visionOS floating glassmorphism Dock.
 */

import React, { useCallback, useEffect } from "react";
import {
  Activity,
  Award,
  Clock,
  Disc3,
  FlaskConical,
  Globe,
  Heart,
  Layers,
  Search,
  Sparkles,
  UserCheck,
  Wand2,
} from "lucide-react";
import { apiGet, type NavTab, type ProfileCapabilities, type ProfileItem } from "./api/client";
import { useV4Store } from "./store/useV4Store";
import { PersistentStageCanvas } from "./scene/PersistentStageCanvas";
import { HybridPlaybackDeck } from "./components/HybridPlaybackDeck";
import { VinylStudioView } from "./views/VinylStudioView";
import { GalaxyV4View } from "./views/GalaxyV4View";
import { HubConnectView } from "./views/HubConnectView";
import { AnalyticsSuiteView } from "./views/AnalyticsSuiteView";

const DOCK_ITEMS: Array<{ id: NavTab; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: "studio", label: "Vinyle 3D", icon: Disc3 },
  { id: "overview", label: "Vue", icon: Activity },
  { id: "tops", label: "Tops", icon: Award },
  { id: "galaxy", label: "Galaxie", icon: Sparkles },
  { id: "science", label: "Science", icon: FlaskConical },
  { id: "chrono", label: "Chrono", icon: Clock },
  { id: "persona", label: "Persona", icon: UserCheck },
  { id: "obsessions", label: "Skips", icon: Heart },
  { id: "atlas", label: "Atlas", icon: Globe },
  { id: "search", label: "FTS5", icon: Search },
  { id: "wrapped", label: "Wrapped", icon: Wand2 },
  { id: "hub", label: "Hub & Import", icon: Layers },
];

export const App: React.FC = () => {
  const activeTab = useV4Store((s) => s.activeTab);
  const setActiveTab = useV4Store((s) => s.setActiveTab);
  const filters = useV4Store((s) => s.filters);
  const setFilters = useV4Store((s) => s.setFilters);
  const profiles = useV4Store((s) => s.profiles);
  const activeProfileId = useV4Store((s) => s.activeProfileId);
  const capabilities = useV4Store((s) => s.capabilities);
  const setProfilesData = useV4Store((s) => s.setProfilesData);

  const loadProfilesAndCapabilities = useCallback(async () => {
    try {
      const profRes = await apiGet<{ profiles: ProfileItem[]; active_profile_id: number | null }>(
        "/api/v4/profiles"
      );
      const activeId = profRes.active_profile_id ?? profRes.profiles?.[0]?.id ?? null;
      const caps = await apiGet<ProfileCapabilities>(
        `/api/v4/profile/capabilities${activeId ? `?profile_id=${activeId}` : ""}`
      );
      setProfilesData(profRes.profiles || [], activeId, caps);
    } catch {
      // Backend might be booting or empty
    }
  }, [setProfilesData]);

  useEffect(() => {
    loadProfilesAndCapabilities();
  }, [loadProfilesAndCapabilities]);

  return (
    <div className="relative min-h-screen text-[#f4f1ea] overflow-x-clip">
      {/* SINGLE PERSISTENT 3D CANVAS — NEVER UNMOUNTS (Zero animation reset!) */}
      <PersistentStageCanvas />

      {/* Global Top Bar: Brand + Profile Switcher + Global Platform Filter */}
      <header className="sticky top-0 z-40 px-3 sm:px-6 pt-3 pb-2">
        <div className="max-w-7xl mx-auto glass-pill rounded-2xl px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_12px_#ec4899]" />
            <span className="font-display font-extrabold tracking-tight text-sm sm:text-base">
              AMDataWrap <span className="text-rose-400">V4</span>
            </span>
            <span className="hidden md:inline text-[11px] font-editorial italic text-white/60">
              Sonic Odyssey × Vinyl Studio 3D
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Active Profile Selector */}
            {profiles.length > 0 && (
              <select
                value={activeProfileId ?? ""}
                onChange={(e) => setFilters({ profile_id: Number(e.target.value) })}
                aria-label="Profil actif"
                className="bg-white/10 border border-white/15 rounded-xl px-2.5 py-1 text-white text-xs"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#0c0e18]">
                    {p.kind === "merged" ? "⇄ " : ""}
                    {p.name}
                  </option>
                ))}
              </select>
            )}

            {/* Global Platform Filter */}
            <select
              value={filters.source_provider}
              onChange={(e) => setFilters({ source_provider: e.target.value })}
              aria-label="Filtre plateforme"
              className="bg-white/10 border border-white/15 rounded-xl px-2.5 py-1 text-white text-xs"
            >
              <option value="all" className="bg-[#0c0e18]">Toutes plateformes</option>
              <option value="apple_music" className="bg-[#0c0e18]">Apple Music</option>
              <option value="spotify" className="bg-[#0c0e18]">Spotify</option>
              <option value="youtube_music" className="bg-[#0c0e18]">YouTube Music</option>
              <option value="deezer" className="bg-[#0c0e18]">Deezer</option>
              <option value="tidal" className="bg-[#0c0e18]">TIDAL</option>
            </select>

            {capabilities?.has_incognito_flag && (
              <label className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/5 text-[11px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.exclude_incognito}
                  onChange={(e) => setFilters({ exclude_incognito: e.target.checked })}
                  className="accent-rose-500"
                />
                Sans incognito
              </label>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Stage */}
      <main className="relative z-10 pt-2">
        {activeTab === "studio" ? (
          <VinylStudioView />
        ) : activeTab === "galaxy" ? (
          <GalaxyV4View />
        ) : activeTab === "hub" ? (
          <HubConnectView onRefreshProfiles={loadProfilesAndCapabilities} />
        ) : (
          <AnalyticsSuiteView tab={activeTab} />
        )}
      </main>

      {/* Hybrid 0 EUR Playback Deck (Turntable Digital Display / Floating Cartridge) */}
      <HybridPlaybackDeck />

      {/* VisionOS Floating Glassmorphism Dock */}
      <nav
        aria-label="Navigation AMDataWrap V4"
        className="fixed bottom-3 inset-x-2 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-50 sm:max-w-[96vw] overflow-x-auto glass-pill rounded-full px-1.5 sm:px-2 py-1.5 flex items-center justify-between sm:justify-center gap-0.5 sm:gap-1 shadow-2xl"
      >
        {DOCK_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              data-testid={`nav-${id}`}
              className={`px-1.5 sm:px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition ${
                active
                  ? "bg-gradient-to-r from-rose-500/85 to-indigo-500/85 text-white shadow-lg"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className={active ? "hidden sm:inline" : "hidden lg:inline"}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default App;
