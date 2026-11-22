/**
 * SleeveInspector — 3D Floating Sleeve Inspector + Double LP Gatefold (2 Physical Discs).
 */

import * as THREE from "three";

export interface SleeveInspectorRig {
  inspectGroup: THREE.Group;
  inspectSleeveGroup: THREE.Group;
  inspectSleeveMesh: THREE.Mesh;
  inspectSpineMesh: THREE.Mesh;
  gatefoldRightInner: THREE.Mesh;
  inspectLeftWingPivot: THREE.Group;
  inspectRightWingPivot: THREE.Group;
  inspectFrontMat: THREE.MeshStandardMaterial;
  inspectBackMat: THREE.MeshStandardMaterial;
  inspectInnerLeftMat: THREE.MeshStandardMaterial;
  inspectInnerRightMat: THREE.MeshStandardMaterial;
  inspectDisc1Mesh: THREE.Mesh;
  inspectDisc2Mesh: THREE.Mesh;
  inspectDisc1LabelMat: THREE.MeshStandardMaterial;
  inspectDisc2LabelMat: THREE.MeshStandardMaterial;
  interactables: THREE.Object3D[];
}

export function createSleeveInspector(
  scene: THREE.Scene,
  vinylMaterial: THREE.Material,
  initialLabelMap: THREE.Texture | null
): SleeveInspectorRig {
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

  const inspectSpineMesh = new THREE.Mesh(new THREE.BoxGeometry(0.065, 2.15, 0.062), cardEdgeMat);
  inspectSpineMesh.position.set(0, 0, 0);
  inspectSpineMesh.visible = false;
  inspectSleeveGroup.add(inspectSpineMesh);

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

  const gatefoldRightInner = new THREE.Mesh(new THREE.PlaneGeometry(2.11, 2.11), inspectInnerRightMat);
  gatefoldRightInner.position.set(1.075, 0, 0.03);
  gatefoldRightInner.visible = false;
  gatefoldRightInner.userData = {
    action: "flip-inspect-sleeve",
    hint: "Pochette Gatefold 2×LP · Volet droit (LP 2 · Faces C/D) · Cliquer pour retourner",
  };
  inspectRightWingPivot.add(gatefoldRightInner);

  const inspectDisc1Mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.01, 1.01, 0.016, 48), vinylMaterial);
  inspectDisc1Mesh.rotation.x = Math.PI / 2;
  inspectDisc1Mesh.castShadow = false;
  inspectDisc1Mesh.userData = {
    action: "place-on-platter",
    discIndex: 0,
    hint: 'Disque 1 (LP 1 · Faces A/B) · Cliquer pour poser sur la platine et lancer la Face A',
  };
  inspectRightWingPivot.add(inspectDisc1Mesh);

  const inspectDisc1LabelMat = new THREE.MeshStandardMaterial({ map: initialLabelMap, roughness: 0.55, transparent: true });
  inspectDisc1Mesh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.019, 32), inspectDisc1LabelMat));

  const inspectDisc2Mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.01, 1.01, 0.016, 48), vinylMaterial);
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

  const inspectDisc2LabelMat = new THREE.MeshStandardMaterial({ map: initialLabelMap, roughness: 0.55, transparent: true });
  inspectDisc2Mesh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.019, 32), inspectDisc2LabelMat));

  return {
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
    interactables: [inspectSleeveMesh, gatefoldLeftMesh, gatefoldRightInner, inspectDisc1Mesh, inspectDisc2Mesh],
  };
}
