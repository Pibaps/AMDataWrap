/**
 * Persistent 3D Listening Room ("Salon d'écoute") — AMDataWrap V4.
 *
 * Refinements from user feedback:
 * 1. Physical Crate Geometry (Zero Box Collision + Exclusive Presence + Physical Pull-Out/Return):
 *    - Sleeves inside the oak crate stand safely behind the front oak panel (`z` from `+0.72` to `-1.12`)
 *      with a gentle lean (`+0.26 rad` max) so they NEVER poke through the front wooden wall!
 *    - When an album is currently placed on the turntable platter & wooden easel on the left (`onPlatter`),
 *      its slot in the right crate is physically empty (`visible = false`) — a record cannot be in two places at once!
 *    - Clicking a sleeve in the crate slides it physically UP and OUT of the crate (`INSPECT`),
 *      and clicking the crate or the "Ranger dans le bac" 3D action slides it smoothly back into its slot.
 * 2. 100% 3D Interactions (Zero 2D Pop-up Menu when inspecting or playing a vinyl):
 *    - No 2D tracklist drawer pops up on the right anymore!
 *    - All tracks are selectable directly on the 3D vinyl record (hovering any groove band on the platter
 *      highlights the track title & number in the tooltip; clicking drops the diamond stylus onto that track)
 *      or by flipping the 3D jacket to read its printed back cover.
 * 3. Opaque Back-Face Culling on the CSS3D YouTube Plinth Screen:
 *    - `backfaceVisibility: "hidden"` on the CSS3D screen + dynamic dot-product visibility check with the camera
 *      so looking at the turntable from behind shows only the solid metal housing, never the iframe through the back!
 * 4. Real Interactive 3D Linear Volume Fader (`VOLUME · GAIN 0–100%`) on the Right of the Plinth:
 *    - Clicking or dragging along the 3D fader slot slides the machined aluminum fader knob smoothly
 *      and controls the real YouTube / Audio volume in real time (`0%` to `100%`) with tactile detent ticks.
 * 5. Unique, Logical Mechanical Foley Sounds for every 3D interaction.
 */

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CSS3DRenderer, CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import gsap from "gsap";
import {
  API,
  apiGet,
  buildQueryParams,
  coverUrl,
  formatDurationMs,
  type TurntableFinish,
  type VinylCrateAlbum,
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
  averageColor,
  getGenericBackTexture,
  makeBackCoverTexture,
  makeButtonTexture,
  makeCoverTexture,
  makeDialSideTexture,
  makeFeltTexture,
  makeGrooveMaps,
  makeLabelTexture,
  makePlasterTexture,
  makeRibTexture,
  makeStrobeTexture,
  makeTopPlateTexture,
  makeWoodTexture,
  radiusForSideTime,
} from "./textures";

const PLATTER_X = -0.55;
const PLATTER_Z = 0.0;
const ARM_PIVOT_X = 1.18;
const ARM_PIVOT_Z = -1.27;
const ARM_EFFECTIVE_LEN = 2.18;

// Fader Z range in turntableGroup local coordinates
const FADER_Z_TOP = 0.25; // 100% volume
const FADER_Z_BOT = 1.45; // 0% volume

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

/** Given a radius on the platter, finds which track index of the active side sits at that groove radius. */
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

const ARM_REST_YAW = -0.02;

const FINISH_CONFIG: Record<
  TurntableFinish,
  {
    topBg: string;
    topInk: string;
    plinthHex: number;
    roughness: number;
    metalness: number;
    useWood: boolean;
  }
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

const MAX_CRATE_SLEEVES = 20;
const SLEEVE_SIZE = 2.12;
const SLEEVE_THICK = 0.042;
const CRATE_SORTS = ["top", "recent", "era", "genre", "random"];

