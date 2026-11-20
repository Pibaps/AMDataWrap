/**
 * Persistent Single 3D Canvas — AMDataWrap V4 ("SONIC ODYSSEY × VINYL STUDIO 3D").
 *
 * Key architectural guarantees from PLAN_V4_FINAL.md:
 * - Mounted ONCE at App root: NEVER unmounts on tab/filter/track changes -> ZERO brutal animation resets!
 * - All 60 FPS animations (platter inertia 33⅓/45 RPM, tonearm angle, nebula drift, camera)
 *   live in mutable refs outside React + smooth GSAP interpolated transitions.
 * - Turntable 3D with 3 1-click finishes (Obsidian Glass & Alu, Vintage Walnut, Studio Alu),
 *   NO Hi-Fi stack, transparent hinged dust lid, interactive tonearm seek, Flip A/B animation.
 * - 4 Automatic Graphic Tiers:
 *   Tier 0: CSS 3D / Canvas 2D fallback (no WebGL)
 *   Tier 1: Mobile WebGL2 (DPR <= 1.5, < 60 draw calls, webglcontextlost/restored)
 *   Tier 2: Desktop Rich 3D WebGL2 (DPR <= 2.0, studio reflections)
 *   Tier 3: PC Ultra WebGPU Opt-in (`navigator.gpu` + user toggle, instant WebGL2 fallback)
 * - Automatic energy pause on `document.visibilityState === 'hidden'`.
 */

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { useV4Store } from "../store/useV4Store";
import type { TurntableFinish } from "../api/client";
import { createVinylGroovesTexture } from "./vinylTextures";

const FINISH_MATERIALS: Record<
  TurntableFinish,
  { plinthColor: number; roughness: number; metalness: number; accent: number; trim: number }
> = {
  obsidian: { plinthColor: 0x0c0e17, roughness: 0.16, metalness: 0.45, accent: 0xc0c8d8, trim: 0xec4899 },
  walnut: { plinthColor: 0x4b2e1b, roughness: 0.58, metalness: 0.08, accent: 0xd4af37, trim: 0xf59e0b },
  studio: { plinthColor: 0x9aa4b4, roughness: 0.24, metalness: 0.85, accent: 0x1e293b, trim: 0x06b6d4 },
};

