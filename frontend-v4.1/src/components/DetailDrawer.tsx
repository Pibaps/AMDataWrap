/**
 * DetailDrawer — Universal Contextual Slide-Over Drawer (Artist / Album / Day).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Disc3, ExternalLink, X } from "lucide-react";
import { API, apiGet, buildQueryParams, formatDateFr, formatDurationMs, formatHours, formatInt, type VinylDetail } from "../api/client";
import type { AlbumDetailData, ArtistBioData, ArtistDetailData, DayDetailData } from "../api/types";
import { playTrack } from "../audio/playTrack";
import { useT } from "../i18n";
import { useV4Store } from "../store/useV4Store";
import { Cover, PlayButton } from "./ui";

export const DetailDrawer: React.FC = () => {
  const { t } = useT();
  const drawerTarget = useV4Store((s) => s.drawerTarget);
  const openDrawer = useV4Store((s) => s.openDrawer);
  const closeDrawer = useV4Store((s) => s.closeDrawer);
  const filters = useV4Store((s) => s.filters);
  const setActiveTab = useV4Store((s) => s.setActiveTab);
  const setVinylStage = useV4Store((s) => s.setVinylStage);
  const setOnPlatter = useV4Store((s) => s.setOnPlatter);
  const setActiveSideIndex = useV4Store((s) => s.setActiveSideIndex);

  const qs = useMemo(() => buildQueryParams(filters), [filters]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artistData, setArtistData] = useState<ArtistDetailData | null>(null);
  const [artistBio, setArtistBio] = useState<ArtistBioData | null>(null);
  const [albumData, setAlbumData] = useState<AlbumDetailData | null>(null);
  const [dayData, setDayData] = useState<DayDetailData | null>(null);

  useEffect(() => {
    if (!drawerTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerTarget, closeDrawer]);

  useEffect(() => {
    if (!drawerTarget) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setArtistData(null);
    setArtistBio(null);
    setAlbumData(null);
    setDayData(null);

    (async () => {
      try {
        if (drawerTarget.type === "artist") {
          const detail = await apiGet<ArtistDetailData>(`${API.detailArtist(drawerTarget.key)}${qs}`);
          if (cancelled) return;
          setArtistData(detail);
          const name = detail.summary?.artist_name;
          if (name) {
            apiGet<ArtistBioData>(`/api/external/artist-bio?artist=${encodeURIComponent(name)}`)
              .then((bio) => {
                if (!cancelled) setArtistBio(bio);
              })
              .catch(() => {});
          }
        } else if (drawerTarget.type === "album") {
          const detail = await apiGet<AlbumDetailData>(`${API.detailAlbum(drawerTarget.key)}${qs}`);
          if (!cancelled) setAlbumData(detail);
        } else if (drawerTarget.type === "day") {
          const detail = await apiGet<DayDetailData>(`${API.detailDay(drawerTarget.date)}${qs}`);
          if (!cancelled) setDayData(detail);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Erreur");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [drawerTarget, qs]);

  if (!drawerTarget) return null;

  const placeAlbumOnTurntable = async (albumKey: string, fallbackName: string, fallbackArtist: string, fallbackArt?: string | null) => {
    try {
      const detail = await apiGet<VinylDetail>(`${API.vinyl(albumKey)}${qs}`);
      setOnPlatter(detail);
      setActiveSideIndex(0);
      closeDrawer();
      setActiveTab("studio");
      setVinylStage("TURNTABLE");
      const first = detail.sides?.[0]?.tracks?.[0];
      if (first) {
        playTrack({
          song_name: first.title,
          artist_name: first.artist_name || detail.artist_name,
          album_name: detail.album_name,
          artwork_url: detail.artwork_url,
          track_key: first.track_key,
          preview_url: first.preview_url,
          duration_ms: first.duration_ms,
          vinyl: { album_key: detail.album_key, sideIndex: 0, trackIndex: 0 },
        });
        return;
      }
    } catch {
      /* fallback */
    }
    closeDrawer();
    playTrack({
      song_name: fallbackName,
      artist_name: fallbackArtist,
      album_name: fallbackName,
      artwork_url: fallbackArt,
    });
  };

  const kicker =
    drawerTarget.type === "artist"
      ? t("drawer.artist")
      : drawerTarget.type === "album"
      ? t("drawer.album")
      : t("drawer.day");

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="detail-drawer">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={closeDrawer} />
      <aside className="relative z-10 w-full max-w-xl bg-bg-2 border-l border-line-2 h-full overflow-y-auto p-5 sm:p-7 pb-24 space-y-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <span className="kicker text-amber">{kicker}</span>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label={t("drawer.close")}
            className="p-1.5 rounded text-ink-3 hover:text-ink hover:bg-bg-3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading && <p className="text-xs text-ink-3 py-8 text-center">{t("drawer.loading")}</p>}
        {error && <p className="text-xs text-ember num">{error}</p>}

        {/* Artist Drawer */}
        {!loading && drawerTarget.type === "artist" && artistData && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Cover url={artistData.summary.artwork_url || artistBio?.thumbnail} alt={artistData.summary.artist_name || ""} size={80} rounded />
              <div className="min-w-0">
                <h2 className="font-display text-2xl sm:text-3xl font-[450] text-ink truncate">
                  {artistData.summary.artist_name || drawerTarget.key}
                </h2>
                <p className="text-xs text-ink-2 mt-1">
                  {artistData.summary.genre || "—"} · {formatHours(artistData.summary.total_ms)} · {formatInt(artistData.summary.plays)} {t("common.plays")}
                </p>
                <p className="text-[11px] text-ink-3 num mt-0.5">
                  {formatInt(artistData.summary.unique_tracks)} titres · {formatInt(artistData.summary.unique_albums)} albums · {artistData.summary.avg_completion_pct}% compl.
                </p>
              </div>
            </div>

            {artistBio?.found && artistBio.summary && (
              <div className="p-3.5 rounded bg-bg-3 border border-line space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="kicker">{t("drawer.bio")}</span>
                  {artistBio.url && (
                    <a
                      href={artistBio.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-amber hover:underline"
                    >
                      Wikipedia <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <p className="text-ink-2 leading-relaxed line-clamp-4">{artistBio.summary}</p>
              </div>
            )}

            {artistData.best_day && (
              <button
                type="button"
                onClick={() => openDrawer({ type: "day", date: artistData.best_day!.date })}
                className="w-full text-left p-3.5 rounded bg-bg-3 border border-line hover:border-amber/60 transition-colors flex items-center justify-between text-xs"
              >
                <div>
                  <p className="kicker text-amber">{t("drawer.bestDay")}</p>
                  <p className="text-ink font-medium mt-0.5">{formatDateFr(artistData.best_day.date)}</p>
                </div>
                <div className="text-right num">
                  <p className="text-ink">{formatHours(artistData.best_day.total_ms)}</p>
                  <p className="text-ink-3">{formatInt(artistData.best_day.plays)} {t("common.plays")}</p>
                </div>
              </button>
            )}

            {artistData.monthly.length > 1 && (
              <div>
                <p className="kicker mb-2">{t("drawer.monthlyEvolution")}</p>
                <div className="flex items-end gap-1 h-14 bg-bg-3 p-2 rounded border border-line">
                  {(() => {
                    const maxM = Math.max(1, ...artistData.monthly.map((m) => m.total_ms || 0));
                    return artistData.monthly.slice(-24).map((m) => (
                      <div
                        key={m.month}
                        title={`${m.month} · ${formatHours(m.total_ms)}`}
                        className="flex-1 bg-amber/75 rounded-t-[1px] min-w-[3px]"
                        style={{ height: `${Math.max(8, ((m.total_ms || 0) / maxM) * 100)}%` }}
                      />
                    ));
                  })()}
                </div>
              </div>
            )}

            {artistData.top_albums.length > 0 && (
              <div>
                <p className="kicker mb-2">{t("drawer.topAlbums")}</p>
                <div className="divide-y divide-line">
                  {artistData.top_albums.slice(0, 6).map((al) => (
                    <button
                      type="button"
                      key={al.album_group_key}
                      onClick={() => openDrawer({ type: "album", key: al.album_group_key })}
                      className="w-full py-2 flex items-center gap-3 text-left row-hover px-1"
                    >
                      <Cover url={al.artwork_url} alt={al.album_name} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-ink truncate">{al.album_name}</p>
                        <p className="text-[11px] text-ink-3">{al.release_year || "—"}</p>
                      </div>
                      <span className="num text-xs text-ink-2 shrink-0">{formatHours(al.total_ms)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {artistData.top_tracks.length > 0 && (
              <div>
                <p className="kicker mb-2">{t("drawer.topTracks")}</p>
                <div className="divide-y divide-line">
                  {artistData.top_tracks.slice(0, 12).map((tr) => (
                    <div key={tr.track_key} className="py-2 flex items-center gap-3 px-1">
                      <Cover url={tr.artwork_url} alt={tr.song_name} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-ink truncate">{tr.song_name}</p>
                        <p className="text-[11px] text-ink-3 truncate">{tr.album_name}</p>
                      </div>
                      <span className="num text-[11px] text-ink-2 shrink-0">{formatInt(tr.plays)}×</span>
                      <PlayButton
                        onClick={() =>
                          playTrack({
                            song_name: tr.song_name,
                            artist_name: artistData.summary.artist_name || "",
                            album_name: tr.album_name,
                            artwork_url: tr.artwork_url,
                            track_key: tr.track_key,
                            preview_url: tr.preview_url,
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Album Drawer */}
        {!loading && drawerTarget.type === "album" && albumData && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Cover url={albumData.summary.artwork_url} alt={albumData.summary.album_name || ""} size={88} />
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-2xl font-[450] text-ink truncate">
                  {albumData.summary.album_name || drawerTarget.key}
                </h2>
                {albumData.summary.artist_group_key ? (
                  <button
                    type="button"
                    onClick={() => openDrawer({ type: "artist", key: albumData.summary.artist_group_key! })}
                    className="text-xs text-amber hover:underline mt-0.5"
                  >
                    {albumData.summary.artist_name}
                  </button>
                ) : (
                  <p className="text-xs text-ink-2 mt-0.5">{albumData.summary.artist_name}</p>
                )}
                <p className="text-[11.5px] text-ink-3 num mt-1">
                  {albumData.summary.release_year || "—"} · {formatHours(albumData.summary.total_ms)} · {formatInt(albumData.summary.plays)} {t("common.plays")}
                </p>
              </div>
            </div>

            <button
              type="button"
              data-testid="drawer-place-on-turntable"
              onClick={() =>
                placeAlbumOnTurntable(
                  albumData.album_group_key,
                  albumData.summary.album_name || "",
                  albumData.summary.artist_name || "",
                  albumData.summary.artwork_url
                )
              }
              className="btn btn-primary w-full justify-center h-9 text-xs"
            >
              <Disc3 className="w-4 h-4" />
              {t("drawer.placeOnTurntable")}
            </button>

            <div>
              <p className="kicker mb-2">{t("drawer.tracks")} ({albumData.tracks.length})</p>
              <div className="divide-y divide-line">
                {albumData.tracks.map((tr) => (
                  <div key={tr.track_key} className="py-2 flex items-center gap-3 px-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-ink truncate">{tr.song_name}</p>
                      <p className="text-[11px] text-ink-3 num">
                        {formatInt(tr.plays)} {t("common.plays")} · {formatHours(tr.total_ms)} · {tr.avg_completion_pct ?? 0}%
                      </p>
                    </div>
                    <PlayButton
                      onClick={() =>
                        playTrack({
                          song_name: tr.song_name,
                          artist_name: tr.artist_name || albumData.summary.artist_name || "",
                          album_name: albumData.summary.album_name || "",
                          artwork_url: tr.artwork_url || albumData.summary.artwork_url,
                          track_key: tr.track_key,
                          preview_url: tr.preview_url,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Day Drawer */}
        {!loading && drawerTarget.type === "day" && dayData && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-bg-3 border border-line flex items-center justify-center text-amber">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display text-2xl font-[450] text-ink">{formatDateFr(dayData.date)}</h2>
                <p className="text-xs text-ink-2 num">
                  {formatInt(dayData.plays)} {t("common.plays")} · {formatHours(dayData.total_ms)}
                </p>
              </div>
            </div>

            <div>
              <p className="kicker mb-2">{t("drawer.timeline")}</p>
              <div className="divide-y divide-line">
                {dayData.events.map((ev) => (
                  <div key={ev.id} className="py-2.5 flex items-center gap-3 px-1">
                    <span className="num text-[11px] text-ink-3 w-11 shrink-0">
                      {ev.started_at_local.slice(11, 16)}
                    </span>
                    <Cover url={ev.artwork_url} alt={ev.song_name} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-ink truncate">{ev.song_name}</p>
                      <p className="text-[11px] text-ink-3 truncate">
                        {ev.artist_group_key ? (
                          <button
                            type="button"
                            onClick={() => openDrawer({ type: "artist", key: ev.artist_group_key! })}
                            className="hover:text-amber transition-colors"
                          >
                            {ev.artist_name}
                          </button>
                        ) : (
                          ev.artist_name
                        )}{" "}
                        · {formatDurationMs(ev.play_duration_ms)}
                      </p>
                    </div>
                    <PlayButton
                      onClick={() =>
                        playTrack({
                          song_name: ev.song_name,
                          artist_name: ev.artist_name || "",
                          album_name: ev.album_name,
                          artwork_url: ev.artwork_url,
                          track_key: ev.track_key,
                          preview_url: ev.preview_url,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};
