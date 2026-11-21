/**
 * Persistent 3D Listening Room ("Salon d'écoute") — AMDataWrap V4.1.
 *
 * V4.1 Extreme Performance & Physical Realism Architecture:
 * 1. 4-Channel Demand-Driven Render Scheduler (`DIRTY_WEBGL`, `DIRTY_CAMERA`, `DIRTY_SHADOW`, `DIRTY_RAYCAST`):
 *    - Auto-sleeping RAF loop (0 Hz / < 2% GPU idle when stopped and camera is still).
 *    - Event-driven `CSS3DRenderer` (0 DOM `matrix3d` writes while the vinyl spins).
 *    - Frozen shadow map (`autoUpdate = false`, updates only on `DIRTY_SHADOW`).
 *    - Zero-GC scratchpads + `three-mesh-bvh` on dense meshes (> 500 tris) + 30 Hz throttled hover raycaster.
 * 2. 1-Draw-Call Vinyl Crate (`InstancedMesh` + GPU-only `DataArrayTexture` 384x384x20, 0 MiB CPU RAM).
 * 3. HD 1024px Zero-RAM Covers for Now-Playing Easel & Inspect + Analytical GLSL Shaders (0 Mo VRAM).
 * 4. Enlarged Turntable Plinth (+20% mechanical spacing, `lidH = 0.68`, zero overlaps).
 * 5. Strict Physical Lock Under Closed Dust Cover (`lidOpen === false`).
 * 6. 3D Physical Disc Flip Animation + Double LP Gatefold Unfolding with 2 Distinct Physical Discs.
 * 7. Offscreen-Visible CSS3D Mount when `!isStudio` so YouTube plays reliably from all 11 analytics tabs.
 */

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CSS3DRenderer, CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import gsap from "gsap";
import {
  API,
  apiGet,
  buildQueryParams,
  formatDurationMs,
  type TurntableFinish,
  type VinylDetail,
} from "../api/client";
import { playbackClock } from "../audio/playbackClock";
import { playTrack } from "../audio/playTrack";
import { vinylFoley } from "../audio/vinylFoley";
import { useV4Store } from "../store/useV4Store";
import {
  GROOVE_INNER_R,
  GROOVE_OUTER_R,
  LABEL_R,
  PLINTH_D,
  PLINTH_W,
  RECORD_R,
  createContactShadowMaterial,
  createCrateCoverArray,
  createCrateInstancedMaterial,
  createEphemeralGatefoldInnerTexture,
  createEphemeralVersoTexture,
  createProceduralPlasterMaterial,
  createProceduralStrobeMaterial,
  createProceduralVinylMaterial,
  createProceduralWalnutMaterial,
  loadZeroRamTexture,
  makeButtonTexture,
  makeDialSideTexture,
  makeFeltTexture,
  makeLabelTexture,
  makeRibTexture,
  makeTopPlateTexture,
  radiusForSideTime,
  regenerateArrayMipmaps,
  uploadCoverToArraySlot,
} from "./textures";

// Patch Three.js prototypes once for targeted BVH acceleration on dense geometries
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// 4-Channel Dirty Flags
const DIRTY_WEBGL = 1 << 0;
const DIRTY_CAMERA = 1 << 1;
const DIRTY_SHADOW = 1 << 2;
const DIRTY_RAYCAST = 1 << 3;

// Enlarged V4.1 Turntable Spatial Constants (Zero Mechanical Overlap)
const PLATTER_X = -0.68;
const PLATTER_Z = -0.05;
const ARM_PIVOT_X = 1.5;
const ARM_PIVOT_Z = -1.38;
const ARM_EFFECTIVE_LEN = 2.48;
const ARM_REST_YAW = -0.02;

const FADER_X = 2.26;
const FADER_Z_TOP = 0.28;
const FADER_Z_BOT = 1.72;

const MAX_CRATE_SLEEVES = 20;
const SLEEVE_SIZE = 2.12;
const SLEEVE_THICK = 0.042;
const CRATE_SORTS = ["top", "recent", "era", "genre", "random"];

const UNDER_LID_ACTIONS = new Set([
  "groove-seek",
  "flip-disc-side",
  "toggle-start",
  "rpm-33",
  "rpm-45",
  "toggle-power",
  "volume-fader",
  "toggle-stylus-light",
]);

function tonearmYawForRadius(r: number): number {
  const dx = PLATTER_X - ARM_PIVOT_X;
  const dz = PLATTER_Z - ARM_PIVOT_Z;
  const d = Math.hypot(dx, dz);
  const cosAlpha = Math.min(
    1,
    Math.max(-1, (d * d + ARM_EFFECTIVE_LEN * ARM_EFFECTIVE_LEN - r * r) / (2 * d * ARM_EFFECTIVE_LEN))
  );
  const alpha = Math.acos(cosAlpha);
  const baseAngle = Math.atan2(dx, dz);
  return baseAngle + alpha * 0.82;
}

function findTrackAtRadius(v: VinylDetail | null, sideIndex: number, r: number): { index: number; track: any } | null {
  if (!v) return null;
  const side = v.sides[sideIndex] || v.sides[0];
  const tracks = side?.tracks || [];
  if (!tracks.length) return null;
  const frac = Math.min(0.999, Math.max(0, (GROOVE_OUTER_R - r) / (GROOVE_OUTER_R - GROOVE_INNER_R)));
  const totalSideMs = Math.max(1, tracks.reduce((a, t) => a + (t.duration_ms || 180_000), 0));
  const targetMs = frac * totalSideMs;
  let acc = 0;
  for (let i = 0; i < tracks.length; i++) {
    const d = tracks[i].duration_ms || 180_000;
    if (targetMs <= acc + d || i === tracks.length - 1) {
      return { index: i, track: tracks[i] };
    }
    acc += d;
  }
  return { index: 0, track: tracks[0] };
}

const FINISH_CONFIG: Record<
  TurntableFinish,
  { topBg: string; topInk: string; plinthHex: number; roughness: number; metalness: number; useWood: boolean }
> = {
  black: {
    topBg: "#151413",
    topInk: "rgba(235, 224, 206, 0.88)",
    plinthHex: 0x171514,
    roughness: 0.36,
    metalness: 0.25,
    useWood: false,
  },
  silver: {
    topBg: "#b8b5ae",
    topInk: "rgba(24, 22, 20, 0.9)",
    plinthHex: 0xc2bfba,
    roughness: 0.24,
    metalness: 0.86,
    useWood: false,
  },
  walnut: {
    topBg: "#4a2c18",
    topInk: "rgba(240, 226, 200, 0.88)",
    plinthHex: 0x59361e,
    roughness: 0.45,
    metalness: 0.08,
    useWood: true,
  },
};

declare global {
  interface Window {
    __AMDW_STATS?: () => Record<string, any>;
  }
}