export const PersistentStageCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const activeTab = useV4Store((s) => s.activeTab);
  const vinylStage = useV4Store((s) => s.vinylStage);
  const turntableFinish = useV4Store((s) => s.turntableFinish);
  const rpmMode = useV4Store((s) => s.rpmMode);
  const lidOpen = useV4Store((s) => s.lidOpen);
  const cueLifted = useV4Store((s) => s.cueLifted);
  const activeSideIndex = useV4Store((s) => s.activeSideIndex);
  const selectedVinyl = useV4Store((s) => s.selectedVinyl);
  const nowPlaying = useV4Store((s) => s.nowPlaying);
  const graphicsTier = useV4Store((s) => s.graphicsTier);
  const setDrawCallsCount = useV4Store((s) => s.setDrawCallsCount);
  const setGraphicsTier = useV4Store((s) => s.setGraphicsTier);

  // Mutable animation refs (outside React render cycle -> zero animation resets!)
  const animStateRef = useRef({
    platterVelocity: 0,
    targetVelocity: 0,
    tonearmAngle: 0.05,
    tonearmLift: 0.0,
    isPlaying: false,
    progressRatio: 0,
    showTurntable: true,
  });

  const sceneRefs = useRef<{
    camera?: THREE.PerspectiveCamera;
    turntableGroup?: THREE.Group;
    platterGroup?: THREE.Group;
    discMesh?: THREE.Mesh;
    tonearmPivot?: THREE.Group;
    lidPivot?: THREE.Group;
    plinthMat?: THREE.MeshStandardMaterial;
    trimMat?: THREE.MeshStandardMaterial;
    accentMat?: THREE.MeshStandardMaterial;
  }>({});

  // Sync reactive store -> mutable animation refs + smooth GSAP transitions
  useEffect(() => {
    const isPlaying = Boolean(nowPlaying?.is_playing) && !cueLifted;
    const radPerSec = rpmMode === 45 ? (45 * Math.PI * 2) / 60 : (33.333 * Math.PI * 2) / 60;
    animStateRef.current.isPlaying = isPlaying;
    animStateRef.current.targetVelocity = isPlaying ? radPerSec : 0;
    const dur = Math.max(1, nowPlaying?.duration_ms || 180_000);
    animStateRef.current.progressRatio = Math.min(1, Math.max(0, (nowPlaying?.position_ms || 0) / dur));
  }, [nowPlaying?.is_playing, nowPlaying?.position_ms, nowPlaying?.duration_ms, rpmMode, cueLifted]);

  // Smooth GSAP camera & turntable visibility transitions across tabs / vinyl stages
  useEffect(() => {
    const { camera, turntableGroup } = sceneRefs.current;
    if (!camera || !turntableGroup) return;

    const isStudio = activeTab === "studio";
    animStateRef.current.showTurntable = isStudio;

    if (!isStudio) {
      gsap.to(turntableGroup.position, { y: -3.8, duration: 0.9, ease: "power3.inOut" });
      gsap.to(camera.position, { x: 0, y: 2.2, z: 7.4, duration: 0.9, ease: "power3.inOut" });
      return;
    }

    if (vinylStage === "TURNTABLE_PLAY") {
      gsap.to(turntableGroup.position, { x: 0, y: -0.35, z: 0, duration: 0.9, ease: "power3.out" });
      gsap.to(camera.position, { x: 0.25, y: 3.15, z: 4.55, duration: 0.95, ease: "power3.out" });
    } else if (vinylStage === "DISC_SLIDE_OUT") {
      gsap.to(turntableGroup.position, { x: 0, y: -0.5, z: -0.4, duration: 0.85, ease: "power2.out" });
      gsap.to(camera.position, { x: 0, y: 2.8, z: 5.3, duration: 0.85, ease: "power2.out" });
    } else {
      gsap.to(turntableGroup.position, { x: 0, y: -1.1, z: -1.1, duration: 0.85, ease: "power2.out" });
      gsap.to(camera.position, { x: 0, y: 2.6, z: 6.1, duration: 0.85, ease: "power2.out" });
    }
  }, [activeTab, vinylStage]);

  // Smooth GSAP Finish switching (Obsidian / Walnut / Studio)
  useEffect(() => {
    const { plinthMat, trimMat, accentMat } = sceneRefs.current;
    const cfg = FINISH_MATERIALS[turntableFinish];
    if (plinthMat) {
      const c = new THREE.Color(cfg.plinthColor);
      gsap.to(plinthMat.color, { r: c.r, g: c.g, b: c.b, duration: 0.65, ease: "power2.out" });
      gsap.to(plinthMat, { roughness: cfg.roughness, metalness: cfg.metalness, duration: 0.65 });
    }
    if (trimMat) {
      const c = new THREE.Color(cfg.trim);
      gsap.to(trimMat.color, { r: c.r, g: c.g, b: c.b, duration: 0.55 });
      gsap.to(trimMat.emissive, { r: c.r * 0.4, g: c.g * 0.4, b: c.b * 0.4, duration: 0.55 });
    }
    if (accentMat) {
      const c = new THREE.Color(cfg.accent);
      gsap.to(accentMat.color, { r: c.r, g: c.g, b: c.b, duration: 0.55 });
    }
  }, [turntableFinish]);

  // Smooth GSAP Dust Lid open/close
  useEffect(() => {
    const { lidPivot } = sceneRefs.current;
    if (!lidPivot) return;
    gsap.to(lidPivot.rotation, { x: lidOpen ? -0.78 : 0, duration: 0.7, ease: "power3.inOut" });
  }, [lidOpen]);

  // Smooth GSAP Flip Face A / B animation on the 12" vinyl disc
  useEffect(() => {
    const { discMesh } = sceneRefs.current;
    if (!discMesh) return;
    const side = selectedVinyl?.sides?.[activeSideIndex];
    const tex = createVinylGroovesTexture(side, selectedVinyl?.vinyl_color_hex || "#111114", graphicsTier <= 1 ? 256 : 512);
    const mat = discMesh.material as THREE.MeshStandardMaterial;
    if (mat.map) mat.map.dispose();
    mat.map = tex;
    mat.needsUpdate = true;

    // Physical flip animation in 3D when switching side
    gsap
      .timeline()
      .to(discMesh.position, { y: 0.85, duration: 0.28, ease: "power2.out" })
      .to(discMesh.rotation, { z: discMesh.rotation.z + Math.PI * 2, duration: 0.45, ease: "power2.inOut" }, "<0.05")
      .to(discMesh.position, { y: 0.23, duration: 0.3, ease: "bounce.out" });
  }, [activeSideIndex, selectedVinyl?.album_key, graphicsTier]);

  // Main persistent Three.js setup (runs once per mount / graphicsTier switch)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || graphicsTier === 0) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 2.6, 6.1);
    camera.lookAt(0, -0.2, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: graphicsTier >= 2,
        alpha: true,
        powerPreference: graphicsTier >= 2 ? "high-performance" : "low-power",
      });
    } catch {
      setGraphicsTier(0);
      return;
    }

    const maxDpr = graphicsTier === 1 ? 1.5 : 2.0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

    // Studio Lighting (clean, airy, NO Hi-Fi stack)
    const ambient = new THREE.AmbientLight(0xdbeafe, 0.85);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xfff5eb, 1.8);
    keyLight.position.set(4, 7, 5);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0xec4899, 2.4, 18);
    rimLight.position.set(-4.5, 2.8, -2.5);
    scene.add(rimLight);

    const coolLight = new THREE.PointLight(0x6366f1, 2.2, 18);
    coolLight.position.set(4.2, 2.2, -3);
    scene.add(coolLight);

    // 1. Soft Sonic Odyssey Nebula Particles (1 draw call!)
    const pCount = graphicsTier === 1 ? 260 : 520;
    const pPos = new Float32Array(pCount * 3);
    const pCol = new Float32Array(pCount * 3);
    const c1 = new THREE.Color("#ec4899");
    const c2 = new THREE.Color("#6366f1");
    const c3 = new THREE.Color("#06b6d4");
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 22;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 12;
      pPos[i * 3 + 2] = -3 - Math.random() * 14;
      const pick = i % 3 === 0 ? c1 : i % 3 === 1 ? c2 : c3;
      pCol[i * 3] = pick.r;
      pCol[i * 3 + 1] = pick.g;
      pCol[i * 3 + 2] = pick.b;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
    const pMat = new THREE.PointsMaterial({
      size: 0.08,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const nebulaPoints = new THREE.Points(pGeo, pMat);
    scene.add(nebulaPoints);

    // 2. Iconic 3D Turntable (Standalone — NO Hi-Fi stack, < 18 draw calls total!)
    const turntableGroup = new THREE.Group();
    turntableGroup.position.set(0, -1.1, -1.1);
    scene.add(turntableGroup);

    const fCfg = FINISH_MATERIALS[turntableFinish];
    const plinthMat = new THREE.MeshStandardMaterial({
      color: fCfg.plinthColor,
      roughness: fCfg.roughness,
      metalness: fCfg.metalness,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: fCfg.accent,
      roughness: 0.25,
      metalness: 0.88,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: fCfg.trim,
      emissive: new THREE.Color(fCfg.trim).multiplyScalar(0.4),
      roughness: 0.3,
      metalness: 0.5,
    });

    // Main Plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.34, 3.35), plinthMat);
    turntableGroup.add(plinth);

    // Subtle glowing front trim bar
    const trimBar = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.03, 0.04), trimMat);
    trimBar.position.set(0, -0.02, 1.68);
    turntableGroup.add(trimBar);

    // 4 Isolation Feet (InstancedMesh = 1 draw call)
    const footGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.14, 16);
    const feetInst = new THREE.InstancedMesh(footGeo, accentMat, 4);
    const footCoords: [number, number][] = [
      [-1.75, -1.3],
      [1.75, -1.3],
      [-1.75, 1.3],
      [1.75, 1.3],
    ];
    const dummy = new THREE.Object3D();
    footCoords.forEach(([fx, fz], idx) => {
      dummy.position.set(fx, -0.22, fz);
      dummy.updateMatrix();
      feetInst.setMatrixAt(idx, dummy.matrix);
    });
    turntableGroup.add(feetInst);

    // Aluminum Platter + 12" Vinyl Disc
    const platterGroup = new THREE.Group();
    platterGroup.position.set(-0.48, 0.05, 0.05);
    turntableGroup.add(platterGroup);

    const platterMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.36, 1.39, 0.12, 48), accentMat);
    platterMesh.position.y = 0.15;
    platterGroup.add(platterMesh);

    const discTex = createVinylGroovesTexture(undefined, "#111114", graphicsTier === 1 ? 256 : 512);
    const discMat = new THREE.MeshStandardMaterial({
      map: discTex,
      roughness: 0.28,
      metalness: 0.38,
    });
    const discMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.31, 1.31, 0.03, 48), discMat);
    discMesh.position.y = 0.23;
    platterGroup.add(discMesh);

    // Center Spindle
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 12), accentMat);
    spindle.position.y = 0.27;
    platterGroup.add(spindle);

    // Tonearm Assembly (Pivot + S-shaped tube + Headshell)
    const tonearmPivot = new THREE.Group();
    tonearmPivot.position.set(1.48, 0.32, -0.92);
    turntableGroup.add(tonearmPivot);

    const gimbal = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.22, 20), accentMat);
    tonearmPivot.add(gimbal);

    const armTube = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.95, 12), accentMat);
    armTube.rotation.x = Math.PI / 2;
    armTube.position.set(0, 0.06, 0.92);
    tonearmPivot.add(armTube);

    const headshell = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.28), trimMat);
    headshell.position.set(-0.04, 0.04, 1.92);
    headshell.rotation.y = 0.28;
    tonearmPivot.add(headshell);

    // Integrated Digital Display Bezel on right-front plinth (hosts YouTube IFrame / live telemetry)
    const bezelMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.06, 0.65),
      new THREE.MeshStandardMaterial({ color: 0x05070e, roughness: 0.1, metalness: 0.9 })
    );
    bezelMesh.position.set(1.45, 0.18, 1.12);
    turntableGroup.add(bezelMesh);

    // Transparent Hinged Dust Lid
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.17, -1.66);
    lidPivot.rotation.x = lidOpen ? -0.78 : 0;
    turntableGroup.add(lidPivot);

    const lidMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.13,
      roughness: 0.08,
      metalness: 0.1,
      depthWrite: false,
    });
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(4.24, 0.34, 3.28), lidMat);
    lidMesh.position.set(0, 0.18, 1.64);
    lidPivot.add(lidMesh);

    sceneRefs.current = {
      camera,
      turntableGroup,
      platterGroup,
      discMesh,
      tonearmPivot,
      lidPivot,
      plinthMat,
      trimMat,
      accentMat,
    };

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // 60 FPS animation loop with automatic pause when tab is hidden
    let rafId = 0;
    let lastTime = performance.now();
    let frameCounter = 0;

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      if (document.visibilityState === "hidden") {
        lastTime = now;
        return;
      }
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const st = animStateRef.current;
      // Realistic platter rotational inertia (spin-up & brake)
      st.platterVelocity += (st.targetVelocity - st.platterVelocity) * Math.min(1, dt * 3.2);
      platterGroup.rotation.y -= st.platterVelocity * dt;

      // Smooth tonearm tracking over proportional grooves
      const desiredArmY = st.isPlaying ? 0.34 + st.progressRatio * 0.24 : 0.04;
      const desiredArmX = st.isPlaying ? 0.0 : -0.14;
      tonearmPivot.rotation.y += (desiredArmY - tonearmPivot.rotation.y) * Math.min(1, dt * 4.0);
      tonearmPivot.rotation.x += (desiredArmX - tonearmPivot.rotation.x) * Math.min(1, dt * 5.0);

      // Gentle nebula drift
      nebulaPoints.rotation.y += dt * 0.018;
      nebulaPoints.rotation.x = Math.sin(now * 0.00012) * 0.06;

      camera.lookAt(0, -0.25, 0);
      renderer.render(scene, camera);

      frameCounter++;
      if (frameCounter % 60 === 0) {
        setDrawCallsCount(renderer.info.render.calls);
      }
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      renderer.dispose();
    };
  }, [graphicsTier]);

  if (graphicsTier === 0 || contextLost) {
    return (
      <div
        className="fixed inset-0 -z-10 aura-backdrop pointer-events-none"
        data-testid="tier0-fallback-stage"
      />
    );
  }

  return (
    <div className="fixed inset-0 -z-10 aura-backdrop pointer-events-none">
      <div ref={containerRef} className="w-full h-full" data-testid="persistent-3d-canvas" />
    </div>
  );
};
