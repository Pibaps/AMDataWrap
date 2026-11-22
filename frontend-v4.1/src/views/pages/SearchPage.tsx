/**
 * SearchPage — Smart Typo-Tolerant Search with Auto-Completion, Multi-Entity Results & Filters.
 * Endpoints:
 * - GET /api/v3/search/suggest?q=...
 * - GET /api/v3/search?q=...&scope=...&genre=...&year_from=...&min_plays=...&sort=...
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Search, Sparkles, X } from "lucide-react";
import { API, apiGet, formatDurationMs, formatHours, formatInt } from "../../api/client";
import { playTrack } from "../../audio/playTrack";
import { HistorySessionsPanel } from "../../components/HistorySessionsPanel";
import { Cover, Empty, Page, PlayButton, Section, Tabs } from "../../components/ui";
import { useT } from "../../i18n";
import { useV4Store } from "../../store/useV4Store";

interface SuggestionItem {
  kind: "artist" | "album" | "track" | "genre";
  label: string;
  sublabel: string;
  query: string;
  artwork_url: string | null;
  plays: number;
}

const SCOPE_OPTIONS = [
  { id: "all", label: "Tout" },
  { id: "tracks", label: "Titres" },
  { id: "artists", label: "Artistes" },
  { id: "albums", label: "Albums" },
  { id: "lyrics", label: "Paroles" },
] as const;

const KIND_BADGE: Record<SuggestionItem["kind"], string> = {
  artist: "Artiste",
  album: "Album",
  track: "Titre",
  genre: "Genre",
};

export const SearchPage: React.FC = () => {
  const { t } = useT();
  const openDrawer = useV4Store((s) => s.openDrawer);

  const [subTab, setSubTab] = useState<"fts" | "sessions" | "history">("fts");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "tracks" | "artists" | "albums" | "lyrics">("all");
  const [genreFilter, setGenreFilter] = useState<string>("all");
  const [yearFrom, setYearFrom] = useState<string>("");
  const [yearTo, setYearTo] = useState<string>("");
  const [minPlays, setMinPlays] = useState<number>(0);
  const [sort, setSort] = useState<"relevance" | "plays" | "duration">("relevance");

  const [tracks, setTracks] = useState<any[]>([]);
  const [artists, setArtists] = useState<any[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [lyricsMatches, setLyricsMatches] = useState<any[]>([]);
  const [didYouMean, setDidYouMean] = useState<string | null>(null);
  const [facetGenres, setFacetGenres] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Auto-completion state
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSugIdx, setActiveSugIdx] = useState(-1);
  const inputWrapRef = useRef<HTMLDivElement | null>(null);

  // Close suggestions dropdown on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (inputWrapRef.current && !inputWrapRef.current.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Fetch autocomplete suggestions
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      apiGet<{ suggestions: SuggestionItem[] }>(
        `${API.search}/suggest?q=${encodeURIComponent(query.trim())}&limit=8`,
        ctrl.signal
      )
        .then((res) => {
          setSuggestions(res.suggestions || []);
          setActiveSugIdx(-1);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setSuggestions([]);
        });
    }, 110);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  // Execute smart search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setTracks([]);
      setArtists([]);
      setAlbums([]);
      setLyricsMatches([]);
      setDidYouMean(null);
      setLoading(false);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      const qs = new URLSearchParams({
        q,
        limit: "40",
        scope,
        sort,
      });
      if (genreFilter && genreFilter !== "all") qs.set("genre", genreFilter);
      if (yearFrom.trim()) qs.set("year_from", yearFrom.trim());
      if (yearTo.trim()) qs.set("year_to", yearTo.trim());
      if (minPlays > 0) qs.set("min_plays", String(minPlays));

      apiGet<any>(`${API.search}?${qs.toString()}`, ctrl.signal)
        .then((res) => {
          setTracks(res.tracks || []);
          setArtists(res.artists || []);
          setAlbums(res.albums || []);
          setLyricsMatches(res.lyrics_matches || []);
          setDidYouMean(res.did_you_mean || null);
          if (Array.isArray(res.facets?.genres) && res.facets.genres.length > 0) {
            setFacetGenres(res.facets.genres);
          }
        })
        .catch(() => {
          if (!ctrl.signal.aborted) {
            setTracks([]);
            setArtists([]);
            setAlbums([]);
            setLyricsMatches([]);
            setDidYouMean(null);
          }
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 190);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, scope, genreFilter, yearFrom, yearTo, minPlays, sort]);

  const applySuggestion = useCallback((sug: SuggestionItem) => {
    if (sug.kind === "genre") {
      setGenreFilter(sug.label);
      setQuery(sug.label);
    } else {
      setQuery(sug.query);
    }
    setSuggestOpen(false);
    setActiveSugIdx(-1);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSugIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSugIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeSugIdx >= 0 && suggestions[activeSugIdx]) {
      e.preventDefault();
      applySuggestion(suggestions[activeSugIdx]);
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
    }
  };

  const hasActiveFilters =
    scope !== "all" || genreFilter !== "all" || yearFrom !== "" || yearTo !== "" || minPlays > 0 || sort !== "relevance";

  const resetSearchFilters = () => {
    setScope("all");
    setGenreFilter("all");
    setYearFrom("");
    setYearTo("");
    setMinPlays(0);
    setSort("relevance");
  };

  return (
    <Page
      title={t("nav.search")}
      kicker="RECHERCHE INTELLIGENTE · AUTO-COMPLÉTION · TOLÉRANCE AUX FAUTES"
      intro="Recherche instantanée tolérante aux fautes de frappe et sans accents dans ton catalogue (titres, artistes, albums, paroles), sessions et historique."
      actions={
        <Tabs
          value={subTab}
          onChange={(v) => setSubTab(v as "fts" | "sessions" | "history")}
          options={[
            { id: "fts", label: t("search.tabFts") },
            { id: "sessions", label: t("search.tabSessions") },
            { id: "history", label: t("search.tabHistory") },
          ]}
        />
      }
    >
      {subTab !== "fts" ? (
        <HistorySessionsPanel key={subTab} initialMode={subTab} />
      ) : (
        <>
          <div className="panel p-5 mb-6 space-y-4">
            <div ref={inputWrapRef} className="relative">
              <label className="kicker block mb-2" htmlFor="fts5-search-input">
                REQUÊTE (TITRE, ARTISTE, ALBUM OU PAROLES — FAUTES TOLÉRÉES)
              </label>
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-ink-3 absolute left-3.5 pointer-events-none" />
                <input
                  id="fts5-search-input"
                  type="text"
                  value={query}
                  onFocus={() => setSuggestOpen(true)}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSuggestOpen(true);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Ex. josmna, mac miler, tame impala, let it hapen…"
                  className="field w-full h-11 text-sm pl-10 pr-10"
                  autoComplete="off"
                  autoFocus
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setSuggestOpen(true);
                    }}
                    aria-label="Effacer la recherche"
                    className="absolute right-3 text-ink-3 hover:text-ink transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Autocomplete Dropdown */}
              {suggestOpen && suggestions.length > 0 && (
                <div
                  role="listbox"
                  className="absolute left-0 right-0 top-full mt-1.5 z-40 rounded-lg border border-line-2 bg-bg-2 shadow-2xl overflow-hidden divide-y divide-line/60"
                >
                  {suggestions.map((sug, idx) => (
                    <button
                      key={`${sug.kind}-${sug.label}-${idx}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applySuggestion(sug);
                      }}
                      className={`w-full px-3.5 py-2 flex items-center justify-between gap-3 text-left transition-colors ${
                        idx === activeSugIdx ? "bg-amber/15" : "hover:bg-bg-3"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Cover url={sug.artwork_url} alt={sug.label} size={30} rounded={sug.kind === "artist"} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-ink truncate">{sug.label}</p>
                          <p className="text-[11px] text-ink-3 truncate">{sug.sublabel}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="num text-[10.5px] text-ink-3">{formatInt(sug.plays)} éc.</span>
                        <span className="px-1.5 py-0.5 rounded bg-bg-4 text-[10px] font-mono text-ink-2">
                          {KIND_BADGE[sug.kind]}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Smart Search Filters & Scope Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line/60 text-xs">
              <div className="flex flex-wrap items-center gap-1 bg-bg-3 border border-line-2 rounded p-0.5">
                {SCOPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setScope(opt.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                      scope === opt.id ? "bg-amber text-[#1a0f07] font-semibold" : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {facetGenres.length > 0 && (
                  <select
                    value={genreFilter}
                    onChange={(e) => setGenreFilter(e.target.value)}
                    aria-label="Filtrer par genre"
                    className="field text-xs py-1"
                  >
                    <option value="all">Tous genres</option>
                    {facetGenres.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                )}

                <input
                  type="number"
                  value={yearFrom}
                  onChange={(e) => setYearFrom(e.target.value)}
                  placeholder="Année min"
                  aria-label="Année minimum"
                  className="field text-xs py-1 w-24 num"
                />
                <input
                  type="number"
                  value={yearTo}
                  onChange={(e) => setYearTo(e.target.value)}
                  placeholder="Année max"
                  aria-label="Année maximum"
                  className="field text-xs py-1 w-24 num"
                />

                <select
                  value={minPlays}
                  onChange={(e) => setMinPlays(Number(e.target.value))}
                  aria-label="Écoutes minimum"
                  className="field text-xs py-1"
                >
                  <option value={0}>Toutes écoutes</option>
                  <option value={5}>5+ écoutes</option>
                  <option value={20}>20+ écoutes</option>
                  <option value={50}>50+ écoutes</option>
                </select>

                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as "relevance" | "plays" | "duration")}
                  aria-label="Trier par"
                  className="field text-xs py-1"
                >
                  <option value="relevance">Pertinence</option>
                  <option value="plays">Plus écoutés</option>
                  <option value="duration">Durée totale</option>
                </select>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetSearchFilters}
                    className="btn text-[11px] py-1 px-2"
                  >
                    Réinitialiser
                  </button>
                )}
              </div>
            </div>
          </div>

          {didYouMean && (
            <div className="mb-5 px-4 py-2.5 rounded-lg border border-amber/35 bg-amber/10 flex items-center gap-2 text-xs">
              <Sparkles className="w-3.5 h-3.5 text-amber shrink-0" />
              <span className="text-ink-2">Faute détectée — voulais-tu dire :</span>
              <button
                type="button"
                onClick={() => setQuery(didYouMean)}
                className="font-semibold text-amber hover:underline"
              >
                {didYouMean}
              </button>
              <span className="text-ink-3">?</span>
            </div>
          )}

          {query.trim().length < 2 ? (
            <Empty>Saisis au moins 2 caractères pour lancer la recherche intelligente (ou choisis une suggestion ci-dessus).</Empty>
          ) : loading && tracks.length === 0 && artists.length === 0 && albums.length === 0 ? (
            <Empty>Recherche intelligente en cours…</Empty>
          ) : (
            <div className="space-y-6">
              {artists.length > 0 && (
                <Section kicker={`ARTISTES · ${artists.length}`} title="Artistes correspondants">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {artists.map((a: any) => (
                      <button
                        key={a.artist_group_key || a.artist_name}
                        type="button"
                        onClick={() => openDrawer({ type: "artist", key: a.artist_group_key || a.artist_name })}
                        className="p-2.5 rounded border border-line bg-bg-3/50 hover:border-amber/50 flex items-center gap-3 text-left transition-colors"
                      >
                        <Cover url={a.artwork_url} alt={a.artist_name} size={40} rounded />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-ink truncate">{a.artist_name}</p>
                          <p className="text-[11px] text-ink-3 num">
                            {formatInt(a.plays)} éc. · {a.track_count} titres
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {albums.length > 0 && (
                <Section kicker={`ALBUMS · ${albums.length}`} title="Albums correspondants">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {albums.map((alb: any) => (
                      <button
                        key={alb.album_group_key || alb.album_name}
                        type="button"
                        onClick={() => openDrawer({ type: "album", key: alb.album_group_key || alb.album_name })}
                        className="p-2.5 rounded border border-line bg-bg-3/50 hover:border-amber/50 flex items-center gap-3 text-left transition-colors"
                      >
                        <Cover url={alb.artwork_url} alt={alb.album_name} size={42} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-ink truncate">{alb.album_name}</p>
                          <p className="text-[11px] text-ink-2 truncate">
                            {alb.artist_name}
                            {alb.release_year ? ` · ${alb.release_year}` : ""}
                          </p>
                          <p className="text-[10.5px] text-ink-3 num">{formatInt(alb.plays)} écoutes</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {scope !== "lyrics" && (
                <Section kicker={`CATALOGUE · ${tracks.length} RÉSULTATS`} title="Titres correspondants">
                  {tracks.length === 0 ? (
                    <Empty>Aucun titre trouvé pour « {query} » avec ces filtres.</Empty>
                  ) : (
                    <div className="divide-y divide-line">
                      {tracks.map((t: any, idx: number) => (
                        <div
                          key={t.track_key || idx}
                          className="py-2.5 flex items-center justify-between gap-3 row-hover px-2 rounded"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <Cover url={t.artwork_url} alt={t.song_name} size={40} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-[13.5px] font-medium text-ink truncate">{t.song_name}</p>
                                {t.match_source === "fuzzy_typo" && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber/15 text-amber text-[9.5px] font-mono shrink-0">
                                    Approché
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-ink-2 truncate">
                                {t.artist_name}
                                {t.album_name ? ` · ${t.album_name}` : ""}
                                {t.release_year ? ` (${t.release_year})` : ""}
                                {t.genre && t.genre !== "Inconnu" ? ` · ${t.genre}` : ""}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 shrink-0">
                            <div className="text-right num text-xs">
                              <p className="text-ink">{formatInt(t.total_plays)} écoutes</p>
                              <p className="text-ink-3 text-[11px]">
                                {t.total_ms >= 3_600_000 ? formatHours(t.total_ms) : formatDurationMs(t.total_ms)}
                              </p>
                            </div>
                            <PlayButton
                              onClick={() =>
                                playTrack({
                                  song_name: t.song_name,
                                  artist_name: t.artist_name || "",
                                  album_name: t.album_name || "",
                                  artwork_url: t.artwork_url,
                                  track_key: t.track_key,
                                  preview_url: t.preview_url,
                                })
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {lyricsMatches.length > 0 && (
                <Section kicker="PAROLES INDEXÉES" title="Occurrences dans les paroles">
                  <div className="divide-y divide-line">
                    {lyricsMatches.map((m: any, i: number) => (
                      <div key={i} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium text-ink">
                            {m.song_name} — <span className="text-ink-2">{m.artist_name}</span>
                          </p>
                          {m.snippet && <p className="text-ink-3 italic">{m.snippet}</p>}
                        </div>
                        {m.track_key && (
                          <PlayButton
                            onClick={() =>
                              playTrack({
                                song_name: m.song_name,
                                artist_name: m.artist_name || "",
                                album_name: m.album_name || "",
                                artwork_url: m.artwork_url,
                                track_key: m.track_key,
                                preview_url: m.preview_url,
                              })
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}
        </>
      )}
    </Page>
  );
};
