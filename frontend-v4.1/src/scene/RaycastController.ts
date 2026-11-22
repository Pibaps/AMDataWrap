/**
 * RaycastController — Zero-GC Raycaster (<= 30 Hz Hover), Closed-Lid Lock, Crate Wheel & FreeCam Keyboard.
 */

import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import gsap from "gsap";
import { API, apiGet, buildQueryParams, formatDurationMs, type VinylDetail } from "../api/client";
import { playTrack } from "../audio/playTrack";
import { vinylFoley } from "../audio/vinylFoley";
import { useV4Store } from "../store/useV4Store";
import {
  CRATE_SORTS,
  DIRTY_CAMERA,
  DIRTY_WEBGL,
  FADER_Z_BOT,
  FADER_Z_TOP,
  MAX_CRATE_SLEEVES,
  UNDER_LID_ACTIONS,
  findTrackAtRadius,
  type StageRuntime,
} from "./sceneConstants";
import { GROOVE_INNER_R, GROOVE_OUTER_R } from "./textures";
import type { TurntableRig } from "./TurntableRig";
import type { VinylCrateRig } from "./VinylCrateRig";

export interface RaycastControllerParams {
  container: HTMLDivElement;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  turntable: TurntableRig;
  crateRig: VinylCrateRig;
  interactables: THREE.Object3D[];
  runtime: StageRuntime;
}

