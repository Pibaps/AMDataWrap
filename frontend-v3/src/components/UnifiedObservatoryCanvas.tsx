import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { reactiveAudio } from '../audio/reactiveAudio'
import { audioTelemetryRef, usePlayerStore } from '../store/playerStore'

export interface RidgelineData {
  weeks: string[]
  series: { name: string; values: number[] }[]
}

export interface VinylItem {
  album_key: string
  album_name: string
  artist_name: string
  artwork_url?: string | null
  back_cover_url?: string | null
  color: string
  plays: number
  hours: number
  genre?: string | null
  release_year?: number | null
}

export interface ConstellationNode {
  id: string
  label: string
  genre: string
  color: string
  plays: number
  hours: number
  x: number
  y: number
}

interface UnifiedObservatoryCanvasProps {
  mode: 'ridgeline' | 'vinyls' | 'constellation'
  theme: 'dark' | 'light'
  calm: boolean
  ridgeline?: RidgelineData
  vinyls?: VinylItem[]
  constellation?: { nodes: ConstellationNode[]; edges: { source: string; target: string; weight: number }[] }
  onSelectArtist?: (artistKey: string, label: string) => void
  onSelectAlbum?: (albumKey: string, label: string) => void
}

const DESAT_PALETTE = [
  '#5d8fc2', '#c8924d', '#5eab8c', '#be7588',
  '#9480c2', '#b8ab54', '#58a3b0', '#c28062',
]

function disposeSceneObjects(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose())
      else mesh.material.dispose()
    }
  })
}

/**
 * Single Persistent 3D Observatory Canvas (Phase 3 · PDF p. 13-14 Guardrails):
 * - Single renderer instance (zero WebGL Context Lost storms)
 * - Strict `frameloop="demand"` (`invalidate()` only on interaction, data change, or active audio)
 * - DPR capped to `Math.min(window.devicePixelRatio, 2)`
 * - InstancedMesh batching keeping `renderer.info.render.calls < 100`
 * - WebGPU capability detection + WebGL2 fallback + `webglcontextlost/restored` + recursive `.dispose()`
 */
