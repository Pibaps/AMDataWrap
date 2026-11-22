/**
 * SearchPage — Instant SQLite FTS5 Full-Text Search across Catalog & Lyrics.
 * Endpoint: GET /api/v3/search?q=...&limit=40
 */

import React, { useEffect, useState } from "react";
import { API, apiGet, formatDurationMs, formatHours, formatInt } from "../../api/client";
import { playTrack } from "../../audio/playTrack";
import { Cover, Empty, Page, PlayButton, Section } from "../../components/ui";

export const SearchPage: React.FC = () => {
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<any[]>([]);
  const [lyricsMatches, setLyricsMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setTracks([]);
      setLyricsMatches([]);
      setLoading(false);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      apiGet<any>(`${API.search}?q=${encodeURIComponent(q)}&limit=40`, ctrl.signal)
        .then((res) => {
          setTracks(res.tracks || res.results || []);
          setLyricsMatches(res.lyrics_matches || []);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) {
            setTracks([]);
            setLyricsMatches([]);
          }
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 220);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  return (
    <Page
      title="Recherche plein-texte"
      kicker="INDEX SQLITE FTS5 UNICODE61"
      intro="Recherche instantanée insensible aux accents dans l'ensemble de ton catalogue de titres, artistes, albums et paroles mises en cache."
    >
      <div className="panel p-5 mb-6">
        <label className="kicker block mb-2" htmlFor="fts5-search-input">
          REQUÊTE (TITRE, ARTISTE, ALBUM OU PAROLES)
        </label>
        <input
          id="fts5-search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ex. Tame Impala, Currents, Let It Happen, Daft Punk…"
          className="field w-full h-11 text-sm px-3.5"
          autoFocus
        />
      </div>

      {query.trim().length < 2 ? (
        <Empty>Saisis au moins 2 caractères pour interroger l&apos;index FTS5.</Empty>
      ) : loading && tracks.length === 0 ? (
        <Empty>Recherche dans l&apos;index…</Empty>
      ) : (
        <div className="space-y-6">
          <Section
            kicker={`CATALOGUE · ${tracks.length} RÉSULTATS`}
            title="Titres correspondants"
          >
            {tracks.length === 0 ? (
              <Empty>Aucun titre trouvé pour « {query} ».</Empty>
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
                        <p className="text-[13.5px] font-medium text-ink truncate">{t.song_name}</p>
                        <p className="text-xs text-ink-2 truncate">
                          {t.artist_name}
                          {t.album_name ? ` · ${t.album_name}` : ""}
                          {t.release_year ? ` (${t.release_year})` : ""}
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

          {lyricsMatches.length > 0 && (
            <Section kicker="PAROLES INDEXÉES" title="Occurrences dans les paroles">
              <div className="divide-y divide-line">
                {lyricsMatches.map((m: any, i: number) => (
                  <div key={i} className="py-2.5 text-xs space-y-1">
                    <p className="font-medium text-ink">
                      {m.song_name} — <span className="text-ink-2">{m.artist_name}</span>
                    </p>
                    {m.snippet && <p className="text-ink-3 italic">{m.snippet}</p>}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </Page>
  );
};