export function attachRaycastController({
  container,
  renderer,
  camera,
  controls,
  turntable,
  crateRig,
  interactables,
  runtime,
}: RaycastControllerParams): () => void {
  const _pointerNdc = new THREE.Vector2();
  const _raycaster = new THREE.Raycaster();
  const _hits: THREE.Intersection[] = [];
  const _localPt = new THREE.Vector3();
  const _interactiveClusterSphere = new THREE.Sphere(new THREE.Vector3(0.4, 1.2, 0.3), 10.5);

  let downPos = { x: 0, y: 0 };
  let lastMovePos = { x: -999, y: -999 };
  let lastRaycastTs = 0;
  let lastWheelAt = 0;

  const dom = renderer.domElement;

  const updateNdc = (clientX: number, clientY: number) => {
    const rect = dom.getBoundingClientRect();
    _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  };

  const applyVolumeFromWorldPoint = (worldPt: THREE.Vector3) => {
    _localPt.copy(worldPt);
    turntable.turntableGroup.worldToLocal(_localPt);
    const clampedZ = Math.max(FADER_Z_TOP, Math.min(FADER_Z_BOT, _localPt.z));
    const ratio = 1 - (clampedZ - FADER_Z_TOP) / (FADER_Z_BOT - FADER_Z_TOP);
    const vol = Math.round(ratio * 100);
    turntable.faderKnob.position.z = clampedZ;
    runtime.invalidate(DIRTY_WEBGL);
    const st = useV4Store.getState();
    if (st.volumePct !== vol) {
      st.setVolumePct(vol);
      st.setHoveredHint(`VOLUME · GAIN : ${vol}%`);
      const bucket = Math.floor(vol / 10);
      if (bucket !== runtime.lastDetentBucket) {
        runtime.lastDetentBucket = bucket;
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
      if ((h.object === turntable.lidTopPanel || h.object === turntable.lidFrontPanel) && lidIsOpen && h.point.y < 1.25) {
        return false;
      }
      return true;
    });
  };

  const pressButtonAnim = (mesh: THREE.Mesh | undefined, baseY: number) => {
    if (!mesh) return;
    runtime.activeTweens++;
    gsap.fromTo(
      mesh.position,
      { y: baseY - 0.024 },
      {
        y: baseY,
        duration: 0.22,
        ease: "back.out(2)",
        onUpdate: () => runtime.invalidate(DIRTY_WEBGL),
        onComplete: () => {
          runtime.activeTweens = Math.max(0, runtime.activeTweens - 1);
        },
      }
    );
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!runtime.isStudio) return;

    if (runtime.draggingFader) {
      updateNdc(e.clientX, e.clientY);
      _raycaster.setFromCamera(_pointerNdc, camera);
      _hits.length = 0;
      _raycaster.intersectObjects([turntable.faderSlot, turntable.plinthBody], false, _hits);
      if (_hits.length > 0) applyVolumeFromWorldPoint(_hits[0].point);
      return;
    }

    if (runtime.isOrbiting) return;

    const now = performance.now();
    if (now - lastRaycastTs < 33) return;
    if (Math.hypot(e.clientX - lastMovePos.x, e.clientY - lastMovePos.y) < 2) return;
    lastRaycastTs = now;
    lastMovePos = { x: e.clientX, y: e.clientY };

    updateNdc(e.clientX, e.clientY);
    _raycaster.setFromCamera(_pointerNdc, camera);
    if (!_raycaster.ray.intersectsSphere(_interactiveClusterSphere)) return;

    _hits.length = 0;
    _raycaster.intersectObjects(interactables, false, _hits);
    const hit = filterValidHit(_hits);
    const st = useV4Store.getState();

    if (hit) {
      const act = hit.object.userData.action as string;
      if (!st.lidOpen && (act === "lid-body" || UNDER_LID_ACTIONS.has(act))) {
        dom.style.cursor = "not-allowed";
        runtime.hoveredSlot = -1;
        const lockHint = "Capot fermé · Cliquer sur la poignée chromée pour ouvrir";
        if (st.hoveredHint !== lockHint) st.setHoveredHint(lockHint);
        return;
      }

      dom.style.cursor = "pointer";
      const prevSlot = runtime.hoveredSlot;
      const newSlot = act === "crate-sleeve" && typeof hit.instanceId === "number" ? hit.instanceId : -1;
      runtime.hoveredSlot = newSlot;
      runtime.hoveredCrate = act === "crate-sleeve" || act === "return-to-crate" || act === "cycle-crate-sort";
      if (prevSlot !== newSlot) runtime.invalidate(DIRTY_WEBGL);

      let hint: string | null = hit.object.userData.hint || null;
      if (act === "crate-sleeve" && newSlot >= 0) {
        const alb = st.crate[newSlot];
        if (alb) {
          const lpTag = alb.disc_count >= 2 ? " · 2×LP" : "";
          hint = `${alb.album_name} — ${alb.artist_name}${lpTag} (${alb.plays} écoutes) · Cliquer pour sortir du bac`;
        }
      } else if (act === "groove-seek" && st.onPlatter) {
        _localPt.copy(hit.point);
        turntable.platterSpinGroup.worldToLocal(_localPt);
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
      dom.style.cursor = "grab";
      runtime.hoveredCrate = false;
      if (runtime.hoveredSlot !== -1) {
        runtime.hoveredSlot = -1;
        runtime.invalidate(DIRTY_WEBGL);
      }
      if (st.hoveredHint !== null) st.setHoveredHint(null);
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    downPos = { x: e.clientX, y: e.clientY };
    if (!runtime.isStudio || e.button !== 0) return;
    if (!useV4Store.getState().lidOpen) return;
    updateNdc(e.clientX, e.clientY);
    _raycaster.setFromCamera(_pointerNdc, camera);
    _hits.length = 0;
    _raycaster.intersectObjects([turntable.faderKnob, turntable.faderSlot, turntable.faderHitbox], false, _hits);
    if (_hits.length > 0) {
      e.stopPropagation();
      runtime.draggingFader = true;
      runtime.isOrbiting = false;
      controls.enabled = false;
      applyVolumeFromWorldPoint(_hits[0].point);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (runtime.draggingFader) {
      runtime.draggingFader = false;
      controls.enabled = true;
      return;
    }
    if (!runtime.isStudio || e.button !== 0) return;
    if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) return;

    updateNdc(e.clientX, e.clientY);
    _raycaster.setFromCamera(_pointerNdc, camera);
    _hits.length = 0;
    _raycaster.intersectObjects(interactables, false, _hits);
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
      pressButtonAnim(turntable.startBtn, 0.435);
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
      pressButtonAnim(turntable.btn33, 0.43);
      st.setRpm(33);
    } else if (action === "rpm-45") {
      vinylFoley.playRpmMicroSwitch(st.soundFx);
      pressButtonAnim(turntable.btn45, 0.43);
      st.setRpm(45);
    } else if (action === "flip-disc-side") {
      if (st.onPlatter) {
        const base = st.activeDiscIndex === 1 && st.onPlatter.sides.length > 2 ? 2 : 0;
        const pairLen = Math.min(2, st.onPlatter.sides.length - base);
        const nextSideIdx = pairLen >= 2 ? base + ((st.activeSideIndex - base + 1) % pairLen) : base;
        runtime.triggerDiscFlipAnim(nextSideIdx, st.isPlaying);
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
      turntable.platterSpinGroup.worldToLocal(_localPt);
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

  const onWheel = (e: WheelEvent) => {
    if (!runtime.isStudio) return;
    if (e.target !== dom && !container.contains(e.target as Node)) return;
    const st = useV4Store.getState();
    if (st.crate.length === 0) return;

    let inCrateBrowse =
      runtime.hoveredCrate ||
      runtime.hoveredSlot >= 0 ||
      (st.vinylStage === "CRATE" && !e.ctrlKey && !e.metaKey);

    if (!inCrateBrowse) {
      updateNdc(e.clientX, e.clientY);
      _raycaster.setFromCamera(_pointerNdc, camera);
      _hits.length = 0;
      _raycaster.intersectObjects(crateRig.crateWheelTargets, false, _hits);
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
        runtime.invalidate(DIRTY_WEBGL);
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const k = e.key.toLowerCase();
    if ("wasdzqec".includes(k)) {
      runtime.keysPressed.add(k);
      runtime.invalidate(DIRTY_WEBGL | DIRTY_CAMERA);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    runtime.keysPressed.delete(e.key.toLowerCase());
  };

  window.addEventListener("pointermove", onPointerMove);
  dom.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("wheel", onWheel, { capture: true, passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointermove", onPointerMove);
    dom.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("wheel", onWheel, true);
  };
}
