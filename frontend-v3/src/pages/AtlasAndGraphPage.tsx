import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import { Globe2, Network, Search } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import Sigma from 'sigma'
import { apiGet, type FilterState } from '../api/client'
import type { ThemePolarity } from '../hooks/useUrlFilters'
import { usePlayerStore } from '../store/playerStore'

interface AtlasAndGraphPageProps {
  filters: FilterState
  theme: ThemePolarity
}

// Offline-safe built-in MapLibre style with zero external tile dependency (prevents 404/network errors in offline/sandboxed modes)
function buildBaseMapStyle(theme: ThemePolarity): maplibregl.StyleSpecification {
  const bg = theme === 'dark' ? '#14171c' : '#e8e4da'
  return {
    version: 8,
    name: 'AMDataWrap Matte Base',
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': bg },
      },
    ],
  }
}

// Lightweight GeoJSON continent outlines for crisp offline/online vector context
const WORLD_GRATICULE_GEOJSON = (() => {
  const features: any[] = []
  for (let lat = -60; lat <= 60; lat += 30) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-180, lat], [180, lat]] },
      properties: {},
    })
  }
  for (let lng = -150; lng <= 180; lng += 30) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[lng, -80], [lng, 80]] },
      properties: {},
    })
  }
  return { type: 'FeatureCollection', features }
})()

