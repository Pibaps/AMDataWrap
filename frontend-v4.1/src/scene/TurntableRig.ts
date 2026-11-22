/**
 * TurntableRig — Direct-Drive Plinth, Platter, Tonearm (BVH), Controls, CSS3D OLED Console & Dust Cover.
 */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import type { TurntableFinish } from "../api/client";
import { useV4Store } from "../store/useV4Store";
import {
  ARM_PIVOT_X,
  ARM_PIVOT_Z,
  ARM_REST_YAW,
  FADER_X,
  FADER_Z_BOT,
  FADER_Z_TOP,
  FINISH_CONFIG,
  PLATTER_X,
  PLATTER_Z,
  makeHitbox,
} from "./sceneConstants";
import {
  LABEL_R,
  PLINTH_D,
  PLINTH_W,
  RECORD_R,
  createProceduralStrobeMaterial,
  createProceduralVinylMaterial,
  createProceduralWalnutMaterial,
  makeButtonTexture,
  makeDialSideTexture,
  makeFeltTexture,
  makeLabelTexture,
  makeRibTexture,
  makeTopPlateTexture,
} from "./textures";

export interface TurntableRig {
  turntableGroup: THREE.Group;
  platterSpinGroup: THREE.Group;
  vinylFlipGroup: THREE.Group;
  vinylShader: ReturnType<typeof createProceduralVinylMaterial>;
  labelMat: THREE.MeshStandardMaterial;
  tonearmYawGroup: THREE.Group;
  tonearmPitchGroup: THREE.Group;
  lidPivot: THREE.Group;
  lidTopPanel: THREE.Mesh;
  lidFrontPanel: THREE.Mesh;
  plinthSideMat: THREE.MeshStandardMaterial;
  plinthWoodMat: THREE.MeshStandardMaterial;
  plinthTopMat: THREE.MeshStandardMaterial;
  plinthBody: THREE.Mesh;
  led33Mat: THREE.MeshStandardMaterial;
  led45Mat: THREE.MeshStandardMaterial;
  strobeLightMat: THREE.MeshStandardMaterial;
  startBtn: THREE.Mesh;
  btn33: THREE.Mesh;
  btn45: THREE.Mesh;
  stylusSpot: THREE.SpotLight;
  stylusLensMat: THREE.MeshBasicMaterial;
  faderKnob: THREE.Mesh;
  faderSlot: THREE.Mesh;
  faderHitbox: THREE.Mesh;
  oledConsoleGroup: THREE.Group;
  interactables: THREE.Object3D[];
}

export function createTurntableRig(
  scene: THREE.Scene,
  css3dScene: THREE.Scene,
  screenDom: HTMLDivElement,
  brassMat: THREE.MeshStandardMaterial,
  initialFinish: TurntableFinish,
  initialLidOpen: boolean
): TurntableRig {
  const hitboxMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  const turntableGroup = new THREE.Group();
  turntableGroup.position.set(-1.25, -0.06, 0.15);
  scene.add(turntableGroup);

  const plinthWoodMat = createProceduralWalnutMaterial("#633a1f", "#2b160a", "plinth", {
    roughness: 0.45,
    metalness: 0.08,
    rings: 18,
    scale: 0.45,
  });
  const fCfg = FINISH_CONFIG[initialFinish];
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

  // Physical Turntable Controls
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
    powerTurret.userData,
    turntableGroup,
    hitboxMat
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
  const btn33Hitbox = makeHitbox(
    new THREE.BoxGeometry(0.3, 0.2, 0.34),
    -1.12,
    0.48,
    1.74,
    btn33.userData,
    turntableGroup,
    hitboxMat
  );

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
  const btn45Hitbox = makeHitbox(
    new THREE.BoxGeometry(0.3, 0.2, 0.34),
    -0.82,
    0.48,
    1.74,
    btn45.userData,
    turntableGroup,
    hitboxMat
  );

  const led45Mat = new THREE.MeshStandardMaterial({
    color: 0x3a2018,
    emissive: 0xff4500,
    emissiveIntensity: 0.05,
  });
  const led45 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.022, 0.04), led45Mat);
  led45.position.set(-0.82, 0.445, 1.62);
  turntableGroup.add(led45);

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
    stylusLampTower.userData,
    turntableGroup,
    hitboxMat
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
    faderSlot.userData,
    turntableGroup,
    hitboxMat
  );

  const quartzLed = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 0.02, 12),
    new THREE.MeshStandardMaterial({ color: 0x6ee7b7, emissive: 0x10b981, emissiveIntensity: 1.1 })
  );
  quartzLed.position.set(FADER_X - 0.3, 0.415, (FADER_Z_TOP + FADER_Z_BOT) / 2);
  turntableGroup.add(quartzLed);

  // Fixed 3D CSS3D OLED Console
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

  // Tonearm Assembly (BVH on S-tube)
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
    cueLever.userData,
    turntableGroup,
    hitboxMat
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

  // Raised Smoked-Acrylic Dust Cover
  const hingeMat = new THREE.MeshStandardMaterial({ color: 0x272422, roughness: 0.4, metalness: 0.8 });
  [-1.75, 1.75].forEach((hx) => {
    const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.1), hingeMat);
    hinge.position.set(hx, 0.4, -PLINTH_D / 2 - 0.02);
    turntableGroup.add(hinge);
  });

  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.42, -PLINTH_D / 2);
  lidPivot.rotation.x = initialLidOpen ? -0.78 : 0;
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
    lidPivot,
    hitboxMat
  );

  return {
    turntableGroup,
    platterSpinGroup,
    vinylFlipGroup,
    vinylShader,
    labelMat,
    tonearmYawGroup,
    tonearmPitchGroup,
    lidPivot,
    lidTopPanel,
    lidFrontPanel,
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
    stylusSpot,
    stylusLensMat,
    faderKnob,
    faderSlot,
    faderHitbox,
    oledConsoleGroup,
    interactables: [
      startBtn,
      powerTurret,
      powerHitbox,
      btn33,
      btn33Hitbox,
      btn45,
      btn45Hitbox,
      recordMesh,
      labelMesh,
      lidHandle,
      lidHandleHitbox,
      lidTopPanel,
      lidFrontPanel,
      stylusLampTower,
      stylusLampHitbox,
      faderSlot,
      faderKnob,
      faderHitbox,
      cueLever,
      cueLeverHitbox,
      sTubeMesh,
      headshellTop,
    ],
  };
}
