/**
 * Persistent 3D Listening Room ("Salon d'écoute") — AMDataWrap V4.5.
 *
 * Lean React wrapper mounting `StageEngine` and synchronizing Zustand store slices.
 */

import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import { API, apiGet, buildQueryParams, type VinylDetail } from "../api/client";
import { vinylFoley } from "../audio/vinylFoley";
import { useV4Store } from "../store/useV4Store";
import { mountStageEngine, type StageEngineHandle } from "./StageEngine";
import {
  DIRTY_CAMERA,
  DIRTY_SHADOW,
  DIRTY_WEBGL,
  FADER_Z_BOT,
  FADER_Z_TOP,
  FINISH_CONFIG,
  MAX_CRATE_SLEEVES,
  createInitialRuntime,
} from "./sceneConstants";
import {
  createEphemeralGatefoldInnerTexture,
  createEphemeralVersoTexture,
  loadZeroRamTexture,
  makeLabelTexture,
  makeTopPlateTexture,
  regenerateArrayMipmaps,
  uploadCoverToArraySlot,
} from "./textures";

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

  const runtimeRef = useRef(createInitialRuntime());
  const engineRef = useRef<StageEngineHandle | null>(null);

  // 1. Mount persistent Three.js + CSS3D Listening Room scene once
  useEffect(() => {
    const container = containerRef.current;
    const css3dMount = css3dMountRef.current;
    const screenDom = plinthScreenDomRef.current;
    if (!container || !css3dMount || !screenDom) return;

    const handle = mountStageEngine(container, css3dMount, screenDom, runtimeRef.current);
    if (!handle) return;
    engineRef.current = handle;

    return () => {
      handle.dispose();
      engineRef.current = null;
    };
  }, []);

  // 2. Wake / sleep 3D loop when switching tabs; keep CSS3D YouTube compositor-visible off-studio
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
    const engine = engineRef.current;
    if (!engine) return;
    const { camera, controls, inspector } = engine;
    const inspectGroup = inspector.inspectGroup;
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
      const isDouble = inspected.disc_count >= 2 || inspected.sides.length > 2;
      animCam(0.32, 2.75, isDouble ? 8.1 : 6.2, 0.3, 1.9, 1.6, 0.75);
    } else if (vinylStage === "TURNTABLE") {
      inspectGroup.visible = false;
      animCam(-1.15, 4.35, 5.95, -1.25, 0.45, 0.22, 0.8);
    } else if (vinylStage === "CRATE") {
      inspectGroup.visible = false;
      animCam(3.55, 3.75, 5.75, 3.85, 0.9, 0.15, 0.8);
    } else if (vinylStage === "ROOM") {
      if (inspectGroup.visible) {
        gsap.killTweensOf(inspectGroup.position);
        inspectGroup.visible = false;
      }
      animCam(0.25, 5.25, 9.75, 0.15, 0.6, -0.15, 0.85);
    } else if (vinylStage === "FREECAM") {
      inspectGroup.visible = false;
      inv(DIRTY_WEBGL | DIRTY_SHADOW);
    }
  }, [vinylStage, inspected]);

  // 4. Progressive Batched Upload (4 per batch) into GPU-Only DataArrayTexture (384px x 20)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || crate.length === 0) return;
    const { renderer, crateRig } = engine;

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
              crateRig.crateCoverArray,
              start + offset,
              alb.artwork_url,
              { title: alb.album_name, artist: alb.artist_name, seed: start + offset + 1 },
              384
            )
          )
        );
        if (cancelled) return;
        regenerateArrayMipmaps(renderer, crateRig.crateCoverArray);
        runtimeRef.current.invalidate(DIRTY_WEBGL);
      }
    })();

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

  useEffect(() => {
    runtimeRef.current.invalidate(DIRTY_WEBGL);
  }, [crateIndex]);

  // 5. Sync On-Platter Record (GLSL track stops + Macaron + HD 1024px Easel Cover)
  useEffect(() => {
    const engine = engineRef.current;
    if (!onPlatter || !engine) return;
    const { renderer, turntable, room } = engine;
    const { vinylShader, labelMat } = turntable;
    const { easelFrontMat } = room;

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

  // 6. Sync Inspected Sleeve (HD 1024px Front + Ephemeral Verso + Single Unfolding Double LP Gatefold)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { renderer, inspector } = engine;
    const {
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
    } = inspector;

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

    inspectRightWingPivot.position.set(0, 0, 0);
    inspectLeftWingPivot.position.set(0, 0, 0);
    inspectSleeveMesh.position.set(isDoubleLp ? 1.075 : 0, 0, 0);

    if (isDoubleLp) {
      inspectLeftWingPivot.add(inspectDisc1Mesh);
      inspectRightWingPivot.add(inspectDisc2Mesh);
      inspectDisc1Mesh.position.set(-1.075, 0, -0.004);
      inspectDisc2Mesh.position.set(1.075, 0, -0.004);
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

  // 7. Sleeve Recto/Verso Flip & Physical Disc Slide-Out
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { inspectSleeveGroup, inspectDisc1Mesh, inspectDisc2Mesh } = engine.inspector;
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
    const engine = engineRef.current;
    if (!engine) return;
    const spinning = powerOn && (isPlaying || motorOn);
    const omega = rpm === 45 ? (45 * 2 * Math.PI) / 60 : (33.333 * 2 * Math.PI) / 60;
    runtimeRef.current.targetVel = spinning ? omega : 0;

    const { led33Mat, led45Mat, strobeLightMat, faderKnob } = engine.turntable;
    led33Mat.emissiveIntensity = powerOn && rpm === 33 ? 1.7 : 0.05;
    led45Mat.emissiveIntensity = powerOn && rpm === 45 ? 1.7 : 0.05;
    strobeLightMat.emissiveIntensity = powerOn ? 1.6 : 0.04;
    if (!runtimeRef.current.draggingFader) {
      faderKnob.position.z = FADER_Z_BOT - (volumePct / 100) * (FADER_Z_BOT - FADER_Z_TOP);
    }

    vinylFoley.setCrackleLoop(activeTab === "studio" && powerOn && isPlaying && crackle);
    runtimeRef.current.invalidate(DIRTY_WEBGL);
  }, [isPlaying, motorOn, powerOn, rpm, volumePct, crackle, activeTab]);

  // 9. Sync Lighting, Finish & Dust Lid
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.room.keySpot.intensity = lampOn ? 44 : 7;
    engine.room.lampBulbMat.color.setHex(lampOn ? 0xffe4b5 : 0x3b2c20);
    runtimeRef.current.invalidate(DIRTY_WEBGL);
  }, [lampOn]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.turntable.stylusSpot.intensity = stylusLightOn ? 5.5 : 0;
    engine.turntable.stylusLensMat.color.setHex(stylusLightOn ? 0xffdfa8 : 0x2c241d);
    runtimeRef.current.invalidate(DIRTY_WEBGL);
  }, [stylusLightOn]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { plinthSideMat, plinthWoodMat, plinthTopMat, plinthBody } = engine.turntable;
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
    const engine = engineRef.current;
    if (!engine) return;
    runtimeRef.current.activeTweens++;
    gsap.to(engine.turntable.lidPivot.rotation, {
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

      {/* CSS3D Layer stays compositor-visible offscreen when !isStudio so YouTube plays across every tab */}
      <div
        ref={css3dMountRef}
        className={
          isStudio
            ? "fixed inset-0 z-[1] pointer-events-none"
            : "fixed left-[-9999px] top-0 w-[240px] h-[148px] opacity-[0.01] pointer-events-none"
        }
      />

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