export function UnifiedObservatoryCanvas({
  mode,
  theme,
  calm,
  ridgeline,
  vinyls = [],
  constellation,
  onSelectArtist,
  onSelectAlbum,
}: UnifiedObservatoryCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const groupRef = useRef<THREE.Group | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const invalidateRef = useRef<() => void>(() => {})
  const interactablesRef = useRef<{ mesh: THREE.Object3D; kind: string; key: string; label: string; meta?: any }[]>([])
  const [hovered, setHovered] = useState<{ label: string; sub: string } | null>(null)
  const [flippedVinyl, setFlippedVinyl] = useState<string | null>(null)
  const [contextLost, setContextLost] = useState(false)
  const setGpuMetrics = usePlayerStore((s) => s.setGpuMetrics)

  // Orbit spherical state kept completely outside React
  const orbitRef = useRef({ theta: 0.45, phi: 1.08, radius: 18, dragging: false, lastX: 0, lastY: 0 })

  // 1. Mount Single Persistent Renderer once
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let renderer: THREE.WebGLRenderer | null = null
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch {
      setContextLost(true)
      return
    }
    renderer.setPixelRatio(dpr)
    renderer.setSize(host.clientWidth || 800, host.clientHeight || 480)
    host.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
    const rendererLabel = hasWebGpu ? 'WebGPU-ready · WebGL2 (demand)' : 'WebGL2 (demand)'

    const scene = new THREE.Scene()
    sceneRef.current = scene
    const group = new THREE.Group()
    scene.add(group)
    groupRef.current = group

    const camera = new THREE.PerspectiveCamera(46, (host.clientWidth || 800) / Math.max(host.clientHeight || 480, 1), 0.1, 200)
    cameraRef.current = camera

    const amb = new THREE.AmbientLight(0xffffff, 0.85)
    scene.add(amb)
    const dir = new THREE.DirectionalLight(0xffffff, 0.9)
    dir.position.set(10, 18, 12)
    scene.add(dir)

    let pendingFrame = false
    const renderDemand = () => {
      pendingFrame = false
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return
      const o = orbitRef.current
      camera.position.set(
        o.radius * Math.sin(o.phi) * Math.sin(o.theta),
        o.radius * Math.cos(o.phi),
        o.radius * Math.sin(o.phi) * Math.cos(o.theta)
      )
      camera.lookAt(0, 0, 0)

      // Subtle audio reactivity only when playing and not in Mode Calme
      if (audioTelemetryRef.isPlaying && !calm && groupRef.current) {
        const s = 1 + audioTelemetryRef.bass * 0.04
        groupRef.current.scale.set(1, s, 1)
      } else if (groupRef.current) {
        groupRef.current.scale.set(1, 1, 1)
      }

      rendererRef.current.render(sceneRef.current, cameraRef.current)
      setGpuMetrics({
        renderer: rendererLabel,
        drawCalls: rendererRef.current.info.render.calls,
        dpr,
        active: audioTelemetryRef.isPlaying,
      })
    }

    const invalidate = () => {
      if (pendingFrame) return
      pendingFrame = true
      requestAnimationFrame(renderDemand)
    }
    invalidateRef.current = invalidate

    const onContextLost = (e: Event) => {
      e.preventDefault()
      setContextLost(true)
    }
    const onContextRestored = () => {
      setContextLost(false)
      invalidate()
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored)

    const ro = new ResizeObserver(() => {
      if (!host || !rendererRef.current || !cameraRef.current) return
      const w = Math.max(host.clientWidth, 100)
      const h = Math.max(host.clientHeight, 100)
      rendererRef.current.setSize(w, h)
      cameraRef.current.aspect = w / h
      cameraRef.current.updateProjectionMatrix()
      invalidate()
    })
    ro.observe(host)

    // Pointer orbit + raycast picking
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    const onDown = (e: PointerEvent) => {
      orbitRef.current.dragging = true
      orbitRef.current.lastX = e.clientX
      orbitRef.current.lastY = e.clientY
    }
    const onMove = (e: PointerEvent) => {
      const rect = renderer!.domElement.getBoundingClientRect()
      if (orbitRef.current.dragging) {
        const dx = e.clientX - orbitRef.current.lastX
        const dy = e.clientY - orbitRef.current.lastY
        orbitRef.current.lastX = e.clientX
        orbitRef.current.lastY = e.clientY
        orbitRef.current.theta -= dx * 0.008
        orbitRef.current.phi = Math.max(0.25, Math.min(Math.PI - 0.25, orbitRef.current.phi - dy * 0.008))
        invalidate()
        return
      }
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const targets = interactablesRef.current.map((i) => i.mesh)
      const hits = raycaster.intersectObjects(targets, false)
      if (hits.length > 0) {
        const hitObj = hits[0].object
        const found = interactablesRef.current.find((i) => i.mesh === hitObj)
        if (found) {
          if (found.kind === 'instanced_artist' && hits[0].instanceId !== undefined) {
            const node = found.meta?.[hits[0].instanceId] as ConstellationNode | undefined
            if (node) setHovered({ label: node.label, sub: `${node.genre} · ${node.hours} h (${node.plays} écoutes)` })
          } else {
            setHovered({ label: found.label, sub: found.meta?.sub || '' })
          }
          renderer!.domElement.style.cursor = 'pointer'
          return
        }
      }
      setHovered(null)
      renderer!.domElement.style.cursor = 'grab'
    }
    const onUp = () => {
      orbitRef.current.dragging = false
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      orbitRef.current.radius = Math.max(7, Math.min(36, orbitRef.current.radius + e.deltaY * 0.015))
      invalidate()
    }
    const onClick = (e: MouseEvent) => {
      const rect = renderer!.domElement.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const targets = interactablesRef.current.map((i) => i.mesh)
      const hits = raycaster.intersectObjects(targets, false)
      if (hits.length > 0) {
        const found = interactablesRef.current.find((i) => i.mesh === hits[0].object)
        if (!found) return
        if (found.kind === 'instanced_artist' && hits[0].instanceId !== undefined) {
          const node = found.meta?.[hits[0].instanceId] as ConstellationNode | undefined
          if (node) onSelectArtist?.(node.id, node.label)
        } else if (found.kind === 'vinyl') {
          setFlippedVinyl((prev) => (prev === found.key ? null : found.key))
          onSelectAlbum?.(found.key, found.label)
        }
      }
    }

    const dom = renderer.domElement
    dom.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    dom.addEventListener('wheel', onWheel, { passive: false })
    dom.addEventListener('click', onClick)

    const unsubAudio = reactiveAudio.subscribeFrame(() => {
      if (audioTelemetryRef.isPlaying && !calm) invalidate()
    })

    invalidate()

    return () => {
      unsubAudio()
      ro.disconnect()
      dom.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      dom.removeEventListener('wheel', onWheel)
      dom.removeEventListener('click', onClick)
      dom.removeEventListener('webglcontextlost', onContextLost)
      dom.removeEventListener('webglcontextrestored', onContextRestored)
      disposeSceneObjects(scene)
      renderer?.dispose()
      if (dom.parentNode === host) host.removeChild(dom)
      rendererRef.current = null
    }
  }, [calm, setGpuMetrics])

  // 2. Rebuild scene geometry cleanly whenever mode / data / theme / flippedVinyl changes (0 leaks!)
  useEffect(() => {
    const scene = sceneRef.current
    const group = groupRef.current
    if (!scene || !group) return

    scene.background = new THREE.Color(theme === 'dark' ? '#121214' : '#ece8de')
    disposeSceneObjects(group)
    group.clear()
    interactablesRef.current = []

    // Subtle ground grid
    const gridColor = theme === 'dark' ? 0x26262e : 0xcfc9bc
    const grid = new THREE.GridHelper(24, 24, gridColor, gridColor)
    grid.position.y = -3.2
    group.add(grid)

    if (mode === 'ridgeline') {
      // 3D Musical Eras Ridgeline Topography
      const series = ridgeline?.series || []
      const weeksCount = ridgeline?.weeks?.length || 0
      const maxVal = Math.max(0.5, ...series.flatMap((s) => s.values))

      series.slice(0, 8).forEach((s, rowIdx) => {
        const z = (rowIdx - (Math.min(series.length, 8) - 1) / 2) * 1.65
        const color = new THREE.Color(DESAT_PALETTE[rowIdx % DESAT_PALETTE.length])
        const pts: THREE.Vector3[] = []
        const shape = new THREE.Shape()
        const n = Math.max(weeksCount, 2)
        shape.moveTo(-7.5, 0)
        for (let i = 0; i < n; i++) {
          const x = -7.5 + (i / (n - 1)) * 15
          const val = s.values[i] || 0
          const y = 0.15 + (val / maxVal) * 4.4
          pts.push(new THREE.Vector3(x, y - 2.6, z))
          shape.lineTo(x, y)
        }
        shape.lineTo(7.5, 0)
        shape.closePath()

        const geom = new THREE.ShapeGeometry(shape)
        const mat = new THREE.MeshStandardMaterial({
          color,
          transparent: true,
          opacity: 0.42,
          side: THREE.DoubleSide,
          roughness: 0.7,
        })
        const mesh = new THREE.Mesh(geom, mat)
        mesh.position.set(0, -2.6, z)
        group.add(mesh)

        // Glowing top ridge line
        const lineGeom = new THREE.BufferGeometry().setFromPoints(pts)
        const lineMat = new THREE.LineBasicMaterial({ color })
        group.add(new THREE.Line(lineGeom, lineMat))
        interactablesRef.current.push({
          mesh,
          kind: 'ridge',
          key: s.name,
          label: s.name,
          meta: { sub: `Topographie hebdomadaire (${weeksCount} semaines)` },
        })
      })
      orbitRef.current.theta = 0.55
      orbitRef.current.phi = 1.05
      orbitRef.current.radius = 17
    } else if (mode === 'vinyls') {
      // Interactive 3D Vinyl Crate (Front + Flippable Back Cover)
      const items = vinyls.slice(0, 16)
      const sleeveGeom = new THREE.BoxGeometry(2.6, 2.6, 0.08)
      const discGeom = new THREE.CylinderGeometry(1.18, 1.18, 0.03, 32)
      discGeom.rotateX(Math.PI / 2)

      items.forEach((alb, idx) => {
        const col = idx % 4
        const row = Math.floor(idx / 4)
        const x = (col - 1.5) * 3.3
        const z = (row - 1.5) * 2.5
        const isFlipped = flippedVinyl === alb.album_key

        const pivot = new THREE.Group()
        pivot.position.set(x, isFlipped ? 0.6 : -0.8, z)
        pivot.rotation.y = isFlipped ? Math.PI : 0
        pivot.rotation.x = isFlipped ? 0 : -0.18

        const frontMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(alb.color || DESAT_PALETTE[idx % DESAT_PALETTE.length]),
          roughness: 0.55,
          metalness: 0.1,
        })
        const backMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme === 'dark' ? '#25252d' : '#dcd7ca'),
          roughness: 0.75,
        })
        const edgeMat = new THREE.MeshStandardMaterial({ color: 0x383842 })

        const sleeve = new THREE.Mesh(sleeveGeom, [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat])
        pivot.add(sleeve)

        // Peeking black vinyl record
        const discMat = new THREE.MeshStandardMaterial({ color: 0x161618, roughness: 0.35, metalness: 0.45 })
        const disc = new THREE.Mesh(discGeom, discMat)
        disc.position.set(0.55, 0, -0.04)
        pivot.add(disc)

        group.add(pivot)
        interactablesRef.current.push({
          mesh: sleeve,
          kind: 'vinyl',
          key: alb.album_key,
          label: alb.album_name,
          meta: { sub: `${alb.artist_name} · ${alb.hours} h (${alb.plays} écoutes) · Cliquer pour retourner` },
        })
      })
      orbitRef.current.theta = 0.25
      orbitRef.current.phi = 1.02
      orbitRef.current.radius = 16
    } else {
      // Harmonic Constellation 3D using InstancedMesh (< 10 draw calls total!)
      const nodes = (constellation?.nodes || []).slice(0, 120)
      if (nodes.length > 0) {
        const sphereGeom = new THREE.SphereGeometry(0.32, 16, 16)
        const sphereMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.2 })
        const inst = new THREE.InstancedMesh(sphereGeom, sphereMat, nodes.length)
        const dummy = new THREE.Object3D()
        const posById = new Map<string, THREE.Vector3>()
        const maxH = Math.max(1, ...nodes.map((n) => n.hours))

        nodes.forEach((n, i) => {
          const px = n.x * 0.9
          const pz = n.y * 0.9
          const py = ((i % 9) - 4) * 0.55
          const scale = 0.6 + 1.9 * Math.sqrt(n.hours / maxH)
          dummy.position.set(px, py, pz)
          dummy.scale.setScalar(scale)
          dummy.updateMatrix()
          inst.setMatrixAt(i, dummy.matrix)
          inst.setColorAt(i, new THREE.Color(n.color || DESAT_PALETTE[i % DESAT_PALETTE.length]))
          posById.set(n.id, new THREE.Vector3(px, py, pz))
        })
        inst.instanceMatrix.needsUpdate = true
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true
        group.add(inst)

        // Single batched LineSegments for all co-occurrence filaments (1 draw call!)
        const segVerts: number[] = []
        for (const e of (constellation?.edges || []).slice(0, 350)) {
          const a = posById.get(e.source)
          const b = posById.get(e.target)
          if (a && b) {
            segVerts.push(a.x, a.y, a.z, b.x, b.y, b.z)
          }
        }
        if (segVerts.length > 0) {
          const lg = new THREE.BufferGeometry()
          lg.setAttribute('position', new THREE.Float32BufferAttribute(segVerts, 3))
          const lm = new THREE.LineBasicMaterial({
            color: theme === 'dark' ? 0x4b5568 : 0x9fa6b2,
            transparent: true,
            opacity: 0.32,
          })
          group.add(new THREE.LineSegments(lg, lm))
        }

        interactablesRef.current.push({
          mesh: inst,
          kind: 'instanced_artist',
          key: 'constellation',
          label: 'Constellation',
          meta: nodes,
        })
      }
      orbitRef.current.theta = 0.65
      orbitRef.current.phi = 1.15
      orbitRef.current.radius = 20
    }

    invalidateRef.current()
  }, [mode, theme, ridgeline, vinyls, constellation, flippedVinyl])

  if (contextLost) {
    return (
      <div className="surface-card flex h-[480px] flex-col items-center justify-center p-6 text-center">
        <p className="font-mono-tab text-sm text-[var(--text-primary)]">Contexte WebGL indisponible dans ce navigateur.</p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Basculez sur l&apos;Atlas Éditorial ou le Graphe 2D pour continuer l&apos;exploration sans 3D.
        </p>
      </div>
    )
  }

  return (
    <div className="relative h-[480px] w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)]">
      <div ref={hostRef} className="h-full w-full" />
      {hovered && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface-1)] px-3 py-2 text-xs shadow-sm">
          <div className="font-semibold text-[var(--text-strong)]">{hovered.label}</div>
          <div className="text-[var(--text-secondary)]">{hovered.sub}</div>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 right-3 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-1)] px-2.5 py-1 font-mono-tab text-[11px] text-[var(--text-secondary)]">
        Glisser : orbite · Molette : zoom · Cliquer : inspecter
      </div>
    </div>
  )
}
