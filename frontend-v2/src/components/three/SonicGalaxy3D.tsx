import { Disc3, ExternalLink, Maximize2, Pause, Play, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { apiGet, proxyArtworkUrl } from '../../api/client'
import { reactiveAudio } from '../../audio/reactiveAudio'
import { useApp } from '../../store/AppContext'
import { formatDurationMs, formatNumber } from '../../utils/format'

const GENRE_PALETTE = [
  '#ff2a5f', '#818cf8', '#2dd4bf', '#f59e0b', '#e879f9',
  '#38bdf8', '#fb7185', '#a3e635', '#c084fc', '#fb923c',
]

export function SonicGalaxy3D() {
  const { filters, refreshKey, openDrawer, playPreview, playingTrack, isPlaying } = useApp()
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [galaxyData, setGalaxyData] = useState<any>(null)
  const [hovered, setHovered] = useState<any>(null)
  const [selected, setSelected] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet('/api/analytics/galaxy', filters, { limit: 75 })
      .then((res) => {
        if (!cancelled) {
          setGalaxyData(res)
          if (res.nodes?.[0]) setSelected(res.nodes[0])
        }
      })
      .catch(console.error)
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [filters, refreshKey])

  useEffect(() => {
    const el = mountRef.current
    if (!el || !galaxyData?.nodes?.length) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(52, el.clientWidth / Math.max(1, el.clientHeight), 0.1, 300)
    let radius = 34
    let theta = 0.4
    let phi = 1.18
    let targetTheta = theta
    let targetPhi = phi
    let targetRadius = radius

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.innerHTML = ''
    el.appendChild(renderer.domElement)

    const rootGroup = new THREE.Group()
    scene.add(rootGroup)

    // Genre sector angles
    const genreIndex = new Map<string, number>()
    ;(galaxyData.genres || []).forEach((g: string, i: number) => genreIndex.set(g, i))
    const totalGenres = Math.max(1, genreIndex.size)

    const maxMs = Math.max(...galaxyData.nodes.map((n: any) => n.total_ms || 1), 1)
    const nodePosMap = new Map<string, THREE.Vector3>()
    const interactiveMeshes: THREE.Mesh[] = []
    const texLoader = new THREE.TextureLoader()
    texLoader.setCrossOrigin('anonymous')

    // Create 3D Artist Planets (Circular Artwork Discs + Luminous Genre Ring)
    galaxyData.nodes.forEach((node: any, idx: number) => {
      const gIdx = genreIndex.get(node.genre || 'Autre') ?? 0
      const baseAngle = (gIdx / totalGenres) * Math.PI * 2
      const goldenSpread = idx * 2.39996
      const angle = baseAngle + (Math.sin(goldenSpread) * 0.65)
      // #1 artist closer to center, less-played further out in spiral
      const dist = idx === 0 ? 0 : 4.2 + Math.sqrt(idx) * 2.65
      // Y height encodes release era (older below, newer above)
      const yr = node.avg_year || 2015
      const y = Math.max(-9, Math.min(9, ((yr - 2005) / 22) * 8)) + Math.cos(idx * 1.7) * 1.5
      const pos = new THREE.Vector3(Math.cos(angle) * dist, y, Math.sin(angle) * dist)
      nodePosMap.set(node.artist_group_key, pos)

      const weight = Math.pow((node.total_ms || 1) / maxMs, 0.38)
      const size = 0.85 + weight * 1.95
      const colorHex = GENRE_PALETTE[gIdx % GENRE_PALETTE.length]

      // Circular disc with artwork texture
      const discGeo = new THREE.CircleGeometry(size, 40)
      const discMat = new THREE.MeshBasicMaterial({
        color: node.artwork_url ? 0xffffff : colorHex,
        side: THREE.DoubleSide,
      })

      if (node.artwork_url) {
        const proxied = proxyArtworkUrl(node.artwork_url)
        if (proxied) {
          texLoader.load(proxied, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace
            discMat.map = tex
            discMat.needsUpdate = true
          })
        }
      }

      const disc = new THREE.Mesh(discGeo, discMat)
      disc.position.copy(pos)
      disc.userData = { node, baseScale: 1, colorHex }
      rootGroup.add(disc)
      interactiveMeshes.push(disc)

      // Glowing orbital ring around each artist planet
      const ringGeo = new THREE.RingGeometry(size * 1.06, size * 1.18, 40)
      const ringMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: idx < 5 ? 0.85 : 0.45,
        blending: THREE.AdditiveBlending,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      disc.add(ring)
    })

    // Co-occurrence Filaments (artists listened to in the same sessions!)
    const linePositions: number[] = []
    const lineColors: number[] = []
    const cA = new THREE.Color('#ff2a5f')
    const cB = new THREE.Color('#6366f1')
    ;(galaxyData.edges || []).forEach((e: any) => {
      const p1 = nodePosMap.get(e.source)
      const p2 = nodePosMap.get(e.target)
      if (!p1 || !p2) return
      linePositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z)
      lineColors.push(cA.r, cA.g, cA.b, cB.r, cB.g, cB.b)
    })

    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
    edgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3))
    const edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
    })
    const edgesMesh = new THREE.LineSegments(edgeGeo, edgeMat)
    rootGroup.add(edgesMesh)

    // Deep space background dust
    const starCount = 650
    const starPos = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 110
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 70
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 110
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.45 })
    rootGroup.add(new THREE.Points(starGeo, starMat))

    // Smooth Pointer Orbit + Raycasting
    let dragging = false
    let moved = false
    let prevX = 0
    let prevY = 0
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2(-99, -99)

    const onDown = (e: PointerEvent) => {
      dragging = true
      moved = false
      prevX = e.clientX
      prevY = e.clientY
    }
    const onMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      if (dragging) {
        const dx = e.clientX - prevX
        const dy = e.clientY - prevY
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
        targetTheta -= dx * 0.006
        targetPhi = Math.max(0.25, Math.min(Math.PI - 0.25, targetPhi - dy * 0.006))
        prevX = e.clientX
        prevY = e.clientY
      }
    }
    const onUp = () => {
      if (dragging && !moved) {
        raycaster.setFromCamera(mouse, camera)
        const hits = raycaster.intersectObjects(interactiveMeshes, false)
        if (hits.length > 0) {
          const hitNode = hits[0].object.userData.node
          setSelected(hitNode)
          if (hitNode.preview_url) {
            playPreview({
              song_name: hitNode.sample_song || hitNode.artist_name,
              artist_name: hitNode.artist_name,
              artwork_url: hitNode.artwork_url,
              preview_url: hitNode.preview_url,
            })
          }
        }
      }
      dragging = false
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      targetRadius = Math.max(12, Math.min(62, targetRadius + e.deltaY * 0.025))
    }

    const dom = renderer.domElement
    dom.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    dom.addEventListener('wheel', onWheel, { passive: false })

    const onResize = () => {
      if (!el) return
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight)
      camera.updateProjectionMatrix()
      renderer.setSize(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('resize', onResize)

    let rafId = 0
    let lastHoveredKey: string | null = null

    const animate = () => {
      rafId = requestAnimationFrame(animate)
      const bands = reactiveAudio.getBands()

      if (!dragging) {
        targetTheta += 0.0014 + bands.bass * 0.003
      }
      theta += (targetTheta - theta) * 0.08
      phi += (targetPhi - phi) * 0.08
      radius += (targetRadius - radius) * 0.08

      camera.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
      )
      camera.lookAt(0, 0, 0)

      // Billboard all artwork planets toward camera + audio pulse!
      const pulse = 1 + bands.bass * 0.22
      edgeMat.opacity = 0.16 + bands.mid * 0.45

      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(interactiveMeshes, false)
      const hitObj = hits.length > 0 ? hits[0].object : null
      const hitKey = hitObj ? hitObj.userData.node.artist_group_key : null

      if (hitKey !== lastHoveredKey) {
        lastHoveredKey = hitKey
        setHovered(hitObj ? hitObj.userData.node : null)
        dom.style.cursor = hitObj ? 'pointer' : dragging ? 'grabbing' : 'grab'
      }

      for (const m of interactiveMeshes) {
        m.quaternion.copy(camera.quaternion)
        const isHov = m === hitObj
        const targetS = (isHov ? 1.32 : 1.0) * pulse
        m.scale.lerp(new THREE.Vector3(targetS, targetS, targetS), 0.15)
      }

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      dom.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      dom.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
    }
  }, [galaxyData, playPreview])

  const isSelectedPlaying = Boolean(
    selected?.preview_url && playingTrack?.preview_url === selected.preview_url && isPlaying
  )

  return (
    <div className="relative w-full h-[calc(100vh-145px)] min-h-[560px] rounded-[2rem] overflow-hidden spatial-glass">
      {/* Top Overlay Header */}
      <div className="absolute top-5 left-6 right-6 z-10 flex flex-wrap items-start justify-between gap-4 pointer-events-none">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.08] border border-white/15 text-[11px] font-semibold text-rose-300 backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5" />
            Constellation 3D WebGL · Liens de sessions réels
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white mt-2">
            Votre Galaxie Sonore
          </h2>
          <p className="text-xs text-zinc-400 max-w-md mt-0.5">
            Glissez pour orbiter, molette pour zoomer. Cliquez sur une planète pour lancer son extrait 30s et faire pulser la galaxie au rythme de la musique.
          </p>
        </div>

        {/* Genre Legend Pills */}
        {galaxyData?.genres && (
          <div className="hidden lg:flex flex-wrap gap-1.5 max-w-sm justify-end">
            {galaxyData.genres.slice(0, 7).map((g: string, i: number) => (
              <span
                key={g}
                className="px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-[10px] text-zinc-200 flex items-center gap-1.5"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: GENRE_PALETTE[i % GENRE_PALETTE.length] }}
                />
                {g}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Three.js Canvas Mount */}
      <div ref={mountRef} className="w-full h-full" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-20">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Disc3 className="w-5 h-5 animate-spin text-rose-400" />
            Cartographie de votre constellation 3D…
          </div>
        </div>
      )}

      {/* Hover Tooltip HUD */}
      {hovered && (
        <div className="absolute top-28 left-6 z-20 pointer-events-none spatial-card rounded-2xl px-4 py-3 max-w-xs">
          <p className="text-[10px] uppercase tracking-wider text-rose-300 font-mono-num">
            #{hovered.rank} · {hovered.genre || 'Artiste'}
          </p>
          <p className="text-base font-bold text-white">{hovered.artist_name}</p>
          <p className="text-xs font-mono-num text-zinc-300 mt-0.5">
            {formatDurationMs(hovered.total_ms)} · {formatNumber(hovered.plays)} écoutes
          </p>
          {hovered.preview_url && (
            <p className="text-[10px] text-emerald-300 mt-1">▶ Cliquer pour écouter « {hovered.sample_song} »</p>
          )}
        </div>
      )}

      {/* Selected Artist Spatial Inspector Card (bottom-left) */}
      {selected && (
        <div className="absolute bottom-5 left-5 z-20 spatial-glass rounded-2xl p-4 w-80 max-w-[calc(100%-2.5rem)] flex items-center gap-3.5">
          <div className="relative w-14 h-14 rounded-full overflow-hidden shrink-0 border border-white/20">
            {selected.artwork_url ? (
              <img
                src={selected.artwork_url}
                alt={selected.artist_name}
                className={`w-full h-full object-cover ${isSelectedPlaying ? 'animate-vinyl' : ''}`}
              />
            ) : (
              <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                <Disc3 className="w-6 h-6 text-zinc-400" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-mono-num text-rose-300 uppercase">
              Artiste #{selected.rank} {selected.avg_year ? `· ~${selected.avg_year}` : ''}
            </p>
            <p className="text-sm font-bold text-white truncate">{selected.artist_name}</p>
            <p className="text-[11px] font-mono-num text-zinc-400">
              {formatDurationMs(selected.total_ms, true)} · {formatNumber(selected.plays)}×
            </p>
            <div className="flex items-center gap-2 mt-2">
              {selected.preview_url && (
                <button
                  type="button"
                  onClick={() =>
                    playPreview({
                      song_name: selected.sample_song || selected.artist_name,
                      artist_name: selected.artist_name,
                      artwork_url: selected.artwork_url,
                      preview_url: selected.preview_url,
                    })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white text-black text-[11px] font-bold hover:scale-105 transition-transform cursor-pointer"
                >
                  {isSelectedPlaying ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                  {isSelectedPlaying ? 'Pause' : 'Extrait 30s'}
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  openDrawer({ type: 'artist', id: selected.artist_group_key, title: selected.artist_name })
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium cursor-pointer"
              >
                <Maximize2 className="w-3 h-3" />
                Profil & Bio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
