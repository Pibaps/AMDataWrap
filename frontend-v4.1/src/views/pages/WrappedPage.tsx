/**
 * WrappedPage — Editorial Magazine Spread Recap & Collector Receipt.
 * Endpoint: GET /api/analytics/wrapped
 */

import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Play } from "lucide-react";
import { API, buildQueryParams, formatHours, formatInt } from "../../api/client";
import type { WrappedData } from "../../api/types";
import { playTrack } from "../../audio/playTrack";
import { Cover, Empty, ErrorNote, Loading, Page, PlayButton } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useT } from "../../i18n";
import { useV4Store } from "../../store/useV4Store";
import { exportWrappedPosterPng, exportWrappedReceiptPng } from "../../utils/wrappedExport";

export const WrappedPage: React.FC = () => {
  const { t, locale } = useT();
  const filters = useV4Store((s) => s.filters);
  const qs = useMemo(() => buildQueryParams(filters), [filters]);
  const { data, loading, error, reload } = useApi<WrappedData>(`${API.wrapped}${qs}`);
  const [slide, setSlide] = useState(0);
  const [exporting, setExporting] = useState(false);

  const slidesCount = 6;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setSlide((s) => Math.min(slidesCount - 1, s + 1));
      else if (e.key === "ArrowLeft") setSlide((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loading && !data) {
    return (
      <Page title="Rétrospective Wrapped" kicker="ÉDITION COLLECTOR">
        <Loading rows={8} />
      </Page>
    );
  }
  if (error && !data) {
    return (
      <Page title="Rétrospective Wrapped" kicker="ÉDITION COLLECTOR">
        <ErrorNote message={error} onRetry={reload} />
      </Page>
    );
  }
  if (!data) {
    return (
      <Page title="Rétrospective Wrapped" kicker="ÉDITION COLLECTOR">
        <Empty>Aucune donnée Wrapped disponible.</Empty>
      </Page>
    );
  }

  const kpis = data.kpis || {};
  const topArtist = data.top_artist;
  const topTrack = data.top_track;
  const topAlbum = data.top_album;
  const topLoop = data.top_loop;
  const topPhase = data.top_phase;

  return (
    <Page
      title="Rétrospective éditoriale"
      kicker={`PÉRIODE : ${data.period_label || "TOUTES ANNÉES"} · CHAPITRE ${slide + 1} / ${slidesCount}`}
      intro="Parcours les chapitres marquants de tes écoutes au clavier (← / →) ou via le sélecteur ci-dessous."
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {topTrack && (
            <button
              type="button"
              onClick={() =>
                playTrack({
                  song_name: topTrack.song_name,
                  artist_name: topTrack.artist_name || "",
                  album_name: topTrack.album_name || "",
                  artwork_url: topTrack.artwork_url,
                  track_key: topTrack.track_key,
                  preview_url: topTrack.preview_url,
                })
              }
              className="btn text-xs"
            >
              <Play className="w-3.5 h-3.5" />
              {t("wrapped.autoSoundtrack")}
            </button>
          )}
          <button
            type="button"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await exportWrappedPosterPng(data, locale);
              } finally {
                setExporting(false);
              }
            }}
            data-testid="wrapped-export-poster"
            className="btn text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            {t("wrapped.exportPoster")}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await exportWrappedReceiptPng(data, locale);
              } finally {
                setExporting(false);
              }
            }}
            data-testid="wrapped-export-receipt"
            className="btn text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            {t("wrapped.exportReceipt")}
          </button>
          <button
            className="btn btn-icon"
            disabled={slide <= 0}
            onClick={() => setSlide((s) => Math.max(0, s - 1))}
            aria-label="Chapitre précédent"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {Array.from({ length: slidesCount }).map((_, idx) => (
            <button
              key={idx}
              onClick={() => setSlide(idx)}
              className="chip num"
              data-active={slide === idx}
            >
              0{idx + 1}
            </button>
          ))}
          <button
            className="btn btn-icon"
            disabled={slide >= slidesCount - 1}
            onClick={() => setSlide((s) => Math.min(slidesCount - 1, s + 1))}
            aria-label="Chapitre suivant"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      }
    >
      {/* Slide 01: Volume & Equivalents */}
      {slide === 0 && (
        <div className="panel p-8 sm:p-12 space-y-8">
          <div>
            <p className="kicker text-amber">CHAPITRE 01 · LE VOLUME SONORE</p>
            <h2 className="font-display text-[48px] sm:text-[68px] leading-none font-[420] mt-2 num-sans">
              {formatHours(kpis.total_ms || 0)}
            </h2>
            <p className="text-ink-2 text-base mt-3">
              Soit <strong>{formatInt(kpis.plays)} écoutes validées</strong> réparties sur{" "}
              <strong>{formatInt(kpis.active_days)} journées actives</strong> ({formatInt(kpis.total_sessions)}{" "}
              sessions reconstituées).
            </p>
          </div>

          <div className="rule" />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {(data.equivalents || []).map((eq: any) => (
              <div key={eq.label} className="p-4 rounded bg-bg-3 border border-line">
                <p className="kicker">{eq.label}</p>
                <p className="font-display text-3xl text-amber mt-1.5 num-sans">{eq.value}</p>
                <p className="text-xs text-ink-3 mt-1">{eq.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Slide 02: Top #1 Artist */}
      {slide === 1 && topArtist && (
        <div className="panel p-8 sm:p-12 grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-4 flex justify-center">
            <Cover url={topArtist.artwork_url} alt={topArtist.artist_name} size={220} />
          </div>
          <div className="md:col-span-8 space-y-4">
            <p className="kicker text-amber">CHAPITRE 02 · ARTISTE N°1</p>
            <h2 className="font-display text-4xl sm:text-5xl font-[450]">{topArtist.artist_name}</h2>
            <p className="text-ink-2 text-sm leading-relaxed">
              Découvert le <strong>{topArtist.first_discovered}</strong> ·{" "}
              <strong>{formatInt(topArtist.plays)} écoutes</strong> ({formatHours(topArtist.total_ms)}) sur{" "}
              <strong>{topArtist.unique_tracks} titres</strong> et <strong>{topArtist.unique_albums} albums</strong>.
            </p>
            {topArtist.glory_month && (
              <div className="p-4 rounded bg-bg-3 border border-line inline-block">
                <p className="kicker">MOIS D&apos;APOGÉE</p>
                <p className="num text-base text-ink mt-1">
                  {topArtist.glory_month.month} — {topArtist.glory_month.plays} écoutes (
                  {formatHours(topArtist.glory_month.total_ms)})
                </p>
              </div>
            )}
            {topArtist.signature_song && (
              <div className="pt-2">
                <button
                  onClick={() =>
                    playTrack({
                      song_name: topArtist.signature_song || topArtist.artist_name,
                      artist_name: topArtist.artist_name,
                      artwork_url: topArtist.artwork_url,
                      preview_url: topArtist.preview_url,
                    })
                  }
                  className="btn btn-primary"
                >
                  Écouter « {topArtist.signature_song} »
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Slide 03: Top #1 Track */}
      {slide === 2 && topTrack && (
        <div className="panel p-8 sm:p-12 grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-4 flex justify-center">
            <Cover url={topTrack.artwork_url} alt={topTrack.song_name} size={220} />
          </div>
          <div className="md:col-span-8 space-y-4">
            <p className="kicker text-amber">CHAPITRE 03 · TITRE N°1</p>
            <h2 className="font-display text-4xl sm:text-5xl font-[450]">{topTrack.song_name}</h2>
            <p className="text-lg text-ink-2">
              {topTrack.artist_name} · <span className="italic">{topTrack.album_name}</span>
            </p>
            <div className="grid grid-cols-3 gap-4 pt-2 max-w-md">
              <div className="p-3 rounded bg-bg-3 border border-line">
                <p className="kicker">ÉCOUTES</p>
                <p className="font-display text-2xl mt-1 num-sans">{topTrack.plays}</p>
              </div>
              <div className="p-3 rounded bg-bg-3 border border-line">
                <p className="kicker">DURÉE</p>
                <p className="font-display text-2xl mt-1 num-sans">{formatHours(topTrack.total_ms)}</p>
              </div>
              <div className="p-3 rounded bg-bg-3 border border-line">
                <p className="kicker">COMPLÉTION</p>
                <p className="font-display text-2xl mt-1 num-sans">{topTrack.avg_completion_pct} %</p>
              </div>
            </div>
            <div className="pt-2">
              <PlayButton
                size={38}
                onClick={() =>
                  playTrack({
                    song_name: topTrack.song_name,
                    artist_name: topTrack.artist_name,
                    album_name: topTrack.album_name,
                    artwork_url: topTrack.artwork_url,
                    track_key: topTrack.track_key,
                    preview_url: topTrack.preview_url,
                  })
                }
              />
            </div>
          </div>
        </div>
      )}

      {/* Slide 04: Top Album */}
      {slide === 3 && (
        <div className="panel p-8 sm:p-12 grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-4 flex justify-center">
            <Cover url={topAlbum?.artwork_url || topTrack?.artwork_url} alt={topAlbum?.album_name || ""} size={220} />
          </div>
          <div className="md:col-span-8 space-y-4">
            <p className="kicker text-amber">CHAPITRE 04 · PRESSAGES &amp; ALBUM N°1</p>
            <h2 className="font-display text-4xl sm:text-5xl font-[450]">
              {topAlbum?.album_name || topTrack?.album_name || "Album favori"}
            </h2>
            <p className="text-lg text-ink-2">{topAlbum?.artist_name || topTrack?.artist_name}</p>
            {topAlbum && (
              <p className="text-sm text-ink-2">
                <strong>{formatInt(topAlbum.plays)} écoutes</strong> ({formatHours(topAlbum.total_ms)}) sur{" "}
                <strong>{topAlbum.unique_tracks} pistes</strong> · Taux de complétion{" "}
                <strong>{topAlbum.avg_completion_pct} %</strong>.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Slide 05: Obsession Phase & Record Loop */}
      {slide === 4 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {topPhase && (
            <div className="panel p-7 space-y-4">
              <p className="kicker text-amber">CHAPITRE 05A · PLUS FORTE PHASE D&apos;OBSESSION (14 J)</p>
              <div className="flex items-center gap-4">
                <Cover url={topPhase.artwork_url} alt={topPhase.artist_name} size={72} />
                <div>
                  <h3 className="font-display text-2xl font-[500]">{topPhase.artist_name}</h3>
                  <p className="num text-xs text-ink-2 mt-1">
                    {topPhase.start_date} → {topPhase.end_date}
                  </p>
                </div>
              </div>
              <p className="text-sm text-ink-2">
                <strong>{topPhase.plays} écoutes</strong> en 14 jours ({topPhase.window_share_pct} % de toutes tes
                écoutes sur la période, soit un multiplicateur <strong>×{topPhase.lift}</strong> par rapport à ta
                moyenne).
              </p>
            </div>
          )}

          {topLoop && (
            <div className="panel p-7 space-y-4">
              <p className="kicker text-amber">CHAPITRE 05B · RECORD D&apos;ÉCOUTE EN BOUCLE</p>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <Cover url={topLoop.artwork_url} alt={topLoop.song_name} size={72} />
                  <div className="min-w-0">
                    <h3 className="font-display text-2xl font-[500] truncate">{topLoop.song_name}</h3>
                    <p className="text-xs text-ink-2 mt-0.5 truncate">{topLoop.artist_name}</p>
                  </div>
                </div>
                <PlayButton
                  size={36}
                  onClick={() =>
                    playTrack({
                      song_name: topLoop.song_name,
                      artist_name: topLoop.artist_name,
                      album_name: topLoop.album_name,
                      artwork_url: topLoop.artwork_url,
                      track_key: topLoop.track_key,
                      preview_url: topLoop.preview_url,
                    })
                  }
                />
              </div>
              <p className="text-sm text-ink-2">
                Rejoué <strong>{topLoop.max_consecutive} fois d&apos;affilée</strong> au sein d&apos;une même session
                le <span className="num">{topLoop.peak_date}</span> ({topLoop.loop_repeats} répétitions au total).
              </p>
            </div>
          )}
        </div>
      )}

      {/* Slide 06: Collector Receipt / Liner Note Summary */}
      {slide === 5 && (
        <div className="max-w-lg mx-auto panel-raised p-7 space-y-4 num text-xs">
          <div className="text-center border-b border-line pb-4">
            <p className="font-display text-2xl text-ink tracking-tight">AMDATAWRAP COLLECTOR</p>
            <p className="text-ink-3 mt-1">SALON D&apos;ÉCOUTE · FICHE DE PRESSAGE</p>
            <p className="text-ink-2 mt-0.5">{data.period_label}</p>
          </div>

          <div className="space-y-2 py-2 border-b border-line">
            <div className="flex justify-between">
              <span>01 · ARTISTE #1</span>
              <strong className="text-ink">{topArtist?.artist_name || "—"}</strong>
            </div>
            <div className="flex justify-between">
              <span>02 · TITRE #1</span>
              <strong className="text-ink">{topTrack?.song_name || "—"}</strong>
            </div>
            <div className="flex justify-between">
              <span>03 · ALBUM #1</span>
              <strong className="text-ink">{topAlbum?.album_name || topTrack?.album_name || "—"}</strong>
            </div>
            <div className="flex justify-between">
              <span>04 · HEURE DE PIC</span>
              <strong className="text-ink">{data.rhythm?.peak_hour ?? 21}h00</strong>
            </div>
            <div className="flex justify-between">
              <span>05 · SESSIONS</span>
              <strong className="text-ink">{formatInt(kpis.total_sessions)}</strong>
            </div>
          </div>

          <div className="flex justify-between text-sm pt-1">
            <span>TOTAL CUMULÉ</span>
            <strong className="text-amber">
              {formatInt(kpis.plays)} PLAYS · {formatHours(kpis.total_ms || 0)}
            </strong>
          </div>
        </div>
      )}
    </Page>
  );
};
