/**
 * SciencePage — Musicology & Information Theory (Eddington, Gini/Lorenz, Shannon Entropy,
 * Artist Survival Archetypes, Sequential Session Bridges &PELT Eras).
 * Endpoint: GET /api/v3/analytics/science (+ optional /api/v3/analytics/eras & /api/v3/analytics/camelot).
 */

import React, { useMemo } from "react";
import { API, buildQueryParams, formatInt } from "../../api/client";
import { BarList, Cover, Empty, ErrorNote, InfoTooltip, Loading, Page, Section, Stat } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useV4Store } from "../../store/useV4Store";

export const SciencePage: React.FC = () => {
  const filters = useV4Store((s) => s.filters);
  const qs = useMemo(() => buildQueryParams(filters), [filters]);

  const { data, loading, error, reload } = useApi<any>(`${API.science}${qs}`);
  const { data: erasData } = useApi<any>(`${API.eras}${qs}`);
  const { data: camelotData } = useApi<any>(`${API.camelot}${qs}`);

  if (loading && !data) {
    return (
      <Page title="Science musicale" kicker="THÉORIE DE L'INFORMATION & SURVIE">
        <Loading rows={8} />
      </Page>
    );
  }
  if (error && !data) {
    return (
      <Page title="Science musicale" kicker="THÉORIE DE L'INFORMATION & SURVIE">
        <ErrorNote message={error} onRetry={reload} />
      </Page>
    );
  }
  if (!data) {
    return (
      <Page title="Science musicale" kicker="THÉORIE DE L'INFORMATION & SURVIE">
        <Empty>Aucune donnée scientifique disponible.</Empty>
      </Page>
    );
  }

  const edd = data.eddington || {};
  const giniA = data.gini_artists || {};
  const giniT = data.gini_tracks || {};
  const ent = data.shannon_entropy || {};
  const surv = data.survival || {};
  const lorenzPts: Array<{ p: number; l: number }> = giniA.lorenz || [];

  const lorenzPath =
    lorenzPts.length > 1
      ? lorenzPts
          .map((pt, idx) => {
            const x = 24 + pt.p * 232;
            const y = 216 - pt.l * 192;
            return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ")
      : "";

  const survCurve: Array<{ month_age: number; retention_pct: number }> = surv.curve || [];
  const erasList: any[] = erasData?.eras || [];
  const camelotWheel: any[] = camelotData?.wheel || [];

  return (
    <Page
      title="Science musicale"
      kicker="EDDINGTON · GINI · ENTROPIE DE SHANNON · COURBES DE SURVIE"
      intro="Mesure mathématique de la concentration de tes écoutes, de ta diversité informationnelle par appareil et de la longévité de tes artistes."
    >
      {/* Top KPI Row */}
      <div className="panel p-6 mb-6 grid grid-cols-2 lg:grid-cols-4 gap-6">
        <Stat
          label={
            <>
              Nombre d&apos;Eddington (E)
              <InfoTooltip
                label="Nombre d'Eddington"
                text="Plus grand nombre E tel que tu as écouté au moins E titres pendant au moins E jours différents. Mesure ton endurance d'écoute."
              />
            </>
          }
          value={edd.eddington ?? 0}
          accent
          sub={
            edd.next_target
              ? `${edd.days_needed_for_next ?? 1} j de plus à ≥ ${edd.next_target} écoutes pour E=${edd.next_target}`
              : "Seuil d'endurance quotidienne"
          }
        />
        <Stat
          label={
            <>
              Noyau effectif d&apos;artistes
              <InfoTooltip
                label="Indice de Gini"
                text="L'indice de Gini (0 à 100 %) mesure si tes écoutes sont concentrées sur quelques artistes favoris (proche de 100 %) ou très réparties."
              />
            </>
          }
          value={formatInt(giniA.effective_core)}
          sub={`Gini artistes ${(Number(giniA.gini || 0) * 100).toFixed(1)} % sur ${formatInt(giniA.k)} artistes`}
        />
        <Stat
          label={
            <>
              Entropie de Shannon
              <InfoTooltip
                label="Entropie de Shannon"
                text="Diversité de tes écoutes mesurée en bits. La perplexité traduit cette entropie en nombre d'artistes équivalents écoutés à parts égales."
              />
            </>
          }
          value={`${Number(ent.bits || 0).toFixed(2)} bits`}
          sub={`Perplexité équivalente : ${Math.round(ent.perplexity || 0)} artistes équiprobables`}
        />
        <Stat
          label="Noyau effectif de titres"
          value={formatInt(giniT.effective_core)}
          sub={`Gini titres ${(Number(giniT.gini || 0) * 100).toFixed(1)} % sur ${formatInt(giniT.k)} titres`}
        />
      </div>

      {/* Lorenz Curve + Entropy by Device */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <Section
          className="lg:col-span-5"
          kicker="CONCENTRATION DES GOÛTS"
          title={
            <>
              Courbe de Lorenz (Artistes)
              <InfoTooltip
                label="Courbe de Lorenz"
                text="Compare la part cumulée de tes artistes à la part cumulée de tes écoutes. Plus la courbe creuse sous la diagonale, plus tes favoris dominent."
              />
            </>
          }
          aside={<span className="num text-xs text-ink-2">G = {Number(giniA.gini || 0).toFixed(3)}</span>}
        >
          {lorenzPath ? (
            <div className="flex flex-col items-center">
              <svg viewBox="0 0 280 240" className="w-full max-w-[320px] h-auto">
                {/* Frame */}
                <rect x={24} y={24} width={232} height={192} fill="none" stroke="var(--color-line-2)" strokeWidth={1} />
                {/* Equality diagonal */}
                <line
                  x1={24}
                  y1={216}
                  x2={256}
                  y2={24}
                  stroke="var(--color-ink-3)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                {/* Shaded Gini area */}
                <path
                  d={`${lorenzPath} L256,24 L24,216 Z`}
                  fill="rgba(232, 135, 62, 0.14)"
                />
                {/* Actual Lorenz curve */}
                <path d={lorenzPath} fill="none" stroke="var(--color-amber)" strokeWidth={2.2} />
                <text x={24} y={232} className="fill-ink-3 text-[9px] num">
                  0 % artistes
                </text>
                <text x={256} y={232} textAnchor="end" className="fill-ink-3 text-[9px] num">
                  100 % artistes
                </text>
                <text x={20} y={32} textAnchor="end" className="fill-ink-3 text-[9px] num">
                  100 %
                </text>
              </svg>
              <p className="text-xs text-ink-3 mt-2 text-center">
                Plus la courbe s&apos;éloigne de la diagonale, plus ton temps d&apos;écoute est concentré sur un noyau
                restreint de favoris.
              </p>
            </div>
          ) : (
            <Empty>Courbe de Lorenz indisponible.</Empty>
          )}
        </Section>

        <Section
          className="lg:col-span-7"
          kicker="EXPLORATION VS ROUTINE"
          title="Entropie de Shannon par appareil"
        >
          {(data.entropy_by_device || []).length > 0 ? (
            <BarList
              max={1}
              items={(data.entropy_by_device || []).map((d: any) => ({
                key: d.device,
                label: (
                  <span>
                    <strong className="font-medium text-ink">{d.device}</strong>{" "}
                    <span className="text-xs text-ink-3">· {d.style}</span>
                  </span>
                ),
                value: Number(d.entropy_norm || 0),
                display: `${Number(d.entropy_bits || 0).toFixed(2)} bits (${Math.round(
                  Number(d.entropy_norm || 0) * 100
                )} %)`,
                sub: `${formatInt(d.unique_artists)} artistes uniques · ${Number(d.hours || 0).toFixed(1)} h`,
              }))}
            />
          ) : (
            <Empty>Aucun détail par appareil.</Empty>
          )}
        </Section>
      </div>

      {/* Survival Archetypes & Retention Curve */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <Section
          className="lg:col-span-5"
          kicker="LONGÉVITÉ & DEMI-VIE"
          title={
            <>
              Courbe de rétention des artistes
              <InfoTooltip
                label="Demi-vie d'écoute"
                text="Nombre de jours nécessaires pour atteindre la moitié de tes écoutes totales d'un artiste. Plus elle est longue, plus l'artiste traverse le temps."
              />
            </>
          }
        >
          {surv.counts && (
            <div className="grid grid-cols-2 gap-2.5 mb-4">
              {Object.entries(surv.counts).map(([k, v]) => (
                <div key={k} className="p-3 rounded bg-bg-3 border border-line">
                  <p className="kicker">{k}</p>
                  <p className="font-display text-2xl mt-1 num-sans">{String(v)}</p>
                </div>
              ))}
            </div>
          )}

          {survCurve.length > 0 && (
            <div className="space-y-1.5">
              <p className="kicker mb-2">RÉTENTION MOIS APRÈS DÉCOUVERTE</p>
              {survCurve.slice(0, 8).map((c) => (
                <div key={c.month_age} className="flex items-center gap-3 text-xs">
                  <span className="num text-ink-3 w-12">M+{c.month_age}</span>
                  <div className="flex-1 h-2 bg-bg-4 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brass rounded-full"
                      style={{ width: `${Math.min(100, Math.max(2, c.retention_pct))}%` }}
                    />
                  </div>
                  <span className="num text-ink-2 w-12 text-right">{Number(c.retention_pct).toFixed(1)} %</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          className="lg:col-span-7"
          kicker="CLASSIFICATION DE SURVIE"
          title="Classiques, Comètes & Résurrections"
        >
          <div className="divide-y divide-line max-h-[360px] overflow-y-auto pr-1">
            {(surv.artists || []).slice(0, 20).map((a: any) => (
              <div key={a.artist_key} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <Cover url={a.artwork_url} alt={a.artist_name} size={34} />
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate">{a.artist_name}</p>
                    <p className="text-ink-3 num">
                      Demi-vie : {a.half_life_days} j · Actif sur {a.active_months} mois (pic {a.peak_month})
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-bg-3 border border-line-2 num text-[11px] text-amber shrink-0">
                  {a.archetype}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Bridge Artists & Sequential Transitions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <Section
          className="lg:col-span-6"
          kicker="GRAPHE DE SESSIONS"
          title="Artistes-passerelles entre genres"
        >
          {(data.bridge_artists || []).length > 0 ? (
            <div className="divide-y divide-line">
              {(data.bridge_artists || []).slice(0, 10).map((b: any, i: number) => (
                <div key={b.artist_key} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate">
                      <span className="num text-ink-3 mr-2">{String(i + 1).padStart(2, "0")}</span>
                      {b.artist_name}
                      <span className="text-ink-3 ml-2">({b.primary_genre})</span>
                    </p>
                    <p className="text-[11px] text-ink-3 truncate mt-0.5">
                      Relie : {(b.connected_genres || []).join(" · ")}
                    </p>
                  </div>
                  <span className="num text-amber shrink-0">{b.cross_transitions} transitions</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Aucune passerelle inter-genres détectée.</Empty>
          )}
        </Section>

        <Section
          className="lg:col-span-6"
          kicker="MARKOV SÉQUENTIEL (A → B)"
          title={
            <>
              Enchaînements d&apos;artistes les plus fréquents
              <InfoTooltip
                label="Transitions de Markov"
                text="Paires d'artistes que tu enchaînes le plus souvent l'un après l'autre au cours d'une même session d'écoute."
              />
            </>
          }
        >
          {(data.top_transitions || []).length > 0 ? (
            <div className="divide-y divide-line">
              {(data.top_transitions || []).slice(0, 10).map((t: any, i: number) => (
                <div key={i} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate">
                    <strong className="text-ink">{t.from_name}</strong>
                    <span className="text-amber mx-2">→</span>
                    <strong className="text-ink">{t.to_name}</strong>
                  </span>
                  <span className="num text-ink-2 shrink-0">{t.count}× en session</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Aucune transition séquentielle enregistrée.</Empty>
          )}
        </Section>
      </div>

      {/* Optional PELT Musical Eras & Camelot Wheel */}
      {(erasList.length > 0 || camelotWheel.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {erasList.length > 0 && (
            <Section
              className="lg:col-span-7"
              kicker="DÉTECTION DE RUPTURES (PELT)"
              title={
                <>
                  Chapitres &amp; Ères esthétiques
                  <InfoTooltip
                    label="Détection de rupture PELT"
                    text="Algorithme statistique qui repère automatiquement les dates où tes habitudes d'écoute (genres et artistes dominants) ont nettement basculé."
                  />
                </>
              }
            >
              <div className="divide-y divide-line">
                {erasList.slice(0, 8).map((era: any, i: number) => (
                  <div key={i} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <p className="font-medium text-ink">{era.label || era.title || `Chapitre #${i + 1}`}</p>
                      <p className="text-ink-3 mt-0.5">
                        {(era.top_artists || []).slice(0, 3).map((a: any) => a.artist_name || a).join(" · ")}
                      </p>
                    </div>
                    <span className="num text-ink-2 shrink-0">
                      {era.start_month || era.start_date} → {era.end_month || era.end_date}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {camelotWheel.length > 0 && (
            <Section
              className="lg:col-span-5"
              kicker="TONALITÉS HARMONIQUES"
              title={
                <>
                  Répartition Roue de Camelot
                  <InfoTooltip
                    label="Roue de Camelot"
                    text="Notation utilisée par les DJ pour classer les tonalités musicales (1A à 12B) : deux codes voisins se mixent harmonieusement."
                  />
                </>
              }
            >
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-xs num">
                {camelotWheel.slice(0, 12).map((c: any, i: number) => (
                  <div key={i} className="p-2.5 rounded bg-bg-3 border border-line text-center">
                    <p className="text-amber font-semibold">{c.code || c.camelot_code}</p>
                    <p className="text-ink-3 text-[11px] mt-0.5">{c.count || c.tracks_count || 0} titres</p>
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
