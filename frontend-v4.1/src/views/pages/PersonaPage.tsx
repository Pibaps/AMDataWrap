/**
 * PersonaPage ("persona", "Portrait") — Archetype title/tagline/description, 6-axis SVG radar, listening age & release year histogram.
 */

import React, { useMemo } from "react";
import { API, buildQueryParams, formatHours, formatInt } from "../../api/client";
import type { PersonaData } from "../../api/types";
import { RadarChart, VerticalBarsSvg } from "../../components/charts";
import { BarList, Empty, ErrorNote, InfoTooltip, Loading, Page, Section, Stat } from "../../components/ui";
import { useApi, withQs } from "../../hooks/useApi";
import { useV4Store } from "../../store/useV4Store";

export const PersonaPage: React.FC = () => {
  const filters = useV4Store((s) => s.filters);
  const qs = useMemo(() => buildQueryParams(filters), [filters]);
  const { data, loading, error, reload } = useApi<PersonaData>(withQs(API.persona, qs));

  if (loading && !data) {
    return (
      <Page title="Portrait" kicker="Profil d'écoute & générations">
        <Loading rows={6} />
      </Page>
    );
  }
  if (error && !data) {
    return (
      <Page title="Portrait" kicker="Profil d'écoute & générations">
        <ErrorNote message={error} onRetry={reload} />
      </Page>
    );
  }
  if (!data || !data.persona) {
    return (
      <Page title="Portrait" kicker="Profil d'écoute & générations">
        <Empty>Données insuffisantes pour dresser le portrait.</Empty>
      </Page>
    );
  }

  const { persona, listening_age } = data;
  const radialScores = persona.radial_scores ?? [];
  const eras = listening_age?.eras ?? [];
  const decades = listening_age?.decades ?? [];
  const years = listening_age?.years ?? [];

  return (
    <Page
      title="Portrait"
      kicker="Archétype comportemental & âge musical"
      intro="Analyse croisée de la fidélité, de l'entropie, de l'endurance et de la distribution chronologique des œuvres que vous écoutez."
    >
      {/* Editorial Persona Lead + Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <div className="lg:col-span-7 panel p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <p className="kicker mb-2">Figure dominante</p>
            <h2 className="font-display text-[32px] sm:text-[40px] leading-[1.08] font-[450] text-ink">
              {persona.title}
            </h2>
            <p className="font-display italic text-[17px] text-amber mt-2">{persona.tagline}</p>
            <div className="rule my-5" />
            <p className="text-[14px] leading-relaxed text-ink-2">{persona.description}</p>
          </div>

          {/* Six radial axes detail breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6 pt-5 border-t border-line">
            {radialScores.map((s: any) => (
              <div key={s.axis} className="p-3 rounded-[4px] bg-bg-3 border border-line">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12.5px] font-medium text-ink">{s.axis}</span>
                  <span className="num text-[12px] text-amber">{s.score} / 100</span>
                </div>
                <div className="mt-1.5 h-[3px] bg-bg-4 rounded-full overflow-hidden">
                  <div className="h-full bg-amber" style={{ width: `${s.score}%` }} />
                </div>
                <p className="text-[11px] text-ink-3 mt-1.5">{s.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <Section
          title={
            <>
              Signature sur six axes
              <InfoTooltip
                label="Indices de découverte et fidélité"
                text="Synthèse sur 100 de tes 6 dimensions clés : fidélité aux favoris, exploration de nouveautés, endurance, régularité, diversité et profondeur."
              />
            </>
          }
          kicker="Équilibre d'écoute"
          className="lg:col-span-5 flex flex-col justify-center"
        >
          <RadarChart scores={radialScores} />
        </Section>
      </div>

      {/* Listening Age + Eras + Decades */}
      {listening_age && (
        <>
          <div className="panel p-5 sm:p-6 mb-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <Stat
                label={
                  <>
                    Âge musical estimé
                    <InfoTooltip
                      label="Âge de cristallisation"
                      text="En psychologie musicale, nos goûts se cristallisent autour de 19 ans. Cet indicateur estime l'âge correspondant à l'année médiane de sortie de tes titres."
                    />
                  </>
                }
                value={listening_age.age ? `${listening_age.age} ans` : "—"}
                sub="Ancré sur l'âge de cristallisation (~19 ans)"
                accent
              />
              <Stat
                label="Année médiane"
                value={listening_age.weighted_median_year ?? "—"}
                sub={`Moyenne pondérée : ${listening_age.weighted_mean_year ?? "—"}`}
              />
              <Stat
                label="Décennie de cœur"
                value={listening_age.heart_decade ?? "—"}
                sub="Plus fort volume horaire"
              />
              <Stat
                label="Couverture datée"
                value={`${listening_age.dated_coverage_pct ?? 0}%`}
                sub={`${formatInt(listening_age.dated_plays)} écoutes millésimées`}
              />
            </div>
            {listening_age.formula_explanation && (
              <p className="text-[12px] text-ink-3 mt-4 pt-4 border-t border-line">
                {listening_age.formula_explanation}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
            <Section title="Grandes époques" kicker="Quatre strates temporelles" className="lg:col-span-5">
              {eras.length === 0 ? (
                <Empty>Aucune époque.</Empty>
              ) : (
                <BarList
                  items={eras.map((e: any) => ({
                    key: e.label,
                    label: e.label,
                    value: e.total_ms,
                    display: `${e.share_pct}% · ${formatHours(e.total_ms)}`,
                  }))}
                />
              )}
            </Section>

            <Section title="Répartition par décennie" kicker="Des origines à aujourd'hui" className="lg:col-span-7">
              {decades.length === 0 ? (
                <Empty>Aucune décennie.</Empty>
              ) : (
                <BarList
                  items={decades.map((d: any) => ({
                    key: String(d.decade),
                    label: d.label,
                    value: d.total_ms,
                    display: `${d.share_pct}% · ${formatHours(d.total_ms)}`,
                    sub: `${formatInt(d.plays)} écoutes`,
                  }))}
                  color="var(--color-brass)"
                />
              )}
            </Section>
          </div>

          {years.length > 0 && (
            <Section
              title="Millésimes de sortie"
              kicker={`Distribution annuelle (${years[0].year} → ${years[years.length - 1].year})`}
            >
              <VerticalBarsSvg
                items={years.map((y: any) => ({
                  key: String(y.year),
                  label: String(y.year),
                  value: Math.round((y.total_ms || 0) / 60_000),
                  tooltip: `${formatHours(y.total_ms)} · ${formatInt(y.plays)} écoutes`,
                }))}
                height={165}
              />
            </Section>
          )}
        </>
      )}
    </Page>
  );
};
