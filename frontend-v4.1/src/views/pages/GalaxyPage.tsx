/**
 * GalaxyPage — Constellation of Co-Occurring Artists.
 * Endpoint: GET /api/analytics/galaxy
 *
 * Performance rule: Renders on demand ONLY (on data load, pointer drag, hover, filter change, resize).
 * ZERO perpetual requestAnimationFrame loop when idle!
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API, buildQueryParams, formatHours, formatInt } from "../../api/client";
import type { GalaxyData } from "../../api/types";
import { playTrack } from "../../audio/playTrack";
import { Cover, Empty, ErrorNote, Loading, Page, PlayButton } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useV4Store } from "../../store/useV4Store";

interface StarNode {
  id: string;
  name: string;
  genre: string;
  year: number;
  plays: number;
  total_ms: number;
  artwork_url: string | null;
  preview_url: string | null;
  sample_song: string | null;
  x: number;
  y: number;
  z: number;
  color: string;
}

// Warm desaturated editorial palette (amber, brass, terracotta, sage, slate, ochre)
const WARM_PALETTE = ["#e8873e", "#c9a86b", "#d2553a", "#8fa27a", "#7e99a3", "#b87d95", "#d49b54"];

export const GalaxyPage: React.FC = () => {
  const filters = useV4Store((s) => s.filters);
  const qs = useMemo(() => buildQueryParams(filters), [filters]);
  const { data, loading, error, reload } = useApi<GalaxyData>(`${API.galaxy}${qs}`);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string>("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [inspected, setInspected] = useState<StarNode | null>(null);

  const cameraRef = useRef({ yaw: 0.42, pitch: 0.2, dragging: false, lx: 0, ly: 0 });
  const projectedRef = useRef<Array<{ node: StarNode; sx: number; sy: number; r: number; depth: number }>>([]);

  const { nodes, edges, genres } = useMemo(() => {
    const rawNodes: any[] = data?.nodes || [];
    const rawEdges: Array<{ source: string; target: string; weight: number }> = data?.edges || [];
    const genreIdxMap = new Map<string, number>();

    const mapped: StarNode[] = rawNodes.slice(0, 85).map((item, idx) => {
      const g = item.genre || "Autre";
      if (!genreIdxMap.has(g)) genreIdxMap.set(g, genreIdxMap.size);
      const gi = genreIdxMap.get(g)!;
      const angle = gi * 1.1 + (idx % 11) * 0.28;
      const radius = 1.3 + (idx % 7) * 0.44;
      const yr = Number(item.avg_year || 2018);
      return {
        id: item.artist_group_key || `${idx}`,
        name: item.artist_name || "Artiste",
        genre: g,
        year: yr,
        plays: Number(item.plays || 1),
        total_ms: Number(item.total_ms || 180_000),
        artwork_url: item.artwork_url || null,
        preview_url: item.preview_url || null,
        sample_song: item.sample_song || null,
        x: Math.cos(angle) * radius,
        y: ((yr - 2012) / 14) * 1.9,
        z: Math.sin(angle) * radius,
        color: WARM_PALETTE[gi % WARM_PALETTE.length],
      };
    });

    return {
      nodes: mapped,
      edges: rawEdges,
      genres: Array.from(genreIdxMap.keys()).slice(0, 8),
    };
  }, [data]);

  const visibleNodes = useMemo(
    () => (selectedGenre === "all" ? nodes : nodes.filter((n) => n.genre === selectedGenre)),
    [nodes, selectedGenre]
  );

  // Demand-driven 2D canvas draw (zero background loop!)
  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 860;
    const h = canvas.clientHeight || 540;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#110d0a";
    ctx.fillRect(0, 0, w, h);

    // Subtle polar reference rings
    ctx.strokeStyle = "rgba(237, 226, 210, 0.045)";
    ctx.lineWidth = 1;
    [110, 210, 310].forEach((rad) => {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, rad, 0, Math.PI * 2);
      ctx.stroke();
    });

    const { yaw, pitch } = cameraRef.current;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const scale = Math.min(w, h) * 0.145;
    const maxMs = Math.max(1, ...visibleNodes.map((n) => n.total_ms));

    const proj = visibleNodes.map((node) => {
      const x1 = node.x * cosY - node.z * sinY;
      const z1 = node.x * sinY + node.z * cosY;
      const y2 = node.y * cosP - z1 * sinP;
      const z2 = node.y * sinP + z1 * cosP;
      const persp = 6.5 / Math.max(2.0, 6.5 - z2);
      const sx = w / 2 + x1 * scale * persp;
      const sy = h / 2 - y2 * scale * persp;
      const r = (4 + Math.sqrt(node.total_ms / maxMs) * 12) * persp;
      return { node, sx, sy, r, depth: z2 };
    });

    proj.sort((a, b) => a.depth - b.depth);
    projectedRef.current = proj;
    const byId = new Map(proj.map((p) => [p.node.id, p]));

    // Draw real session co-occurrence edges
    ctx.lineWidth = 1;
    for (const edge of edges) {
      const a = byId.get(edge.source);
      const b = byId.get(edge.target);
      if (!a || !b) continue;
      const isHighlighted =
        hoveredId === a.node.id ||
        hoveredId === b.node.id ||
        inspected?.id === a.node.id ||
        inspected?.id === b.node.id;
      ctx.strokeStyle = isHighlighted
        ? "rgba(232, 135, 62, 0.48)"
        : hoveredId
        ? "rgba(237, 226, 210, 0.03)"
        : "rgba(237, 226, 210, 0.09)";
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }

    // Draw artist nodes
    for (const p of proj) {
      const isFocus = p.node.id === hoveredId || p.node.id === inspected?.id;
      const dimmed = hoveredId !== null && !isFocus;
      ctx.globalAlpha = dimmed ? 0.25 : 0.95;

      ctx.fillStyle = p.node.color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, p.r * (isFocus ? 1.3 : 1), 0, Math.PI * 2);
      ctx.fill();

      if (isFocus) {
        ctx.strokeStyle = "#ede2d2";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, p.r * 1.65, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Anti-collision screen-space labels
    const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const sortedLabels = [...proj].sort((a, b) => {
      if (a.node.id === hoveredId) return -1;
      if (b.node.id === hoveredId) return 1;
      return b.node.total_ms - a.node.total_ms;
    });

    ctx.font = '500 11.5px "Inter", sans-serif';
    for (const p of sortedLabels.slice(0, 24)) {
      const isFocus = p.node.id === hoveredId || p.node.id === inspected?.id;
      const txt = p.node.name.slice(0, 22);
      const tw = ctx.measureText(txt).width + 12;
      const th = 20;
      const bx = p.sx - tw / 2;
      const by = p.sy - p.r - th - 4;
      const box = { x1: bx - 3, y1: by - 3, x2: bx + tw + 3, y2: by + th + 3 };

      const collides =
        !isFocus &&
        placed.some((o) => !(box.x2 < o.x1 || box.x1 > o.x2 || box.y2 < o.y1 || box.y1 > o.y2));
      if (collides) continue;
      placed.push(box);

      ctx.globalAlpha = hoveredId && !isFocus ? 0.3 : 1;
      ctx.fillStyle = isFocus ? "#e8873e" : "rgba(22, 17, 14, 0.88)";
      ctx.fillRect(bx, by, tw, th);
      ctx.strokeStyle = isFocus ? "#ede2d2" : "#3a3029";
      ctx.strokeRect(bx, by, tw, th);

      ctx.fillStyle = isFocus ? "#1a0f07" : "#ede2d2";
      ctx.textAlign = "center";
      ctx.fillText(txt, p.sx, by + 14);
    }
    ctx.globalAlpha = 1;
  }, [visibleNodes, edges, hoveredId, inspected]);

  useEffect(() => {
    drawScene();
    const onResize = () => drawScene();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawScene]);

  const hitTest = (clientX: number, clientY: number): StarNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (let i = projectedRef.current.length - 1; i >= 0; i--) {
      const p = projectedRef.current[i];
      if (Math.hypot(p.sx - x, p.sy - y) <= Math.max(12, p.r + 5)) {
        return p.node;
      }
    }
    return null;
  };

  if (loading && !data) {
    return (
      <Page title="Constellation sonore" kicker="GRAPHE DE CO-OCCURRENCE EN SESSION">
        <Loading rows={6} />
      </Page>
    );
  }
  if (error && !data) {
    return (
      <Page title="Constellation sonore" kicker="GRAPHE DE CO-OCCURRENCE EN SESSION">
        <ErrorNote message={error} onRetry={reload} />
      </Page>
    );
  }

  return (
    <Page
      title="Constellation sonore"
      kicker="GRAPHE SPATIAL DE CO-OCCURRENCE · RENDU À LA DEMANDE"
      intro="Les artistes écoutés au sein des mêmes sessions sont reliés par des filaments. Glisse pour orienter la constellation, clique sur un astre pour l'inspecter."
      actions={
        <div className="flex flex-wrap gap-1.5">
          <button
            className="chip"
            data-active={selectedGenre === "all"}
            onClick={() => setSelectedGenre("all")}
          >
            Tous ({nodes.length})
          </button>
          {genres.map((g) => (
            <button
              key={g}
              className="chip"
              data-active={selectedGenre === g}
              onClick={() => setSelectedGenre(g)}
            >
              {g}
            </button>
          ))}
        </div>
      }
    >
      <div className="panel overflow-hidden relative">
        <div className="relative h-[520px] sm:h-[580px]">
          <canvas
            ref={canvasRef}
            data-testid="galaxy-3d-canvas"
            className="w-full h-full cursor-grab active:cursor-grabbing block"
            onMouseDown={(e) => {
              cameraRef.current.dragging = true;
              cameraRef.current.lx = e.clientX;
              cameraRef.current.ly = e.clientY;
            }}
            onMouseMove={(e) => {
              if (cameraRef.current.dragging) {
                cameraRef.current.yaw += (e.clientX - cameraRef.current.lx) * 0.006;
                cameraRef.current.pitch = Math.max(
                  -1.1,
                  Math.min(1.1, cameraRef.current.pitch + (e.clientY - cameraRef.current.ly) * 0.005)
                );
                cameraRef.current.lx = e.clientX;
                cameraRef.current.ly = e.clientY;
                drawScene();
              } else {
                const hit = hitTest(e.clientX, e.clientY);
                const nextId = hit ? hit.id : null;
                if (nextId !== hoveredId) {
                  setHoveredId(nextId);
                }
              }
            }}
            onMouseUp={() => {
              cameraRef.current.dragging = false;
            }}
            onMouseLeave={() => {
              cameraRef.current.dragging = false;
              if (hoveredId !== null) setHoveredId(null);
            }}
            onClick={(e) => {
              const hit = hitTest(e.clientX, e.clientY);
              if (hit) setInspected(hit);
            }}
          />

          {/* HUD Legend */}
          <div
            data-testid="galaxy-hud-legend"
            className="absolute left-4 bottom-4 overlay p-3.5 text-xs space-y-1 max-w-xs pointer-events-none"
          >
            <p className="kicker text-amber">LECTURE DE LA CONSTELLATION</p>
            <p className="text-ink-2">• Secteurs &amp; teintes : genres dominants</p>
            <p className="text-ink-2">• Diamètre : durée d&apos;écoute cumulée</p>
            <p className="text-ink-2">• Liens : écoutes fréquentes dans la même session</p>
          </div>

          {/* Inspected Artist Card */}
          {inspected && (
            <div className="absolute right-4 top-4 w-72 overlay p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <Cover url={inspected.artwork_url} alt={inspected.name} size={46} />
                  <div className="min-w-0">
                    <p className="kicker">{inspected.genre} · {inspected.year}</p>
                    <h3 className="font-display text-lg font-[500] truncate">{inspected.name}</h3>
                  </div>
                </div>
                <button
                  onClick={() => setInspected(null)}
                  className="text-xs text-ink-3 hover:text-ink px-1.5"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs num">
                <div className="p-2.5 rounded bg-bg-3 border border-line">
                  <p className="kicker">ÉCOUTES</p>
                  <p className="text-sm font-semibold mt-0.5">{formatInt(inspected.plays)}</p>
                </div>
                <div className="p-2.5 rounded bg-bg-3 border border-line">
                  <p className="kicker">TEMPS</p>
                  <p className="text-sm font-semibold mt-0.5">{formatHours(inspected.total_ms)}</p>
                </div>
              </div>

              {inspected.sample_song && (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-line text-xs">
                  <div className="min-w-0">
                    <p className="kicker">TITRE PHARE</p>
                    <p className="truncate text-ink mt-0.5">{inspected.sample_song}</p>
                  </div>
                  <PlayButton
                    onClick={() =>
                      playTrack({
                        song_name: inspected.sample_song!,
                        artist_name: inspected.name,
                        artwork_url: inspected.artwork_url,
                        preview_url: inspected.preview_url,
                      })
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Page>
  );
};
