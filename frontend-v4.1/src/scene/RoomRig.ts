/**
 * RoomRig — Consolidated Lighting, Analytical GLSL Architecture, Lamp & Now-Playing Easel ("Chevalet").
 */

import * as THREE from "three";
import {
  PLINTH_D,
  PLINTH_W,
  createContactShadowMaterial,
  createProceduralPlasterMaterial,
  createProceduralWalnutMaterial,
} from "./textures";

export interface RoomRig {
  keySpot: THREE.SpotLight;
  lampBulbMat: THREE.MeshBasicMaterial;
  easelFrontMat: THREE.MeshStandardMaterial;
  brassMat: THREE.MeshStandardMaterial;
  interactables: THREE.Object3D[];
}

export function createRoomRig(scene: THREE.Scene): RoomRig {
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

  // Now-Playing Wooden Easel ("Chevalet") — HD 1024px Zero-RAM Cover
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

  return {
    keySpot,
    lampBulbMat,
    easelFrontMat,
    brassMat,
    interactables: [easelSleeveMesh, lampBase, lampStem, lampShade],
  };
}
