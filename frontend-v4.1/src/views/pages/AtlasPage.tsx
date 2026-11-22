/**
 * AtlasPage — Geographic Origins of Artists (MusicBrainz + Wikidata Seed).
 * Endpoint: GET /api/v3/analytics/atlas
 * Renders a self-contained SVG Equirectangular World Dot & Arc Map (zero external tile dependencies).
 */

import React, { useMemo, useState } from "react";
import { API, buildQueryParams, formatHoursNum, formatInt } from "../../api/client";
import { BarList, Cover, Empty, ErrorNote, Loading, Page, Section, Stat } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useV4Store } from "../../store/useV4Store";

function projectLngLat(lng: number, lat: number, w = 880, h = 420): [number, number] {
  const x = ((lng + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return [x, y];
}

export const AtlasPage: React.FC = () => {
  const filters = useV4Store((s) => s.filters);
  const qs = useMemo(() => buildQueryParams(filters), [filters]);
  const { data, loading, error, reload } = useApi<any>(`${API.atlas}${qs}`);
  const [selectedCountry, setSelectedCountry] = useState<string>("all");

  if (loading && !data) {
    return (
      <Page title="Atlas mondial" kicker="CARTOGRAPHIE MUSICBRAINZ & WIKIDATA">
        <Loading rows={8} />
      </Page>
    );
  }
  if (error && !data) {
    return (
      <Page title="Atlas mondial" kicker="CARTOGRAPHIE MUSICBRAINZ & WIKIDATA">
        <ErrorNote message={error} onRetry={reload} />
      </Page>
    );
  }
  if (!data) {
    return (
      <Page title="Atlas mondial" kicker="CARTOGRAPHIE MUSICBRAINZ & WIKIDATA">
        <Empty>Aucune donnée géographique disponible.</Empty>
      </Page>
    );
  }

  const nodes: any[] = data.nodes || [];
  const countries: any[] = data.countries || [];
  const home = data.home || { label: "France", lat: 48.8566, lng: 2.3522 };
  const [hx, hy] = projectLngLat(home.lng, home.lat);
  const maxPlays = Math.max(1, ...nodes.map((n) => Number(n.plays || 1)));

  const filteredNodes =
    selectedCountry === "all" ? nodes : nodes.filter((n) => n.country_iso === selectedCountry);

  return (
    <Page
      title="Atlas mondial des origines"
      kicker="PROVENANCE GÉOGRAPHIQUE DES ARTISTES"
      intro="Projection géographique des villes et pays d'origine de tes artistes les plus écoutés, résolus via MusicBrainz et Wikidata."
    >
      {/* Top KPIs */}
      <div className="panel p-6 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-6">
        <Stat label="Artistes géolocalisés" value={formatInt(data.mapped_count || nodes.length)} accent />
        <Stat label="Pays représentés" value={formatInt(countries.length)} />
        <Stat
          label="Pays #1"
          value={countries[0]?.country_name || "—"}
          sub={countries[0] ? `${formatInt(countries[0].plays)} écoutes · ${countries[0].artists} artistes` : undefined}
        />
        <Stat
          label="Ville d'ancrage #1"
          value={nodes[0]?.city || nodes[0]?.country_name || "—"}
          sub={nodes[0] ? `${nodes[0].artist_name} (${formatInt(nodes[0].plays)}×)` : undefined}
        />
      </div>

      {/* SVG World Map */}
      <Section
        className="mb-6"
        kicker="PROJECTION ÉQUIRECTANGULAIRE"
        title="Foyers musicaux & arcs d'écoute"
        aside={
          <div className="flex flex-wrap gap-1">
            <button
              className="chip"
              data-active={selectedCountry === "all"}
              onClick={() => setSelectedCountry("all")}
            >
              Monde ({nodes.length})
            </button>
            {countries.slice(0, 6).map((c) => (
              <button
                key={c.country_iso}
                className="chip"
                data-active={selectedCountry === c.country_iso}
                onClick={() => setSelectedCountry(c.country_iso)}
              >
                {c.country_iso} ({c.artists})
              </button>
            ))}
          </div>
        }
      >
        <div className="w-full overflow-x-auto">
          <svg viewBox="0 0 880 420" className="w-full h-auto bg-bg rounded border border-line">
            {/* Latitude & Longitude Graticule */}
            {[-120, -60, 0, 60, 120].map((lng) => {
              const [x] = projectLngLat(lng, 0);
              return (
                <line
                  key={`lng-${lng}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={420}
                  stroke="var(--color-line)"
                  strokeDasharray="2 4"
                />
              );
            })}
            {[-60, -30, 0, 30, 60].map((lat) => {
              const [, y] = projectLngLat(0, lat);
              return (
                <line
                  key={`lat-${lat}`}
                  x1={0}
                  y1={y}
                  x2={880}
                  y2={y}
                  stroke="var(--color-line)"
                  strokeDasharray="2 4"
                />
              );
            })}

            {/* Curved arcs from Artist origin to Home listener */}
            {filteredNodes.slice(0, 36).map((n) => {
              const [nx, ny] = projectLngLat(Number(n.lng || 0), Number(n.lat || 0));
              const cx = (nx + hx) / 2;
              const cy = Math.min(ny, hy) - Math.hypot(nx - hx, ny - hy) * 0.18;
              return (
                <path
                  key={`arc-${n.artist_key}`}
                  d={`M${nx.toFixed(1)},${ny.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${hx.toFixed(
                    1
                  )},${hy.toFixed(1)}`}
                  fill="none"
                  stroke="rgba(232, 135, 62, 0.22)"
                  strokeWidth={1.1}
                />
              );
            })}

            {/* Home marker */}
            <circle cx={hx} cy={hy} r={4.5} fill="var(--color-ink)" />
            <circle cx={hx} cy={hy} r={9} fill="none" stroke="var(--color-ink)" strokeOpacity={0.35} />

            {/* Artist origin markers */}
            {filteredNodes.map((n, idx) => {
              const [nx, ny] = projectLngLat(Number(n.lng || 0), Number(n.lat || 0));
              const r = 3.2 + Math.sqrt(Number(n.plays || 1) / maxPlays) * 9.5;
              return (
                <g key={n.artist_key}>
                  <circle
                    cx={nx}
                    cy={ny}
                    r={r}
                    fill="rgba(232, 135, 62, 0.72)"
                    stroke="#1a0f07"
                    strokeWidth={1}
                  >
                    <title>
                      {n.artist_name} — {n.city ? `${n.city}, ` : ""}
                      {n.country_name} ({n.plays} écoutes)
                    </title>
                  </circle>
                  {idx < 12 && (
                    <text
                      x={nx + r + 4}
                      y={ny + 3}
                      className="fill-ink text-[10px] font-medium"
                    >
                      {n.artist_name}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </Section>

      {/* Countries BarList + Detailed Geotagged Artists Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Section className="lg:col-span-5" kicker="PAR NATION" title="Pays les plus écoutés">
          {countries.length > 0 ? (
            <BarList
              items={countries.map((c: any) => ({
                key: c.country_iso,
                label: (
                  <span>
                    <span className="num text-ink-3 mr-2">{c.country_iso}</span>
                    <strong className="font-medium text-ink">{c.country_name}</strong>
                  </span>
                ),
                value: Number(c.plays || 0),
                display: `${formatInt(c.plays)} écoutes · ${formatHoursNum(c.hours)}`,
                sub: `${c.artists} artistes`,
              }))}
            />
          ) : (
            <Empty>Aucun pays.</Empty>
          )}
        </Section>

        <Section
          className="lg:col-span-7"
          kicker="VILLES & SCÈNES LOCALES"
          title="Artistes localisés"
        >
          <div className="divide-y divide-line max-h-[420px] overflow-y-auto pr-1">
            {filteredNodes.map((n: any) => (
              <div key={n.artist_key} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <Cover url={n.artwork_url} alt={n.artist_name} size={34} />
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate">{n.artist_name}</p>
                    <p className="text-ink-3 truncate">
                      {n.city ? `${n.city}, ` : ""}
                      {n.country_name} · {n.genre}
                    </p>
                  </div>
                </div>
                <div className="text-right num shrink-0">
                  <p className="text-ink">{formatInt(n.plays)}×</p>
                  <p className="text-ink-3 text-[11px]">{formatHoursNum(n.hours)}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </Page>
  );
};
