import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { reactiveAudio } from '../../audio/reactiveAudio'

interface AmbientNebulaCanvasProps {
  colors: [string, string, string]
  intensity?: number
  mode?: 'nebula' | 'tunnel' | 'rings' | 'orb'
  className?: string
}

/**
 * Live WebGL Three.js audio-reactive ambient stage.
 * Adapts to artwork aura colors and pulses with real FFT frequency bands from Web Audio API!
 */
export function AmbientNebulaCanvas({
  colors,
  intensity = 0.75,
  mode = 'nebula',
  className = 'fixed inset-0 z-0 pointer-events-none',
}: AmbientNebulaCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const colorsRef = useRef(colors)
  const modeRef = useRef(mode)

  useEffect(() => {
    colorsRef.current = colors
  }, [colors])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    const el = mountRef.current
    if (!el) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, el.clientWidth / Math.max(1, el.clientHeight), 0.1, 200)
    camera.position.z = 26

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.appendChild(renderer.domElement)

    // 1. Starfield / Sonic Particle Cloud
    const count = 900
    const positions = new Float32Array(count * 3)
    const basePositions = new Float32Array(count * 3)
    const pColors = new Float32Array(count * 3)
    const c1 = new THREE.Color(colorsRef.current[0])
    const c2 = new THREE.Color(colorsRef.current[1])
    const c3 = new THREE.Color(colorsRef.current[2])

    for (let i = 0; i < count; i++) {
      const r = 6 + Math.random() * 28
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const x = r * Math.sin(phi) * Math.cos(theta)
      const y = r * Math.sin(phi) * Math.sin(theta)
      const z = (Math.random() - 0.5) * 44
      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
      basePositions[i * 3] = x
      basePositions[i * 3 + 1] = y
      basePositions[i * 3 + 2] = z

      const pick = i % 3 === 0 ? c1 : i % 3 === 1 ? c2 : c3
      pColors[i * 3] = pick.r
      pColors[i * 3 + 1] = pick.g
      pColors[i * 3 + 2] = pick.b
    }

    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    pGeo.setAttribute('color', new THREE.BufferAttribute(pColors, 3))

    const pMat = new THREE.PointsMaterial({
      size: 0.28,
      vertexColors: true,
      transparent: true,
      opacity: 0.65 * intensity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const particles = new THREE.Points(pGeo, pMat)
    scene.add(particles)

    // 2. Sculptural Audio-Reactive Harmonic Torus & Wireframe Aura Orb
    const ringGroup = new THREE.Group()
    const rings: THREE.Mesh[] = []
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.TorusGeometry(6.5 + i * 3.2, 0.045, 16, 120)
      const mat = new THREE.MeshBasicMaterial({
        color: i === 0 ? c1 : i === 1 ? c2 : c3,
        transparent: true,
        opacity: (0.28 - i * 0.06) * intensity,
        blending: THREE.AdditiveBlending,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = Math.PI * (0.25 + i * 0.18)
      mesh.rotation.y = i * 0.6
      ringGroup.add(mesh)
      rings.push(mesh)
    }
    scene.add(ringGroup)

    // Wireframe Icosahedron Orb (prominent in 'orb' mode, subtle otherwise)
    const orbGeo = new THREE.IcosahedronGeometry(5.5, 3)
    const orbMat = new THREE.MeshBasicMaterial({
      color: c1,
      wireframe: true,
      transparent: true,
      opacity: 0.12 * intensity,
      blending: THREE.AdditiveBlending,
    })
    const orb = new THREE.Mesh(orbGeo, orbMat)
    scene.add(orb)

    let rafId = 0
    const clock = new THREE.Clock()
    const targetC1 = new THREE.Color()
    const targetC2 = new THREE.Color()
    const targetC3 = new THREE.Color()

    const onResize = () => {
      if (!el) return
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight)
      camera.updateProjectionMatrix()
      renderer.setSize(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('resize', onResize)

    const animate = () => {
      rafId = requestAnimationFrame(animate)
      const t = clock.getElapsedTime()
      const bands = reactiveAudio.getBands()
      const bass = bands.bass
      const mid = bands.mid
      const curMode = modeRef.current

      // Smoothly lerp ring & orb colors toward active aura palette
      targetC1.set(colorsRef.current[0])
      targetC2.set(colorsRef.current[1])
      targetC3.set(colorsRef.current[2])
      ;(rings[0].material as THREE.MeshBasicMaterial).color.lerp(targetC1, 0.03)
      ;(rings[1].material as THREE.MeshBasicMaterial).color.lerp(targetC2, 0.03)
      ;(rings[2].material as THREE.MeshBasicMaterial).color.lerp(targetC3, 0.03)
      orbMat.color.lerp(targetC1, 0.03)

      // Particle motion based on mode + live audio
      const posAttr = pGeo.attributes.position as THREE.BufferAttribute
      const arr = posAttr.array as Float32Array
      if (curMode === 'tunnel') {
        for (let i = 0; i < count; i++) {
          let z = arr[i * 3 + 2] + 0.22 + bass * 0.75
          if (z > 24) z = -22
          arr[i * 3 + 2] = z
        }
        posAttr.needsUpdate = true
      } else {
        particles.rotation.y = t * 0.045 + bass * 0.08
        particles.rotation.x = Math.sin(t * 0.12) * 0.15
      }

      // Rings dance to bass & mid frequencies
      const ringScale = 1 + bass * 0.32
      ringGroup.scale.setScalar(ringScale)
      rings.forEach((r, idx) => {
        r.rotation.z = t * (0.12 + idx * 0.05) * (idx % 2 === 0 ? 1 : -1)
        r.rotation.x += 0.002 + mid * 0.015
        ;(r.material as THREE.MeshBasicMaterial).opacity =
          (curMode === 'rings' ? 0.45 : 0.22 - idx * 0.04) * intensity + bass * 0.25
      })

      // Orb breathing
      const orbTargetOpacity = curMode === 'orb' ? 0.34 * intensity : 0.07 * intensity
      orbMat.opacity += (orbTargetOpacity + bass * 0.2 - orbMat.opacity) * 0.08
      const orbScale = (curMode === 'orb' ? 1.15 : 0.85) + bass * 0.35 + Math.sin(t * 1.4) * 0.04
      orb.scale.setScalar(orbScale)
      orb.rotation.y = t * 0.18
      orb.rotation.x = t * 0.11

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      pGeo.dispose()
      pMat.dispose()
      orbGeo.dispose()
      orbMat.dispose()
      rings.forEach((r) => {
        r.geometry.dispose()
        ;(r.material as THREE.Material).dispose()
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === el) {
        el.removeChild(renderer.domElement)
      }
    }
  }, [intensity])

  return <div ref={mountRef} className={className} />
}
