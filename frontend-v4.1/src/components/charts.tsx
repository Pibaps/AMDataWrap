/**
 * Hand-written SVG charts in the "Salon d'écoute" / liner-notes editorial palette.
 * Restrained amber / brass / moss / ink tones, thin 1px rules, zero external chart libraries.
 */

import React, { useMemo, useState } from "react";
import { formatDateFr, formatHours, formatInt } from "../api/client";

/* -------------------------------------------------------------------------- */
/* 1. CalendarHeatmap — GitHub-style daily activity grid (SVG, amber scale)   */
/* -------------------------------------------------------------------------- */

export interface HeatmapDay {
  date: string;
  plays: number;
  total_ms: number;
  unique_tracks?: number;
}

const MONTH_SHORT_FR = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Aoû", "Sep", "Oct", "Nov", "Déc"];

export const CalendarHeatmap: React.FC<{ days: HeatmapDay[]; onSelectDate?: (date: string) => void }> = ({
  days,
  onSelectDate,
}) => {
  const [hovered, setHovered] = useState<HeatmapDay | null>(null);

  const { weeks, monthLabels, maxMs } = useMemo(() => {
    if (!days || days.length === 0) return { weeks: [], monthLabels: [], maxMs: 1 };
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const map = new Map<string, HeatmapDay>();
    let maxVal = 1;
    for (const d of sorted) {
      map.set(d.date, d);
      if (d.total_ms > maxVal) maxVal = d.total_ms;
    }

    const first = new Date(`${sorted[0].date}T12:00:00`);
    const last = new Date(`${sorted[sorted.length - 1].date}T12:00:00`);

    // Align start to Monday
    const startDow = (first.getDay() + 6) % 7;
    const cursor = new Date(first);
    cursor.setDate(cursor.getDate() - startDow);

    const cols: Array<Array<{ date: string; entry: HeatmapDay | null; inRange: boolean }>> = [];
    const mLabels: Array<{ col: number; label: string }> = [];
    let lastMonth = -1;

    while (cursor <= last || cols.length === 0) {
      const colIdx = cols.length;
      const week: Array<{ date: string; entry: HeatmapDay | null; inRange: boolean }> = [];
      for (let dow = 0; dow < 7; dow++) {
        const iso = cursor.toISOString().slice(0, 10);
        const inRange = cursor >= first && cursor <= last;
        if (dow === 0 && inRange) {
          const m = cursor.getMonth();
          if (m !== lastMonth) {
            mLabels.push({ col: colIdx, label: MONTH_SHORT_FR[m] });
            lastMonth = m;
          }
        }
        week.push({ date: iso, entry: map.get(iso) ?? null, inRange });
        cursor.setDate(cursor.getDate() + 1);
      }
      cols.push(week);
      if (cols.length > 160) break;
    }

    return { weeks: cols, monthLabels: mLabels, maxMs: maxVal };
  }, [days]);

  if (weeks.length === 0) {
    return <p className="text-[12px] text-ink-3 py-4">Aucune donnée quotidienne sur la période.</p>;
  }

  const cell = 11;
  const gap = 3;
  const step = cell + gap;
  const leftPad = 28;
  const topPad = 18;
  const width = leftPad + weeks.length * step + 4;
  const height = topPad + 7 * step + 4;

  const cellFill = (ms: number, inRange: boolean) => {
    if (!inRange) return "transparent";
    if (!ms || ms <= 0) return "#1e1814";
    const r = Math.min(1, Math.sqrt(ms / maxMs));
    if (r < 0.25) return "#4a321e";
    if (r < 0.5) return "#7c4d28";
    if (r < 0.75) return "#b8723c";
    return "#e8873e";
  };

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: Math.min(width, 680), width: "100%", height: "auto", maxHeight: 165 }}
          role="img"
          aria-label="Calendrier d'écoute quotidien"
        >
          {monthLabels.map((m, i) => (
            <text
              key={`${m.col}-${i}`}
              x={leftPad + m.col * step}
              y={11}
              fill="#7d7163"
              fontSize="9.5"
              fontFamily="var(--font-mono)"
            >
              {m.label}
            </text>
          ))}
          {["Lun", "", "Mer", "", "Ven", "", "Dim"].map((lbl, dow) =>
            lbl ? (
              <text
                key={dow}
                x={0}
                y={topPad + dow * step + 8.5}
                fill="#7d7163"
                fontSize="9"
                fontFamily="var(--font-mono)"
              >
                {lbl}
              </text>
            ) : null
          )}
          {weeks.map((week, cIdx) =>
            week.map((d, rIdx) => (
              <rect
                key={d.date}
                x={leftPad + cIdx * step}
                y={topPad + rIdx * step}
                width={cell}
                height={cell}
                rx={2}
                fill={cellFill(d.entry?.total_ms ?? 0, d.inRange)}
                stroke={hovered?.date === d.date ? "#ede2d2" : "none"}
                strokeWidth={1}
                className={d.entry ? "cursor-pointer" : ""}
                onMouseEnter={() => d.entry && setHovered(d.entry)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => d.entry && onSelectDate?.(d.date)}
              />
            ))
          )}
        </svg>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-ink-3 mt-2 pt-2 border-t border-line">
        <div className="min-h-[18px]">
          {hovered ? (
            <span className="text-ink-2">
              <strong className="text-ink font-medium">{formatDateFr(hovered.date)}</strong> ·{" "}
              <span className="num">{formatHours(hovered.total_ms)}</span> ({formatInt(hovered.plays)} écoutes
              {hovered.unique_tracks ? `, ${hovered.unique_tracks} titres` : ""})
            </span>
          ) : (
            <span>Survolez une case pour inspecter la journée.</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 num text-[10.5px]">
          <span>Moins</span>
          {["#1e1814", "#4a321e", "#7c4d28", "#b8723c", "#e8873e"].map((c) => (
            <span key={c} className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: c }} />
          ))}
          <span>Plus</span>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 2. DayHourMatrix — 7 × 24 circadian listening matrix                       */