export function AtlasAndGraphPage({ filters, theme }: AtlasAndGraphPageProps) {
  const [view, setView] = useState<'atlas' | 'graph'>('atlas')
  const [graphQuery, setGraphQuery] = useState('')
  const [selectedNode, setSelectedNode] = useState<any | null>(null)
  const openDrawer = usePlayerStore((s) => s.openDrawer)

  const { data: atlasData } = useQuery({
    queryKey: ['v3-atlas', filters],
    queryFn: () => apiGet('/api/v3/analytics/atlas', filters, { limit: 180 }),
    placeholderData: keepPreviousData,
  })

  const { data: graphData } = useQuery({
    queryKey: ['v3-graph2d', filters],
    queryFn: () => apiGet('/api/v3/analytics/graph2d', filters, { limit: 320 }),
    placeholderData: keepPreviousData,
  })

  // 1. MapLibre GL + Deck.gl MapLibreOverlay (single camera controller -> zero zoom desync!)
  const mapHostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)

  useEffect(() => {
    if (view !== 'atlas' || !mapHostRef.current) return
    let map: maplibregl.Map | null = null
    try {
      map = new maplibregl.Map({
        container: mapHostRef.current,
        style: buildBaseMapStyle(theme),
        center: [2.35, 36.5],
        zoom: 1.75,
        attributionControl: false,
      })
      mapRef.current = map

      map.on('load', () => {
        if (!map) return
        map.addSource('graticule', { type: 'geojson', data: WORLD_GRATICULE_GEOJSON as any })
        map.addLayer({
          id: 'graticule-lines',
          type: 'line',
          source: 'graticule',
          paint: {
            'line-color': theme === 'dark' ? '#262b35' : '#cfc9bc',
            'line-width': 1,
          },
        })
      })

      const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
      map.addControl(overlay as unknown as maplibregl.IControl)
      overlayRef.current = overlay
    } catch {
      /* fallback handled below */
    }

    return () => {
      if (overlayRef.current && map) {
        try {
          map.removeControl(overlayRef.current as unknown as maplibregl.IControl)
        } catch {
          /* ignore */
        }
      }
      overlayRef.current = null
      map?.remove()
      mapRef.current = null
    }
  }, [view, theme])

  useEffect(() => {
    if (view !== 'atlas' || !overlayRef.current || !atlasData?.nodes) return
    const nodes = atlasData.nodes as any[]
    const home = atlasData.home || { lat: 48.8566, lng: 2.3522 }
    const maxH = Math.max(1, ...nodes.map((n) => n.hours || 0))

    overlayRef.current.setProps({
      layers: [
        new ArcLayer({
          id: 'origin-arcs',
          data: nodes.slice(0, 65),
          getSourcePosition: (d: any) => [d.lng, d.lat],
          getTargetPosition: () => [home.lng, home.lat],
          getSourceColor: theme === 'dark' ? [104, 156, 210, 150] : [44, 98, 150, 140],
          getTargetColor: theme === 'dark' ? [212, 109, 61, 180] : [196, 87, 39, 170],
          getWidth: (d: any) => Math.max(1, Math.min(4.5, 1 + (d.hours / maxH) * 3.5)),
        }),
        new ScatterplotLayer({
          id: 'origin-nodes',
          data: nodes,
          pickable: true,
          radiusScale: 1,
          radiusMinPixels: 5,
          radiusMaxPixels: 28,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: (d: any) => 50000 + Math.sqrt(d.hours / maxH) * 320000,
          getFillColor: (d: any) =>
            d.country_iso === 'FR' ? [212, 109, 61, 220] : [93, 143, 194, 220],
          getLineColor: theme === 'dark' ? [235, 235, 239, 200] : [28, 28, 32, 180],
          lineWidthMinPixels: 1,
          stroked: true,
          onHover: (info: any) => {
            if (info.object) setSelectedNode(info.object)
          },
          onClick: (info: any) => {
            if (info.object) openDrawer({ type: 'artist', key: info.object.artist_key, label: info.object.artist_name })
          },
        }),
      ],
    })
  }, [view, atlasData, theme, openDrawer])

  // 2. Sigma.js + Graphology High-Density 2D Co-occurrence Graph
  const sigmaHostRef = useRef<HTMLDivElement | null>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const graphInstanceRef = useRef<any>(null)

  useEffect(() => {
    if (view !== 'graph' || !sigmaHostRef.current || !graphData?.nodes?.length) return

    const graph: any = new Graph()
    for (const n of graphData.nodes) {
      if (!graph.hasNode(n.id)) {
        graph.addNode(n.id, {
          label: n.label,
          x: n.x,
          y: n.y,
          size: n.size,
          color: n.color,
          genre: n.genre,
          plays: n.plays,
          hours: n.hours,
        })
      }
    }
    for (const e of graphData.edges || []) {
      if (graph.hasNode(e.source) && graph.hasNode(e.target) && !graph.hasEdge(e.source, e.target)) {
        graph.addEdge(e.source, e.target, {
          weight: e.weight,
          size: Math.min(3.5, 0.5 + e.weight * 0.2),
          color: theme === 'dark' ? '#2c303a' : '#d2cdc0',
        })
      }
    }

    // Run compact synchronous ForceAtlas2 refinement (60 iterations -> fast & clustered)
    try {
      forceAtlas2.assign(graph, {
        iterations: 55,
        settings: { gravity: 1.2, scalingRatio: 2.2, slowDown: 3, barnesHutOptimize: true },
      })
    } catch {
      /* keep deterministic layout */
    }
    graphInstanceRef.current = graph

    let renderer: Sigma | null = null
    try {
      renderer = new Sigma(graph, sigmaHostRef.current, {
        renderLabels: true,
        labelColor: { color: theme === 'dark' ? '#e0e0e0' : '#1c1c20' },
        labelSize: 11,
        labelDensity: 0.12,
        defaultEdgeColor: theme === 'dark' ? '#2c303a' : '#d2cdc0',
      })
      sigmaRef.current = renderer

      renderer.on('clickNode', ({ node }) => {
        const attrs = graph.getNodeAttributes(node)
        openDrawer({ type: 'artist', key: node, label: attrs.label })
      })
      renderer.on('enterNode', ({ node }) => {
        const attrs = graph.getNodeAttributes(node)
        setSelectedNode({ artist_name: attrs.label, genre: attrs.genre, hours: attrs.hours, plays: attrs.plays })
      })
    } catch {
      /* headless fallback */
    }

    return () => {
      renderer?.kill()
      sigmaRef.current = null
      graphInstanceRef.current = null
    }
  }, [view, graphData, theme, openDrawer])

  // Instant search highlighting inside Sigma.js graph
  useEffect(() => {
    const renderer = sigmaRef.current
    const graph = graphInstanceRef.current
    if (!renderer || !graph) return
    const q = graphQuery.trim().toLowerCase()
    if (!q) {
      renderer.setSetting('nodeReducer', null)
      renderer.setSetting('edgeReducer', null)
      return
    }
    const matching = new Set<string>()
    graph.forEachNode((id: string, attrs: any) => {
      if (String(attrs.label || '').toLowerCase().includes(q) || String(attrs.genre || '').toLowerCase().includes(q)) {
        matching.add(id)
        graph.forEachNeighbor(id, (nb: string) => matching.add(nb))
      }
    })
    renderer.setSetting('nodeReducer', (node, data) => {
      if (matching.has(node)) return { ...data, highlighted: true, zIndex: 2 }
      return { ...data, color: theme === 'dark' ? '#25252c' : '#ded9cc', label: '' }
    })
    renderer.setSetting('edgeReducer', (edge, data) => {
      const [s, t] = graph.extremities(edge)
      if (matching.has(s) && matching.has(t)) return { ...data, color: '#689cd2' }
      return { ...data, hidden: true }
    })
  }, [graphQuery, theme])

  return (
    <div className="space-y-4">
      <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="font-mono-tab text-[10px] uppercase tracking-wider text-[var(--accent)]">
            CARTOGRAPHIE &amp; GRAPHE HAUTE DENSITÉ
          </div>
          <h1 className="font-display text-2xl font-bold text-[var(--text-strong)]">
            {view === 'atlas' ? 'Atlas Mondial des Origines (MapLibre + Deck.gl)' : 'Graphe de Co-occurrence 2D (Sigma.js + Graphology)'}
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView('atlas')}
            data-testid="atlas-tab-map"
            className={`flex items-center gap-1.5 rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-medium ${
              view === 'atlas' ? 'border border-[var(--accent)] bg-[var(--bg-surface-2)] text-[var(--text-strong)]' : 'tactile-btn text-[var(--text-secondary)]'
            }`}
          >
            <Globe2 className="h-3.5 w-3.5" /> Atlas Mondial ({atlasData?.mapped_count ?? 0})
          </button>
          <button
            onClick={() => setView('graph')}
            data-testid="atlas-tab-graph"
            className={`flex items-center gap-1.5 rounded-[var(--radius-card)] px-3 py-1.5 text-xs font-medium ${
              view === 'graph' ? 'border border-[var(--accent)] bg-[var(--bg-surface-2)] text-[var(--text-strong)]' : 'tactile-btn text-[var(--text-secondary)]'
            }`}
          >
            <Network className="h-3.5 w-3.5" /> Graphe 2D ({graphData?.nodes?.length ?? 0} artistes)
          </button>
        </div>
      </div>

      {view === 'atlas' ? (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] lg:col-span-8">
            <div ref={mapHostRef} className="h-[490px] w-full" />
            {selectedNode && (
              <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface-1)] px-3 py-2 text-xs shadow">
                <div className="font-semibold text-[var(--text-strong)]">{selectedNode.artist_name}</div>
                <div className="text-[var(--text-secondary)]">
                  {selectedNode.city ? `${selectedNode.city}, ` : ''}
                  {selectedNode.country_name} · {selectedNode.hours} h ({selectedNode.plays} éc.)
                </div>
              </div>
            )}
          </div>

          <div className="surface-card flex h-[490px] flex-col p-4 lg:col-span-4">
            <h2 className="mb-2 font-mono-tab text-xs font-semibold uppercase text-[var(--text-secondary)]">
              Classement par Pays d&apos;Origine
            </h2>
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {(atlasData?.countries || []).map((c: any) => (
                <div key={c.country_iso} className="surface-card-2 flex items-center justify-between p-2.5 text-xs">
                  <div>
                    <div className="font-semibold text-[var(--text-strong)]">
                      {c.country_iso} · {c.country_name}
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)]">{c.artists} artistes · {c.plays} écoutes</div>
                  </div>
                  <span className="font-mono-tab font-semibold text-[var(--accent)]">{c.hours} h</span>
                </div>
              ))}
            </div>
            <p className="mt-2 border-t border-[var(--border-subtle)] pt-2 text-[11px] text-[var(--text-muted)]">
              Alimenté par MusicBrainz WS/2 (1 req/s) + Wikidata Entity API (maxlag=5) + catalogue initial curaté.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              <input
                type="text"
                value={graphQuery}
                onChange={(e) => setGraphQuery(e.target.value)}
                placeholder="Filtrer un artiste ou cluster de genre..."
                className="w-60 bg-transparent text-xs text-[var(--text-strong)] outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {(graphData?.genres || []).slice(0, 6).map((g: any) => (
                <span key={g.name} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                  {g.name}
                </span>
              ))}
            </div>
          </div>

          <div className="relative h-[500px] w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface-1)]">
            <div ref={sigmaHostRef} className="h-full w-full" />
            {selectedNode && (
              <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface-2)] px-3 py-1.5 text-xs">
                <strong>{selectedNode.artist_name}</strong> · {selectedNode.genre} · {selectedNode.hours} h
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
