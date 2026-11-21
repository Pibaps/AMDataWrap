/**
 * ChronoPage ("chrono", "Rythmes") — Calendar heatmap, 7x24 circadian matrix, time slots, monthly trend & artist evolution.
 *
 * CRITICAL REACT RULE: All hooks (useMemo, useState, useEffect) MUST run unconditionally
 * before any early return, otherwise React throws Error #310 ("Rendered more hooks than during the previous render")
 * and crashes the entire site when switching to this tab.
 */

import React, { useMemo } from "react";
import { API, buildQueryParams, formatHours, formatInt } from "../../api/client";
import { CalendarHeatmap, DayHourMatrix, VerticalBarsSvg } from "../../components/charts";
import { BarList, Empty, ErrorNote, Loading, Page, Section, Stat } from "../../components/ui";
import { useApi, withQs } from "../../hooks/useApi";
import { useV4Store } from "../../store/useV4Store";

export const ChronoPage: React.FC = () => {
  const filters = useV4Store((s) => s.filters);
  const qs = useMemo(() => buildQueryParams(filters), [filters]);
  const { data, loading, error, reload } = useApi<any>(withQs(API.chrono, qs));

  const heatmap: any[] = data?.heatmap ?? [];
  const matrix: any[] = data?.matrix ?? [];
  const time_slots: any[] = data?.time_slots ?? [];
  const peak_hour: number = data?.peak_hour ?? 0;
  const monthly_trend: any[] = data?.monthly_trend ?? [];
  const evolution: { months: string[]; artists: any[] } = data?.evolution ?? { months: [], artists: [] };

  const bestMonth = useMemo(() => {
    if (!monthly_trend.length) return null;
    return [...monthly_trend].sort((a, b) => (b.total_ms || 0) - (a.total_ms || 0))[0];
  }, [monthly_trend]);

  const dominantSlot = useMemo(() => {
    if (!time_slots.length) return null;
    return [...time_slots].sort((a, b) => (b.share_pct || 0) - (a.share_pct || 0))[0];
  }, [time_slots]);

  if (loading && !data) {
    return (
      <Page title="Rythmes" kicker="Chronobiologie musicale">
        <Loading rows={6} />
      </Page>
    );
  }
  if (error && !data) {
    return (
      <Page title="Rythmes" kicker="Chronobiologie musicale">
        <ErrorNote message={error} onRetry={reload} />
      </Page>
    );
  }
  if (!data) {
    return (
      <Page title="Rythmes" kicker="Chronobiologie musicale">
        <Empty>Aucune donnée temporelle disponible.</Empty>
      </Page>
    );
  }

  return (
    <Page
      title="Rythmes"
      kicker="Chronobiologie & cycles d'écoute"
      intro="Répartition de tes écoutes jour par jour, cadences horaires sur la semaine et évolution mensuelle de tes artistes principaux."
    >
      {/* Top KPI summary */}
      <div className="panel p-5 sm:p-6 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-6">
        <Stat
          label="Heure de pointe"
          value={`${peak_hour}h00`}
          sub={`Créneau ${peak_hour}h–${(peak_hour + 1) % 24}h le plus dense`}
          accent
        />
        <Stat
          label="Moment privilégié"
          value={dominantSlot ? dominantSlot.label.split(" ")[0] : "—"}
          sub={dominantSlot ? `${dominantSlot.share_pct}% du volume (${dominantSlot.label})` : "—"}
        />
        <Stat
          label="Mois culminant"
          value={bestMonth ? bestMonth.month : "—"}
          sub={bestMonth ? `${formatHours(bestMonth.total_ms)} · ${formatInt(bestMonth.plays)} écoutes` : "—"}
        />
        <Stat
          label="Jours recensés"
          value={formatInt(heatmap.length)}
          sub={`${formatInt(monthly_trend.length)} mois couverts`}
        />
      </div>

      {/* Daily Calendar Heatmap */}
      <Section title="Calendrier d'activité quotidienne" kicker="Présence jour par jour" className="mb-6">
        <CalendarHeatmap days={heatmap} />
      </Section>

      {/* 7x24 Matrix + Time Slots */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <Section title="Cadran hebdomadaire (7 × 24 h)" kicker="Matrice circadienne" className="lg:col-span-8">
          <DayHourMatrix cells={matrix} />
        </Section>

        <Section title="Moments de la journée" kicker="Quatre fuseaux" className="lg:col-span-4">
          {time_slots.length === 0 ? (
            <Empty>Aucun créneau.</Empty>
          ) : (
            <BarList
              items={time_slots.map((s: any) => ({
                key: s.label,
                label: s.label,
                value: s.share_pct || s.value,
                display: `${s.share_pct}%`,
                sub: `${s.value} h cumulées`,
              }))}
            />
          )}
        </Section>
      </div>

      {/* Monthly volume bars */}
      {monthly_trend.length > 0 && (
        <Section title="Volume mensuel" kicker="Trajectoire au fil des mois" className="mb-6">
          <VerticalBarsSvg
            items={monthly_trend.map((m: any) => ({
              key: m.month,
              label: m.month,
              value: Math.round((m.total_ms || 0) / 3_600_000),
              tooltip: `${formatHours(m.total_ms)} · ${formatInt(m.plays)} écoutes · ${formatInt(
                m.unique_artists
              )} artistes`,
            }))}
            height={165}
          />
        </Section>
      )}

      {/* Small multiples: Top artists monthly evolution */}
      {evolution?.artists?.length > 0 && evolution?.months?.length > 1 && (
        <Section
          title="Évolution mensuelle des artistes dominants"
          kicker={`Petits multiples · ${evolution.months[0]} → ${evolution.months[evolution.months.length - 1]}`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            {evolution.artists.slice(0, 10).map((art: any) => {
              const vals: number[] = art.values || [];
              const maxV = Math.max(1, ...vals);
              const totalMin = Math.round(vals.reduce((a, b) => a + b, 0));
              return (
                <div key={art.key} className="py-2 border-b border-line flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink truncate">{art.name}</p>
                    <p className="text-[11px] text-ink-3 num">{formatInt(totalMin)} min sur la période</p>
                  </div>
                  <svg
                    viewBox={`0 0 ${Math.max(1, vals.length) * 10} 28`}
                    className="w-36 h-7 shrink-0"
                    role="img"
                    aria-label={`Évolution ${art.name}`}
                  >
                    {vals.map((v, i) => {
                      const h = Math.max(1.5, (v / maxV) * 24);
                      return (
                        <rect
                          key={i}
                          x={i * 10 + 1}
                          y={26 - h}
                          width={7}
                          height={h}
                          rx={1}
                          fill={v > 0 ? "#e8873e" : "#29211b"}
                          opacity={v > 0 ? 0.35 + 0.65 * (v / maxV) : 0.6}
                        >
                          <title>{`${evolution.months[i]} : ${Math.round(v)} min`}</title>
                        </rect>
                      );
                    })}
                  </svg>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </Page>
  );
};
