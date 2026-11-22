/**
 * Shared constants, types, and pure math helpers for the 3D Listening Room ("Salon d'écoute").
 */

import * as THREE from "three";
import type { TurntableFinish, VinylDetail } from "../api/client";
import { GROOVE_INNER_R, GROOVE_OUTER_R } from "./textures";

// 4-Channel Dirty Flags
export const DIRTY_WEBGL = 1 << 0;
export const DIRTY_CAMERA = 1 << 1;
export const DIRTY_SHADOW = 1 << 2;
export const DIRTY_RAYCAST = 1 << 3;

// Enlarged V4.1 Turntable Spatial Constants (Zero Mechanical Overlap)
export const PLATTER_X = -0.68;
export const PLATTER_Z = -0.05;
export const ARM_PIVOT_X = 1.5;
export const ARM_PIVOT_Z = -1.38;
export const ARM_EFFECTIVE_LEN = 2.48;
export const ARM_REST_YAW = -0.02;

export const FADER_X = 2.26;
export const FADER_Z_TOP = 0.28;
export const FADER_Z_BOT = 1.72;

export const MAX_CRATE_SLEEVES = 20;
export const SLEEVE_SIZE = 2.12;
export const SLEEVE_THICK = 0.042;
export const CRATE_SORTS = ["top", "recent", "era", "genre", "random"];

export const UNDER_LID_ACTIONS = new Set([
  "groove-seek",
  "flip-disc-side",
  "toggle-start",
  "rpm-33",
  "rpm-45",
  "toggle-power",
  "volume-fader",
  "toggle-stylus-light",
]);

export function tonearmYawForRadius(r: number): number {
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

export function findTrackAtRadius(
  v: VinylDetail | null,
  sideIndex: number,
  r: number
): { index: number; track: any } | null {
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

export const FINISH_CONFIG: Record<
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

export interface StageRuntime {
  isStudio: boolean;
  platterVel: number;
  targetVel: number;
  armYaw: number;
  targetArmYaw: number;
  armPitch: number;
  targetArmPitch: number;
  hoveredSlot: number;
  hoveredCrate: boolean;
  draggingFader: boolean;
  isOrbiting: boolean;
  isFlippingDisc: boolean;
  lastDetentBucket: number;
  keysPressed: Set<string>;
  crateTilts: Float32Array;
  crateLifts: Float32Array;
  activeTweens: number;
  dirtyFlags: number;
  rafActive: boolean;
  invalidate: (flags: number) => void;
  triggerDiscFlipAnim: (nextSideIdx: number, resumeAfter: boolean) => void;
}

export function createInitialRuntime(): StageRuntime {
  return {
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
    invalidate: () => {},
    triggerDiscFlipAnim: () => {},
  };
}

export function makeHitbox(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  userData: Record<string, any>,
  parent: THREE.Object3D,
  hitboxMat: THREE.Material
): THREE.Mesh {
  const m = new THREE.Mesh(geo, hitboxMat);
  m.position.set(x, y, z);
  m.userData = userData;
  parent.add(m);
  return m;
}