/* -------------------------------------------------------------------------- */

export interface MatrixCell {
  dow: number;
  dow_label: string;
  hour: number;
  plays: number;
  total_ms: number;
  value: number;
}

const DOW_ORDER = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export const DayHourMatrix: React.FC<{ cells: MatrixCell[] }> = ({ cells }) => {
  const [hovered, setHovered] = useState<MatrixCell | null>(null);

  const { grid, maxVal } = useMemo(() => {
    const map = new Map<string, MatrixCell>();
    let m = 1;
    for (const c of cells || []) {
      map.set(`${c.dow}-${c.hour}`, c);
      if (c.value > m) m = c.value;
    }
    return { grid: map, maxVal: m };
  }, [cells]);

  const cellW = 22;
  const cellH = 18;
  const gap = 3;
  const leftPad = 36;
  const topPad = 18;
  const width = leftPad + 24 * (cellW + gap);
  const height = topPad + 7 * (cellH + gap);

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", minWidth: 520, height: "auto" }}
          role="img"
          aria-label="Matrice jour par heure"
        >
          {Array.from({ length: 24 }).map((_, h) =>
            h % 3 === 0 ? (
              <text
                key={h}
                x={leftPad + h * (cellW + gap) + cellW / 2}
                y={12}
                textAnchor="middle"
                fill="#7d7163"
                fontSize="9.5"
                fontFamily="var(--font-mono)"
              >
                {`${h}h`}
              </text>
            ) : null
          )}
          {DOW_ORDER.map((label, dow) => (
            <g key={dow}>
              <text
                x={0}
                y={topPad + dow * (cellH + gap) + 13}
                fill="#b9ab98"
                fontSize="10"
                fontFamily="var(--font-mono)"
              >
                {label}
              </text>
              {Array.from({ length: 24 }).map((_, hour) => {
                const entry = grid.get(`${dow}-${hour}`) ?? null;
                const val = entry?.value ?? 0;
                const ratio = val > 0 ? Math.min(1, Math.sqrt(val / maxVal)) : 0;
                const fill =
                  ratio === 0
                    ? "#1e1814"
                    : ratio < 0.3
                      ? "#46311f"
                      : ratio < 0.6
                        ? "#84522a"
                        : ratio < 0.85
                          ? "#bd743b"
                          : "#e8873e";
                return (
                  <rect
                    key={hour}
                    x={leftPad + hour * (cellW + gap)}
                    y={topPad + dow * (cellH + gap)}
                    width={cellW}
                    height={cellH}
                    rx={2.5}
                    fill={fill}
                    stroke={hovered && hovered.dow === dow && hovered.hour === hour ? "#ede2d2" : "none"}
                    strokeWidth={1}
                    onMouseEnter={() =>
                      setHovered(
                        entry ?? {
                          dow,
                          dow_label: label,
                          hour,
                          plays: 0,
                          total_ms: 0,
                          value: 0,
                        }
                      )
                    }
                    onMouseLeave={() => setHovered(null)}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-2 pt-2 border-t border-line text-[11.5px] text-ink-3 min-h-[20px]">
        {hovered ? (
          <span className="text-ink-2">
            <strong className="text-ink font-medium">
              {hovered.dow_label} · {hovered.hour}h00–{hovered.hour + 1}h00
            </strong>{" "}
            — <span className="num">{formatHours(hovered.total_ms)}</span> ({formatInt(hovered.plays)} écoutes)
          </span>
        ) : (
          <span>Densité horaire cumulée sur les 7 jours de la semaine.</span>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 3. RadarChart — 6-axis hexagonal SVG radar for Persona radial_scores       */
/* -------------------------------------------------------------------------- */

export interface RadialScore {
  axis: string;
  score: number;
  detail: string;
}

export const RadarChart: React.FC<{ scores: RadialScore[] }> = ({ scores }) => {
  if (!scores || scores.length === 0) return null;
  const cx = 160;
  const cy = 145;
  const rMax = 96;
  const n = scores.length;

  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

  const rings = [0.25, 0.5, 0.75, 1];
  const polyPoints = scores
    .map((s, i) => {
      const a = angleFor(i);
      const r = (Math.max(0, Math.min(100, s.score)) / 100) * rMax;
      return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 320 290" className="w-full max-w-[340px] mx-auto h-auto" role="img" aria-label="Radar comportemental">
      {rings.map((pct) => {
        const pts = scores
          .map((_, i) => {
            const a = angleFor(i);
            const r = pct * rMax;
            return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
          })
          .join(" ");
        return <polygon key={pct} points={pts} fill="none" stroke="#2c241e" strokeWidth={1} />;
      })}
      {scores.map((_, i) => {
        const a = angleFor(i);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos(a) * rMax}
            y2={cy + Math.sin(a) * rMax}
            stroke="#2c241e"
            strokeWidth={1}
          />
        );
      })}
      <polygon points={polyPoints} fill="rgba(232, 135, 62, 0.2)" stroke="#e8873e" strokeWidth={1.75} />
      {scores.map((s, i) => {
        const a = angleFor(i);
        const r = (Math.max(0, Math.min(100, s.score)) / 100) * rMax;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        const lx = cx + Math.cos(a) * (rMax + 24);
        const ly = cy + Math.sin(a) * (rMax + 20);
        const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
        return (
          <g key={s.axis}>
            <circle cx={px} cy={py} r={3.2} fill="#e8873e" stroke="#0f0c0a" strokeWidth={1.2} />
            <text x={lx} y={ly} textAnchor={anchor} fill="#ede2d2" fontSize="10.5" fontFamily="var(--font-sans)">
              {s.axis}
            </text>
            <text
              x={lx}
              y={ly + 12}
              textAnchor={anchor}
              fill="#e8873e"
              fontSize="10"
              fontFamily="var(--font-mono)"
            >
              {s.score}/100
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/* -------------------------------------------------------------------------- */
/* 4. LorenzCurveSvg — Inequality curve with diagonal of perfect equality     */
/* -------------------------------------------------------------------------- */

export interface LorenzPoint {
  p: number;
  l: number;
}

export const LorenzCurveSvg: React.FC<{
  artistsLorenz: LorenzPoint[];
  tracksLorenz?: LorenzPoint[];
}> = ({ artistsLorenz, tracksLorenz }) => {
  const pad = 32;
  const size = 240;
  const inner = size - pad * 2;

  const toPath = (pts: LorenzPoint[]) => {
    if (!pts || pts.length === 0) return "";
    return pts
      .map((pt, i) => {
        const x = pad + pt.p * inner;
        const y = pad + (1 - pt.l) * inner;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  const toArea = (pts: LorenzPoint[]) => {
    if (!pts || pts.length === 0) return "";
    const line = toPath(pts);
    return `${line} L${pad + inner},${pad + inner} L${pad},${pad + inner} Z`;
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[260px] h-auto" role="img" aria-label="Courbe de Lorenz">
      <rect x={pad} y={pad} width={inner} height={inner} fill="#14100d" stroke="#2c241e" strokeWidth={1} />
      {[0.25, 0.5, 0.75].map((t) => (
        <g key={t}>
          <line
            x1={pad}
            y1={pad + t * inner}
            x2={pad + inner}
            y2={pad + t * inner}
            stroke="#221b16"
            strokeWidth={1}
          />
          <line
            x1={pad + t * inner}
            y1={pad}
            x2={pad + t * inner}
            y2={pad + inner}
            stroke="#221b16"
            strokeWidth={1}
          />
        </g>
      ))}
      {/* Equality diagonal */}
      <line
        x1={pad}
        y1={pad + inner}
        x2={pad + inner}
        y2={pad}
        stroke="#7d7163"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      {artistsLorenz && artistsLorenz.length > 1 && (
        <>
          <path d={toArea(artistsLorenz)} fill="rgba(232, 135, 62, 0.14)" />
          <path d={toPath(artistsLorenz)} fill="none" stroke="#e8873e" strokeWidth={2} />
        </>
      )}
      {tracksLorenz && tracksLorenz.length > 1 && (
        <path d={toPath(tracksLorenz)} fill="none" stroke="#c9a86b" strokeWidth={1.5} strokeDasharray="4 2" />
      )}
      <text x={pad} y={size - 10} fill="#7d7163" fontSize="9.5" fontFamily="var(--font-mono)">
        0% catalogue → 100%
      </text>
      <text
        x={11}
        y={pad + inner / 2}
        fill="#7d7163"
        fontSize="9.5"
        fontFamily="var(--font-mono)"
        transform={`rotate(-90 11 ${pad + inner / 2})`}
        textAnchor="middle"
      >
        Temps cumulé
      </text>
    </svg>
  );
};

/* -------------------------------------------------------------------------- */
/* 5. VerticalBarsSvg — Clean vertical bar chart for monthly trends / years   */
/* -------------------------------------------------------------------------- */

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  tooltip?: string;
}

export const VerticalBarsSvg: React.FC<{
  items: BarDatum[];
  height?: number;
  color?: string;
  formatValue?: (v: number) => string;
}> = ({ items, height = 150, color = "#e8873e", formatValue }) => {
  const [hovered, setHovered] = useState<BarDatum | null>(null);
  if (!items || items.length === 0) return null;

  const max = Math.max(1, ...items.map((d) => d.value));
  const w = Math.max(360, items.length * 14);
  const topPad = 14;
  const botPad = 22;
  const chartH = height - topPad - botPad;
  const slotW = w / items.length;
  const barW = Math.max(2, Math.min(20, slotW * 0.68));
  const labelStep = Math.max(1, Math.ceil(items.length / 8));

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full h-auto" role="img" aria-label="Histogramme">
        <line x1={0} y1={topPad + chartH} x2={w} y2={topPad + chartH} stroke="#2c241e" strokeWidth={1} />
        {items.map((d, i) => {
          const bh = Math.max(1.5, (d.value / max) * chartH);
          const x = i * slotW + (slotW - barW) / 2;
          const y = topPad + chartH - bh;
          const isHov = hovered?.key === d.key;
          return (
            <g
              key={d.key}
              onMouseEnter={() => setHovered(d)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              <rect x={i * slotW} y={topPad} width={slotW} height={chartH} fill="transparent" />
              <rect
                x={x}
                y={y}
                width={barW}
                height={bh}
                rx={1.5}
                fill={isHov ? "#ede2d2" : color}
                opacity={isHov ? 1 : 0.88}
              />
              {i % labelStep === 0 && (
                <text
                  x={i * slotW + slotW / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fill="#7d7163"
                  fontSize="9.5"
                  fontFamily="var(--font-mono)"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="text-[11.5px] text-ink-3 min-h-[18px] mt-1">
        {hovered ? (
          <span className="text-ink-2">
            <strong className="text-ink font-medium num">{hovered.label}</strong> —{" "}
            <span className="num">{hovered.tooltip ?? (formatValue ? formatValue(hovered.value) : hovered.value)}</span>
          </span>
        ) : (
          <span>Survolez une barre pour afficher le détail.</span>
        )}
      </div>
    </div>
  );
};