export const PersistentStageCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const css3dMountRef = useRef<HTMLDivElement | null>(null);
  const plinthScreenDomRef = useRef<HTMLDivElement | null>(null);

  const activeTab = useV4Store((s) => s.activeTab);
  const vinylStage = useV4Store((s) => s.vinylStage);
  const finish = useV4Store((s) => s.finish);
  const rpm = useV4Store((s) => s.rpm);
  const volumePct = useV4Store((s) => s.volumePct);
  const powerOn = useV4Store((s) => s.powerOn);
  const lidOpen = useV4Store((s) => s.lidOpen);
  const lampOn = useV4Store((s) => s.lampOn);
  const stylusLightOn = useV4Store((s) => s.stylusLightOn);
  const crate = useV4Store((s) => s.crate);
  const crateIndex = useV4Store((s) => s.crateIndex);
  const inspected = useV4Store((s) => s.inspected);
  const onPlatter = useV4Store((s) => s.onPlatter);
  const activeSideIndex = useV4Store((s) => s.activeSideIndex);
  const sleeveFlipped = useV4Store((s) => s.sleeveFlipped);
  const discOut = useV4Store((s) => s.discOut);
  const isPlaying = useV4Store((s) => s.isPlaying);
  const motorOn = useV4Store((s) => s.motorOn);
  const crackle = useV4Store((s) => s.crackle);

  const runtimeRef = useRef({
    isStudio: true,
    platterVel: 0,
    targetVel: 0,
    armYaw: ARM_REST_YAW,
    targetArmYaw: ARM_REST_YAW,
    armPitch: -0.09,
    targetArmPitch: -0.09,
    hoveredSlot: -1,
    hoveredCrate: false,
    draggingFader: false,
    isOrbiting: false,
    isFlippingDisc: false,
    lastDetentBucket: -1,
    keysPressed: new Set<string>(),
    crateTilts: new Float32Array(MAX_CRATE_SLEEVES).fill(-0.08),
    crateLifts: new Float32Array(MAX_CRATE_SLEEVES),
    activeTweens: 0,
    dirtyFlags: DIRTY_WEBGL | DIRTY_CAMERA | DIRTY_SHADOW,
    rafActive: false,
    invalidate: (_flags: number) => {},
    triggerDiscFlipAnim: (_nextSideIdx: number, _resumeAfter: boolean) => {},
  });

  const threeRef = useRef<{
    renderer?: THREE.WebGLRenderer;
    css3dRenderer?: CSS3DRenderer;
    scene?: THREE.Scene;
    css3dScene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    controls?: OrbitControls;
    turntableGroup?: THREE.Group;
    platterSpinGroup?: THREE.Group;
    vinylFlipGroup?: THREE.Group;
    vinylShader?: ReturnType<typeof createProceduralVinylMaterial>;
    labelMat?: THREE.MeshStandardMaterial;
    tonearmYawGroup?: THREE.Group;
    tonearmPitchGroup?: THREE.Group;
    lidPivot?: THREE.Group;
    plinthSideMat?: THREE.MeshStandardMaterial;
    plinthWoodMat?: THREE.MeshStandardMaterial;
    plinthTopMat?: THREE.MeshStandardMaterial;
    plinthBody?: THREE.Mesh;
    led33Mat?: THREE.MeshStandardMaterial;
    led45Mat?: THREE.MeshStandardMaterial;
    strobeLightMat?: THREE.MeshStandardMaterial;
    startBtn?: THREE.Mesh;
    btn33?: THREE.Mesh;
    btn45?: THREE.Mesh;
    keySpot?: THREE.SpotLight;
    lampBulbMat?: THREE.MeshBasicMaterial;
    stylusSpot?: THREE.SpotLight;
    stylusLensMat?: THREE.MeshBasicMaterial;
    faderKnob?: THREE.Mesh;
    faderSlot?: THREE.Mesh;
    oledConsoleGroup?: THREE.Group;
    crateInstMesh?: THREE.InstancedMesh;
    crateCoverArray?: THREE.DataArrayTexture;
    inspectGroup?: THREE.Group;
    inspectSleeveGroup?: THREE.Group;
    inspectSleeveMesh?: THREE.Mesh;
    inspectSpineMesh?: THREE.Mesh;
    gatefoldRightInner?: THREE.Mesh;
    inspectLeftWingPivot?: THREE.Group;
    inspectRightWingPivot?: THREE.Group;
    inspectFrontMat?: THREE.MeshStandardMaterial;
    inspectBackMat?: THREE.MeshStandardMaterial;
    inspectInnerLeftMat?: THREE.MeshStandardMaterial;
    inspectInnerRightMat?: THREE.MeshStandardMaterial;
    inspectDisc1Mesh?: THREE.Mesh;
    inspectDisc2Mesh?: THREE.Mesh;
    inspectDisc1LabelMat?: THREE.MeshStandardMaterial;
    inspectDisc2LabelMat?: THREE.MeshStandardMaterial;
    easelFrontMat?: THREE.MeshStandardMaterial;
    interactables: THREE.Object3D[];
  }>({ interactables: [] });

  // 1. Mount persistent Three.js + CSS3D Listening Room scene once
  useEffect(() => {
    const container = containerRef.current;
    const css3dMount = css3dMountRef.current;
    const screenDom = plinthScreenDomRef.current;
    if (!container || !css3dMount || !screenDom) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "default",
      });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    container.replaceChildren(renderer.domElement);

    const css3dRenderer = new CSS3DRenderer();
    css3dRenderer.setSize(width, height);
    css3dRenderer.domElement.style.position = "absolute";
    css3dRenderer.domElement.style.inset = "0";
    css3dRenderer.domElement.style.pointerEvents = "none";
    css3dMount.replaceChildren(css3dRenderer.domElement);

    const scene = new THREE.Scene();
    const css3dScene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0a08);
    scene.fog = new THREE.FogExp2(0x0d0a08, 0.022);

    // PMREM Environment — dispose generator & RoomEnvironment immediately (-3 MiB VRAM)
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envRT = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.78;
    roomEnv.dispose();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 75);
    camera.position.set(0.25, 5.25, 9.75);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.15, 0.6, -0.15);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.maxPolarAngle = Math.PI * 0.485;
    controls.minDistance = 2.6;
    controls.maxDistance = 18.0;
    controls.rotateSpeed = 0.78;
    controls.panSpeed = 0.78;
    controls.zoomSpeed = 0.9;
    controls.update();

    // =========================================================================
    // A. CONSOLIDATED LIGHTING & ANALYTICAL GLSL ARCHITECTURE (0 Mo VRAM)
    // =========================================================================
    const hemi = new THREE.HemisphereLight(0xf6d9b8, 0x1a120d, 0.72);
    scene.add(hemi);

    const keySpot = new THREE.SpotLight(0xffcf96, 44, 28, Math.PI * 0.38, 0.65, 1.25);
    keySpot.position.set(3.8, 5.6, 2.6);
    keySpot.target.position.set(-0.4, 0, -0.1);
    keySpot.castShadow = true;
    keySpot.shadow.mapSize.set(512, 512);
    keySpot.shadow.bias = -0.0005;
    scene.add(keySpot);
    scene.add(keySpot.target);

    // Analytical GLSL Solid Walnut Credenza (0 Mo VRAM)
    const tableMat = createProceduralWalnutMaterial("#56351e", "#26150a", "credenza", {
      roughness: 0.48,
      metalness: 0.06,
      rings: 20,
      scale: 0.28,
    });
    const tableMesh = new THREE.Mesh(new THREE.BoxGeometry(20.0, 0.55, 9.4), tableMat);
    tableMesh.position.set(0.3, -0.34, -0.2);
    tableMesh.receiveShadow = true;
    scene.add(tableMesh);

    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc9a86b, roughness: 0.25, metalness: 0.88 });
    const credenzaTrim = new THREE.Mesh(new THREE.BoxGeometry(20.0, 0.025, 0.03), brassMat);
    credenzaTrim.position.set(0.3, -0.1, 4.5);
    scene.add(credenzaTrim);

    // Analytical GLSL Warm Plaster Back Wall (0 Mo VRAM)
    const wallMat = createProceduralPlasterMaterial();
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(30, 14), wallMat);
    backWall.position.set(0, 4.8, -4.2);
    backWall.receiveShadow = true;
    scene.add(backWall);

    // Acoustic Slat Panel (InstancedMesh, receiveShadow = false)
    const slatGroup = new THREE.Group();
    slatGroup.position.set(-1.1, 3.45, -4.12);
    const slatFrame = new THREE.Mesh(
      new THREE.BoxGeometry(6.8, 2.7, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x17120e, roughness: 0.9 })
    );
    slatGroup.add(slatFrame);
    const slatGeo = new THREE.BoxGeometry(0.11, 2.54, 0.11);
    const slatInst = new THREE.InstancedMesh(slatGeo, tableMat, 32);
    slatInst.receiveShadow = false;
    const _initDummy = new THREE.Object3D();
    for (let i = 0; i < 32; i++) {
      _initDummy.position.set(-2.95 + i * 0.19, 0, 0.04);
      _initDummy.updateMatrix();
      slatInst.setMatrixAt(i, _initDummy.matrix);
    }
    slatGroup.add(slatInst);
    scene.add(slatGroup);

    // Analytical soft contact shadows on credenza
    const contactShadowMat = createContactShadowMaterial(0.45, 4.8);
    const addContactShadow = (x: number, z: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), contactShadowMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, -0.062, z);
      scene.add(m);
    };

    const hitboxMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const makeHitbox = (
      geo: THREE.BufferGeometry,
      x: number,
      y: number,
      z: number,
      userData: Record<string, any>,
      parent: THREE.Object3D = turntableGroup
    ) => {
      const m = new THREE.Mesh(geo, hitboxMat);
      m.position.set(x, y, z);
      m.userData = userData;
      parent.add(m);
      return m;
    };
    addContactShadow(-1.25, 0.15, PLINTH_W + 0.9, PLINTH_D + 0.9);
    addContactShadow(3.95, 0.18, 3.1, 3.6);
    addContactShadow(6.35, -1.85, 1.35, 1.35);

    // Interactive Brass Studio Lamp
    const lampGroup = new THREE.Group();
    lampGroup.position.set(6.35, -0.06, -1.85);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 0.1, 24), brassMat);
    lampBase.position.y = 0.05;
    lampBase.userData = { action: "toggle-lamp", hint: "Lampe d'architecte · Cliquer pour allumer / éteindre" };
    lampGroup.add(lampBase);
    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.05, 12), brassMat);
    lampStem.position.y = 1.58;
    lampStem.userData = lampBase.userData;
    lampGroup.add(lampStem);
    const lampShade = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 0.52, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })
    );
    lampShade.position.set(-0.32, 3.05, 0.2);
    lampShade.rotation.z = 0.42;
    lampShade.userData = lampBase.userData;
    lampGroup.add(lampShade);
    const lampBulbMat = new THREE.MeshBasicMaterial({ color: 0xffe4b5 });
    const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), lampBulbMat);
    lampBulb.position.set(-0.36, 2.92, 0.2);
    lampGroup.add(lampBulb);
    scene.add(lampGroup);

    // =========================================================================
    // B. NOW-PLAYING WOODEN EASEL ("CHEVALET") — HD 1024px ZERO-RAM COVER
    // =========================================================================
    const easelGroup = new THREE.Group();
    easelGroup.position.set(-5.3, -0.06, -0.45);
    easelGroup.rotation.y = 0.36;
    scene.add(easelGroup);

    const easelBase = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.54), tableMat);
    easelBase.position.y = 0.06;
    easelBase.castShadow = true;
    easelGroup.add(easelBase);

    const easelLip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.06), brassMat);
    easelLip.position.set(0, 0.14, 0.22);
    easelGroup.add(easelLip);

    const easelBackSupport = new THREE.Mesh(new THREE.BoxGeometry(1.42, 1.68, 0.07), tableMat);
    easelBackSupport.position.set(0, 0.88, -0.12);
    easelBackSupport.rotation.x = -0.16;
    easelGroup.add(easelBackSupport);

    const easelFrontMat = new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 0.48, metalness: 0.04 });
    const easelCardMat = new THREE.MeshStandardMaterial({ color: 0xd6cab8, roughness: 0.78 });
    const easelBackMat = new THREE.MeshStandardMaterial({ color: 0xcabca6, roughness: 0.68 });
    const easelSleeveMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.96, 1.96, 0.045),
      [easelCardMat, easelCardMat, easelCardMat, easelCardMat, easelFrontMat, easelBackMat]
    );
    easelSleeveMesh.position.set(0, 1.08, 0.05);
    easelSleeveMesh.rotation.x = -0.15;
    easelSleeveMesh.castShadow = true;
    easelSleeveMesh.userData = {
      action: "inspect-platter",
      hint: "Chevalet Now Playing · Cliquer pour soulever la pochette en 3D et voir son verso",
    };
    easelGroup.add(easelSleeveMesh);

    // =========================================================================
    // C. ENLARGED DIRECT-DRIVE TURNTABLE (+20% SPACING, ZERO OVERLAP)
    // =========================================================================
    const turntableGroup = new THREE.Group();
    turntableGroup.position.set(-1.25, -0.06, 0.15);
    scene.add(turntableGroup);

    const plinthWoodMat = createProceduralWalnutMaterial("#633a1f", "#2b160a", "plinth", {
      roughness: 0.45,
      metalness: 0.08,
      rings: 18,
      scale: 0.45,
    });
    const fCfg = FINISH_CONFIG[finish];
    const plinthSideMat = new THREE.MeshStandardMaterial({
      color: fCfg.plinthHex,
      roughness: fCfg.roughness,
      metalness: fCfg.metalness,
    });
    const plinthTopMat = new THREE.MeshStandardMaterial({
      map: makeTopPlateTexture(fCfg.topBg, fCfg.topInk),
      roughness: fCfg.roughness,
      metalness: fCfg.metalness,
    });
    const darkRubberMat = new THREE.MeshStandardMaterial({ color: 0x131211, roughness: 0.78, metalness: 0.08 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe6e4df, roughness: 0.14, metalness: 0.96 });
    const brushedAluMat = new THREE.MeshStandardMaterial({ color: 0xc8c6c0, roughness: 0.26, metalness: 0.88 });
    const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x22201e, roughness: 0.34, metalness: 0.78 });

    const subChassisGeo = new RoundedBoxGeometry(PLINTH_W - 0.08, 0.16, PLINTH_D - 0.08, 3, 0.05);
    (subChassisGeo as any).computeBoundsTree?.();
    const subChassis = new THREE.Mesh(subChassisGeo, darkRubberMat);
    subChassis.position.y = 0.14;
    subChassis.castShadow = true;
    subChassis.receiveShadow = true;
    turntableGroup.add(subChassis);

    const plinthBodyGeo = new RoundedBoxGeometry(PLINTH_W, 0.22, PLINTH_D, 4, 0.045);
    (plinthBodyGeo as any).computeBoundsTree?.();
    const activeSideMat = fCfg.useWood ? plinthWoodMat : plinthSideMat;
    const plinthBody = new THREE.Mesh(plinthBodyGeo, [
      activeSideMat,
      activeSideMat,
      plinthTopMat,
      darkRubberMat,
      activeSideMat,
      activeSideMat,
    ]);
    plinthBody.position.y = 0.29;
    plinthBody.castShadow = true;
    plinthBody.receiveShadow = true;
    turntableGroup.add(plinthBody);

    // 4 Damped Isolation Feet (recalibrated to enlarged plinth)
    const footCoords: [number, number][] = [
      [-PLINTH_W / 2 + 0.45, -PLINTH_D / 2 + 0.42],
      [PLINTH_W / 2 - 0.45, -PLINTH_D / 2 + 0.42],
      [-PLINTH_W / 2 + 0.45, PLINTH_D / 2 - 0.42],
      [PLINTH_W / 2 - 0.45, PLINTH_D / 2 - 0.42],
    ];
    for (const [fx, fz] of footCoords) {
      const footRubber = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.11, 20), darkRubberMat);
      footRubber.position.set(fx, 0.055, fz);
      turntableGroup.add(footRubber);
      const footRing = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.035, 20), brushedAluMat);
      footRing.position.set(fx, 0.11, fz);
      turntableGroup.add(footRing);
    }

    // Platter Well + Rotating Platter (GLSL Strobe & GLSL Vinyl, castShadow = false)
    const platterWell = new THREE.Mesh(
      new THREE.CylinderGeometry(1.66, 1.66, 0.02, 48),
      new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.85 })
    );
    platterWell.position.set(PLATTER_X, 0.402, PLATTER_Z);
    turntableGroup.add(platterWell);

    const platterSpinGroup = new THREE.Group();
    platterSpinGroup.position.set(PLATTER_X, 0.41, PLATTER_Z);
    turntableGroup.add(platterSpinGroup);

    const strobeRimMat = createProceduralStrobeMaterial();
    const platterRim = new THREE.Mesh(new THREE.CylinderGeometry(1.56, 1.63, 0.11, 56, 1, true), strobeRimMat);
    platterRim.position.y = 0.055;
    platterRim.castShadow = false;
    platterRim.receiveShadow = false;
    platterSpinGroup.add(platterRim);

    const platterTop = new THREE.Mesh(new THREE.CylinderGeometry(1.56, 1.56, 0.02, 48), brushedAluMat);
    platterTop.position.y = 0.11;
    platterTop.castShadow = false;
    platterTop.receiveShadow = true;
    platterSpinGroup.add(platterTop);

    const slipmatMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.51, 1.51, 0.014, 48),
      new THREE.MeshStandardMaterial({ map: makeFeltTexture(256), roughness: 0.94, metalness: 0.02 })
    );
    slipmatMesh.position.y = 0.125;
    slipmatMesh.castShadow = false;
    slipmatMesh.receiveShadow = true;
    platterSpinGroup.add(slipmatMesh);

    // Physical Flip Group (record + label) for 180-degree side flip animation!
    const vinylFlipGroup = new THREE.Group();
    vinylFlipGroup.position.y = 0.145;
    platterSpinGroup.add(vinylFlipGroup);

    const vinylShader = createProceduralVinylMaterial("#0e0e10");
    const recordMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(RECORD_R, RECORD_R, 0.022, 56),
      vinylShader.material
    );
    recordMesh.castShadow = false;
    recordMesh.receiveShadow = true;
    recordMesh.userData = {
      action: "groove-seek",
      hint: 'Sillons 12" · Cliquer sur un sillon pour choisir directement la piste',
    };
    vinylFlipGroup.add(recordMesh);

    const labelMat = new THREE.MeshStandardMaterial({
      map: makeLabelTexture(
        {
          album: "Salon d'écoute",
          artist: "AMDataWrap",
          label: "AMDW RECORDS",
          catalog: "SL-1200",
          year: 2026,
          side: "A",
          tracks: [],
        },
        "#d8602b",
        33,
        384
      ),
      roughness: 0.58,
      metalness: 0.04,
      transparent: true,
    });
    const labelMesh = new THREE.Mesh(new THREE.CylinderGeometry(LABEL_R, LABEL_R, 0.026, 40), labelMat);
    labelMesh.position.y = 0.002;
    labelMesh.userData = {
      action: "flip-disc-side",
      hint: "Macaron central · Cliquer pour retourner physiquement le vinyle (Face A ↔ Face B)",
    };
    vinylFlipGroup.add(labelMesh);

    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.24, 16), chromeMat);
    spindle.position.y = 0.21;
    platterSpinGroup.add(spindle);

    const adapter45 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 24), brushedAluMat);
    adapter45.position.set(-2.28, 0.415, -1.26);
    turntableGroup.add(adapter45);

    // =========================================================================
    // PHYSICAL TURNTABLE CONTROLS (CLEARLY SPACED OUTSIDE PLATTER RING)
    // =========================================================================
    const powerTurret = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.15, 20), darkMetalMat);
    powerTurret.position.set(-2.3, 0.46, 1.25);
    powerTurret.userData = {
      action: "toggle-power",
      hint: "Commutateur rotatif POWER · Allumer / couper l'alimentation quartz",
    };
    turntableGroup.add(powerTurret);
    const powerHitbox = makeHitbox(
      new THREE.CylinderGeometry(0.28, 0.28, 0.28, 12),
      -2.3,
      0.5,
      1.25,
      powerTurret.userData
    );

    const strobeLightMat = new THREE.MeshStandardMaterial({
      color: 0xff3b1f,
      emissive: 0xff2a00,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    });
    const strobeWindow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.16), strobeLightMat);
    strobeWindow.position.set(-2.14, 0.45, 1.25);
    turntableGroup.add(strobeWindow);

    const startBezel = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.03, 0.38), brushedAluMat);
    startBezel.position.set(-1.7, 0.41, 1.72);
    turntableGroup.add(startBezel);

    const startBtnMat = new THREE.MeshStandardMaterial({
      map: makeButtonTexture("START · STOP", "#1e1c1a", "#ede2d2"),
      roughness: 0.3,
      metalness: 0.7,
    });
    const startBtn = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.065, 0.32), startBtnMat);
    startBtn.position.set(-1.7, 0.435, 1.72);
    startBtn.userData = {
      action: "toggle-start",
      hint: "Bouton START · STOP · Démarrer ou mettre en pause le vinyle",
    };
    turntableGroup.add(startBtn);

    const btn33 = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.06, 0.22),
      new THREE.MeshStandardMaterial({ map: makeButtonTexture("33", "#262320", "#ede2d2"), roughness: 0.35 })
    );
    btn33.position.set(-1.12, 0.43, 1.76);
    btn33.userData = { action: "rpm-33", hint: "Micro-switch 33⅓ RPM" };
    turntableGroup.add(btn33);
    const btn33Hitbox = makeHitbox(new THREE.BoxGeometry(0.3, 0.2, 0.34), -1.12, 0.48, 1.74, btn33.userData);

    const led33Mat = new THREE.MeshStandardMaterial({
      color: 0xff5a26,
      emissive: 0xff4500,
      emissiveIntensity: 1.6,
    });
    const led33 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.022, 0.04), led33Mat);
    led33.position.set(-1.12, 0.445, 1.62);
    turntableGroup.add(led33);

    const btn45 = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.06, 0.22),
      new THREE.MeshStandardMaterial({ map: makeButtonTexture("45", "#262320", "#ede2d2"), roughness: 0.35 })
    );
    btn45.position.set(-0.82, 0.43, 1.76);
    btn45.userData = { action: "rpm-45", hint: "Micro-switch 45 RPM" };
    turntableGroup.add(btn45);
    const btn45Hitbox = makeHitbox(new THREE.BoxGeometry(0.3, 0.2, 0.34), -0.82, 0.48, 1.74, btn45.userData);

    const led45Mat = new THREE.MeshStandardMaterial({
      color: 0x3a2018,
      emissive: 0xff4500,
      emissiveIntensity: 0.05,
    });
    const led45 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.022, 0.04), led45Mat);
    led45.position.set(-0.82, 0.445, 1.62);
    turntableGroup.add(led45);

    // Pop-up Stylus Target Light (clear of platter & arm)
    const stylusLampTower = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.14, 16), brushedAluMat);
    stylusLampTower.position.set(0.84, 0.45, 1.48);
    stylusLampTower.userData = {
      action: "toggle-stylus-light",
      hint: "Lampe cible du diamant · Allumer / éteindre le faisceau rasant",
    };
    turntableGroup.add(stylusLampTower);
    const stylusLampHitbox = makeHitbox(
      new THREE.CylinderGeometry(0.2, 0.2, 0.28, 10),
      0.84,
      0.5,
      1.48,
      stylusLampTower.userData
    );

    const stylusLensMat = new THREE.MeshBasicMaterial({ color: 0xffdfa8 });
    const stylusLampLens = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 10), stylusLensMat);
    stylusLampLens.position.set(0.8, 0.49, 1.45);
    turntableGroup.add(stylusLampLens);

    const stylusSpot = new THREE.SpotLight(0xffcf87, 5.5, 4.5, Math.PI * 0.25, 0.7, 1.5);
    stylusSpot.position.set(0.8, 0.52, 1.44);
    stylusSpot.target.position.set(PLATTER_X + 0.55, 0.42, PLATTER_Z + 0.25);
    turntableGroup.add(stylusSpot);
    turntableGroup.add(stylusSpot.target);

    // Linear Volume Fader (0–100%) on the far right, completely clear of the resting tonearm!
    const faderSlot = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.025, 1.56),
      new THREE.MeshStandardMaterial({ color: 0x090807, roughness: 0.9 })
    );
    faderSlot.position.set(FADER_X, 0.405, (FADER_Z_TOP + FADER_Z_BOT) / 2);
    faderSlot.userData = {
      action: "volume-fader",
      hint: `Fader VOLUME · GAIN (${useV4Store.getState().volumePct}%) · Cliquer ou glisser`,
    };
    turntableGroup.add(faderSlot);

    const initVolRatio = useV4Store.getState().volumePct / 100;
    const initFaderZ = FADER_Z_BOT - initVolRatio * (FADER_Z_BOT - FADER_Z_TOP);
    const faderKnob = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.2), brushedAluMat);
    faderKnob.position.set(FADER_X, 0.46, initFaderZ);
    faderKnob.userData = faderSlot.userData;
    turntableGroup.add(faderKnob);
    const faderHitbox = makeHitbox(
      new THREE.BoxGeometry(0.48, 0.26, 1.72),
      FADER_X,
      0.48,
      (FADER_Z_TOP + FADER_Z_BOT) / 2,
      faderSlot.userData
    );

    const quartzLed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.02, 12),
      new THREE.MeshStandardMaterial({ color: 0x6ee7b7, emissive: 0x10b981, emissiveIntensity: 1.1 })
    );
    quartzLed.position.set(FADER_X - 0.3, 0.415, (FADER_Z_TOP + FADER_Z_BOT) / 2);
    turntableGroup.add(quartzLed);

    // =========================================================================
    // FIXED 3D CSS3D OLED CONSOLE (FRONT OF ENLARGED PLINTH)
    // =========================================================================
    const oledConsoleGroup = new THREE.Group();
    oledConsoleGroup.position.set(-0.65, -0.06, 0.15 + PLINTH_D / 2 + 0.12);
    oledConsoleGroup.rotation.x = -0.62;
    scene.add(oledConsoleGroup);

    const oledHousing = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.88, 0.08, 3, 0.02), darkMetalMat);
    oledConsoleGroup.add(oledHousing);
    const oledBrassFrame = new THREE.Mesh(new RoundedBoxGeometry(1.36, 0.82, 0.084, 2, 0.015), brassMat);
    oledConsoleGroup.add(oledBrassFrame);

    screenDom.style.backfaceVisibility = "hidden";
    (screenDom.style as any).webkitBackfaceVisibility = "hidden";

    const css3dObject = new CSS3DObject(screenDom);
    css3dObject.scale.set(0.00535, 0.00535, 0.00535);
    css3dObject.position.copy(oledConsoleGroup.position);
    css3dObject.position.z += 0.048 * Math.cos(0.62);
    css3dObject.position.y += 0.048 * Math.sin(0.62);
    css3dObject.rotation.copy(oledConsoleGroup.rotation);
    css3dScene.add(css3dObject);

    // =========================================================================
    // TONEARM ASSEMBLY (BVH ON S-TUBE, CLEAR OF REAR LID WALL & FADER)
    // =========================================================================
    const armBaseRing = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.06, 32), darkMetalMat);
    armBaseRing.position.set(ARM_PIVOT_X, 0.43, ARM_PIVOT_Z);
    turntableGroup.add(armBaseRing);

    const vtaCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.08, 28), brushedAluMat);
    vtaCollar.position.set(ARM_PIVOT_X, 0.48, ARM_PIVOT_Z);
    turntableGroup.add(vtaCollar);

    const dialSideMat = new THREE.MeshStandardMaterial({
      map: makeDialSideTexture(24, 4, true),
      roughness: 0.35,
      metalness: 0.6,
    });
    const antiSkateDial = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.14, 0.11, 20),
      [dialSideMat, darkMetalMat, darkMetalMat]
    );
    antiSkateDial.position.set(ARM_PIVOT_X + 0.58, 0.48, ARM_PIVOT_Z - 0.14);
    turntableGroup.add(antiSkateDial);

    const armRestPost = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.25, 12), darkMetalMat);
    armRestPost.position.set(ARM_PIVOT_X + 0.04, 0.54, ARM_PIVOT_Z + 0.72);
    turntableGroup.add(armRestPost);

    const cueLever = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.32, 10), chromeMat);
    cueLever.position.set(ARM_PIVOT_X + 0.28, 0.58, ARM_PIVOT_Z + 0.48);
    cueLever.rotation.z = -0.35;
    cueLever.userData = { action: "toggle-start", hint: "Levier de Cueing · Poser ou relever le bras de lecture" };
    turntableGroup.add(cueLever);
    const cueLeverHitbox = makeHitbox(
      new THREE.CylinderGeometry(0.16, 0.16, 0.42, 8),
      ARM_PIVOT_X + 0.28,
      0.58,
      ARM_PIVOT_Z + 0.48,
      cueLever.userData
    );

    const tonearmYawGroup = new THREE.Group();
    tonearmYawGroup.position.set(ARM_PIVOT_X, 0.58, ARM_PIVOT_Z);
    tonearmYawGroup.rotation.y = ARM_REST_YAW;
    turntableGroup.add(tonearmYawGroup);

    const gimbalOuter = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.24), brushedAluMat);
    gimbalOuter.position.y = 0.08;
    tonearmYawGroup.add(gimbalOuter);
    const gimbalScrewTop = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12), chromeMat);
    gimbalScrewTop.position.y = 0.26;
    tonearmYawGroup.add(gimbalScrewTop);

    const tonearmPitchGroup = new THREE.Group();
    tonearmPitchGroup.position.y = 0.1;
    tonearmYawGroup.add(tonearmPitchGroup);

    const rearStub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.56, 14), brushedAluMat);
    rearStub.rotation.x = Math.PI / 2;
    rearStub.position.set(0, 0, -0.29);
    tonearmPitchGroup.add(rearStub);

    const cwTextureMat = new THREE.MeshStandardMaterial({
      map: makeDialSideTexture(36, 4, true),
      roughness: 0.3,
      metalness: 0.7,
    });
    const counterweightBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.145, 0.145, 0.24, 24),
      [brushedAluMat, darkMetalMat, darkMetalMat]
    );
    counterweightBody.rotation.x = Math.PI / 2;
    counterweightBody.position.set(0, 0, -0.4);
    tonearmPitchGroup.add(counterweightBody);

    const counterweightScaleRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.148, 0.148, 0.065, 24),
      [cwTextureMat, darkMetalMat, darkMetalMat]
    );
    counterweightScaleRing.rotation.x = Math.PI / 2;
    counterweightScaleRing.position.set(0, 0, -0.27);
    tonearmPitchGroup.add(counterweightScaleRing);

    const sCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, 0.0, 0.0),
      new THREE.Vector3(0.07, 0.0, 0.66),
      new THREE.Vector3(0.1, 0.0, 1.3),
      new THREE.Vector3(-0.03, 0.0, 1.92),
      new THREE.Vector3(-0.16, -0.01, 2.3),
    ]);
    const sTubeGeo = new THREE.TubeGeometry(sCurve, 32, 0.03, 12, false);
    (sTubeGeo as any).computeBoundsTree?.();
    const sTubeMesh = new THREE.Mesh(sTubeGeo, chromeMat);
    sTubeMesh.castShadow = true;
    sTubeMesh.userData = { action: "toggle-start", hint: "Bras en S · Cliquer pour poser ou relever le diamant" };
    tonearmPitchGroup.add(sTubeMesh);

    const lockCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.044, 0.044, 0.08, 14),
      new THREE.MeshStandardMaterial({
        color: 0xd0cec8,
        bumpMap: makeRibTexture(),
        bumpScale: 0.015,
        roughness: 0.25,
        metalness: 0.9,
      })
    );
    lockCollar.rotation.x = Math.PI / 2;
    lockCollar.rotation.z = 0.22;
    lockCollar.position.set(-0.16, -0.01, 2.3);
    tonearmPitchGroup.add(lockCollar);

    const headshellGroup = new THREE.Group();
    headshellGroup.position.set(-0.17, -0.01, 2.34);
    headshellGroup.rotation.y = -0.32;
    tonearmPitchGroup.add(headshellGroup);

    const headshellTop = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.34), darkMetalMat);
    headshellTop.position.set(0, 0.015, 0.15);
    headshellTop.userData = { action: "toggle-start", hint: "Porte-cellule & diamant · Cliquer pour poser / relever" };
    headshellGroup.add(headshellTop);

    const fingerLift = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 8), chromeMat);
    fingerLift.rotation.z = Math.PI / 2.3;
    fingerLift.position.set(0.12, 0.03, 0.18);
    headshellGroup.add(fingerLift);

    const cartridgeBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.085, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xc97b36, roughness: 0.28, metalness: 0.45 })
    );
    cartridgeBody.position.set(0, -0.035, 0.16);
    headshellGroup.add(cartridgeBody);

    const pinColors = [0xef4444, 0xf8fafc, 0x22c55e, 0x3b82f6];
    pinColors.forEach((col, pi) => {
      const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6),
        new THREE.MeshBasicMaterial({ color: col })
      );
      pin.rotation.x = Math.PI / 2;
      pin.position.set(-0.03 + (pi % 2) * 0.06, -0.01 - Math.floor(pi / 2) * 0.03, 0.03);
      headshellGroup.add(pin);
    });

    const cantilever = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.003, 0.08, 8), chromeMat);
    cantilever.rotation.x = Math.PI / 3;
    cantilever.position.set(0, -0.085, 0.22);
    headshellGroup.add(cantilever);

    // =========================================================================
    // RAISED SMOKED-ACRYLIC DUST COVER (`lidH = 0.68`, ZERO OVERLAP)
    // =========================================================================
    const hingeMat = new THREE.MeshStandardMaterial({ color: 0x272422, roughness: 0.4, metalness: 0.8 });
    [-1.75, 1.75].forEach((hx) => {
      const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.1), hingeMat);
      hinge.position.set(hx, 0.4, -PLINTH_D / 2 - 0.02);
      turntableGroup.add(hinge);
    });

    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.42, -PLINTH_D / 2);
    lidPivot.rotation.x = lidOpen ? -0.78 : 0;
    turntableGroup.add(lidPivot);

    const lidW = PLINTH_W - 0.06;
    const lidH = 0.68;
    const lidD = PLINTH_D - 0.06;
    const lidT = 0.022;

    const acrylicMat = new THREE.MeshStandardMaterial({
      color: 0xf4e8d1,
      transparent: true,
      opacity: 0.09,
      roughness: 0.08,
      metalness: 0.15,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const lidTopPanel = new THREE.Mesh(new THREE.BoxGeometry(lidW, lidT, lidD), acrylicMat);
    lidTopPanel.position.set(0, lidH, lidD / 2);
    lidTopPanel.userData = {
      action: "lid-body",
      hint: "Capot acrylique · Cliquer sur la poignée chromée pour ouvrir / fermer",
    };
    lidPivot.add(lidTopPanel);

    const lidFrontPanel = new THREE.Mesh(new THREE.BoxGeometry(lidW, lidH, lidT), acrylicMat);
    lidFrontPanel.position.set(0, lidH / 2, lidD);
    lidFrontPanel.userData = lidTopPanel.userData;
    lidPivot.add(lidFrontPanel);

    const lidEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(lidW, lidH, lidD)),
      new THREE.LineBasicMaterial({ color: 0xf5e8cf, transparent: true, opacity: 0.3 })
    );
    lidEdges.position.set(0, lidH / 2, lidD / 2);
    lidPivot.add(lidEdges);

    const lidHandle = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.1), chromeMat);
    lidHandle.position.set(0, 0.07, lidD + 0.03);
    lidHandle.userData = {
      action: "toggle-lid",
      hint: "Poignée du capot · Cliquer pour ouvrir ou fermer le capot antipoussière",
    };
    lidPivot.add(lidHandle);
    const lidHandleHitbox = makeHitbox(
      new THREE.BoxGeometry(1.75, 0.4, 0.38),
      0,
      0.08,
      lidD + 0.04,
      lidHandle.userData,
      lidPivot
    );

    // =========================================================================
    // D. 1-DRAW-CALL OAK VINYL CRATE (`InstancedMesh` + `DataArrayTexture` 384px)
    // =========================================================================
    const crateGroup = new THREE.Group();
    crateGroup.position.set(3.95, -0.06, 0.18);
    crateGroup.rotation.y = -0.22;
    scene.add(crateGroup);

    const oakMat = createProceduralWalnutMaterial("#8b5a2b", "#472a12", "oak-crate", {
      roughness: 0.55,
      metalness: 0.05,
      rings: 16,
      scale: 0.42,
    });

    const CRATE_W = 2.48;
    const CRATE_H = 1.42;
    const CRATE_D = 3.05;
    const WALL_T = 0.09;

    const crateBottom = new THREE.Mesh(new THREE.BoxGeometry(CRATE_W, WALL_T, CRATE_D), oakMat);
    crateBottom.position.y = WALL_T / 2;
    crateBottom.castShadow = true;
    crateBottom.receiveShadow = true;
    crateBottom.userData = {
      action: "return-to-crate",
      hint: "Bac en chêne · Cliquer pour ranger la pochette inspectée",
    };
    crateGroup.add(crateBottom);

    const crateFront = new THREE.Mesh(new THREE.BoxGeometry(CRATE_W, CRATE_H * 0.65, WALL_T), oakMat);
    crateFront.position.set(0, (CRATE_H * 0.65) / 2, CRATE_D / 2 - WALL_T / 2);
    crateFront.castShadow = true;
    crateFront.userData = crateBottom.userData;
    crateGroup.add(crateFront);

    const crateBack = new THREE.Mesh(new THREE.BoxGeometry(CRATE_W, CRATE_H, WALL_T), oakMat);
    crateBack.position.set(0, CRATE_H / 2, -CRATE_D / 2 + WALL_T / 2);
    crateBack.castShadow = true;
    crateBack.userData = crateBottom.userData;
    crateGroup.add(crateBack);

    [-CRATE_W / 2 + WALL_T / 2, CRATE_W / 2 - WALL_T / 2].forEach((sx) => {
      for (let si = 0; si < 3; si++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, 0.35, CRATE_D - WALL_T * 2), oakMat);
        slat.position.set(sx, 0.25 + si * 0.42, 0);
        slat.castShadow = true;
        slat.userData = crateBottom.userData;
        crateGroup.add(slat);
      }
    });

    const cratePlate = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.25, 0.025), brassMat);
    cratePlate.position.set(0, 0.48, CRATE_D / 2 + 0.008);
    cratePlate.userData = {
      action: "cycle-crate-sort",
      hint: "Plaque en laiton · Cliquer pour trier le bac (Top / Récents / Décennie / Genre / Aléatoire)",
    };
    crateGroup.add(cratePlate);
    const crateLabelInner = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 0.18, 0.028),
      new THREE.MeshStandardMaterial({ map: makeButtonTexture("BAC  LP  33⅓", "#1a1410", "#e9dec9"), roughness: 0.5 })
    );
    crateLabelInner.position.set(0, 0.48, CRATE_D / 2 + 0.01);
    crateLabelInner.userData = cratePlate.userData;
    crateGroup.add(crateLabelInner);

    // 1 single InstancedMesh for all 20 vinyl sleeves (1 draw call instead of 120!)
    const crateCoverArray = createCrateCoverArray(renderer, MAX_CRATE_SLEEVES, 384);
    const crateInstMat = createCrateInstancedMaterial(crateCoverArray);
    const sleeveGeo = new THREE.BoxGeometry(SLEEVE_SIZE, SLEEVE_SIZE, SLEEVE_THICK);
    const slotIndices = new Float32Array(MAX_CRATE_SLEEVES);
    for (let i = 0; i < MAX_CRATE_SLEEVES; i++) slotIndices[i] = i;
    sleeveGeo.setAttribute("aSlotIndex", new THREE.InstancedBufferAttribute(slotIndices, 1));

    const crateInstMesh = new THREE.InstancedMesh(sleeveGeo, crateInstMat, MAX_CRATE_SLEEVES);
    crateInstMesh.castShadow = false;
    crateInstMesh.receiveShadow = false;
    crateInstMesh.frustumCulled = false;
    crateInstMesh.userData = {
      action: "crate-sleeve",
      hint: 'Pochette LP 12" · Cliquer pour la sortir du bac (molette pour feuilleter)',
    };
    crateGroup.add(crateInstMesh);

    // =========================================================================
    // E. 3D FLOATING SLEEVE INSPECTOR + DOUBLE LP GATEFOLD (2 DISCS!)
    // =========================================================================
    const inspectGroup = new THREE.Group();
    inspectGroup.position.set(0.3, 2.05, 2.65);
    inspectGroup.rotation.x = -0.2;
    inspectGroup.visible = false;
    scene.add(inspectGroup);

    const inspectSleeveGroup = new THREE.Group();
    inspectGroup.add(inspectSleeveGroup);

    const cardEdgeMat = new THREE.MeshStandardMaterial({ color: 0xd8ccb8, roughness: 0.82 });
    const inspectFrontMat = new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 0.42, metalness: 0.04 });
    const inspectBackMat = new THREE.MeshStandardMaterial({ color: 0xe2d8c5, roughness: 0.55, metalness: 0.03 });
    const inspectInnerLeftMat = new THREE.MeshStandardMaterial({ color: 0x19130f, roughness: 0.6 });
    const inspectInnerRightMat = new THREE.MeshStandardMaterial({ color: 0x19130f, roughness: 0.6 });

    // Central Gatefold Spine (joins left & right wings seamlessly into ONE unfolding jacket)
    const inspectSpineMesh = new THREE.Mesh(new THREE.BoxGeometry(0.065, 2.15, 0.062), cardEdgeMat);
    inspectSpineMesh.position.set(0, 0, 0);
    inspectSpineMesh.visible = false;
    inspectSleeveGroup.add(inspectSpineMesh);

    // Right Wing (centered at x=0 for single LP; hinged at central spine x=0 with mesh at x=+1.075 for Double LP Gatefold)
    const inspectRightWingPivot = new THREE.Group();
    inspectSleeveGroup.add(inspectRightWingPivot);

    const inspectSleeveMesh = new THREE.Mesh(new THREE.BoxGeometry(2.15, 2.15, 0.055), [
      cardEdgeMat,
      cardEdgeMat,
      cardEdgeMat,
      cardEdgeMat,
      inspectFrontMat,
      inspectBackMat,
    ]);
    inspectSleeveMesh.castShadow = true;
    inspectSleeveMesh.userData = {
      action: "flip-inspect-sleeve",
      hint: 'Pochette 12" · Cliquer pour retourner (Recto ↔ Verso tracklist) · Cliquer sur le bac pour ranger',
    };
    inspectRightWingPivot.add(inspectSleeveMesh);

    // Left Gatefold Wing (hinged right at the central spine x=0, unfolds like a single book for Double LP!)
    const inspectLeftWingPivot = new THREE.Group();
    inspectLeftWingPivot.position.set(0, 0, 0);
    inspectLeftWingPivot.visible = false;
    inspectSleeveGroup.add(inspectLeftWingPivot);

    const gatefoldLeftMesh = new THREE.Mesh(new THREE.BoxGeometry(2.15, 2.15, 0.048), [
      cardEdgeMat,
      cardEdgeMat,
      cardEdgeMat,
      cardEdgeMat,
      inspectInnerLeftMat,
      inspectFrontMat,
    ]);
    gatefoldLeftMesh.position.set(-1.075, 0, 0);
    gatefoldLeftMesh.castShadow = true;
    gatefoldLeftMesh.userData = {
      action: "flip-inspect-sleeve",
      hint: "Pochette Gatefold 2×LP · Volet gauche (LP 1 · Faces A/B) · Cliquer pour retourner",
    };
    inspectLeftWingPivot.add(gatefoldLeftMesh);

    // Right Gatefold inner panel overlay (shown on inner face of right wing when Double LP Gatefold is unfolded)
    const gatefoldRightInner = new THREE.Mesh(new THREE.PlaneGeometry(2.11, 2.11), inspectInnerRightMat);
    gatefoldRightInner.position.set(1.075, 0, 0.03);
    gatefoldRightInner.visible = false;
    gatefoldRightInner.userData = {
      action: "flip-inspect-sleeve",
      hint: "Pochette Gatefold 2×LP · Volet droit (LP 2 · Faces C/D) · Cliquer pour retourner",
    };
    inspectRightWingPivot.add(gatefoldRightInner);

    // Disc 1 (LP 1 · Faces A/B — slides out of right edge for single LP, or left pocket of unfolded Gatefold for 2×LP)
    const inspectDisc1Mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.01, 1.01, 0.016, 48), vinylShader.material);
    inspectDisc1Mesh.rotation.x = Math.PI / 2;
    inspectDisc1Mesh.castShadow = false;
    inspectDisc1Mesh.userData = {
      action: "place-on-platter",
      discIndex: 0,
      hint: 'Disque 1 (LP 1 · Faces A/B) · Cliquer pour poser sur la platine et lancer la Face A',
    };
    inspectRightWingPivot.add(inspectDisc1Mesh);

    const inspectDisc1LabelMat = new THREE.MeshStandardMaterial({ map: labelMat.map, roughness: 0.55, transparent: true });
    inspectDisc1Mesh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.019, 32), inspectDisc1LabelMat));

    // Disc 2 (LP 2 · Faces C/D — slides out of right pocket of unfolded Gatefold for Double LPs!)
    const inspectDisc2Mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.01, 1.01, 0.016, 48), vinylShader.material);
    inspectDisc2Mesh.rotation.x = Math.PI / 2;
    inspectDisc2Mesh.position.set(1.075, 0, -0.004);
    inspectDisc2Mesh.visible = false;
    inspectDisc2Mesh.castShadow = false;
    inspectDisc2Mesh.userData = {
      action: "place-on-platter",
      discIndex: 1,
      hint: 'Disque 2 (LP 2 · Faces C/D) · Cliquer pour poser le 2ᵉ disque sur la platine et lancer la Face C',
    };
    inspectRightWingPivot.add(inspectDisc2Mesh);

    const inspectDisc2LabelMat = new THREE.MeshStandardMaterial({ map: labelMat.map, roughness: 0.55, transparent: true });
    inspectDisc2Mesh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.019, 32), inspectDisc2LabelMat));

    const interactables: THREE.Object3D[] = [
      startBtn,
      powerTurret,
      powerHitbox,
      btn33,
      btn33Hitbox,
      btn45,
      btn45Hitbox,
      recordMesh,
      labelMesh,
      easelSleeveMesh,
      lidHandle,
      lidHandleHitbox,
      lidTopPanel,
      lidFrontPanel,
      lampBase,
      lampStem,
      lampShade,
      stylusLampTower,
      stylusLampHitbox,
      faderSlot,
      faderKnob,
      faderHitbox,
      cueLever,
      cueLeverHitbox,
      sTubeMesh,
      headshellTop,
      cratePlate,
      crateLabelInner,
      crateFront,
      crateBack,
      crateInstMesh,
      inspectSleeveMesh,
      gatefoldLeftMesh,
      gatefoldRightInner,
      inspectDisc1Mesh,
      inspectDisc2Mesh,
    ];

    threeRef.current = {
      renderer,
      css3dRenderer,
      scene,
      css3dScene,
      camera,
      controls,
      turntableGroup,
      platterSpinGroup,
      vinylFlipGroup,
      vinylShader,
      labelMat,
      tonearmYawGroup,
      tonearmPitchGroup,
      lidPivot,
      plinthSideMat,
      plinthWoodMat,
      plinthTopMat,
      plinthBody,
      led33Mat,
      led45Mat,
      strobeLightMat,
      startBtn,
      btn33,
      btn45,
      keySpot,
      lampBulbMat,
      stylusSpot,
      stylusLensMat,
      faderKnob,
      faderSlot,
      oledConsoleGroup,
      crateInstMesh,
      crateCoverArray,
      inspectGroup,
      inspectSleeveGroup,
      inspectSleeveMesh,
      inspectSpineMesh,
      gatefoldRightInner,
      inspectLeftWingPivot,
      inspectRightWingPivot,
      inspectFrontMat,
      inspectBackMat,
      inspectInnerLeftMat,
      inspectInnerRightMat,
      inspectDisc1Mesh,
      inspectDisc2Mesh,
      inspectDisc1LabelMat,
      inspectDisc2LabelMat,
      easelFrontMat,
      interactables,
    };

    // Async shader precompilation (deferred slightly so React StrictMode unmount doesn't race with dispose())
    let isDisposed = false;
    const compileTimer = window.setTimeout(() => {
      if (!isDisposed) {
        renderer.compileAsync?.(scene, camera).catch(() => {});
      }
    }, 120);

    // =========================================================================
    // F. 4-CHANNEL DEMAND-DRIVEN SCHEDULER & ZERO-GC SCRATCHPADS
    // =========================================================================
    runtimeRef.current.rafActive = false;
    runtimeRef.current.activeTweens = 0;
    let rafId = 0;
    let lastTime = performance.now();
    const _pointerNdc = new THREE.Vector2();
    const _raycaster = new THREE.Raycaster();
    const _hits: THREE.Intersection[] = [];
    const _forwardVec = new THREE.Vector3();
    const _rightVec = new THREE.Vector3();
    const _moveVec = new THREE.Vector3();
    const _screenNormal = new THREE.Vector3();
    const _camToScreen = new THREE.Vector3();
    const _screenWorldPos = new THREE.Vector3();
    const _localPt = new THREE.Vector3();
    const _dummy = new THREE.Object3D();
    const _lastCamMatrix = new Float32Array(16);
    const _interactiveClusterSphere = new THREE.Sphere(new THREE.Vector3(0.4, 1.2, 0.3), 10.5);

    const scheduleFrame = () => {
      if (runtimeRef.current.rafActive) return;
      if (!runtimeRef.current.isStudio || document.visibilityState === "hidden") return;
      runtimeRef.current.rafActive = true;
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    };

    const invalidate = (flags: number) => {
      runtimeRef.current.dirtyFlags |= flags;
      scheduleFrame();
    };
    runtimeRef.current.invalidate = invalidate;

    // Physical 3D Disc Flip Animation on Platter (lift -> 180 deg flip -> settle)
    runtimeRef.current.triggerDiscFlipAnim = (nextSideIdx: number, resumeAfter: boolean) => {
      const rt = runtimeRef.current;
      if (rt.isFlippingDisc) return;
      rt.isFlippingDisc = true;
      rt.activeTweens++;
      const st = useV4Store.getState();
      if (st.isPlaying) {
        st.setIsPlaying(false);
        st.setMotorOn(false);
      }
      vinylFoley.playSleeveSlide(st.soundFx);

      const tl = gsap.timeline({
        onUpdate: () => invalidate(DIRTY_WEBGL | DIRTY_SHADOW),
        onComplete: () => {
          rt.isFlippingDisc = false;
          rt.activeTweens = Math.max(0, rt.activeTweens - 1);
          vinylFlipGroup.rotation.z = 0;
          vinylFlipGroup.position.y = 0.145;
          invalidate(DIRTY_WEBGL | DIRTY_SHADOW);
          if (resumeAfter) {
            const curSt = useV4Store.getState();
            const nextSide = curSt.onPlatter?.sides[nextSideIdx];
            const firstTrack = nextSide?.tracks?.[0];
            if (curSt.onPlatter && firstTrack) {
              vinylFoley.playNeedleDrop(curSt.soundFx);
              curSt.setMotorOn(true);
              playTrack({
                song_name: firstTrack.title,
                artist_name: curSt.onPlatter.artist_name,
                album_name: curSt.onPlatter.album_name,
                artwork_url: curSt.onPlatter.artwork_url,
                track_key: firstTrack.track_key,
                preview_url: firstTrack.preview_url,
                duration_ms: firstTrack.duration_ms,
                vinyl: { album_key: curSt.onPlatter.album_key, sideIndex: nextSideIdx, trackIndex: 0 },
              });
            }
          }
        },
      });
      tl.to(vinylFlipGroup.position, { y: 0.72, duration: 0.24, ease: "power2.out" })
        .to(
          vinylFlipGroup.rotation,
          {
            z: Math.PI,
            duration: 0.34,
            ease: "power2.inOut",
            onComplete: () => {
              useV4Store.getState().setActiveSideIndex(nextSideIdx);
            },
          },
          "-=0.06"
        )
        .to(vinylFlipGroup.position, {
          y: 0.145,
          duration: 0.22,
          ease: "bounce.out",
          onStart: () => vinylFoley.playRecordPlace(useV4Store.getState().soundFx),
        });
    };

    // OrbitControls events (PDF p. 4 trap: zoom wheel triggers 'change' even when controls.update() returns false!)
    controls.addEventListener("start", () => {
      runtimeRef.current.isOrbiting = true;
      invalidate(DIRTY_WEBGL | DIRTY_CAMERA);
    });
    controls.addEventListener("change", () => {
      invalidate(DIRTY_WEBGL | DIRTY_CAMERA);
    });
    controls.addEventListener("end", () => {
      runtimeRef.current.isOrbiting = false;
      invalidate(DIRTY_WEBGL | DIRTY_CAMERA);
    });

    // Helper: update 20-slot crate InstancedMesh transforms; returns true if any slot is still animating
    const updateCrateInstances = (dt: number): boolean => {
      const st = useV4Store.getState();
      const rt = runtimeRef.current;
      const focusedIdx = st.crateIndex;
      const totalVisible = Math.min(st.crate.length, MAX_CRATE_SLEEVES);
      const platterKey = st.onPlatter?.album_key;
      const inspectedKey = st.vinylStage === "INSPECT" ? st.inspected?.album_key : null;
      let moving = false;

      for (let i = 0; i < MAX_CRATE_SLEEVES; i++) {
        const slotAlbumKey = st.crate[i]?.album_key;
        const hidden =
          i >= totalVisible || Boolean(slotAlbumKey && (slotAlbumKey === platterKey || slotAlbumKey === inspectedKey));
        if (hidden) {
          _dummy.position.set(0, -50, 0);
          _dummy.scale.set(0.0001, 0.0001, 0.0001);
          _dummy.rotation.set(0, 0, 0);
          _dummy.updateMatrix();
          crateInstMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }

        let targetTilt = -0.08;
        let targetLift = 0.0;
        if (i < focusedIdx) {
          targetTilt = 0.26 - Math.min(0.08, (focusedIdx - 1 - i) * 0.01);
        } else if (i === focusedIdx) {
          targetTilt = 0.0;
          targetLift = 0.22;
        }
        if (rt.hoveredSlot === i && i >= focusedIdx) {
          targetLift += 0.14;
        }

        const prevTilt = rt.crateTilts[i];
        const prevLift = rt.crateLifts[i];
        const nextTilt = prevTilt + (targetTilt - prevTilt) * Math.min(1, dt * 11);
        const nextLift = prevLift + (targetLift - prevLift) * Math.min(1, dt * 12);
        rt.crateTilts[i] = nextTilt;
        rt.crateLifts[i] = nextLift;
        if (Math.abs(targetTilt - nextTilt) > 0.001 || Math.abs(targetLift - nextLift) > 0.001) {
          moving = true;
        }

        const zPos = 0.72 - i * 0.092;
        const xJitter = (Math.sin(i * 2.1) - 0.5) * 0.02;
        const pivotY = 0.1;
        const localY = SLEEVE_SIZE / 2 + nextLift;
        // Rotate around pivot at bottom of sleeve
        _dummy.position.set(
          xJitter,
          pivotY + Math.cos(nextTilt) * localY,
          zPos + Math.sin(nextTilt) * localY
        );
        _dummy.rotation.set(nextTilt, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        crateInstMesh.setMatrixAt(i, _dummy.matrix);
      }
      crateInstMesh.instanceMatrix.needsUpdate = true;
      crateInstMesh.computeBoundingSphere();
      return moving;
    };

    // Main Demand-Driven Tick (Auto-Sleeps to 0 Hz when idle!)
    const tick = (now: number) => {
      runtimeRef.current.rafActive = false;
      if (!runtimeRef.current.isStudio || document.visibilityState === "hidden") return;

      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      const rt = runtimeRef.current;
      let keepAlive = false;

      // 1. Free-Cam WASD / ZQSD keyboard flight
      if (rt.keysPressed.size > 0) {
        camera.getWorldDirection(_forwardVec);
        _forwardVec.y = 0;
        _forwardVec.normalize();
        _rightVec.crossVectors(_forwardVec, camera.up).normalize();
        _moveVec.set(0, 0, 0);
        const speed = 4.5 * dt;
        if (rt.keysPressed.has("w") || rt.keysPressed.has("z")) _moveVec.addScaledVector(_forwardVec, speed);
        if (rt.keysPressed.has("s")) _moveVec.addScaledVector(_forwardVec, -speed);
        if (rt.keysPressed.has("d")) _moveVec.addScaledVector(_rightVec, speed);
        if (rt.keysPressed.has("a") || rt.keysPressed.has("q")) _moveVec.addScaledVector(_rightVec, -speed);
        if (rt.keysPressed.has("e")) _moveVec.y += speed * 0.7;
        if (rt.keysPressed.has("c")) _moveVec.y -= speed * 0.7;
        if (_moveVec.lengthSq() > 0) {
          camera.position.add(_moveVec);
          controls.target.add(_moveVec);
          rt.dirtyFlags |= DIRTY_WEBGL | DIRTY_CAMERA;
          keepAlive = true;
        }
      }

      if (controls.update()) {
        rt.dirtyFlags |= DIRTY_WEBGL | DIRTY_CAMERA;
        keepAlive = true;
      }

      // 2. Platter rotational inertia
      const velDiff = rt.targetVel - rt.platterVel;
      if (Math.abs(velDiff) > 0.0005) {
        rt.platterVel += velDiff * Math.min(1, dt * 3.8);
      } else {
        rt.platterVel = rt.targetVel;
      }
      if (Math.abs(rt.platterVel) > 0.0005) {
        platterSpinGroup.rotation.y -= rt.platterVel * dt;
        rt.dirtyFlags |= DIRTY_WEBGL;
        keepAlive = true;
      }

      // 3. Tonearm tracking across real groove radius
      const st = useV4Store.getState();
      const spinning = st.powerOn && (st.isPlaying || st.motorOn);
      if (st.powerOn && st.isPlaying && st.onPlatter && !rt.isFlippingDisc) {
        const side = st.onPlatter.sides[st.activeSideIndex] || st.onPlatter.sides[0];
        const tracks = side?.tracks || [];
        const activeTrackIdx = st.nowPlaying?.vinyl?.trackIndex ?? 0;
        let elapsedBeforeTrack = 0;
        for (let i = 0; i < Math.min(activeTrackIdx, tracks.length); i++) {
          elapsedBeforeTrack += tracks[i].duration_ms || 180_000;
        }
        const sideElapsed = elapsedBeforeTrack + playbackClock.getPositionMs();
        const r = radiusForSideTime(side, sideElapsed);
        rt.targetArmYaw = tonearmYawForRadius(r);
        rt.targetArmPitch = 0.0;
      } else if (spinning && st.onPlatter && !rt.isFlippingDisc) {
        rt.targetArmYaw = tonearmYawForRadius(GROOVE_OUTER_R);
        rt.targetArmPitch = -0.05;
      } else {
        rt.targetArmYaw = ARM_REST_YAW;
        rt.targetArmPitch = -0.09;
      }

      const yawDiff = rt.targetArmYaw - rt.armYaw;
      const pitchDiff = rt.targetArmPitch - rt.armPitch;
      if (Math.abs(yawDiff) > 0.0004 || Math.abs(pitchDiff) > 0.0004) {
        rt.armYaw += yawDiff * Math.min(1, dt * 4.5);
        rt.armPitch += pitchDiff * Math.min(1, dt * 5.5);
        tonearmYawGroup.rotation.y = rt.armYaw;
        tonearmPitchGroup.rotation.x = rt.armPitch;
        rt.dirtyFlags |= DIRTY_WEBGL | DIRTY_SHADOW;
        keepAlive = true;
      }

      // 4. Crate InstancedMesh flip animation
      if (updateCrateInstances(dt)) {
        rt.dirtyFlags |= DIRTY_WEBGL;
        keepAlive = true;
      }

      // 5. Shadow map update ONLY on DIRTY_SHADOW
      if (rt.dirtyFlags & DIRTY_SHADOW) {
        renderer.shadowMap.needsUpdate = true;
      }

      // 6. WebGL Render
      if (rt.dirtyFlags & (DIRTY_WEBGL | DIRTY_CAMERA | DIRTY_SHADOW)) {
        renderer.render(scene, camera);
      }

      // 7. Event-driven CSS3DRenderer (ONLY on DIRTY_CAMERA & camera matrix delta > 1e-5!)
      if (rt.dirtyFlags & DIRTY_CAMERA) {
        camera.updateMatrixWorld();
        const elems = camera.matrixWorldInverse.elements;
        let camChanged = false;
        for (let i = 0; i < 16; i++) {
          if (Math.abs(elems[i] - _lastCamMatrix[i]) > 1e-5) {
            camChanged = true;
            break;
          }
        }
        if (camChanged) {
          _lastCamMatrix.set(elems);
          oledConsoleGroup.getWorldPosition(_screenWorldPos);
          _screenNormal.set(0, 0, 1).applyQuaternion(oledConsoleGroup.quaternion);
          _camToScreen.subVectors(camera.position, _screenWorldPos).normalize();
          const facingCamera = _screenNormal.dot(_camToScreen) > 0.05;
          screenDom.style.visibility = facingCamera ? "visible" : "hidden";
          css3dRenderer.render(css3dScene, camera);
        }
      }

      rt.dirtyFlags = 0;
      if (keepAlive || rt.activeTweens > 0) {
        scheduleFrame();
      }
    };

    // Initial render
    updateCrateInstances(0.016);
    invalidate(DIRTY_WEBGL | DIRTY_CAMERA | DIRTY_SHADOW);

    // =========================================================================
    // G. ZERO-GC RAYCASTER (<= 30 Hz HOVER) + CLOSED-LID PHYSICAL LOCK
    // =========================================================================
    let downPos = { x: 0, y: 0 };
    let lastMovePos = { x: -999, y: -999 };
    let lastRaycastTs = 0;

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const applyVolumeFromWorldPoint = (worldPt: THREE.Vector3) => {
      _localPt.copy(worldPt);
      turntableGroup.worldToLocal(_localPt);
      const clampedZ = Math.max(FADER_Z_TOP, Math.min(FADER_Z_BOT, _localPt.z));
      const ratio = 1 - (clampedZ - FADER_Z_TOP) / (FADER_Z_BOT - FADER_Z_TOP);
      const vol = Math.round(ratio * 100);
      faderKnob.position.z = clampedZ;
      invalidate(DIRTY_WEBGL);
      const st = useV4Store.getState();
      if (st.volumePct !== vol) {
        st.setVolumePct(vol);
        st.setHoveredHint(`VOLUME · GAIN : ${vol}%`);
        const bucket = Math.floor(vol / 10);
        if (bucket !== runtimeRef.current.lastDetentBucket) {
          runtimeRef.current.lastDetentBucket = bucket;
          vinylFoley.playFaderDetent(st.soundFx);
        }
      }
    };

    const filterValidHit = (hits: THREE.Intersection[]) => {
      const lidIsOpen = useV4Store.getState().lidOpen;
      return hits.find((h) => {
        if (!h.object.visible || h.object.parent?.visible === false || h.object.parent?.parent?.visible === false) {
          return false;
        }
        // When lid is open, allow clicking the upper rim (y >= 1.25) or handle to close it,
        // while letting lower clicks pass through to platter & controls underneath!
        if ((h.object === lidTopPanel || h.object === lidFrontPanel) && lidIsOpen && h.point.y < 1.25) {
          return false;
        }
        return true;
      });
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!runtimeRef.current.isStudio) return;

      // Always handle continuous 3D Volume Fader dragging BEFORE checking isOrbiting!
      if (runtimeRef.current.draggingFader) {
        updateNdc(e.clientX, e.clientY);
        _raycaster.setFromCamera(_pointerNdc, camera);
        _hits.length = 0;
        _raycaster.intersectObjects([faderSlot, plinthBody], false, _hits);
        if (_hits.length > 0) applyVolumeFromWorldPoint(_hits[0].point);
        return;
      }

      if (runtimeRef.current.isOrbiting) return;

      // Throttle hover raycast to <= 30 Hz and >= 2px pointer delta
      const now = performance.now();
      if (now - lastRaycastTs < 33) return;
      if (Math.hypot(e.clientX - lastMovePos.x, e.clientY - lastMovePos.y) < 2) return;
      lastRaycastTs = now;
      lastMovePos = { x: e.clientX, y: e.clientY };

      updateNdc(e.clientX, e.clientY);
      _raycaster.setFromCamera(_pointerNdc, camera);
      if (!_raycaster.ray.intersectsSphere(_interactiveClusterSphere)) return;

      _hits.length = 0;
      _raycaster.intersectObjects(threeRef.current.interactables, false, _hits);
      const hit = filterValidHit(_hits);
      const st = useV4Store.getState();

      if (hit) {
        const act = hit.object.userData.action as string;

        // Strict Physical Lock under Closed Dust Cover (`lidOpen === false`)
        if (!st.lidOpen && (act === "lid-body" || UNDER_LID_ACTIONS.has(act))) {
          renderer.domElement.style.cursor = "not-allowed";
          runtimeRef.current.hoveredSlot = -1;
          const lockHint = "Capot fermé · Cliquer sur la poignée chromée pour ouvrir";
          if (st.hoveredHint !== lockHint) st.setHoveredHint(lockHint);
          return;
        }

        renderer.domElement.style.cursor = "pointer";
        const prevSlot = runtimeRef.current.hoveredSlot;
        const newSlot = act === "crate-sleeve" && typeof hit.instanceId === "number" ? hit.instanceId : -1;
        runtimeRef.current.hoveredSlot = newSlot;
        runtimeRef.current.hoveredCrate =
          act === "crate-sleeve" || act === "return-to-crate" || act === "cycle-crate-sort";
        if (prevSlot !== newSlot) invalidate(DIRTY_WEBGL);

        let hint: string | null = hit.object.userData.hint || null;
        if (act === "crate-sleeve" && newSlot >= 0) {
          const alb = st.crate[newSlot];
          if (alb) {
            const lpTag = alb.disc_count >= 2 ? " · 2×LP" : "";
            hint = `${alb.album_name} — ${alb.artist_name}${lpTag} (${alb.plays} écoutes) · Cliquer pour sortir du bac`;
          }
        } else if (act === "groove-seek" && st.onPlatter) {
          _localPt.copy(hit.point);
          platterSpinGroup.worldToLocal(_localPt);
          const r = Math.hypot(_localPt.x, _localPt.z);
          if (r >= GROOVE_INNER_R && r <= GROOVE_OUTER_R) {
            const found = findTrackAtRadius(st.onPlatter, st.activeSideIndex, r);
            if (found) {
              const side = st.onPlatter.sides[st.activeSideIndex] || st.onPlatter.sides[0];
              hint = `Sillon Face ${side?.side || "A"} · Piste ${found.track.number} : « ${found.track.title} » (${formatDurationMs(
                found.track.duration_ms
              )}) · Cliquer pour poser le diamant`;
            }
          }
        } else if (act === "volume-fader") {
          hint = `Fader VOLUME · GAIN (${st.volumePct}%) · Cliquer ou glisser`;
        }
        if (st.hoveredHint !== hint) st.setHoveredHint(hint);
      } else {
        renderer.domElement.style.cursor = "grab";
        runtimeRef.current.hoveredCrate = false;
        if (runtimeRef.current.hoveredSlot !== -1) {
          runtimeRef.current.hoveredSlot = -1;
          invalidate(DIRTY_WEBGL);
        }
        if (st.hoveredHint !== null) st.setHoveredHint(null);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      downPos = { x: e.clientX, y: e.clientY };
      if (!runtimeRef.current.isStudio || e.button !== 0) return;
      if (!useV4Store.getState().lidOpen) return; // Volume fader locked under closed lid!
      updateNdc(e.clientX, e.clientY);
      _raycaster.setFromCamera(_pointerNdc, camera);
      _hits.length = 0;
      _raycaster.intersectObjects([faderKnob, faderSlot, faderHitbox], false, _hits);
      if (_hits.length > 0) {
        e.stopPropagation();
        runtimeRef.current.draggingFader = true;
        runtimeRef.current.isOrbiting = false;
        controls.enabled = false;
        applyVolumeFromWorldPoint(_hits[0].point);
      }
    };

    const pressButtonAnim = (mesh: THREE.Mesh | undefined, baseY: number) => {
      if (!mesh) return;
      runtimeRef.current.activeTweens++;
      gsap.fromTo(
        mesh.position,
        { y: baseY - 0.024 },
        {
          y: baseY,
          duration: 0.22,
          ease: "back.out(2)",
          onUpdate: () => invalidate(DIRTY_WEBGL),
          onComplete: () => {
            runtimeRef.current.activeTweens = Math.max(0, runtimeRef.current.activeTweens - 1);
          },
        }
      );
    };

    const onPointerUp = (e: PointerEvent) => {
      if (runtimeRef.current.draggingFader) {
        runtimeRef.current.draggingFader = false;
        controls.enabled = true;
        return;
      }
      if (!runtimeRef.current.isStudio || e.button !== 0) return;
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) return;

      updateNdc(e.clientX, e.clientY);
      _raycaster.setFromCamera(_pointerNdc, camera);
      _hits.length = 0;
      _raycaster.intersectObjects(threeRef.current.interactables, false, _hits);
      const hit = filterValidHit(_hits);
      const st = useV4Store.getState();

      if (!hit) {
        if (st.vinylStage === "INSPECT") {
          vinylFoley.playSleeveSlide(st.soundFx);
          st.setVinylStage("ROOM");
        }
        return;
      }

      const action = hit.object.userData.action as string;

      // Strict Physical Lock Under Closed Dust Cover (`lidOpen === false`)
      if (!st.lidOpen && (action === "lid-body" || UNDER_LID_ACTIONS.has(action))) {
        vinylFoley.playLidBlocked(st.soundFx);
        st.showToast("Capot fermé · Clique sur la poignée chromée pour ouvrir le capot");
        return;
      }

      if (action === "return-to-crate") {
        if (st.vinylStage === "INSPECT") {
          vinylFoley.playSleeveSlide(st.soundFx);
          st.setVinylStage("ROOM");
        }
      } else if (action === "crate-sleeve" && typeof hit.instanceId === "number") {
        const slotIndex = hit.instanceId;
        const album = st.crate[slotIndex];
        if (!album) return;
        vinylFoley.playSleeveSlide(st.soundFx);
        st.setCrateIndex(slotIndex);
        const qs = buildQueryParams(st.filters);
        apiGet<VinylDetail>(`${API.vinyl(album.album_key)}${qs}`)
          .then((detail) => {
            useV4Store.getState().setInspected(detail);
            useV4Store.getState().setDiscOut(true);
            useV4Store.getState().setVinylStage("INSPECT");
          })
          .catch(() => {});
      } else if (action === "flip-inspect-sleeve") {
        vinylFoley.playSleeveSlide(st.soundFx);
        st.setSleeveFlipped(!st.sleeveFlipped);
      } else if (action === "place-on-platter") {
        const v = st.inspected;
        if (!v) return;
        const chosenDisc: 0 | 1 = hit.object.userData.discIndex === 1 && v.sides.length > 2 ? 1 : 0;
        const startSideIdx = chosenDisc === 1 ? 2 : 0;
        vinylFoley.playRecordPlace(st.soundFx);
        window.setTimeout(() => vinylFoley.playNeedleDrop(useV4Store.getState().soundFx), 180);
        st.setOnPlatter(v);
        st.setActiveDiscIndex(chosenDisc);
        st.setActiveSideIndex(startSideIdx);
        st.setMotorOn(true);
        st.setVinylStage("ROOM");
        const side = v.sides[startSideIdx] || v.sides[0];
        const firstTrack = side?.tracks?.[0];
        if (firstTrack) {
          playTrack({
            song_name: firstTrack.title,
            artist_name: firstTrack.artist_name || v.artist_name,
            album_name: v.album_name,
            artwork_url: v.artwork_url,
            track_key: firstTrack.track_key,
            preview_url: firstTrack.preview_url,
            duration_ms: firstTrack.duration_ms,
            vinyl: { album_key: v.album_key, sideIndex: startSideIdx, trackIndex: 0 },
          });
        }
      } else if (action === "toggle-power") {
        vinylFoley.playPowerToggle(st.soundFx);
        const nextPower = !st.powerOn;
        st.setPowerOn(nextPower);
        if (!nextPower) {
          st.setIsPlaying(false);
          st.setMotorOn(false);
        }
      } else if (action === "toggle-start") {
        vinylFoley.playStartStopButton(st.soundFx);
        pressButtonAnim(threeRef.current.startBtn, 0.435);
        if (!st.powerOn) st.setPowerOn(true);
        if (st.nowPlaying) {
          const next = !st.isPlaying;
          st.setIsPlaying(next);
          st.setMotorOn(next);
        } else if (st.onPlatter) {
          const side = st.onPlatter.sides[st.activeSideIndex] || st.onPlatter.sides[0];
          const first = side?.tracks?.[0];
          if (first) {
            vinylFoley.playNeedleDrop(st.soundFx);
            st.setMotorOn(true);
            playTrack({
              song_name: first.title,
              artist_name: first.artist_name || st.onPlatter.artist_name,
              album_name: st.onPlatter.album_name,
              artwork_url: st.onPlatter.artwork_url,
              track_key: first.track_key,
              preview_url: first.preview_url,
              duration_ms: first.duration_ms,
              vinyl: { album_key: st.onPlatter.album_key, sideIndex: st.activeSideIndex, trackIndex: 0 },
            });
          } else {
            st.setMotorOn(!st.motorOn);
          }
        } else {
          st.setMotorOn(!st.motorOn);
        }
      } else if (action === "rpm-33") {
        vinylFoley.playRpmMicroSwitch(st.soundFx);
        pressButtonAnim(threeRef.current.btn33, 0.43);
        st.setRpm(33);
      } else if (action === "rpm-45") {
        vinylFoley.playRpmMicroSwitch(st.soundFx);
        pressButtonAnim(threeRef.current.btn45, 0.43);
        st.setRpm(45);
      } else if (action === "flip-disc-side") {
        if (st.onPlatter) {
          // Flip between sides of the currently mounted physical disc (A<->B on LP 1, C<->D on LP 2)
          const base = st.activeDiscIndex === 1 && st.onPlatter.sides.length > 2 ? 2 : 0;
          const pairLen = Math.min(2, st.onPlatter.sides.length - base);
          const nextSideIdx = pairLen >= 2 ? base + ((st.activeSideIndex - base + 1) % pairLen) : base;
          runtimeRef.current.triggerDiscFlipAnim(nextSideIdx, st.isPlaying);
        }
      } else if (action === "toggle-lid" || (action === "lid-body" && st.lidOpen)) {
        vinylFoley.playLidHinge(st.soundFx, !st.lidOpen);
        st.setLidOpen(!st.lidOpen);
      } else if (action === "toggle-lamp") {
        vinylFoley.playLampSwitch(st.soundFx);
        st.setLampOn(!st.lampOn);
      } else if (action === "toggle-stylus-light") {
        vinylFoley.playLampSwitch(st.soundFx);
        st.setStylusLightOn(!st.stylusLightOn);
      } else if (action === "cycle-crate-sort") {
        vinylFoley.playRpmMicroSwitch(st.soundFx);
        const nextSort = CRATE_SORTS[(CRATE_SORTS.indexOf(st.crateSort) + 1) % CRATE_SORTS.length];
        st.setCrateSort(nextSort);
      } else if (action === "inspect-platter") {
        if (st.onPlatter) {
          vinylFoley.playSleeveSlide(st.soundFx);
          st.setInspected(st.onPlatter);
          st.setDiscOut(false);
          st.setVinylStage("INSPECT");
        }
      } else if (action === "groove-seek" && st.onPlatter) {
        _localPt.copy(hit.point);
        platterSpinGroup.worldToLocal(_localPt);
        const r = Math.hypot(_localPt.x, _localPt.z);
        if (r >= GROOVE_INNER_R && r <= GROOVE_OUTER_R) {
          const found = findTrackAtRadius(st.onPlatter, st.activeSideIndex, r);
          if (found) {
            vinylFoley.playNeedleDrop(st.soundFx);
            st.setMotorOn(true);
            playTrack({
              song_name: found.track.title,
              artist_name: found.track.artist_name || st.onPlatter.artist_name,
              album_name: st.onPlatter.album_name,
              artwork_url: st.onPlatter.artwork_url,
              track_key: found.track.track_key,
              preview_url: found.track.preview_url,
              duration_ms: found.track.duration_ms,
              vinyl: { album_key: st.onPlatter.album_key, sideIndex: st.activeSideIndex, trackIndex: found.index },
            });
          }
        }
      }
    };

    let lastWheelAt = 0;
    const crateWheelTargets: THREE.Object3D[] = [crateInstMesh, crateFront, crateBack, crateBottom, cratePlate, crateLabelInner];
    const onWheel = (e: WheelEvent) => {
      if (!runtimeRef.current.isStudio) return;
      if (e.target !== dom && !container.contains(e.target as Node)) return;
      const st = useV4Store.getState();
      if (st.crate.length === 0) return;

      let inCrateBrowse =
        runtimeRef.current.hoveredCrate ||
        runtimeRef.current.hoveredSlot >= 0 ||
        (st.vinylStage === "CRATE" && !e.ctrlKey && !e.metaKey);

      if (!inCrateBrowse) {
        updateNdc(e.clientX, e.clientY);
        _raycaster.setFromCamera(_pointerNdc, camera);
        _hits.length = 0;
        _raycaster.intersectObjects(crateWheelTargets, false, _hits);
        if (_hits.length > 0) inCrateBrowse = true;
      }

      if (inCrateBrowse) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const now = performance.now();
        if (now - lastWheelAt < 70) return;
        lastWheelAt = now;
        const delta = e.deltaY > 0 ? 1 : -1;
        const maxIdx = Math.min(st.crate.length, MAX_CRATE_SLEEVES) - 1;
        const next = Math.max(0, Math.min(maxIdx, st.crateIndex + delta));
        if (next !== st.crateIndex) {
          vinylFoley.playCrateFlip(st.soundFx);
          st.setCrateIndex(next);
          invalidate(DIRTY_WEBGL);
        }
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if ("wasdzqec".includes(k)) {
        runtimeRef.current.keysPressed.add(k);
        invalidate(DIRTY_WEBGL | DIRTY_CAMERA);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      runtimeRef.current.keysPressed.delete(e.key.toLowerCase());
    };

    const onContextRestored = () => {
      const albums = useV4Store.getState().crate.slice(0, MAX_CRATE_SLEEVES);
      Promise.all(
        albums.map((alb, i) =>
          uploadCoverToArraySlot(
            renderer,
            crateCoverArray,
            i,
            alb.artwork_url,
            { title: alb.album_name, artist: alb.artist_name, seed: i + 1 },
            384,
            true
          )
        )
      ).then(() => {
        regenerateArrayMipmaps(renderer, crateCoverArray);
        invalidate(DIRTY_WEBGL);
      });
    };

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      const aspect = w / h;
      camera.aspect = aspect;
      camera.fov = aspect < 1.1 ? Math.min(68, Math.round(38 / Math.max(0.5, aspect * 0.78))) : 38;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      css3dRenderer.setSize(w, h);
      _lastCamMatrix.fill(0);
      invalidate(DIRTY_WEBGL | DIRTY_CAMERA);
    };

    const dom = renderer.domElement;
    window.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", onResize);
    dom.addEventListener("webglcontextrestored", onContextRestored);

    // Instrumentation hook for P6 validation
    window.__AMDW_STATS = () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length ?? 0,
      pixelRatio: renderer.getPixelRatio(),
      rafActive: runtimeRef.current.rafActive,
      dirtyFlags: runtimeRef.current.dirtyFlags,
    });

    onResize();

    return () => {
      isDisposed = true;
      window.clearTimeout(compileTimer);
      cancelAnimationFrame(rafId);
      runtimeRef.current.rafActive = false;
      delete window.__AMDW_STATS;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("wheel", onWheel, true);
      dom.removeEventListener("webglcontextrestored", onContextRestored);
      vinylFoley.setCrackleLoop(false);
      controls.dispose();
      crateCoverArray.dispose();
      envRT.dispose(); // Dispose RenderTarget (never envRT.texture!)
      renderer.dispose();
    };
  }, []);

  // 2. Wake / sleep 3D loop when switching tabs; ensure CSS3D YouTube stays compositor-visible off-studio!
  useEffect(() => {
    const isStudio = activeTab === "studio";
    runtimeRef.current.isStudio = isStudio;
    if (!isStudio) {
      vinylFoley.setCrackleLoop(false);
      if (plinthScreenDomRef.current) {
        plinthScreenDomRef.current.style.visibility = "visible";
      }
    } else {
      runtimeRef.current.invalidate(DIRTY_WEBGL | DIRTY_CAMERA | DIRTY_SHADOW);
    }
  }, [activeTab]);

  // 3. Camera Preset Transitions + Physical Pull-Out Animation
  useEffect(() => {
    const { camera, controls, inspectGroup } = threeRef.current;
    if (!camera || !controls) return;
    const inv = runtimeRef.current.invalidate;

    const animCam = (px: number, py: number, pz: number, tx: number, ty: number, tz: number, dur = 0.78) => {
      runtimeRef.current.activeTweens += 2;
      gsap.to(camera.position, {
        x: px,
        y: py,
        z: pz,
        duration: dur,
        ease: "power3.out",
        onUpdate: () => inv(DIRTY_WEBGL | DIRTY_CAMERA),
        onComplete: () => {
          runtimeRef.current.activeTweens = Math.max(0, runtimeRef.current.activeTweens - 1);
        },
      });
      gsap.to(controls.target, {
        x: tx,
        y: ty,
        z: tz,
        duration: dur,
        ease: "power3.out",
        onUpdate: () => inv(DIRTY_WEBGL | DIRTY_CAMERA),
        onComplete: () => {
          runtimeRef.current.activeTweens = Math.max(0, runtimeRef.current.activeTweens - 1);
        },
      });
    };

    if (vinylStage === "INSPECT" && inspected) {
      if (inspectGroup) {
        inspectGroup.visible = true;
        runtimeRef.current.activeTweens++;
        gsap.fromTo(
          inspectGroup.position,
          { x: 3.6, y: 1.4, z: 0.45 },
          {
            x: 0.3,
            y: 2.05,
            z: 2.65,
            duration: 0.65,
            ease: "power3.out",
            onUpdate: () => inv(DIRTY_WEBGL | DIRTY_SHADOW),
            onComplete: () => {
              runtimeRef.current.activeTweens = Math.max(0, runtimeRef.current.activeTweens - 1);
            },
          }
        );
      }
      const isDouble = inspected.disc_count >= 2 || inspected.sides.length > 2;
      animCam(0.32, 2.75, isDouble ? 8.1 : 6.2, 0.3, 1.9, 1.6, 0.75);
    } else if (vinylStage === "TURNTABLE") {
      if (inspectGroup) inspectGroup.visible = false;
      animCam(-1.15, 4.35, 5.95, -1.25, 0.45, 0.22, 0.8);
    } else if (vinylStage === "CRATE") {
      if (inspectGroup) inspectGroup.visible = false;
      animCam(3.55, 3.75, 5.75, 3.85, 0.9, 0.15, 0.8);
    } else if (vinylStage === "ROOM") {
      if (inspectGroup && inspectGroup.visible) {
        gsap.killTweensOf(inspectGroup.position);
        inspectGroup.visible = false;
      }
      animCam(0.25, 5.25, 9.75, 0.15, 0.6, -0.15, 0.85);
    } else if (vinylStage === "FREECAM") {
      if (inspectGroup) inspectGroup.visible = false;
      inv(DIRTY_WEBGL | DIRTY_SHADOW);
    }
  }, [vinylStage, inspected]);

  // 4. Progressive Batched Upload (4 per batch) into GPU-Only DataArrayTexture (384px x 20)
  useEffect(() => {
    const { renderer, crateCoverArray } = threeRef.current;
    if (!renderer || !crateCoverArray || crate.length === 0) return;

    let cancelled = false;
    const albums = crate.slice(0, MAX_CRATE_SLEEVES);

    (async () => {
      const BATCH = 4;
      for (let start = 0; start < albums.length; start += BATCH) {
        if (cancelled) return;
        const slice = albums.slice(start, start + BATCH);
        await Promise.all(
          slice.map((alb, offset) =>
            uploadCoverToArraySlot(
              renderer,
              crateCoverArray,
              start + offset,
              alb.artwork_url,
              { title: alb.album_name, artist: alb.artist_name, seed: start + offset + 1 },
              384
            )
          )
        );
        if (cancelled) return;
        regenerateArrayMipmaps(renderer, crateCoverArray);
        runtimeRef.current.invalidate(DIRTY_WEBGL);
      }
    })();

    // Auto-place top album onto the turntable platter on first load
    if (!useV4Store.getState().onPlatter && crate[0]) {
      const qs = buildQueryParams(useV4Store.getState().filters);
      apiGet<VinylDetail>(`${API.vinyl(crate[0].album_key)}${qs}`)
        .then((detail) => {
          if (!useV4Store.getState().onPlatter) {
            useV4Store.getState().setOnPlatter(detail);
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [crate]);

  // Wake render loop when crateIndex changes
  useEffect(() => {
    runtimeRef.current.invalidate(DIRTY_WEBGL);
  }, [crateIndex]);

  // 5. Sync On-Platter Record (GLSL track stops + Macaron + HD 1024px Easel Cover)
  useEffect(() => {
    const { renderer, vinylShader, labelMat, easelFrontMat } = threeRef.current;
    if (!onPlatter || !renderer || !vinylShader || !labelMat || !easelFrontMat) return;

    const side = onPlatter.sides[activeSideIndex] || onPlatter.sides[0];
    vinylShader.setTrackStops(side);
    vinylShader.setVinylColor(onPlatter.vinyl_color_hex || "#0e0e10");

    if (labelMat.map) labelMat.map.dispose();
    labelMat.map = makeLabelTexture(
      {
        album: onPlatter.album_name,
        artist: onPlatter.artist_name,
        label: onPlatter.label_name || "AMDW RECORDS",
        catalog: onPlatter.catalog_number || "AMDW-LP",
        year: onPlatter.release_year,
        side: side?.side || "A",
        tracks: side?.tracks || [],
      },
      "#d8602b",
      rpm,
      384
    );
    labelMat.needsUpdate = true;
    runtimeRef.current.invalidate(DIRTY_WEBGL);

    let cancelled = false;
    loadZeroRamTexture(
      renderer,
      onPlatter.artwork_url,
      { title: onPlatter.album_name, artist: onPlatter.artist_name, seed: 3 },
      1024
    ).then((tex) => {
      if (cancelled) {
        tex?.dispose();
        return;
      }
      if (tex) {
        if (easelFrontMat.map) easelFrontMat.map.dispose();
        easelFrontMat.map = tex;
        easelFrontMat.color.setHex(0xffffff);
        easelFrontMat.needsUpdate = true;
        runtimeRef.current.invalidate(DIRTY_WEBGL);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [onPlatter, activeSideIndex, rpm]);

  // 6. Sync Inspected Sleeve (HD 1024px Front + Ephemeral Verso + Single Unfolding Double LP Gatefold!)
  useEffect(() => {
    const {
      renderer,
      inspectFrontMat,
      inspectBackMat,
      inspectInnerLeftMat,
      inspectInnerRightMat,
      inspectSleeveMesh,
      inspectSpineMesh,
      gatefoldRightInner,
      inspectLeftWingPivot,
      inspectRightWingPivot,
      inspectDisc1Mesh,
      inspectDisc2Mesh,
      inspectDisc1LabelMat,
      inspectDisc2LabelMat,
    } = threeRef.current;
    if (
      !renderer ||
      !inspectFrontMat ||
      !inspectBackMat ||
      !inspectInnerLeftMat ||
      !inspectInnerRightMat ||
      !inspectSleeveMesh ||
      !inspectSpineMesh ||
      !gatefoldRightInner ||
      !inspectLeftWingPivot ||
      !inspectRightWingPivot ||
      !inspectDisc1Mesh ||
      !inspectDisc2Mesh ||
      !inspectDisc1LabelMat ||
      !inspectDisc2LabelMat
    ) {
      return;
    }

    // Dispose ephemeral textures when closing inspect mode
    if (!inspected) {
      for (const m of [inspectFrontMat, inspectBackMat, inspectInnerLeftMat, inspectInnerRightMat]) {
        if (m.map) {
          m.map.dispose();
          m.map = null;
          m.needsUpdate = true;
        }
      }
      return;
    }

    const isDoubleLp = inspected.disc_count >= 2 || inspected.sides.length > 2;
    inspectLeftWingPivot.visible = isDoubleLp;
    inspectSpineMesh.visible = isDoubleLp;
    gatefoldRightInner.visible = isDoubleLp;
    inspectDisc2Mesh.visible = isDoubleLp;

    // Single LP: sleeve centered at x=0, Disc 1 in right pivot.
    // Double LP: ONE seamless Gatefold hinged at central spine x=0 (left wing = LP 1, right wing = LP 2)!
    inspectRightWingPivot.position.set(0, 0, 0);
    inspectLeftWingPivot.position.set(0, 0, 0);
    inspectSleeveMesh.position.set(isDoubleLp ? 1.075 : 0, 0, 0);

    if (isDoubleLp) {
      inspectLeftWingPivot.add(inspectDisc1Mesh);
      inspectRightWingPivot.add(inspectDisc2Mesh);
      inspectDisc1Mesh.position.set(-1.075, 0, -0.004);
      inspectDisc2Mesh.position.set(1.075, 0, -0.004);
      // Unfold the single Gatefold smoothly from closed book (PI) -> open book (+0.22 / -0.22)!
      runtimeRef.current.activeTweens += 2;
      gsap.fromTo(
        inspectLeftWingPivot.rotation,
        { y: Math.PI },
        {
          y: 0.22,
          duration: 0.85,
          ease: "power3.out",
          onUpdate: () => runtimeRef.current.invalidate(DIRTY_WEBGL | DIRTY_SHADOW),
          onComplete: () => {
            runtimeRef.current.activeTweens = Math.max(0, runtimeRef.current.activeTweens - 1);
          },
        }
      );
      gsap.fromTo(
        inspectRightWingPivot.rotation,
        { y: 0 },
        {
          y: -0.22,
          duration: 0.85,
          ease: "power3.out",
          onUpdate: () => runtimeRef.current.invalidate(DIRTY_WEBGL),
          onComplete: () => {
            runtimeRef.current.activeTweens = Math.max(0, runtimeRef.current.activeTweens - 1);
          },
        }
      );
    } else {
      inspectRightWingPivot.add(inspectDisc1Mesh);
      inspectDisc1Mesh.position.set(0, 0, 0);
      inspectLeftWingPivot.rotation.set(0, 0, 0);
      inspectRightWingPivot.rotation.set(0, 0, 0);
    }

    let cancelled = false;
    loadZeroRamTexture(
      renderer,
      inspected.artwork_url,
      { title: inspected.album_name, artist: inspected.artist_name, seed: 9 },
      1024
    ).then((tex) => {
      if (cancelled) {
        tex?.dispose();
        return;
      }
      if (tex) {
        if (inspectFrontMat.map) inspectFrontMat.map.dispose();
        inspectFrontMat.map = tex;
        inspectFrontMat.color.setHex(0xffffff);
        inspectFrontMat.needsUpdate = true;
        runtimeRef.current.invalidate(DIRTY_WEBGL);
      }
    });

    createEphemeralVersoTexture(renderer, inspected, "#c9a86b", 768).then((tex) => {
      if (cancelled) {
        tex.dispose();
        return;
      }
      if (inspectBackMat.map) inspectBackMat.map.dispose();
      inspectBackMat.map = tex;
      inspectBackMat.color.setHex(0xffffff);
      inspectBackMat.needsUpdate = true;
      runtimeRef.current.invalidate(DIRTY_WEBGL);
    });

    if (isDoubleLp) {
      createEphemeralGatefoldInnerTexture(renderer, inspected, "#c9a86b", "AB", 512).then((tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        if (inspectInnerLeftMat.map) inspectInnerLeftMat.map.dispose();
        inspectInnerLeftMat.map = tex;
        inspectInnerLeftMat.color.setHex(0xffffff);
        inspectInnerLeftMat.needsUpdate = true;
        runtimeRef.current.invalidate(DIRTY_WEBGL);
      });
      createEphemeralGatefoldInnerTexture(renderer, inspected, "#e8873e", "CD", 512).then((tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        if (inspectInnerRightMat.map) inspectInnerRightMat.map.dispose();
        inspectInnerRightMat.map = tex;
        inspectInnerRightMat.color.setHex(0xffffff);
        inspectInnerRightMat.needsUpdate = true;
        runtimeRef.current.invalidate(DIRTY_WEBGL);
      });
    }

    const sideA = inspected.sides[0];
    if (inspectDisc1LabelMat.map) inspectDisc1LabelMat.map.dispose();
    inspectDisc1LabelMat.map = makeLabelTexture(
      {
        album: inspected.album_name,
        artist: inspected.artist_name,
        label: inspected.label_name || "AMDW RECORDS",
        catalog: inspected.catalog_number || "LP-1",
        year: inspected.release_year,
        side: sideA?.side || "A",
        tracks: sideA?.tracks || [],
      },
      "#d8602b",
      33,
      256
    );
    inspectDisc1LabelMat.needsUpdate = true;

    if (isDoubleLp) {
      const sideC = inspected.sides[2] || inspected.sides[1];
      if (inspectDisc2LabelMat.map) inspectDisc2LabelMat.map.dispose();
      inspectDisc2LabelMat.map = makeLabelTexture(
        {
          album: inspected.album_name,
          artist: inspected.artist_name,
          label: inspected.label_name || "AMDW RECORDS",
          catalog: inspected.catalog_number || "LP-2",
          year: inspected.release_year,
          side: sideC?.side || "C",
          tracks: sideC?.tracks || [],
        },
        "#3b6e8c",
        33,
        256
      );
      inspectDisc2LabelMat.needsUpdate = true;
    }

    return () => {
      cancelled = true;
    };
  }, [inspected]);

  // 7. Sleeve Recto/Verso Flip & Physical Disc Slide-Out (1 or 2 Discs from Single Gatefold)
  useEffect(() => {
    const { inspectSleeveGroup, inspectDisc1Mesh, inspectDisc2Mesh } = threeRef.current;
    if (!inspectSleeveGroup || !inspectDisc1Mesh || !inspectDisc2Mesh) return;
    const inv = runtimeRef.current.invalidate;
    const isDoubleLp = Boolean(inspected && (inspected.disc_count >= 2 || inspected.sides.length > 2));
    runtimeRef.current.activeTweens += 2;

    gsap.to(inspectSleeveGroup.rotation, {
      y: sleeveFlipped ? Math.PI : 0,
      duration: 0.72,
      ease: "power3.inOut",
      onUpdate: () => inv(DIRTY_WEBGL | DIRTY_SHADOW),
      onComplete: () => {
        runtimeRef.current.activeTweens = Math.max(0, runtimeRef.current.activeTweens - 1);
      },
    });
    const discSlideDelay = isDoubleLp && discOut && !sleeveFlipped ? 0.32 : 0;
    gsap.to(inspectDisc1Mesh.position, {
      x: isDoubleLp
        ? discOut && !sleeveFlipped
          ? -2.02
          : -1.075
        : discOut && !sleeveFlipped
        ? 1.18
        : 0.0,
      duration: 0.65,
      delay: discSlideDelay,
      ease: "power3.out",
      onUpdate: () => inv(DIRTY_WEBGL | DIRTY_SHADOW),
      onComplete: () => {
        runtimeRef.current.activeTweens = Math.max(0, runtimeRef.current.activeTweens - 1);
      },
    });
    gsap.to(inspectDisc2Mesh.position, {
      x: discOut && !sleeveFlipped ? 2.02 : 1.075,
      duration: 0.65,
      delay: discSlideDelay,
      ease: "power3.out",
      onUpdate: () => inv(DIRTY_WEBGL),
    });
  }, [sleeveFlipped, discOut, inspected]);

  // 8. Sync Motor Velocity, RPM LEDs, Volume Fader, Power & Crackle AudioWorklet
  useEffect(() => {
    const spinning = powerOn && (isPlaying || motorOn);
    const omega = rpm === 45 ? (45 * 2 * Math.PI) / 60 : (33.333 * 2 * Math.PI) / 60;
    runtimeRef.current.targetVel = spinning ? omega : 0;

    const { led33Mat, led45Mat, strobeLightMat, faderKnob } = threeRef.current;
    if (led33Mat) led33Mat.emissiveIntensity = powerOn && rpm === 33 ? 1.7 : 0.05;
    if (led45Mat) led45Mat.emissiveIntensity = powerOn && rpm === 45 ? 1.7 : 0.05;
    if (strobeLightMat) strobeLightMat.emissiveIntensity = powerOn ? 1.6 : 0.04;
    if (faderKnob && !runtimeRef.current.draggingFader) {
      faderKnob.position.z = FADER_Z_BOT - (volumePct / 100) * (FADER_Z_BOT - FADER_Z_TOP);
    }

    vinylFoley.setCrackleLoop(activeTab === "studio" && powerOn && isPlaying && crackle);
    runtimeRef.current.invalidate(DIRTY_WEBGL);
  }, [isPlaying, motorOn, powerOn, rpm, volumePct, crackle, activeTab]);

  // 9. Sync Lighting, Finish & Dust Lid
  useEffect(() => {
    const { keySpot, lampBulbMat } = threeRef.current;
    if (keySpot) keySpot.intensity = lampOn ? 44 : 7;
    if (lampBulbMat) lampBulbMat.color.setHex(lampOn ? 0xffe4b5 : 0x3b2c20);
    runtimeRef.current.invalidate(DIRTY_WEBGL);
  }, [lampOn]);

  useEffect(() => {
    const { stylusSpot, stylusLensMat } = threeRef.current;
    if (stylusSpot) stylusSpot.intensity = stylusLightOn ? 5.5 : 0;
    if (stylusLensMat) stylusLensMat.color.setHex(stylusLightOn ? 0xffdfa8 : 0x2c241d);
    runtimeRef.current.invalidate(DIRTY_WEBGL);
  }, [stylusLightOn]);

  useEffect(() => {
    const { plinthSideMat, plinthWoodMat, plinthTopMat, plinthBody } = threeRef.current;
    if (!plinthSideMat || !plinthWoodMat || !plinthTopMat || !plinthBody) return;
    const cfg = FINISH_CONFIG[finish];
    plinthSideMat.color.setHex(cfg.plinthHex);
    plinthSideMat.roughness = cfg.roughness;
    plinthSideMat.metalness = cfg.metalness;
    plinthSideMat.needsUpdate = true;

    const sideMat = cfg.useWood ? plinthWoodMat : plinthSideMat;
    if (Array.isArray(plinthBody.material)) {
      plinthBody.material[0] = sideMat;
      plinthBody.material[1] = sideMat;
      plinthBody.material[4] = sideMat;
      plinthBody.material[5] = sideMat;
    }

    if (plinthTopMat.map) plinthTopMat.map.dispose();
    plinthTopMat.map = makeTopPlateTexture(cfg.topBg, cfg.topInk);
    plinthTopMat.roughness = cfg.roughness;
    plinthTopMat.metalness = cfg.metalness;
    plinthTopMat.needsUpdate = true;
    runtimeRef.current.invalidate(DIRTY_WEBGL);
  }, [finish]);

  useEffect(() => {
    const { lidPivot } = threeRef.current;
    if (!lidPivot) return;
    runtimeRef.current.activeTweens++;
    gsap.to(lidPivot.rotation, {
      x: lidOpen ? -0.78 : 0,
      duration: 0.7,
      ease: "power3.inOut",
      onUpdate: () => runtimeRef.current.invalidate(DIRTY_WEBGL | DIRTY_SHADOW),
      onComplete: () => {
        runtimeRef.current.activeTweens = Math.max(0, runtimeRef.current.activeTweens - 1);
      },
    });
  }, [lidOpen]);

  const isStudio = activeTab === "studio";

  return (
    <>
      <div
        className={`fixed inset-0 transition-opacity duration-300 ${
          isStudio ? "z-0 opacity-100 pointer-events-auto" : "-z-10 opacity-0 pointer-events-none"
        }`}
      >
        <div ref={containerRef} className="w-full h-full" data-testid="persistent-3d-canvas" />
        <div className="vignette" />
        <div className="grain" />
      </div>

      {/*
        CSS3D Layer lives OUTSIDE the opacity-0 wrapper so when the user switches to any of the
        11 analytics tabs, the YouTube iframe remains compositor-visible (opacity 0.01 offscreen)
        without reloading, guaranteeing Play buttons work 100% across every tab!
      */}
      <div
        ref={css3dMountRef}
        className={
          isStudio
            ? "fixed inset-0 z-[1] pointer-events-none"
            : "fixed left-[-9999px] top-0 w-[240px] h-[148px] opacity-[0.01] pointer-events-none"
        }
      />

      {/* Portal target adopted into CSS3DObject on mount */}
      <div className="hidden">
        <div
          ref={plinthScreenDomRef}
          id="turntable-css3d-screen"
          data-testid="turntable-digital-display"
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
          className="w-[240px] h-[148px] bg-[#080605] border border-brass/70 rounded-[3px] overflow-hidden shadow-2xl pointer-events-auto select-none"
        />
      </div>
    </>
  );
};
