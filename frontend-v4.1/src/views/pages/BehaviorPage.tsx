/**
 * BehaviorPage ("behavior", "Habitudes") — End reasons, obsession phases w/ lift, loops, untouchables vs most_skipped, lyrics.
 * Gracefully hides blocks when profile capabilities indicate data is absent.
 */

import React, { useMemo } from "react";
import { API, buildQueryParams, formatDateFr, formatHours, formatInt } from "../../api/client";
import { playTrack } from "../../audio/playTrack";
import { BarList, Cover, Empty, ErrorNote, InfoTooltip, Loading, Page, PlayButton, Section, Stat } from "../../components/ui";
import { useApi, withQs } from "../../hooks/useApi";
import { useV4Store } from "../../store/useV4Store";

export const BehaviorPage: React.FC = () => {
  const filters = useV4Store((s) => s.filters);
  const capabilities = useV4Store((s) => s.capabilities);
  const qs = useMemo(() => buildQueryParams(filters), [filters]);
  const { data, loading, error, reload } = useApi<any>(withQs(API.behavior, qs));

  if (loading && !data) {
    return (
      <Page title="Habitudes" kicker="Comportement & obsessions">
        <Loading rows={6} />
      </Page>
    );
  }
  if (error && !data) {
    return (
      <Page title="Habitudes" kicker="Comportement & obsessions">
        <ErrorNote message={error} onRetry={reload} />
      </Page>
    );
  }
  if (!data) {
    return (
      <Page title="Habitudes" kicker="Comportement & obsessions">
        <Empty>Aucune donnée comportementale disponible.</Empty>
      </Page>
    );
  }

  const {
    end_reasons = [],
    untouchables = [],
    most_skipped = [],
    loops = { total_consecutive_repeats: 0, record_loop: null, top_looped: [] },
    phases = [],
    lyrics = { total_views: 0, display_types: [], languages: [], top_tracks: [] },
  } = data;

  const showEndReasons = (capabilities?.has_end_reasons ?? true) && end_reasons.length > 0;
  const showSkips = (capabilities?.has_skips ?? true) && (untouchables.length > 0 || most_skipped.length > 0);
  const showLyrics = (capabilities?.has_lyrics_events ?? true) && lyrics.total_views > 0;

  return (
    <Page
      title="Habitudes"
      kicker="Obsessions, boucles & discipline d'écoute"
      intro="Analyse des fenêtres d'obsession de quatorze jours, des répétitions consécutives en boucle et de la résistance de vos titres au zapping."
    >
      {/* Loops + Record Loop Lead */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <Section
          title="Écoutes en boucle"
          kicker={`${formatInt(loops.total_consecutive_repeats)} répétitions consécutives`}
          className="lg:col-span-7"
        >
          {loops.record_loop && (
            <div className="p-4 rounded-[4px] bg-bg-3 border border-line-2 mb-4 flex items-center gap-4">
              <Cover url={loops.record_loop.artwork_url} alt={loops.record_loop.song_name} size={60} />
              <div className="flex-1 min-w-0">
                <p className="kicker text-amber">Record absolu de boucle</p>
                <p className="font-display text-[20px] leading-snug text-ink truncate mt-0.5">
                  {loops.record_loop.song_name}
                </p>
                <p className="text-[12px] text-ink-2 truncate">
                  {loops.record_loop.artist_name} · {loops.record_loop.album_name}
                </p>
                <p className="text-[11.5px] text-ink-3 mt-1 num">
                  {loops.record_loop.max_consecutive}× d'affilée le {formatDateFr(loops.record_loop.peak_date)} (
                  {loops.record_loop.loop_repeats} boucles au total)
                </p>
              </div>
              <PlayButton
                size={34}
                onClick={() =>
                  playTrack({
                    song_name: loops.record_loop.song_name,
                    artist_name: loops.record_loop.artist_name,
                    album_name: loops.record_loop.album_name,
                    artwork_url: loops.record_loop.artwork_url,
                    track_key: loops.record_loop.track_key,
                    preview_url: loops.record_loop.preview_url,
                  })
                }
              />
            </div>
          )}

          {loops.top_looped?.length > 0 ? (
            <div className="divide-y divide-line">
              {loops.top_looped.slice(0, 8).map((item: any, idx: number) => (
                <div key={item.track_key || idx} className="py-2 flex items-center gap-3 row-hover px-1">
                  <span className="font-display text-[15px] text-ink-3 w-5 text-right num-sans">{idx + 1}</span>
                  <Cover url={item.artwork_url} alt={item.song_name} size={34} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">{item.song_name}</p>
                    <p className="text-[11px] text-ink-3 truncate">{item.artist_name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="num text-[12px] text-amber">{item.max_consecutive}× max</p>
                    <p className="num text-[11px] text-ink-3">{item.loop_repeats} rép.</p>
                  </div>
                  <PlayButton
                    onClick={() =>
                      playTrack({
                        song_name: item.song_name,
                        artist_name: item.artist_name,
                        album_name: item.album_name,
                        artwork_url: item.artwork_url,
                        track_key: item.track_key,
                        preview_url: item.preview_url,
                      })
                    }
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty>Aucune répétition immédiate détectée.</Empty>
          )}
        </Section>

        {/* Obsession phases (14-day windows with lift) */}
        <Section
          title={
            <>
              Phases d&apos;obsession
              <InfoTooltip
                label="Lift × (affinité)"
                text="Le Lift (ex. ×8) indique combien de fois plus tu as écouté cet artiste sur ces 14 jours par rapport à ta moyenne habituelle."
              />
            </>
          }
          kicker="Fenêtres glissantes de 14 jours"
          className="lg:col-span-5"
        >
          {phases.length === 0 ? (
            <Empty>Aucun pic d'obsession isolé sur 14 jours.</Empty>
          ) : (
            <div className="divide-y divide-line">
              {phases.slice(0, 8).map((p: any, i: number) => (
                <div key={`${p.artist_group_key}-${p.start_date}-${i}`} className="py-3 flex items-center gap-3.5">
                  <Cover url={p.artwork_url} alt={p.artist_name} size={42} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[13.5px] font-medium text-ink truncate">{p.artist_name}</p>
                      <span className="num text-[11.5px] text-amber shrink-0">×{p.lift} lift</span>
                    </div>
                    <p className="text-[11.5px] text-ink-3 mt-0.5">
                      {formatDateFr(p.start_date)} → {formatDateFr(p.end_date)}
                    </p>
                    <p className="text-[11px] text-ink-2 num mt-0.5">
                      {formatHours(p.total_ms)} ({p.plays} éc.) · {p.window_share_pct}% de la quinzaine (vs{" "}
                      {p.baseline_share_pct}% habituel)
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Untouchables vs Most Skipped */}
      {showSkips && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Section
            title="Les intouchables"
            kicker="Plus faible taux de skip (≥ 8 écoutes)"
          >
            {untouchables.length === 0 ? (
              <Empty>Aucun titre qualifié.</Empty>
            ) : (
              <div className="divide-y divide-line">
                {untouchables.slice(0, 10).map((t: any, i: number) => (
                  <div key={t.track_key || i} className="py-2 flex items-center gap-3 row-hover px-1">
                    <span className="font-display text-[15px] text-ink-3 w-5 text-right num-sans">{i + 1}</span>
                    <Cover url={t.artwork_url} alt={t.song_name} size={36} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{t.song_name}</p>
                      <p className="text-[11px] text-ink-3 truncate">{t.artist_name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="num text-[12px] text-moss">{t.avg_completion_pct}% complété</p>
                      <p className="num text-[11px] text-ink-3">
                        {t.skips_30s} skip / {t.raw_plays} éc.
                      </p>
                    </div>
                    <PlayButton
                      onClick={() =>
                        playTrack({
                          song_name: t.song_name,
                          artist_name: t.artist_name,
                          album_name: t.album_name,
                          artwork_url: t.artwork_url,
                          track_key: t.track_key,
                          preview_url: t.preview_url,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Souvent écourtés"
            kicker="Titres les plus zappés avant 30 secondes"
          >
            {most_skipped.length === 0 ? (
              <Empty>Aucun titre zappé récurrent.</Empty>
            ) : (
              <div className="divide-y divide-line">
                {most_skipped.slice(0, 10).map((t: any, i: number) => (
                  <div key={t.track_key || i} className="py-2 flex items-center gap-3 row-hover px-1">
                    <span className="font-display text-[15px] text-ink-3 w-5 text-right num-sans">{i + 1}</span>
                    <Cover url={t.artwork_url} alt={t.song_name} size={36} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{t.song_name}</p>
                      <p className="text-[11px] text-ink-3 truncate">{t.artist_name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="num text-[12px] text-ember">{t.skip_rate_pct}% skip</p>
                      <p className="num text-[11px] text-ink-3">
                        {t.skips_30s} / {t.raw_plays} écoutes
                      </p>
                    </div>
                    <PlayButton
                      onClick={() =>
                        playTrack({
                          song_name: t.song_name,
                          artist_name: t.artist_name,
                          album_name: t.album_name,
                          artwork_url: t.artwork_url,
                          track_key: t.track_key,
                          preview_url: t.preview_url,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      {/* End reasons + Lyrics block */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {showEndReasons && (
          <Section
            title={
              <>
                Causes de fin de piste
                <InfoTooltip
                  label="Télémétrie du lecteur"
                  text="Indique comment se terminent tes morceaux : NATURAL_END (écouté jusqu'au bout), SKIP / TRACK_CHANGED (passé manuellement), etc."
                />
              </>
            }
            kicker="Télémétrie du lecteur"
            className={showLyrics ? "lg:col-span-5" : "lg:col-span-12"}
          >
            <BarList
              items={end_reasons.map((e: any) => ({
                key: e.code || e.label,
                label: e.label || e.code,
                value: e.count,
                display: `${e.share_pct}% (${formatInt(e.count)})`,
                sub: formatHours(e.total_ms),
              }))}
              color="var(--color-brass)"
            />
          </Section>
        )}

        {showLyrics && (
          <Section
            title="Consultation des paroles"
            kicker={`${formatInt(lyrics.total_views)} ouvertures de livret`}
            className={showEndReasons ? "lg:col-span-7" : "lg:col-span-12"}
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4 pb-4 border-b border-line">
              <Stat label="Affichages" value={formatInt(lyrics.total_views)} accent />
              {lyrics.languages?.[0] && (
                <Stat
                  label="Langue principale"
                  value={String(lyrics.languages[0].lang).toUpperCase()}
                  sub={`${formatInt(lyrics.languages[0].count)} ouvertures`}
                />
              )}
              {lyrics.display_types?.[0] && (
                <Stat
                  label="Mode favori"
                  value={lyrics.display_types[0].type}
                  sub={`${formatInt(lyrics.display_types[0].count)} fois`}
                />
              )}
            </div>
            {lyrics.top_tracks?.length > 0 && (
              <div className="divide-y divide-line">
                {lyrics.top_tracks.slice(0, 6).map((lt: any, i: number) => (
                  <div key={lt.track_key || i} className="py-2 flex items-center gap-3 row-hover px-1">
                    <Cover url={lt.artwork_url} alt={lt.song_name} size={34} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{lt.song_name}</p>
                      <p className="text-[11px] text-ink-3 truncate">
                        {lt.artist_name} {lt.lang ? `· ${lt.lang}` : ""}
                      </p>
                    </div>
                    <span className="num text-[12px] text-ink-2 shrink-0">{formatInt(lt.lyric_views)} vues</span>
                    <PlayButton
                      onClick={() =>
                        playTrack({
                          song_name: lt.song_name,
                          artist_name: lt.artist_name,
                          album_name: lt.album_name,
                          artwork_url: lt.artwork_url,
                          track_key: lt.track_key,
                          preview_url: lt.preview_url,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}
      </div>
    </Page>
  );
};
