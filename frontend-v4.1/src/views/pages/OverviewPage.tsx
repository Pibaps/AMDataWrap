/**
 * OverviewPage ("overview", "Synthèse") — Editorial synthesis of listening history.
 */

import React, { useMemo } from "react";
import { API, apiGet, buildQueryParams, formatDateFr, formatHours, formatInt, formatMinutes, getActiveTimeUnit, type VinylDetail } from "../../api/client";
import type { OverviewData } from "../../api/types";
import { playTrack } from "../../audio/playTrack";
import { BarList, Cover, Empty, ErrorNote, Loading, Page, PlayButton, Section, Stat } from "../../components/ui";
import { useApi, withQs } from "../../hooks/useApi";
import { useV4Store } from "../../store/useV4Store";

export const OverviewPage: React.FC = () => {
  const filters = useV4Store((s) => s.filters);
  const setActiveTab = useV4Store((s) => s.setActiveTab);
  const qs = useMemo(() => buildQueryParams(filters), [filters]);
  const { data, loading, error, reload } = useApi<OverviewData>(withQs(API.overview, qs));

  if (loading && !data) {
    return (
      <Page title="Synthèse" kicker="Vue d'ensemble">
        <Loading rows={6} />
      </Page>
    );
  }
  if (error && !data) {
    return (
      <Page title="Synthèse" kicker="Vue d'ensemble">
        <ErrorNote message={error} onRetry={reload} />
      </Page>
    );
  }
  if (!data || !data.kpis) {
    return (
      <Page title="Synthèse" kicker="Vue d'ensemble">
        <Empty>Aucune écoute enregistrée pour ces filtres.</Empty>
      </Page>
    );
  }

  const { kpis, records, top_artists = [], top_tracks = [], top_albums = [], top_genres = [], breakdowns = {} } = data;
  const periodText =
    kpis.min_date && kpis.max_date
      ? `Du ${formatDateFr(kpis.min_date)} au ${formatDateFr(kpis.max_date)}`
      : "Historique complet";

  return (
    <Page
      title="Synthèse"
      kicker={`Cahier d'écoute · ${periodText}`}
      intro="Bilan consolidé de votre bibliothèque, de vos records d'écoute et des œuvres qui dominent la période sélectionnée."
    >
      {/* Primary KPI ledger strip */}
      <div className="panel p-5 sm:p-6 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6">
          <Stat
            label="Temps cumulé"
            value={formatHours(kpis.total_ms || (kpis.total_hours || 0) * 3_600_000)}
            sub={
              getActiveTimeUnit() === "minutes"
                ? `${formatInt(kpis.total_hours)} h · ${kpis.total_days} jours`
                : `${formatMinutes(kpis.total_ms || (kpis.total_hours || 0) * 3_600_000)} · ${kpis.total_days} jours`
            }
            accent
          />
          <Stat
            label="Écoutes"
            value={formatInt(kpis.plays)}
            sub={`Moy. ${formatHours(kpis.daily_avg_ms)} / jour actif`}
          />
          <Stat
            label="Artistes"
            value={formatInt(kpis.unique_artists)}
            sub={`${formatInt(kpis.unique_albums)} albums`}
          />
          <Stat
            label="Titres uniques"
            value={formatInt(kpis.unique_tracks)}
            sub={`${formatInt(kpis.total_sessions)} sessions`}
          />
          <Stat
            label="Complétion"
            value={`${kpis.avg_completion_pct}%`}
            sub={`Skip <30s : ${kpis.skip_rate_30s_pct}%`}
          />
          <Stat
            label="Jours actifs"
            value={formatInt(kpis.active_days)}
            sub={`${formatInt(kpis.offline_plays)} hors-ligne`}
          />
        </div>
      </div>

      {/* Records strip: Streak / Record Day / Longest Session */}
      {records && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="panel p-5">
            <p className="kicker">Plus longue série</p>
            <p className="font-display text-[28px] leading-tight mt-1.5 num-sans">
              {formatInt(records.longest_streak?.days || 0)} jours consécutifs
            </p>
            <p className="text-[12px] text-ink-3 mt-1">
              {records.longest_streak?.start
                ? `${formatDateFr(records.longest_streak.start)} → ${formatDateFr(records.longest_streak.end)}`
                : "—"}
            </p>
          </div>

          <div className="panel p-5">
            <p className="kicker">Journée record</p>
            <p className="font-display text-[28px] leading-tight mt-1.5 num-sans text-amber">
              {records.record_day ? formatHours(records.record_day.total_ms) : "—"}
            </p>
            <p className="text-[12px] text-ink-3 mt-1">
              {records.record_day
                ? `${formatDateFr(records.record_day.date)} · ${formatInt(records.record_day.plays)} écoutes${
                    records.record_day.top_artist ? ` (${records.record_day.top_artist})` : ""
                  }`
                : "—"}
            </p>
          </div>

          <div className="panel p-5">
            <p className="kicker">Plus longue session</p>
            <p className="font-display text-[28px] leading-tight mt-1.5 num-sans">
              {records.longest_session ? formatHours(records.longest_session.total_ms) : "—"}
            </p>
            <p className="text-[12px] text-ink-3 mt-1">
              {records.longest_session
                ? `${formatDateFr(records.longest_session.start_local?.slice(0, 10))} · ${formatInt(
                    records.longest_session.plays
                  )} titres d'affilée`
                : "—"}
            </p>
          </div>
        </div>
      )}

      {/* Asymmetric 7 / 5 editorial split: Top Artists & Tracks on left, Albums & Genres on right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <div className="lg:col-span-7 space-y-6">
          <Section
            title="Artistes dominants"
            kicker="Palmarès · Top 5"
            aside={
              <button className="btn" onClick={() => setActiveTab("tops")}>
                Tout voir
              </button>
            }
          >
            {top_artists.length === 0 ? (
              <Empty>Aucun artiste.</Empty>
            ) : (
              <div className="divide-y divide-line">
                {top_artists.map((a: any, i: number) => (
                  <div key={a.artist_group_key || i} className="py-2.5 flex items-center gap-3.5 row-hover px-1">
                    <span className="font-display text-[18px] text-ink-3 w-6 text-right num-sans">
                      {a.rank ?? i + 1}
                    </span>
                    <Cover url={a.artwork_url} alt={a.artist_name} size={42} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-ink truncate">{a.artist_name}</p>
                      <p className="text-[11.5px] text-ink-3 truncate">
                        {a.primary_genre || "Genre non classé"} · {formatInt(a.unique_tracks)} titres ·{" "}
                        {formatInt(a.unique_albums)} albums
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="num text-[13px] text-ink">{formatHours(a.total_ms)}</p>
                      <p className="num text-[11px] text-ink-3">{formatInt(a.plays)} écoutes</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Titres les plus joués"
            kicker="Pistes · Top 5"
            aside={
              <button className="btn" onClick={() => setActiveTab("tops")}>
                Classement complet
              </button>
            }
          >
            {top_tracks.length === 0 ? (
              <Empty>Aucun titre.</Empty>
            ) : (
              <div className="divide-y divide-line">
                {top_tracks.map((t: any, i: number) => (
                  <div key={t.track_key || i} className="py-2.5 flex items-center gap-3.5 row-hover px-1">
                    <span className="font-display text-[18px] text-ink-3 w-6 text-right num-sans">
                      {t.rank ?? i + 1}
                    </span>
                    <Cover url={t.artwork_url} alt={t.song_name} size={42} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-ink truncate">{t.song_name}</p>
                      <p className="text-[11.5px] text-ink-3 truncate">
                        {t.artist_name} · <span className="text-ink-2">{t.album_name}</span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="num text-[13px] text-ink">{formatHours(t.total_ms)}</p>
                      <p className="num text-[11px] text-ink-3">{formatInt(t.plays)} écoutes</p>
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
                          duration_ms: t.duration_ms,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="lg:col-span-5 space-y-6">
          <Section title="Disques de chevet" kicker="Albums · Top 5">
            {top_albums.length === 0 ? (
              <Empty>Aucun album.</Empty>
            ) : (
              <div className="divide-y divide-line">
                {top_albums.map((al: any, i: number) => (
                  <div key={al.album_group_key || i} className="py-2.5 flex items-center gap-3.5 row-hover px-1">
                    <span className="font-display text-[17px] text-ink-3 w-5 text-right num-sans">
                      {al.rank ?? i + 1}
                    </span>
                    <Cover url={al.artwork_url} alt={al.album_name} size={44} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-medium text-ink truncate">{al.album_name}</p>
                      <p className="text-[11.5px] text-ink-3 truncate">
                        {al.artist_name}
                        {al.release_year ? ` · ${al.release_year}` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="num text-[12.5px] text-ink">{formatHours(al.total_ms)}</p>
                      <p className="num text-[11px] text-ink-3">{formatInt(al.plays)} éc.</p>
                    </div>
                    <PlayButton
                      title={`Écouter l'album ${al.album_name}`}
                      onClick={async () => {
                        try {
                          if (al.album_group_key) {
                            const detail = await apiGet<VinylDetail>(`${API.vinyl(al.album_group_key)}${qs}`);
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
                          /* fallback below */
                        }
                        playTrack({
                          song_name: al.album_name,
                          artist_name: al.artist_name || "",
                          album_name: al.album_name,
                          artwork_url: al.artwork_url,
                        });
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Couleur musicale" kicker="Genres principaux">
            {top_genres.length === 0 ? (
              <Empty>Aucun genre renseigné.</Empty>
            ) : (
              <BarList
                items={top_genres.map((g: any) => ({
                  key: g.genre,
                  label: g.genre,
                  value: g.total_ms,
                  display: `${formatHours(g.total_ms)} · ${g.share_pct}%`,
                  sub: `${formatInt(g.unique_artists)} artistes · ${formatInt(g.unique_tracks)} titres`,
                }))}
              />
            )}
          </Section>
        </div>
      </div>

      {/* Technical & Context Breakdowns */}
      {((breakdowns.devices?.length ?? 0) > 0 || (breakdowns.containers?.length ?? 0) > 0 || (breakdowns.audio_quality?.length ?? 0) > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(breakdowns.devices?.length ?? 0) > 0 && (
            <Section title="Appareils d'écoute" kicker="Matériel">
              <BarList
                items={(breakdowns.devices ?? []).slice(0, 6).map((d, i) => ({
                  key: d.label || `dev-${i}`,
                  label: d.label || "Non spécifié",
                  value: d.total_ms || d.plays,
                  display: formatHours(d.total_ms),
                }))}
                color="var(--color-brass)"
              />
            </Section>
          )}
          {(breakdowns.containers?.length ?? 0) > 0 && (
            <Section title="Contextes de lecture" kicker="Conteneurs">
              <BarList
                items={(breakdowns.containers ?? []).slice(0, 6).map((c, i) => ({
                  key: c.label || `cont-${i}`,
                  label: c.label || "Direct / Bibliothèque",
                  value: c.total_ms || c.plays,
                  display: `${formatHours(c.total_ms)} (${formatInt(c.plays)})`,
                }))}
                color="var(--color-amber-soft)"
              />
            </Section>
          )}
          {(breakdowns.audio_quality?.length ?? 0) > 0 && (
            <Section title="Flux & qualité audio" kicker="Débit">
              <BarList
                items={(breakdowns.audio_quality ?? []).slice(0, 6).map((q, i) => ({
                  key: q.label || `q-${i}`,
                  label: q.label,
                  value: q.total_ms || q.plays,
                  display: formatHours(q.total_ms),
                }))}
                color="var(--color-moss)"
              />
            </Section>
          )}
        </div>
      )}
    </Page>
  );
};
