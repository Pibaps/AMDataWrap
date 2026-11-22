/**
 * VinylCrateRig — 1-Draw-Call Oak Vinyl Crate (`InstancedMesh` + GPU-Only `DataArrayTexture` 384px).
 */

import * as THREE from "three";
import { useV4Store } from "../store/useV4Store";
import { MAX_CRATE_SLEEVES, SLEEVE_SIZE, SLEEVE_THICK, type StageRuntime } from "./sceneConstants";
import {
  createCrateCoverArray,
  createCrateInstancedMaterial,
  createProceduralWalnutMaterial,
  makeButtonTexture,
} from "./textures";

export interface VinylCrateRig {
  crateInstMesh: THREE.InstancedMesh;
  crateCoverArray: THREE.DataArrayTexture;
  crateWheelTargets: THREE.Object3D[];
  interactables: THREE.Object3D[];
  updateCrateInstances: (dt: number, rt: StageRuntime) => boolean;
}

export function createVinylCrateRig(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  brassMat: THREE.MeshStandardMaterial
): VinylCrateRig {
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

  const _dummy = new THREE.Object3D();

  const updateCrateInstances = (dt: number, rt: StageRuntime): boolean => {
    const st = useV4Store.getState();
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
      _dummy.position.set(xJitter, pivotY + Math.cos(nextTilt) * localY, zPos + Math.sin(nextTilt) * localY);
      _dummy.rotation.set(nextTilt, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      crateInstMesh.setMatrixAt(i, _dummy.matrix);
    }
    crateInstMesh.instanceMatrix.needsUpdate = true;
    crateInstMesh.computeBoundingSphere();
    return moving;
  };

  return {
    crateInstMesh,
    crateCoverArray,
    crateWheelTargets: [crateInstMesh, crateFront, crateBack, crateBottom, cratePlate, crateLabelInner],
    interactables: [cratePlate, crateLabelInner, crateFront, crateBack, crateInstMesh],
    updateCrateInstances,
  };
}
