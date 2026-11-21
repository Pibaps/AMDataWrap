/**
 * TopsPage ("tops", "Classements") — Sub-tabs artistes / albums / titres / genres (~50 rows).
 */

import React, { useMemo, useState } from "react";
import { API, apiGet, buildQueryParams, formatDateFr, formatHours, formatInt, type VinylDetail } from "../../api/client";
import { playTrack } from "../../audio/playTrack";
import { Cover, Empty, ErrorNote, Loading, Page, PlayButton, Section, Tabs } from "../../components/ui";
import { useApi, withQs } from "../../hooks/useApi";
import { useV4Store } from "../../store/useV4Store";

type TopKind = "artists" | "albums" | "tracks" | "genres";

const SUB_TABS: Array<{ id: TopKind; label: string }> = [
  { id: "artists", label: "Artistes" },
  { id: "albums", label: "Albums" },
  { id: "tracks", label: "Titres" },
  { id: "genres", label: "Genres" },
];

export const TopsPage: React.FC = () => {
  const [kind, setKind] = useState<TopKind>("artists");
  const filters = useV4Store((s) => s.filters);
  const qs = useMemo(() => buildQueryParams(filters), [filters]);

  const endpoint =
    kind === "artists"
      ? API.topArtists
      : kind === "albums"
        ? API.topAlbums
        : kind === "tracks"
          ? API.topTracks
          : API.topGenres;

  const limit = kind === "genres" ? 40 : 50;
  const { data, loading, error, reload } = useApi<any>(withQs(endpoint, qs, { limit }));

  const items: any[] = data?.items ?? [];
  const total: number = data?.total ?? items.length;
  const maxMs = useMemo(() => Math.max(1, ...items.map((it) => it.total_ms || 0)), [items]);

  return (
    <Page
      title="Classements"
      kicker="Palmarès détaillé"
      intro="Les cinquante entrées les plus écoutées de votre bibliothèque selon la période active, avec taux de complétion et date de première découverte."
      actions={<Tabs value={kind} onChange={(v) => setKind(v as TopKind)} options={SUB_TABS} />}
    >
      {loading && !data && <Loading rows={8} />}
      {error && !data && <ErrorNote message={error} onRetry={reload} />}

      {data && (
        <Section
          title={SUB_TABS.find((t) => t.id === kind)?.label}
          kicker={`${formatInt(items.length)} affichés sur ${formatInt(total)} au total`}
        >
          {items.length === 0 ? (
            <Empty>Aucune entrée pour cette sélection.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line text-[10.5px] font-mono uppercase tracking-[0.14em] text-ink-3">
                    <th className="py-2.5 pr-3 w-10 text-right">#</th>
                    <th className="py-2.5 px-2">Œuvre / Artiste</th>
                    {kind !== "genres" && <th className="py-2.5 px-2 hidden md:table-cell">Découverte</th>}
                    <th className="py-2.5 px-2 text-right hidden sm:table-cell">
                      {kind === "artists"
                        ? "Catalogue"
                        : kind === "albums"
                          ? "Pistes"
                          : kind === "tracks"
                            ? "Album"
                            : "Catalogue"}
                    </th>
                    <th className="py-2.5 px-2 text-right hidden lg:table-cell">Complétion</th>
                    <th className="py-2.5 pl-3 text-right">Volume</th>
                    {(kind === "tracks" || kind === "albums") && <th className="py-2.5 pl-3 w-10" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-[13px]">
                  {items.map((item, idx) => {
                    const rank = item.rank ?? idx + 1;
                    const pct = Math.max(2, ((item.total_ms || 0) / maxMs) * 100);

                    if (kind === "genres") {
                      return (
                        <tr key={item.genre || idx} className="row-hover">
                          <td className="py-3 pr-3 text-right font-display text-[17px] text-ink-3 num-sans">{rank}</td>
                          <td className="py-3 px-2">
                            <p className="font-medium text-ink">{item.genre}</p>
                            <div className="mt-1.5 h-[3px] w-48 max-w-full bg-bg-4 rounded-full overflow-hidden">
                              <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
                            </div>
                          </td>
                          <td className="py-3 px-2 text-right hidden sm:table-cell text-ink-2 num text-[12px]">
                            {formatInt(item.unique_artists)} art. · {formatInt(item.unique_tracks)} titres
                          </td>
                          <td className="py-3 px-2 text-right hidden lg:table-cell text-ink-2 num text-[12px]">
                            {item.avg_completion_pct}%
                          </td>
                          <td className="py-3 pl-3 text-right">
                            <p className="num text-ink">{formatHours(item.total_ms)}</p>
                            <p className="num text-[11px] text-ink-3">
                              {formatInt(item.plays)} éc. · {item.share_pct}%
                            </p>
                          </td>
                        </tr>
                      );
                    }

                    const title =
                      kind === "artists" ? item.artist_name : kind === "albums" ? item.album_name : item.song_name;
                    const subtitle =
                      kind === "artists"
                        ? item.primary_genre || "Genre non classé"
                        : `${item.artist_name}${item.release_year ? ` · ${item.release_year}` : ""}`;

                    return (
                      <tr key={item.track_key || item.album_group_key || item.artist_group_key || idx} className="row-hover">
                        <td className="py-2.5 pr-3 text-right font-display text-[17px] text-ink-3 num-sans">{rank}</td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-3">
                            <Cover url={item.artwork_url} alt={title} size={40} />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-ink truncate">{title}</p>
                              <p className="text-[11.5px] text-ink-3 truncate">{subtitle}</p>
                              <div className="mt-1 h-[2.5px] w-36 max-w-full bg-bg-4 rounded-full overflow-hidden">
                                <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 hidden md:table-cell text-[12px] text-ink-3 num">
                          {formatDateFr(item.first_discovered)}
                        </td>
                        <td className="py-2.5 px-2 text-right hidden sm:table-cell text-[12px] text-ink-2">
                          {kind === "artists" ? (
                            <span className="num">
                              {formatInt(item.unique_tracks)} t. · {formatInt(item.unique_albums)} alb.
                            </span>
                          ) : kind === "albums" ? (
                            <span className="num">{formatInt(item.unique_tracks)} pistes</span>
                          ) : (
                            <span className="truncate inline-block max-w-[180px] text-ink-3">{item.album_name}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-right hidden lg:table-cell num text-[12px] text-ink-2">
                          <span>{item.avg_completion_pct}%</span>
                          {item.skip_rate_pct !== undefined && (
                            <span className="block text-[10.5px] text-ink-3">skip {item.skip_rate_pct}%</span>
                          )}
                        </td>
                        <td className="py-2.5 pl-3 text-right shrink-0">
                          <p className="num text-ink">{formatHours(item.total_ms)}</p>
                          <p className="num text-[11px] text-ink-3">{formatInt(item.plays)} écoutes</p>
                        </td>
                        {kind === "tracks" && (
                          <td className="py-2.5 pl-3 text-right">
                            <PlayButton
                              onClick={() =>
                                playTrack({
                                  song_name: item.song_name,
                                  artist_name: item.artist_name,
                                  album_name: item.album_name,
                                  artwork_url: item.artwork_url,
                                  track_key: item.track_key,
                                  preview_url: item.preview_url,
                                  duration_ms: item.duration_ms,
                                })
                              }
                            />
                          </td>
                        )}
                        {kind === "albums" && (
                          <td className="py-2.5 pl-3 text-right">
                            <PlayButton
                              title={`Écouter l'album ${item.album_name}`}
                              onClick={async () => {
                                try {
                                  if (item.album_group_key) {
                                    const detail = await apiGet<VinylDetail>(`${API.vinyl(item.album_group_key)}${qs}`);
                                    useV4Store.getState().setOnPlatter(detail);
                                    useV4Store.getState().setActiveSideIndex(0);
                                    const first = detail.sides?.[0]?.tracks?.[0];
                                    if (first) {
                                      playTrack({
                                        song_name: first.title,
                                        artist_name: detail.artist_name,
                                        album_name: detail.album_name,
                                        artwork_url: detail.artwork_url,
                                        track_key: first.track_key,
                                        preview_url: first.preview_url,
                                        duration_ms: first.duration_ms,
                                        vinyl: { album_key: detail.album_key, sideIndex: 0, trackIndex: 0 },
                                      });
                                      return;
                                    }
                                  }
                                } catch {
                                  /* fallback */
                                }
                                playTrack({
                                  song_name: item.album_name,
                                  artist_name: item.artist_name || "",
                                  album_name: item.album_name,
                                  artwork_url: item.artwork_url,
                                });
                              }}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </Page>
  );
};
