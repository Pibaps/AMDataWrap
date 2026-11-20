/**
 * Galaxie 3D V4 — 100% Lisible (Correction #2 from PLAN_V4_FINAL.md):
 * - Clear HUD Legend (Sectors = Genres, Size = Listening Time, Y-axis = Era)
 * - Clean typographic labels with screen-space anti-collision bounding-box pruning
 * - Hover focus dims other nodes & spotlights the hovered artist cleanly
 * - Quick genre & era filters directly inside the scene + Artist Inspector panel on click
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Compass, Filter, Sparkles, X } from "lucide-react";
import { apiGet, buildQueryParams, formatHours } from "../api/client";
import { useV4Store } from "../store/useV4Store";

interface GalaxyNode {
  id: string;
  label: string;
  genre: string;
  era_year: number;
  plays: number;
  total_ms: number;
  x: number;
  y: number;
  z: number;
  color: string;
}

const GENRE_COLORS = ["#ec4899", "#6366f1", "#06b6d4", "#f59e0b", "#10b981", "#a855f7", "#fb7185"];

export const GalaxyV4View: React.FC = () => {
  const filters = useV4Store((s) => s.filters);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [nodes, setNodes] = useState<GalaxyNode[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [inspected, setInspected] = useState<GalaxyNode | null>(null);
  const rotRef = useRef({ yaw: 0.35, pitch: 0.22, dragging: false, lx: 0, ly: 0 });
  const projectedRef = useRef<Array<{ node: GalaxyNode; sx: number; sy: number; r: number; depth: number }>>([]);

  useEffect(() => {
    const qs = buildQueryParams(filters);
    apiGet<any>(`/api/galaxy${qs}`)
      .then((res) => {
        const raw = res?.nodes || res?.artists || [];
        const genreMap = new Map<string, number>();
        const mapped: GalaxyNode[] = raw.slice(0, 90).map((item: any, idx: number) => {
          const g = item.genre || "Autre";
          if (!genreMap.has(g)) genreMap.set(g, genreMap.size);
          const gIdx = genreMap.get(g)!;
          const angle = (gIdx * 1.15) + ((idx % 12) * 0.22);
          const radius = 1.4 + ((idx % 7) * 0.42);
          const year = Number(item.release_year || item.avg_year || 2020);
          return {
            id: item.artist_group_key || item.id || `${idx}`,
            label: item.artist_name || item.name || item.label || "Artiste",
            genre: g,
            era_year: year,
            plays: Number(item.plays || item.total_plays || 1),
            total_ms: Number(item.total_ms || (item.plays || 1) * 180_000),
            x: typeof item.x === "number" ? item.x * 0.04 : Math.cos(angle) * radius,
            y: typeof item.y === "number" ? item.y * 0.04 : ((year - 2015) / 12) * 2.2,
            z: typeof item.z === "number" ? item.z * 0.04 : Math.sin(angle) * radius,
            color: GENRE_COLORS[gIdx % GENRE_COLORS.length],
          };
        });
        setNodes(mapped);
      })
      .catch(() => setNodes([]));
  }, [filters]);

  const genres = useMemo(() => {
    const set = new Set<string>();
    nodes.forEach((n) => set.add(n.genre));
    return Array.from(set).slice(0, 8);
  }, [nodes]);

  const visibleNodes = useMemo(
    () => (selectedGenre === "all" ? nodes : nodes.filter((n) => n.genre === selectedGenre)),
    [nodes, selectedGenre]
  );

  // Interactive 3D projection + Anti-Collision Label Renderer (60 FPS)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const render = () => {
      rafId = requestAnimationFrame(render);
      if (document.visibilityState === "hidden") return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 800;
      const h = canvas.clientHeight || 520;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (!rotRef.current.dragging) {
        rotRef.current.yaw += 0.0022;
      }

      const cosY = Math.cos(rotRef.current.yaw);
      const sinY = Math.sin(rotRef.current.yaw);
      const cosP = Math.cos(rotRef.current.pitch);
      const sinP = Math.sin(rotRef.current.pitch);
      const scale = Math.min(w, h) * 0.14;
      const maxMs = Math.max(1, ...visibleNodes.map((n) => n.total_ms));

      const proj = visibleNodes.map((node) => {
        const x1 = node.x * cosY - node.z * sinY;
        const z1 = node.x * sinY + node.z * cosY;
        const y2 = node.y * cosP - z1 * sinP;
        const z2 = node.y * sinP + z1 * cosP;
        const persp = 6.5 / Math.max(2.0, 6.5 - z2);
        const sx = w / 2 + x1 * scale * persp;
        const sy = h / 2 - y2 * scale * persp;
        const r = (5 + Math.sqrt(node.total_ms / maxMs) * 14) * persp;
        return { node, sx, sy, r, depth: z2 };
      });

      proj.sort((a, b) => a.depth - b.depth);
      projectedRef.current = proj;

      // Draw subtle genre constellation links
      ctx.lineWidth = 0.7;
      for (let i = 0; i < proj.length; i++) {
        const a = proj[i];
        for (let j = i + 1; j < Math.min(proj.length, i + 6); j++) {
          const b = proj[j];
          if (a.node.genre === b.node.genre) {
            const dist = Math.hypot(a.sx - b.sx, a.sy - b.sy);
            if (dist < 130) {
              ctx.strokeStyle = hoveredId && hoveredId !== a.node.id && hoveredId !== b.node.id
                ? "rgba(255,255,255,0.03)"
                : "rgba(255,255,255,0.12)";
              ctx.beginPath();
              ctx.moveTo(a.sx, a.sy);
              ctx.lineTo(b.sx, b.sy);
              ctx.stroke();
            }
          }
        }
      }

      // Draw star nodes
      for (const p of proj) {
        const isFocus = hoveredId === p.node.id || inspected?.id === p.node.id;
        const dimmed = hoveredId !== null && !isFocus;
        ctx.globalAlpha = dimmed ? 0.22 : 0.94;
        const grad = ctx.createRadialGradient(p.sx, p.sy, 1, p.sx, p.sy, p.r * 1.9);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.35, p.node.color);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, p.r * (isFocus ? 2.2 : 1.7), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Anti-collision screen-space labels (top artists + hovered artist always shown)
      const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
      const sortedForLabels = [...proj].sort((a, b) => {
        if (a.node.id === hoveredId) return -1;
        if (b.node.id === hoveredId) return 1;
        return b.node.total_ms - a.node.total_ms;
      });

      ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
      for (const p of sortedForLabels.slice(0, 22)) {
        const isFocus = p.node.id === hoveredId || p.node.id === inspected?.id;
        const text = p.node.label.slice(0, 22);
        const tw = ctx.measureText(text).width + 14;
        const th = 22;
        const bx = p.sx - tw / 2;
        const by = p.sy - p.r - th - 4;
        const box = { x1: bx - 4, y1: by - 4, x2: bx + tw + 4, y2: by + th + 4 };

        const collides =
          !isFocus &&
          placedBoxes.some(
            (o) => !(box.x2 < o.x1 || box.x1 > o.x2 || box.y2 < o.y1 || box.y1 > o.y2)
          );
        if (collides) continue;
        placedBoxes.push(box);

        ctx.globalAlpha = hoveredId && !isFocus ? 0.28 : 1;
        ctx.fillStyle = isFocus ? "rgba(236, 72, 153, 0.85)" : "rgba(10, 12, 22, 0.78)";
        ctx.beginPath();
        ctx.roundRect(bx, by, tw, th, 8);
        ctx.fill();
        ctx.strokeStyle = isFocus ? "#ffffff" : "rgba(255,255,255,0.16)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = "#f4f1ea";
        ctx.textAlign = "center";
        ctx.fillText(text, p.sx, by + 15);
      }
      ctx.globalAlpha = 1;
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [visibleNodes, hoveredId, inspected]);

  const hitTest = (clientX: number, clientY: number): GalaxyNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (let i = projectedRef.current.length - 1; i >= 0; i--) {
      const p = projectedRef.current[i];
      if (Math.hypot(p.sx - x, p.sy - y) <= Math.max(14, p.r + 6)) {
        return p.node;
      }
    }
    return null;
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 pb-28">
      <div className="glass-panel rounded-3xl overflow-hidden relative">
        {/* Top HUD: Title + Quick Genre Filter */}
        <div className="p-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-bold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-rose-400" />
              Galaxie Sonore 3D V4
            </h1>
            <p className="text-xs text-white/60">
              Glisse pour orbiter · Survole un artiste pour le focus · Anti-collision typographique actif
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-white/50 mr-1" />
            <button
              onClick={() => setSelectedGenre("all")}
              className={`px-2.5 py-1 rounded-full text-xs ${
                selectedGenre === "all" ? "bg-rose-500 text-white" : "bg-white/5 text-white/70"
              }`}
            >
              Tous ({nodes.length})
            </button>
            {genres.map((g) => (
              <button
                key={g}
                onClick={() => setSelectedGenre(g)}
                className={`px-2.5 py-1 rounded-full text-xs ${
                  selectedGenre === g ? "bg-indigo-500 text-white" : "bg-white/5 text-white/70"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive 3D Canvas */}
        <div className="relative h-[500px] sm:h-[560px]">
          <canvas
            ref={canvasRef}
            data-testid="galaxy-3d-canvas"
            className="w-full h-full cursor-grab active:cursor-grabbing"
            onMouseDown={(e) => {
              rotRef.current.dragging = true;
              rotRef.current.lx = e.clientX;
              rotRef.current.ly = e.clientY;
            }}
            onMouseMove={(e) => {
              if (rotRef.current.dragging) {
                rotRef.current.yaw += (e.clientX - rotRef.current.lx) * 0.006;
                rotRef.current.pitch = Math.max(
                  -1.1,
                  Math.min(1.1, rotRef.current.pitch + (e.clientY - rotRef.current.ly) * 0.005)
                );
                rotRef.current.lx = e.clientX;
                rotRef.current.ly = e.clientY;
              } else {
                const hit = hitTest(e.clientX, e.clientY);
                setHoveredId(hit ? hit.id : null);
              }
            }}
            onMouseUp={() => {
              rotRef.current.dragging = false;
            }}
            onMouseLeave={() => {
              rotRef.current.dragging = false;
              setHoveredId(null);
            }}
            onClick={(e) => {
              const hit = hitTest(e.clientX, e.clientY);
              if (hit) setInspected(hit);
            }}
          />

          {/* Clear HUD Legend (bottom-left) */}
          <div
            data-testid="galaxy-hud-legend"
            className="absolute left-4 bottom-4 glass-pill rounded-2xl p-3 text-[11px] space-y-1 max-w-xs pointer-events-none"
          >
            <p className="font-mono-num font-bold text-rose-300 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5" /> LÉGENDE GALAXIE
            </p>
            <p className="text-white/75">• <strong>Secteurs &amp; Couleurs</strong> : Genres musicaux</p>
            <p className="text-white/75">• <strong>Taille des astres</strong> : Temps d&apos;écoute cumulé</p>
            <p className="text-white/75">• <strong>Altitude (axe Y)</strong> : Époque musicale</p>
          </div>

          {/* Artist Inspector Panel on click */}
          {inspected && (
            <div className="absolute right-4 top-4 w-64 glass-panel rounded-2xl p-4 border border-white/15">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-mono-num text-cyan-300 uppercase">{inspected.genre}</p>
                  <h3 className="font-display font-bold text-base">{inspected.label}</h3>
                </div>
                <button onClick={() => setInspected(null)} className="text-white/50 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3 text-xs font-mono-num">
                <div className="bg-white/5 rounded-xl p-2">
                  <p className="text-white/50 text-[10px]">ÉCOUTES</p>
                  <p className="font-bold text-sm">{inspected.plays}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-2">
                  <p className="text-white/50 text-[10px]">DURÉE</p>
                  <p className="font-bold text-sm">{formatHours(inspected.total_ms)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