interface CrateSleeveSlot {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  frontMat: THREE.MeshStandardMaterial;
  spineMat: THREE.MeshStandardMaterial;
  albumKey: string | null;
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
  const lidOpen = useV4Store((s) => s.lidOpen);
  const lampOn = useV4Store((s) => s.lampOn);
  const stylusLightOn = useV4Store((s) => s.stylusLightOn);
  const crate = useV4Store((s) => s.crate);
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
    draggingFader: false,
    lastDetentBucket: -1,
    keysPressed: new Set<string>(),
  });

  const coverTexCacheRef = useRef<
    Map<string, { tex: THREE.CanvasTexture; img: HTMLImageElement | null; accent: string }>
  >(new Map());

  const threeRef = useRef<{
    renderer?: THREE.WebGLRenderer;
    css3dRenderer?: CSS3DRenderer;
    scene?: THREE.Scene;
    css3dScene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    controls?: OrbitControls;
    turntableGroup?: THREE.Group;
    platterSpinGroup?: THREE.Group;
    recordMesh?: THREE.Mesh;
    recordMat?: THREE.MeshStandardMaterial;
    labelMesh?: THREE.Mesh;
    labelMat?: THREE.MeshStandardMaterial;
    tonearmYawGroup?: THREE.Group;
    tonearmPitchGroup?: THREE.Group;
    lidPivot?: THREE.Group;
    plinthSideMat?: THREE.MeshStandardMaterial;
    plinthTopMat?: THREE.MeshStandardMaterial;
    led33Mat?: THREE.MeshStandardMaterial;
    led45Mat?: THREE.MeshStandardMaterial;
    startBtn?: THREE.Mesh;
    btn33?: THREE.Mesh;
    btn45?: THREE.Mesh;
    walnutPlinthTex?: THREE.CanvasTexture;
    keySpot?: THREE.SpotLight;
    lampBulbMat?: THREE.MeshBasicMaterial;
    stylusSpot?: THREE.SpotLight;
    stylusLensMat?: THREE.MeshBasicMaterial;
    faderKnob?: THREE.Mesh;
    faderSlot?: THREE.Mesh;
    oledConsoleGroup?: THREE.Group;
    crateGroup?: THREE.Group;
    crateSlots: CrateSleeveSlot[];
    inspectGroup?: THREE.Group;
    inspectSleeveGroup?: THREE.Group;
    inspectFrontMat?: THREE.MeshStandardMaterial;
    inspectBackMat?: THREE.MeshStandardMaterial;
    inspectDiscMesh?: THREE.Mesh;
    inspectDiscLabelMat?: THREE.MeshStandardMaterial;
    easelFrontMat?: THREE.MeshStandardMaterial;
    interactables: THREE.Object3D[];
  }>({ crateSlots: [], interactables: [] });

  const loadAlbumCoverTexture = (
    albumKey: string,
    artworkUrl: string | null | undefined,
    title: string,
    artist: string,
    seed: number,
    onReady: (entry: { tex: THREE.CanvasTexture; img: HTMLImageElement | null; accent: string }) => void
  ) => {
    const cache = coverTexCacheRef.current;
    const hit = cache.get(albumKey);
    if (hit && hit.img) {
      onReady(hit);
      return;
    }
    if (!hit) {
      const fallbackTex = makeCoverTexture(null, { title, artist, seed }, 256);
      const placeholder = { tex: fallbackTex, img: null, accent: "#b8723c" };
      cache.set(albumKey, placeholder);
    }
    onReady(cache.get(albumKey)!);

    const proxied = coverUrl(artworkUrl, 256);
    if (!proxied) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const prev = cache.get(albumKey);
      const hiTex = makeCoverTexture(img, { title, artist, seed }, 256);
      if (prev?.tex && prev.tex !== hiTex) {
        prev.tex.dispose();
      }
      const accent = averageColor(img);
      const entry = { tex: hiTex, img, accent };
      cache.set(albumKey, entry);
      onReady(entry);
    };
    img.src = proxied;
  };

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
        powerPreference: "high-performance",
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
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const css3dRenderer = new CSS3DRenderer();
    css3dRenderer.setSize(width, height);
    css3dRenderer.domElement.style.position = "absolute";
    css3dRenderer.domElement.style.inset = "0";
    css3dRenderer.domElement.style.pointerEvents = "none";
    css3dMount.innerHTML = "";
    css3dMount.appendChild(css3dRenderer.domElement);

    const scene = new THREE.Scene();
    const css3dScene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0a08);
    scene.fog = new THREE.FogExp2(0x0d0a08, 0.025);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.045).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.72;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 70);
    camera.position.set(0.2, 4.85, 8.85);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.1, 0.55, -0.2);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.485;
    controls.minDistance = 2.4;
    controls.maxDistance = 16.5;
    controls.rotateSpeed = 0.78;
    controls.panSpeed = 0.78;
    controls.zoomSpeed = 0.9;
    controls.update();

    // =========================================================================
    // A. WARM LISTENING ROOM LIGHTING & ARCHITECTURE
    // =========================================================================
    const hemi = new THREE.HemisphereLight(0xf6d9b8, 0x1a120d, 0.6);
    scene.add(hemi);

    const keySpot = new THREE.SpotLight(0xffcf96, 36, 24, Math.PI * 0.36, 0.65, 1.3);
    keySpot.position.set(3.2, 5.1, 2.2);
    keySpot.target.position.set(-0.3, 0, -0.1);
    keySpot.castShadow = true;
    keySpot.shadow.mapSize.set(512, 512);
    keySpot.shadow.bias = -0.0005;
    scene.add(keySpot);
    scene.add(keySpot.target);

    const grooveRim = new THREE.DirectionalLight(0xffdfb8, 1.35);
    grooveRim.position.set(-4.0, 3.8, -3.2);
    scene.add(grooveRim);

    const frontFill = new THREE.PointLight(0xe89b55, 2.1, 14);
    frontFill.position.set(0.2, 2.6, 5.0);
    scene.add(frontFill);

    // Solid Walnut Credenza
    const tableWoodTex = makeWoodTexture("#56351e", "#26150a", { size: 256, rings: 20, seed: 2 });
    tableWoodTex.repeat.set(2.4, 1.4);
    const tableMat = new THREE.MeshStandardMaterial({
      map: tableWoodTex,
      roughness: 0.48,
      metalness: 0.06,
    });
    const tableMesh = new THREE.Mesh(new THREE.BoxGeometry(17.5, 0.55, 8.6), tableMat);
    tableMesh.position.set(0.3, -0.34, -0.2);
    tableMesh.receiveShadow = true;
    scene.add(tableMesh);

    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xc9a86b,
      roughness: 0.25,
      metalness: 0.88,
    });
    const credenzaTrim = new THREE.Mesh(new THREE.BoxGeometry(17.5, 0.025, 0.03), brassMat);
    credenzaTrim.position.set(0.3, -0.1, 4.1);
    scene.add(credenzaTrim);

    // Warm Plaster Back Wall + Acoustic Slat Panel
    const plasterTex = makePlasterTexture(256);
    plasterTex.repeat.set(4, 2);
    const wallMat = new THREE.MeshStandardMaterial({
      map: plasterTex,
      roughness: 0.92,
      metalness: 0.02,
    });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), wallMat);
    backWall.position.set(0, 4.6, -3.8);
    backWall.receiveShadow = true;
    scene.add(backWall);

    const slatGroup = new THREE.Group();
    slatGroup.position.set(-1.1, 3.3, -3.72);
    const slatFrame = new THREE.Mesh(
      new THREE.BoxGeometry(6.2, 2.6, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x17120e, roughness: 0.9 })
    );
    slatGroup.add(slatFrame);
    const slatGeo = new THREE.BoxGeometry(0.11, 2.44, 0.11);
    const slatInst = new THREE.InstancedMesh(slatGeo, tableMat, 30);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 30; i++) {
      dummy.position.set(-2.75 + i * 0.19, 0, 0.04);
      dummy.updateMatrix();
      slatInst.setMatrixAt(i, dummy.matrix);
    }
    slatGroup.add(slatInst);
    scene.add(slatGroup);

    // Interactive Brass Studio Lamp
    const lampGroup = new THREE.Group();
    lampGroup.position.set(5.6, -0.06, -1.75);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 0.1, 24), brassMat);
    lampBase.position.y = 0.05;
    lampBase.userData = { action: "toggle-lamp", hint: "Lampe d'architecte · Cliquer pour allumer / éteindre" };
    lampGroup.add(lampBase);
    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.85, 12), brassMat);
    lampStem.position.y = 1.48;
    lampStem.userData = lampBase.userData;
    lampGroup.add(lampStem);
    const lampShade = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 0.52, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })
    );
    lampShade.position.set(-0.32, 2.85, 0.2);
    lampShade.rotation.z = 0.42;
    lampShade.userData = lampBase.userData;
    lampGroup.add(lampShade);
    const lampBulbMat = new THREE.MeshBasicMaterial({ color: 0xffe4b5 });
    const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), lampBulbMat);
    lampBulb.position.set(-0.36, 2.72, 0.2);
    lampGroup.add(lampBulb);
    scene.add(lampGroup);

    // =========================================================================
    // B. NOW-PLAYING WOODEN EASEL ("CHEVALET") ON THE LEFT
    // =========================================================================
    const easelGroup = new THREE.Group();
    easelGroup.position.set(-4.55, -0.06, -0.45);
    easelGroup.rotation.y = 0.36;
    scene.add(easelGroup);

    const easelBase = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.12, 0.52), tableMat);
    easelBase.position.y = 0.06;
    easelBase.castShadow = true;
    easelGroup.add(easelBase);

    const easelLip = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.1, 0.06), brassMat);
    easelLip.position.set(0, 0.14, 0.21);
    easelGroup.add(easelLip);

    const easelBackSupport = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.65, 0.07), tableMat);
    easelBackSupport.position.set(0, 0.88, -0.12);
    easelBackSupport.rotation.x = -0.16;
    easelGroup.add(easelBackSupport);

    const easelFrontMat = new THREE.MeshStandardMaterial({
      map: makeCoverTexture(null, { title: "Salon d'écoute", artist: "Choisis un vinyle", seed: 1 }, 256),
      roughness: 0.48,
      metalness: 0.04,
    });
    const easelCardMat = new THREE.MeshStandardMaterial({ color: 0xd6cab8, roughness: 0.78 });
    const easelBackMat = new THREE.MeshStandardMaterial({ map: getGenericBackTexture(), roughness: 0.65 });
    const easelSleeveMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.92, 1.92, 0.045),
      [easelCardMat, easelCardMat, easelCardMat, easelCardMat, easelFrontMat, easelBackMat]
    );
    easelSleeveMesh.position.set(0, 1.06, 0.05);
    easelSleeveMesh.rotation.x = -0.15;
    easelSleeveMesh.castShadow = true;
    easelSleeveMesh.userData = {
      action: "inspect-platter",
      hint: "Chevalet Now Playing · Cliquer pour soulever la pochette en 3D et voir son verso",
    };
    easelGroup.add(easelSleeveMesh);

    // =========================================================================
    // C. DETAILED DIRECT-DRIVE TURNTABLE + OPAQUE-BACK 3D CSS3D YOUTUBE SCREEN
    // =========================================================================
    const turntableGroup = new THREE.Group();
    turntableGroup.position.set(-1.05, -0.06, 0.18);
    scene.add(turntableGroup);

    const walnutPlinthTex = makeWoodTexture("#633a1f", "#2b160a", { size: 256, rings: 16, seed: 7 });
    const fCfg = FINISH_CONFIG[finish];
    const plinthSideMat = new THREE.MeshStandardMaterial({
      color: fCfg.plinthHex,
      map: fCfg.useWood ? walnutPlinthTex : null,
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

    const subChassis = new THREE.Mesh(
      new RoundedBoxGeometry(PLINTH_W - 0.08, 0.16, PLINTH_D - 0.08, 3, 0.05),
      darkRubberMat
    );
    subChassis.position.y = 0.14;
    subChassis.castShadow = true;
    subChassis.receiveShadow = true;
    turntableGroup.add(subChassis);

    const plinthBody = new THREE.Mesh(
      new RoundedBoxGeometry(PLINTH_W, 0.22, PLINTH_D, 4, 0.045),
      [plinthSideMat, plinthSideMat, plinthTopMat, darkRubberMat, plinthSideMat, plinthSideMat]
    );
    plinthBody.position.y = 0.29;
    plinthBody.castShadow = true;
    plinthBody.receiveShadow = true;
    turntableGroup.add(plinthBody);

    // 4 Damped Isolation Feet
    const footCoords: [number, number][] = [
      [-1.88, -1.42],
      [1.88, -1.42],
      [-1.88, 1.42],
      [1.88, 1.42],
    ];
    for (const [fx, fz] of footCoords) {
      const footRubber = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.11, 20), darkRubberMat);
      footRubber.position.set(fx, 0.055, fz);
      turntableGroup.add(footRubber);
      const footRing = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.035, 20), brushedAluMat);
      footRing.position.set(fx, 0.11, fz);
      turntableGroup.add(footRing);
    }

    // Platter Well + Rotating Platter
    const platterWell = new THREE.Mesh(
      new THREE.CylinderGeometry(1.66, 1.66, 0.02, 48),
      new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.85 })
    );
    platterWell.position.set(PLATTER_X, 0.402, PLATTER_Z);
    turntableGroup.add(platterWell);

    const platterSpinGroup = new THREE.Group();
    platterSpinGroup.position.set(PLATTER_X, 0.41, PLATTER_Z);
    turntableGroup.add(platterSpinGroup);

    const strobeTex = makeStrobeTexture();
    const strobeRimMat = new THREE.MeshStandardMaterial({
      map: strobeTex,
      roughness: 0.28,
      metalness: 0.82,
    });
    const platterRim = new THREE.Mesh(
      new THREE.CylinderGeometry(1.56, 1.63, 0.11, 56, 1, true),
      strobeRimMat
    );
    platterRim.position.y = 0.055;
    platterSpinGroup.add(platterRim);

    const platterTop = new THREE.Mesh(new THREE.CylinderGeometry(1.56, 1.56, 0.02, 48), brushedAluMat);
    platterTop.position.y = 0.11;
    platterTop.receiveShadow = true;
    platterSpinGroup.add(platterTop);

    const slipmatMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.51, 1.51, 0.014, 48),
      new THREE.MeshStandardMaterial({ map: makeFeltTexture(256), roughness: 0.94, metalness: 0.02 })
    );
    slipmatMesh.position.y = 0.125;
    slipmatMesh.receiveShadow = true;
    platterSpinGroup.add(slipmatMesh);

    const initialGrooves = makeGrooveMaps(undefined, "#0e0e10", 384);
    const recordMat = new THREE.MeshStandardMaterial({
      map: initialGrooves.map,
      roughness: 0.24,
      metalness: 0.18,
    });
    const recordMesh = new THREE.Mesh(new THREE.CylinderGeometry(RECORD_R, RECORD_R, 0.022, 56), recordMat);
    recordMesh.position.y = 0.145;
    recordMesh.castShadow = true;
    recordMesh.receiveShadow = true;
    recordMesh.userData = {
      action: "groove-seek",
      hint: "Sillons 12\" · Cliquer sur un sillon pour choisir directement la piste",
    };
    platterSpinGroup.add(recordMesh);

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
        256
      ),
      roughness: 0.58,
      metalness: 0.04,
      transparent: true,
    });
    const labelMesh = new THREE.Mesh(new THREE.CylinderGeometry(LABEL_R, LABEL_R, 0.026, 40), labelMat);
    labelMesh.position.y = 0.147;
    labelMesh.userData = {
      action: "flip-disc-side",
      hint: "Macaron central · Cliquer pour retourner le vinyle (Face A ↔ Face B)",
    };
    platterSpinGroup.add(labelMesh);

    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.24, 16), chromeMat);
    spindle.position.y = 0.21;
    platterSpinGroup.add(spindle);

    const adapter45 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 24), brushedAluMat);
    adapter45.position.set(-1.92, 0.415, -1.12);
    turntableGroup.add(adapter45);

    // =========================================================================
    // PHYSICAL TURNTABLE CONTROLS & REAL DRAGGABLE VOLUME FADER (0–100%)
    // =========================================================================
    const powerTurret = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.15, 20), darkMetalMat);
    powerTurret.position.set(-1.98, 0.46, 1.05);
    powerTurret.userData = {
      action: "toggle-power",
      hint: "Commutateur rotatif POWER · Démarrer / couper le moteur quartz",
    };
    turntableGroup.add(powerTurret);

    const strobeLightMat = new THREE.MeshStandardMaterial({
      color: 0xff3b1f,
      emissive: 0xff2a00,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    });
    const strobeWindow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.16), strobeLightMat);
    strobeWindow.position.set(-1.84, 0.45, 1.05);
    turntableGroup.add(strobeWindow);

    const startBezel = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.03, 0.38), brushedAluMat);
    startBezel.position.set(-1.45, 0.41, 1.48);
    turntableGroup.add(startBezel);

    const startBtnMat = new THREE.MeshStandardMaterial({
      map: makeButtonTexture("START · STOP", "#1e1c1a", "#ede2d2"),
      roughness: 0.3,
      metalness: 0.7,
    });
    const startBtn = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.065, 0.32), startBtnMat);
    startBtn.position.set(-1.45, 0.435, 1.48);
    startBtn.userData = {
      action: "toggle-start",
      hint: "Bouton START · STOP · Démarrer ou mettre en pause le vinyle",
    };
    turntableGroup.add(startBtn);

    const btn33 = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.06, 0.22),
      new THREE.MeshStandardMaterial({ map: makeButtonTexture("33", "#262320", "#ede2d2"), roughness: 0.35 })
    );
    btn33.position.set(-0.98, 0.43, 1.48);
    btn33.userData = { action: "rpm-33", hint: "Micro-switch 33⅓ RPM" };
    turntableGroup.add(btn33);

    const led33Mat = new THREE.MeshStandardMaterial({
      color: 0xff5a26,
      emissive: 0xff4500,
      emissiveIntensity: 1.6,
    });
    const led33 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.022, 0.04), led33Mat);
    led33.position.set(-0.98, 0.445, 1.34);
    turntableGroup.add(led33);

    const btn45 = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.06, 0.22),
      new THREE.MeshStandardMaterial({ map: makeButtonTexture("45", "#262320", "#ede2d2"), roughness: 0.35 })
    );
    btn45.position.set(-0.68, 0.43, 1.48);
    btn45.userData = { action: "rpm-45", hint: "Micro-switch 45 RPM" };
    turntableGroup.add(btn45);

    const led45Mat = new THREE.MeshStandardMaterial({
      color: 0x3a2018,
      emissive: 0xff4500,
      emissiveIntensity: 0.05,
    });
    const led45 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.022, 0.04), led45Mat);
    led45.position.set(-0.68, 0.445, 1.34);
    turntableGroup.add(led45);

    // Pop-up Stylus Target Light
    const stylusLampTower = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.14, 16), brushedAluMat);
    stylusLampTower.position.set(0.55, 0.45, 1.16);
    stylusLampTower.userData = {
      action: "toggle-stylus-light",
      hint: "Lampe cible du diamant · Allumer / éteindre le faisceau rasant",
    };
    turntableGroup.add(stylusLampTower);

    const stylusLensMat = new THREE.MeshBasicMaterial({ color: 0xffdfa8 });
    const stylusLampLens = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 10), stylusLensMat);
    stylusLampLens.position.set(0.51, 0.49, 1.13);
    turntableGroup.add(stylusLampLens);

    const stylusSpot = new THREE.SpotLight(0xffcf87, 5.5, 4.2, Math.PI * 0.25, 0.7, 1.5);
    stylusSpot.position.set(0.51, 0.52, 1.12);
    stylusSpot.target.position.set(PLATTER_X + 0.5, 0.42, PLATTER_Z + 0.2);
    turntableGroup.add(stylusSpot);
    turntableGroup.add(stylusSpot.target);

    // Real Draggable Linear Volume Fader (0% to 100%) on the right side of the plinth!
    const faderSlot = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.025, 1.38),
      new THREE.MeshStandardMaterial({ color: 0x090807, roughness: 0.9 })
    );
    faderSlot.position.set(1.85, 0.405, 0.85);
    faderSlot.userData = {
      action: "volume-fader",
      hint: `Fader VOLUME · GAIN (${useV4Store.getState().volumePct}%) · Cliquer ou glisser pour régler le volume du tourne-disque`,
    };
    turntableGroup.add(faderSlot);

    const initVolRatio = useV4Store.getState().volumePct / 100;
    const initFaderZ = FADER_Z_BOT - initVolRatio * (FADER_Z_BOT - FADER_Z_TOP);

    const faderKnob = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.2), brushedAluMat);
    faderKnob.position.set(1.85, 0.46, initFaderZ);
    faderKnob.userData = faderSlot.userData;
    turntableGroup.add(faderKnob);

    const quartzLed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.02, 12),
      new THREE.MeshStandardMaterial({ color: 0x6ee7b7, emissive: 0x10b981, emissiveIntensity: 1.1 })
    );
    quartzLed.position.set(1.58, 0.415, 0.85);
    turntableGroup.add(quartzLed);

    // =========================================================================
    // FIXED 3D CSS3D YOUTUBE CONSOLE WITH OPAQUE BACK-FACE CULLING
    // =========================================================================
    const oledConsoleGroup = new THREE.Group();
    oledConsoleGroup.position.set(-0.5, -0.06, 0.18 + 1.88);
    oledConsoleGroup.rotation.x = -0.62;
    scene.add(oledConsoleGroup);

    const oledHousing = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.88, 0.08, 3, 0.02), darkMetalMat);
    oledConsoleGroup.add(oledHousing);

    const oledBrassFrame = new THREE.Mesh(new RoundedBoxGeometry(1.36, 0.82, 0.084, 2, 0.015), brassMat);
    oledConsoleGroup.add(oledBrassFrame);

    // Ensure CSS backface-visibility is hidden so the DOM iframe is NEVER visible from behind the turntable
    screenDom.style.backfaceVisibility = "hidden";
    (screenDom.style as any).webkitBackfaceVisibility = "hidden";

    const css3dObject = new CSS3DObject(screenDom);
    css3dObject.scale.set(0.00535, 0.00535, 0.00535);
    css3dObject.position.copy(oledConsoleGroup.position);
    css3dObject.position.z += 0.036;
    css3dObject.position.y += 0.028;
    css3dObject.rotation.copy(oledConsoleGroup.rotation);
    css3dScene.add(css3dObject);

    // =========================================================================
    // TONEARM ASSEMBLY
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
    antiSkateDial.position.set(ARM_PIVOT_X + 0.54, 0.48, ARM_PIVOT_Z - 0.12);
    turntableGroup.add(antiSkateDial);

    const armRestPost = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.25, 12), darkMetalMat);
    armRestPost.position.set(ARM_PIVOT_X + 0.04, 0.54, ARM_PIVOT_Z + 0.68);
    turntableGroup.add(armRestPost);

    const cueLever = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.32, 10), chromeMat);
    cueLever.position.set(ARM_PIVOT_X + 0.25, 0.58, ARM_PIVOT_Z + 0.45);
    cueLever.rotation.z = -0.35;
    cueLever.userData = { action: "toggle-start", hint: "Levier de Cueing · Poser ou relever le bras de lecture" };
    turntableGroup.add(cueLever);

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

    const rearStub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 14), brushedAluMat);
    rearStub.rotation.x = Math.PI / 2;
    rearStub.position.set(0, 0, -0.32);
    tonearmPitchGroup.add(rearStub);

    const cwTextureMat = new THREE.MeshStandardMaterial({
      map: makeDialSideTexture(36, 4, true),
      roughness: 0.3,
      metalness: 0.7,
    });
    const counterweightBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.145, 0.145, 0.26, 24),
      [brushedAluMat, darkMetalMat, darkMetalMat]
    );
    counterweightBody.rotation.x = Math.PI / 2;
    counterweightBody.position.set(0, 0, -0.44);
    tonearmPitchGroup.add(counterweightBody);

    const counterweightScaleRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.148, 0.148, 0.07, 24),
      [cwTextureMat, darkMetalMat, darkMetalMat]
    );
    counterweightScaleRing.rotation.x = Math.PI / 2;
    counterweightScaleRing.position.set(0, 0, -0.3);
    tonearmPitchGroup.add(counterweightScaleRing);

    const sCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, 0.0, 0.0),
      new THREE.Vector3(0.06, 0.0, 0.58),
      new THREE.Vector3(0.09, 0.0, 1.12),
      new THREE.Vector3(-0.02, 0.0, 1.66),
      new THREE.Vector3(-0.14, -0.01, 2.02),
    ]);
    const sTubeGeo = new THREE.TubeGeometry(sCurve, 32, 0.03, 12, false);
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
    lockCollar.position.set(-0.14, -0.01, 2.02);
    tonearmPitchGroup.add(lockCollar);

    const headshellGroup = new THREE.Group();
    headshellGroup.position.set(-0.15, -0.01, 2.06);
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
    // AUTHENTIC OPEN-BOTTOM SMOKED-ACRYLIC DUST COVER
    // =========================================================================
    const hingeMat = new THREE.MeshStandardMaterial({ color: 0x272422, roughness: 0.4, metalness: 0.8 });
    [-1.45, 1.45].forEach((hx) => {
      const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.1), hingeMat);
      hinge.position.set(hx, 0.4, -PLINTH_D / 2 - 0.02);
      turntableGroup.add(hinge);
    });

    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.42, -PLINTH_D / 2);
    lidPivot.rotation.x = lidOpen ? -0.78 : 0;
    turntableGroup.add(lidPivot);

    const lidW = PLINTH_W - 0.06;
    const lidH = 0.54;
    const lidD = PLINTH_D - 0.06;
    const lidT = 0.022;

    const acrylicMat = new THREE.MeshStandardMaterial({
      color: 0xf4e8d1,
      transparent: true,
      opacity: 0.085,
      roughness: 0.08,
      metalness: 0.15,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const lidTopPanel = new THREE.Mesh(new THREE.BoxGeometry(lidW, lidT, lidD), acrylicMat);
    lidTopPanel.position.set(0, lidH, lidD / 2);
    lidTopPanel.userData = {
      action: "toggle-lid",
      hint: "Capot antipoussière en acrylique · Cliquer sur le bord supérieur pour ouvrir ou fermer",
    };
    lidPivot.add(lidTopPanel);

    const lidFrontPanel = new THREE.Mesh(new THREE.BoxGeometry(lidW, lidH, lidT), acrylicMat);
    lidFrontPanel.position.set(0, lidH / 2, lidD);
    lidFrontPanel.userData = lidTopPanel.userData;
    lidPivot.add(lidFrontPanel);

    const lidEdgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(lidW, lidH, lidD));
    const lidEdges = new THREE.LineSegments(
      lidEdgesGeo,
      new THREE.LineBasicMaterial({ color: 0xf5e8cf, transparent: true, opacity: 0.28 })
    );
    lidEdges.position.set(0, lidH / 2, lidD / 2);
    lidPivot.add(lidEdges);

    const lidHandle = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.04, 0.045), chromeMat);
    lidHandle.position.set(0, 0.06, lidD + 0.015);
    lidHandle.userData = lidTopPanel.userData;
    lidPivot.add(lidHandle);

    // =========================================================================
    // D. REAL PHYSICAL 3D WOODEN VINYL CRATE (NO SMALL BUTTONS, ZERO FRONT WALL COLLISION!)
    // =========================================================================
    const crateGroup = new THREE.Group();
    crateGroup.position.set(3.25, -0.06, 0.18);
    crateGroup.rotation.y = -0.22;
    scene.add(crateGroup);

    const oakTex = makeWoodTexture("#8b5a2b", "#472a12", { size: 256, rings: 16, seed: 11 });
    const oakMat = new THREE.MeshStandardMaterial({ map: oakTex, roughness: 0.55, metalness: 0.05 });

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
      hint: "Bac en chêne · Cliquer pour ranger la pochette inspectée dans le bac",
    };
    crateGroup.add(crateBottom);

    const crateFront = new THREE.Mesh(new THREE.BoxGeometry(CRATE_W, CRATE_H * 0.65, WALL_T), oakMat);
    crateFront.position.set(0, (CRATE_H * 0.65) / 2, CRATE_D / 2 - WALL_T / 2);
    crateFront.castShadow = true;
    crateFront.receiveShadow = true;
    crateFront.userData = crateBottom.userData;
    crateGroup.add(crateFront);

    const crateBack = new THREE.Mesh(new THREE.BoxGeometry(CRATE_W, CRATE_H, WALL_T), oakMat);
    crateBack.position.set(0, CRATE_H / 2, -CRATE_D / 2 + WALL_T / 2);
    crateBack.castShadow = true;
    crateBack.receiveShadow = true;
    crateBack.userData = crateBottom.userData;
    crateGroup.add(crateBack);

    [-CRATE_W / 2 + WALL_T / 2, CRATE_W / 2 - WALL_T / 2].forEach((sx) => {
      for (let si = 0; si < 3; si++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, 0.35, CRATE_D - WALL_T * 2), oakMat);
        slat.position.set(sx, 0.25 + si * 0.42, 0);
        slat.castShadow = true;
        slat.receiveShadow = true;
        slat.userData = crateBottom.userData;
        crateGroup.add(slat);
      }
    });

    // Clean Brass Index Plate on the front of the crate (no small `<` / `>` buttons!)
    const cratePlate = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.25, 0.025), brassMat);
    cratePlate.position.set(0, 0.48, CRATE_D / 2 + 0.008);
    cratePlate.userData = {
      action: "cycle-crate-sort",
      hint: "Plaque en laiton · Cliquer pour trier le bac (Top / Récents / Décennie / Genre / Aléatoire)",
    };
    crateGroup.add(cratePlate);
    const crateLabelInner = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 0.18, 0.028),
      new THREE.MeshStandardMaterial({
        map: makeButtonTexture("BAC  LP  33⅓", "#1a1410", "#e9dec9"),
        roughness: 0.5,
      })
    );
    crateLabelInner.position.set(0, 0.48, CRATE_D / 2 + 0.01);
    crateLabelInner.userData = cratePlate.userData;
    crateGroup.add(crateLabelInner);

    const crateSlots: CrateSleeveSlot[] = [];
    const sleeveGeo = new THREE.BoxGeometry(SLEEVE_SIZE, SLEEVE_SIZE, SLEEVE_THICK);
    const cardEdgeMat = new THREE.MeshStandardMaterial({ color: 0xd8ccb8, roughness: 0.82 });
    const genericBackMat = new THREE.MeshStandardMaterial({ map: getGenericBackTexture(), roughness: 0.68 });

    const interactables: THREE.Object3D[] = [
      startBtn,
      powerTurret,
      btn33,
      btn45,
      recordMesh,
      labelMesh,
      easelSleeveMesh,
      lidTopPanel,
      lidFrontPanel,
      lidHandle,
      lampBase,
      lampStem,
      lampShade,
      stylusLampTower,
      faderSlot,
      faderKnob,
      cueLever,
      sTubeMesh,
      headshellTop,
      cratePlate,
      crateLabelInner,
      crateFront,
      crateBack,
    ];

    for (let i = 0; i < MAX_CRATE_SLEEVES; i++) {
      const pivot = new THREE.Group();
      // Start at z = +0.72 (well behind the front wall at z = +1.48) so even when leaning forward (+0.26 rad),
      // the top edge of the sleeve (z + 2.12 * sin(0.26) = 0.72 + 0.54 = 1.26 < 1.44) NEVER touches the front wood!
      const zPos = 0.72 - i * 0.092;
      pivot.position.set((Math.sin(i * 2.1) - 0.5) * 0.02, 0.1, zPos);
      crateGroup.add(pivot);

      const frontMat = new THREE.MeshStandardMaterial({
        map: makeCoverTexture(null, { title: `LP #${i + 1}`, artist: "Collection", seed: i + 1 }, 256),
        roughness: 0.48,
        metalness: 0.04,
      });
      const spineMat = new THREE.MeshStandardMaterial({ color: 0xcabca6, roughness: 0.75 });

      const mesh = new THREE.Mesh(sleeveGeo, [
        cardEdgeMat,
        spineMat,
        spineMat,
        cardEdgeMat,
        frontMat,
        genericBackMat,
      ]);
      mesh.position.set(0, SLEEVE_SIZE / 2, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = {
        action: "crate-sleeve",
        slotIndex: i,
        hint: "Pochette LP 12\" · Cliquer pour la sortir physiquement du bac (molette pour feuilleter)",
      };
      pivot.add(mesh);

      interactables.push(mesh);
      crateSlots.push({ pivot, mesh, frontMat, spineMat, albumKey: null });
    }

    // =========================================================================
    // E. 3D FLOATING SLEEVE INSPECTOR (PULLS PHYSICALLY OUT OF THE CRATE & RETURNS TO IT)
    // =========================================================================
    const inspectGroup = new THREE.Group();
    inspectGroup.position.set(0.3, 1.95, 2.35);
    inspectGroup.rotation.x = -0.22;
    inspectGroup.visible = false;
    scene.add(inspectGroup);

    const inspectSleeveGroup = new THREE.Group();
    inspectGroup.add(inspectSleeveGroup);

    const inspectFrontMat = new THREE.MeshStandardMaterial({
      map: makeCoverTexture(null, { title: "Album", artist: "Artiste", seed: 99 }, 256),
      roughness: 0.42,
      metalness: 0.04,
    });
    const inspectBackMat = new THREE.MeshStandardMaterial({
      map: getGenericBackTexture(),
      roughness: 0.55,
      metalness: 0.03,
    });
    const inspectSleeveMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.15, 2.15, 0.055),
      [cardEdgeMat, cardEdgeMat, cardEdgeMat, cardEdgeMat, inspectFrontMat, inspectBackMat]
    );
    inspectSleeveMesh.castShadow = true;
    inspectSleeveMesh.userData = {
      action: "flip-inspect-sleeve",
      hint: "Pochette 12\" · Cliquer sur la pochette pour la retourner (Recto ↔ Verso tracklist) · Cliquer sur le bac pour la ranger",
    };
    inspectSleeveGroup.add(inspectSleeveMesh);
    interactables.push(inspectSleeveMesh);

    const inspectDiscMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.01, 1.01, 0.016, 48), recordMat);
    inspectDiscMesh.rotation.x = Math.PI / 2;
    inspectDiscMesh.position.set(0.0, 0, 0);
    inspectDiscMesh.castShadow = true;
    inspectDiscMesh.userData = {
      action: "place-on-platter",
      hint: "Disque vinyle 12\" · Cliquer sur le disque pour le poser sur le plateau SL-1200 et lancer la Face A",
    };
    inspectSleeveGroup.add(inspectDiscMesh);
    interactables.push(inspectDiscMesh);

    const inspectDiscLabelMat = new THREE.MeshStandardMaterial({
      map: labelMat.map,
      roughness: 0.55,
      transparent: true,
    });
    const inspectDiscLabel = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.019, 32), inspectDiscLabelMat);
    inspectDiscMesh.add(inspectDiscLabel);

    threeRef.current = {
      renderer,
      css3dRenderer,
      scene,
      css3dScene,
      camera,
      controls,
      turntableGroup,
      platterSpinGroup,
      recordMesh,
      recordMat,
      labelMesh,
      labelMat,
      tonearmYawGroup,
      tonearmPitchGroup,
      lidPivot,
      plinthSideMat,
      plinthTopMat,
      led33Mat,
      led45Mat,
      startBtn,
      btn33,
      btn45,
      walnutPlinthTex,
      keySpot,
      lampBulbMat,
      stylusSpot,
      stylusLensMat,
      faderKnob,
      faderSlot,
      oledConsoleGroup,
      crateGroup,
      crateSlots,
      inspectGroup,
      inspectSleeveGroup,
      inspectFrontMat,
      inspectBackMat,
      inspectDiscMesh,
      inspectDiscLabelMat,
      easelFrontMat,
      interactables,
    };

    // =========================================================================
    // F. RAYCASTING, DRAGGABLE 3D VOLUME FADER & FREE-CAM INTERACTION
    // =========================================================================
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downPos = { x: 0, y: 0 };

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const applyVolumeFromWorldPoint = (worldPt: THREE.Vector3) => {
      const localPt = turntableGroup.worldToLocal(worldPt.clone());
      const clampedZ = Math.max(FADER_Z_TOP, Math.min(FADER_Z_BOT, localPt.z));
      const ratio = 1 - (clampedZ - FADER_Z_TOP) / (FADER_Z_BOT - FADER_Z_TOP);
      const vol = Math.round(ratio * 100);
      faderKnob.position.z = clampedZ;
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

    const filterValidHit = (hits: THREE.Intersection[]) =>
      hits.find((h) => {
        if (!h.object.visible || h.object.parent?.visible === false || h.object.parent?.parent?.visible === false) {
          return false;
        }
        if ((h.object === lidTopPanel || h.object === lidFrontPanel) && useV4Store.getState().lidOpen && h.point.y < 1.25) {
          return false;
        }
        return true;
      });

    const onPointerMove = (e: PointerEvent) => {
      if (!runtimeRef.current.isStudio) return;
      updateNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(ndc, camera);

      // Live 3D Volume Fader dragging!
      if (runtimeRef.current.draggingFader) {
        const faderHits = raycaster.intersectObjects([faderSlot, plinthBody], false);
        if (faderHits.length > 0) {
          applyVolumeFromWorldPoint(faderHits[0].point);
        }
        return;
      }

      const hits = raycaster.intersectObjects(threeRef.current.interactables, false);
      const hit = filterValidHit(hits);
      if (hit) {
        renderer.domElement.style.cursor = "pointer";
        const act = hit.object.userData.action;
        runtimeRef.current.hoveredSlot = act === "crate-sleeve" ? hit.object.userData.slotIndex : -1;
        let hint: string | null = hit.object.userData.hint || null;
        const st = useV4Store.getState();
        if (act === "crate-sleeve") {
          const alb = st.crate[hit.object.userData.slotIndex];
          if (alb) hint = `${alb.album_name} — ${alb.artist_name} (${alb.plays} écoutes) · Cliquer pour sortir du bac`;
        } else if (act === "groove-seek" && st.onPlatter) {
          // Live groove track preview on the 3D vinyl record!
          const localPt = platterSpinGroup.worldToLocal(hit.point.clone());
          const r = Math.hypot(localPt.x, localPt.z);
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
          hint = `Fader VOLUME · GAIN (${st.volumePct}%) · Cliquer ou glisser sur la réglette`;
        }
        if (st.hoveredHint !== hint) {
          st.setHoveredHint(hint);
        }
      } else {
        renderer.domElement.style.cursor = "grab";
        runtimeRef.current.hoveredSlot = -1;
        if (useV4Store.getState().hoveredHint !== null) {
          useV4Store.getState().setHoveredHint(null);
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      downPos = { x: e.clientX, y: e.clientY };
      if (!runtimeRef.current.isStudio || e.button !== 0) return;
      updateNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects([faderKnob, faderSlot], false);
      if (hits.length > 0) {
        runtimeRef.current.draggingFader = true;
        controls.enabled = false;
        applyVolumeFromWorldPoint(hits[0].point);
      }
    };

    const pressButtonAnim = (mesh: THREE.Mesh | undefined, baseY: number) => {
      if (!mesh) return;
      gsap.fromTo(mesh.position, { y: baseY - 0.024 }, { y: baseY, duration: 0.22, ease: "back.out(2)" });
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
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(threeRef.current.interactables, false);
      const hit = filterValidHit(hits);

      const st = useV4Store.getState();

      // Clicking empty background while inspecting a sleeve returns it smoothly into the crate!
      if (!hit) {
        if (st.vinylStage === "INSPECT") {
          vinylFoley.playSleeveSlide(st.soundFx);
          st.setVinylStage("ROOM");
        }
        return;
      }

      const { action, slotIndex } = hit.object.userData;

      if (action === "return-to-crate") {
        if (st.vinylStage === "INSPECT") {
          vinylFoley.playSleeveSlide(st.soundFx);
          st.setVinylStage("ROOM");
        }
      } else if (action === "crate-sleeve" && typeof slotIndex === "number") {
        const album = st.crate[slotIndex];
        if (!album) return;
        // Clicking any sleeve in the crate focuses it AND pulls it physically out of the crate!
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
        vinylFoley.playRecordPlace(st.soundFx);
        window.setTimeout(() => vinylFoley.playNeedleDrop(useV4Store.getState().soundFx), 180);
        st.setOnPlatter(v);
        st.setActiveSideIndex(0);
        st.setMotorOn(true);
        st.setVinylStage("ROOM");
        const side = v.sides[0];
        const firstTrack = side?.tracks?.[0];
        if (firstTrack) {
          playTrack({
            song_name: firstTrack.title,
            artist_name: v.artist_name,
            album_name: v.album_name,
            artwork_url: v.artwork_url,
            track_key: firstTrack.track_key,
            preview_url: firstTrack.preview_url,
            duration_ms: firstTrack.duration_ms,
            vinyl: { album_key: v.album_key, sideIndex: 0, trackIndex: 0 },
          });
        }
      } else if (action === "toggle-power") {
        vinylFoley.playPowerToggle(st.soundFx);
        if (st.isPlaying) {
          st.setIsPlaying(false);
          st.setMotorOn(false);
        } else {
          st.setMotorOn(!st.motorOn);
        }
      } else if (action === "toggle-start") {
        vinylFoley.playStartStopButton(st.soundFx);
        pressButtonAnim(threeRef.current.startBtn, 0.435);
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
              artist_name: st.onPlatter.artist_name,
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
          vinylFoley.playRecordPlace(st.soundFx);
          const count = Math.max(1, st.onPlatter.sides?.length || 2);
          const nextSideIdx = (st.activeSideIndex + 1) % count;
          st.setActiveSideIndex(nextSideIdx);
          // Automatically start the first track of the new side if the turntable was playing!
          const nextSide = st.onPlatter.sides[nextSideIdx];
          const firstTrack = nextSide?.tracks?.[0];
          if (st.isPlaying && firstTrack) {
            playTrack({
              song_name: firstTrack.title,
              artist_name: st.onPlatter.artist_name,
              album_name: st.onPlatter.album_name,
              artwork_url: st.onPlatter.artwork_url,
              track_key: firstTrack.track_key,
              preview_url: firstTrack.preview_url,
              duration_ms: firstTrack.duration_ms,
              vinyl: { album_key: st.onPlatter.album_key, sideIndex: nextSideIdx, trackIndex: 0 },
            });
          }
        }
      } else if (action === "toggle-lid") {
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
        const localPt = platterSpinGroup.worldToLocal(hit.point.clone());
        const r = Math.hypot(localPt.x, localPt.z);
        if (r >= GROOVE_INNER_R && r <= GROOVE_OUTER_R) {
          const found = findTrackAtRadius(st.onPlatter, st.activeSideIndex, r);
          if (found) {
            vinylFoley.playNeedleDrop(st.soundFx);
            st.setMotorOn(true);
            playTrack({
              song_name: found.track.title,
              artist_name: st.onPlatter.artist_name,
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
    const onWheel = (e: WheelEvent) => {
      if (!runtimeRef.current.isStudio) return;
      if (runtimeRef.current.hoveredSlot >= 0) {
        e.stopPropagation();
        const now = performance.now();
        if (now - lastWheelAt < 70) return;
        lastWheelAt = now;
        const st = useV4Store.getState();
        const delta = e.deltaY > 0 ? 1 : -1;
        const maxIdx = Math.min(st.crate.length, MAX_CRATE_SLEEVES) - 1;
        const next = Math.max(0, Math.min(maxIdx, st.crateIndex + delta));
        if (next !== st.crateIndex) {
          vinylFoley.playCrateFlip(st.soundFx);
          st.setCrateIndex(next);
        }
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      runtimeRef.current.keysPressed.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      runtimeRef.current.keysPressed.delete(e.key.toLowerCase());
    };

    const dom = renderer.domElement;
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

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
    };
    onResize();
    window.addEventListener("resize", onResize);

    // =========================================================================
    // G. 60 FPS RENDER LOOP (AUTO-PAUSES WHEN NOT ON STUDIO TAB)
    // =========================================================================
    let rafId = 0;
    let lastTime = performance.now();
    const forwardVec = new THREE.Vector3();
    const rightVec = new THREE.Vector3();
    const moveVec = new THREE.Vector3();
    const screenNormal = new THREE.Vector3();
    const camToScreen = new THREE.Vector3();
    const screenWorldPos = new THREE.Vector3();

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      if (!runtimeRef.current.isStudio || document.visibilityState === "hidden") {
        lastTime = now;
        return;
      }
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const rt = runtimeRef.current;

      // 1. Free-Cam WASD / ZQSD keyboard flight
      const keys = rt.keysPressed;
      if (keys.size > 0) {
        camera.getWorldDirection(forwardVec);
        forwardVec.y = 0;
        forwardVec.normalize();
        rightVec.crossVectors(forwardVec, camera.up).normalize();
        moveVec.set(0, 0, 0);
        const speed = 4.2 * dt;
        if (keys.has("w") || keys.has("z")) moveVec.addScaledVector(forwardVec, speed);
        if (keys.has("s")) moveVec.addScaledVector(forwardVec, -speed);
        if (keys.has("d")) moveVec.addScaledVector(rightVec, speed);
        if (keys.has("a") || keys.has("q")) moveVec.addScaledVector(rightVec, -speed);
        if (keys.has("e")) moveVec.y += speed * 0.7;
        if (keys.has("c")) moveVec.y -= speed * 0.7;
        if (moveVec.lengthSq() > 0) {
          camera.position.add(moveVec);
          controls.target.add(moveVec);
        }
      }

      controls.update();

      // 2. Platter rotational inertia
      rt.platterVel += (rt.targetVel - rt.platterVel) * Math.min(1, dt * 3.8);
      if (Math.abs(rt.platterVel) > 0.0005) {
        platterSpinGroup.rotation.y -= rt.platterVel * dt;
      }

      // 3. Tonearm tracking across real groove radius
      const st = useV4Store.getState();
      const spinning = st.isPlaying || st.motorOn;
      if (st.isPlaying && st.onPlatter) {
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
      } else if (spinning && st.onPlatter) {
        rt.targetArmYaw = tonearmYawForRadius(GROOVE_OUTER_R);
        rt.targetArmPitch = -0.05;
      } else {
        rt.targetArmYaw = ARM_REST_YAW;
        rt.targetArmPitch = -0.09;
      }

      rt.armYaw += (rt.targetArmYaw - rt.armYaw) * Math.min(1, dt * 4.5);
      rt.armPitch += (rt.targetArmPitch - rt.armPitch) * Math.min(1, dt * 5.5);
      tonearmYawGroup.rotation.y = rt.armYaw;
      tonearmPitchGroup.rotation.x = rt.armPitch;

      // 4. Crate sleeves physical flip-through + EXCLUSIVE PRESENCE:
      //    If an album is currently on the turntable/easel (`onPlatter`) or pulled out for inspection (`INSPECT`),
      //    it is physically removed from the wooden crate so it isn't duplicated!
      const focusedIdx = st.crateIndex;
      const totalVisible = Math.min(st.crate.length, MAX_CRATE_SLEEVES);
      const platterKey = st.onPlatter?.album_key;
      const inspectedKey = st.vinylStage === "INSPECT" ? st.inspected?.album_key : null;

      for (let i = 0; i < MAX_CRATE_SLEEVES; i++) {
        const slot = crateSlots[i];
        const slotAlbumKey = st.crate[i]?.album_key;
        if (i >= totalVisible || (slotAlbumKey && (slotAlbumKey === platterKey || slotAlbumKey === inspectedKey))) {
          slot.mesh.visible = false;
          continue;
        }
        slot.mesh.visible = true;

        // Gentle forward tilt (+0.26 rad ≈ 15°) so sleeves never collide with the front wooden wall!
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

        slot.pivot.rotation.x += (targetTilt - slot.pivot.rotation.x) * Math.min(1, dt * 11);
        const desiredY = SLEEVE_SIZE / 2 + targetLift;
        slot.mesh.position.y += (desiredY - slot.mesh.position.y) * Math.min(1, dt * 12);
      }

      // 5. Opaque Back-Face Culling for the CSS3D YouTube screen:
      //    Hide the DOM screen whenever the camera looks at the back of the OLED console!
      oledConsoleGroup.getWorldPosition(screenWorldPos);
      screenNormal.set(0, 0, 1).applyQuaternion(oledConsoleGroup.quaternion);
      camToScreen.subVectors(camera.position, screenWorldPos).normalize();
      const facingCamera = screenNormal.dot(camToScreen) > 0.05;
      screenDom.style.visibility = facingCamera ? "visible" : "hidden";

      renderer.render(scene, camera);
      css3dRenderer.render(css3dScene, camera);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("wheel", onWheel, true);
      vinylFoley.setCrackleLoop(false);
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, []);

  // 2. Pause 3D loop & crackle when user switches to analytics tabs
  useEffect(() => {
    const isStudio = activeTab === "studio";
    runtimeRef.current.isStudio = isStudio;
    if (!isStudio) {
      vinylFoley.setCrackleLoop(false);
    }
  }, [activeTab]);

  // 3. Camera Preset Transitions + Physical Pull-Out Animation from the Wooden Crate!
  useEffect(() => {
    const { camera, controls, inspectGroup } = threeRef.current;
    if (!camera || !controls) return;

    if (vinylStage === "INSPECT" && inspected) {
      if (inspectGroup) {
        inspectGroup.visible = true;
        // Animate the sleeve physically rising out of the right oak crate toward the center inspection pose!
        gsap.fromTo(
          inspectGroup.position,
          { x: 2.8, y: 1.35, z: 0.45 },
          { x: 0.3, y: 1.95, z: 2.35, duration: 0.65, ease: "power3.out" }
        );
      }
      gsap.to(camera.position, { x: 0.35, y: 2.55, z: 6.1, duration: 0.75, ease: "power3.out" });
      gsap.to(controls.target, { x: 0.35, y: 1.65, z: 1.2, duration: 0.75, ease: "power3.out" });
    } else if (vinylStage === "TURNTABLE") {
      if (inspectGroup) inspectGroup.visible = false;
      gsap.to(camera.position, { x: -0.95, y: 3.9, z: 5.2, duration: 0.8, ease: "power3.out" });
      gsap.to(controls.target, { x: -1.05, y: 0.4, z: 0.25, duration: 0.8, ease: "power3.out" });
    } else if (vinylStage === "CRATE") {
      if (inspectGroup) inspectGroup.visible = false;
      gsap.to(camera.position, { x: 2.85, y: 3.6, z: 5.5, duration: 0.8, ease: "power3.out" });
      gsap.to(controls.target, { x: 3.1, y: 0.9, z: 0.1, duration: 0.8, ease: "power3.out" });
    } else if (vinylStage === "ROOM") {
      if (inspectGroup && inspectGroup.visible) {
        gsap.killTweensOf(inspectGroup.position);
        inspectGroup.visible = false;
      }
      gsap.to(camera.position, { x: 0.2, y: 4.85, z: 8.85, duration: 0.85, ease: "power3.out" });
      gsap.to(controls.target, { x: 0.1, y: 0.55, z: -0.2, duration: 0.85, ease: "power3.out" });
    } else if (vinylStage === "FREECAM") {
      if (inspectGroup) inspectGroup.visible = false;
    }
  }, [vinylStage, inspected]);

  // 4. Progressive cover loading onto the 3D wooden crate sleeves
  useEffect(() => {
    const slots = threeRef.current.crateSlots;
    if (!slots.length) return;

    const count = Math.min(crate.length, MAX_CRATE_SLEEVES);
    const applySlot = (i: number) => {
      const alb: VinylCrateAlbum = crate[i];
      const slot = slots[i];
      if (!alb || !slot || slot.albumKey === alb.album_key) return;
      slot.albumKey = alb.album_key;
      loadAlbumCoverTexture(alb.album_key, alb.artwork_url, alb.album_name, alb.artist_name, i + 1, (entry) => {
        if (slot.albumKey !== alb.album_key) return;
        slot.frontMat.map = entry.tex;
        slot.frontMat.needsUpdate = true;
        slot.spineMat.color.set(entry.accent);
      });
    };

    for (let i = 0; i < Math.min(5, count); i++) {
      applySlot(i);
    }
    const timer = window.setTimeout(() => {
      for (let i = 5; i < count; i++) {
        applySlot(i);
      }
    }, 200);

    const st = useV4Store.getState();
    if (!st.onPlatter && crate.length > 0) {
      const first = crate[0];
      const qs = buildQueryParams(st.filters);
      apiGet<VinylDetail>(`${API.vinyl(first.album_key)}${qs}`)
        .then((detail) => {
          if (!useV4Store.getState().onPlatter) {
            useV4Store.getState().setOnPlatter(detail);
            // Move crateIndex to 1 since album 0 is now on the platter!
            if (useV4Store.getState().crateIndex === 0 && crate.length > 1) {
              useV4Store.getState().setCrateIndex(1);
            }
          }
        })
        .catch(() => {});
    }

    return () => clearTimeout(timer);
  }, [crate]);

  // 5. Sync inspected 3D sleeve + smooth retraction when flipping Recto/Verso
  useEffect(() => {
    const { inspectFrontMat, inspectBackMat, inspectDiscLabelMat } = threeRef.current;
    if (!inspected || !inspectFrontMat || !inspectBackMat) return;

    loadAlbumCoverTexture(
      inspected.album_key,
      inspected.artwork_url,
      inspected.album_name,
      inspected.artist_name,
      77,
      (entry) => {
        inspectFrontMat.map = entry.tex;
        inspectFrontMat.needsUpdate = true;

        const backTex = makeBackCoverTexture(inspected, entry.img, entry.accent, 512);
        if (inspectBackMat.map && inspectBackMat.map !== getGenericBackTexture()) {
          inspectBackMat.map.dispose();
        }
        inspectBackMat.map = backTex;
        inspectBackMat.needsUpdate = true;

        if (inspectDiscLabelMat) {
          const side = inspected.sides[activeSideIndex] || inspected.sides[0];
          const lbl = makeLabelTexture(
            {
              album: inspected.album_name,
              artist: inspected.artist_name,
              label: inspected.label_name,
              catalog: inspected.catalog_number,
              year: inspected.release_year,
              side: side?.side || "A",
              tracks: side?.tracks || [],
            },
            entry.accent,
            rpm,
            256
          );
          if (inspectDiscLabelMat.map) inspectDiscLabelMat.map.dispose();
          inspectDiscLabelMat.map = lbl;
          inspectDiscLabelMat.needsUpdate = true;
        }
      }
    );
  }, [inspected, activeSideIndex, rpm]);

  useEffect(() => {
    const { inspectSleeveGroup, inspectDiscMesh } = threeRef.current;
    if (!inspectSleeveGroup || !inspectDiscMesh) return;

    if (sleeveFlipped) {
      gsap
        .timeline()
        .to(inspectDiscMesh.position, { x: 0.0, duration: 0.25, ease: "power2.inOut" })
        .set(inspectDiscMesh, { visible: false })
        .to(inspectSleeveGroup.rotation, { y: Math.PI, duration: 0.55, ease: "power3.inOut" });
    } else {
      gsap
        .timeline()
        .to(inspectSleeveGroup.rotation, { y: 0, duration: 0.55, ease: "power3.inOut" })
        .set(inspectDiscMesh, { visible: true })
        .to(inspectDiscMesh.position, { x: discOut ? 1.05 : 0.0, duration: 0.4, ease: "power3.out" });
    }
  }, [sleeveFlipped, discOut]);

  // 6. Sync record on the platter
  useEffect(() => {
    const { recordMat, labelMat, easelFrontMat, recordMesh } = threeRef.current;
    if (!onPlatter || !recordMat || !labelMat) return;

    const side = onPlatter.sides[activeSideIndex] || onPlatter.sides[0];
    const grooves = makeGrooveMaps(side, onPlatter.vinyl_color_hex || "#0e0e10", 384);
    if (recordMat.map) recordMat.map.dispose();
    recordMat.map = grooves.map;
    recordMat.needsUpdate = true;

    loadAlbumCoverTexture(
      onPlatter.album_key,
      onPlatter.artwork_url,
      onPlatter.album_name,
      onPlatter.artist_name,
      33,
      (entry) => {
        if (easelFrontMat) {
          easelFrontMat.map = entry.tex;
          easelFrontMat.needsUpdate = true;
        }
        const lbl = makeLabelTexture(
          {
            album: onPlatter.album_name,
            artist: onPlatter.artist_name,
            label: onPlatter.label_name,
            catalog: onPlatter.catalog_number,
            year: onPlatter.release_year,
            side: side?.side || "A",
            tracks: side?.tracks || [],
          },
          entry.accent,
          rpm,
          256
        );
        if (labelMat.map) labelMat.map.dispose();
        labelMat.map = lbl;
        labelMat.needsUpdate = true;
      }
    );

    if (recordMesh) {
      gsap
        .timeline()
        .to(recordMesh.position, { y: 0.52, duration: 0.22, ease: "power2.out" })
        .to(recordMesh.position, { y: 0.145, duration: 0.28, ease: "bounce.out" });
    }
  }, [onPlatter?.album_key, activeSideIndex, rpm]);

  // 7. Sync platter velocity, RPM LEDs, Volume Fader position & analog surface crackle
  useEffect(() => {
    const spinning = isPlaying || motorOn;
    const baseRpm = rpm === 45 ? 45 : 33.333;
    const radPerSec = (baseRpm * Math.PI * 2) / 60;
    runtimeRef.current.targetVel = spinning ? radPerSec : 0;

    const { led33Mat, led45Mat } = threeRef.current;
    if (led33Mat && led45Mat) {
      led33Mat.emissiveIntensity = rpm === 33 ? 1.6 : 0.08;
      led45Mat.emissiveIntensity = rpm === 45 ? 1.6 : 0.08;
    }

    vinylFoley.setCrackleLoop(Boolean(isPlaying && crackle && activeTab === "studio"));
  }, [isPlaying, motorOn, rpm, crackle, activeTab]);

  useEffect(() => {
    const { faderKnob } = threeRef.current;
    if (!faderKnob || runtimeRef.current.draggingFader) return;
    const ratio = volumePct / 100;
    const targetZ = FADER_Z_BOT - ratio * (FADER_Z_BOT - FADER_Z_TOP);
    gsap.to(faderKnob.position, { z: targetZ, duration: 0.18 });
  }, [volumePct]);

  // 8. Sync Brass Desk Lamp & Pop-up Stylus Target Light
  useEffect(() => {
    const { keySpot, lampBulbMat } = threeRef.current;
    if (keySpot) gsap.to(keySpot, { intensity: lampOn ? 36 : 2, duration: 0.35 });
    if (lampBulbMat) lampBulbMat.color.setHex(lampOn ? 0xffe4b5 : 0x3b2f24);
  }, [lampOn]);

  useEffect(() => {
    const { stylusSpot, stylusLensMat } = threeRef.current;
    if (stylusSpot) gsap.to(stylusSpot, { intensity: stylusLightOn ? 5.5 : 0, duration: 0.25 });
    if (stylusLensMat) stylusLensMat.color.setHex(stylusLightOn ? 0xffdfa8 : 0x2c241d);
  }, [stylusLightOn]);

  // 9. Sync Turntable Finish & Dust Lid
  useEffect(() => {
    const { plinthSideMat, plinthTopMat, walnutPlinthTex } = threeRef.current;
    if (!plinthSideMat || !plinthTopMat) return;
    const cfg = FINISH_CONFIG[finish];
    plinthSideMat.color.setHex(cfg.plinthHex);
    plinthSideMat.map = cfg.useWood ? walnutPlinthTex || null : null;
    plinthSideMat.roughness = cfg.roughness;
    plinthSideMat.metalness = cfg.metalness;
    plinthSideMat.needsUpdate = true;

    if (plinthTopMat.map) plinthTopMat.map.dispose();
    plinthTopMat.map = makeTopPlateTexture(cfg.topBg, cfg.topInk);
    plinthTopMat.roughness = cfg.roughness;
    plinthTopMat.metalness = cfg.metalness;
    plinthTopMat.needsUpdate = true;
  }, [finish]);

  useEffect(() => {
    const { lidPivot } = threeRef.current;
    if (!lidPivot) return;
    gsap.to(lidPivot.rotation, {
      x: lidOpen ? -0.78 : 0,
      duration: 0.7,
      ease: "power3.inOut",
    });
  }, [lidOpen]);

  const isStudio = activeTab === "studio";

  return (
    <div
      className={`fixed inset-0 transition-opacity duration-300 ${
        isStudio ? "z-0 opacity-100 pointer-events-auto" : "-z-10 opacity-0 pointer-events-none"
      }`}
    >
      <div ref={containerRef} className="w-full h-full" data-testid="persistent-3d-canvas" />
      <div ref={css3dMountRef} className="fixed inset-0 pointer-events-none" />
      {/* 3D CSS3D DOM Portal target mounted directly onto the Turntable Plinth in 3D space (with backface-visibility: hidden)! */}
      <div className="hidden">
        <div
          ref={plinthScreenDomRef}
          id="turntable-css3d-screen"
          data-testid="turntable-digital-display"
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
          className="w-[240px] h-[148px] bg-[#080605] border border-brass/70 rounded-[3px] overflow-hidden shadow-2xl pointer-events-auto select-none"
        />
      </div>
      <div className="vignette" />
      <div className="grain" />
    </div>
  );
};
