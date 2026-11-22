/**
 * StageEngine — Orchestrates WebGLRenderer, CSS3DRenderer, Demand-Driven 0 Hz Loop & All 3D Rigs.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import gsap from "gsap";
import { playbackClock } from "../audio/playbackClock";
import { playTrack } from "../audio/playTrack";
import { vinylFoley } from "../audio/vinylFoley";
import { useV4Store } from "../store/useV4Store";
import { attachRaycastController } from "./RaycastController";
import { createRoomRig, type RoomRig } from "./RoomRig";
import { createSleeveInspector, type SleeveInspectorRig } from "./SleeveInspector";
import { createTurntableRig, type TurntableRig } from "./TurntableRig";
import { createVinylCrateRig, type VinylCrateRig } from "./VinylCrateRig";
import {
  ARM_REST_YAW,
  DIRTY_CAMERA,
  DIRTY_SHADOW,
  DIRTY_WEBGL,
  MAX_CRATE_SLEEVES,
  tonearmYawForRadius,
  type StageRuntime,
} from "./sceneConstants";
import { GROOVE_OUTER_R, radiusForSideTime, regenerateArrayMipmaps, uploadCoverToArraySlot } from "./textures";

// Patch Three.js prototypes once for targeted BVH acceleration on dense geometries
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

declare global {
  interface Window {
    __AMDW_STATS?: () => Record<string, any>;
  }
}

export interface StageEngineHandle {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  room: RoomRig;
  turntable: TurntableRig;
  crateRig: VinylCrateRig;
  inspector: SleeveInspectorRig;
  dispose: () => void;
}

export function mountStageEngine(
  container: HTMLDivElement,
  css3dMount: HTMLDivElement,
  screenDom: HTMLDivElement,
  runtime: StageRuntime
): StageEngineHandle | null {
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
    return null;
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

  const initState = useV4Store.getState();
  const room = createRoomRig(scene);
  const turntable = createTurntableRig(scene, css3dScene, screenDom, room.brassMat, initState.finish, initState.lidOpen);
  const crateRig = createVinylCrateRig(scene, renderer, room.brassMat);
  const inspector = createSleeveInspector(scene, turntable.vinylShader.material, turntable.labelMat.map);

  const interactables = [
    ...turntable.interactables,
    ...room.interactables,
    ...crateRig.interactables,
    ...inspector.interactables,
  ];

  let isDisposed = false;
  const compileTimer = window.setTimeout(() => {
    if (!isDisposed) {
      renderer.compileAsync?.(scene, camera).catch(() => {});
    }
  }, 120);

  runtime.rafActive = false;
  runtime.activeTweens = 0;
  let rafId = 0;
  let lastTime = performance.now();
  const _forwardVec = new THREE.Vector3();
  const _rightVec = new THREE.Vector3();
  const _moveVec = new THREE.Vector3();
  const _screenNormal = new THREE.Vector3();
  const _camToScreen = new THREE.Vector3();
  const _screenWorldPos = new THREE.Vector3();
  const _lastCamMatrix = new Float32Array(16);

  const scheduleFrame = () => {
    if (runtime.rafActive) return;
    if (!runtime.isStudio || document.visibilityState === "hidden") return;
    runtime.rafActive = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  };

  const invalidate = (flags: number) => {
    runtime.dirtyFlags |= flags;
    scheduleFrame();
  };
  runtime.invalidate = invalidate;

  runtime.triggerDiscFlipAnim = (nextSideIdx: number, resumeAfter: boolean) => {
    if (runtime.isFlippingDisc) return;
    runtime.isFlippingDisc = true;
    runtime.activeTweens++;
    const st = useV4Store.getState();
    if (st.isPlaying) {
      st.setIsPlaying(false);
      st.setMotorOn(false);
    }
    vinylFoley.playSleeveSlide(st.soundFx);

    const tl = gsap.timeline({
      onUpdate: () => invalidate(DIRTY_WEBGL | DIRTY_SHADOW),
      onComplete: () => {
        runtime.isFlippingDisc = false;
        runtime.activeTweens = Math.max(0, runtime.activeTweens - 1);
        turntable.vinylFlipGroup.rotation.z = 0;
        turntable.vinylFlipGroup.position.y = 0.145;
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
    tl.to(turntable.vinylFlipGroup.position, { y: 0.72, duration: 0.24, ease: "power2.out" })
      .to(
        turntable.vinylFlipGroup.rotation,
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
      .to(turntable.vinylFlipGroup.position, {
        y: 0.145,
        duration: 0.22,
        ease: "bounce.out",
        onStart: () => vinylFoley.playRecordPlace(useV4Store.getState().soundFx),
      });
  };

  controls.addEventListener("start", () => {
    runtime.isOrbiting = true;
    invalidate(DIRTY_WEBGL | DIRTY_CAMERA);
  });
  controls.addEventListener("change", () => {
    invalidate(DIRTY_WEBGL | DIRTY_CAMERA);
  });
  controls.addEventListener("end", () => {
    runtime.isOrbiting = false;
    invalidate(DIRTY_WEBGL | DIRTY_CAMERA);
  });

  const tick = (now: number) => {
    runtime.rafActive = false;
    if (!runtime.isStudio || document.visibilityState === "hidden") return;

    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;
    let keepAlive = false;

    if (runtime.keysPressed.size > 0) {
      camera.getWorldDirection(_forwardVec);
      _forwardVec.y = 0;
      _forwardVec.normalize();
      _rightVec.crossVectors(_forwardVec, camera.up).normalize();
      _moveVec.set(0, 0, 0);
      const speed = 4.5 * dt;
      if (runtime.keysPressed.has("w") || runtime.keysPressed.has("z")) _moveVec.addScaledVector(_forwardVec, speed);
      if (runtime.keysPressed.has("s")) _moveVec.addScaledVector(_forwardVec, -speed);
      if (runtime.keysPressed.has("d")) _moveVec.addScaledVector(_rightVec, speed);
      if (runtime.keysPressed.has("a") || runtime.keysPressed.has("q")) _moveVec.addScaledVector(_rightVec, -speed);
      if (runtime.keysPressed.has("e")) _moveVec.y += speed * 0.7;
      if (runtime.keysPressed.has("c")) _moveVec.y -= speed * 0.7;
      if (_moveVec.lengthSq() > 0) {
        camera.position.add(_moveVec);
        controls.target.add(_moveVec);
        runtime.dirtyFlags |= DIRTY_WEBGL | DIRTY_CAMERA;
        keepAlive = true;
      }
    }

    if (controls.update()) {
      runtime.dirtyFlags |= DIRTY_WEBGL | DIRTY_CAMERA;
      keepAlive = true;
    }

    const velDiff = runtime.targetVel - runtime.platterVel;
    if (Math.abs(velDiff) > 0.0005) {
      runtime.platterVel += velDiff * Math.min(1, dt * 3.8);
    } else {
      runtime.platterVel = runtime.targetVel;
    }
    if (Math.abs(runtime.platterVel) > 0.0005) {
      turntable.platterSpinGroup.rotation.y -= runtime.platterVel * dt;
      runtime.dirtyFlags |= DIRTY_WEBGL;
      keepAlive = true;
    }

    const st = useV4Store.getState();
    const spinning = st.powerOn && (st.isPlaying || st.motorOn);
    if (st.powerOn && st.isPlaying && st.onPlatter && !runtime.isFlippingDisc) {
      const side = st.onPlatter.sides[st.activeSideIndex] || st.onPlatter.sides[0];
      const tracks = side?.tracks || [];
      const activeTrackIdx = st.nowPlaying?.vinyl?.trackIndex ?? 0;
      let elapsedBeforeTrack = 0;
      for (let i = 0; i < Math.min(activeTrackIdx, tracks.length); i++) {
        elapsedBeforeTrack += tracks[i].duration_ms || 180_000;
      }
      const sideElapsed = elapsedBeforeTrack + playbackClock.getPositionMs();
      const r = radiusForSideTime(side, sideElapsed);
      runtime.targetArmYaw = tonearmYawForRadius(r);
      runtime.targetArmPitch = 0.0;
    } else if (spinning && st.onPlatter && !runtime.isFlippingDisc) {
      runtime.targetArmYaw = tonearmYawForRadius(GROOVE_OUTER_R);
      runtime.targetArmPitch = -0.05;
    } else {
      runtime.targetArmYaw = ARM_REST_YAW;
      runtime.targetArmPitch = -0.09;
    }

    const yawDiff = runtime.targetArmYaw - runtime.armYaw;
    const pitchDiff = runtime.targetArmPitch - runtime.armPitch;
    if (Math.abs(yawDiff) > 0.0004 || Math.abs(pitchDiff) > 0.0004) {
      runtime.armYaw += yawDiff * Math.min(1, dt * 4.5);
      runtime.armPitch += pitchDiff * Math.min(1, dt * 5.5);
      turntable.tonearmYawGroup.rotation.y = runtime.armYaw;
      turntable.tonearmPitchGroup.rotation.x = runtime.armPitch;
      runtime.dirtyFlags |= DIRTY_WEBGL | DIRTY_SHADOW;
      keepAlive = true;
    }

    if (crateRig.updateCrateInstances(dt, runtime)) {
      runtime.dirtyFlags |= DIRTY_WEBGL;
      keepAlive = true;
    }

    if (runtime.dirtyFlags & DIRTY_SHADOW) {
      renderer.shadowMap.needsUpdate = true;
    }

    if (runtime.dirtyFlags & (DIRTY_WEBGL | DIRTY_CAMERA | DIRTY_SHADOW)) {
      renderer.render(scene, camera);
    }

    if (runtime.dirtyFlags & DIRTY_CAMERA) {
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
        turntable.oledConsoleGroup.getWorldPosition(_screenWorldPos);
        _screenNormal.set(0, 0, 1).applyQuaternion(turntable.oledConsoleGroup.quaternion);
        _camToScreen.subVectors(camera.position, _screenWorldPos).normalize();
        const facingCamera = _screenNormal.dot(_camToScreen) > 0.05;
        screenDom.style.visibility = facingCamera ? "visible" : "hidden";
        css3dRenderer.render(css3dScene, camera);
      }
    }

    runtime.dirtyFlags = 0;
    if (keepAlive || runtime.activeTweens > 0) {
      scheduleFrame();
    }
  };

  crateRig.updateCrateInstances(0.016, runtime);
  invalidate(DIRTY_WEBGL | DIRTY_CAMERA | DIRTY_SHADOW);

  const detachRaycast = attachRaycastController({
    container,
    renderer,
    camera,
    controls,
    turntable,
    crateRig,
    interactables,
    runtime,
  });

  const onContextRestored = () => {
    const albums = useV4Store.getState().crate.slice(0, MAX_CRATE_SLEEVES);
    Promise.all(
      albums.map((alb, i) =>
        uploadCoverToArraySlot(
          renderer,
          crateRig.crateCoverArray,
          i,
          alb.artwork_url,
          { title: alb.album_name, artist: alb.artist_name, seed: i + 1 },
          384,
          true
        )
      )
    ).then(() => {
      regenerateArrayMipmaps(renderer, crateRig.crateCoverArray);
      invalidate(DIRTY_WEBGL);
    });
  };

  const onResize = () => {
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
  window.addEventListener("resize", onResize);
  dom.addEventListener("webglcontextrestored", onContextRestored);

  window.__AMDW_STATS = () => ({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    pixelRatio: renderer.getPixelRatio(),
    rafActive: runtime.rafActive,
    dirtyFlags: runtime.dirtyFlags,
  });

  onResize();

  return {
    renderer,
    camera,
    controls,
    room,
    turntable,
    crateRig,
    inspector,
    dispose: () => {
      isDisposed = true;
      window.clearTimeout(compileTimer);
      cancelAnimationFrame(rafId);
      runtime.rafActive = false;
      delete window.__AMDW_STATS;
      detachRaycast();
      window.removeEventListener("resize", onResize);
      dom.removeEventListener("webglcontextrestored", onContextRestored);
      vinylFoley.setCrackleLoop(false);
      controls.dispose();
      crateRig.crateCoverArray.dispose();
      envRT.dispose();
      renderer.dispose();
    },
  };
}
